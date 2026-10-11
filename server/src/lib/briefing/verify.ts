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
  const re = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(조|억|만|천|trillion|billion|million|thousand|tn|bn|mn|k)?(?:\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(억|만|천))?\s*(%p|％p|퍼센트포인트|%|％|퍼센트)?/gi;
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

export function sentenceNumbersSupported(sentence: string, material: string): boolean {
  const nums = extractNumbers(sentence);
  if (nums.length === 0) return true;
  const pool = extractNumbers(material);
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

/** "왜 중요한가"가 일반론인가 — 근거 없이 어디에나 붙는 말. 걸리면 그 기사는 핵심에서 주요로 내린다 (개선 합의안 4.4) */
const GENERIC_WHY = /(관심이 쏠린|귀추가 주목|주목된다|이목이 집중|파장이 예상|영향이 주목|변화가 예상|추이를 지켜|관심이 모아)/;
export function isGenericWhy(why: string): boolean {
  const t = why.trim();
  if (!t) return true;
  return GENERIC_WHY.test(t) && t.length < 60;
}
