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

/** HTML 뷰어 메모리 가드 — 가로로 넘치는 스크롤 상자가 이보다 많으면 터치 기기에서 코드형 상자를 줄바꿈으로 바꾼다.
    화면 전용 값(서버에는 없다). 기준은 실측: 넘치는 상자 158개 문서는 아이폰 탭이 반복 강제 종료됐고,
    17개(표) 문서는 멀쩡했다 — 그 사이에서 넉넉히 낮춰 잡았다 (아키텍처 — 스크롤 상자 메모리 가드) */
export const HTML_SCROLLER_LIMIT = 30;

/** 뷰어 설정을 아직 못 받았을 때 쓰는 초기값 — 서버의 DEFAULT_USER_SETTINGS와 같아야 한다 (API-071) */
export const DEFAULT_USER_SETTINGS = {
  viewerTheme: 'light' as const,
  fontSize: FONT_SIZE_DEFAULT,
  htmlFontScale: FONT_SCALE_DEFAULT,
  fontFamily: null as string | null,
  lineHeight: null as string | null,
  contentWidth: 'normal' as const,
  lastSeenVersion: null as string | null,
  termHighlight: 1,
};

/** 질문(배움 카드) 입력 한도 — 서버 ASK 상수와 같아야 한다. 초과분은 클라이언트가 먼저 자른다 */
export const ASK_QUOTE_MAX_CHARS = 500;
export const ASK_CONTEXT_MAX_CHARS = 1500;
export const ASK_QUESTION_MAX_CHARS = 2000;

/** 카드 내보내기 범위에서 "주제 없음"을 뜻하는 표식 — 서버 CARD.NO_TOPIC_MARK와 같아야 한다 */
export const NO_TOPIC_MARK = '-';
