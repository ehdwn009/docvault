// 화면 쪽 설계 상수. 서버가 zod로 같은 값을 검증하므로 server/src/constants.ts와 항상 같아야 한다.

/** 글자 크기 배율 범위(%) — 문서마다 기준 크기가 달라 절대 px가 아니라 배율로 다룬다.
    범위를 넓게 열어 둔 이유: 조작(⋯ 메뉴)이 배율을 먹는 본문 바깥에 있어 아무리 줄여도 되돌릴 수 있다 */
export const FONT_SCALE_MIN = 10;
export const FONT_SCALE_MAX = 300;
export const FONT_SCALE_DEFAULT = 100;
/** 배율 조절 한 칸 */
export const FONT_SCALE_STEP = 10;
