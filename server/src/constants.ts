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

/** 바이너리 업로드 크기 제한 50MB (API-031) */
export const MAX_BINARY_FILE_BYTES = 50 * 1024 * 1024;

/** 모르는 확장자를 텍스트/바이너리로 분류할 때 검사하는 앞부분 크기 (API-031 전량 수용 정책) */
export const TEXT_SNIFF_BYTES = 8 * 1024;

/** ZIP 내보내기 한 번에 담을 수 있는 최대 파일 수 (API-040) — 폭주 방지용 상한 */
export const MAX_ARCHIVE_ENTRIES = 10000;

/** 내보내기 요청 URL에 직접 나열할 수 있는 id 개수 (API-040) — URL 길이 한계 */
export const MAX_ARCHIVE_ID_PARAMS = 500;

/** md·텍스트 본문 글자 크기(px) 범위 — 문서가 자기 크기를 갖지 않으므로 배율이 아니라 절대값으로 다룬다 */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_DEFAULT = 16;

/** 로그인 시도 제한. IP+아이디 조합당 창 안에서 이만큼만 허용한다.
    사람이 오타로 10번을 넘기는 일은 드물고, 사전 공격에는 충분히 가혹한 값 */
export const LOGIN_RATE_LIMIT = {
  WINDOW_MS: 10 * 60 * 1000,
  MAX_ATTEMPTS: 10,
  /** 이 개수를 넘을 때만 만료 항목을 청소한다 — 매 요청 전체 순회를 피하려고 */
  SWEEP_THRESHOLD: 1000,
} as const;

/** 존재하지 않는 계정에도 bcrypt를 돌려 응답 시간을 맞추기 위한 더미 해시.
    실제 비밀번호와 무관한 값이며, 어떤 입력과도 일치하지 않는다 */
export const DUMMY_PASSWORD_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/** 사용자×파일 열람 상태의 기본값 — 상태 행이 없는 파일에 응답으로 실어 보낸다 (API-021·031).
    클라이언트가 "state가 없을 때"를 따로 분기하지 않도록 서버가 채워서 내려준다 */
export const DEFAULT_FILE_STATE = {
  isFavorite: 0,
  lastOpenedAt: null as number | null,
  // ratio: 기기마다 문서 높이가 달라 px만으로는 못 옮긴다 — 클라이언트 TreeFile·me.ts의 zod와 같은 모양이어야 한다
  readingPosition: null as { anchor?: string | null; offset?: number; ratio?: number } | null,
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

/** 질문(배움 카드 1판) — 값의 근거는 docs/design/배움카드_docvault_20260918.md "정한 값" */
export const ASK = {
  MODEL: 'claude-opus-5',
  /** 사용자별 하루 질문 한도 (UTC 날짜). 되돌릴 수 있는 값이라 낮게 잡지 않았다. 관리자에게는 걸지 않는다 */
  DAILY_LIMIT: 30,
  /** 저장 안 한 대화 보관 기간 — 휴지통과 같은 감각 */
  THREAD_RETENTION_MS: 30 * 24 * 60 * 60 * 1000,
  /** 드래그한 문장 최대 길이 */
  QUOTE_MAX_CHARS: 500,
  /** 앞뒤 문단 문맥 최대 길이 — "문서 전체를 안 보내는" 선 */
  CONTEXT_MAX_CHARS: 1500,
  QUESTION_MAX_CHARS: 2000,
  /** 답 최대 길이(토큰). 설명 하나 분량 — 더 길면 "더 자세히"로 이어 묻는다. 비용 상한이기도 하다 */
  MAX_OUTPUT_TOKENS: 4096,
  /** 지난 대화 목록의 한 번 개수 */
  LIST_LIMIT: 20,
  /** 대화 이력 중 LLM에 실어 보내는 최근 메시지 수 — 길어진 대화의 비용 상한 */
  HISTORY_LIMIT: 20,
  /** 답 하나에 모델이 스스로 할 수 있는 웹 검색 횟수 상한 — "모델이 판단" 방식의 비용 상한 (설계 — 웹 검색) */
  WEB_SEARCH_MAX_USES: 3,
  /** 서버 도구 루프가 pause_turn으로 멈췄을 때 이어 붙이는 최대 횟수 */
  PAUSE_CONTINUATIONS: 2,
  /** 답 아래에 붙이는 출처 링크 최대 개수 */
  MAX_SOURCES: 5,
} as const;
