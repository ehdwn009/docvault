import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { and, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_ID_PARAMS,
  MAX_BINARY_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_VERSIONS_PER_FILE,
} from '../constants.js';
import { db } from '../db/index.js';
import { files, fileTags, fileVersions, folders, tags } from '../db/schema.js';
import { canReadFile, canWriteFile } from '../lib/access.js';
import {
  ArchiveTooLargeError,
  buildManifest,
  collectArchiveEntries,
  createArchiveStream,
  type ArchiveEntry,
  type ArchiveScope,
} from '../lib/archive.js';
import { fail } from '../lib/errors.js';
import { ALL_EXTENSIONS, extensionOf } from '../lib/filetypes.js';
import { binaryAbsPath, copyBinary, deleteBinary, saveBinary } from '../lib/storage.js';
import { jsonBody, nameField, parseId, parseIdList } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

/** 응답용 파일 메타 — 본문과 내부 저장 경로는 절대 노출하지 않는다 */
function toFileMeta(row: typeof files.$inferSelect) {
  const { contentText: _c, storagePath: _s, ...meta } = row;
  return meta;
}

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
        isNull(files.deletedAt), // 휴지통의 파일은 이름을 점유하지 않는다
      ),
    )
    .get();
  return dup !== undefined && dup.id !== excludeId;
}

