import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
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

export type SessionResolution =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; reason: 'no-token' | 'invalid-token' | 'no-user' | 'inactive' | 'stale' };

/**
 * 쿠키 → JWT 검증 → DB 재확인 → 활성 확인까지의 판정을 한 곳에 둔다.
 * authGuard 밖에 사는 /share-target(매니페스트가 고정 주소를 요구)도 이 함수를 써야
 * 검사 단계가 갈라지지 않는다 — 보안 로직의 중복은 편의 문제가 아니라 취약점이다.
 */
export async function resolveSessionUser(c: Context): Promise<SessionResolution> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return { ok: false, reason: 'no-token' };

  const verified = await verifySessionToken(token);
  if (verified === null) return { ok: false, reason: 'invalid-token' };

  // 토큰만 믿지 않고 매 요청 DB를 확인한다 — 삭제·비활성화가 세션 만료를 기다리지 않고 즉시 반영되게.
  const user = db.select().from(users).where(eq(users.id, verified.userId)).get();
  if (!user) return { ok: false, reason: 'no-user' };
  if (!user.isActive) return { ok: false, reason: 'inactive' };
  // 토큰이 담고 있는 epoch가 현재 값과 다르면 그 사이에 비밀번호가 바뀐 것 — 무효로 본다 (9-5 S-04)
  if (verified.epoch !== user.sessionEpoch) return { ok: false, reason: 'stale' };

  return { ok: true, user };
}

export const authGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();

  const session = await resolveSessionUser(c);
  if (!session.ok) {
    if (session.reason === 'inactive') return fail(c, 403, 'FORBIDDEN', '비활성화된 계정입니다');
    return fail(
      c,
      401,
      'UNAUTHORIZED',
      session.reason === 'no-token'
        ? '로그인이 필요합니다'
        : session.reason === 'invalid-token' || session.reason === 'stale'
          ? '세션이 만료되었습니다'
          : '존재하지 않는 계정입니다',
    );
  }

  const { user } = session;
  c.set('user', {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  });
  return next();
});
