import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { config } from '../config.js';
import {
  BCRYPT_ROUNDS,
  DUMMY_PASSWORD_HASH,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from '../constants.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { fail } from '../lib/errors.js';
import { clearLoginAttempts, hitLoginAttempt } from '../lib/ratelimit.js';
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

    // IP+아이디 조합으로 시도를 센다. 프록시 뒤라 원 IP는 헤더에서 온다 —
    // 헤더는 위조 가능하지만, 최악이어도 "공격자가 자기 카운터를 우회"할 뿐 정상 사용자는 보호된다.
    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'local';
    const rateKey = `${clientIp}|${username.toLowerCase()}`;
    const retryAfter = hitLoginAttempt(rateKey);
    if (retryAfter !== null) {
      c.header('Retry-After', String(retryAfter));
      return fail(c, 429, 'TOO_MANY_ATTEMPTS', '시도가 너무 많습니다. 잠시 후 다시 시도하세요');
    }

    const user = db.select().from(users).where(eq(users.username, username)).get();
    // 계정이 없어도 더미 해시로 bcrypt를 돌린다 — 안 돌리면 응답이 38배 빨라져
    // "그 아이디는 없다"가 시간으로 새어 나간다. 메시지를 숨겨도 시간이 말한다.
    const passwordOk = bcrypt.compareSync(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    // ID 오류인지 비밀번호 오류인지 구분해 알려주지 않는다 (API-001 — 계정 존재 여부 노출 방지)
    if (!user || !passwordOk) {
      return fail(c, 401, 'INVALID_CREDENTIALS', 'ID 또는 비밀번호가 올바르지 않습니다');
    }
    if (!user.isActive) {
      return fail(c, 403, 'ACCOUNT_DISABLED', '비활성화된 계정입니다');
    }

    clearLoginAttempts(rateKey);
    db.update(users).set({ lastSignedIn: Date.now() }).where(eq(users.id, user.id)).run();

    setCookie(c, SESSION_COOKIE, await createSessionToken(user.id, user.sessionEpoch), {
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
  .put('/password', jsonBody(passwordSchema), async (c) => {
    const { currentPassword, newPassword } = c.req.valid('json');
    const sessionUser = c.get('user');

    const user = db.select().from(users).where(eq(users.id, sessionUser.id)).get();
    if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
      return fail(c, 401, 'INVALID_CREDENTIALS', '현재 비밀번호가 올바르지 않습니다');
    }

    // sessionEpoch를 올려 이 시각 이전에 발급된 토큰을 전부 무효화한다.
    // 비밀번호를 바꾸는 이유가 대개 "털린 것 같아서"인데, 옛 세션이 살아 있으면 그 목적이 무너진다.
    const now = Date.now();
    db.update(users)
      .set({
        passwordHash: bcrypt.hashSync(newPassword, BCRYPT_ROUNDS),
        updatedAt: now,
        sessionEpoch: now,
      })
      .where(eq(users.id, user.id))
      .run();

    // 방금 바꾼 본인은 다시 로그인하지 않아도 되게 새 토큰을 발급한다
    setCookie(c, SESSION_COOKIE, await createSessionToken(user.id, now), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.isProduction,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });

    return c.json({ ok: true });
  });
