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

/** 해시 이름 정적 파일(/assets/*)의 브라우저 캐시 기간 — 1년. 이름에 해시가 있어 내용이 바뀌면 이름도 바뀐다 */
export const STATIC_ASSET_MAX_AGE_S = 365 * 24 * 60 * 60;

/** 이보다 오래 일한 요청은 로그에 [slow]로 부분별 시간을 남긴다 — 다음에 느려지면 로그만 보면 어디인지 나오게 */
export const SLOW_REQUEST_MS = 500;

/** 헬스체크 경로 — 인증 예외이자 요청 로그에서도 뺀다 (도커가 30초마다 두드린다) */
export const HEALTH_PATH = '/api/v1/health';

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
  termHighlight: 1,
  askWithCards: 1,
  briefingAuto: 0,
  /** 회차별 켜기·시각 JSON — null이면 AUTO_SLOTS 기본값 (lib/briefing/autoSchedule.ts) */
  briefingSchedule: null as string | null,
  /** 앱 안 원문 보기 스위치(기본 꺼짐) — 서버에서 추출 품질을 잰 뒤(briefing:readcheck) 관리자가 켠다 (개선 합의안 7장) */
  briefingReader: 0,
  /** 함께 보는 브리핑의 주인(관리자 id) — 관리자가 고른 일반 계정에만 값이 생긴다 (v0.49) */
  briefingOwnerId: null as number | null,
  /** 회차 생성 방식 — api(지금 방식) · subscription(구독으로 받기) (v0.50) */
  briefingMode: 'api' as 'api' | 'subscription',
  briefingTokenHash: null as string | null,
  briefingTokenPrefix: null as string | null,
  briefingTokenCreatedAt: null as number | null,
  briefingTokenLastUsedAt: null as number | null,
  briefingTriggerEnc: null as string | null,
  briefingLastPing: null as string | null,
};

/** 질문(배움 카드 1판) — 값의 근거는 docs/design/배움카드_docvault_20260918.md "정한 값" */
/**
 * 답변 모델 목록 — 대화 헤더의 모델 칩이 이 순서로 보여 준다(SCR-187·180). 새 모델은 여기 한 줄.
 * effort: Haiku 4.5는 output_config.effort를 받지 않는다(400). webSearch: 최신 검색 도구는 Sonnet/Opus만.
 * 단가(USD/백만 토큰)는 관리자 AI 사용량의 추정 근거 — 답마다 어느 모델이었는지 ask_messages.model에 남긴다
 */
export const ASK_MODELS = [
  { id: 'claude-haiku-4-5', label: '빠름', name: 'Haiku 4.5', note: '즉답. 간단한 질문·잡담·번역', inputPerMtok: 1, outputPerMtok: 5, effort: false, webSearch: 'web_search_20250305' },
  { id: 'claude-sonnet-5', label: '균형', name: 'Sonnet 5', note: '설명 품질 충분, 몇 초 안에. 평소 기본', inputPerMtok: 2, outputPerMtok: 10, effort: true, webSearch: 'web_search_20260209' },
  { id: 'claude-opus-5', label: '깊게', name: 'Opus 5', note: '긴 추론·어려운 개념. 느리고 비용 5배쯤', inputPerMtok: 5, outputPerMtok: 25, effort: true, webSearch: 'web_search_20260209' },
] as const;
export type AskModelId = (typeof ASK_MODELS)[number]['id'];
export const ASK_MODEL_IDS = ASK_MODELS.map((m) => m.id) as [AskModelId, ...AskModelId[]];
/** 모델 칸이 비어 있는 옛 답(v0.40 이전)은 전부 Opus였다 — 비용 추정도 그 단가로 */
export const ASK_LEGACY_MODEL: AskModelId = 'claude-opus-5';

