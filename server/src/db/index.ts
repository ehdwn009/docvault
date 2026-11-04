import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import { FTS_INDEX_MAX_CHARS } from '../constants.js';
import * as schema from './schema.js';

fs.mkdirSync(path.join(config.dataDir, 'files'), { recursive: true });

const sqlite = new Database(path.join(config.dataDir, 'docvault.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'drizzle',
);

/** 서버 기동 시 1회: 마이그레이션 → FTS5 인덱스·트리거 준비 */
export function initDb() {
  migrate(db, { migrationsFolder });

  // FTS5는 Drizzle 스키마 밖의 파생 인덱스 (ERD 비고). files 변경 시 트리거로 동기화.
  // 색인 원본은 files가 아니라 뷰 files_fts_src — 본문 앞 FTS_INDEX_MAX_CHARS 글자만 보인다. 트리거·rebuild·snippet이
  // 전부 같은 뷰를 읽어야 색인이 어긋나지 않는다 (외부 내용 FTS는 'delete'에 넣은 값이 넣었을 때와 같아야 한다).
  // 버전 표식(FTS_VERSION)이 다르면 색인을 지우고 다시 만든다 — 2026-11-05 전엔 본문 전체를 색인했다.
  const FTS_VERSION = 'v2-prefix';
  const current = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'files_fts'").get() as { sql?: string } | undefined;
  const upToDate = !!current?.sql?.includes(FTS_VERSION);
  if (!upToDate) {
    sqlite.exec(`
      DROP TRIGGER IF EXISTS files_fts_ai;
      DROP TRIGGER IF EXISTS files_fts_ad;
      DROP TRIGGER IF EXISTS files_fts_au;
      DROP TABLE IF EXISTS files_fts;
      DROP VIEW IF EXISTS files_fts_src;
    `);
  }
  sqlite.exec(`
    CREATE VIEW IF NOT EXISTS files_fts_src AS
      SELECT id, name, substr(coalesce(content_text, ''), 1, ${FTS_INDEX_MAX_CHARS}) AS content_text FROM files;

    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      name, content_text,
      content='files_fts_src', content_rowid='id'
      /* ${FTS_VERSION} */
    );

    CREATE TRIGGER IF NOT EXISTS files_fts_ai AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, name, content_text)
      VALUES (new.id, new.name, substr(coalesce(new.content_text, ''), 1, ${FTS_INDEX_MAX_CHARS}));
    END;

    CREATE TRIGGER IF NOT EXISTS files_fts_ad AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, name, content_text)
      VALUES ('delete', old.id, old.name, substr(coalesce(old.content_text, ''), 1, ${FTS_INDEX_MAX_CHARS}));
    END;

    -- 이름·본문이 바뀔 때만. 휴지통(deleted_at)·즐겨찾기·폴더 이동은 색인과 무관한데도 23MB를 다시 쪼개고 있었다
    CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE OF name, content_text ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, name, content_text)
      VALUES ('delete', old.id, old.name, substr(coalesce(old.content_text, ''), 1, ${FTS_INDEX_MAX_CHARS}));
      INSERT INTO files_fts(rowid, name, content_text)
      VALUES (new.id, new.name, substr(coalesce(new.content_text, ''), 1, ${FTS_INDEX_MAX_CHARS}));
    END;
  `);
  if (!upToDate) {
    const started = Date.now();
    sqlite.exec("INSERT INTO files_fts(files_fts) VALUES ('rebuild')");
    console.log(`[docvault] rebuilt search index (${FTS_VERSION}) in ${Date.now() - started}ms`);
  }
}
