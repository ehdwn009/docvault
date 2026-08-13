import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_TEXT_FILE_BYTES, MAX_VERSIONS_PER_FILE } from '../constants.js';
import { db } from '../db/index.js';
import { files, fileVersions, folders } from '../db/schema.js';
import { canReadFile, canWriteFile } from '../lib/access.js';
import { fail } from '../lib/errors.js';
import { jsonBody } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

/** v1 허용 확장자 (API-031). 형식 확장 시 이 맵에만 추가한다 (아키텍처 — 확장 로드맵) */
const TEXT_EXTENSIONS: Record<string, { fileType: 'md' | 'html' | 'text'; mimeType: string }> = {
  '.md': { fileType: 'md', mimeType: 'text/markdown' },
  '.markdown': { fileType: 'md', mimeType: 'text/markdown' },
  '.html': { fileType: 'html', mimeType: 'text/html' },
  '.txt': { fileType: 'text', mimeType: 'text/plain' },
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const saveContentSchema = z.object({
  content: z.string(),
  // 편집 시작 시점의 updatedAt — 다른 기기에서 먼저 저장했으면 충돌로 거부 (API-034)
  baseUpdatedAt: z.number().int(),
});

export const fileRoutes = new Hono<AppEnv>()

  // API-031: 파일 업로드 (multipart, 여러 파일 동시 지원)
  .post('/', async (c) => {
    const user = c.get('user');
    const body = await c.req.parseBody({ all: true });

    const raw = body['files'];
    const uploads = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
    if (uploads.length === 0) {
      return fail(c, 400, 'VALIDATION_ERROR', 'files: 업로드할 파일이 없습니다');
    }

    let folderId: number | null = null;
    if (typeof body['folderId'] === 'string' && body['folderId'] !== '') {
      folderId = parseId(body['folderId']);
      if (folderId === null) return fail(c, 400, 'VALIDATION_ERROR', 'folderId: 올바르지 않은 값');
      const folder = db.select().from(folders).where(eq(folders.id, folderId)).get();
      if (!folder || folder.ownerId !== user.id) {
        return fail(c, 404, 'NOT_FOUND', '대상 폴더가 없습니다');
      }
    }

    // 저장 전에 전체 파일을 먼저 검증한다 — 일부만 올라가는 어중간한 결과를 만들지 않기 위해
    for (const file of uploads) {
      const ext = extensionOf(file.name);
      if (!TEXT_EXTENSIONS[ext]) {
        return fail(c, 400, 'UNSUPPORTED_TYPE', `${file.name}: 허용되지 않는 형식입니다 (${Object.keys(TEXT_EXTENSIONS).join(', ')})`);
      }
      if (file.size > MAX_TEXT_FILE_BYTES) {
        return fail(c, 413, 'PAYLOAD_TOO_LARGE', `${file.name}: 텍스트 파일은 10MB까지 가능합니다`);
      }
      const dup = db
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.ownerId, user.id), folderId === null ? sql`${files.folderId} IS NULL` : eq(files.folderId, folderId), eq(files.name, file.name)))
        .get();
      if (dup) return fail(c, 409, 'CONFLICT', `${file.name}: 같은 폴더에 동일한 이름의 파일이 있습니다`);
    }

    const now = Date.now();
    const created = [];
    for (const file of uploads) {
      const { fileType, mimeType } = TEXT_EXTENSIONS[extensionOf(file.name)]!;
      const contentText = await file.text();
      const row = db
        .insert(files)
        .values({
          ownerId: user.id,
          folderId,
          name: file.name,
          fileType,
          mimeType,
          sizeBytes: file.size,
          contentText,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      created.push({
        id: row.id,
        folderId: row.folderId,
        name: row.name,
        fileType: row.fileType,
        sizeBytes: row.sizeBytes,
        isShared: row.isShared,
        sortOrder: row.sortOrder,
        updatedAt: row.updatedAt,
        tags: [] as number[],
        state: { isFavorite: 0, lastOpenedAt: null },
      });
    }

    return c.json({ files: created }, 201);
  })

  // API-032: 파일 메타 조회 (정보 모달용)
  .get('/:id', (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canReadFile(c.get('user'), file)) return fail(c, 403, 'FORBIDDEN', '접근 권한이 없습니다');

    const { contentText: _omit, ...meta } = file;
    return c.json(meta);
  })

  // API-033: 텍스트 본문 조회
  .get('/:id/content', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canReadFile(user, file)) return fail(c, 403, 'FORBIDDEN', '접근 권한이 없습니다');
    if (file.contentText === null) {
      return fail(c, 400, 'VALIDATION_ERROR', '바이너리 파일은 /raw로 받아야 합니다');
    }

    return c.json({
      id: file.id,
      fileType: file.fileType,
      content: file.contentText,
      updatedAt: file.updatedAt,
      readonly: !canWriteFile(user, file),
    });
  })

  // API-034: 본문 저장 — 스냅샷·갱신·버전 정리를 한 트랜잭션으로 (아키텍처 — 편집 저장 흐름)
  .put('/:id/content', jsonBody(saveContentSchema), (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const { content, baseUpdatedAt } = c.req.valid('json');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canWriteFile(user, file)) return fail(c, 403, 'FORBIDDEN', '수정 권한이 없습니다');
    if (file.contentText === null) {
      return fail(c, 400, 'VALIDATION_ERROR', '바이너리 파일은 본문 저장을 지원하지 않습니다');
    }
    if (file.updatedAt !== baseUpdatedAt) {
      return fail(c, 409, 'EDIT_CONFLICT', '다른 곳에서 먼저 수정되었습니다. 최신 내용을 확인하세요');
    }

    const now = Date.now();
    const result = db.transaction((tx) => {
      // 저장 전 현재 본문을 스냅샷 — 복원 지점이 된다
      const version = tx
        .insert(fileVersions)
        .values({
          fileId: file.id,
          savedBy: user.id,
          contentText: file.contentText!,
          sizeBytes: file.sizeBytes,
          createdAt: now,
        })
        .returning({ id: fileVersions.id })
        .get();

      tx.update(files)
        .set({ contentText: content, sizeBytes: Buffer.byteLength(content, 'utf8'), updatedAt: now })
        .where(eq(files.id, file.id))
        .run();

      // 파일당 최근 N개만 유지, 초과분은 오래된 것부터 삭제 (ERD)
      tx.run(sql`
        DELETE FROM file_versions
        WHERE file_id = ${file.id}
          AND id NOT IN (
            SELECT id FROM file_versions
            WHERE file_id = ${file.id}
            ORDER BY id DESC
            LIMIT ${MAX_VERSIONS_PER_FILE}
          )
      `);

      return { updatedAt: now, versionId: version.id };
    });

    return c.json(result);
  });
