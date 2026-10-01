import { and, eq } from 'drizzle-orm';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { briefingRuns, users, userSettings } from '../../db/schema.js';
import type { AiCaller } from './ai.js';
import type { Slot } from './edition.js';
import { isConfigured, monthCostUsd, recordSkipped, runningRun, startRun } from './run.js';
import { kstParts, kstToMs } from './time.js';

// 자동 생성 — 1분마다 한국시간을 보고, 켜 둔 관리자의 그날 회차를 한 번씩 시작한다 (뉴스 브리핑 설계 "실행 관리").
// 시작 시각부터 2시간 안이면 늦게라도 돈다(서버가 06:30에 꺼져 있었어도 08:30 전에 켜지면).
// 실패한 회차는 다시 시도하지 않는다 — 매분 재시도하면 실패가 비용으로 불어난다. 버튼으로 만든다

/** 지금이 어느 자동 회차의 창(시작 ~ 시작+2시간) 안인가 */
export function activeSlot(now: number): Slot | null {
  const { date } = kstParts(now);
  for (const s of BRIEFING.AUTO_SLOTS) {
    const start = kstToMs(date, s.hour, s.minute);
    if (now >= start && now < start + BRIEFING.AUTO_CATCHUP_MS) return s.slot;
  }
  return null;
}

export function tickScheduler(now = Date.now(), ai?: AiCaller): void {
  if (!isConfigured()) return;
  const slot = activeSlot(now);
  if (!slot) return;
  const date = kstParts(now).date;
  const owners = db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(eq(users.role, 'admin'), eq(users.isActive, 1), eq(userSettings.briefingAuto, 1)))
    .all();
  for (const { id } of owners) {
    // 오늘 이 회차의 자동 실행 기록이 있으면(성공·실패·건너뜀 모두) 끝 — 하루 한 번
    const done = db
      .select({ id: briefingRuns.id })
      .from(briefingRuns)
      .where(and(eq(briefingRuns.ownerId, id), eq(briefingRuns.editionDate, date), eq(briefingRuns.slot, slot), eq(briefingRuns.trigger, 'auto')))
      .get();
    if (done) continue;
    // 다른 실행이 도는 중이면 다음 분에 다시 본다 (창 안에서 기다린다)
    if (runningRun()) return;
    if (monthCostUsd(id, now) >= BRIEFING.MONTHLY_BUDGET_USD) {
      recordSkipped(id, slot, `이번 달 한도($${BRIEFING.MONTHLY_BUDGET_USD})에 닿아 자동 생성을 건너뛰었어요`, now);
      continue;
    }
    startRun({ ownerId: id, trigger: 'auto', slot, ai, now });
    return; // 한 번에 하나 — 다음 관리자는 다음 분에
  }
}

export function startScheduler(): void {
  const tick = () => {
    try {
      tickScheduler();
    } catch (e) {
      console.log(`[briefing] scheduler error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  tick();
  setInterval(tick, BRIEFING.SCHEDULER_TICK_MS);
}
