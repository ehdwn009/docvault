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
  /** 분류·선별·참고 기사 요약 — 판단은 단순하고 양이 많다 */
  SELECT_MODEL: 'claude-haiku-4-5',
  /** 핵심·주요 기사 요약 — 양이 적고 품질이 보이는 자리 */
  SUMMARY_MODEL: 'claude-sonnet-5-5',
  /** 모델별 단가 (USD/백만 토큰) — 실행 기록의 추정 비용 계산용. 청구서가 아니라 감 잡기용 */
  PRICES: {
    'claude-haiku-4-5': { inputPerMtok: 1, outputPerMtok: 5 },
    'claude-sonnet-5-5': { inputPerMtok: 2, outputPerMtok: 10 },
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
  /** 후보 상한 — 이것이 곧 비용 상한이다 */
  MAX_CANDIDATES: 600,
  MAX_PER_SOURCE: 40,
  /** 상한으로 자를 때 범위를 이만큼의 칸으로 나눠 칸마다 고르게 남긴다 (24시간이면 2시간씩).
      최신순으로 자르면 24시간판에 마지막 90분 기사만 남았다 (설계 "① 수집") */
  SPREAD_SLOTS: 12,
  /** 분야당 최대 기사 수 — 경제·IT·테크 계열(wide)과 나머지 (기획서 5~7 / 3~5의 상한) */
  MAX_ITEMS_WIDE: 7,
  MAX_ITEMS_NARROW: 5,
  /** 분류 한 번에 보내는 기사 수 */
  CLASSIFY_CHUNK: 80,
  /** 요약 한 번에 보내는 기사 수 — 기사마다 원문 앞부분이 붙고 답도 칸 구성으로 길어져 15 → 8 (v0.43) */
  SUMMARY_CHUNK: 8,
  /** 동시 실행 수 — 1GB e2-micro와 API 속도 제한 사이 */
  FETCH_CONCURRENCY: 8,
  SELECT_CONCURRENCY: 5,
  SUMMARY_CONCURRENCY: 4,
  /** 피드 하나의 요청 시간·크기 상한 — 느린 피드 하나가 전체를 붙잡지 않게 */
  FETCH_TIMEOUT_MS: 10_000,
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
  /** 모음 기사(여러 사건을 한 페이지에 모은 헤드라인·주요뉴스·브리핑) 거르기 — lib/briefing/roundup.ts (2026-10-02).
      말머리([…]) 안에 이 낱말이 있으면 모음 기사. "헤드라인 물가"처럼 낱말 자체는 기사 제목에도 쓰여 말머리 안에서만 본다. "이 시각"·"출근길"은 넣지 않는다 — [이 시각 세계]·[출근길 인터뷰]는 사건 하나짜리 기사다 */
  ROUNDUP_TAG_WORDS: ['헤드라인', '주요뉴스', '주요 뉴스', '뉴스요약', '뉴스 요약', '간추린', '모아보기', '조간', '석간', '모닝브리핑', '모닝 브리핑', '뉴스브리핑', '뉴스 브리핑'],
  /** 말머리 없이 제목에 있어도 모음 기사로 보는 문구 */
  ROUNDUP_TITLE_PHRASES: ['이 시각 헤드라인', '이시각 헤드라인', '오늘의 주요뉴스', '오늘의 주요 뉴스', '주요뉴스 모음', '주요 뉴스 모음'],
  /** 원문에 "전문보기" 링크나 ■ 소제목이 이만큼 이상이면 모음 기사 */
  ROUNDUP_MIN_SECTIONS: 3,
  /** 이번 달(한국시간) 추정 비용 한도 — 넘으면 자동 생성 정지, 버튼은 확인 후 진행 */
  MONTHLY_BUDGET_USD: 80,
  /** 분류·선별 답 길이 상한 (토큰) */
  SELECT_MAX_OUTPUT_TOKENS: 8000,
  SUMMARY_MAX_OUTPUT_TOKENS: 8000,
  /** 원문 읽기(설계 "③-1 근거 보강") — 이 중요도 이상만, 본문 앞부분 몇 자까지, 한 곳당 시간·크기, 동시 개수, 기사당 시도할 주소 수.
      주요(2)까지 읽는다 — 펼침을 칸 구성으로 길게 쓰려면 재료가 있어야 한다. 발췌만으로는 제목을 되풀이했다 (v0.43) */
  BODY_FETCH_MIN_IMPORTANCE: 2,
  BODY_MAX_CHARS: 2000,
  BODY_FETCH_TIMEOUT_MS: 8000,
  BODY_FETCH_MAX_BYTES: 1536 * 1024,
  BODY_FETCH_CONCURRENCY: 6,
  BODY_FETCH_TRIES: 2,
  /** 본문 문단으로 칠 최소 길이 — 메뉴·저작권 표시 같은 짧은 줄을 거른다 */
  BODY_MIN_PARAGRAPH_CHARS: 30,
  /** 발췌가 제목을 되풀이할 뿐인지 볼 때, 제목을 빼고 남아야 하는 글자 수 */
  SNIPPET_MIN_EXTRA_CHARS: 20,
  /** 기사 하나에 붙이는 "같은 사건 다른 보도" 링크 수 상한 */
  MAX_RELATED: 5,
  /** 핵심·주요 펼침(무슨 일·배경·숫자로 보면·앞으로)을 합친 목표 길이 (글자, 사용자 결정 v0.43) */
  DETAIL_MIN_CHARS: 200,
  DETAIL_MAX_CHARS: 300,
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
} as const;
