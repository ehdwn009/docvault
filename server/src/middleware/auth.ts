import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { BRIEFING, HEALTH_PATH, SESSION_COOKIE } from '../constants.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { findTokenOwner, notePingAuthFailure, touchToken, tokenPrefixKnown } from '../lib/briefing/subscription.js';
import { fail } from '../lib/errors.js';
import { clearLoginAttempts, hitLoginAttempt } from '../lib/ratelimit.js';
import { verifySessionToken } from '../lib/session.js';
import type { AppEnv } from '../types.js';

// deny by default (CLAUDE.md 보안): /api/v1 전체에 인증을 강제하고 예외만 여기에 등록한다.
// 라우트마다 인증을 "추가"하는 방식은 빼먹는 순간 구멍이 되므로 금지.
const PUBLIC_PATHS = new Set([HEALTH_PATH, '/api/v1/auth/login']);

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
  // 토큰이 담고 있는 epoch가 현재 값과 다르면 그 사이에 비밀번호가 바뀐 것 — 무효로 본다
  if (verified.epoch !== user.sessionEpoch) return { ok: false, reason: 'stale' };

  return { ok: true, user };
}

/** 요청을 보낸 IP — 프록시(Caddy) 뒤라 헤더를 먼저 본다. 로그인 제한과 같은 규칙 (routes/auth.ts) */
function clientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'local';
}

/**
 * 구독 연결 열쇠(Bearer) — `/api/v1/briefing/jobs/` 접두어에서만 받고 쿠키는 거절한다(브라우저의 관리자가 실수로 치지 못하게).
 * 그 밖의 경로에서는 Bearer를 아예 보지 않는다 — "쿠키가 없으면 Bearer도 봐 준다" 식이면 열쇠가 전체 API의 관리자 통행증이 된다
 * (뉴스 브리핑 설계 "보안 — 구독 연결 열쇠"). 틀린 열쇠는 로그인과 같은 제한을 건다 — 묶는 키는 IP, 단 앞 8자가 발급된 열쇠와 같으면
 * IP + 앞 8자(클라우드 세션은 공용 나가는 IP를 쓸 수 있어 IP만으로 묶으면 남의 틀린 열쇠가 내 실행을 막는다). 아무 글자나 키에
 * 넣어 주면 요청마다 새 버킷이 생겨 메모리가 늘고 제한도 안 걸린다(보안 검토 2026-10-30)
 */
async function tokenGuard(c: Context<AppEnv>, next: () => Promise<void>) {
  const raw = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';
  const prefix = raw.slice(0, BRIEFING.SUB_TOKEN_PREFIX_CHARS);
  const ip = clientIp(c);
  const key = raw && tokenPrefixKnown(prefix) ? `${ip}|${prefix}` : ip;
  const owner = raw ? findTokenOwner(raw) : null;
  if (!owner) {
    // 우리 열쇠 모양(dvt_)으로 틀렸을 때만 [연결 확인]을 "열쇠가 맞지 않습니다"로 — 스캐너·쿠키 브라우저의 빈 요청이 남의 확인을 끝내지 않게
    if (raw.startsWith(BRIEFING.SUB_TOKEN_PREFIX)) notePingAuthFailure();
    const wait = hitLoginAttempt(key);
    console.log(`[briefing] 연결 열쇠 거절 — ${ip} ${raw ? prefix + '…' : '(없음)'}`);
    if (wait !== null) {
      c.header('Retry-After', String(wait));
      return fail(c, 429, 'TOO_MANY_ATTEMPTS', `잠시 후 다시 시도하세요 (${wait}초)`);
    }
    return fail(c, 401, 'BRIEFING_TOKEN_INVALID', '연결 열쇠가 없거나 맞지 않습니다');
  }
  // 열쇠 주인도 세션과 같은 조건 — 매 요청 DB에서 관리자·활성 확인
  const user = db.select().from(users).where(eq(users.id, owner.userId)).get();
  if (!user || !user.isActive || user.role !== 'admin') return fail(c, 403, 'FORBIDDEN', '이 열쇠의 계정으로는 들어올 수 없습니다');
  clearLoginAttempts(key);
  touchToken(owner.userId);
  c.set('user', { id: user.id, username: user.username, displayName: user.displayName, role: user.role });
  c.set('authKind', 'token');
  return next();
}

export const authGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  // 접두어 분기 — 끝 슬래시까지 포함해 /briefing/jobsXYZ 같은 변형이 Bearer 경로가 되지 않게
  if (c.req.path.startsWith(BRIEFING.SUB_JOBS_PATH_PREFIX)) return tokenGuard(c, next);

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
  c.set('authKind', 'session');
  return next();
});
