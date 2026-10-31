// 기기 판정 한 곳 — CSS의 pc:/touch: 변형(index.css)과 같은 질문을 JS에서도 한다.
// 화면 너비가 아니라 "입력 방식"으로 가른다: 폰을 눕혀 넓어져도 터치 기기면 터치 UI를 유지.
// 기기 특성이라 실행 중 안 바뀌므로 한 번만 잰다 (IA — 모바일 재편).

const PC_QUERY = '(hover: hover) and (pointer: fine)';

/** 터치 기기(폰·태블릿)인가 */
export const IS_TOUCH = !window.matchMedia(PC_QUERY).matches;

/** 마우스·트랙패드 기기인가 — 문서 안 스크립트처럼 문자열로 심어야 할 때는 PC_MEDIA_QUERY를 쓴다 */
export const IS_PC = !IS_TOUCH;

export const PC_MEDIA_QUERY = PC_QUERY;
