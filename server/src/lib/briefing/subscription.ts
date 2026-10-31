import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { and, desc, eq, gt, inArray, isNotNull, lte } from 'drizzle-orm';
import { BRIEFING, DEFAULT_USER_SETTINGS } from '../../constants.js';
import { db } from '../../db/index.js';
import { briefingRuns, files, users, userSettings } from '../../db/schema.js';
import { decryptSecret, encryptSecret, hashEquals, newApiToken, sha256Hex } from '../crypto.js';
import { parseSchedule, type AutoSchedule, type AutoSlot } from './autoSchedule.js';
import { isAggregator } from './collect.js';
import { layoutEdition, readPrevious, saveEdition, type Edition, type ItemDraft, type Slot } from './edition.js';
import { isPrivateAddress } from './fetch.js';
import { buildInstruction, type Instruction, type PrevStoryRef } from './jobInstruction.js';
import { checkItems, ResultSchema, tooManyDropped, type JobResult, type ResultItem } from './jobResult.js';
import { addLog, closeLive, openRemoteLive, setRemoteStage, type RemoteStage } from './live.js';
import { closeSubscriptionRun, nextSinceAt, runningSubscriptionRun } from './run.js';
import { loadSourcesDoc } from './sources.js';
import { SourcesError } from './sourcesDoc.js';
import { SUBS } from './taxonomy.js';
import { kstParts, kstToMs } from './time.js';

// 구독 생성 방식 — 회차를 서버가 트리거한 claude.ai 예약 작업(사용자의 Claude 구독)이 만든다 (뉴스 브리핑 설계 "구독 생성 방식", v0.50).
// 서버가 하는 일: 켜기(트리거)·지시서 내주기·진행 보고 받기·완성본 검사·조립·저장·마감 닫기. 이 경로에서 서버는 AI를 한 번도 부르지 않는다.
// 열쇠 두 개는 반대 방향이다 — 트리거 토큰(서버→claude.ai, DB에 암호화)과 연결 열쇠(claude.ai→서버, DB에 해시만)

type RunRow = typeof briefingRuns.$inferSelect;
type SettingsRow = typeof userSettings.$inferSelect;