export const ASK = {
  /** 새 대화의 기본 모델 — 균형(Sonnet). 깊게 파고 싶을 때만 칩에서 Opus */
  DEFAULT_MODEL: 'claude-sonnet-5' as AskModelId,
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
  /** 대화 제목 최대 길이 — 직접 쓰든 AI가 짓든 같은 상한. 목록 한 줄에 들어갈 길이 */
  TITLE_MAX_CHARS: 60,
  /** AI 제목 짓기(API-109)의 답 길이 상한 — 제목 한 줄이면 충분하다 */
  TITLE_MAX_OUTPUT_TOKENS: 60,
  /** AI 제목 짓기에 보여 주는 말풍선 수·말풍선당 글자 수 — 앞부분만으로 충분하고 비용은 상수로 묶는다 */
  TITLE_CONTEXT_MESSAGES: 6,
  TITLE_CONTEXT_CHARS: 300,
  /** 웹 검색 단가 (USD/1000회) — 모델별 토큰 단가는 ASK_MODELS에. 청구서가 아니라 감 잡기용 대략값 */
  SEARCH_PER_1000_USD: 10,
  /** 챗봇 "내 자료 참고" — 질문 낱말로 찾는 내 문서 단락 수와 단락 길이(FTS snippet 토큰). 문서 전체는 절대 안 간다 */
  DOC_PASSAGES: 3,
  DOC_PASSAGE_TOKENS: 48,
  /** 검색어로 삼는 낱말의 최소 글자 수·최대 개수 — 한 글자 조사·너무 긴 OR는 잡음만 늘린다 */
  DOC_TERM_MIN_CHARS: 2,
  DOC_TERMS_MAX: 12,
  /** 원화 환산 (대략). 통계 화면의 "≈ n원"에만 쓰인다 */
  KRW_PER_USD: 1400,
} as const;

/** 배움 카드 (2판) — 설계 "카드의 모양" */
export const CARD = {
  /** 카드 초안·정리·재구성용 모델 — 답변(ASK.MODEL)과 다르다. 대화를 구조화하는 일이라 깊은 추론보다 속도 */
  MODEL: 'claude-sonnet-5',
  /** 초안·재구성 답 길이 상한 (토큰). 카드 한 장 분량 */
  MAX_OUTPUT_TOKENS: 4096,
  /** 비슷한 카드 판단 때 LLM에 보여 주는 기존 카드 수 상한 — 그 이상은 제목·별칭 정확 일치만 */
  SIMILAR_CANDIDATES: 200,
  ONE_LINE_MAX_CHARS: 120,
  BODY_MAX_CHARS: 20000,
  /** 별칭·태그·연결 한 칸의 항목 수 상한 */
  MAX_LIST_ITEMS: 12,
  /** 대화 정리(API-116)가 한 대화에서 뽑는 개념 수 상한 — 그 이상이면 대화를 나눠 정리하는 게 맞다 */
  OUTLINE_MAX_CONCEPTS: 8,
  /** 대화 정리 1단계(개념 목록만, 본문 없음) 답 길이 상한 — 짧아야 체크리스트가 빨리 뜬다 */
  OUTLINE_MAX_OUTPUT_TOKENS: 3000,
  /** 2단계 항목 하나의 본문 상한 */
  OUTLINE_ITEM_MAX_OUTPUT_TOKENS: 2000,
  /** 답 골라 담기(API-112 messageIds)에서 한 번에 고를 수 있는 답 수 */
  MAX_PICKED_MESSAGES: 30,
  /** 용어집 내보내기(API-118)가 내 파일 최상위에 만드는·갱신하는 파일 이름 */
  GLOSSARY_FILE_NAME: '용어집.md',
  /** 범위(topics) 목록에서 "주제 없음"을 뜻하는 표식 — 빈 문자열은 쉼표 목록에 못 싣는다 */
  NO_TOPIC_MARK: '-',
  /** 복습(활용 ③) — 하루 상한, 새 카드가 첫 복습에 들어오기까지, 몰랐을 때·처음 알았을 때·최대 간격(일) */
  REVIEW_DAILY_MAX: 20,
  REVIEW_NEW_CARD_DELAY_DAYS: 1,
  REVIEW_AGAIN_DAYS: 1,
  REVIEW_FIRST_OK_DAYS: 2,
  REVIEW_MAX_INTERVAL_DAYS: 60,
  /** 질문 때 함께 보내는 카드 수 상한과 카드당 본문 길이 — 토큰이 카드 수에 비례해 는다 (활용 ④) */
  ASK_CONTEXT_MAX_CARDS: 3,
  ASK_CONTEXT_BODY_CHARS: 400,
} as const;

/**
 * 뉴스 브리핑 — 값의 근거는 docs/design/뉴스브리핑_docvault_20261001.md "정한 값".
 * 비용을 조절하는 손잡이(후보 상한·분야당 건수·월 한도)는 전부 여기 — 첫 주 실측을 보고 고친다
 */
