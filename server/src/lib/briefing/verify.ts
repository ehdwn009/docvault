import { BRIEFING } from '../../constants.js';
import { titleKey } from './collect.js';

// AI를 부르지 않는 검증 — 받아 온 본문이 그 기사인지(제목 핵심어 겹침), 요약의 숫자가 근거 재료에 실제로 있는지(숫자 대조),
// 칸이 가리키는 재료 기호가 진짜인지. 비용 0 (개선 합의안 4.5). 숫자 대조는 NUMBER_CHECK_MODE가 'log'면 세기만 한다 —
// 맞는 글을 지워 다시 얕아지는지 2주 지켜본 뒤 'drop'으로 바꾼다

/** 글자 2개씩 묶음 — 한국어는 띄어쓰기가 불규칙해 낱말보다 글자 묶음이 믿을 만하다 */
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** 제목의 글자 묶음이 본문에 얼마나 있나(0~1). 목록·오류 페이지·잘못 붙은 기사는 제목 낱말이 본문에 거의 없다 */
export function titleOverlap(title: string, body: string): number {
  const t = bigrams(titleKey(title));
  if (t.size === 0) return 1;
  const b = titleKey(body);
  let hit = 0;
  for (const g of t) if (b.includes(g)) hit++;
  return hit / t.size;
}

export function bodyMatchesTitle(title: string, body: string): boolean {
  return titleOverlap(title, body) >= BRIEFING.BODY_TITLE_OVERLAP_MIN;
}

// ---- 숫자 대조 ----

const KO_UNIT: Record<string, number> = { 조: 1e12, 억: 1e8, 만: 1e4, 천: 1e3 };
const EN_UNIT: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, tn: 1e12, bn: 1e9, mn: 1e6, k: 1e3 };

/** 글에서 숫자를 값으로 뽑는다 — "1조2000억" → 1.2e12, "$12.5 billion" → 1.25e10, 쉼표 제거, %와 %p 구분 */
export function extractNumbers(text: string): { value: number; kind: 'pct' | 'pctp' | 'plain'; raw: string }[] {
  const out: { value: number; kind: 'pct' | 'pctp' | 'plain'; raw: string }[] = [];
  const re = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(조|억|만|천|trillion|billion|million|thousand|tn|bn|mn|k)?(?:\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(억|만|천))?\s*(%p|％p|%포인트|％포인트|퍼센트포인트|%|％|퍼센트)?/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[0].trim();
    if (!raw) continue;
    let value = Number(m[1]!.replace(/,/g, ''));
    const unit = m[2]?.toLowerCase();
    if (unit) value *= KO_UNIT[unit] ?? EN_UNIT[unit] ?? 1;
    if (m[3] && m[4]) value += Number(m[3].replace(/,/g, '')) * (KO_UNIT[m[4]] ?? 1);
    const suffix = m[5]?.toLowerCase();
    const kind = suffix ? (suffix.includes('p') || suffix.includes('포인트') ? 'pctp' : 'pct') : 'plain';
    // 4.1조 = 4조1000억 — 부동소수점 끝자리 차이가 "다른 값"이 되지 않게 유효숫자 10자리로 맞춘다
    if (Number.isFinite(value)) out.push({ value: Number(value.toPrecision(10)), kind, raw });
  }
  return out;
}

/** 요약 문장의 숫자가 재료에 있나. "약·가량·안팎"이 붙은 문장은 1% 어림을 허용한다. 숫자가 없는 문장은 통과 */
/** 같은 값인가 — 단위 환산 뒤의 미세한 오차는 같은 것으로 본다 */
export function sameValue(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && Math.abs(a - b) / scale < 1e-6;
}

// 영어 재료에서 글자로 쓴 숫자 — "third-quarter"·"a year ago"·"eight"·"Nov. 10"을 한국어로 옮기면 3분기·1년 전·8·11월이 되는데,
// 숫자만 보던 대조가 이것들을 "재료에 없는 숫자"로 세었다(구독 시험 구성 B에서 걸린 45문장 중 표본 전부가 이 경우, 2026-10-30).
// 재료 쪽에만 더한다 — 요약 쪽 숫자를 너그럽게 읽으면 지어낸 숫자가 통과할 틈이 생긴다
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
// may는 조동사와 같은 글자라 넣지 않는다

export function wordNumbers(text: string): { value: number; kind: 'pct' | 'plain'; raw: string }[] {
  const out: { value: number; kind: 'pct' | 'plain'; raw: string }[] = [];
  for (const m of text.toLowerCase().matchAll(/\b([a-z]+)\b/g)) {
    const v = WORD_NUMBERS[m[1]!];
    if (v !== undefined) out.push({ value: v, kind: 'plain', raw: m[1]! });
  }
  // "a year ago", "a month", "a quarter" → 1
  for (const m of text.toLowerCase().matchAll(/\ban? (year|month|week|day|quarter|decade)\b/g)) out.push({ value: 1, kind: 'plain', raw: m[0] });
  // Q3·H1 같은 분기·반기 표기
  for (const m of text.matchAll(/\b[QH]([1-4])\b/g)) out.push({ value: Number(m[1]), kind: 'plain', raw: m[0] });
  // percent는 %와 같다 — "4 percent"는 extractNumbers가 plain으로 읽으니 pct로 한 번 더
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*percent(?!age)/gi)) out.push({ value: Number(m[1]), kind: 'pct', raw: m[0] });
  return out;
}

