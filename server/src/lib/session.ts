import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { SESSION_TTL_MS } from '../constants.js';

const secret = new TextEncoder().encode(config.jwtSecret);

export async function createSessionToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + SESSION_TTL_MS) / 1000))
    .sign(secret);
}

/** 유효하면 userId, 아니면 null. 만료·위조 구분 없이 전부 미인증으로 취급한다. */
export async function verifySessionToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const userId = Number(payload.sub);
    return Number.isInteger(userId) ? userId : null;
  } catch {
    return null;
  }
}
