import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { BRIEFING } from '../constants.js';

// 비밀값 보관 도우미 (시스템 아키텍처 "구글 토큰 보관" 결정 사항 — 값은 data/, 키는 환경변수 JWT_SECRET 파생).
// data/ 폴더가 곧 백업 단위라 DB 파일이 밖으로 나가는 것을 전제로 한다. 첫 사용처는 구독 생성 방식의 트리거 토큰(v0.50)

/** JWT_SECRET에서 용도별로 다른 키를 뽑는다 — 서명 키를 암호화 키로 그대로 쓰지 않는다 */
function keyFor(purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', config.jwtSecret, 'docvault', purpose, 32));
}

const ENC_VERSION = 'v1';

/** AES-256-GCM. 결과는 `v1.<iv>.<tag>.<암호문>`(base64url) — 버전을 앞에 두어 나중에 방식을 바꿔도 옛 값을 읽을 수 있다 */
export function encryptSecret(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(purpose), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [ENC_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** 복호화 — 키가 바뀌었거나(JWT_SECRET 변경) 값이 상했으면 null. 부르는 쪽이 "다시 넣어 주세요"로 안내한다 */
export function decryptSecret(stored: string, purpose: string): string | null {
  const [version, iv, tag, body] = stored.split('.');
  if (version !== ENC_VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(purpose), Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** 연결 열쇠 발급 — dvt_ 접두어 + 32바이트 난수. 난수라 bcrypt 없이 SHA-256으로 충분하다 */
export function newApiToken(): string {
  return BRIEFING.SUB_TOKEN_PREFIX + randomBytes(BRIEFING.SUB_TOKEN_BYTES).toString('base64url');
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** 해시 비교 — 길이가 다르면 바로 false, 같으면 상수 시간 비교(타이밍으로 한 글자씩 맞추지 못하게) */
export function hashEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
