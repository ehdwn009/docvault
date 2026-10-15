import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import type { Material } from './body.js';
import { NO_META_RULE, stripMeta } from './clean.js';
import { errorText, mapLimit } from './limit.js';
import type { Picked } from './select.js';
import { subPath } from './taxonomy.js';
import { checkNumbers, directionOf, dropUnsupportedNumbers, extractNumbers, hasBannedWord, isGenericWhy, isPredictive, overlapsWith, sameValue, sentenceNumbersSupported } from './verify.js';

// ④ 요약 — 핵심·주요 기사만 (뉴스 브리핑 설계 "④ 요약", 개선 합의안 4장). 핵심은 Opus 5.5, 주요는 Sonnet 5.5 (v0.46).
// 글 모양은 "필수 2칸 + 골라 쓰는 칸": 리드(무슨 일 2~3문장)와 왜 중요한가는 늘 쓰고, 배경·숫자·경과·반응·앞으로·용어는
// 재료가 있을 때만 0~3개. 고정 4칸(v0.43)은 재료가 없는 칸까지 채우게 해 일반론과 조각 문장을 낳았다.
// 재료마다 기호(A·B·C·S1·W1)가 붙어 있고 칸마다 어느 재료에서 썼는지(from)를 받는다 — 출처가 섞이는 것을 칸 단위로 잡는다.
// v0.46: 원문을 보는 유일한 호출이라 5W와 영향 칸도 여기서 쓴다 — 요약만 보고 다시 쓰면(옛 lenses.ts) 날짜·장소·근거가 없어 칸이 빈다.
// v0.48: 해설 상자도 같은 호출 — 열 때 만들면 재료가 요약뿐이라 "추론의 추론"이 된다 (해설 칸 토론 2026-10-15)