const TRIGGER_PURPOSE = 'briefing-trigger';
/** 트리거 fire 호출에 붙는 헤더 — claude.ai 예약 작업 공식 API (code.claude.com/docs/en/routines "Trigger a scheduled task") */
const TRIGGER_HEADERS = { 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
/** 시험으로 정하기 전까지의 모델 구성 — 설정으로 뺄지는 5단계에서 (A 전부 Opus · B 분류·선별은 Sonnet) */
const MODEL_CONFIG = 'B';

export type BriefingMode = 'api' | 'subscription';
export type PingResult = 'fired' | 'ok' | 'trigger_failed' | 'token_invalid';

/** 라우트가 그대로 HTTP 응답으로 옮기는 실패 — 코드는 API 명세서의 에러 코드 표 */
export class JobError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422 | 502,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// ---- 설정 읽기·쓰기 ----

function settingsOf(userId: number): SettingsRow | undefined {
  return db.select().from(userSettings).where(eq(userSettings.userId, userId)).get();
}

function upsertSettings(userId: number, set: Partial<SettingsRow>, now = Date.now()): void {
  const patch = { ...set, updatedAt: now };
  db.insert(userSettings)
    .values({ ...DEFAULT_USER_SETTINGS, userId, ...patch })
    .onConflictDoUpdate({ target: userSettings.userId, set: patch })
    .run();
}

export function readMode(userId: number): BriefingMode {
  return settingsOf(userId)?.briefingMode ?? DEFAULT_USER_SETTINGS.briefingMode;
}

/** 방식 변경 — 바꾸는 순간 도는 구독 실행은 "방식 변경"으로 닫는다. 늦게 오는 완성본은 거절된다 (설계 "흐름") */
export function setMode(userId: number, mode: BriefingMode, now = Date.now()): void {
  if (readMode(userId) === mode) return;
  // 도는 구독 실행은 보통 하나지만, 전부 닫는다 — 하나만 닫으면 남은 것이 완성본을 보내 회차가 생긴다
  for (const r of db.select().from(briefingRuns).where(and(eq(briefingRuns.ownerId, userId), eq(briefingRuns.status, 'running'), eq(briefingRuns.trigger, 'subscription'))).all()) {
    closeSubscriptionRun(r.id, 'cancelled', '생성 방식을 바꿔 멈췄어요');
  }
  upsertSettings(userId, { briefingMode: mode }, now);
}

// ---- 연결 열쇠 (claude.ai → 서버) ----

export function issueToken(userId: number, now = Date.now()): { token: string; prefix: string; createdAt: number } {
  const token = newApiToken();
  const prefix = token.slice(0, BRIEFING.SUB_TOKEN_PREFIX_CHARS);
  upsertSettings(userId, { briefingTokenHash: sha256Hex(token), briefingTokenPrefix: prefix, briefingTokenCreatedAt: now, briefingTokenLastUsedAt: null }, now);
  return { token, prefix, createdAt: now };
}

/** 열쇠 폐기 — 열쇠 없는 구독은 돌 수 없으므로 방식도 api로 */
export function revokeToken(userId: number, now = Date.now()): void {
  setMode(userId, 'api', now);
  upsertSettings(userId, { briefingTokenHash: null, briefingTokenPrefix: null, briefingTokenCreatedAt: null, briefingTokenLastUsedAt: null }, now);
}

/** 열쇠 원문 → 주인. 해시가 있는 행만(관리자 몇 명) 상수 시간으로 비교한다 */
export function findTokenOwner(token: string): { userId: number; prefix: string } | null {
  if (!token.startsWith(BRIEFING.SUB_TOKEN_PREFIX)) return null;
  const hash = sha256Hex(token);
  const rows = db.select({ userId: userSettings.userId, hash: userSettings.briefingTokenHash, prefix: userSettings.briefingTokenPrefix }).from(userSettings).where(isNotNull(userSettings.briefingTokenHash)).all();
  for (const r of rows) if (r.hash && hashEquals(r.hash, hash)) return { userId: r.userId, prefix: r.prefix ?? '' };
  return null;
}

/** 이 앞 8자로 발급된 열쇠가 있나 — 인증 실패 제한의 묶는 키를 정할 때만 쓴다 */
export function tokenPrefixKnown(prefix: string): boolean {
  return prefix.length === BRIEFING.SUB_TOKEN_PREFIX_CHARS && !!db.select({ userId: userSettings.userId }).from(userSettings).where(eq(userSettings.briefingTokenPrefix, prefix)).get();
}

export function touchToken(userId: number, now = Date.now()): void {
  db.update(userSettings).set({ briefingTokenLastUsedAt: now }).where(eq(userSettings.userId, userId)).run();
}

// ---- 트리거 토큰 (서버 → claude.ai) ----

type Trigger = { url: string; token: string };

export function setTrigger(userId: number, trigger: Trigger | null, now = Date.now()): void {
  upsertSettings(userId, { briefingTriggerEnc: trigger ? encryptSecret(JSON.stringify(trigger), TRIGGER_PURPOSE) : null }, now);
  if (!trigger) setMode(userId, 'api', now);
}

/** 저장된 트리거 — 없으면 null, 복호화 실패(JWT_SECRET 변경)면 'broken'(설정 화면이 "다시 넣어 주세요") */
export function readTrigger(userId: number): Trigger | null | 'broken' {
  const enc = settingsOf(userId)?.briefingTriggerEnc;
  if (!enc) return null;
  const plain = decryptSecret(enc, TRIGGER_PURPOSE);
  if (!plain) return 'broken';
  try {
    const v = JSON.parse(plain) as Partial<Trigger>;
    return typeof v.url === 'string' && typeof v.token === 'string' ? { url: v.url, token: v.token } : 'broken';
  } catch {
    return 'broken';
  }
}

export function triggerSet(userId: number): boolean {
  const t = readTrigger(userId);
  return t !== null && t !== 'broken';
}

/** 트리거 주소 검사 — https·공식 호스트·fire 경로만. 그래도 사설망 검사는 남긴다(RSS와 같은 선, 호스트 고정이 풀려도 한 겹 더) */
export async function assertTriggerUrl(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '주소 형식이 아닙니다';
  }
  if (url.protocol !== 'https:') return 'https 주소여야 합니다';
  if (url.username || url.password) return '주소에 아이디·비밀번호를 넣을 수 없습니다';
  if (url.hostname !== BRIEFING.SUB_TRIGGER_HOST || url.port) return `${BRIEFING.SUB_TRIGGER_HOST} 의 주소여야 합니다`;
  if (!BRIEFING.SUB_TRIGGER_PATH.test(url.pathname)) return '예약 작업의 fire 주소(/v1/claude_code/routines/<id>/fire)가 아닙니다';
  try {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) return '내부망 주소는 쓸 수 없습니다';
  } catch {
    return '주소를 찾을 수 없습니다';
  }
  return null;
}

/**
 * 예약 작업 켜기 — POST {fireUrl} + Bearer 트리거 토큰, 본문 text에 jobId. text는 예약 작업에 "신뢰하지 않는 데이터"로 감싸여 들어가므로
 * 예약 작업의 저장된 지시문이 그 안의 BRIEFING_JOB_ID를 읽도록 적혀 있어야 한다(시험 안내문). 10초·재시도 1회
 */
