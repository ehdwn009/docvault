import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { files, folders } from '../db/schema.js';
import { fail } from '../lib/errors.js';
import { folderPath } from './files.js';
import { jsonBody, nameField, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

const createSchema = z.object({
  name: nameField,
  parentId: z.number().int().positive().nullable().optional(),
});

// name/parentId/sortOrder 중 보낸 필드만 갱신 (API-023: 이름 변경 / 이동 / 정렬)
const updateSchema = z
  .object({
    name: nameField.optional(),
    parentId: z.number().int().positive().nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => v.name !== undefined || v.parentId !== undefined || v.sortOrder !== undefined, {
    message: '변경할 필드가 없습니다',
  });

function getOwnFolder(ownerId: number, id: number) {
  const folder = db.select().from(folders).where(eq(folders.id, id)).get();
  return folder && folder.ownerId === ownerId ? folder : null;
}

function duplicateName(ownerId: number, parentId: number | null, name: string, excludeId?: number) {
  const dup = db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.ownerId, ownerId),
        parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
        eq(folders.name, name),
      ),
    )
    .get();
  return dup !== undefined && dup.id !== excludeId;
}

/** newParentId에서 루트까지 거슬러 올라가며 folderId를 만나는지 — 자기 하위로의 이동(순환) 방지 */
function wouldCycle(folderId: number, newParentId: number): boolean {
  let cursor: number | null = newParentId;
  while (cursor !== null) {
    if (cursor === folderId) return true;
    const row = db.select({ parentId: folders.parentId }).from(folders).where(eq(folders.id, cursor)).get();
    cursor = row?.parentId ?? null;
  }
  return false;
}

/** 폴더 안의 폴더 id 전부(자기 포함) — 소유자의 폴더 목록은 작아서 메모리에서 내려간다 */
function descendantFolderIds(ownerId: number, rootId: number): number[] {
  const all = db.select({ id: folders.id, parentId: folders.parentId }).from(folders).where(eq(folders.ownerId, ownerId)).all();
  const byParent = new Map<number | null, number[]>();
  for (const f of all) byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f.id]);
  const out: number[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const child of byParent.get(id) ?? []) stack.push(child);
  }
  return out;
}

export const folderRoutes = new Hono<AppEnv>()

  // API-026: 폴더 속성(SCR-113) — 안에 뭐가 얼마나 있나. 하위 전부를 센다 (휴지통·카드 제외)
  .get('/:id/info', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const folder = getOwnFolder(user.id, id);
    if (!folder) return fail(c, 404, 'NOT_FOUND', '폴더가 없습니다');
    const ids = descendantFolderIds(user.id, id);
    const rows = db
      .select({ id: files.id, name: files.name, fileType: files.fileType, sizeBytes: files.sizeBytes, updatedAt: files.updatedAt })
      .from(files)
      .where(and(inArray(files.folderId, ids), isNull(files.deletedAt), eq(files.kind, 'doc')))
      .all();
    const byType: Record<string, number> = {};
    let bytes = 0;
    let latest: { id: number; name: string; updatedAt: number } | null = null;
    for (const f of rows) {
      byType[f.fileType] = (byType[f.fileType] ?? 0) + 1;
      bytes += f.sizeBytes;
      if (!latest || f.updatedAt > latest.updatedAt) latest = { id: f.id, name: f.name, updatedAt: f.updatedAt };
    }
    return c.json({
      folder,
      path: folderPath(folder.parentId),
      folderCount: ids.length - 1,
      fileCount: rows.length,
      bytes,
      byType,
      latest,
    });
  })

  // API-022: 폴더 생성
  .post('/', jsonBody(createSchema), (c) => {
    const user = c.get('user');
    const { name, parentId = null } = c.req.valid('json');

    if (parentId !== null && !getOwnFolder(user.id, parentId)) {
      return fail(c, 404, 'NOT_FOUND', '상위 폴더가 없습니다');
    }
    if (duplicateName(user.id, parentId, name)) {
      return fail(c, 409, 'CONFLICT', '같은 위치에 동일한 이름의 폴더가 있습니다');
    }

    const now = Date.now();
    const folder = db
      .insert(folders)
      .values({ ownerId: user.id, parentId, name, createdAt: now, updatedAt: now })
      .returning()
      .get();
    return c.json({ folder }, 201);
  })

  // API-023: 폴더 이름 변경 / 이동 / 정렬
  .put('/:id', jsonBody(updateSchema), (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const patch = c.req.valid('json');

    const folder = getOwnFolder(user.id, id);
    if (!folder) return fail(c, 404, 'NOT_FOUND', '폴더가 없습니다');

    const nextParent = patch.parentId !== undefined ? patch.parentId : folder.parentId;
    const nextName = patch.name ?? folder.name;

    if (patch.parentId !== undefined && patch.parentId !== null) {
      if (!getOwnFolder(user.id, patch.parentId)) {
        return fail(c, 404, 'NOT_FOUND', '대상 폴더가 없습니다');
      }
      if (wouldCycle(id, patch.parentId)) {
        return fail(c, 400, 'VALIDATION_ERROR', '자기 자신이나 하위 폴더로는 이동할 수 없습니다');
      }
    }
    if (duplicateName(user.id, nextParent, nextName, id)) {
      return fail(c, 409, 'CONFLICT', '같은 위치에 동일한 이름의 폴더가 있습니다');
    }

    const updated = db
      .update(folders)
      .set({
        name: nextName,
        parentId: nextParent,
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(folders.id, id))
      .returning()
      .get();
    return c.json({ folder: updated });
  })

  // API-024: 폴더 삭제 (하위 폴더·파일 포함)
  .delete('/:id', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const folder = getOwnFolder(user.id, id);
    if (!folder) return fail(c, 404, 'NOT_FOUND', '폴더가 없습니다');

    db.transaction((tx) => {
      // 하위 트리의 파일은 지우지 않고 휴지통으로 보낸다 (IA — 휴지통).
      // folder_id를 먼저 끊어야 폴더 삭제의 FK CASCADE가 파일까지 지우지 않는다
      tx.run(sql`
        UPDATE ${files}
        SET folder_id = NULL, deleted_at = COALESCE(deleted_at, ${Date.now()})
        WHERE folder_id IN (
          WITH RECURSIVE subtree(id) AS (
            SELECT ${id}
            UNION ALL
            SELECT f.id FROM ${folders} f JOIN subtree s ON f.parent_id = s.id
          )
          SELECT id FROM subtree
        )
      `);
      // 하위 폴더는 parent_id CASCADE로 함께 삭제된다
      tx.delete(folders).where(eq(folders.id, id)).run();
    });

    return c.json({ ok: true });
  })

  // API-025: 폴더 공유 토글 (관리자 전용) — 공유 폴더 하위 파일은 전부 열람 공개가 된다
  .put('/:id/share', jsonBody(z.object({ isShared: z.boolean() })), (c) => {
    const user = c.get('user');
    if (user.role !== 'admin') return fail(c, 403, 'FORBIDDEN', '관리자만 공유를 변경할 수 있습니다');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const folder = db.select().from(folders).where(eq(folders.id, id)).get();
    if (!folder) return fail(c, 404, 'NOT_FOUND', '폴더가 없습니다');

    const { isShared } = c.req.valid('json');
    db.update(folders)
      .set({ isShared: isShared ? 1 : 0, updatedAt: Date.now() })
      .where(eq(folders.id, id))
      .run();
    return c.json({ ok: true, isShared: isShared ? 1 : 0 });
  });
