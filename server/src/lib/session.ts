import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { SESSION_TTL_MS } from '../constants.js';

const secret = new TextEncoder().encode(config.jwtSecret);

/**
 * 세션 토큰을 만든다. epoch는 발급 당시 사용자의 sessionEpoch를 그대로 담는다 —
 * 검증할 때 DB의 현재 값과 다르면 "그 뒤에 비밀번호가 바뀌었다"는 뜻이라 무효로 본다.
 *
 * 표준 iat(발급 시각)를 쓰지 않은 이유: iat는 **초 단위**라 로그인과 비밀번호 변경이
 * 같은 초 안에 일어나면 둘을 구분할 수 없다. 값을 직접 담으면 반올림 문제가 없다.
 */
export async function createSessionToken(userId: number, epoch: number): Promise<string> {
  return new SignJWT({ epoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + SESSION_TTL_MS) / 1000))
    .sign(secret);
}

/** 유효하면 { userId, epoch }, 아니면 null. 만료·위조 구분 없이 전부 미인증으로 취급한다. */
export async function verifySessionToken(
  token: string,
): Promise<{ userId: number; epoch: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) return null;
    // epoch가 없는 토큰은 이 기능 도입 전에 발급된 것 — 0으로 보면 기본값(0)과 같아 그대로 통과한다
    const epoch = typeof payload['epoch'] === 'number' ? payload['epoch'] : 0;
    return { userId, epoch };
  } catch {
    return null;
  }
}
