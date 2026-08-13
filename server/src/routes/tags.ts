import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { tags } from '../db/schema.js';
import { fail } from '../lib/errors.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex 색상(#rrggbb)이어야 합니다'),
});

export const tagRoutes = new Hono<AppEnv>()

  // API-051: 내 태그 목록
  .get('/', (c) => {
    const rows = db.select().from(tags).where(eq(tags.ownerId, c.get('user').id)).all();
    return c.json({ tags: rows });
  })

  // API-052: 태그 생성
  .post('/', jsonBody(createSchema), (c) => {
    const user = c.get('user');
    const { name, color } = c.req.valid('json');

    const dup = db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.ownerId, user.id), eq(tags.name, name)))
      .get();
    if (dup) return fail(c, 409, 'CONFLICT', '같은 이름의 태그가 있습니다');

    const tag = db
      .insert(tags)
      .values({ ownerId: user.id, name, color, createdAt: Date.now() })
      .returning()
      .get();
    return c.json({ tag }, 201);
  })

  // API-053: 태그 삭제 — 파일 연결(file_tags)은 FK CASCADE로 정리
  .delete('/:id', (c) => {
    const user = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');

    const tag = db.select().from(tags).where(eq(tags.id, id)).get();
    if (!tag || tag.ownerId !== user.id) return fail(c, 404, 'NOT_FOUND', '태그가 없습니다');

    db.delete(tags).where(eq(tags.id, id)).run();
    return c.json({ ok: true });
  });
