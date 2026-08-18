// 화면 쪽 설계 상수. 서버가 zod로 같은 값을 검증하므로 server/src/constants.ts와 항상 같아야 한다.
// 서버·클라이언트는 각자 빌드되는 별개 프로그램이라 공유할 방법이 없다 — 고칠 때 양쪽을 같이 고친다.

/** 글자 크기 배율 범위(%) — 문서마다 기준 크기가 달라 절대 px가 아니라 배율로 다룬다.
    범위를 넓게 열어 둔 이유: 조작(⋯ 메뉴)이 배율을 먹는 본문 바깥에 있어 아무리 줄여도 되돌릴 수 있다 */
export const FONT_SCALE_MIN = 10;
export const FONT_SCALE_MAX = 300;
export const FONT_SCALE_DEFAULT = 100;
/** 배율 조절 한 칸 */
export const FONT_SCALE_STEP = 10;

/** md·텍스트 본문 글자 크기(px) 범위 — 문서가 자기 크기를 갖지 않으므로 배율이 아니라 절대값으로 다룬다 */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_DEFAULT = 16;

/** 뷰어 설정을 아직 못 받았을 때 쓰는 초기값 — 서버의 DEFAULT_USER_SETTINGS와 같아야 한다 (API-071) */
export const DEFAULT_USER_SETTINGS = {
  viewerTheme: 'light' as const,
  fontSize: FONT_SIZE_DEFAULT,
  htmlFontScale: FONT_SCALE_DEFAULT,
  fontFamily: null as string | null,
  lineHeight: null as string | null,
  contentWidth: 'normal' as const,
  lastSeenVersion: null as string | null,
};