async function fireTrigger(userId: number, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trigger = readTrigger(userId);
  if (trigger === null) return { ok: false, reason: '트리거가 설정되지 않았어요' };
  if (trigger === 'broken') return { ok: false, reason: '트리거를 읽을 수 없어요 — 다시 넣어 주세요' };
  const bad = await assertTriggerUrl(trigger.url);
  if (bad) return { ok: false, reason: bad };
  let last = '';
  for (let attempt = 0; attempt <= BRIEFING.SUB_TRIGGER_RETRIES; attempt++) {
    try {
      const res = await fetch(trigger.url, {
        method: 'POST',
        headers: { ...TRIGGER_HEADERS, authorization: `Bearer ${trigger.token}` },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(BRIEFING.SUB_TRIGGER_TIMEOUT_MS),
        redirect: 'error',
      });
      if (res.ok) return { ok: true };
      last = `HTTP ${res.status}`;
      // 인증·권한 거절은 다시 보내도 같다
      if (res.status === 401 || res.status === 403 || res.status === 404) break;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, reason: last || '응답 없음' };
}

// ---- 실행(job) ----

export function jobByJobId(jobId: string): RunRow | null {
  return db.select().from(briefingRuns).where(eq(briefingRuns.jobId, jobId)).get() ?? null;
}

function oneSlotStart(schedule: AutoSchedule, slot: AutoSlot, date: string): number {
  const at = schedule[slot].at;
  return kstToMs(date, Number(at.slice(0, 2)), Number(at.slice(3, 5)));
}

/**
 * 구독 실행 하나를 만들고 예약 작업을 켠다 — 실행 기록(running/remote, jobId, 마감)을 먼저 적고 트리거를 쏜다.
 * 호출이 실패하면 그 자리에서 error. until은 지금(트리거 시각) — 세션이 수집한 범위와 기록이 어긋나면 다음 회차의 since가 틀린다
 */
export async function createJob(args: { ownerId: number; slot: Slot; editionDate: string; deadlineAt: number; now?: number }): Promise<RunRow> {
  const now = args.now ?? Date.now();
  const run = db
    .insert(briefingRuns)
    .values({
      ownerId: args.ownerId,
      trigger: 'subscription',
      slot: args.slot,
      editionDate: args.editionDate,
      status: 'running',
      stage: 'remote',
      jobId: randomUUID(),
      deadlineAt: args.deadlineAt,
      sinceAt: nextSinceAt(args.ownerId, now),
      untilAt: now,
      startedAt: now,
    })
    .returning()
    .get();
  openRemoteLive(run.id);
  // 수집 목록 문서가 틀리면 트리거 없이 error — 켜 놓고 지시서에서 터지면 세션이 빈손으로 끝난다(설계 "충돌 — 수집 목록 문서가 잘못된 경우")
  const badDoc = sourcesDocProblem(args.ownerId);
  if (badDoc) {
    closeSubscriptionRun(run.id, 'error', `수집 목록 문서가 잘못되어 예약 작업을 켜지 않았어요 — ${badDoc}`);
    return db.select().from(briefingRuns).where(eq(briefingRuns.id, run.id)).get() ?? run;
  }
  const fired = await fireTrigger(args.ownerId, `BRIEFING_JOB_ID=${run.jobId} — docvault 뉴스 브리핑 회차를 만들 차례입니다. briefing-subscription 스킬을 실전 모드로 실행하세요.`);
  if (!fired.ok) {
    closeSubscriptionRun(run.id, 'error', `예약 작업을 켜지 못했어요 — ${fired.reason}`);
    console.log(`[briefing] 구독 트리거 실패 run ${run.id}: ${fired.reason}`);
  }
  return db.select().from(briefingRuns).where(eq(briefingRuns.id, run.id)).get() ?? run;
}

/** API-151 — 지시서. 받아 가면 remote_started_at을 찍는다(두 번 받아도 같은 지시서) */
export function instructionFor(run: RunRow, now = Date.now()): Instruction {
  if (run.status !== 'running' || !run.jobId) throw new JobError(409, 'BRIEFING_JOB_CLOSED', '이 구독 실행은 이미 닫혔어요');
  const doc = sourcesDocOrClose(run);
  const prev = readPrevious(prevOkFileId(run.ownerId));
  const prevStories: PrevStoryRef[] = [];
  for (const [subId, list] of prev.storiesBySub) for (const p of list) prevStories.push({ subId, ...p });
  if (!run.remoteStartedAt) {
    db.update(briefingRuns).set({ remoteStartedAt: now }).where(and(eq(briefingRuns.id, run.id), eq(briefingRuns.status, 'running'))).run();
    addLog(openRemoteLive(run.id), '예약 작업이 지시서를 받아 갔어요', now);
  }
  return buildInstruction({ jobId: run.jobId, slot: run.slot, since: run.sinceAt, until: run.untilAt, deadline: run.deadlineAt ?? run.untilAt + BRIEFING.SUB_LEAD_MS + BRIEFING.SUB_DEADLINE_AFTER_MS, doc, excludeUrls: prev.urls, prevStories, config: MODEL_CONFIG });
}

/** 수집 목록 문서를 읽어 틀린 점을 돌려준다(없으면 null) — 트리거 전 검사용 */
function sourcesDocProblem(ownerId: number): string | null {
  try {
    loadSourcesDoc(ownerId);
    return null;
  } catch (e) {
    if (e instanceof SourcesError) return e.message;
    throw e;
  }
}

/** 지시서·완성본 검사가 쓰는 수집 목록 — 트리거 뒤 문서가 고장 났으면(90분 창 안의 편집) 실행을 error로 닫고 세션에는 "닫혔다"로 답한다 */
function sourcesDocOrClose(run: RunRow) {
  try {
    return loadSourcesDoc(run.ownerId).doc;
  } catch (e) {
    if (!(e instanceof SourcesError)) throw e;
    closeSubscriptionRun(run.id, 'error', `수집 목록 문서가 잘못되어 실행을 닫았어요 — ${e.message}`);
    throw new JobError(409, 'BRIEFING_JOB_CLOSED', `수집 목록 문서가 잘못되어 이 실행을 닫았어요 — ${e.message}`);
  }
}

/** 직전 회차 — 끝 시각이 가장 늦은 ok 실행. 지시서(excludeUrls·prevStories)와 완성본 검사(excludeUrls·prevStoryId)가 같은 회차를 보게 한 곳에서 고른다 */
function prevOkFileId(ownerId: number): number | null {
  return db.select({ fileId: briefingRuns.fileId }).from(briefingRuns).where(and(eq(briefingRuns.ownerId, ownerId), eq(briefingRuns.status, 'ok'))).orderBy(desc(briefingRuns.untilAt)).get()?.fileId ?? null;
}

/** 화면 [진행 기록]에 들어가는 한 줄 — 제어문자는 지우고 길이를 맞춘다. 진행 보고와 완성본 log가 같은 손질을 거친다 */
function cleanLogLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, BRIEFING.SUB_PROGRESS_MAX_CHARS);
}