/** 내려받는 ZIP의 이름. 폴더 하나만 받을 때는 그 폴더 이름을 그대로 써서 무엇을 받았는지 남긴다 */
function archiveFileName(scope: ArchiveScope, entries: ArchiveEntry[]): string {
  const d = new Date(); // 파일 이름은 보는 사람 기준이 자연스러우므로 로컬 날짜로
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  if (scope.all) return `docvault-전체-${stamp}.zip`;
  if (scope.folderIds.length === 1 && scope.fileIds.length === 0) {
    const folder = db
      .select({ name: folders.name })
      .from(folders)
      .where(eq(folders.id, scope.folderIds[0]!))
      .get();
    if (folder) return `${folder.name}.zip`;
  }
  return `docvault-${entries.length}개-${stamp}.zip`;
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
      const meta = ALL_EXTENSIONS[extensionOf(file.name)];
      if (!meta) {
        return fail(c, 400, 'UNSUPPORTED_TYPE', `${file.name}: 허용되지 않는 형식입니다 (${Object.keys(ALL_EXTENSIONS).join(', ')})`);
      }
      const isBinary = meta.fileType === 'image' || meta.fileType === 'pdf';
      if (file.size > (isBinary ? MAX_BINARY_FILE_BYTES : MAX_TEXT_FILE_BYTES)) {
        return fail(c, 413, 'PAYLOAD_TOO_LARGE', `${file.name}: ${isBinary ? '바이너리는 50MB' : '텍스트는 10MB'}까지 가능합니다`);
      }
      if (duplicateFileName(user.id, folderId, file.name)) {
        return fail(c, 409, 'CONFLICT', `${file.name}: 같은 폴더에 동일한 이름의 파일이 있습니다`);
      }
    }

    const now = Date.now();
    const created = [];
    for (const file of uploads) {
      const { fileType, mimeType } = ALL_EXTENSIONS[extensionOf(file.name)]!;
      const isBinary = fileType === 'image' || fileType === 'pdf';
      // 텍스트는 DB 본문, 바이너리는 디스크 + 경로만 (아키텍처 — 저장 전략)
      const contentText = isBinary ? null : await file.text();
      const storagePath = isBinary
        ? saveBinary(user.id, Buffer.from(await file.arrayBuffer()))
        : null;
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
          storagePath,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      created.push({
        ...toFileMeta(row),
        tags: [] as number[],
        state: { isFavorite: 0, lastOpenedAt: null, readingPosition: null, viewerFit: 1, fontScale: null },
      });
    }

    return c.json({ files: created }, 201);
  })

  // API-044: 휴지통 목록 — 내 파일만
  .get('/trash', (c) => {
    const user = c.get('user');
    const rows = db
      .select({
        id: files.id,
        name: files.name,
        fileType: files.fileType,
        sizeBytes: files.sizeBytes,
        deletedAt: files.deletedAt,
      })
      .from(files)
      .where(and(eq(files.ownerId, user.id), isNotNull(files.deletedAt)))
      .orderBy(desc(files.deletedAt))
      .all();
    return c.json({ files: rows });
  })

  // API-045: 휴지통 비우기 — 내 휴지통 전체 영구 삭제
  .delete('/trash', (c) => {
    const user = c.get('user');
    const rows = db
      .select({ id: files.id, storagePath: files.storagePath })
      .from(files)
      .where(and(eq(files.ownerId, user.id), isNotNull(files.deletedAt)))
      .all();
    for (const row of rows) {
      db.delete(files).where(eq(files.id, row.id)).run();
      deleteBinary(row.storagePath);
    }
    return c.json({ ok: true, purged: rows.length });
  })

  // API-040: 선택·폴더·전체를 ZIP 하나로 내보내기.
  // /:id 계열보다 먼저 등록해야 'archive'가 id로 잡히지 않는다 (/trash와 같은 이유)
  .get('/archive', (c) => {
    const user = c.get('user');
    const fileIds = parseIdList(c.req.query('files'), MAX_ARCHIVE_ID_PARAMS);
    const folderIds = parseIdList(c.req.query('folders'), MAX_ARCHIVE_ID_PARAMS);
    if (fileIds === null || folderIds === null) {
      return fail(c, 400, 'VALIDATION_ERROR', `files/folders: 올바르지 않은 id 목록입니다 (최대 ${MAX_ARCHIVE_ID_PARAMS}개)`);
    }
    const scope: ArchiveScope = { fileIds, folderIds, all: c.req.query('all') === '1' };
    if (!scope.all && fileIds.length === 0 && folderIds.length === 0) {
      return fail(c, 400, 'VALIDATION_ERROR', '내보낼 대상이 없습니다');
    }

    let entries: ArchiveEntry[];
    try {
      entries = collectArchiveEntries(user, scope);
    } catch (err) {
      if (err instanceof ArchiveTooLargeError) {
        return fail(c, 413, 'PAYLOAD_TOO_LARGE', `한 번에 ${MAX_ARCHIVE_ENTRIES}개까지 내보낼 수 있습니다`);
      }
      throw err;
    }
    if (entries.length === 0) return fail(c, 404, 'NOT_FOUND', '내보낼 파일이 없습니다');

    const manifest = c.req.query('manifest') === '1' ? buildManifest(user, entries) : null;
    const name = archiveFileName(scope, entries);
    c.header('Content-Type', 'application/zip');
    c.header('Cache-Control', 'no-store');
    // 한글 이름은 filename*(RFC 5987)로, 못 읽는 옛 클라이언트를 위해 ASCII 이름도 함께 준다
    c.header(
      'Content-Disposition',
      `attachment; filename="docvault-export.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    // 스트리밍 — 전체를 메모리에 쌓지 않으므로 Content-Length는 알 수 없다
    return c.body(Readable.toWeb(createArchiveStream(entries, manifest)) as ReadableStream);
  })

  // API-038: 원본 다운로드 / 바이너리 스트리밍
  .get('/:id/raw', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canReadFile(user, file)) return fail(c, 403, 'FORBIDDEN', '접근 권한이 없습니다');

    c.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    // 스크립트가 실행될 수 있는 형식(html·svg 등)은 문서로 직접 열려도 무해하도록 격리
    if (file.mimeType === 'image/svg+xml' || file.contentText !== null) {
      c.header('Content-Security-Policy', 'sandbox');
    }

    if (file.storagePath) {
      c.header('Content-Type', file.mimeType);
      c.header('Content-Length', String(file.sizeBytes));
      const stream = Readable.toWeb(createReadStream(binaryAbsPath(file.storagePath)));
      return c.body(stream as ReadableStream);
    }
    return c.text(file.contentText ?? '', 200, {
      'Content-Type': `${file.mimeType}; charset=utf-8`,
    });
  })

  // API-032: 파일 메타 조회 (정보 모달용)
  .get('/:id', (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canReadFile(c.get('user'), file)) return fail(c, 403, 'FORBIDDEN', '접근 권한이 없습니다');

    return c.json(toFileMeta(file));
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
      const meta = ALL_EXTENSIONS[extensionOf(patch.name)];
      if (!meta) {
        return fail(c, 400, 'UNSUPPORTED_TYPE', `허용되지 않는 확장자입니다 (${Object.keys(ALL_EXTENSIONS).join(', ')})`);
      }
      // 저장 방식이 갈리는 경계(텍스트↔바이너리)는 이름 변경으로 넘을 수 없다
      const wasBinary = file.storagePath !== null;
      const willBeBinary = meta.fileType === 'image' || meta.fileType === 'pdf';
      if (wasBinary !== willBeBinary || (wasBinary && meta.fileType !== file.fileType)) {
        return fail(c, 400, 'UNSUPPORTED_TYPE', '형식이 다른 확장자로는 변경할 수 없습니다');
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
    return c.json(toFileMeta(updated));
  })

  // API-036: 파일 삭제 → 휴지통 이동 (soft delete). 영구 삭제는 /purge와 보관 기한 만료가 담당
  .delete('/:id', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canWriteFile(user, file)) return fail(c, 403, 'FORBIDDEN', '삭제 권한이 없습니다');

    db.update(files).set({ deletedAt: Date.now() }).where(eq(files.id, id)).run();
    return c.json({ ok: true });
  })

  // API-046: 휴지통에서 복원 — 원래 폴더가 사라졌으면 최상위로, 이름이 겹치면 자동으로 번호를 붙인다
  .post('/:id/restore', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file || file.deletedAt === null) return fail(c, 404, 'NOT_FOUND', '휴지통에 없는 파일입니다');
    if (file.ownerId !== user.id && user.role !== 'admin') {
      return fail(c, 403, 'FORBIDDEN', '복원 권한이 없습니다');
    }

    let folderId = file.folderId;
    if (folderId !== null && !db.select().from(folders).where(eq(folders.id, folderId)).get()) {
      folderId = null;
    }
    let name = file.name;
    if (duplicateFileName(file.ownerId, folderId, name, file.id)) {
      const ext = extensionOf(name);
      const stem = ext ? name.slice(0, -ext.length) : name;
      let n = 2;
      while (duplicateFileName(file.ownerId, folderId, `${stem} (${n})${ext}`, file.id)) n++;
      name = `${stem} (${n})${ext}`;
    }

    db.update(files).set({ deletedAt: null, folderId, name }).where(eq(files.id, id)).run();
    return c.json({ ok: true });
  })

  // API-047: 휴지통에서 영구 삭제
  .delete('/:id/purge', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file || file.deletedAt === null) return fail(c, 404, 'NOT_FOUND', '휴지통에 없는 파일입니다');
    if (file.ownerId !== user.id && user.role !== 'admin') {
      return fail(c, 403, 'FORBIDDEN', '삭제 권한이 없습니다');
    }

    db.delete(files).where(eq(files.id, id)).run();
    deleteBinary(file.storagePath); // DB가 진실이므로 레코드를 지운 뒤 디스크를 정리
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
        storagePath: file.storagePath ? copyBinary(file.storagePath, user.id) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json(toFileMeta(created), 201);
  })

  // API-041: 버전 목록 (본문 제외 메타)
  .get('/:id/versions', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canReadFile(user, file)) return fail(c, 403, 'FORBIDDEN', '접근 권한이 없습니다');

    const versions = db
      .select({
        id: fileVersions.id,
        savedBy: fileVersions.savedBy,
        sizeBytes: fileVersions.sizeBytes,
        createdAt: fileVersions.createdAt,
      })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, id))
      .orderBy(desc(fileVersions.id))
      .all();
    return c.json({ versions });
  })

  // API-042: 특정 버전 본문 (미리보기)
  .get('/:id/versions/:vid', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    const vid = parseId(c.req.param('vid'));
    if (id === null || vid === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canReadFile(user, file)) return fail(c, 403, 'FORBIDDEN', '접근 권한이 없습니다');

    const version = db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.id, vid), eq(fileVersions.fileId, id)))
      .get();
    if (!version) return fail(c, 404, 'NOT_FOUND', '버전이 없습니다');

    return c.json({
      id: version.id,
      content: version.contentText,
      sizeBytes: version.sizeBytes,
      createdAt: version.createdAt,
    });
  })

  // API-043: 버전 복원 — 복원도 하나의 편집으로 취급, 현재 본문을 먼저 스냅샷 (복원 전으로 되돌아갈 수 있게)
  .post('/:id/versions/:vid/restore', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    const vid = parseId(c.req.param('vid'));
    if (id === null || vid === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (!canWriteFile(user, file)) return fail(c, 403, 'FORBIDDEN', '수정 권한이 없습니다');
    if (file.contentText === null) {
      return fail(c, 400, 'VALIDATION_ERROR', '바이너리 파일은 버전을 지원하지 않습니다');
    }

    const version = db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.id, vid), eq(fileVersions.fileId, id)))
      .get();
    if (!version) return fail(c, 404, 'NOT_FOUND', '버전이 없습니다');

    const now = Date.now();
    const result = db.transaction((tx) => {
      const snapshot = tx
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
        .set({
          contentText: version.contentText,
          sizeBytes: Buffer.byteLength(version.contentText, 'utf8'),
          updatedAt: now,
        })
        .where(eq(files.id, file.id))
        .run();

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

      return { updatedAt: now, versionId: snapshot.id };
    });

    return c.json(result);
  })

  // API-054: 파일의 태그 목록 교체 — 태그는 개인 소유이므로 파일 소유자만
  .put('/:id/tags', jsonBody(z.object({ tagIds: z.array(z.number().int().positive()).max(50) })), (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const { tagIds } = c.req.valid('json');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');
    if (file.ownerId !== user.id) return fail(c, 403, 'FORBIDDEN', '내 파일에만 태그를 붙일 수 있습니다');

    // 전부 내 태그인지 확인
    for (const tagId of tagIds) {
      const tag = db.select({ ownerId: tags.ownerId }).from(tags).where(eq(tags.id, tagId)).get();
      if (!tag || tag.ownerId !== user.id) return fail(c, 404, 'NOT_FOUND', `태그가 없습니다 (${tagId})`);
    }

    db.transaction((tx) => {
      tx.delete(fileTags).where(eq(fileTags.fileId, id)).run();
      for (const tagId of tagIds) {
        tx.insert(fileTags).values({ fileId: id, tagId }).run();
      }
    });
    return c.json({ tagIds });
  })

  // API-039: 파일 공유 토글 (관리자 전용 — 전체 사용자 대상 열람 공개)
  .put('/:id/share', jsonBody(z.object({ isShared: z.boolean() })), (c) => {
    const user = c.get('user');
    if (user.role !== 'admin') return fail(c, 403, 'FORBIDDEN', '관리자만 공유를 변경할 수 있습니다');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const file = db.select().from(files).where(eq(files.id, id)).get();
    if (!file) return fail(c, 404, 'NOT_FOUND', '파일이 없습니다');

    const { isShared } = c.req.valid('json');
    db.update(files)
      .set({ isShared: isShared ? 1 : 0, updatedAt: Date.now() })
      .where(eq(files.id, id))
      .run();
    return c.json({ ok: true, isShared: isShared ? 1 : 0 });
  });
