import { z } from 'zod';
import { TRADE } from '../../constants.js';

// 해부 결과(data.json)를 원문 쪽 텍스트와 대조한다 — 서버가 완성본을 받을 때와 스킬이 보내기 전에 같은 함수를 쓴다 (수출입 동향 설계 2단계 "서버의 대조").
// 원칙: AI는 숫자를 새로 만들지 않는다. 인용은 그 쪽에 글자 그대로 있어야 하고, 표의 값은 출처 줄에 그대로 있어야 한다

export type PageTexts = { cur: string[]; prev: string[] | null };
export type VerifyReport = { checked: number; passed: number; dropped: string[]; fatal: string[] };

const QuoteSchema = z.object({ page: z.number().int().positive(), quote: z.string().min(1).max(TRADE.QUOTE_MAX_CHARS), doc: z.enum(['cur', 'prev']).optional() }).passthrough();
const Obj = z.object({}).passthrough();
const withId = z.object({ id: z.string().min(1).max(40) }).passthrough();

/** 모양 검사는 느슨하게 — 화면이 읽는 칸의 존재와 인용의 모양만. 내용의 진위는 아래 대조가 본다 */
export const TradeDataSchema = z
  .object({
    meta: z
      .object({
        period: z.string().regex(/^\d{4}-\d{2}$/),
        label: z.string().min(1).max(40),
        month: z.string().min(1).max(10),
        prevMonth: z.string().min(1).max(10),
        cards: z.array(z.object({ id: z.string() }).passthrough()).max(8),
        kpis: z.array(z.object({ claim: z.string() }).passthrough()).max(6),
        viz: z.record(z.array(Obj)).default({}),
      })
      .passthrough(),
    claims: z.array(withId.extend({ short: z.string().min(1).max(80), claim: QuoteSchema, evidence: z.array(QuoteSchema).default([]), underneath: z.array(Obj).default([]) })).min(1).max(40),
    vsPrev: z.array(withId).default([]),
    items20: z.array(z.object({ name: z.string(), amt: z.number(), yoy: z.number() }).passthrough()).max(40).default([]),
    items20_summary: Obj.default({}),
    regions: z.array(z.object({ name: z.string(), amt: z.number(), yoy: z.number() }).passthrough()).max(20).default([]),
    nih: z.array(withId).default([]),
    links: z.array(withId.extend({ from: QuoteSchema, to: QuoteSchema })).default([]),
    changes: z.array(withId).default([]),
    topics: z.array(withId.extend({ name: z.string(), mentions: z.array(QuoteSchema).default([]) })).default([]),
    pages: z.array(z.object({ page: z.number().int().positive(), title: z.string() }).passthrough()).default([]),
    series: z.object({ months: z.array(z.string()).default([]) }).passthrough().default({ months: [] }),
    itemSeries: z.record(z.array(z.number().nullable())).default({}),
    tableRows: z.record(z.object({ source: QuoteSchema, values: z.array(z.number().nullable()).min(1).max(40) })).default({}),
  })
  .passthrough();

export type TradeData = z.infer<typeof TradeDataSchema>;

const norm = (s: string) => s.replace(/\s+/g, '');
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isQuote = (v: Record<string, unknown>): v is Record<string, unknown> & { page: unknown; quote: string } => 'page' in v && typeof v.quote === 'string';

/** 이 열쇠의 인용이 틀리면 열쇠만 지우고 부모는 살린다 — 품목의 해설(why)이 틀려도 품목 숫자 칸은 남긴다 */
const OPTIONAL_HOLDERS = new Set(['why']);

function labelOf(v: unknown): string {
  if (!isRecord(v)) return '';
  for (const k of ['id', 'title', 'label', 'name', 'what']) if (typeof v[k] === 'string') return ` (${v[k] as string})`;
  return '';
}

class Checker {
  private readonly text: Record<'cur' | 'prev', string[]>;
  readonly report: VerifyReport = { checked: 0, passed: 0, dropped: [], fatal: [] };

  constructor(pages: PageTexts) {
    this.text = { cur: pages.cur.map(norm), prev: (pages.prev ?? []).map(norm) };
  }

  has(doc: 'cur' | 'prev', page: unknown, quote: string): boolean {
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return false;
    const q = norm(quote);
    return q.length > 0 && (this.text[doc][page - 1] ?? '').includes(q);
  }

