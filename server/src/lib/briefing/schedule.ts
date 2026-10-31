import { and, eq } from 'drizzle-orm';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { briefingRuns, users, userSettings } from '../../db/schema.js';
import type { AiCaller } from './ai.js';
import type { Slot } from './edition.js';
import { isConfigured, monthCostUsd, recordSkipped, runningRun, startRun } from './run.js';
import { activeTimers, parseSchedule, timerLabel } from './autoSchedule.js';
import { hasRunFor, subscriptionOwners, sweepExpiredSubscriptionRuns, tickSubscription } from './subscription.js';
import { kstParts } from './time.js';

// 자동 생성 — 1분마다 한국시간을 보고, 켜 둔 관리자의 그날 회차를 한 번씩 시작한다 (뉴스 브리핑 설계 "실행 관리").
// 회차마다 켜기·시각은 관리자마다 다르다(v0.43, autoSchedule.ts).
// 시작 시각부터 2시간 안이면 늦게라도 돈다(서버가 06:30에 꺼져 있었어도 08:30 전에 켜지면).
// 실패한 회차는 다시 시도하지 않는다 — 매분 재시도하면 실패가 비용으로 불어난다. 버튼으로 만든다

export function tickScheduler(now = Date.now(), ai?: AiCaller): void {
  // 마감 지난 구독 실행은 방식·자동 켬과 무관하게 닫는다 — 돌던 중에 자동을 끄면 아무도 닫지 않아 running이 영영 남았다(검토 2026-10-30)
  sweepExpiredSubscriptionRuns(now);
  // 구독 모드 관리자는 따로 — 트리거 시각·마감만 본다. 키가 없어도 돈다 (v0.50). 비동기지만 틱 안에서 기다리지 않는다(트리거 호출이 10초까지)
  for (const o of subscriptionOwners()) {
    tickSubscription(o.id, o.schedule, now).catch((e: unknown) => console.log(`[briefing] 구독 틱 오류: ${e instanceof Error ? e.message : String(e)}`));
  }
  if (!isConfigured()) return;
  const date = kstParts(now).date;
  // api 모드 관리자만 서버가 직접 만든다 — 구독으로 바꿨는데 API 생성이 함께 돌면 회차가 두 번 생긴다(비용 2배)
  const owners = db
    .select({ id: users.id, schedule: userSettings.briefingSchedule })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(eq(users.role, 'admin'), eq(users.isActive, 1), eq(userSettings.briefingAuto, 1), eq(userSettings.briefingMode, 'api')))
    .all();
  for (const { id, schedule } of owners) {
    // 창이 겹치면(시각을 가깝게 골랐을 때) 이른 회차부터 — 오늘 이 회차의 자동 실행 기록이 있으면(성공·실패·건너뜀 모두) 다음 회차, 하루 한 번
    // 하루 한 번 규칙은 구독과 같은 함수로(두 trigger를 함께, 휴지통에 간 회차는 없는 것으로)
    const timer = activeTimers(parseSchedule(schedule), now).find((t) => !hasRunFor(id, date, t.id));
    if (!timer) continue;
    const slot: Slot = timer.id;
    const label = timerLabel(timer);
    // 다른 실행이 도는 중이면 다음 분에 다시 본다 (창 안에서 기다린다)
    if (runningRun()) return;
    if (monthCostUsd(id, now) >= BRIEFING.MONTHLY_BUDGET_USD) {
      recordSkipped(id, slot, label, `이번 달 한도($${BRIEFING.MONTHLY_BUDGET_USD})에 닿아 자동 생성을 건너뛰었어요`, now);
      continue;
    }
    startRun({ ownerId: id, trigger: 'auto', slot, label, ai, now });
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
