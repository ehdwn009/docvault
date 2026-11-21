import { OUTLOOK } from '../../constants.js';
import { dueSlot } from './calendar.js';
import { autoPlan, startOutlookJob, sweepExpiredOutlookJobs } from './job.js';
import { seedOutlookEditions } from './seed.js';

// 세계 전망 시계 — 1분마다 마감 지난 실행을 닫고, 한국시간으로 그달 둘째·넷째 월요일 10시대면 그 판을 한 번 켠다 (사용자 결정 2026-11-21).
// 1월 둘째 월요일은 작은 판 대신 큰 판. 그 이름의 줄이 이미 있으면 다시 켜지 않는다 — 실패해도 자동 재시도 없음(사용량이 새지 않게)

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 끝난 판(켬·이미 있음·실패·읽을 것 없음)은 이 프로세스에서 다시 보지 않는다. 다른 실행이 도는 중이거나 트리거가 없던 판은
// 창 안에서 1분마다 다시 본다 — 그 실행이 끝나거나 관리자가 트리거를 넣으면 이 판도 돈다(로그는 한 번만)
const settled = new Set<string>();
const warned = new Set<string>();
let busy = false;

export function tickOutlook(now = Date.now()): void {
  sweepExpiredOutlookJobs(now);
  const slot = dueSlot(now);
  if (!slot || busy || settled.has(slot.label)) return;
  busy = true;
  startOutlookJob(autoPlan(slot, now), now)
    .then((r) => {
      if (r === 'running' || r === 'no_trigger') {
        if (!warned.has(slot.label)) console.log(`[outlook] ${slot.label} ${r === 'running' ? '다른 실행이 도는 중이라' : '예약 작업이 연결돼 있지 않아'} 기다려요`);
        warned.add(slot.label);
        return;
      }
      settled.add(slot.label);
      if (r === 'nothing') console.log(`[outlook] ${slot.label} 읽을 기간이 없어 건너뛰어요`);
    })
    .catch((e: unknown) => console.log(`[outlook] ${slot.label} 시작 오류: ${reasonOf(e)}`))
    .finally(() => {
      busy = false;
    });
}

export function startOutlookScheduler(): void {
  try {
    seedOutlookEditions();
  } catch (e) {
    console.log(`[outlook] 시드 오류: ${reasonOf(e)}`);
  }
  const tick = () => {
    try {
      tickOutlook();
    } catch (e) {
      console.log(`[outlook] scheduler error: ${reasonOf(e)}`);
    }
  };
  tick();
  setInterval(tick, OUTLOOK.TICK_MS);
}