/** API-152 — 진행 보고 한 줄. 줄은 자르고 제어문자는 지운다. DB의 stage는 remote 그대로, 세부 단계는 메모리에만 */
export function recordProgress(run: RunRow, body: { text: string; stage?: RemoteStage; done?: number; total?: number }, now = Date.now()): void {
  if (run.status !== 'running') throw new JobError(409, 'BRIEFING_JOB_CLOSED', '이 구독 실행은 이미 닫혔어요');
  const live = openRemoteLive(run.id);
  const text = cleanLogLine(body.text);
  if (text) addLog(live, text, now);
  if (body.stage || body.done !== undefined || body.total !== undefined) {
    setRemoteStage(live, body.stage ?? null, body.done ?? live.remote?.done ?? 0, body.total ?? live.remote?.total ?? 0);
    db.update(briefingRuns).set({ progressDone: body.done ?? live.remote?.done ?? 0, progressTotal: body.total ?? live.remote?.total ?? 0 }).where(and(eq(briefingRuns.id, run.id), eq(briefingRuns.status, 'running'))).run();
  }
}

/** 완성본 기사 → 조립 입력. related는 언론사마다 하나, 대표 언론사·포털 재게재는 빼고 MAX_RELATED까지(서버 otherOutlets와 같은 규칙) */
function toDraft(it: ResultItem, knownStoryIds: ReadonlySet<string>): ItemDraft {
  const seen = new Set([it.source.trim().toLowerCase()]);
  const related: { source: string; url: string }[] = [];
  for (const r of it.related) {
    const key = r.source.trim().toLowerCase();
    if (r.url === it.url || isAggregator(r.source) || seen.has(key)) continue;
    seen.add(key);
    related.push({ source: r.source, url: r.url });
  }
  const written = it.importance >= 2;
  return {
    subId: it.subId,
    // 직전 회차에 없는 사건 id는 새 사건으로 — 세션이 지어낸 id가 "갱신됨"으로 남으면 사건 이어 보기가 깨진다(서버 select와 같은 규칙)
    prevStoryId: it.prevStoryId && knownStoryIds.has(it.prevStoryId) ? it.prevStoryId : null,
    item: {
      title: it.title,
      summary: it.summary,
      why: it.why,
      importance: it.importance,
      source: it.source,
      url: it.url,
      publishedAt: it.publishedAt,
      basis: it.basis,
      related: related.slice(0, BRIEFING.MAX_RELATED),
      outlets: 1 + related.length,
      originalTitle: it.originalTitle,
      ...(it.sources.length ? { sources: it.sources } : {}),
      ...(written ? { summaryFrom: it.summaryFrom, whyFrom: it.whyFrom, blocks: it.blocks } : {}),
      ...(it.sides ? { sides: it.sides } : {}),
      ...(it.lenses ? { lenses: it.lenses } : {}),
      ...(it.w5 && Object.keys(it.w5).length ? { w5: it.w5 } : {}),
      ...(it.impact?.length ? { impact: it.impact } : {}),
      ...(it.explain?.length ? { explain: it.explain } : {}),
      ...(it.readUrl ? { readUrl: it.readUrl } : {}),
      ...(it.changed ? { changed: it.changed } : {}),
      ...(it.titleOnly ? { titleOnly: true } : {}),
    },
  };
}

/** missing 뒤 늦게 온 완성본을 받아도 되나 — 그 실행 뒤에 시작된 ok·running 실행이 하나도 없을 때만 (대체·다음 회차를 한 조회로 막는다).
    running도 막는 이유: [지금 만들기]가 돌고 있는데 늦은 완성본을 받으면 같은 시간대 회차가 둘 생긴다 */
function laterRunBlocks(run: RunRow): boolean {
  return !!db
    .select({ id: briefingRuns.id })
    .from(briefingRuns)
    .where(and(eq(briefingRuns.ownerId, run.ownerId), inArray(briefingRuns.status, ['ok', 'running']), gt(briefingRuns.startedAt, run.startedAt)))
    .get();
}

