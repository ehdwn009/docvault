import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
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
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      name, content_text,
      content='files', content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS files_fts_ai AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, name, content_text)
      VALUES (new.id, new.name, coalesce(new.content_text, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS files_fts_ad AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, name, content_text)
      VALUES ('delete', old.id, old.name, coalesce(old.content_text, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, name, content_text)
      VALUES ('delete', old.id, old.name, coalesce(old.content_text, ''));
      INSERT INTO files_fts(rowid, name, content_text)
      VALUES (new.id, new.name, coalesce(new.content_text, ''));
    END;
  `);
}