export function sentenceNumbersSupported(sentence: string, material: string): boolean {
  const nums = extractNumbers(sentence);
  if (nums.length === 0) return true;
  const pool = [...extractNumbers(material), ...wordNumbers(material)];
  const approx = /약|가량|안팎|쯤|near|about|around|roughly/i.test(sentence);
  return nums.every((n) =>
    pool.some((p) => {
      if (p.kind !== n.kind && !(p.kind === 'plain' && n.kind === 'plain')) return false;
      if (sameValue(p.value, n.value)) return true;
      if (!approx || n.value === 0) return false;
      return Math.abs(p.value - n.value) / Math.abs(n.value) <= 0.01;
    }),
  );
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 글 하나를 숫자 대조로 거른다 — 통과 못 한 문장만 지운다(칸 전체가 아니라). 'log' 모드에서는 지우지 않고 수만 센다.
 * 돌려주는 dropped는 모드와 상관없이 "문제 있는 문장 수" — 실행 기록(stats.numberDrops)에 쌓인다
 */
export function checkNumbers(text: string, material: string): { text: string; dropped: number } {
  if (!text) return { text, dropped: 0 };
  const sentences = splitSentences(text);
  const bad = sentences.filter((s) => !sentenceNumbersSupported(s, material));
  if (bad.length === 0) return { text, dropped: 0 };
  if (BRIEFING.NUMBER_CHECK_MODE === 'log') return { text, dropped: bad.length };
  return { text: sentences.filter((s) => !bad.includes(s)).join(' '), dropped: bad.length };
}

/** 숫자 대조로 걸린 문장을 모드와 상관없이 지운다 — 판단 위에 틀린 숫자를 얹지 않는 칸(영향·해설)용 */
export function dropUnsupportedNumbers(text: string, material: string): { text: string; dropped: number } {
  if (!text) return { text, dropped: 0 };
  const sentences = splitSentences(text);
  const kept = sentences.filter((s) => sentenceNumbersSupported(s, material));
  return { text: kept.join(' '), dropped: sentences.length - kept.length };
}

/** 전망·예측 어미 — 해설 "다음에 볼 것"은 "~되면 …" 조건문만 쓰고 예측은 쓰지 않는다 (해설 칸 토론, 감시 조건) */
const PREDICTIVE = /(할 것이다|할 것으로|전망|예상된다|예상이다|예측|것으로 보인다|가능성이 크다|확실시)/;
export function isPredictive(text: string): boolean {
  return PREDICTIVE.test(text);
}

/** "왜 중요한가"가 일반론인가 — 근거 없이 어디에나 붙는 말. 걸리면 그 기사는 핵심에서 주요로 내린다 (개선 합의안 4.4) */
const GENERIC_WHY = /(관심이 쏠린|귀추가 주목|주목된다|이목이 집중|파장이 예상|영향이 주목|변화가 예상|추이를 지켜|관심이 모아)/;
export function isGenericWhy(why: string): boolean {
  const t = why.trim();
  if (!t) return true;
  return GENERIC_WHY.test(t) && t.length < 60;
}

// ---- 영향 칸 검증 (v0.46, 영향 칸 토론 2026-10-11) — 방향은 판단이라 코드가 맞고 틀림을 볼 수 없다.
// 볼 수 있는 것: 그 줄의 방향 낱말이 근거 재료에도 같은 방향으로 있나(stated), 금지어, 길이, 왜 중요한가·양쪽 시각과의 겹침 ----

/** 재료·줄에서 방향을 읽는 어휘 — 기사가 "…에 부담", "…이 늘어난다"처럼 직접 말한 것만 잡는다 */
const DIRECTION_DOWN = /(부담|악화|우려|감소|위축|줄(어|었|여)|하락|둔화|타격|손실|축소|제한|압박|불리|차질|리스크|위험|지연)/;
const DIRECTION_UP = /(기대|개선|확대|증가|늘(어|었|려)|호전|상승|회복|완화|유리|수혜|성장|기회|활성|촉진|강화|도움)/;

export type Direction = 'up' | 'down' | 'mixed';

/** 글에 방향 어휘가 있나 — 둘 다 있으면 mixed, 없으면 null */
export function directionOf(text: string): Direction | null {
  const down = DIRECTION_DOWN.test(text);
  const up = DIRECTION_UP.test(text);
  if (down && up) return 'mixed';
  if (down) return 'down';
  if (up) return 'up';
  return null;
}

/** 영향 줄에 쓰지 않는 말 — 투자 조언으로 읽히거나 확신을 꾸미는 말 (감시 역할의 금지어 목록) */
const IMPACT_BANNED = /(주가|매수|매도|수혜주|호재|악재|투자\s*적기|확실|반드시|틀림없|급등|급락|폭등|폭락|편향|왜곡)/;
export function hasBannedWord(text: string): boolean {
  return IMPACT_BANNED.test(text);
}

/** 한 줄이 다른 글(왜 중요한가·양쪽 시각)을 되풀이하나 — 글자 2개 묶음이 이만큼 겹치면 같은 말 */
export function overlapsWith(line: string, others: string[]): boolean {
  const joined = others.filter(Boolean).join('\n');
  if (!joined) return false;
  return titleOverlap(line, joined) >= BRIEFING.IMPACT_DUP_OVERLAP;
}