export const BLOCK_KINDS = ['background', 'numbers', 'timeline', 'reactions', 'next', 'terms'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export type Block = {
  kind: BlockKind;
  text?: string;
  /** numbers 칸 — 칩으로 그린다 */
  pairs?: { label: string; value: string }[];
  /** timeline 칸 — 날짜 열 */
  items?: { date: string; text: string }[];
  /** 근거 재료 기호 — 필수 */
  from: string[];
};

export type Sides = { kind: 'dispute' | 'emphasis'; items: { label: string; text: string; from: string }[] };

/** 5W(v0.46) — 칸마다 근거 기호. 재료에 없는 칸은 아예 없다(화면이 "기사에 없음") */
export type W5Field = { text: string; from: string[] };
export type W5 = { who?: W5Field; what?: W5Field; when?: W5Field; where?: W5Field; why?: W5Field };
export const W5_KEYS = ['who', 'what', 'when', 'where', 'why'] as const;

/** 영향 줄(v0.46) — stated: 기사가 그 방향을 직접 말했다(낱말 부담/기회/갈림이 붙는다) · inferred: AI가 재료에서 짚었다("AI 추론" 표시, 낱말 없음) */
export type ImpactLine = {
  target: string;
  direction: 'up' | 'down' | 'mixed' | 'unclear';
  kind: 'stated' | 'inferred';
  text: string;
  /** 근거 재료 기호 하나 — 필수 */
  from: string;
};

/** 해설 상자(v0.48, 해설 칸 토론 2026-10-15) — 기본 보기 맨 아래 접힌 상자. 칸: 말뜻 · 왜 이렇게 됐나 · 그래서 어떻게 되나 · 다음에 볼 것.
    basis: stated(재료가 말했다, from 있음) · inferred(재료에서 AI가 짚었다, from 있음) · outside(기사 밖 지식, from 없음 — 말뜻·왜에만 허용) */
export const EXPLAIN_KINDS = ['terms', 'why', 'effect', 'watch'] as const;
export type ExplainKind = (typeof EXPLAIN_KINDS)[number];
export type ExplainBasis = 'stated' | 'inferred' | 'outside';
export type ExplainBlock = {
  kind: ExplainKind;
  /** why·effect·watch — 1~2문장 */
  text?: string;
  /** terms — 용어와 한 줄 뜻 */
  items?: { term: string; text: string }[];
  from: string[];
  basis: ExplainBasis;
};

export type Written = {
  title: string;
  /** 리드 — 무슨 일 2~3문장 */
  summary: string;
  summaryFrom: string[];
  why: string;
  whyFrom: string[];
  blocks: Block[];
  /** 양쪽 시각 — 핵심이면서 재료 2곳 이상일 때, 쟁점이나 강조 차이가 있을 때만 */
  sides?: Sides;
  /** 갱신된 이슈 — 직전 회차 이후 바뀐 점 한 줄 */
  changed?: string;
  w5?: W5;
  impact?: ImpactLine[];
  /** 해설 상자 — 칸이 하나도 안 남으면 없다(화면은 상자를 안 그린다) */
  explain?: ExplainBlock[];
  /** 검증 — 숫자 대조로 문제가 된 문장 수, 목표 길이 초과 여부, 검증에서 지운 영향 줄 수, 지운 해설 칸 수 */
  numberDrops: number;
  overrun: boolean;
  impactDrops: number;
  explainDrops: number;
};

/** 요약 근거 하나 — 본문 재료(A·B·C·W1)와 발췌(S1·S2)를 같은 모양으로 번호 매긴다 */
export type Evidence = { id: string; source: string; url: string; text: string; via: Material['via'] | 'lede' };

const SummarySchema = z.object({
  items: z.array(
    z.object({
      k: z.number().describe('기사 번호'),
      title: z.string().describe(`${BRIEFING.TITLE_MAX_CHARS}자 이내 한국어 제목. 원문 제목을 베끼지 말고 새로 쓴다`),
      lead: z.string().describe('무슨 일 — 2~3문장. 첫 문장은 무슨 일이 있었는지, 그다음은 제목에 없는 구체 사실(언제·어디서·규모·누가)'),
      leadSrc: z.string().describe('리드의 근거 재료 기호를 쉼표로 (예: "A,B")'),
      why: z.string().describe('왜 중요한가 — 시장·정책·생활에 어떤 영향인지 1~2문장. 재료에서 근거를 댈 수 있을 때만, 일반론이면 빈 문자열'),
      whySrc: z.string().describe('왜 중요한가의 근거 재료 기호 (쉼표)'),
      blocks: z
        .array(
          z.object({
            kind: z.string().describe('background | numbers | timeline | reactions | next | terms 중 하나'),
            text: z.string().describe('background·reactions·next·terms: 1~3문장. numbers·timeline은 빈 문자열'),
            pairs: z.array(z.object({ label: z.string(), value: z.string() })).describe('numbers만: 항목 이름과 값(재료 표기 그대로, 예 "연 2.50%"). 2~4개'),
            items: z.array(z.object({ date: z.string(), text: z.string() })).describe('timeline만: 날짜와 한 줄. 2~5개'),
            src: z.string().describe('이 칸의 근거 재료 기호 (쉼표)'),
          }),
        )
        .describe('재료가 있는 칸만 0~3개. 없으면 빈 배열'),
      sidesKind: z.string().describe('양쪽 시각: 찬반이 갈리는 쟁점이면 "dispute", 언론사마다 강조점이 다르면 "emphasis", 해당 없으면 빈 문자열'),
      sides: z.array(z.object({ label: z.string(), text: z.string(), src: z.string() })).describe('양쪽 시각 2~3개: 입장·주장 한 문장·근거 재료 기호 하나. 없으면 빈 배열'),
      changed: z.string().describe('직전 회차 요약이 주어진 기사만: 그 뒤 새로 생긴 사실 한 줄. 새 사실이 없거나 직전 요약이 없으면 빈 문자열'),
      w5: z
        .object({
          who: z.string().describe('누가 — 재료에 있는 주체. 없으면 빈 문자열'),
          what: z.string().describe('무엇을 — 한 줄'),
          when: z.string().describe('언제 — 재료에 적힌 날짜·시점 그대로. 없으면 빈 문자열'),
          where: z.string().describe('어디서 — 재료에 적힌 곳. 없으면 빈 문자열'),
          why: z.string().describe('왜(원인·배경) — 재료에 있을 때만. 없으면 빈 문자열'),
          src: z.string().describe('5W의 근거 재료 기호 (쉼표)'),
        })
        .describe('5W — 재료에 있는 것만 짧게(칸당 한 줄). 없는 칸은 빈 문자열로 둔다, 채우지 않는다'),
      impact: z
        .array(
          z.object({
            target: z.string().describe('누구에게 — 가계·기업·시장·산업·정책 또는 기사의 실제 대상(예 "수출 기업"). 6자 이내'),
            direction: z.string().describe('재료가 그 대상에게 부담이라 했으면 "down", 기회·개선이라 했으면 "up", 양면을 말했으면 "mixed", 재료가 방향을 말하지 않았으면 "unclear"'),
            text: z.string().describe('한 문장 60자 이내, "~할 수 있다" 어미. 재료에 있는 사실에서만'),
            src: z.string().describe('근거 재료 기호 하나'),
          }),
        )
        .describe('영향 — 이 기사가 누구에게 어떤 영향인지. 재료에서 근거를 댈 수 있을 때만 0~2줄, 없으면 빈 배열. 왜 중요한가를 되풀이하지 않는다'),
      explain: z
        .object({
          terms: z
            .array(z.object({ term: z.string().describe('용어 그대로'), text: z.string().describe('한 줄 뜻, 초심자 눈높이') }))
            .describe(`말뜻 — 기사 속 제도·전문용어 0~${BRIEFING.EXPLAIN_TERMS_MAX}개. 기사 밖 지식을 써도 된다. 수치·날짜·금액·면적 같은 현행 기준은 쓰지 않는다(제도는 바뀐다). 없으면 빈 배열`),
          why: z.string().describe('왜 이렇게 됐나 — 원인·배경 1~2문장. 재료에 있으면 그것을, 없으면 기사 밖 배경지식으로. 모르면 빈 문자열'),
          whySrc: z.string().describe('왜 이렇게 됐나의 근거 재료 기호(쉼표). 배경지식으로 썼으면 빈 문자열'),
          effect: z.string().describe('그래서 어떻게 되나 — 이 일이 누구에게 어떤 영향인지 1~2문장. 대상은 가계·대출자·세입자·중소기업처럼 사람까지 내려간다. "~할 수 있다" 어미. 재료에 근거가 있을 때만, "해설 효과 칸 없음"이 적힌 기사는 빈 문자열'),
          effectSrc: z.string().describe('그래서 어떻게 되나의 근거 재료 기호(쉼표)'),
          watch: z.string().describe('다음에 볼 것 — "…되면 …" 조건문으로, 이 신호가 나오면 흐름을 안다는 식 1~2문장. 전망·예상은 쓰지 않는다. 날짜·일정은 재료에 있는 것만. 재료에 근거가 있을 때만'),
          watchSrc: z.string().describe('다음에 볼 것의 근거 재료 기호(쉼표)'),
        })
        .describe('해설 — "해설 없음"이 적힌 기사는 전부 빈 값'),
    }),
  ),
});

const KIND_LABEL: Record<BlockKind, string> = { background: '배경', numbers: '숫자', timeline: '경과', reactions: '반응', next: '앞으로', terms: '용어' };

/** 기사 하나의 근거 목록 — 본문 재료가 먼저(A·B·C·W1), 그 뒤 아직 재료가 안 된 보도의 발췌(S1·S2) */
export function evidenceOf(p: Picked, materials: Material[] | undefined): Evidence[] {
  const out: Evidence[] = (materials ?? []).map((m) => ({ id: m.id, source: m.source, url: m.url, text: m.text, via: m.via }));
  const used = new Set(out.map((e) => e.url));
  let n = 0;
  for (const c of [p.main, ...p.related]) {
    if (!c.snippet || used.has(c.url)) continue;
    used.add(c.url);
    out.push({ id: `S${++n}`, source: c.source, url: c.url, text: c.snippet, via: 'lede' });
    if (n >= 4) break;
  }
  return out;
}

/** 목표 길이(글자) — 등급과 재료에 따라 (개선 합의안 4.2). [하한, 상한]. 재료가 아주 얇으면 리드만 쓰게 작게 준다 */
export function lengthTarget(p: Picked, evidence: Evidence[]): [number, number] {
  const bodies = evidence.filter((e) => e.via !== 'lede');
  const chars = evidence.reduce((n, e) => n + e.text.length, 0);
  const deep = bodies.length >= 2 || bodies.some((b) => b.text.length >= BRIEFING.DEEP_SINGLE_BODY_CHARS);
  const base = p.importance === 3 ? (deep ? BRIEFING.LENGTH_CORE_DEEP : BRIEFING.LENGTH_CORE) : BRIEFING.LENGTH_MAJOR;
  const cap = Math.max(80, Math.floor(chars / BRIEFING.LENGTH_MATERIAL_RATIO));
  const upper = Math.min(base[1], cap);
  return [Math.min(base[0], upper), upper];
}

/** 영향 칸을 만드는 기사인가 — 경제·테크(wide) 분야의 핵심·주요, 본문 재료(발췌 말고)가 하나는 있어야 한다. 정치·사회는 만들지 않는다 */
export function impactEligible(p: Picked, evidence: Evidence[]): boolean {
  if (BRIEFING.IMPACT_MODE === 'off') return false;
  if (p.importance < 2 || !p.sub.wide) return false;
  return evidence.some((e) => e.via !== 'lede');
}

/** 해설 상자를 만드는 기사인가 — 핵심·주요 전부(참고는 재료가 없어 배경지식뿐이 된다). effect 칸은 경제·테크(wide)만 — 정치·사회·세계는
    유불리를 못 붙이니 "당사자 나열"이 되고 그건 5W의 "누가"와 같은 말이다 (해설 칸 토론 4/4) */
export function explainEligible(p: Picked): { on: boolean; effect: boolean } {
  if (BRIEFING.EXPLAIN_MODE === 'off' || p.importance < 2) return { on: false, effect: false };
  return { on: true, effect: p.sub.wide };
}

function describe(p: Picked, k: number, evidence: Evidence[], target: [number, number], prevSummary: string | undefined, impact: boolean, explain: { on: boolean; effect: boolean }): string {
  const explainNote = !explain.on ? ' · 해설 없음' : explain.effect ? '' : ' · 해설 효과 칸 없음';
  const head = `${k}. [${subPath(p.sub)}] (${p.main.source}) ${p.main.title} — 목표 ${target[0]}~${target[1]}자${impact ? '' : ' · 영향 칸 없음(빈 배열)'}${explainNote}`;
  const parts = evidence.map((e) => {
    const kind = e.via === 'lede' ? '발췌' : e.via === 'web' ? '웹 검색 보도' : e.via === 'feed' ? '피드 본문' : '본문';
    return `   [${e.id} ${e.source}] ${kind}: ${e.text}`;
  });
  if (parts.length === 0) parts.push('   (재료 없음 — 제목뿐)');
  const others = p.related
    .filter((r) => !evidence.some((e) => e.url === r.url))
    .slice(0, 4)
    .map((r) => `   - (${r.source}) ${r.title}`);
  return [head, ...parts, ...(others.length ? ['   같은 사건의 다른 보도 제목(재료 아님):', ...others] : []), ...(prevSummary ? [`   직전 회차 요약: ${prevSummary}`] : [])].join('\n');
}

const parseSrc = (s: string, valid: Set<string>) => [...new Set(s.split(/[,\s·]+/).map((x) => x.trim().toUpperCase()).filter((x) => valid.has(x)))];

/** 재료 글 — from이 가리키는 것만 합친다. 비었으면 전체 (리드처럼 여러 재료를 섞어 쓰는 칸) */
function materialText(evidence: Evidence[], from: string[]): string {
  const picked = from.length ? evidence.filter((e) => from.includes(e.id)) : evidence;
  return picked.map((e) => e.text).join('\n');
}

/** 숫자 칩은 더 엄격하게 — 값이 그 재료에 그대로 있어야 한다 (크게 보이는 숫자일수록) */
function pairSupported(value: string, material: string): boolean {
  const nums = extractNumbers(value);
  if (nums.length === 0) return true;
  const pool = extractNumbers(material);
  return nums.every((n) => pool.some((p) => sameValue(p.value, n.value) && (p.kind === n.kind || (p.kind === 'plain' && n.kind === 'plain'))));
}

/** 대상이 정책·정부면 유불리를 붙이지 않는다 — "정책에 불리"는 곧 정치 판단이다 (영향 칸 토론, 감시 조건) */
const POLICY_TARGET = /(정책|정부|당국|국회|여당|야당)/;

/**
 * 영향 줄 검증 — 전부 코드, AI 호출 없음. 근거 기호 하나 필수 · 60자 · 금지어 · 숫자 대조 · 왜 중요한가·양쪽 시각과 겹침.
 * 방향: 줄의 방향 어휘가 근거 재료에도 같은 방향으로 있어야 stated. 아니면 inferred로 내리고 방향은 unclear —
 * 재료 2,000자 안에 그 낱말이 있다는 것만 보장하지 같은 대상을 가리키는지는 못 본다는 한계를 알고 쓴다
 */
function verifyImpact(
  raw: { target: string; direction: string; text: string; src: string }[],
  evidence: Evidence[],
  valid: Set<string>,
  others: string[],
  max: number,
): { lines: ImpactLine[]; dropped: number } {
  const lines: ImpactLine[] = [];
  let dropped = 0;
  for (const r of raw) {
    const target = stripMeta(r.target).replace(/\s+/g, ' ').trim();
    const text = stripMeta(r.text).trim();
    const from = parseSrc(r.src, valid)[0];
    if (!target || !text || !from || target.length > BRIEFING.IMPACT_TARGET_MAX_CHARS || text.length > BRIEFING.IMPACT_TEXT_MAX_CHARS) {
      dropped++;
      continue;
    }
    if (hasBannedWord(text) || hasBannedWord(target) || overlapsWith(text, others)) {
      dropped++;
      continue;
    }
    const material = materialText(evidence, [from]);
    // 숫자는 log 모드에서도 영향 줄만큼은 지운다 — 판단 위에 틀린 숫자까지 얹지 않는다
    if (!sentenceNumbersSupported(text, material)) {
      dropped++;
      continue;
    }
    const lineDir = directionOf(text);
    const matDir = directionOf(material);
    const claimed = r.direction.trim();
    let kind: ImpactLine['kind'] = 'inferred';
    let direction: ImpactLine['direction'] = 'unclear';
    if (lineDir && matDir && (lineDir === matDir || matDir === 'mixed') && claimed !== 'unclear') {
      kind = 'stated';
      direction = claimed === 'mixed' ? 'mixed' : lineDir;
    }
    if (POLICY_TARGET.test(target) && (direction === 'up' || direction === 'down')) direction = 'mixed';
    lines.push({ target, direction, kind, text, from });
    if (lines.length >= max) break;
  }
  return { lines, dropped };
}

/**
 * 해설 검증 — 전부 코드. 말뜻·왜는 기사 밖 지식(outside)을 허용하되 숫자·날짜가 있으면 지운다(모델 기억에는 날짜가 없어 현행 기준과 어긋난다).
 * 그래서·다음은 근거 기호가 있어야 남고, 숫자 대조는 모드와 상관없이 지운다. 그래서 칸의 basis는 영향 줄과 같은 규칙(방향 어휘가 재료에도 있으면 stated).
 * 다음은 전망 어미를 지운다. 왜 중요한가·영향 줄·양쪽 시각과 겹치는 칸은 되풀이라 지운다
 */
function verifyExplain(
  raw: { terms: { term: string; text: string }[]; why: string; whySrc: string; effect: string; effectSrc: string; watch: string; watchSrc: string },
  evidence: Evidence[],
  valid: Set<string>,
  others: string[],
  allowEffect: boolean,
): { blocks: ExplainBlock[]; dropped: number } {
  const blocks: ExplainBlock[] = [];
  let dropped = 0;
  const items = raw.terms
    .map((t) => ({ term: stripMeta(t.term).trim(), text: stripMeta(t.text).trim() }))
    .filter((t) => {
      if (!t.term || !t.text) return false;
      const ok = t.term.length <= BRIEFING.EXPLAIN_TERM_MAX_CHARS && t.text.length <= BRIEFING.EXPLAIN_TERM_TEXT_MAX_CHARS && extractNumbers(t.text).length === 0 && !hasBannedWord(t.text);
      if (!ok) dropped++;
      return ok;
    })
    .slice(0, BRIEFING.EXPLAIN_TERMS_MAX);
  if (items.length > 0) blocks.push({ kind: 'terms', items, from: [], basis: 'outside' });

  const textBlock = (kind: 'why' | 'effect' | 'watch', rawText: string, src: string) => {
    let text = stripMeta(rawText).trim();
    if (!text) return;
    const from = parseSrc(src, valid);
    if (text.length > BRIEFING.EXPLAIN_TEXT_MAX_CHARS || hasBannedWord(text) || overlapsWith(text, others)) {
      dropped++;
      return;
    }
    if (kind === 'watch' && isPredictive(text)) {
      dropped++;
      return;
    }
    if (from.length === 0) {
      // 기사 밖 지식은 왜 이렇게 됐나에만 — 그래서·다음은 재료 근거가 없으면 AI의 전망이 된다 (감시 조건)
      if (kind !== 'why' || extractNumbers(text).length > 0) {
        dropped++;
        return;
      }
      blocks.push({ kind, text, from, basis: 'outside' });
      return;
    }
    const material = materialText(evidence, from);
    const r = dropUnsupportedNumbers(text, material);
    dropped += r.dropped;
    text = r.text;
    if (!text) return;
    let basis: ExplainBasis = 'stated';
    if (kind === 'effect') {
      const lineDir = directionOf(text);
      const matDir = directionOf(material);
      basis = lineDir && matDir && (lineDir === matDir || matDir === 'mixed') ? 'stated' : 'inferred';
    }
    blocks.push({ kind, text, from, basis });
  };
  textBlock('why', raw.why, raw.whySrc);
  if (allowEffect) textBlock('effect', raw.effect, raw.effectSrc);
  else if (raw.effect.trim()) dropped++;
  textBlock('watch', raw.watch, raw.watchSrc);
  return { blocks, dropped };
}

/** 핵심·주요 이슈의 글. 돌려주는 Map의 열쇠는 picked 배열의 위치 */
export async function summarize(
  picked: Picked[],
  materials: Map<number, Material[]>,
  ai: AiCaller,
  usage: Usage,
  opts: { prevSummaries?: Map<string, string>; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<number, Written>> {
  // 대분류(국내 경제, 세계 테크…)끼리 묶어야 모델이 같은 맥락에서 쓴다. 핵심은 재료가 길어 3건씩, 그리고 상위 모델
  const groups = new Map<string, number[]>();
  picked.forEach((p, i) => {
    if (p.importance < 2) return;
    const key = `${p.importance === 3 ? 'core' : 'major'}/${p.sub.section}/${p.sub.category}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const batches: { idxs: number[]; core: boolean }[] = [];
  for (const [key, idxs] of groups) {
    const core = key.startsWith('core/');
    const size = core ? BRIEFING.SUMMARY_CHUNK_CORE : BRIEFING.SUMMARY_CHUNK;
    for (let i = 0; i < idxs.length; i += size) batches.push({ idxs: idxs.slice(i, i + size), core });
  }

  const written = new Map<number, Written>();
  let done = 0;
  opts.onProgress?.(0, batches.length);
  const results = await mapLimit(batches, BRIEFING.SUMMARY_CONCURRENCY, async ({ idxs: batch, core }) => {
    const ev = batch.map((idx) => evidenceOf(picked[idx]!, materials.get(idx)));
    const targets = batch.map((idx, j) => lengthTarget(picked[idx]!, ev[j]!));
    const eligible = batch.map((idx, j) => impactEligible(picked[idx]!, ev[j]!));
    const explains = batch.map((idx) => explainEligible(picked[idx]!));
    const lines = batch
      .map((idx, j) => describe(picked[idx]!, j + 1, ev[j]!, targets[j]!, picked[idx]!.prevStoryId ? opts.prevSummaries?.get(picked[idx]!.prevStoryId) : undefined, eligible[j]!, explains[j]!))
      .join('\n');
    const out = await callAndCount(ai, usage, {
      model: core ? BRIEFING.SUMMARY_MODEL_CORE : BRIEFING.SUMMARY_MODEL,
      stage: core ? 'summarize-core' : 'summarize',
      system: SYSTEM_BASE,
      user: [
        '아래 기사마다 브리핑 글을 한국어로 써라. 해외 기사도 한국어로. 기사마다 재료에 [기호 언론사]가 붙어 있다.',
        `- 제목: ${BRIEFING.TITLE_MAX_CHARS}자 이내. 핵심 수치나 주체가 보이게.`,
        '- 리드(lead): 무슨 일인지 2~3문장. 첫 문장은 주어를 다시 써도 된다. 대신 제목에 없는 구체 사실을 둘 이상 넣는다.',
        '- 왜 중요한가(why): 시장·정책·생활에 어떤 영향인지. 재료에서 근거를 댈 수 있을 때만. "관심이 쏠린다", "귀추가 주목된다" 같은 일반론은 쓰지 말고 빈 문자열로.',
        `- 골라 쓰는 칸(blocks): ${BLOCK_KINDS.map((k) => `${k}(${KIND_LABEL[k]})`).join(' · ')} 중 **재료가 있는 것만 0~${BRIEFING.BLOCKS_MAX}개**. 없으면 빈 배열. 칸을 채우려고 일반론을 쓰지 않는다. 리드에 쓴 사실을 칸에서 되풀이하지 않는다.`,
        '  · numbers: pairs에 항목·값 2~4개, 값은 재료 표기 그대로. text는 빈 문자열.  · timeline: items에 날짜·한 줄 2~5개, 재료에 날짜가 있을 때만.',
        '  · terms: 재료에 나온 어려운 용어를 한 줄로 풀이. 수치·날짜·사람 이름은 쓰지 않는다.  · next: 재료에 나온 일정·후속 조치만, 짐작하지 않는다.',
        '- 근거 기호(leadSrc·whySrc·src): 그 글을 어느 재료에서 썼는지 기호를 적는다. 재료 기호가 아닌 것은 적지 않는다. 재료가 없는 칸은 만들지 않는다.',
        '- 언론사마다 수치가 다르면 평균 내지 말고 "A 기준 x, B 기준 y"로 나란히 쓴다.',
        '- 양쪽 시각(sides): 재료가 2곳 이상인 핵심 기사에서, 찬반이 갈리는 쟁점이면 dispute로 양쪽 주장을, 언론사마다 강조한 점이 실제로 다르면 emphasis로 2~3개. 각 항목의 src는 재료 하나. 한쪽만 있거나 다 같은 내용이면 빈 배열 — 억지로 맞추지 않는다. 편향·왜곡 같은 평가어는 쓰지 않는다.',
        '- changed: "직전 회차 요약"이 붙은 기사만, 그 요약에 없던 새 사실을 한 줄로. 새 사실이 없으면 빈 문자열.',
        `- 5W(w5): 누가·무엇을·언제·어디서·왜를 재료에 있는 것만 칸당 한 줄(${BRIEFING.W5_TEXT_MAX_CHARS}자 이내). 날짜·장소는 재료 표기 그대로. 재료에 없는 칸은 빈 문자열로 둔다 — 채우지 않는다. src에 근거 기호.`,
        `- 영향(impact): "영향 칸 없음"이 적힌 기사는 빈 배열. 나머지는 이 일이 누구에게 어떤 영향인지 0~${BRIEFING.IMPACT_MAX_CORE}줄 — 대상(target ${BRIEFING.IMPACT_TARGET_MAX_CHARS}자 이내) · 방향(direction) · 한 문장(${BRIEFING.IMPACT_TEXT_MAX_CHARS}자 이내, "~할 수 있다" 어미) · 근거 기호 하나(src). 재료가 그 방향을 직접 말했을 때만 up/down/mixed, 재료에서 짚어낸 것이면 unclear. 왜 중요한가·양쪽 시각에 쓴 문장을 되풀이하지 않는다. 재료 밖 연쇄 추론(금리 → 내 대출)은 쓰지 않는다. 주가·매수·매도·호재·악재·확실·반드시 같은 말은 쓰지 않는다.`,
        `- 해설(explain): 기사가 아니라 AI가 푸는 글이라 따로 표시된다. "해설 없음"이 적힌 기사는 전부 빈 값. 말뜻(terms)은 기사 속 제도·전문용어 0~${BRIEFING.EXPLAIN_TERMS_MAX}개를 초심자 눈높이 한 줄로 — 이 칸만은 기사 밖 지식을 써도 되지만 수치·날짜·금액·면적 같은 현행 기준은 쓰지 않는다(제도는 바뀐다). 왜 이렇게 됐나(why)는 원인·배경 1~2문장 — 재료에 있으면 whySrc에 기호를, 재료 밖 배경지식이면 whySrc를 비운다(그때는 숫자·날짜·고유명사를 쓰지 않는다). 그래서 어떻게 되나(effect)는 재료에 근거가 있을 때만, 대상을 가계·대출자·세입자처럼 사람까지 내려 1~2문장("~할 수 있다"). 한 단계 결과만 쓰고 그 결과의 결과(금리 → 내 대출 → 소비)는 쓰지 않는다. "해설 효과 칸 없음"이 적힌 기사는 빈 문자열. 다음에 볼 것(watch)은 "…되면 …"처럼 조건문으로, 이 신호가 나오면 흐름을 안다는 식 1~2문장 — 전망·예상은 쓰지 않고 날짜·일정은 재료에 있는 것만. 왜 중요한가·영향·양쪽 시각에 쓴 문장을 되풀이하지 않는다. 주가·매수·매도·호재·악재·확실·반드시 같은 말은 쓰지 않는다. 모르면 비운다.`,
        '- 길이: 기사마다 적힌 목표 글자 수(리드+왜 중요한가+칸 합계) 안에서. 재료가 짧으면 짧게 쓴다. 해설은 목표 길이에 넣지 않는다.',
        '- 수치·날짜·고유명사는 재료에 있는 것만. 재료 밖의 배경지식을 사실처럼 쓰지 않는다. 원문 문장을 베끼지 말고 새로 쓴다.',
        NO_META_RULE,
        `\n<기사>\n${lines}\n</기사>`,
      ].join('\n'),
      schema: SummarySchema,
      maxTokens: BRIEFING.SUMMARY_MAX_OUTPUT_TOKENS,
      signal: opts.signal,
    });
    opts.onProgress?.(++done, batches.length);
    for (const it of out.items) {
      const j = it.k - 1;
      const idx = batch[j];
      if (idx === undefined || !it.title.trim()) continue;
      const evidence = ev[j]!;
      const target = targets[j]!;
      const valid = new Set(evidence.map((e) => e.id));
      let drops = 0;
      const clean = (text: string, from: string[]) => {
        const r = checkNumbers(stripMeta(text), materialText(evidence, from));
        drops += r.dropped;
        return r.text;
      };
      const summaryFrom = parseSrc(it.leadSrc, valid);
      const whyFrom = parseSrc(it.whySrc, valid);
      const summary = clean(it.lead, summaryFrom);
      // 왜 중요한가 — 근거 기호가 없거나 일반론이면 비운다(조립 단계가 핵심→주요로 내린다)
      let why = whyFrom.length ? clean(it.why, whyFrom) : '';
      if (isGenericWhy(why)) why = '';

      const blocks: Block[] = [];
      for (const b of it.blocks) {
        if (blocks.length >= BRIEFING.BLOCKS_MAX) break;
        const kind = b.kind.trim() as BlockKind;
        if (!BLOCK_KINDS.includes(kind)) continue;
        const from = parseSrc(b.src, valid);
        if (from.length === 0) continue; // 근거 없는 칸은 버린다
        const mat = materialText(evidence, from);
        if (kind === 'numbers') {
          const pairs = b.pairs.filter((x) => x.label.trim() && x.value.trim()).filter((x) => {
            const ok = pairSupported(x.value, mat);
            if (!ok) drops++;
            return ok;
          });
          if (pairs.length >= 1) blocks.push({ kind, pairs: pairs.slice(0, 4), from });
        } else if (kind === 'timeline') {
          const items = b.items.filter((x) => x.date.trim() && x.text.trim()).map((x) => ({ date: x.date.trim(), text: clean(x.text, from) })).filter((x) => x.text);
          if (items.length >= 2) blocks.push({ kind, items: items.slice(0, 5), from });
        } else {
          const text = clean(b.text, from);
          if (text) blocks.push({ kind, text, from });
        }
      }

      let sides: Sides | undefined;
      const sk = it.sidesKind.trim();
      if ((sk === 'dispute' || sk === 'emphasis') && picked[idx]!.importance === 3) {
        const items = it.sides
          .map((s) => ({ label: s.label.trim(), text: '', from: parseSrc(s.src, valid)[0] ?? '', raw: s.text }))
          .filter((s) => s.label && s.from)
          .map((s) => ({ label: s.label, text: clean(s.raw, [s.from]), from: s.from }))
          .filter((s) => s.text)
          .slice(0, BRIEFING.ANGLES_MAX);
        // 한쪽뿐이면 양쪽 시각이 아니다
        if (items.length >= 2 && new Set(items.map((s) => s.from)).size >= 2) sides = { kind: sk, items };
      }
      const changed = picked[idx]!.prevStoryId ? clean(it.changed, summaryFrom) : '';

      // 5W — 근거 기호가 없으면 리드의 근거로. 칸마다 숫자 대조, 길이 상한. what이 없으면 5W 자체가 없다
      const w5From = parseSrc(it.w5.src, valid);
      const w5Base = w5From.length ? w5From : summaryFrom;
      const w5: W5 = {};
      for (const key of W5_KEYS) {
        const text = clean(it.w5[key], w5Base).trim();
        if (text && text.length <= BRIEFING.W5_TEXT_MAX_CHARS) w5[key] = { text, from: w5Base };
      }

      // 영향 — 자격이 있는 기사만, 검증을 통과한 줄만 (impactEligible·verifyImpact)
      let impact: ImpactLine[] | undefined;
      let impactDrops = 0;
      if (eligible[j]) {
        const max = picked[idx]!.importance === 3 ? BRIEFING.IMPACT_MAX_CORE : BRIEFING.IMPACT_MAX_MAJOR;
        const r = verifyImpact(it.impact, evidence, valid, [why, ...(sides?.items.map((s) => s.text) ?? [])], max);
        impactDrops = r.dropped;
        if (r.lines.length > 0) impact = r.lines;
      }

      // 해설 — 핵심·주요 전부. 왜 중요한가·영향·양쪽 시각과 겹치는 칸은 지운다 (verifyExplain)
      let explain: ExplainBlock[] | undefined;
      let explainDrops = 0;
      if (explains[j]!.on) {
        const r = verifyExplain(it.explain, evidence, valid, [why, ...(impact?.map((l) => l.text) ?? []), ...(sides?.items.map((s) => s.text) ?? [])], explains[j]!.effect);
        explainDrops = r.dropped;
        if (r.blocks.length > 0) explain = r.blocks;
      }

      const total = summary.length + why.length + blocks.reduce((n, b) => n + (b.text?.length ?? 0) + (b.pairs?.length ?? 0) * 12 + (b.items?.reduce((m, x) => m + x.text.length, 0) ?? 0), 0);
      written.set(idx, {
        title: it.title.trim(),
        summary,
        summaryFrom,
        why,
        whyFrom: why ? whyFrom : [],
        blocks,
        ...(sides ? { sides } : {}),
        ...(changed ? { changed } : {}),
        ...(w5.what ? { w5 } : {}),
        ...(impact ? { impact } : {}),
        ...(explain ? { explain } : {}),
        numberDrops: drops,
        overrun: total > target[1] * BRIEFING.LENGTH_OVERRUN_RATIO,
        impactDrops,
        explainDrops,
      });
    }
  });
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) throw new Error(`요약 실패 — ${errorText(failed.error)}`);
  return written;
}
