import { BRIEFING } from '../../constants.js';

// 한국시간 계산 — 서버 시계는 UTC다. 한국은 일광절약시간이 없어 +9시간 고정으로 충분하다

export type KstParts = { date: string; month: string; hour: number; minute: number };

export function kstParts(ms: number): KstParts {
  const d = new Date(ms + BRIEFING.KST_OFFSET_MS);
  const iso = d.toISOString(); // 2026-10-01T14:23:00.000Z (값은 이미 한국시간)
  return { date: iso.slice(0, 10), month: iso.slice(0, 7), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** 한국시간 날짜(YYYY-MM-DD)의 hour:minute 순간 → unix ms */
export function kstToMs(date: string, hour: number, minute: number): number {
  return Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - BRIEFING.KST_OFFSET_MS;
}

/** 이번 달(한국시간) 1일 0시 → unix ms — 월 비용 합계의 시작점 */
export function kstMonthStart(ms: number): number {
  return kstToMs(`${kstParts(ms).month}-01`, 0, 0);
}
