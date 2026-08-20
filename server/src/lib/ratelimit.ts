import { LOGIN_RATE_LIMIT } from '../constants.js';

/**
 * 로그인 시도 제한 — 메모리 기반 고정 창(fixed window) 카운터.
 *
 * 부품(npm 패키지)을 쓰지 않은 이유: 서버가 한 대이고 사용자가 소수라 메모리로 충분한데,
 * 의존성 하나가 늘면 그만큼 공급망 공격 표면이 늘어난다 (9-4).
 * ⚠️ 서버를 여러 대로 늘리면 각 서버가 따로 세므로 이 방식은 깨진다 — 그때는 공유 저장소(Redis 등)가 답이다.
 *
 * 창을 IP가 아니라 "IP + 아이디" 로 잡은 이유: IP만 세면 공유 IP(회사·학교) 뒤의 정상 사용자가
 * 남의 실패 때문에 막히고, 아이디만 세면 공격자가 아이디를 바꿔가며 계속 시도할 수 있다.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** 창이 지난 항목을 정리한다 — Map이 무한히 자라지 않게 (메모리 기반의 대가) */
function sweep(now: number): void {
  if (buckets.size < LOGIN_RATE_LIMIT.SWEEP_THRESHOLD) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/**
 * 시도를 한 번 세고, 한도를 넘었으면 남은 대기 시간(초)을 돌려준다.
 * 넘지 않았으면 null.
 */
export function hitLoginAttempt(key: string, now = Date.now()): number | null {
  sweep(now);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + LOGIN_RATE_LIMIT.WINDOW_MS });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > LOGIN_RATE_LIMIT.MAX_ATTEMPTS) {
    return Math.ceil((bucket.resetAt - now) / 1000);
  }
  return null;
}

/** 로그인 성공 시 그 조합의 카운터를 지운다 — 정상 사용자가 다음에 불이익을 받지 않게 */
export function clearLoginAttempts(key: string): void {
  buckets.delete(key);
}

/** 테스트·재기동 용도 */
export function resetAllLoginAttempts(): void {
  buckets.clear();
}
