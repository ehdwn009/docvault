/** 동시에 최대 n개씩 돌린다 — 결과는 입력 순서대로. 하나가 던지면 그 자리에 오류를 담는다(나머지는 계속) */
export async function mapLimit<T, R>(
  items: T[],
  n: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<({ ok: true; value: R } | { ok: false; error: unknown })[]> {
  const out: ({ ok: true; value: R } | { ok: false; error: unknown })[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i] as T, i) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.name === 'TimeoutError' || e.name === 'AbortError' ? '시간 초과' : e.message;
  return String(e);
}

/**
 * ms 안에 안 끝나거나 신호가 오면 기다리기를 그만둔다 — 안쪽 일이 자기 시간 제한도 멈춤 신호도 못 듣고 걸려 있어도
 * 바깥은 다음으로 넘어간다(10/6 한국경제 IT가 10초 제한과 [중지]를 둘 다 넘겼다, 설계 "멈춤 대책 2차"). 안쪽 일은 뒤에서 끝나게 둔다
 */
export function withDeadline<T>(p: Promise<T>, ms: number, onLate: () => Error, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      done();
      reject(onLate());
    }, ms);
    // 먼저 붙여 둔다 — 포기한 뒤 안쪽 일이 늦게 실패해도 처리되지 않은 거부(unhandled rejection)가 되지 않게
    p.then(resolve, reject).finally(done);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
