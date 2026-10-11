import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { callAndCount, SYSTEM_BASE, type AiCaller, type Usage } from './ai.js';
import type { Material } from './body.js';
import { NO_META_RULE, stripMeta } from './clean.js';
import { errorText, mapLimit } from './limit.js';
import type { Picked } from './select.js';
import { subPath } from './taxonomy.js';
import { checkNumbers, extractNumbers, isGenericWhy, sameValue } from './verify.js';

// ④ 요약 (Sonnet) — 핵심·주요 기사만 (뉴스 브리핑 설계 "④ 요약", 개선 합의안 4장).
// 글 모양은 "필수 2칸 + 골라 쓰는 칸": 리드(무슨 일 2~3문장)와 왜 중요한가는 늘 쓰고, 배경·숫자·경과·반응·앞으로·용어는
// 재료가 있을 때만 0~3개. 고정 4칸(v0.43)은 재료가 없는 칸까지 채우게 해 일반론과 조각 문장을 낳았다.
// 재료마다 기호(A·B·C·S1·W1)가 붙어 있고 칸마다 어느 재료에서 썼는지(from)를 받는다 — 출처가 섞이는 것을 칸 단위로 잡는다

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
  /** 검증 — 숫자 대조로 문제가 된 문장 수, 목표 길이 초과 여부 */
  numberDrops: number;
  overrun: boolean;
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

function describe(p: Picked, k: number, evidence: Evidence[], target: [number, number], prevSummary: string | undefined): string {
  const head = `${k}. [${subPath(p.sub)}] (${p.main.source}) ${p.main.title} — 목표 ${target[0]}~${target[1]}자`;
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

/** 핵심·주요 이슈의 글. 돌려주는 Map의 열쇠는 picked 배열의 위치 */
export async function summarize(
  picked: Picked[],
  materials: Map<number, Material[]>,
  ai: AiCaller,
  usage: Usage,
  opts: { prevSummaries?: Map<string, string>; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<number, Written>> {
  // 대분류(국내 경제, 세계 테크…)끼리 묶어야 모델이 같은 맥락에서 쓴다. 핵심은 재료가 길어 3건씩
  const groups = new Map<string, number[]>();
  picked.forEach((p, i) => {
    if (p.importance < 2) return;
    const key = `${p.importance === 3 ? 'core' : 'major'}/${p.sub.section}/${p.sub.category}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const batches: number[][] = [];
  for (const [key, idxs] of groups) {
    const size = key.startsWith('core/') ? BRIEFING.SUMMARY_CHUNK_CORE : BRIEFING.SUMMARY_CHUNK;
    for (let i = 0; i < idxs.length; i += size) batches.push(idxs.slice(i, i + size));
  }

  const written = new Map<number, Written>();
  let done = 0;
  opts.onProgress?.(0, batches.length);
  const results = await mapLimit(batches, BRIEFING.SUMMARY_CONCURRENCY, async (batch) => {
    const ev = batch.map((idx) => evidenceOf(picked[idx]!, materials.get(idx)));
    const targets = batch.map((idx, j) => lengthTarget(picked[idx]!, ev[j]!));
    const lines = batch.map((idx, j) => describe(picked[idx]!, j + 1, ev[j]!, targets[j]!, picked[idx]!.prevStoryId ? opts.prevSummaries?.get(picked[idx]!.prevStoryId) : undefined)).join('\n');
    const out = await callAndCount(ai, usage, {
      model: BRIEFING.SUMMARY_MODEL,
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
        '- 길이: 기사마다 적힌 목표 글자 수(리드+왜 중요한가+칸 합계) 안에서. 재료가 짧으면 짧게 쓴다.',
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
        numberDrops: drops,
        overrun: total > target[1] * BRIEFING.LENGTH_OVERRUN_RATIO,
      });
    }
  });
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) throw new Error(`요약 실패 — ${errorText(failed.error)}`);
  return written;
}
