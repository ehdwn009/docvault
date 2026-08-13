import { eq } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { SESSION_COOKIE } from '../constants.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { fail } from '../lib/errors.js';
import { verifySessionToken } from '../lib/session.js';
import type { AppEnv } from '../types.js';

// deny by default (CLAUDE.md 보안): /api/v1 전체에 인증을 강제하고 예외만 여기에 등록한다.
// 라우트마다 인증을 "추가"하는 방식은 빼먹는 순간 구멍이 되므로 금지.
const PUBLIC_PATHS = new Set(['/api/v1/health', '/api/v1/auth/login']);

export const authGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();

  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return fail(c, 401, 'UNAUTHORIZED', '로그인이 필요합니다');

  const userId = await verifySessionToken(token);
  if (userId === null) return fail(c, 401, 'UNAUTHORIZED', '세션이 만료되었습니다');

  // 토큰만 믿지 않고 매 요청 DB를 확인한다 — 삭제·비활성화가 세션 만료를 기다리지 않고 즉시 반영되게.
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return fail(c, 401, 'UNAUTHORIZED', '존재하지 않는 계정입니다');
  if (!user.isActive) return fail(c, 403, 'FORBIDDEN', '비활성화된 계정입니다');

  c.set('user', {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  });
  return next();
});
