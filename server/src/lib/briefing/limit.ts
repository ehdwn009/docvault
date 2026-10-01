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