/**
 * API-153 — 완성본. 형식(zod) → 기사마다 주소·범위·중복 검사 → 30% 넘게 빠지면 거절 → 조립 → 파일 + 기록 ok 한 트랜잭션.
 * 거절(400·422)은 응답만 내고 실행은 running 그대로 — 스킬이 고쳐 다시 보낸다. 같은 job에 다시 오면 같은 fileId(멱등)
 */
export function acceptResult(run: RunRow, body: unknown, now = Date.now()): { fileId: number; itemCount: number; dropped: Record<string, number>; already: boolean } {
  if (run.status === 'ok' && run.fileId) {
    const dropped = parseDropped(run.droppedItems);
    return { fileId: run.fileId, itemCount: run.itemCount, dropped, already: true };
  }
  if (run.status === 'missing') {
    if (laterRunBlocks(run)) throw new JobError(409, 'BRIEFING_JOB_CLOSED', '그 뒤에 다른 회차가 만들어져 이 완성본은 받지 않아요');
  } else if (run.status !== 'running') {
    throw new JobError(409, 'BRIEFING_JOB_CLOSED', '이 구독 실행은 이미 닫혔어요');
  }
  if (!run.remoteStartedAt) throw new JobError(409, 'BRIEFING_JOB_CLOSED', '지시서를 받아 간 적이 없는 실행이에요');

  const parsed = ResultSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.map((p) => String(p)).join('.') ?? '';
    throw new JobError(400, 'VALIDATION_ERROR', `${where}: ${issue?.message ?? '형식 오류'}`);
  }
  const result: JobResult = parsed.data;
  if (result.items.length === 0) throw new JobError(422, 'BRIEFING_JOB_REJECTED', '기사가 하나도 없는 완성본은 받지 않아요', { dropped: {} });
  const doc = sourcesDocOrClose(run);
  const { allowedDomains } = buildInstruction({ jobId: run.jobId ?? '', slot: run.slot, since: run.sinceAt, until: run.untilAt, deadline: 0, doc, excludeUrls: [], prevStories: [], config: MODEL_CONFIG });
  const prev = readPrevious(prevOkFileId(run.ownerId));
  const { kept, dropped } = checkItems(result.items, { allowedDomains, excludeUrls: prev.urls, since: run.sinceAt, until: run.untilAt, knownSubIds: new Set(SUBS.map((s) => s.id)) });
  if (tooManyDropped(result.items.length, kept.length)) {
    throw new JobError(422, 'BRIEFING_JOB_REJECTED', `검사에서 뺀 기사가 ${result.items.length - kept.length}/${result.items.length}건 — ${BRIEFING.SUB_DROP_REJECT_RATIO * 100}%를 넘어 받지 않아요`, { dropped });
  }
  const knownStoryIds = new Set<string>();
  for (const list of prev.storiesBySub.values()) for (const p of list) knownStoryIds.add(p.storyId);
  const unknownPrev = kept.filter((it) => it.prevStoryId && !knownStoryIds.has(it.prevStoryId)).length;

  const s = result.stats;
  const edition: Edition = layoutEdition(
    kept.map((it) => toDraft(it, knownStoryIds)),
    { slot: run.slot, since: run.sinceAt, until: run.untilAt, createdAt: now },
    { sources: s.sources, sourcesFailed: s.sourcesFailed, candidates: s.candidates, attached: s.attached, bodiesRead: s.bodiesRead, fromFeed: s.fromFeed, extractRejected: s.extractRejected, webFilled: s.webFilled, lensDrops: s.lensDrops, wouldMerge: s.wouldMerge },
    { numberDrops: s.numberDrops, demoted: s.demoted, overruns: s.overruns, impactDrops: s.impactDrops, explainDrops: s.explainDrops, titleMismatch: s.titleMismatch },
    { usd: 0, haiku: { input: 0, output: 0 }, sonnet: { input: 0, output: 0 }, opus: { input: 0, output: 0 }, webSearches: 0 },
    undefined,
    { mode: 'subscription', ...(result.generator.config ? { config: result.generator.config } : {}), ...(result.generator.models ? { models: result.generator.models } : {}), ...(result.generator.skillVersion ? { skillVersion: result.generator.skillVersion } : {}) },
  );

  const saved = db.transaction((tx) => {
    // 저장 직전에 "아직 받아도 되는 상태인가"를 다시 본다 — 그사이 [지금 만들기]·방식 변경으로 닫혔으면 파일을 만들지 않는다
    const cur = tx.select({ status: briefingRuns.status }).from(briefingRuns).where(eq(briefingRuns.id, run.id)).get();
    if (!cur || (cur.status !== 'running' && cur.status !== 'missing')) return null;
    const file = saveEdition(tx, run.ownerId, edition);
    tx.update(briefingRuns)
      .set({
        status: 'ok',
        stage: 'remote',
        progressDone: 1,
        progressTotal: 1,
        fileId: file.fileId,
        itemCount: edition.stats.items,
        sourceCount: s.sources,
        failedSources: JSON.stringify(s.failedSources),
        candidateCount: s.candidates,
        leadIds: JSON.stringify(edition.lead ?? []),
        droppedItems: JSON.stringify(dropped),
        generator: JSON.stringify(edition.edition.generator ?? { mode: 'subscription' }),
        message: null,
        finishedAt: now,
      })
      .where(eq(briefingRuns.id, run.id))
      .run();
    return file;
  });
  if (!saved) throw new JobError(409, 'BRIEFING_JOB_CLOSED', '이 구독 실행은 그사이 닫혔어요');
  const live = openRemoteLive(run.id);
  for (const line of result.log) addLog(live, cleanLogLine(line), now);
  if (unknownPrev) addLog(live, `직전 회차에 없는 사건 id ${unknownPrev}건은 새 사건으로 바꿨어요`, now);
  closeLive(run.id);
  console.log(`[briefing] ${edition.edition.date} ${edition.edition.label} ok(구독) ${edition.stats.items}건 ${Math.round((now - run.startedAt) / 60_000)}분 → ${saved.name}`);
  return { fileId: saved.fileId, itemCount: edition.stats.items, dropped, already: false };
}

