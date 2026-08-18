import {
  integer,
  primaryKey,
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
  fileType: text('file_type', { enum: ['md', 'html', 'code', 'text', 'image', 'pdf'] }).notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  /** 텍스트 계열만. 바이너리는 null */
  contentText: text('content_text'),
  /** 바이너리만. 텍스트는 null. data/files/{ownerId}/{uuid} */
  storagePath: text('storage_path'),
  isShared: integer('is_shared').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  /** 휴지통 이동 시각. null이면 정상 파일. 보관 기한이 지나면 서버가 자동 영구 삭제한다 */
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

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
  },
  (t) => [primaryKey({ columns: [t.userId, t.fileId] })],
);

export const userSettings = sqliteTable('user_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  viewerTheme: text('viewer_theme', { enum: ['light', 'dark', 'sepia'] })
    .notNull()
    .default('light'),
  fontSize: integer('font_size').notNull().default(16),
  fontFamily: text('font_family'),
  lineHeight: text('line_height'),
  contentWidth: text('content_width', { enum: ['narrow', 'normal', 'wide'] })
    .notNull()
    .default('normal'),
  /** 패치노트 모달용 — 마지막으로 확인한 앱 버전. 기기 간 동기화되어 한 번 본 공지는 다시 안 뜬다 */
  lastSeenVersion: text('last_seen_version'),
  updatedAt: integer('updated_at').notNull(),
});
