import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { BRIEFING, DEFAULT_USER_SETTINGS } from '../constants.js';
import { db } from '../db/index.js';
import { briefingRuns, userFileState, users, userSettings } from '../db/schema.js';
import { parseFlagItems } from '../lib/briefing/readItems.js';
import { findEditionItem, readOriginal, ReaderError } from '../lib/briefing/reader.js';
import { kstMonthStart } from '../lib/briefing/time.js';
import {
  BriefingBudgetError,
  BriefingBusyError,
  cancelRun,
  isConfigured,
  listRuns,
  monthCostUsd,
  nextSinceAt,
  runningRun,
  runningSubscriptionRun,
  startRun,
  toRunDto,
} from '../lib/briefing/run.js';
import { clampDays, editionNav, listEditions } from '../lib/briefing/editions.js';
import { nextAuto, readSchedule, scheduleSchema, type AutoSchedule } from '../lib/briefing/autoSchedule.js';
import { briefingOwnerOf, listReaderCandidates, setReader } from '../lib/briefing/readers.js';
import {
  assertTriggerUrl,
  createPing,
  issueToken,
  JobError,
  missingToday,
  readMode,
  recentSubscription,
  revokeToken,
  setMode,
  setTrigger,
  subscriptionSummary,
  nextTrigger,
  triggerSet,
  triggerTimesOf,
} from '../lib/briefing/subscription.js';
import { checkDomainsOf, networkAllowlistOf } from '../lib/briefing/jobDomains.js';
import { loadSourcesDoc } from '../lib/briefing/sources.js';
import { fail } from '../lib/errors.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// API-131~140 뉴스 브리핑 — 관리자 전용(LLM 요금을 내는 사람). 회차 문서 자체는 파일 API가 다룬다.
// 예외는 열람 계정(v0.49)이 쓰는 회차 목록·이동 두 GET뿐이다.
// 설계: docs/design/뉴스브리핑_docvault_20261001.md

/** 이 라우트 묶음 안에서만 쓰는 변수 — 지금 보는 회차의 주인(관리자 본인, 또는 열람 계정이 함께 보는 관리자) */
type BriefingEnv = { Variables: AppEnv['Variables'] & { briefingOwnerId: number } };

/** 열람 계정에게 열린 길 — 회차 목록(API-135)과 이전·다음(API-136). 그 밖은 전부 관리자 전용 */
const READER_PATH = /\/briefing\/editions(?:\/\d+\/nav)?$/;

// 기본은 거절, 예외를 명시한다 (CLAUDE.md 보안) — 열람 계정은 GET 두 개만, 그때 보는 회차의 주인을 실어 준다
const briefingGuard = createMiddleware<BriefingEnv>(async (c, next) => {
  const user = c.get('user');
  if (user.role === 'admin') {
    c.set('briefingOwnerId', user.id);
    return next();
  }
  const owner = c.req.method === 'GET' && READER_PATH.test(c.req.path) ? briefingOwnerOf(user.id) : null;
  if (owner === null) return fail(c, 403, 'FORBIDDEN', '관리자 전용입니다');
  c.set('briefingOwnerId', owner);
  return next();
});

/** 열람 계정의 패널 머리에 보일 "○○님이 만든 브리핑" — 본인 회차면 null */
function ownerNameFor(viewerId: number, ownerId: number): string | null {
  if (viewerId === ownerId) return null;
  const u = db.select({ name: users.displayName, username: users.username }).from(users).where(eq(users.id, ownerId)).get();
  return u ? (u.name ?? u.username) : null;
}

