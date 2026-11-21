import { OUTLOOK } from '../../constants.js';
import { kstParts, kstToMs } from '../briefing/time.js';

// 세계 전망의 날짜·판 이름 — 언제 자동 발행하나, 무엇을 읽나, 판을 뭐라 부르나 (사용자 결정 2026-11-21).
// 날짜는 전부 한국 달력 날짜('YYYY-MM-DD')다 — 읽는 기간은 시각이 아니라 하루 단위다

const DAY_MS = 24 * 60 * 60 * 1000;
const ORDINALS = ['첫째', '둘째', '셋째', '넷째', '다섯째'];
// 발행일은 한 달에 두 번이라 두 달 안에는 반드시 다음 것이 있다
const LOOKAHEAD_DAYS = 62;

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

const hm = (hhmm: string) => hhmm.split(':').map(Number) as [number, number];

export const bigLabel = (year: number) => `${year}년 세계 경제 전망`;

/** 큰 판이 읽는 기간 — 전년 9월 1일 ~ 12월 31일 */
export function bigWindow(year: number): { since: string; until: string } {
  return { since: `${year - 1}-${OUTLOOK.BIG_READ_FROM}`, until: `${year - 1}-${OUTLOOK.BIG_READ_TO}` };
}

/** 작은 판이 읽는 기간 — 게시된 판의 가장 늦은 until 다음 날 ~ 어제(하루를 다 채운 날까지). since > until이면 읽을 것이 없다 */
/** since~until의 날 수(양 끝 포함) */
export function daySpan(since: string, until: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) + 1;
}

export function smallWindow(lastUntil: string | null, now: number, throughToday = false): { since: string; until: string } {
  // 자동 판은 하루를 다 채운 어제까지, 관리자가 [지금 만들기]로 시킨 판은 오늘까지 — 배포한 날 바로 한 번 돌려 볼 수 있게
  const until = throughToday ? kstParts(now).date : addDays(kstParts(now).date, -1);
  return { since: lastUntil ? addDays(lastUntil, 1) : addDays(until, 1 - OUTLOOK.FIRST_WINDOW_DAYS), until };
}

/** 관리자가 [지금 만들기]로 만든 판의 이름(같은 날 두 번이면 뒤에 " (2)"를 붙이는 것은 부르는 쪽) */
export function manualLabel(now: number): string {
  const [y, m, d] = kstParts(now).date.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일 판`;
}

export type AutoSlot = { kind: 'big' | 'small'; year: number; label: string; at: number; endsAt: number };

/** 그 날짜가 자동 발행일(그달 둘째·넷째 월요일)이면 그 판. 1월 둘째 월요일은 작은 판 대신 큰 판 */
export function autoSlotOn(date: string): AutoSlot | null {
  if (new Date(`${date}T00:00:00Z`).getUTCDay() !== OUTLOOK.SCHEDULE.weekday) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const week = Math.ceil(d / 7);
  if (!(OUTLOOK.SCHEDULE.weeks as readonly number[]).includes(week)) return null;
  const [h, min] = hm(OUTLOOK.SCHEDULE.at);
  const big = m === OUTLOOK.BIG_MONTH && week === OUTLOOK.SCHEDULE.weeks[0];
  // 켜는 창은 그 시(10시대) 안 — 서버가 그 시각에 꺼져 있었다가 하루 뒤에 켜져도 지난 판을 뒤늦게 만들지 않는다
  return { kind: big ? 'big' : 'small', year: y, label: big ? bigLabel(y) : `${y}년 ${m}월 ${ORDINALS[week - 1]} 판`, at: kstToMs(date, h, min), endsAt: kstToMs(date, h + 1, 0) };
}

/** 지금이 자동 발행 창 안이면 그 판 */
export function dueSlot(now: number): AutoSlot | null {
  const slot = autoSlotOn(kstParts(now).date);
  return slot && now >= slot.at && now < slot.endsAt ? slot : null;
}

/** 창이 아직 끝나지 않은 다음 자동 발행들 — 가까운 것부터 */
export function* upcomingSlots(now: number): Generator<AutoSlot> {
  const today = kstParts(now).date;
  for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
    const slot = autoSlotOn(addDays(today, i));
    if (slot && slot.endsAt > now) yield slot;
  }
}