  /** 숫자 하나가 이번 호의 그 쪽에 그대로 있는가 — 쉼표 유무는 무시한다 */
  hasNumber(page: number, token: string): boolean {
    const text = this.text.cur[page - 1] ?? '';
    return text.includes(token) || text.replace(/,/g, '').includes(token.replace(/,/g, ''));
  }

  /** 인용 하나 — 전월 호인지는 객체의 doc, 없으면 경로에 prev가 있는지로 */
  quote(node: { page: unknown; quote: string; doc?: unknown }, path: string[]): boolean {
    const doc = node.doc === 'prev' || node.doc === 'cur' ? node.doc : path.includes('prev') ? 'prev' : 'cur';
    this.report.checked++;
    const ok = this.has(doc, node.page, node.quote);
    if (ok) this.report.passed++;
    return ok;
  }

  /** 나무를 훑는다. false = 이 노드는 틀렸다(가장 가까운 목록 항목이 통째로 빠진다) */
  walk(node: unknown, path: string[]): boolean {
    if (Array.isArray(node)) {
      const keep: unknown[] = [];
      node.forEach((v, i) => {
        if (this.walk(v, [...path, String(i)])) keep.push(v);
        else this.report.dropped.push(`${path.join('/')}/${i}${labelOf(v)}`);
      });
      node.length = 0;
      node.push(...keep);
      return true;
    }
    if (!isRecord(node)) return true;
    if (isQuote(node) && !this.quote(node, path)) return false;
    for (const [k, v] of Object.entries(node)) {
      if (!isRecord(v) && !Array.isArray(v)) continue;
      if (this.walk(v, [...path, k])) continue;
      if (!OPTIONAL_HOLDERS.has(k)) return false;
      delete node[k];
      this.report.dropped.push([...path, k].join('/'));
    }
    return true;
  }
}

/** 값이 출처 줄에 그대로 있는가 — 쉼표는 무시, 음수는 원문의 △·- 표기 둘 다 받는다 */
function valueInLine(v: number, flat: string): boolean {
  const abs = String(Math.abs(v));
  if (v < 0) return flat.includes(`△${abs}`) || flat.includes(`-${abs}`) || flat.includes(`▵${abs}`);
  return flat.includes(abs);
}

function pruneRefs(d: TradeData): void {
  const ids = (xs: { id?: unknown }[]) => new Set(xs.map((x) => x.id));
  const links = ids(d.links);
  const changes = ids(d.changes);
  const vs = ids(d.vsPrev);
  const nih = ids(d.nih);
  const only = (v: unknown, set: Set<unknown>) => (Array.isArray(v) ? v.filter((x) => set.has(x)) : []);
  for (const c of d.claims as Record<string, unknown>[]) {
    c.related_links = only(c.related_links, links);
    c.related_changes = only(c.related_changes, changes);
    c.prev = only(c.prev, vs);
    if ('nih' in c) c.nih = only(c.nih, nih);
  }
  for (const n of d.nih as Record<string, unknown>[]) n.related = Array.isArray(n.related) ? n.related.filter((x) => links.has(x) || changes.has(x)) : [];
  const claimIds = ids(d.claims);
  const meta = d.meta as Record<string, unknown> & { cards: { id: string }[]; kpis: { claim: string }[] };
  meta.headlineCompare = only(meta.headlineCompare, vs);
  meta.cards = meta.cards.filter((c) => claimIds.has(c.id));
  meta.kpis = meta.kpis.filter((k) => claimIds.has(k.claim));
}

/** 숫자 4칸(meta.kpis)의 큰 값 — 그 안의 숫자가 1쪽이나 그 칸이 가리키는 문장의 쪽에 그대로 있어야 한다.
 *  동향 탭 큰 카드에 가장 크게 보이는 숫자라, 없으면 그 칸만 뺀다. 작은 글씨(sub)는 계산값(✎)이 섞여 있어 보지 않는다 */
function checkKpis(data: TradeData, ck: Checker): void {
  const pageOf = new Map(data.claims.map((c) => [c.id, c.claim.page]));
  const kpis = data.meta.kpis as (Record<string, unknown> & { claim: string })[];
  data.meta.kpis = kpis.filter((k) => {
    const nums = typeof k.value === 'string' ? (k.value.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) : [];
    const pages = [1, pageOf.get(k.claim)].filter((p): p is number => typeof p === 'number');
    ck.report.checked++;
    if (nums.length > 0 && nums.every((n) => pages.some((p) => ck.hasNumber(p, n)))) {
      ck.report.passed++;
      return true;
    }
    ck.report.dropped.push(`meta/kpis${labelOf(k)} — 값의 숫자가 1쪽·근거 쪽에 없음`);
    return false;
  });
}