export const BRIEFING = {
  /** 분류·선별·합치기·참고·글머리표·웹 보강 — 판단은 단순하고 양이 많다. v0.47부터 Haiku 5.5(단가 1/10, 수집 재설계 토론·사용자 결정 2026-10-11).
      5.5가 400·거절을 돌려주면 그 호출만 4.5로 다시 부른다(SELECT_MODEL_FALLBACK) — 분류·선별은 폴백이 없으면 회차가 통째로 실패한다 */
  SELECT_MODEL: 'claude-haiku-5-5',
  SELECT_MODEL_FALLBACK: 'claude-haiku-4-5',
  /** 주요 기사 요약 — 양이 적고 품질이 보이는 자리 */
  SUMMARY_MODEL: 'claude-sonnet-5-5',
  /** 핵심 기사 요약 — 가장 많이 읽히는 20건은 상위 모델로(사용자 결정 2026-10-11, 수집 재설계 토론). 회차당 약 +$0.4 */
  SUMMARY_MODEL_CORE: 'claude-opus-5-5',
  /** 모델별 단가 (USD/백만 토큰) — 실행 기록의 추정 비용 계산용. 청구서가 아니라 감 잡기용 */
  PRICES: {
    'claude-haiku-5-5': { inputPerMtok: 0.1, outputPerMtok: 0.5 },
    'claude-haiku-4-5': { inputPerMtok: 1, outputPerMtok: 5 },
    'claude-sonnet-5-5': { inputPerMtok: 2, outputPerMtok: 10 },
    'claude-opus-5-5': { inputPerMtok: 4, outputPerMtok: 20 },
  },
  /** 자동 생성 기본 시작 시각 (한국시간 시·분) — 발행 목표(07·12·18시) 30분 전. 사람마다 바꿀 수 있다(v0.43, autoSchedule.ts) */
  AUTO_SLOTS: [
    { slot: 'morning', label: '아침', hour: 6, minute: 30 },
    { slot: 'noon', label: '점심', hour: 11, minute: 30 },
    { slot: 'evening', label: '저녁', hour: 17, minute: 30 },
  ],
  /** 서버가 꺼져 있다 켜졌을 때 그 회차를 늦게라도 시작해 주는 시간 */
  AUTO_CATCHUP_MS: 2 * 60 * 60 * 1000,
  /** 사람이 고를 수 있는 가장 늦은 시작 시각(하루의 분) — 늦게라도 시작하는 2시간이 자정을 넘지 않게 21:59까지 */
  AUTO_LATEST_MINUTE: 21 * 60 + 59,
  /** 자동 생성 시계를 들여다보는 주기 */
  SCHEDULER_TICK_MS: 60 * 1000,
  /** 한국은 일광절약시간이 없다 — UTC+9 고정 */
  KST_OFFSET_MS: 9 * 60 * 60 * 1000,
  /** 한 회차가 다루는 최대 범위 — 첫 회차·오래 쉰 뒤 기사가 수천 건 쌓이는 것 방지 */
  MAX_RANGE_MS: 24 * 60 * 60 * 1000,
  /** 후보 상한 — 이것이 곧 비용 상한이다. 검색 한 곳은 15건까지 — 검색은 "몇 곳이 다뤘나"를 세는 신호로만 쓰고,
      요약 재료는 언론사 직접 RSS·원문에서 가져온다 (개선 합의안 S6, 2026-10-11) */
  MAX_CANDIDATES: 800,
  MAX_PER_SOURCE: 40,
  MAX_PER_SEARCH: 15,
  /** 상한으로 자를 때 범위를 이만큼의 칸으로 나눠 칸마다 고르게 남긴다 (24시간이면 2시간씩).
      최신순으로 자르면 24시간판에 마지막 90분 기사만 남았다 (설계 "① 수집") */
  SPREAD_SLOTS: 12,
  /** 분야당 최대 기사 수 — 경제·IT·테크 계열(wide)과 나머지 (기획서 5~7 / 3~5의 상한) */
  MAX_ITEMS_WIDE: 7,
  MAX_ITEMS_NARROW: 5,
  /** 분류 한 번에 보내는 기사 수 */
  CLASSIFY_CHUNK: 80,
  /** 요약 한 번에 보내는 기사 수 — 기사마다 원문 앞부분이 붙고 답도 칸 구성으로 길어져 15 → 8 (v0.43) → 6 (v0.46, 5W·영향이 더 붙어서).
      핵심은 여러 언론 본문이 붙어 3건씩 (개선 합의안 4.6) */
  SUMMARY_CHUNK: 6,
  SUMMARY_CHUNK_CORE: 3,
  /** 글머리표 다시 쓰기 한 번에 보내는 기사 수 — 재료는 우리 요약뿐이라 짧다 */
  LENS_CHUNK: 10,
  /** 동시 실행 수 — 1GB e2-micro와 API 속도 제한 사이 */
  FETCH_CONCURRENCY: 8,
  SELECT_CONCURRENCY: 5,
  SUMMARY_CONCURRENCY: 4,
  /** 피드 하나의 요청 시간·크기 상한 — 느린 피드 하나가 전체를 붙잡지 않게 */
  FETCH_TIMEOUT_MS: 10_000,
  /** 국내 출처는 더 기다린다 — 10초 시간 초과가 국내 언론에만 몰렸다. 서버(GCP 미국 리전)에서 멀어서로 본다 (2026-10-08) */
  FETCH_TIMEOUT_DOMESTIC_MS: 20_000,
  /** 안쪽 시간 제한을 이만큼 넘겨도 안 끝나면 바깥에서 포기한다 — 안쪽 제한이 뚫려 실행이 멈춘 일이 있었다 (2026-10-06) */
  FETCH_DEADLINE_GRACE_MS: 5_000,
  FETCH_MAX_BYTES: 2 * 1024 * 1024,
  /** 발췌는 AI에게 보여 주는 데만 쓰고 저장하지 않는다 */
  SNIPPET_MAX_CHARS: 300,
  /** 성공한 출처가 이 비율보다 적으면 실패 — 망가진 수집으로 만든 회차는 직전 회차보다 나쁘다 */
  MIN_SOURCE_OK_RATIO: 0.5,
  /** 실행 시간 한도 — 30분 안에 끝낸다는 목표의 안전 여유. 이 시각이 되면 멈춤 신호와 함께 실행 기록도 바로 실패로 닫는다 */
  RUN_TIMEOUT_MS: 20 * 60 * 1000,
  /** 진행 기록(화면의 [진행 기록]) — 남기는 줄 수, "기다리는 중"으로 보이기까지의 시간·보여 줄 개수, 원문 읽기 이름에 붙이는 제목 길이 */
  LIVE_LOG_MAX: 30,
  LIVE_SLOW_MS: 8000,
  LIVE_WAITING_MAX: 5,
  LIVE_TITLE_CHARS: 20,
  /** 이번 달(한국시간) 추정 비용 한도 — 넘으면 자동 생성 정지, 버튼은 확인 후 진행. 80 → 110 (개선 합의안 8장: 하루 1회 약 $75 + 수시판 여유) */
  MONTHLY_BUDGET_USD: 110,
  /** 한도의 이 비율에 닿으면 패널이 미리 알린다 */
  BUDGET_WARN_RATIO: 0.8,
  /** 웹 검색 단가 (USD/1000회) — ASK.SEARCH_PER_1000_USD와 같은 값. 웹 검색 보강(S8)의 비용 근거 */
  SEARCH_PER_1000_USD: 10,
  /** 분류·선별 답 길이 상한 (토큰) */
  /** Haiku 5.5는 같은 글을 약 30% 많은 토큰으로 센다 — 선별 답이 잘려 JSON이 깨지지 않게 8000 → 12000 (v0.47.1) */
  SELECT_MAX_OUTPUT_TOKENS: 12000,
  /** Opus 5.5·Sonnet 5.5는 생각 토큰이 max_tokens에 포함된다(effort low라도) — 답이 잘리지 않게 넉넉히 (v0.46) */
  SUMMARY_MAX_OUTPUT_TOKENS: 16000,
  /** 원문 읽기(설계 "③-1 근거 보강") — 이 중요도 이상만, 본문 앞부분 몇 자까지, 한 곳당 시간·크기, 동시 개수, 기사당 시도할 주소 수.
      주요(2)까지 읽는다 — 펼침을 칸 구성으로 길게 쓰려면 재료가 있어야 한다. 발췌만으로는 제목을 되풀이했다 (v0.43) */
  BODY_FETCH_MIN_IMPORTANCE: 2,
  BODY_MAX_CHARS: 2000,
  BODY_FETCH_TIMEOUT_MS: 8000,
  /** 국내 원문은 더 기다린다 — RSS를 20초로 늘린 것과 같은 이유(미국 리전 서버). 원문만 8초로 남아 국내 본문을 놓쳤다 (개선 합의안 S1) */
  BODY_FETCH_TIMEOUT_DOMESTIC_MS: 20_000,
  BODY_FETCH_MAX_BYTES: 1536 * 1024,
  BODY_FETCH_CONCURRENCY: 6,
  /** 기사당 시도할 주소 수 — 여러 언론 본문을 읽으려면 더 돌아야 한다 (S7) */
  BODY_FETCH_TRIES: 4,
  /** 여러 언론 본문 읽기(개선 합의안 S7) — 핵심은 서로 다른 언론사 3곳(대표 3,000자 + 나머지 1,500자), 주요는 2곳(2,000 + 1,000).
      재료가 2곳 이상 모여야 핵심을 500~700자로 쓴다. 한 곳 본문은 자동으로 "대표"가 된다 */
  BODY_OUTLETS_CORE: 3,
  BODY_OUTLETS_MAJOR: 2,
  BODY_MAIN_CHARS_CORE: 3000,
  BODY_OTHER_CHARS_CORE: 1500,
  BODY_MAIN_CHARS_MAJOR: 2000,
  BODY_OTHER_CHARS_MAJOR: 1000,
  /** 피드가 통째로 주는 본문(content:encoded)을 재료로 쓸 때의 길이 — 메모리에서만 쓰고 저장하지 않는다 (S2) */
  FEED_TEXT_MAX_CHARS: 2000,
  FEED_TEXT_MIN_CHARS: 400,
  /** Google 기사를 같은 언론사의 직접 기사에 붙이는 기준 — 제목 글자 2개씩 겹침 비율, 발행 시각 차이 (S3).
      두 제목에 숫자가 있으면 같아야 한다(후속 기사 오결합 방지) */
  ATTACH_TITLE_SIMILARITY: 0.7,
  ATTACH_MAX_GAP_MS: 6 * 60 * 60 * 1000,
  /** 수집 단계 사건 묶기(v0.46, 수집 재설계 토론) — 같은 region·6시간 안·제목 글자 묶음 겹침 이만큼·숫자 집합 같음이면 같은 사건.
      첫 실측 5회차는 세기만 한다(stats.wouldMerge). 짧은 상투 제목([오늘의 증시] 등)은 묶지 않는다 */
  STORY_GROUP_SIMILARITY: 0.7,
  STORY_GROUP_MIN_KEY_CHARS: 10,
  /** 받아 온 본문이 그 기사인지 — 제목 핵심어(글자 2개씩)가 본문에 이만큼은 있어야 한다. 엉뚱한 페이지(목록·오류)와 잘못 붙은 기사를 거른다 (verify.ts) */
  BODY_TITLE_OVERLAP_MIN: 0.3,
  /** 숫자 대조 — 요약의 숫자가 근거 재료에 없으면 'log'는 세기만, 'drop'은 그 문장을 지운다.
      처음 2주는 기록만 — 맞는 글을 지워 다시 얕아지는지 본 뒤 켠다 (개선 합의안 4.5). 켜기 전에는 여러 언론 종합도 켜지 않는다 */
  NUMBER_CHECK_MODE: 'log' as 'log' | 'drop',
  /** 웹 검색 보강(개선 합의안 S8) — 원문 읽기까지 다 하고도 제목뿐인 핵심·주요만, 회차당 이만큼, 기사당 검색 2회.
      검색 범위는 수집 목록 언론사 + 통신사로 좁힌다. 끄면 그런 기사는 "제목만" 참고로 내려간다 */
  WEB_FILL_ENABLED: true,
  WEB_FILL_MAX: 15,
  WEB_FILL_SEARCHES: 2,
  WEB_FILL_MAX_OUTPUT_TOKENS: 1500,
  WEB_FILL_MODEL: 'claude-haiku-5-5',
  WEB_FILL_MODEL_FALLBACK: 'claude-haiku-4-5',
  /** 웹 검색 도구 버전 — Haiku용 (ASK_MODELS와 같은 값) */
  WEB_FILL_TOOL: 'web_search_20250305',
  WEB_FILL_WIRES: ['reuters.com', 'apnews.com', 'bloomberg.com', 'afp.com'],
  /** 검색 허용 도메인 상한 — 통신사 + 수집 목록 앞쪽 언론사. 70개를 넘기면 검색 도구가 요청을 거부한다 (v0.46) */
  WEB_FILL_DOMAINS_MAX: 20,
  /** 찾은 보도의 날짜가 회차 범위에서 이만큼 벗어나면 다른 사건으로 본다 */
  WEB_FILL_DATE_SLACK_MS: 24 * 60 * 60 * 1000,
  /** 본문 문단으로 칠 최소 길이 — 메뉴·저작권 표시 같은 짧은 줄을 거른다 */
  BODY_MIN_PARAGRAPH_CHARS: 30,
  /** 발췌가 제목을 되풀이할 뿐인지 볼 때, 제목을 빼고 남아야 하는 글자 수 */
  SNIPPET_MIN_EXTRA_CHARS: 20,
  /** 기사 하나에 붙이는 "같은 사건 다른 보도" 링크 수 상한 */
  MAX_RELATED: 5,
  /** 펼침 길이(글자) — 등급과 재료에 따라 다르다 (개선 합의안 4.2). 핵심은 본문 2곳 이상(또는 1곳 2,000자 이상)일 때 500~700,
      1곳이면 300~450, 주요 250~400. 목표는 기사마다 min(등급 상한, 재료 글자 ÷ 3)으로 계산해 지시문에 넣는다 */
  LENGTH_CORE_DEEP: [500, 700] as readonly [number, number],
  LENGTH_CORE: [300, 450] as readonly [number, number],
  LENGTH_MAJOR: [250, 400] as readonly [number, number],
  /** 재료 글자 수의 몇 분의 1까지 쓰나 — 재료보다 긴 요약은 지어낸 것이다 */
  LENGTH_MATERIAL_RATIO: 3,
  /** 핵심을 깊게(500~700자) 쓰는 조건 — 본문 2곳 이상이거나 한 곳 본문이 이만큼 이상 */
  DEEP_SINGLE_BODY_CHARS: 2000,
  /** 결과가 상한의 이 배수를 넘으면 실행 기록에 남긴다 */
  LENGTH_OVERRUN_RATIO: 1.3,
  /** 골라 쓰는 칸 수 상한과 언론사마다 다른 점(angles) 상한 */
  BLOCKS_MAX: 3,
  ANGLES_MAX: 3,
  /** 영향 칸(v0.46, 영향 칸 토론 2026-10-11) — 'off'면 만들지 않는다. 경제·테크(wide) 분야의 핵심 2줄·주요 1줄, 문장 60자, 대상 6자.
      기사가 말한 것(stated: 줄과 근거 재료에 같은 방향 어휘)만 낱말(부담/기회/갈림)이 붙고, AI가 짚은 것(inferred)은 "AI 추론"으로 따로 표시한다(사용자 결정).
      "왜 중요한가"·양쪽 시각과 글자 묶음이 이만큼 겹치면 되풀이라 지운다 */
  IMPACT_MODE: 'show' as 'off' | 'show',
  IMPACT_MAX_CORE: 2,
  IMPACT_MAX_MAJOR: 1,
  IMPACT_TEXT_MAX_CHARS: 60,
  IMPACT_TARGET_MAX_CHARS: 6,
  IMPACT_DUP_OVERLAP: 0.5,
  /** 5W 한 칸의 길이 상한 — 요약 호출이 원문을 보고 쓴다(v0.46). 없는 칸은 비워 두고 화면이 "기사에 없음"으로 보인다 */
  W5_TEXT_MAX_CHARS: 60,
  /** 해설 상자(v0.48, 해설 칸 토론 2026-10-15 — 에이전트 4인 합의) — 'off'면 만들지 않는다. 핵심·주요만, 같은 요약 호출에서 미리 쓴다(열 때 만들면
      원문이 없어 요약을 다시 푸는 "추론의 추론"). 칸: 말뜻(terms, 0~3개) · 왜 이렇게 됐나(why) · 그래서 어떻게 되나(effect, 경제·테크만) · 다음에 볼 것(watch).
      말뜻·왜는 기사 밖 지식을 써도 되고(basis outside — 숫자·날짜가 있으면 지운다), 그래서·다음은 재료 근거(from)가 있어야 남는다. 연쇄 추론은 1단계 */
  EXPLAIN_MODE: 'show' as 'off' | 'show',
  EXPLAIN_TERMS_MAX: 3,
  EXPLAIN_TERM_MAX_CHARS: 20,
  EXPLAIN_TERM_TEXT_MAX_CHARS: 90,
  EXPLAIN_TEXT_MAX_CHARS: 200,
  /** 이 기사 묻기(v0.48) — 서버가 회차에서 조립해 넘기는 "우리가 쓴 글" 문맥의 상한. 문서용 ASK.CONTEXT_MAX_CHARS(1,500)와 따로 둔다 —
      기사 하나는 문서 전체가 아니고, 글은 전부 AI가 새로 쓴 것이라 저장해도 저작권 문제가 없다 */
  ASK_CONTEXT_MAX_CHARS: 4000,
  /** 새로 쓴 제목 최대 길이 (기획서 — 40자 이내) */
  TITLE_MAX_CHARS: 40,
  /** 회차 JSON 형식 버전 — 뷰어가 모르는 버전이면 코드 뷰어로 연다 */
  EDITION_VERSION: 1,
  /** 내 파일 최상위의 브리핑 폴더와 그 안의 수집 목록 문서 이름 */
  FOLDER_NAME: '뉴스 브리핑',
  SOURCES_FILE_NAME: '수집 목록.json',
  /** 오늘의 핵심 기사 수 — 한 화면 안에서 1분에 훑는 양 (v0.43) */
  LEAD_COUNT: 6,
  /** 오늘의 핵심 중 세계 몫 — 세계 핵심이 있으면 최소 이만큼 (영어 기사는 다른 보도가 거의 안 묶여 언론사 수로만 겨루면 밀린다) */
  LEAD_WORLD_MIN: 2,
  /** 회차 하나에서 기억하는 읽은 기사 id 상한, 한 번에 보내는 상한, id 길이 상한 (API-073 markRead) */
  READ_ITEMS_MAX: 1000,
  MARK_READ_BATCH_MAX: 200,
  ITEM_ID_MAX_CHARS: 80,
  /** 패널의 회차 목록 — 한 번에 받는 날 수 기본·최대 (API-135) */
  EDITIONS_DAYS_DEFAULT: 7,
  EDITIONS_DAYS_MAX: 31,
  /** 실행 기록 기본·최대 개수 */
  RUNS_LIST_DEFAULT: 30,
  RUNS_LIST_MAX: 100,
  /** 실행 중 진행 표시를 다시 읽는 주기 (클라이언트도 같은 값) */
  STATUS_POLL_MS: 2000,
  /** 틀린 곳 알리기 — 회차 하나에 기억하는 신고 수 상한, 메모 길이 (API-073 flag) */
  FLAG_ITEMS_MAX: 200,
  FLAG_NOTE_MAX_CHARS: 200,
  /** 앱 안 원문 보기(개선 합의안 7장) — 관리자가 설정에서 켰을 때만. 누를 때만 받고 저장하지 않는다.
      동시 1건, 20초, 짧게 뽑히면(유료벽·추출 실패) 사이트로 보낸다. 메모리 캐시는 10분·20건까지 */
  READER_TIMEOUT_MS: 20_000,
  READER_MIN_CHARS: 600,
  READER_CACHE_MS: 10 * 60 * 1000,
  READER_CACHE_MAX: 20,
  READER_MAX_PARAGRAPHS: 80,

  // ---- 구독 생성 방식 (v0.50 설계, 뉴스 브리핑 설계 "구독 생성 방식"·"정한 값") — 회차를 서버가 켠 claude.ai 예약 작업이 만든다.
  //      값의 근거는 설계 문서 표에. 1주 실측 뒤 조정 ----
  /** 회차 시작 시각 이만큼 전에 트리거 — 세션 기동 5~10분 + 수집·원문 20분 + 요약·검수 40~50분 어림 */
  SUB_LEAD_MS: 90 * 60 * 1000,
  /** 마감 = 회차 시작 + 30분 (발행 목표 07·12·18시). 지나면 running 구독 실행을 missing으로 닫는다 */
  SUB_DEADLINE_AFTER_MS: 30 * 60 * 1000,
  /** 스킬은 마감 이만큼 전이 되면 남은 기사를 줄이고 마무리해 보낸다 — 빈손보다 얇은 회차 */
  SUB_WRAPUP_BEFORE_MS: 20 * 60 * 1000,
  /** 서버가 꺼져 있다 켜졌을 때 늦게라도 트리거하는 한계 — 마감이 이만큼은 남아 있어야 */
  SUB_MIN_LEAD_MS: 60 * 60 * 1000,
  /** 트리거 HTTP 호출 — 실패하면 그 자리에서 error */
  SUB_TRIGGER_TIMEOUT_MS: 10_000,
  SUB_TRIGGER_RETRIES: 1,
  /** 트리거 주소는 claude.ai 예약 작업 공식 fire 주소만 — 임의의 https면 서버가 트리거 토큰을 아무 데나 보내는 SSRF 통로가 된다(보안 검토 2026-10-30) */
  SUB_TRIGGER_HOST: 'api.anthropic.com',
  SUB_TRIGGER_PATH: /^\/v1\/claude_code\/routines\/[A-Za-z0-9_-]+\/fire$/,
  /** 완성본 본문 상한 — Hono·Node는 기본 제한이 없어 1GB 서버가 메모리 부족으로 죽을 수 있다. 회차 JSON 실측 뒤 조정 */
  SUB_RESULT_MAX_BYTES: 2 * 1024 * 1024,
  /** 검사에서 뺀 기사가 이 비율을 넘으면 통째로 거절 — 150건 중 45건이 빠지면 회차가 아니다 */
  SUB_DROP_REJECT_RATIO: 0.3,
  /** 거절 뒤 스킬이 고쳐 다시 보내는 횟수 */
  SUB_RESEND_MAX: 2,
  /** 완성본 log 상한 — 줄 수·줄 길이 */
  SUB_LOG_MAX_LINES: 30,
  /** 진행 보고 한 줄 길이·job당 분당 건수 — 열어 둔 주소라 상한이 "없음"이면 안 된다 */
  SUB_PROGRESS_MAX_CHARS: 200,
  SUB_PROGRESS_PER_MINUTE: 20,
  /** 진행 보고 본문 크기 상한 — zod 전에 본문을 통째로 읽으므로 크기 상한이 따로 필요하다 */
  SUB_PROGRESS_MAX_BYTES: 16 * 1024,
  /** 진행 보고 버킷(job별)이 이 수를 넘으면 지난 것을 정리 — 하루 3개라 작지만 "안 지움"은 두지 않는다 */
  SUB_PROGRESS_BUCKETS_SWEEP: 50,
  /** 연결 열쇠 — dvt_ 접두어는 로그·커밋에서 눈에 띄고 secret scanning에 걸리게 */
  SUB_TOKEN_PREFIX: 'dvt_',
  SUB_TOKEN_BYTES: 32,
  /** [연결 확인] ping job의 id 접두어·수명과 "아직 연결 기록 없음" 판정 시간 */
  SUB_PING_ID_PREFIX: 'ping-',
  SUB_PING_TTL_MS: 10 * 60 * 1000,
  SUB_PING_NO_REQUEST_MS: 5 * 60 * 1000,
  /** 설정 화면의 최근 요약·시각 조정 힌트 */
  SUB_RECENT_RUNS: 7,
  SUB_HINT_LATER_RATIO: 0.5,
  SUB_HINT_EARLIER_MARGIN_MS: 10 * 60 * 1000,
  SUB_HINT_EARLIER_MISSING: 2,
  /** 지시서의 직전 회차 사건 상한 — 응답 크기 */
  SUB_PREV_STORIES_MAX: 200,
  /** 세션의 웹 검색 재료(W) — 기사당 최대 수와 최소 글자. 재료가 없는 핵심·주요 전부와 재료 2곳 미만인 핵심이 대상이다
      (서버는 비용 때문에 회차당 WEB_FILL_MAX건이지만 구독은 추가 비용이 없다 — 1회 시험 뒤 결정 2026-10-30) */
  SUB_WEB_MATERIALS_MAX: 3,
  SUB_WEB_TEXT_MIN_CHARS: 200,
  /** verify 보고의 "중복 의심" — 핵심·주요끼리 제목 글자 묶음 겹침이 이 이상이면 적는다(경고만, 빼지 않는다).
      구성 B에서 같은 사건(알파벳 폭락) 두 줄이 0.47, 다른 사건끼리는 최대 0.35였다 */
  SUB_DUP_TITLE_SIMILARITY: 0.4,
  /** 완성본 글자 상한 — zod가 본다. 제목은 TITLE_MAX_CHARS(40)보다 넉넉히(초과는 세기만 한다), 글은 칸 하나 */
  SUB_TITLE_MAX_CHARS: 120,
  SUB_TEXT_MAX_CHARS: 2000,
  SUB_URL_MAX_CHARS: 2048,
  /** 완성본 기사 수 상한과 기사당 related 입력 상한(저장은 MAX_RELATED로 자른다) */
  SUB_ITEMS_MAX: 400,
  SUB_RELATED_MAX_IN: 100,
  /** 연결 열쇠로만 들어오는 주소의 접두어 — 인증 미들웨어가 이 접두어(끝 슬래시 포함)에서만 Bearer를 받고, 그 밖에서는 무시한다 */
  SUB_JOBS_PATH_PREFIX: '/api/v1/briefing/jobs/',
  /** 열쇠 앞 몇 자를 평문으로 두나 — "어느 열쇠가 쓰였나" 표시용 */
  SUB_TOKEN_PREFIX_CHARS: 8,
  /** 완성본 검사용 허용 도메인에 늘 들어가는 것 — 통신사(WEB_FILL_WIRES)와 Google 뉴스 링크(검색 기사가 그대로 남는다) */
  SUB_CHECK_EXTRA_DOMAINS: ['news.google.com'],
} as const;
