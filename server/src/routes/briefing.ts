import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { BRIEFING, DEFAULT_USER_SETTINGS } from '../constants.js';
import { db } from '../db/index.js';
import { briefingRuns, userSettings } from '../db/schema.js';
import {
  BriefingBudgetError,
  BriefingBusyError,
  isConfigured,
  listRuns,
  monthCostUsd,
  nextSinceAt,
  runningRun,
  startRun,
  toRunDto,
} from '../lib/briefing/run.js';
import { clampDays, editionNav, listEditions } from '../lib/briefing/editions.js';
import { nextSlotStart } from '../lib/briefing/time.js';
import { fail } from '../lib/errors.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// API-131~136 뉴스 브리핑 — 관리자 전용(LLM 요금을 내는 사람). 회차 문서 자체는 파일 API가 다룬다.
// 설계: docs/design/뉴스브리핑_docvault_20261001.md

const adminGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') return fail(c, 403, 'FORBIDDEN', '관리자 전용입니다');
  return next();
});

function autoEnabled(userId: number): boolean {
  const row = db.select({ v: userSettings.briefingAuto }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return (row?.v ?? DEFAULT_USER_SETTINGS.briefingAuto) === 1;
}

export const briefingRoutes = new Hono<AppEnv>()
  .use('*', adminGuard)

  // API-131: 상태 — 패널이 실행 중에만 2초마다 다시 읽는다
  .get('/status', (c) => {
    const user = c.get('user');
    const auto = autoEnabled(user.id);
    const running = runningRun();
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
      nextAutoAt: auto ? nextSlotStart(Date.now()) : null,
      running: running ? toRunDto(running) : null,
      last: last ? toRunDto(last) : null,
      monthCostUsd: monthCostUsd(user.id),
      monthBudgetUsd: BRIEFING.MONTHLY_BUDGET_USD,
      nextSinceAt: nextSinceAt(user.id),
    });
  })

  // API-135: 회차 목록 — 패널의 오늘·지난 브리핑 (v0.43)
  .get('/editions', (c) => {
    const before = c.req.query('before') ?? null;
    if (before !== null && !/^\d{4}-\d{2}-\d{2}$/.test(before)) return fail(c, 400, 'VALIDATION_ERROR', 'before: YYYY-MM-DD 형식이어야 합니다');
    const user = c.get('user');
    return c.json(listEditions(user.id, user.id, before, clampDays(c.req.query('days'))));
  })

  // API-136: 이전·다음 회차와 같은 날 회차들 — 회차 화면의 ‹ ›·회차 칩 (v0.43)
  .get('/editions/:fileId/nav', (c) => {
    const fileId = parseId(c.req.param('fileId'));
    if (fileId === null) return fail(c, 400, 'VALIDATION_ERROR', 'fileId: 올바르지 않은 값');
    const user = c.get('user');
    const nav = editionNav(user.id, user.id, fileId);
    if (!nav) return fail(c, 404, 'NOT_FOUND', '회차가 없습니다');
    return c.json(nav);
  })

  // API-132: 만들기 시작 — 202로 곧바로 답하고 만드는 일은 뒤에서
  .post('/runs', jsonBody(z.object({ force: z.boolean().optional() })), (c) => {
    if (!isConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', 'API 키가 연결되지 않았어요');
    const { force } = c.req.valid('json');
    try {
      const run = startRun({ ownerId: c.get('user').id, trigger: 'manual', slot: 'adhoc', force });
      return c.json({ run: toRunDto(run) }, 202);
    } catch (e) {
      if (e instanceof BriefingBusyError) return c.json({ code: 'BRIEFING_RUNNING', message: e.message, run: toRunDto(e.run) }, 409);
      if (e instanceof BriefingBudgetError) {
        return c.json({ code: 'BRIEFING_BUDGET_EXCEEDED', message: e.message, monthCostUsd: e.monthCostUsd, monthBudgetUsd: BRIEFING.MONTHLY_BUDGET_USD }, 409);
      }
      throw e;
    }
  })

  // API-133: 실행 기록
  .get('/runs', (c) => {
    const raw = Number(c.req.query('limit') ?? BRIEFING.RUNS_LIST_DEFAULT);
    const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, BRIEFING.RUNS_LIST_MAX) : BRIEFING.RUNS_LIST_DEFAULT;
    return c.json({ runs: listRuns(c.get('user').id, limit).map(toRunDto) });
  })

  // API-134: 자동 생성 켜기/끄기 — 키 없이 켜 두면 매번 조용히 실패하므로 막는다 (자동 백업과 같은 이유)
  .put('/settings', jsonBody(z.object({ autoEnabled: z.boolean() })), (c) => {
    const { autoEnabled: on } = c.req.valid('json');
    if (on && !isConfigured()) return fail(c, 503, 'ASK_NOT_CONFIGURED', 'API 키가 연결되지 않았어요');
    const userId = c.get('user').id;
    const now = Date.now();
    db.insert(userSettings)
      .values({ ...DEFAULT_USER_SETTINGS, userId, briefingAuto: on ? 1 : 0, updatedAt: now })
      .onConflictDoUpdate({ target: userSettings.userId, set: { briefingAuto: on ? 1 : 0, updatedAt: now } })
      .run();
    return c.json({ autoEnabled: on, nextAutoAt: on ? nextSlotStart(now) : null });
  });
