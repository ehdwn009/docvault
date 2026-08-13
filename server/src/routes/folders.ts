import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { files, folders } from '../db/schema.js';
import { fail } from '../lib/errors.js';
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

export const folderRoutes = new Hono<AppEnv>()

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
      // 하위 트리의 파일을 명시적으로 먼저 지운다 — FK CASCADE에 맡기면
      // SQLite가 FTS 동기화 트리거를 안 태울 수 있어서(recursive_triggers 의존) 직접 지운다
      tx.run(sql`
        DELETE FROM ${files}
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
  });
