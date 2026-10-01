import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// 타임스탬프는 전부 unix epoch 밀리초 정수(UTC). 표시 시점에 로컬 변환한다. (ERD 비고)

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastSignedIn: integer('last_signed_in'),
  /** 이 시각보다 먼저 발급된 세션 토큰은 무효 — 비밀번호 변경·강제 로그아웃 시 갱신한다.
      JWT는 서버에 상태를 두지 않아 토큰을 개별 취소할 수 없으므로, "언제 이후 것만 유효"로 끊는다 */
  sessionEpoch: integer('session_epoch').notNull().default(0),
});

export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: integer('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id').references((): AnySQLiteColumn => folders.id, {
    onDelete: 'cascade',
  }),
  name: text('name').notNull(),
  isShared: integer('is_shared').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const files = sqliteTable('files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: integer('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  folderId: integer('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // enum은 TS 타입 제약일 뿐 SQLite에 CHECK를 만들지 않는다 — 값 추가에 마이그레이션 불필요
  fileType: text('file_type', {
    enum: ['md', 'html', 'code', 'text', 'image', 'pdf', 'audio', 'video', 'binary'],
  }).notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  /** 텍스트 계열만. 바이너리는 null */
  contentText: text('content_text'),
  /** 바이너리만. 텍스트는 null. data/files/{ownerId}/{uuid} */
  storagePath: text('storage_path'),
  isShared: integer('is_shared').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  /** doc=보통 문서, card=배움 카드(2판), briefing=뉴스 브리핑 회차. 카드는 md 파일이지만 파일 트리에는 안 나오고
      서랍(SCR-181)에서만 보인다. 브리핑은 본문이 회차 JSON인 code 파일이고 트리에 나온다 — 보관함이 곧 트리 (뉴스 브리핑 설계) */
  kind: text('kind', { enum: ['doc', 'card', 'briefing'] }).notNull().default('doc'),
  /** 휴지통 이동 시각. null이면 정상 파일. 보관 기한이 지나면 서버가 자동 영구 삭제한다 */
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
},
  // 트리(API-021)·카드 목록이 쓰는 칸만 모은 커버링 인덱스 — 본문(content_text)이 같은 행에 있어서, 인덱스 없이는
  // 목록 한 번이 DB 전체 읽기가 된다 (e2-micro에서 /tree 2.85초). 이 인덱스로는 본문을 아예 안 건드린다
  (t) => [index('files_owner_kind_idx').on(t.ownerId, t.kind, t.deletedAt, t.folderId, t.name, t.fileType, t.sizeBytes, t.isShared, t.sortOrder, t.updatedAt)],
);

export const fileVersions = sqliteTable('file_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fileId: integer('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  savedBy: integer('saved_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  contentText: text('content_text').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: integer('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const fileTags = sqliteTable(
  'file_tags',
  {
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.tagId] })],
);

/** 사용자×파일별 개인 상태 — 즐겨찾기·읽던 위치·최근 열람. 기기 간 동기화의 핵심. */
export const userFileState = sqliteTable(
  'user_file_state',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    isFavorite: integer('is_favorite').notNull().default(0),
    /** { anchor: "헤딩 slug", offset: number } JSON */
    readingPosition: text('reading_position'),
    lastOpenedAt: integer('last_opened_at'),
    /** HTML 뷰어의 화면 맞춤 보정 사용 여부 — 문서가 아니라 "이 사람이 이 문서를 보는 방식"이라 여기 둔다 */
    viewerFit: integer('viewer_fit').notNull().default(1),
    /** 이 파일만의 글자 크기 배율(%). NULL이면 전역 기본값(user_settings.html_font_scale)을 따른다 */
    fontScale: integer('font_scale'),
    /** 복습 예정 시각 (카드 전용, 배움 카드 활용 ③). NULL이면 아직 복습 안 함 — 만든 날 + 1일에 첫 복습 */
    nextReviewAt: integer('next_review_at'),
    /** 마지막 채점으로 정해진 간격(일). 알았다 → 두 배, 몰랐다 → 1 */
    reviewIntervalDays: integer('review_interval_days').notNull().default(0),
    /** 브리핑 회차에서 읽은 기사 id JSON 배열. NULL=안 읽음. 더하기만 한다 — 두 기기에서 동시에 읽어도 서로 지우지 않게 (v0.43) */
    readItems: text('read_items'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fileId] })],
);

