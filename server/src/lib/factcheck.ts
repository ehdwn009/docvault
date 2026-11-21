// 글에 나온 숫자를 근거(원문 인용·계산식)와 맞추는 공용 함수 — 수출입 동향 정리본(lib/trade/verify.ts)과
// 세계 전망(lib/outlook/verify.ts)이 함께 쓴다. 세계 전망이 세 번째 쓰임이라 복사하지 않고 여기로 뺐다(세계전망 설계 9단계)

export const norm = (s: string) => s.replace(/\s+/g, '');
export const NUM = /\d[\d,]*(?:\.\d+)?/g;
export const toNum = (t: string) => Number(t.replace(/,/g, ''));
export const decimals = (t: string) => (t.includes('.') ? t.length - t.indexOf('.') - 1 : 0);

/** 수출입 동향이 대조하는 단위 — 이 단위가 바로 뒤에 붙은 수는 작아도 근거가 있어야 한다 */
export const TRADE_UNITS = ['%', '％', '배', '억', '조', '달러', '원', '톤', '만'];

export type BackedNumber = { token: string; value: number; dec: number; dir: 1 | -1 | 0 };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 문장에서 "근거가 있어야 하는 숫자"만 고른다 — 날짜·순서·작은 개수는 뺀다(독자 검수가 본다).
 *  소수점·천 단위 쉼표가 있거나 100 이상이거나, 단위가 붙은 수가 대상이다 */
export function numbersToBack(text: string, units: string[] = TRADE_UNITS): BackedNumber[] {
  const unitRe = new RegExp(`^\\s?(${units.map(escapeRe).join('|')})`);
  const out: BackedNumber[] = [];
  for (const m of text.matchAll(NUM)) {
    const token = m[0].replace(/,$/, '');
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 3), start);
    const after = text.slice(start + token.length, start + token.length + 4);
    if (/^(월|년|분기|번째|위|차|쪽|호|시|분의|~|∼)/.test(after) || /(분의\s?|~|∼|’|')$/.test(before)) continue;
    if (/^일/.test(after) && /월\s?$/.test(before)) continue;
    const value = toNum(token);
    const marked = token.includes('.') || token.includes(',') || value >= 100;
    if (!marked && !unitRe.test(after)) continue;
    out.push({ token, value, dec: decimals(token), dir: /▲\s?$/.test(before) ? 1 : /▼\s?$/.test(before) ? -1 : 0 });
  }
  return out;
}

/** 문장의 수 t(소수 d자리)가 근거의 수 c와 같은가 — 반올림 차이와 백만↔억 단위 차이(÷100)까지 같은 것으로 본다 */
export function sameNumber(t: number, d: number, c: number): boolean {
  const tol = 0.5 * 10 ** -d + 1e-9;
  const a = Math.abs(c);
  if (Math.abs(a - t) <= tol) return true;
  // 단위 환산은 백만 달러 줄에서 온 큰 정수에만 — 작은 수까지 받으면 7%가 727.8과도 맞아 버린다
  return a >= 1000 && Number.isInteger(a) && Math.abs(a / 100 - t) <= tol;
}

