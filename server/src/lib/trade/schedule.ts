import { TRADE } from '../../constants.js';
import { kstParts, kstToMs } from '../briefing/time.js';
import { backfill, checkPeriod, exclusive, isBusy } from './collect.js';
import { periodLabel, previousMonth } from './match.js';
import { notifyBackfill, notifyMissing, notifyReady } from './notify.js';
import { hasRelease, releaseCount } from './store.js';

// 수출입 동향 시계 — 1분마다 한국시간을 보고, 지난달 호가 아직 없으면 확인 창의 시각마다 한 번씩 게시판을 본다 (수출입 동향 설계 "언제 보나").
// 게시 시각을 모르므로 시각 하나에 걸지 않는다: 1일 11:10·13:00·18:00, 2~10일 매일 10:00. 서버가 그 시각에 꺼져 있었으면 켜진 뒤 첫 틱에 본다

type Slot = { period: string; at: number };

/** 지금 기준으로 가장 최근에 지난 확인 시각 — 확인 창 밖이면 null */
export function dueSlot(now: number): Slot | null {
  const { month, date } = kstParts(now);
  const day = Number(date.slice(8, 10));
  if (day > TRADE.LAST_DAY) return null;
  const toMs = (d: number, hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return kstToMs(`${month}-${String(d).padStart(2, '0')}`, h, m);
  };
  const times = [...TRADE.DAY1_CHECKS.map((t) => toMs(1, t))];
  for (let d = 2; d <= TRADE.LAST_DAY; d++) times.push(toMs(d, TRADE.LATER_CHECK));
  const passed = times.filter((t) => t <= now);
  return passed.length ? { period: previousMonth(month), at: passed[passed.length - 1]! } : null;
}

/** 못 찾았을 때 알릴 차례인가 — 4일 확인이 지났으면 "직접 확인", 1일 마지막 확인이 지났으면 "아직 안 올라옴". 그 전이면 조용히 다음 시각을 기다린다 */
function missingNotice(period: string, now: number, reason: string | null): void {
  const { month } = kstParts(now);
  const giveUp = kstToMs(`${month}-${String(TRADE.GIVE_UP_NOTICE_DAY).padStart(2, '0')}`, ...hm(TRADE.LATER_CHECK));
  const dayOneLast = kstToMs(`${month}-01`, ...hm(TRADE.DAY1_CHECKS[TRADE.DAY1_CHECKS.length - 1]!));
  const label = periodLabel(period).split(' ')[1];
  const why = reason ? ` 이유: ${reason}` : '';
  if (now >= giveUp) {
    notifyMissing({ dedupeKey: `trade:${period}:missing:d4`, title: `${label} 수출입 동향을 ${TRADE.GIVE_UP_NOTICE_DAY}일까지 못 찾았어요`, body: `산업통상부 게시판을 직접 확인해 주세요. ${TRADE.LAST_DAY}일까지는 매일 ${TRADE.LATER_CHECK}에 계속 봅니다.${why}` });
  } else if (now >= dayOneLast) {
    notifyMissing({ dedupeKey: `trade:${period}:missing:d1`, title: `${label} 수출입 동향이 아직 안 올라왔어요`, body: `1일 ${TRADE.DAY1_CHECKS.join('·')}에 확인했어요. 2일부터 매일 ${TRADE.LATER_CHECK}에 다시 봅니다.${why}` });
  }
}

const hm = (hhmm: string) => hhmm.split(':').map(Number) as [number, number];
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 기억은 메모리 — 재기동하면 마지막 지난 시각을 한 번 더 볼 수 있으나 해가 없다(알림은 dedupe로 한 번) */
const checkedAt = new Map<string, number>();
let backfillTried = false;

async function runCheck(slot: Slot, now: number): Promise<void> {
  try {
    const saved = await checkPeriod(slot.period, now);
    if (saved) {
      notifyReady(saved);
      console.log(`[trade] ${slot.period} 받음 → 파일 ${saved.fileId}`);
    } else {
      console.log(`[trade] ${slot.period} 아직 없음`);
      missingNotice(slot.period, Date.now(), null);
    }
  } catch (e) {
    console.log(`[trade] ${slot.period} 확인 실패: ${reasonOf(e)}`);
    missingNotice(slot.period, Date.now(), reasonOf(e));
  }
}

async function runBackfill(now: number): Promise<void> {
  try {
    const r = await backfill(now);
    notifyBackfill(r.saved);
    if (r.missing.length) {
      notifyMissing({
        dedupeKey: 'trade:backfill:missing',
        title: `지난 수출입 동향 중 ${r.missing.length}개월을 못 받았어요`,
        body: r.missing.map((m) => `${periodLabel(m.period)}: ${m.reason}`).join(' / '),
      });
    }
    console.log(`[trade] 소급 ${r.saved.length}개 받음, ${r.missing.length}개 못 받음`);
  } catch (e) {
    console.log(`[trade] 소급 실패: ${reasonOf(e)}`);
    notifyMissing({ dedupeKey: 'trade:backfill:failed', title: '지난 수출입 동향을 가져오지 못했어요', body: reasonOf(e) });
  }
}

export function tickTrade(now = Date.now()): void {
  if (isBusy()) return;
  // 표가 비어 있으면(처음 배포) 한 번 소급. 소급에서 일부를 못 받아도 다음 기동 때 다시 돌지 않는다 — 표가 비어 있지 않으므로
  if (!backfillTried) {
    backfillTried = true;
    if (releaseCount() === 0) {
      void exclusive(() => runBackfill(now));
      return;
    }
  }
  const slot = dueSlot(now);
  // 이미 받은 달이면 그 달의 남은 확인은 하지 않는다
  if (!slot || checkedAt.get(slot.period) === slot.at || hasRelease(slot.period)) return;
  checkedAt.set(slot.period, slot.at);
  void exclusive(() => runCheck(slot, now));
}

export function startTradeScheduler(): void {
  const tick = () => {
    try {
      tickTrade();
    } catch (e) {
      console.log(`[trade] scheduler error: ${reasonOf(e)}`);
    }
  };
  tick();
  setInterval(tick, TRADE.TICK_MS);
}