export const userSettings = sqliteTable('user_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  viewerTheme: text('viewer_theme', { enum: ['light', 'sepia', 'green', 'gray', 'dark', 'night'] })
    .notNull()
    .default('light'),
  fontSize: integer('font_size').notNull().default(16),
  /** HTML 문서 글자 크기의 전역 기본 배율(%) — 파일별 값이 없을 때 쓰인다 */
  htmlFontScale: integer('html_font_scale').notNull().default(100),
  fontFamily: text('font_family'),
  lineHeight: text('line_height'),
  contentWidth: text('content_width', { enum: ['narrow', 'normal', 'wide'] })
    .notNull()
    .default('normal'),
  /** 패치노트 모달용 — 마지막으로 확인한 앱 버전. 기기 간 동기화되어 한 번 본 공지는 다시 안 뜬다 */
  lastSeenVersion: text('last_seen_version'),
  /** 문서 속 내 카드 용어에 점선 밑줄 (배움 카드 활용 ②). 읽기 취향이라 기기가 아니라 사람에 붙는다. 1=켬 */
  termHighlight: integer('term_highlight').notNull().default(1),
  /** 질문할 때 관련 배움 카드를 문맥으로 함께 보낼지 (활용 ④). 1=켬 */
  askWithCards: integer('ask_with_cards').notNull().default(1),
  /** 뉴스 브리핑 자동 생성 전체 스위치. 관리자에게만 의미가 있다. 기본 꺼짐 — 켜야 돈이 나간다 */
  briefingAuto: integer('briefing_auto').notNull().default(0),
  /** 자동 생성 회차별 켜기·시작 시각 JSON {"morning":{"on":true,"at":"06:30"},…}. null이면 기본(06:30·11:30·17:30 모두 켬) (v0.43) */
  briefingSchedule: text('briefing_schedule'),
  updatedAt: integer('updated_at').notNull(),
});

/** 문서를 읽다 LLM에게 물어본 대화 하나 (배움 카드 1판). 2판의 카드가 "원 대화"·"출처"로 쓴다 */
export const askThreads = sqliteTable('ask_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: integer('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // SET NULL: 문서를 지워도 대화는 남는다 — 카드는 문서보다 오래 산다 (설계 흐름 D)
  fileId: integer('file_id').references(() => files.id, { onDelete: 'set null' }),
  /** 시작 때 드래그한 문장 — 출처 인용. 드래그 없이 시작하면 null */
  quote: text('quote'),
  /** 선택 문장 앞뒤 문단 — LLM에 보낸 문맥 전부. 문서 전체는 절대 여기 들어오지 않는다 */
  context: text('context'),
  /** 첫 질문 앞 60자 — 지난 대화 목록용 */
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  /** 마지막 메시지 시각 — 30일 정리의 기준 */
  updatedAt: integer('updated_at').notNull(),
  /** 대화 정리(API-116) 결과 JSON — 창을 닫았다 열어도 다시 만들지 않게. 카드로 저장하면 지운다 */
  outlineJson: text('outline_json'),
  /** 정리 결과를 만든 시각 — updated_at보다 오래됐으면 "그 뒤에 답이 붙었다" */
  outlineAt: integer('outline_at'),
  /** 이 대화의 답변 모델(ASK_MODELS.id). NULL이면 기본(ASK.DEFAULT_MODEL). 칩에서 바꾸면 다음 답부터 (v0.40) */
  model: text('model'),
});