function parseDropped(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

// ---- 스케줄러 쪽 (schedule.ts가 1분마다 부른다) ----

/**
 * 하루 한 번 규칙 — 이 관리자·날짜·회차에 자동(auto) 또는 구독 행이 있나. 방식을 바꾼 날 같은 회차가 두 번 생기지 않게 둘 다 본다(API 스케줄러도 이 함수).
 * 단, ok 실행의 회차 문서가 휴지통에 있으면(사용자가 지웠으면) 없는 것으로 — "지우면 다시 만들 수 있게"(사용자 결정 2026-10-31, 시험용).
 * missing·error·cancelled는 문서가 없어도 그대로 막는다(실패 뒤 되풀이하지 않는다)
 */
export function hasRunFor(ownerId: number, date: string, slot: Slot): boolean {
  const rows = db
    .select({ status: briefingRuns.status, fileId: briefingRuns.fileId })
    .from(briefingRuns)
    .where(and(eq(briefingRuns.ownerId, ownerId), eq(briefingRuns.editionDate, date), eq(briefingRuns.slot, slot), inArray(briefingRuns.trigger, ['auto', 'subscription'])))
    .all();
  return rows.some((r) => {
    if (r.status !== 'ok' || !r.fileId) return true;
    const f = db.select({ deletedAt: files.deletedAt }).from(files).where(eq(files.id, r.fileId)).get();
    return !!f && f.deletedAt === null;
  });
}

function recordMissing(ownerId: number, slot: Slot, editionDate: string, deadlineAt: number, message: string, now: number): void {
  db.insert(briefingRuns)
    .values({ ownerId, trigger: 'subscription', slot, editionDate, status: 'missing', stage: 'remote', deadlineAt, message, sinceAt: now, untilAt: now, startedAt: now, finishedAt: now })
    .run();
}

/** 마감이 지난 running 구독 실행 → missing. 방식·자동 켬과 무관하게 매 틱 — 돌던 중 자동을 꺼도 닫혀야 한다 */
export function sweepExpiredSubscriptionRuns(now = Date.now()): void {
  for (const r of db.select({ id: briefingRuns.id }).from(briefingRuns).where(and(eq(briefingRuns.status, 'running'), eq(briefingRuns.trigger, 'subscription'), lte(briefingRuns.deadlineAt, now))).all()) {
    closeSubscriptionRun(r.id, 'missing', '마감까지 완성본이 오지 않았어요');
  }
}

/** 구독 모드에서 "다음 자동"은 트리거 시각(회차 시작 − 리드) — 트리거와 시작 사이에는 다음 회차의 트리거를 가리킨다 */
export function nextTrigger(schedule: AutoSchedule, now: number, ownerId: number): { at: number; slot: AutoSlot } | null {
  const slots = BRIEFING.AUTO_SLOTS.map((s) => s.slot).filter((slot) => schedule[slot].on);
  if (slots.length === 0) return null;
  for (const dayOffset of [0, 1, 2]) {
    const date = kstParts(now + dayOffset * 24 * 60 * 60 * 1000).date;
    for (const slot of slots) {
      const at = oneSlotStart(schedule, slot, date) - BRIEFING.SUB_LEAD_MS;
      // 그날 그 회차가 이미 있으면(시험으로 먼저 만든 경우) 틱도 안 켜므로 "다음"에서도 뺀다 — 첫 실전에서 18:20을 가리켰지만 켜지지 않았다(2026-10-31)
      if (at > now && !hasRunFor(ownerId, date, slot)) return { at, slot };
    }
  }
  return null;
}

/**
 * 구독 모드 관리자 한 명의 1분 틱 — 켜진 회차마다 "시작 − 리드 90분"에 트리거, "시작 + 30분"이 마감.
 * 서버가 꺼져 있다 켜지면 마감 60분 전까지만 늦게라도 트리거하고, 그보다 늦으면 missing 행을 만든다("안 왔다"가 기록에 남게).
 * 다른 구독 실행이 아직 running이면 다음 분에 다시 본다. 실패·missing 뒤 같은 회차는 다시 켜지 않는다
 */
export async function tickSubscription(ownerId: number, scheduleText: string | null, now = Date.now()): Promise<void> {
  const schedule = parseSchedule(scheduleText);
  // 설정을 바꾼 시각 — 그 전에 트리거 시각이 지난 회차는 "놓친 것"이 아니다(저녁에 구독을 켰다고 아침·점심이 missing으로 쌓이면 안 된다).
  // 설정 저장이면 무엇이든 이 시각이 바뀌므로, 서버가 꺼져 있던 사이에 설정을 건드린 드문 경우는 missing이 기록되지 않는다(감수)
  const settingsChangedAt = settingsOf(ownerId)?.updatedAt ?? 0;
  // 오늘과 "지금 + 리드"의 날짜 — 00:30 회차는 전날 23:00에 켜야 하므로 날짜를 넘겨 본다
  const dates = [...new Set([kstParts(now).date, kstParts(now + BRIEFING.SUB_LEAD_MS).date])];
  for (const date of dates) {
    for (const def of BRIEFING.AUTO_SLOTS) {
      const slot = def.slot;
      if (!schedule[slot].on) continue;
      const start = oneSlotStart(schedule, slot, date);
      const triggerAt = start - BRIEFING.SUB_LEAD_MS;
      const deadlineAt = start + BRIEFING.SUB_DEADLINE_AFTER_MS;
      if (now < triggerAt || hasRunFor(ownerId, date, slot)) continue;
      const enabledBeforeTrigger = settingsChangedAt <= triggerAt;
      if (now >= deadlineAt) {
        if (enabledBeforeTrigger) recordMissing(ownerId, slot, date, deadlineAt, '예약 작업을 켜지 못한 채 마감이 지났어요(서버가 꺼져 있었을 수 있어요)', now);
        continue;
      }
      if (now > deadlineAt - BRIEFING.SUB_MIN_LEAD_MS) {
        if (enabledBeforeTrigger) recordMissing(ownerId, slot, date, deadlineAt, `마감까지 ${BRIEFING.SUB_MIN_LEAD_MS / 60_000}분이 안 남아 예약 작업을 켜지 않았어요`, now);
        continue;
      }
      if (runningSubscriptionRun(ownerId)) return;
      await createJob({ ownerId, slot, editionDate: date, deadlineAt, now });
      return;
    }
  }
}

/** 구독 모드에서 "다음 자동"은 트리거 시각 — 회차 시작 − 리드 */
export function triggerTimesOf(schedule: AutoSchedule): Partial<Record<AutoSlot, string>> {
  const out: Partial<Record<AutoSlot, string>> = {};
  for (const def of BRIEFING.AUTO_SLOTS) {
    if (!schedule[def.slot].on) continue;
    const at = schedule[def.slot].at;
    const minutes = Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5)) - BRIEFING.SUB_LEAD_MS / 60_000;
    const m = ((minutes % 1440) + 1440) % 1440;
    out[def.slot] = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  return out;
}

