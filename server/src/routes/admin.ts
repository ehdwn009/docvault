import bcrypt from 'bcryptjs';
import { desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { BCRYPT_ROUNDS, PASSWORD_MIN_LENGTH } from '../constants.js';
import { db } from '../db/index.js';
import { files, folders, users } from '../db/schema.js';
import { fail } from '../lib/errors.js';
import { deleteBinary } from '../lib/storage.js';
import { jsonBody, parseId } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

const adminGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') return fail(c, 403, 'FORBIDDEN', '관리자 전용입니다');
  return next();
});

const createUserSchema = z.object({
  username: z
    .string()
    .regex(/^[a-z0-9_]{3,32}$/, '영소문자·숫자·언더스코어 3~32자'),
  password: z.string().min(PASSWORD_MIN_LENGTH),
  displayName: z.string().trim().max(50).optional(),
  role: z.enum(['user', 'admin']).optional(),
});

const updateUserSchema = z
  .object({
    displayName: z.string().trim().max(50).nullable().optional(),
    role: z.enum(['user', 'admin']).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(PASSWORD_MIN_LENGTH).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 필드가 없습니다' });

function toPublicUser(u: typeof users.$inferSelect) {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

export const adminRoutes = new Hono<AppEnv>()
  .use('*', adminGuard)

  // API-011: 대시보드 통계
  .get('/stats', (c) => {
    const one = <T>(q: T[]): T => q[0]!;
    const userCount = one(db.all<{ n: number }>(sql`SELECT count(*) AS n FROM users`)).n;
    const fileCount = one(db.all<{ n: number }>(sql`SELECT count(*) AS n FROM files`)).n;
    const folderCount = one(db.all<{ n: number }>(sql`SELECT count(*) AS n FROM folders`)).n;
    const versionCount = one(db.all<{ n: number }>(sql`SELECT count(*) AS n FROM file_versions`)).n;
    const totalBytes = one(db.all<{ n: number | null }>(sql`SELECT sum(size_bytes) AS n FROM files`)).n ?? 0;
    const sharedCount = one(db.all<{ n: number }>(sql`SELECT count(*) AS n FROM files WHERE is_shared = 1`)).n;
    return c.json({ stats: { userCount, fileCount, folderCount, versionCount, totalBytes, sharedCount } });
  })

  // API-012: 사용자 목록
  .get('/users', (c) => {
    const rows = db.select().from(users).orderBy(users.id).all();
    return c.json({ users: rows.map(toPublicUser) });
  })

  // API-013: 사용자 생성 (계정 발급 — 회원가입 없는 폐쇄형의 유일한 가입 경로)
  .post('/users', jsonBody(createUserSchema), (c) => {
    const { username, password, displayName, role } = c.req.valid('json');

    const dup = db.select({ id: users.id }).from(users).where(eq(users.username, username)).get();
    if (dup) return fail(c, 409, 'CONFLICT', '이미 사용 중인 username입니다');

    const now = Date.now();
    const user = db
      .insert(users)
      .values({
        username,
        passwordHash: bcrypt.hashSync(password, BCRYPT_ROUNDS),
        displayName: displayName ?? null,
        role: role ?? 'user',
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json({ user: toPublicUser(user) }, 201);
  })

  // API-014: 사용자 수정 — 이름·역할·활성화·비밀번호 초기화
  .put('/users/:id', jsonBody(updateUserSchema), (c) => {
    const me = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    const patch = c.req.valid('json');

    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) return fail(c, 404, 'NOT_FOUND', '사용자가 없습니다');

    // 스스로를 잠그는 실수 방지 — 자기 계정의 역할 강등·비활성화 금지
    if (id === me.id && (patch.role === 'user' || patch.isActive === false)) {
      return fail(c, 400, 'VALIDATION_ERROR', '자기 계정의 역할 강등·비활성화는 할 수 없습니다');
    }

    const updated = db
      .update(users)
      .set({
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive ? 1 : 0 } : {}),
        ...(patch.password !== undefined
          ? { passwordHash: bcrypt.hashSync(patch.password, BCRYPT_ROUNDS) }
          : {}),
        updatedAt: Date.now(),
      })
      .where(eq(users.id, id))
      .returning()
      .get();
    return c.json({ user: toPublicUser(updated) });
  })

  // API-015: 사용자 삭제 — 소유 데이터 전체 CASCADE
  .delete('/users/:id', (c) => {
    const me = c.get('user');
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 400, 'VALIDATION_ERROR', 'id: 올바르지 않은 값');
    if (id === me.id) return fail(c, 400, 'VALIDATION_ERROR', '자기 계정은 삭제할 수 없습니다');

    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) return fail(c, 404, 'NOT_FOUND', '사용자가 없습니다');

    const binaryPaths = db
      .select({ p: files.storagePath })
      .from(files)
      .where(eq(files.ownerId, id))
      .all()
      .filter((r): r is { p: string } => r.p !== null);

    db.transaction((tx) => {
      // 파일은 명시적으로 먼저 삭제 — FK CASCADE에 맡기면 FTS 동기화 트리거가 안 탈 수 있음
      tx.delete(files).where(eq(files.ownerId, id)).run();
      tx.delete(users).where(eq(users.id, id)).run();
    });
    for (const { p } of binaryPaths) deleteBinary(p);
    return c.json({ ok: true });
  })

  // API-016: 전체 사용자 파일·폴더 트리
  .get('/tree', (c) => {
    const allUsers = db.select().from(users).orderBy(users.id).all();
    const allFolders = db
      .select({
        id: folders.id,
        ownerId: folders.ownerId,
        parentId: folders.parentId,
        name: folders.name,
        isShared: folders.isShared,
      })
      .from(folders)
      .all();
    const allFiles = db
      .select({
        id: files.id,
        ownerId: files.ownerId,
        folderId: files.folderId,
        name: files.name,
        fileType: files.fileType,
        sizeBytes: files.sizeBytes,
        isShared: files.isShared,
        updatedAt: files.updatedAt,
      })
      .from(files)
      .orderBy(desc(files.updatedAt))
      .all();

    return c.json({
      users: allUsers.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        folders: allFolders.filter((f) => f.ownerId === u.id),
        files: allFiles.filter((f) => f.ownerId === u.id),
      })),
    });
  });