export const askMessages = sqliteTable('ask_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  threadId: integer('thread_id')
    .notNull()
    .references(() => askThreads.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  /** 답(assistant) 행에만: LLM 사용량. 관리자 "AI 사용량" 탭의 비용 추정 근거 (v0.25). user 행은 null */
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  webSearches: integer('web_searches'),
  /** 답(assistant) 행만: 그 답을 낸 모델. NULL이면 v0.40 이전 = Opus. 답 아래 표시와 모델별 비용 추정에 쓴다 */
  model: text('model'),
  createdAt: integer('created_at').notNull(),
});

/** 카드 ↔ 대화. 한 대화에서 카드 여럿, 한 카드에 대화 여럿(재구성으로 합쳐질 때).
    카드가 참조하는 대화는 30일 정리에서 빠진다 — 카드의 "원 대화"로 계속 산다 (설계 원칙) */
export const cardThreads = sqliteTable(
  'card_threads',
  {
    cardFileId: integer('card_file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    threadId: integer('thread_id')
      .notNull()
      .references(() => askThreads.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardFileId, t.threadId] })],
);

/** 뉴스 브리핑을 만든 실행 한 번 — 진행 상태·실패 이유·사용량·비용·다룬 범위. 회차 내용은 files의 문서에 있다.
    다음 회차의 범위는 직전 ok 실행의 until_at부터 — 문서를 지우거나 옮겨도 흔들리지 않게 파일이 아니라 여기서 읽는다 */
export const briefingRuns = sqliteTable(
  'briefing_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trigger: text('trigger', { enum: ['manual', 'auto'] }).notNull(),
    slot: text('slot', { enum: ['morning', 'noon', 'evening', 'adhoc'] }).notNull(),
    /** 한국시간 날짜 YYYY-MM-DD — 자동 회차가 하루에 한 번만 돌게 하는 기준 */
    editionDate: text('edition_date').notNull(),
    /** cancelled = 사람이 [중지]로 멈춤 (2026-10-02). 실패(error)와 나눠 화면이 빨갛게 보이지 않게 */
    status: text('status', { enum: ['running', 'ok', 'error', 'skipped', 'cancelled'] }).notNull(),
    stage: text('stage', { enum: ['collect', 'classify', 'select', 'read', 'summarize', 'save'] }),
    progressDone: integer('progress_done').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    sinceAt: integer('since_at').notNull(),
    untilAt: integer('until_at').notNull(),
    // SET NULL: 회차 문서를 지워도 실행 기록(비용)은 남는다 — 월 합계가 문서 삭제로 줄면 안 된다
    fileId: integer('file_id').references(() => files.id, { onDelete: 'set null' }),
    sourceCount: integer('source_count').notNull().default(0),
    /** 실패한 출처 이름 JSON 배열 */
    failedSources: text('failed_sources'),
    candidateCount: integer('candidate_count').notNull().default(0),
    itemCount: integer('item_count').notNull().default(0),
    haikuInputTokens: integer('haiku_input_tokens').notNull().default(0),
    haikuOutputTokens: integer('haiku_output_tokens').notNull().default(0),
    sonnetInputTokens: integer('sonnet_input_tokens').notNull().default(0),
    sonnetOutputTokens: integer('sonnet_output_tokens').notNull().default(0),
    /** 그때의 단가로 계산해 둔 추정 비용 — 단가가 나중에 바뀌어도 "그때 얼마로 봤나"가 남는다 */
    costUsd: real('cost_usd').notNull().default(0),
    /** 실패·건너뜀 이유 (사람이 읽는 글) */
    message: text('message'),
    /** 오늘의 핵심 기사 id JSON 배열 — 회차 JSON의 lead 사본. 패널이 회차마다 JSON을 열지 않고 핵심 읽음을 세려고 (v0.43) */
    leadIds: text('lead_ids'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('briefing_runs_owner_started_idx').on(t.ownerId, t.startedAt)],
);
