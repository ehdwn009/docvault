// 앱 뼈대 레이아웃 — v0.54(안 B, 홈 중심)와 v0.53(안 A) 모습 사이의 스위치 (IA — 안 B 결정 1, Feedly Classic·VS Code 방식).
// 한 버전만 둔다: 사람들이 새 구조에 익숙해지면 지운다. 기기별 취향이라 localStorage.

export type AppLayout = 'home' | 'classic';

const KEY = 'dv_layout';
export const LAYOUT_EVENT = 'dv:layout';

export function getLayout(): AppLayout {
  try {
    return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'home';
  } catch {
    return 'home';
  }
}

export function setLayout(layout: AppLayout) {
  try {
    localStorage.setItem(KEY, layout);
  } catch {
    /* 저장이 막혀도 이번 세션에는 적용한다 */
  }
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}
