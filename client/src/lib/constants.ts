// 화면 쪽 설계 상수. 서버가 zod로 같은 값을 검증하므로 server/src/constants.ts와 항상 같아야 한다.

/** HTML 글자 크기 배율 범위(%) — 문서마다 기준 크기가 달라 절대 px가 아니라 배율로 다룬다 */
export const FONT_SCALE_MIN = 70;
export const FONT_SCALE_MAX = 200;
export const FONT_SCALE_DEFAULT = 100;
/** 배율 조절 한 칸 */
export const FONT_SCALE_STEP = 10;
