// 동향 탭(SCR-195) 안의 「수출입 | 세계 전망」 전환 — 고른 것은 기기별 취향이라 localStorage에 둔다.
// 알림·읽는 칸이 열리는 쪽에서도 바꿀 수 있게(세계 전망 판을 열면 목록도 세계 전망으로) 이벤트로 알린다.

export type TrendMode = 'trade' | 'outlook';

const KEY = 'dv_trend_mode';
export const TREND_MODE_EVENT = 'dv:trend-mode';

// 저장이 막힌 기기(사생활 보호 창 등)에서도 이번 세션 동안은 고른 것이 유지되게 메모리에 먼저 둔다
let current: TrendMode | null = null;

export function getTrendMode(): TrendMode {
  if (current === null) {
    try {
      current = localStorage.getItem(KEY) === 'outlook' ? 'outlook' : 'trade';
    } catch {
      current = 'trade';
    }
  }
  return current;
}

export function setTrendMode(mode: TrendMode) {
  if (mode === getTrendMode()) return;
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 저장이 막혀도 이번 세션에는 적용한다 */
  }
  window.dispatchEvent(new Event(TREND_MODE_EVENT));
}
