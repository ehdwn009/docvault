// 설계 문서에서 정한 상수는 전부 여기에 모은다 (CLAUDE.md — 매직 넘버 금지)

/** 세션(JWT 쿠키) 유효기간: 7일 (API 명세서 공통 규약) */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'dv_session';

export const BCRYPT_ROUNDS = 10;

/** 비밀번호 최소 길이 (API-013) */
export const PASSWORD_MIN_LENGTH = 8;

/** 글자 크기 배율 범위(%) — 문서마다 기준 크기가 달라 절대 px가 아니라 배율로 다룬다 (아키텍처 — 글자 크기 배율).
    하한을 낮게 연 이유: 조작 UI가 배율을 먹는 본문 바깥에 있어 사용자가 언제든 되돌릴 수 있다 */
export const FONT_SCALE_MIN = 10;
export const FONT_SCALE_MAX = 300;
export const FONT_SCALE_DEFAULT = 100;
/** 배율 조절 한 칸 */
export const FONT_SCALE_STEP = 10;

/** 파일당 버전 스냅샷 보관 개수 (아키텍처 — 편집 저장 흐름) */
export const MAX_VERSIONS_PER_FILE = 20;

/** 휴지통 보관 기간 — 지나면 자동 영구 삭제 (IA — 휴지통) */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 휴지통 자동 비움 주기 — 기동 시 1회 실행 후 이 간격으로 반복 */
export const TRASH_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 텍스트 파일 업로드 크기 제한 10MB (API-031) */
export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;

/** 바이너리(이미지·PDF) 업로드 크기 제한 50MB (API-031 로드맵) */
export const MAX_BINARY_FILE_BYTES = 50 * 1024 * 1024;

/** ZIP 내보내기 한 번에 담을 수 있는 최대 파일 수 (API-040) — 폭주 방지용 상한 */
export const MAX_ARCHIVE_ENTRIES = 10000;

/** 내보내기 요청 URL에 직접 나열할 수 있는 id 개수 (API-040) — URL 길이 한계 */
export const MAX_ARCHIVE_ID_PARAMS = 500;

/** md·텍스트 본문 글자 크기(px) 범위 — 문서가 자기 크기를 갖지 않으므로 배율이 아니라 절대값으로 다룬다 */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_DEFAULT = 16;

/** 사용자×파일 열람 상태의 기본값 — 상태 행이 없는 파일에 응답으로 실어 보낸다 (API-021·031).
    클라이언트가 "state가 없을 때"를 따로 분기하지 않도록 서버가 채워서 내려준다 */
export const DEFAULT_FILE_STATE = {
  isFavorite: 0,
  lastOpenedAt: null as number | null,
  readingPosition: null as { anchor?: string | null; offset?: number } | null,
  viewerFit: 1,
  fontScale: null as number | null,
};

/** 뷰어 설정의 기본값 — 설정 행이 없는 사용자와 새로 만드는 행이 같은 값에서 출발하게 한다 (API-071).
    schema.ts의 .default()는 DB 차원의 백스톱이고, 앱이 참조하는 기본값은 여기 하나다 */
export const DEFAULT_USER_SETTINGS = {
  viewerTheme: 'light' as const,
  fontSize: FONT_SIZE_DEFAULT,
  htmlFontScale: FONT_SCALE_DEFAULT,
  fontFamily: null as string | null,
  lineHeight: null as string | null,
  contentWidth: 'normal' as const,
  lastSeenVersion: null as string | null,
};