// ---- 연결 확인 (ping) — 회차가 아니라 실행 기록에 두지 않고 메모리에만, 결과만 설정에 남긴다 ----

const pings = new Map<string, { ownerId: number; at: number }>();

function sweepPings(now: number): void {
  for (const [id, p] of pings) if (now - p.at > BRIEFING.SUB_PING_TTL_MS) pings.delete(id);
}

export function readLastPing(userId: number): { at: number; result: PingResult } | null {
  const raw = settingsOf(userId)?.briefingLastPing;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { at?: number; result?: PingResult };
    return typeof v.at === 'number' && v.result ? { at: v.at, result: v.result } : null;
  } catch {
    return null;
  }
}

/** ping 결과는 설정 행에 적지만 updated_at은 건드리지 않는다 — 그 시각은 tickSubscription이 "설정을 바꾼 때"로 쓴다(검수 2026-10-30) */
function writeLastPing(userId: number, result: PingResult, now: number): void {
  const value = JSON.stringify({ at: now, result });
  const changed = db.update(userSettings).set({ briefingLastPing: value }).where(eq(userSettings.userId, userId)).run().changes;
  if (!changed) upsertSettings(userId, { briefingLastPing: value }, now);
}

/** API-144 — ping job을 만들고 트리거를 쏜다. 세션이 지시서를 받아 가면 ok */
export async function createPing(userId: number, now = Date.now()): Promise<string> {
  sweepPings(now);
  const id = `${BRIEFING.SUB_PING_ID_PREFIX}${randomUUID()}`;
  pings.set(id, { ownerId: userId, at: now });
  const fired = await fireTrigger(userId, `BRIEFING_JOB_ID=${id} — docvault 연결 확인입니다. briefing-subscription 스킬을 실행하면 지시서만 받고 바로 끝납니다.`);
  if (!fired.ok) {
    pings.delete(id);
    writeLastPing(userId, 'trigger_failed', now);
    throw new JobError(502, 'BRIEFING_TRIGGER_FAILED', `예약 작업을 켜지 못했어요 — ${fired.reason}`);
  }
  writeLastPing(userId, 'fired', now);
  return id;
}

/** 지시서 요청이 ping이었나 — 맞으면 결과를 적고 ping을 지운다 */
export function resolvePing(jobId: string, userId: number, now = Date.now()): boolean {
  sweepPings(now);
  const p = pings.get(jobId);
  if (!p || p.ownerId !== userId) return false;
  pings.delete(jobId);
  writeLastPing(userId, 'ok', now);
  return true;
}