function autoEnabled(userId: number): boolean {
  const row = db.select({ v: userSettings.briefingAuto }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return (row?.v ?? DEFAULT_USER_SETTINGS.briefingAuto) === 1;
}

/** 앱 안 원문 보기 스위치 — 설정에서 켠 관리자만 (개선 합의안 7장) */
function readerEnabled(userId: number): boolean {
  const row = db.select({ v: userSettings.briefingReader }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return (row?.v ?? DEFAULT_USER_SETTINGS.briefingReader) === 1;
}

/** 이번 달(한국시간) "틀린 곳 알리기" 수 — 회차 수십 개의 JSON 칸을 읽지만 관리자 한 명의 행뿐이라 가볍다 */
function monthFlagCount(userId: number, now = Date.now()): number {
  const since = kstMonthStart(now);
  const rows = db.select({ flagItems: userFileState.flagItems }).from(userFileState).where(eq(userFileState.userId, userId)).all();
  let n = 0;
  for (const r of rows) for (const f of parseFlagItems(r.flagItems)) if (f.at >= since) n++;
  return n;
}

export const briefingRoutes = new Hono<BriefingEnv>()
  .use('*', briefingGuard)

  // API-131: 상태 — 패널이 실행 중에만 2초마다 다시 읽는다
  .get('/status', (c) => {
    const user = c.get('user');
    const auto = autoEnabled(user.id);
    const schedule = readSchedule(user.id);
    const mode = readMode(user.id);
    // 구독 모드의 "다음 자동"은 트리거 시각(회차 시작 − 리드) (v0.50)
    const next = auto ? (mode === 'subscription' ? nextTrigger(schedule, Date.now()) : nextAuto(schedule, Date.now())) : null;
    // 구독 실행이 돌면 그것이 "지금 실행" — 서버 안 실행과 동시에 있을 수 없다(startRun이 먼저 닫는다)
    const running = runningRun() ?? runningSubscriptionRun(user.id);
    const sub = mode === 'subscription' ? subscriptionSummary(user.id) : null;
    const last = db
      .select()
      .from(briefingRuns)
      .where(and(eq(briefingRuns.ownerId, user.id)))
      .orderBy(desc(briefingRuns.startedAt))
      .limit(5)
      .all()
      .find((r) => r.status !== 'running');
    return c.json({
      configured: isConfigured(),
      autoEnabled: auto,
      schedule,
      nextAutoAt: next?.at ?? null,
      nextAutoSlot: next?.slot ?? null,
      running: running ? toRunDto(running) : null,
      last: last ? toRunDto(last) : null,
      monthCostUsd: monthCostUsd(user.id),
      monthBudgetUsd: BRIEFING.MONTHLY_BUDGET_USD,
      budgetWarnRatio: BRIEFING.BUDGET_WARN_RATIO,
      nextSinceAt: nextSinceAt(user.id),
      readerEnabled: readerEnabled(user.id),
      monthFlagCount: monthFlagCount(user.id),
      mode,
      ...(sub
        ? { subscription: { tokenPrefix: sub.tokenPrefix, tokenLastUsedAt: sub.tokenLastUsedAt, triggerSet: sub.triggerSet, triggerBroken: sub.triggerBroken, lastPingAt: sub.lastPingAt, missing: missingToday(user.id) } }
        : {}),
    });
  })

  // API-141: 구독 연결 열쇠 발급·재발급 — 원문은 이 응답에 한 번만, 이전 열쇠는 즉시 무효 (v0.50)
  .post('/token', (c) => {
    const { token, prefix, createdAt } = issueToken(c.get('user').id);
    c.header('Cache-Control', 'no-store');
    return c.json({ token, prefix, createdAt });
  })

  // API-142: 열쇠 폐기 — 구독 모드였으면 api로 돌아간다
  .delete('/token', (c) => {
    revokeToken(c.get('user').id);
    return c.body(null, 204);
  })

  // API-143: 구독 방식 상태 — 설정 화면이 읽는다
  .get('/subscription', (c) => {
    const userId = c.get('user').id;
    const sub = subscriptionSummary(userId);
    const schedule = readSchedule(userId);
    const { doc } = loadSourcesDoc(userId);
    // 프록시(Caddy) 뒤라 c.req.url은 http://app:3000 — 바깥 주소는 X-Forwarded-* 로 복원한다. 복사 줄이 http면 스킬이 "https가 아니다"로 멈춘다(첫 실전 2026-10-31)
    const url = new URL(c.req.url);
    const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
    const host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim() || c.req.header('host') || url.host;
    const origin = `${proto}://${host}`;
    return c.json({
      ...sub,
      leadMs: BRIEFING.SUB_LEAD_MS,
      deadlineAfterMs: BRIEFING.SUB_DEADLINE_AFTER_MS,
      triggerTimes: triggerTimesOf(schedule),
      recent: recentSubscription(userId),
      allowedDomains: checkDomainsOf(doc),
      // 허용 목록 복사 버튼용 — 맨몸 + 별표 (jobDomains.ts 주석)
      allowlist: networkAllowlistOf(doc, new URL(origin).host),
      checklist: {
        docvaultUrl: origin,
        // 열쇠는 claude.ai 환경의 네트워크 시크릿(Bearer)이 붙인다 — 세션이 값을 못 보는 쪽이 설계 1순위(첫 실전 2026-10-30에서 확인: 환경 변수 화면은 "시크릿을 넣지 마세요")
        envNames: ['DOCVAULT_URL'],
        secret: { host: new URL(origin).host, pathPrefix: BRIEFING.SUB_JOBS_PATH_PREFIX, header: 'Authorization', prefix: 'Bearer' },
        taskPrompt: 'routine-fire-payload 블록에 적힌 BRIEFING_JOB_ID로 briefing-subscription 스킬을 실전 모드로 실행해. DOCVAULT_URL은 환경 변수에 있고, docvault 연결 열쇠는 네트워크 시크릿이 붙여 줘.',
      },
    });
  })

  // API-144: [연결 확인] — ping job으로 트리거를 쏜다. 회차는 만들지 않는다
  .post('/subscription/ping', async (c) => {
    const userId = c.get('user').id;
    if (!triggerSet(userId)) return fail(c, 409, 'BRIEFING_TRIGGER_NOT_SET', '예약 작업 트리거가 설정되지 않았어요');
    try {
      return c.json({ jobId: await createPing(userId) }, 202);
    } catch (e) {
      if (e instanceof JobError) return c.json({ code: e.code, message: e.message }, e.status);
      throw e;
    }
  })

  // API-138: 앱 안 원문 보기 — 기사 id만 받고 서버가 회차에서 readUrl을 찾는다(열린 프록시 금지). 받은 글은 저장하지 않는다 (v0.45)
  .get('/editions/:fileId/items/:itemId/reader', async (c) => {
    const user = c.get('user');
    if (!readerEnabled(user.id)) return fail(c, 403, 'BRIEFING_READER_OFF', '앱 안 원문 보기가 꺼져 있어요 (설정 → 뉴스 브리핑)');
    const fileId = parseId(c.req.param('fileId'));
    const itemId = c.req.param('itemId');
    if (fileId === null || !itemId || itemId.length > BRIEFING.ITEM_ID_MAX_CHARS) return fail(c, 400, 'VALIDATION_ERROR', '올바르지 않은 값');
    const item = findEditionItem(user.id, fileId, itemId);
    if (!item) return fail(c, 404, 'NOT_FOUND', '기사가 없습니다');
    // 폰의 캐시에 남지 않게 — "저장하지 않는다"는 브라우저 쪽에도 적용된다
    c.header('Cache-Control', 'no-store');
    try {
      return c.json(await readOriginal(item, c.req.raw.signal));
    } catch (e) {
      if (e instanceof ReaderError) {
        const status = e.code === 'NO_URL' ? 404 : e.code === 'NOT_FOUND' ? 404 : 422;
        return fail(c, status, `BRIEFING_READER_${e.code}`, e.message);
      }
      throw e;
    }
  })

  // API-135: 회차 목록 — 패널의 오늘·지난 브리핑 (v0.43). 열람 계정은 함께 보는 관리자의 회차를, 읽음 상태는 자기 것으로 (v0.49)
  .get('/editions', (c) => {
    const before = c.req.query('before') ?? null;
    if (before !== null && !/^\d{4}-\d{2}-\d{2}$/.test(before)) return fail(c, 400, 'VALIDATION_ERROR', 'before: YYYY-MM-DD 형식이어야 합니다');
    const user = c.get('user');
    const ownerId = c.get('briefingOwnerId');
    return c.json({ ...listEditions(ownerId, user.id, before, clampDays(c.req.query('days'))), ownerName: ownerNameFor(user.id, ownerId) });
  })

  // API-136: 이전·다음 회차와 같은 날 회차들 — 회차 화면의 ‹ ›·회차 칩 (v0.43)
  .get('/editions/:fileId/nav', (c) => {
    const fileId = parseId(c.req.param('fileId'));
    if (fileId === null) return fail(c, 400, 'VALIDATION_ERROR', 'fileId: 올바르지 않은 값');
    const nav = editionNav(c.get('briefingOwnerId'), c.get('user').id, fileId);
    if (!nav) return fail(c, 404, 'NOT_FOUND', '회차가 없습니다');
    return c.json(nav);
  })

  // API-139: 열람 계정 후보 — 일반 계정 전부와 지금 켜져 있는지 (v0.49)
  .get('/readers', (c) => c.json({ users: listReaderCandidates(c.get('user').id) }))

  // API-140: 열람 계정 켜기/끄기 — 그 계정의 briefing_owner_id를 나로 두거나 지운다 (v0.49)
  .put('/readers/:userId', jsonBody(z.object({ on: z.boolean() })), (c) => {
    const userId = parseId(c.req.param('userId'));
    if (userId === null) return fail(c, 400, 'VALIDATION_ERROR', 'userId: 올바르지 않은 값');
    if (!setReader(c.get('user').id, userId, c.req.valid('json').on)) return fail(c, 404, 'NOT_FOUND', '일반 계정이 아니거나 없습니다');
    return c.json({ users: listReaderCandidates(c.get('user').id) });
  })

  // API-132: 만들기 시작 — 202로 곧바로 답하고 만드는 일은 뒤에서. 구독 모드에서는 [지금 만들기] — 항상 앱이 직접(API) 만들고,
  // 도는 구독 실행은 startRun이 "직접 만들기로 대체"로 닫는다. slot은 알림 띠가 보내는 회차(수시판 대신 그 회차 이름으로) (v0.50)
  .post('/runs', jsonBody(z.object({ force: z.boolean().optional(), slot: z.enum(['morning', 'noon', 'evening']).optional() })), (c) => {
    if (!isConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', 'API 키가 연결되지 않았어요');
    const { force, slot } = c.req.valid('json');
    try {
      const run = startRun({ ownerId: c.get('user').id, trigger: 'manual', slot: slot ?? 'adhoc', force });
      return c.json({ run: toRunDto(run) }, 202);
    } catch (e) {
      if (e instanceof BriefingBusyError) return c.json({ code: 'BRIEFING_RUNNING', message: e.message, run: toRunDto(e.run) }, 409);
      if (e instanceof BriefingBudgetError) {
        return c.json({ code: 'BRIEFING_BUDGET_EXCEEDED', message: e.message, monthCostUsd: e.monthCostUsd, monthBudgetUsd: BRIEFING.MONTHLY_BUDGET_USD }, 409);
      }
      throw e;
    }
  })

  // API-137: 도는 실행 중지 — 받는 곳이 응답하지 않아 몇 분째 멈춘 실행을 사람이 끝낼 수 있게 (2026-10-02)
  .post('/runs/:id/cancel', (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const run = db.select().from(briefingRuns).where(and(eq(briefingRuns.id, id), eq(briefingRuns.ownerId, c.get('user').id))).get();
    if (!run) return fail(c, 404, 'NOT_FOUND', '실행 기록이 없습니다');
    // 이미 끝난 실행이면 아무것도 하지 않고 지금 상태를 돌려준다 — 두 번 눌러도 같다
    if (run.status === 'running') cancelRun(id);
    const now = db.select().from(briefingRuns).where(eq(briefingRuns.id, id)).get() ?? run;
    return c.json({ run: toRunDto(now) });
  })

  // API-133: 실행 기록
  .get('/runs', (c) => {
    const raw = Number(c.req.query('limit') ?? BRIEFING.RUNS_LIST_DEFAULT);
    const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, BRIEFING.RUNS_LIST_MAX) : BRIEFING.RUNS_LIST_DEFAULT;
    return c.json({ runs: listRuns(c.get('user').id, limit).map(toRunDto) });
  })

  // API-134: 자동 생성 설정 — 전체 켜기/끄기와 회차별 켜기·시각(v0.43). 둘 중 보낸 것만 바꾼다.
  // 키 없이 켜 두면 매번 조용히 실패하므로 켜기는 막는다 (자동 백업과 같은 이유)
  .put(
    '/settings',
    jsonBody(
      z.object({
        autoEnabled: z.boolean().optional(),
        schedule: scheduleSchema.optional(),
        readerEnabled: z.boolean().optional(),
        mode: z.enum(['api', 'subscription']).optional(),
        trigger: z.object({ url: z.string().trim().max(BRIEFING.SUB_URL_MAX_CHARS), token: z.string().trim().min(1).max(512) }).nullable().optional(),
      }),
    ),
    async (c) => {
    const body = c.req.valid('json');
    const userId = c.get('user').id;
    const now = Date.now();
    // 검사를 전부 먼저, 저장은 그 뒤 — 거절 응답을 받았는데 방식·트리거만 바뀌어 있으면 화면과 서버가 어긋난다
    if (body.trigger) {
      const bad = await assertTriggerUrl(body.trigger.url);
      if (bad) return fail(c, 400, 'VALIDATION_ERROR', `trigger.url: ${bad}`);
    }
    // 구독 모드 (v0.50): 트리거는 암호화해 두고 값은 다시 내려오지 않는다. 구독으로 바꾸려면 열쇠와 트리거(이번에 함께 보낸 것도 인정)가 있어야 한다
    const willHaveTrigger = body.trigger ? true : body.trigger === null ? false : triggerSet(userId);
    if (body.mode === 'subscription' && !(subscriptionSummary(userId).tokenPrefix && willHaveTrigger)) {
      return fail(c, 409, 'BRIEFING_TRIGGER_NOT_SET', '연결 열쇠를 발급하고 예약 작업 트리거를 넣어야 구독으로 받을 수 있어요');
    }
    // 키 없이 켜 두면 매번 조용히 실패하므로 켜기는 막는다 — api 모드만. 구독 모드는 키 없이 트리거·마감이 돈다
    const modeAfter = body.trigger === null ? 'api' : (body.mode ?? readMode(userId));
    if (body.autoEnabled && modeAfter === 'api' && !isConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', 'API 키가 연결되지 않았어요');

    if (body.trigger) setTrigger(userId, body.trigger, now);
    else if (body.trigger === null) setTrigger(userId, null, now);
    if (body.mode) setMode(userId, body.mode, now);
    const modeNow = readMode(userId);
    const set = {
      ...(body.autoEnabled !== undefined ? { briefingAuto: body.autoEnabled ? 1 : 0 } : {}),
      ...(body.schedule ? { briefingSchedule: JSON.stringify(body.schedule) } : {}),
      ...(body.readerEnabled !== undefined ? { briefingReader: body.readerEnabled ? 1 : 0 } : {}),
      updatedAt: now,
    };
    db.insert(userSettings)
      .values({ ...DEFAULT_USER_SETTINGS, userId, ...set })
      .onConflictDoUpdate({ target: userSettings.userId, set })
      .run();
    const auto = autoEnabled(userId);
    const schedule: AutoSchedule = readSchedule(userId);
    const next = auto ? (modeNow === 'subscription' ? nextTrigger(schedule, now) : nextAuto(schedule, now)) : null;
    return c.json({ autoEnabled: auto, schedule, nextAutoAt: next?.at ?? null, nextAutoSlot: next?.slot ?? null, readerEnabled: readerEnabled(userId), mode: modeNow, triggerSet: triggerSet(userId) });
    },
  );
