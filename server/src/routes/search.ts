import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { canReadFile } from '../lib/access.js';
import { fail } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

type SearchRow = {
  id: number;
  name: string;
  fileType: string;
  folderId: number | null;
  ownerId: number;
  isShared: number;
  snippet: string;
};

/** 사용자 입력을 FTS5 MATCH 문법으로부터 보호 — 각 단어를 따옴표로 감싸고 접두 검색(*)을 붙인다 */
function toFtsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(' ');
}

// API-081: 파일명 + 본문 통합 전문 검색 (FTS5)
export const searchRoutes = new Hono<AppEnv>().get('/', (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return fail(c, 400, 'VALIDATION_ERROR', 'q: 검색어가 필요합니다');

  let rows: SearchRow[];
  try {
    rows = db.all<SearchRow>(sql`
      SELECT f.id, f.name, f.file_type AS fileType, f.folder_id AS folderId,
             f.owner_id AS ownerId, f.is_shared AS isShared,
             snippet(files_fts, 1, '[', ']', '…', 12) AS snippet
      FROM files_fts
      JOIN files f ON f.id = files_fts.rowid
      WHERE files_fts MATCH ${toFtsQuery(q)}
        AND f.deleted_at IS NULL
      ORDER BY bm25(files_fts)
      LIMIT 30
    `);
  } catch {
    // FTS 문법 오류로 취급되는 입력은 결과 없음으로 처리
    rows = [];
  }

  return c.json({
    results: rows
      .filter((r) => canReadFile(user, r))
      .map(({ ownerId: _o, ...rest }) => rest),
  });
});