/** 열쇠가 틀린 요청이 왔다 — 기다리는 ping이 있으면 그 주인에게 "열쇠가 맞지 않습니다" */
export function notePingAuthFailure(now = Date.now()): void {
  sweepPings(now);
  for (const [id, p] of pings) {
    pings.delete(id);
    writeLastPing(p.ownerId, 'token_invalid', now);
  }
}

// ---- 설정 화면용 요약 (API-131·143) ----

export type SubscriptionSummary = {
  mode: BriefingMode;
  tokenPrefix: string | null;
  tokenCreatedAt: number | null;
  tokenLastUsedAt: number | null;
  triggerSet: boolean;
  triggerBroken: boolean;
  lastPingAt: number | null;
  lastPingResult: PingResult | 'no_request' | null;
};

export function subscriptionSummary(userId: number, now = Date.now()): SubscriptionSummary {
  const s = settingsOf(userId);
  const trigger = readTrigger(userId);
  const ping = readLastPing(userId);
  // 켰는데 5분 동안 지시서 요청이 없으면 네트워크 허용 목록부터 의심
  const result = ping?.result === 'fired' && now - ping.at > BRIEFING.SUB_PING_NO_REQUEST_MS ? 'no_request' : (ping?.result ?? null);
  return {
    mode: s?.briefingMode ?? DEFAULT_USER_SETTINGS.briefingMode,
    tokenPrefix: s?.briefingTokenPrefix ?? null,
    tokenCreatedAt: s?.briefingTokenCreatedAt ?? null,
    tokenLastUsedAt: s?.briefingTokenLastUsedAt ?? null,
    triggerSet: trigger !== null && trigger !== 'broken',
    triggerBroken: trigger === 'broken',
    lastPingAt: ping?.at ?? null,
    lastPingResult: result,
  };
}

/** 오늘 받지 못한 구독 회차 — 마감까지 안 온 것(missing)과 예약 작업을 켜지 못한 것(error), 아직 대체되지 않은 것만. 패널의 알림 띠(설계 결함 표 "트리거 호출 실패 → 알림 띠") */
export function missingToday(userId: number, now = Date.now()): { runId: number; slot: Slot; deadlineAt: number | null; status: 'missing' | 'error'; message: string | null } | null {
  const date = kstParts(now).date;
  const rows = db
    .select()
    .from(briefingRuns)
    .where(and(eq(briefingRuns.ownerId, userId), eq(briefingRuns.editionDate, date), eq(briefingRuns.trigger, 'subscription'), inArray(briefingRuns.status, ['missing', 'error'])))
    .orderBy(desc(briefingRuns.startedAt))
    .all();
  for (const r of rows) if (!laterRunBlocks(r)) return { runId: r.id, slot: r.slot, deadlineAt: r.deadlineAt, status: r.status === 'error' ? 'error' : 'missing', message: r.message };
  return null;
}

/** 최근 SUB_RECENT_RUNS회 구독 실행 — 성공·도착 안 함·실패 수, 평균 소요, 시각 조정 힌트 */
export function recentSubscription(userId: number): { ok: number; missing: number; error: number; avgMinutes: number | null; hint: 'later' | 'earlier' | null } {
  const rows = db
    .select()
    .from(briefingRuns)
    .where(and(eq(briefingRuns.ownerId, userId), eq(briefingRuns.trigger, 'subscription'), inArray(briefingRuns.status, ['ok', 'missing', 'error', 'cancelled'])))
    .orderBy(desc(briefingRuns.startedAt))
    .limit(BRIEFING.SUB_RECENT_RUNS)
    .all();
  const ok = rows.filter((r) => r.status === 'ok');
  const missing = rows.filter((r) => r.status === 'missing').length;
  const error = rows.filter((r) => r.status === 'error').length;
  // 걸린 시간은 지시서를 받아 간 때부터 — 패널의 실행 기록 줄과 같은 기준
  const durations = ok.filter((r) => r.finishedAt).map((r) => (r.finishedAt! - (r.remoteStartedAt ?? r.startedAt)) / 60_000);
  const avgMinutes = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  let hint: 'later' | 'earlier' | null = null;
  const leadMin = BRIEFING.SUB_LEAD_MS / 60_000;
  const tight = ok.some((r) => r.finishedAt && r.deadlineAt && r.deadlineAt - r.finishedAt < BRIEFING.SUB_HINT_EARLIER_MARGIN_MS);
  if (missing >= BRIEFING.SUB_HINT_EARLIER_MISSING || tight) hint = 'earlier';
  else if (avgMinutes !== null && avgMinutes < leadMin * BRIEFING.SUB_HINT_LATER_RATIO) hint = 'later';
  return { ok: ok.length, missing, error, avgMinutes, hint };
}

/** 구독 모드이고 자동 생성을 켠 관리자들 — 스케줄러가 매분 부른다 */
export function subscriptionOwners(): { id: number; schedule: string | null }[] {
  return db
    .select({ id: users.id, schedule: userSettings.briefingSchedule })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(eq(users.role, 'admin'), eq(users.isActive, 1), eq(userSettings.briefingAuto, 1), eq(userSettings.briefingMode, 'subscription')))
    .all();
}
