import { EDGE_FILL_KEY, EDGE_PATH } from './constants';
import { IS_TOUCH } from './device';

// 화면 가장자리 시험(IA — 화면 가장자리 2026-11-20) — 시험 입구로 열었는지, "오른쪽 여백까지 넓히기"를 켰는지.
// 기기별 취향·시험이라 서버 설정이 아니라 localStorage에 둔다

/** 이번 실행이 시험 입구(/edge)에서 시작됐는가 — 문서를 열면 주소가 바뀌므로 시작할 때 한 번 적어 둔다 */
export const STARTED_FROM_EDGE = location.pathname === EDGE_PATH;

export function getEdgeFill(): boolean {
  try {
    return localStorage.getItem(EDGE_FILL_KEY) === '1';
  } catch {
    return false;
  }
}

/** index.css의 --sa-pad-right가 이 속성을 보고 0이 된다 */
export function applyEdgeFill(on: boolean): void {
  if (on) document.documentElement.dataset.edgeFill = '1';
  else delete document.documentElement.dataset.edgeFill;
}

export function setEdgeFill(on: boolean): void {
  try {
    if (on) localStorage.setItem(EDGE_FILL_KEY, '1');
    else localStorage.removeItem(EDGE_FILL_KEY);
  } catch {
    /* 저장이 막혀도 이번 실행에는 적용한다 */
  }
  applyEdgeFill(on);
}

/** 앱이 화면 맨 위까지 덮고 있는가 — 앱이 받은 높이가 기기 화면의 그 방향 길이와 같으면 그렇다.
 *  보통 폰의 홈 화면 앱·브라우저는 상태 표시나 주소창만큼 짧아서 아니다. PC는 모서리가 각져서 보지 않는다 */
export function coversScreenTop(): boolean {
  if (!IS_TOUCH) return false;
  const landscape = window.innerWidth > window.innerHeight;
  // iOS는 기기를 돌려도 screen.width·height를 세로 기준으로 알려 준다 — 그래서 긴 쪽·짧은 쪽으로 고른다
  const side = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  return Math.abs(window.innerHeight - side) < 2;
}

/** index.css의 --corner-guard가 이 속성을 보고 켜진다. 접었다 펴거나 돌리면 달라지므로 크기가 바뀔 때마다 다시 본다 */
export function watchCornerGuard(): void {
  const update = () => {
    if (coversScreenTop()) document.documentElement.dataset.fullTop = '1';
    else delete document.documentElement.dataset.fullTop;
  };
  update();
  window.addEventListener('resize', update);
}

/** 기기가 가로로 내주지 않은 폭(px) — 기기 화면의 그 방향 길이에서 앱이 받은 폭을 뺀 값. 0이면 앱이 가로 끝까지 받았다.
 *  옆 띠가 있는 기기에서 "띠가 열렸는가"를 숫자로 가른다(눈으로는 띠가 앱 바탕색이라 구분되지 않는다) */
export function withheldWidth(): number {
  const landscape = window.innerWidth > window.innerHeight;
  const side = landscape ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  return Math.max(0, Math.round(side - window.innerWidth));
}
