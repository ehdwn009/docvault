import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { config } from '../config.js';
import { BCRYPT_ROUNDS, PASSWORD_MIN_LENGTH, SESSION_COOKIE, SESSION_TTL_MS } from '../constants.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { fail } from '../lib/errors.js';
import { createSessionToken } from '../lib/session.js';
import { jsonBody } from '../lib/validate.js';
import type { AppEnv } from '../types.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH),
});

export const authRoutes = new Hono<AppEnv>()

  // API-001: 로그인
  .post('/login', jsonBody(loginSchema), async (c) => {
    const { username, password } = c.req.valid('json');

    const user = db.select().from(users).where(eq(users.username, username)).get();
    // ID 오류인지 비밀번호 오류인지 구분해 알려주지 않는다 (API-001 — 계정 존재 여부 노출 방지)
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return fail(c, 401, 'INVALID_CREDENTIALS', 'ID 또는 비밀번호가 올바르지 않습니다');
    }
    if (!user.isActive) {
      return fail(c, 403, 'ACCOUNT_DISABLED', '비활성화된 계정입니다');
    }

    db.update(users).set({ lastSignedIn: Date.now() }).where(eq(users.id, user.id)).run();

    setCookie(c, SESSION_COOKIE, await createSessionToken(user.id), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.isProduction,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });

    return c.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
  })

  // API-002: 로그아웃
  .post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  })

  // API-003: 내 정보 조회
  .get('/me', (c) => c.json({ user: c.get('user') }))

  // API-004: 내 비밀번호 변경
  .put('/password', jsonBody(passwordSchema), (c) => {
    const { currentPassword, newPassword } = c.req.valid('json');
    const sessionUser = c.get('user');

    const user = db.select().from(users).where(eq(users.id, sessionUser.id)).get();
    if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
      return fail(c, 401, 'INVALID_CREDENTIALS', '현재 비밀번호가 올바르지 않습니다');
    }

    db.update(users)
      .set({ passwordHash: bcrypt.hashSync(newPassword, BCRYPT_ROUNDS), updatedAt: Date.now() })
      .where(eq(users.id, user.id))
      .run();

    return c.json({ ok: true });
  });