/** 근거 인용에서 "값"만 뽑는다 — 날짜·연도·순위·제품 규격(16Gb)·기간(1~25일)은 값이 아니다. 원문이 △·-로 표시한 감소는 음수로 */
export function quoteNumbers(quote: string): number[] {
  const out: number[] = [];
  for (const m of quote.matchAll(NUM)) {
    const start = m.index ?? 0;
    const token = m[0].replace(/,$/, '');
    const before = quote.slice(Math.max(0, start - 2), start);
    const after = quote.slice(start + token.length, start + token.length + 3);
    if (/[’‘'`]$/.test(before) || /^(월|년|위|분기|쪽|Gb|GB|G\b|~|∼|일)/.test(after) || /[~∼]$/.test(before)) continue;
    out.push(/[△▵\-−]$/.test(before) ? -toNum(token) : toNum(token));
  }
  return out;
}

// ---- 계산식 "(115,276 ÷ 121,050 − 1) × 100 = −4.8" — 왼쪽을 다시 계산해 오른쪽과 견준다 ----

type Tok = { k: 'n'; v: number } | { k: 'o'; v: string };

function lex(expr: string): Tok[] | null {
  const out: Tok[] = [];
  const s = expr.replace(/\s+/g, '').replace(/[−–△▵]/g, '-').replace(/[×xX]/g, '*').replace(/÷/g, '/');
  let i = 0;
  while (i < s.length) {
    const m = /^\d[\d,]*(?:\.\d+)?/.exec(s.slice(i));
    if (m) {
      out.push({ k: 'n', v: toNum(m[0]) });
      i += m[0].length;
    } else if ('+-*/^()'.includes(s[i] ?? '')) {
      out.push({ k: 'o', v: s[i] as string });
      i++;
    } else return null;
  }
  return out;
}

/** 사칙연산과 거듭제곱(^ — 한 달 평균 증가율 같은 복리 계산)만. 식을 코드로 실행하지 않고 직접 풀어 계산한다 */
function evaluate(toks: Tok[]): number | null {
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.k === 'o' && peek()?.v === v;
  const factor = (): number => {
    const t = toks[pos++];
    if (!t) throw new Error('식이 끝났다');
    if (t.k === 'n') return t.v;
    if (t.v === '-') return -factor();
    if (t.v === '(') {
      const v = sum();
      if (!isOp(')')) throw new Error('괄호');
      pos++;
      return v;
    }
    throw new Error('연산자');
  };
  const power = (): number => {
    const base = factor();
    if (!isOp('^')) return base;
    pos++;
    return base ** power();
  };
  const term = (): number => {
    let v = power();
    while (isOp('*') || isOp('/')) {
      const op = toks[pos++]?.v;
      const r = power();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[pos++]?.v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = sum();
    return pos === toks.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** 단위를 맞추거나 비율을 낼 때 쓰는 수 — 근거 없이 식에 써도 된다 */
const FREE_CONSTANTS = new Set([1, 10, 12, 100, 1000]);

export function checkCalc(calc: string, usable: number[]): { ok: true; value: number } | { ok: false; why: string } {
  const eq = calc.lastIndexOf('=');
  if (eq < 0) return { ok: false, why: '"식 = 값" 모양이 아님' };
  const toks = lex(calc.slice(0, eq));
  const rhs = /[-−–△▵]?\s?\d[\d,]*(?:\.\d+)?/.exec(calc.slice(eq + 1));
  if (!toks || !rhs) return { ok: false, why: '식을 읽을 수 없음(숫자와 + − × ÷ ^ 괄호만)' };
  const value = evaluate(toks);
  if (value === null) return { ok: false, why: '식을 계산할 수 없음' };
  const rt = rhs[0].replace(/^[-−–△▵]\s?/, '');
  const d = decimals(rt);
  // 공식 발표가 더 잔 단위로 계산해 끝자리가 1 다를 수 있다 — 그만큼은 받는다
  if (Math.abs(Math.abs(value) - toNum(rt)) > 10 ** -d + 1e-9) return { ok: false, why: `다시 계산하면 ${Number(value.toFixed(d + 1))}` };
  // 부호도 맞아야 한다 — 감소를 +로 적어 두면 읽는 쪽이 방향을 잘못 안다(0으로 반올림되는 값은 봐준다)
  if (Math.abs(value) > 10 ** -d && value < 0 !== /^[-−–△▵]/.test(rhs[0])) return { ok: false, why: `다시 계산하면 ${Number(value.toFixed(d + 1))} — 부호가 다름` };
  const lhs = toks.filter((t): t is { k: 'n'; v: number } => t.k === 'n').map((t) => t.v);
  const stray = lhs.find((n) => !FREE_CONSTANTS.has(n) && !usable.some((c) => sameNumber(n, decimals(String(n)), c)));
  if (stray !== undefined) return { ok: false, why: `식의 ${stray}이(가) uses의 근거에 없음` };
  return { ok: true, value };
}
