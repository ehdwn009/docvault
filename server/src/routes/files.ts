import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_TEXT_FILE_BYTES, MAX_VERSIONS_PER_FILE } from '../constants.js';
import { db } from '../db/index.js';
import { files, fileVersions, folders } from '../db/schema.js';
import { canReadFile, canWriteFile } from '../lib/access.js';
import { fail } from '../lib/errors.js';
import { extensionOf, TEXT_EXTENSIONS } from '../lib/filetypes.js';
import { jsonBody, nameField, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

// name/folderId/sortOrder 중 보낸 필드만 갱신 (API-035: 이름 변경 / 이동 / 정렬)
const updateFileSchema = z
  .object({
    name: nameField.optional(),
    folderId: z.number().int().positive().nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => v.name !== undefined || v.folderId !== undefined || v.sortOrder !== undefined, {
    message: '변경할 필드가 없습니다',
  });

function duplicateFileName(ownerId: number, folderId: number | null, name: string, excludeId?: number) {
  const dup = db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.ownerId, ownerId),
        folderId === null ? sql`${files.folderId} IS NULL` : eq(files.folderId, folderId),
        eq(files.name, name),
      ),
    )
    .get();
  return dup !== undefined && dup.id !== excludeId;
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
      if (duplicateFileName(user.id, folderId, file.name)) {
        return fail(c, 409, 'CONFLICT', `${file.name}: 같은 폴더에 동일한 이름의 파일이 있습니다`);
      }
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
  })

  // API-035: 파일 이름 변경 / 이동 / 정렬
  .put('/:id', jsonBody(updateFileSchema), (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const patch = c.req.valid('json');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canWriteFile(user, file)) return fail(c, 403, 'FORBIDDEN', '수정 권한이 없습니다');

    let typePatch = {};
    if (patch.name !== undefined) {
      // 확장자가 바뀌면 fileType·mimeType도 함께 바뀐다. 지원 외 확장자로의 변경은 거부
      const meta = TEXT_EXTENSIONS[extensionOf(patch.name)];
      if (!meta) {
        return fail(c, 400, 'UNSUPPORTED_TYPE', `허용되지 않는 확장자입니다 (${Object.keys(TEXT_EXTENSIONS).join(', ')})`);
      }
      typePatch = meta;
    }

    // 이동 대상 폴더는 파일 소유자의 폴더여야 한다 (관리자가 남의 파일을 자기 폴더로 옮기는 것 방지)
    if (patch.folderId !== undefined && patch.folderId !== null) {
      const folder = db.select().from(folders).where(eq(folders.id, patch.folderId)).get();
      if (!folder || folder.ownerId !== file.ownerId) {
        return fail(c, 404, 'NOT_FOUND', '대상 폴더가 없습니다');
      }
    }

    const nextFolder = patch.folderId !== undefined ? patch.folderId : file.folderId;
    const nextName = patch.name ?? file.name;
    if (duplicateFileName(file.ownerId, nextFolder, nextName, id)) {
      return fail(c, 409, 'CONFLICT', '같은 폴더에 동일한 이름의 파일이 있습니다');
    }

    const updated = db
      .update(files)
      .set({
        name: nextName,
        folderId: nextFolder,
        ...typePatch,
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(files.id, id))
      .returning()
      .get();
    const { contentText: _omit, ...meta } = updated;
    return c.json(meta);
  })

  // API-036: 파일 삭제
  .delete('/:id', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canWriteFile(user, file)) return fail(c, 403, 'FORBIDDEN', '삭제 권한이 없습니다');

    db.delete(files).where(eq(files.id, id)).run();
    return c.json({ ok: true });
  })

  // API-037: 파일 복사 — 복사본은 요청자 소유가 된다 (공유 파일을 내 공간으로 가져오기 겸용)
  .post('/:id/copy', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canReadFile(user, file)) return fail(c, 403, 'FORBIDDEN', '접근 권한이 없습니다');
    if (file.contentText === null) {
      return fail(c, 400, 'VALIDATION_ERROR', '바이너리 파일 복사는 아직 지원하지 않습니다');
    }

    // 내 파일이면 같은 폴더에, 남의 공유 파일이면 내 루트에 복사한다
    const targetFolder = file.ownerId === user.id ? file.folderId : null;

    // "이름 (사본).md", 충돌 시 "이름 (사본 2).md" ...
    const ext = extensionOf(file.name);
    const stem = ext ? file.name.slice(0, -ext.length) : file.name;
    let copyName = `${stem} (사본)${ext}`;
    for (let n = 2; duplicateFileName(user.id, targetFolder, copyName); n++) {
      copyName = `${stem} (사본 ${n})${ext}`;
    }

    const now = Date.now();
    const created = db
      .insert(files)
      .values({
        ownerId: user.id,
        folderId: targetFolder,
        name: copyName,
        fileType: file.fileType,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contentText: file.contentText,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const { contentText: _omit2, ...meta } = created;
    return c.json(meta, 201);
  });