/**
 * 대조하고, 틀린 항목을 걷어 낸 data를 돌려준다. report.fatal이 비어 있지 않으면 저장하지 않는다(고쳐 다시).
 * 입력을 고치지 않는다 — 깊은 복사본 위에서 일한다
 */
export function verifyTradeData(input: TradeData, pages: PageTexts): { data: TradeData; report: VerifyReport } {
  const data = structuredClone(input);
  const ck = new Checker(pages);
  const { report } = ck;

  // 1쪽 문장 — 주장 자체나 근거가 틀리면 조용히 빼지 않고 거절한다(헤드라인이 하나 사라진 화면은 틀린 화면이다)
  for (const c of data.claims as (Record<string, unknown> & { id: string; underneath: Record<string, unknown>[] })[]) {
    const under = c.underneath;
    c.underneath = [];
    if (!ck.walk(c, ['claims', c.id])) report.fatal.push(`claims/${c.id}: 1쪽 문장(claim)이나 그 안의 인용이 원문에 없음`);
    // 풀어보기 — 인용이 있거나, "원문 숫자로 계산" + 식이 있어야 한다
    c.underneath = under.filter((u) => {
      const where = `claims/${c.id}/underneath${labelOf(u)}`;
      if (typeof u.quote === 'string') {
        if (ck.quote(u as { page: unknown; quote: string; doc?: unknown }, [])) return true;
        report.dropped.push(where);
        return false;
      }
      if (u.basis === '원문 숫자로 계산' && typeof u.calc === 'string' && u.calc.trim() !== '') return true;
      report.dropped.push(`${where} — 인용도 계산식도 없음`);
      return false;
    });
  }
  for (const key of ['items20', 'regions', 'nih', 'vsPrev', 'changes', 'topics', 'links'] as const) ck.walk(data[key], [key]);
  data.topics = data.topics.filter((t) => t.mentions.length > 0);

  // 숫자 표 — 출처 줄이 원문에 있고, 값 하나하나가 그 줄에 있어야 한다
  for (const [key, row] of Object.entries(data.tableRows)) {
    report.checked++;
    if (!ck.has('cur', row.source.page, row.source.quote)) {
      report.fatal.push(`tableRows/${key}: 출처 줄이 ${row.source.page}쪽에 없음`);
      continue;
    }
    const flat = norm(row.source.quote).replace(/,/g, '');
    const missing = row.values.filter((v): v is number => v !== null && !valueInLine(v, flat));
    if (missing.length) {
      report.fatal.push(`tableRows/${key}: 값 ${missing.slice(0, 3).join(', ')}이 출처 줄에 없음`);
      continue;
    }
    report.passed++;
  }
  // 화면의 추이는 세션이 준 series를 쓰지 않고 대조를 통과한 줄에서 만든다 — 표와 그림이 어긋날 수 없게
  const series: Record<string, unknown> = { months: data.series.months };
  const itemSeries: Record<string, (number | null)[]> = {};
  for (const [key, row] of Object.entries(data.tableRows)) {
    if (key.startsWith('item:')) itemSeries[key.slice(5)] = row.values;
    else series[key] = row.values;
  }
  data.series = series as TradeData['series'];
  data.itemSeries = itemSeries;

  checkKpis(data, ck);
  pruneRefs(data);
  if (data.claims.length === 0) report.fatal.push('claims가 비었음');
  if (report.checked > 0 && report.dropped.length / report.checked > TRADE.DROP_REJECT_RATIO) {
    report.fatal.push(`인용 ${report.checked}개 중 ${report.dropped.length}개가 원문과 맞지 않음 (${Math.round(TRADE.DROP_REJECT_RATIO * 100)}% 초과)`);
  }
  (data.meta as Record<string, unknown>).quotesChecked = report.passed;
  return { data, report };
}

export function reportLines(r: VerifyReport): string[] {
  const lines = [`인용·출처 대조 ${r.passed}/${r.checked} 통과`, `뺀 항목 ${r.dropped.length}개`, ...r.dropped.map((d) => `  - ${d}`)];
  if (r.fatal.length) lines.push('고쳐야 받습니다:', ...r.fatal.map((f) => `  ! ${f}`));
  return lines;
}
