import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { BRIEFING, DEFAULT_USER_SETTINGS } from '../constants.js';
import { db } from '../db/index.js';
import { briefingRuns, files, userSettings } from '../db/schema.js';
import {
  BriefingBudgetError,
  BriefingBusyError,
  isConfigured,
  listRuns,
  monthCostUsd,
  runningRun,
  startRun,
  toRunDto,
} from '../lib/briefing/run.js';
import { nextSlotStart } from '../lib/briefing/time.js';
import { fail } from '../lib/errors.js';
import { jsonBody } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// API-131~134 뉴스 브리핑 — 관리자 전용(LLM 요금을 내는 사람). 회차 문서 자체는 파일 API가 다룬다.
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
    const recent = db
      .select({ fileId: files.id, name: files.name, slot: briefingRuns.slot, editionDate: briefingRuns.editionDate, itemCount: briefingRuns.itemCount, costUsd: briefingRuns.costUsd })
      .from(briefingRuns)
      .innerJoin(files, eq(files.id, briefingRuns.fileId))
      .where(and(eq(briefingRuns.ownerId, user.id), eq(briefingRuns.status, 'ok'), isNull(files.deletedAt)))
      .orderBy(desc(briefingRuns.startedAt))
      .limit(BRIEFING.RECENT_EDITIONS)
      .all();
    return c.json({
      configured: isConfigured(),
      autoEnabled: auto,
      nextAutoAt: auto ? nextSlotStart(Date.now()) : null,
      running: running ? toRunDto(running) : null,
      last: last ? toRunDto(last) : null,
      monthCostUsd: monthCostUsd(user.id),
      monthBudgetUsd: BRIEFING.MONTHLY_BUDGET_USD,
      recent,
    });
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
