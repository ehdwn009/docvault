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
  askWithCards: 1,
};

/** 질문(배움 카드) 입력 한도 — 서버 ASK 상수와 같아야 한다. 초과분은 클라이언트가 먼저 자른다 */
export const ASK_QUOTE_MAX_CHARS = 500;
export const ASK_CONTEXT_MAX_CHARS = 1500;
export const ASK_QUESTION_MAX_CHARS = 2000;

/** 카드 내보내기 범위에서 "주제 없음"을 뜻하는 표식 — 서버 CARD.NO_TOPIC_MARK와 같아야 한다 */
export const NO_TOPIC_MARK = '-';

/** 복습 간격 규칙 — 서버 CARD.REVIEW_*와 같아야 한다 (버튼에 "N일 뒤"를 미리 적기 위해 클라이언트도 안다) */
export const REVIEW_AGAIN_DAYS = 1;
export const REVIEW_FIRST_OK_DAYS = 2;
export const REVIEW_MAX_INTERVAL_DAYS = 60;

/** 질문 때 함께 보내는 카드 수 상한 — 서버 CARD.ASK_CONTEXT_MAX_CARDS와 같아야 한다 */
export const ASK_CONTEXT_MAX_CARDS = 3;

/** 오른쪽 질문 패널(SCR-180)의 폭 — 드래그로 조절하고 기기가 기억한다 (IA — 안 B) */
export const ASK_PANEL_WIDTH_MIN = 320;
export const ASK_PANEL_WIDTH_MAX = 560;
export const ASK_PANEL_WIDTH_DEFAULT = 384;
/** 이보다 좁은 창에서는 질문 패널이 본문을 밀지 않고 위에 덮인다 */
export const ASK_PANEL_OVERLAY_BELOW = 1024;
/** 덮일 때 본문이 최소한 이만큼은 보이게 남기는 폭(px) — 펼친 폰에서 패널이 본문 칸을 통째로 덮었다 */
export const ASK_PANEL_OVERLAY_GUTTER = 48;

/** 창 등급(폰 재설계 2026-10-31) — 기기 이름이 아니라 페이지가 받은 폭으로 가른다.
    narrow < 600 ≤ wide < 840 ≤ xwide. 높이 가드: 일반 폰 가로(932×430)는 narrow로 남긴다. 접는 폰의 과도기 크기는 디바운스로 삼킨다 */
export const WINDOW_WIDE_MIN_W = 600;
export const WINDOW_WIDE_MIN_H = 480;
export const WINDOW_XWIDE_MIN_W = 840;
export const WINDOW_CLASS_DEBOUNCE_MS = 120;

/** 이보다 큰 HTML은 본문(JSON)을 받아 iframe에 넣지 않고 서버 원문 주소를 iframe src로 바로 연다 (2026-11-05).
    23MB를 JSON으로 받아 파싱하고 다시 srcdoc에 넣으면 아이폰이 메모리 한계에서 렌더링을 끊어 반만 보였다.
    대가: 목차·찾기·글자 배율·읽던 위치 같은 덧붙임이 빠진다 */
export const HTML_INLINE_MAX_BYTES = 2 * 1024 * 1024;

/** 알림함 새로고침 주기 — 1단계는 푸시 없이 묻는 방식이라, 화면이 보일 때만 이 간격으로 (알림 설계 2026-11-04) */
export const NOTIFICATION_POLL_MS = 60 * 1000;
