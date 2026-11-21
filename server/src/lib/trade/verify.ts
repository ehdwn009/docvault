import { z } from 'zod';
import { TRADE } from '../../constants.js';
import { checkCalc, decimals, norm, NUM, numbersToBack, quoteNumbers, sameNumber, toNum } from '../factcheck.js';

// 정리본(data.json, format 2)을 원문 쪽 텍스트와 대조한다 — 서버가 완성본을 받을 때와 스킬이 보내기 전에 같은 함수를 쓴다
// (수출입 동향 설계 4단계 "정리본의 대조"). 화면에는 근거를 보이지 않지만 대조는 뒤에서 그대로 한다:
//  ① 근거(facts)의 인용은 그 쪽에 글자 그대로 있어야 한다  ② 계산식은 다시 계산해 본다
//  ③ 문장에 나온 숫자는 그 문장이 가리킨 근거 안에 있어야 한다  ④ 표·그래프의 숫자는 세션이 준 값이 아니라 대조를 통과한 표 줄에서 서버가 만든다

export type PageTexts = { cur: string[]; prev: string[] | null };
export type VerifyReport = { checked: number; passed: number; dropped: string[]; fatal: string[] };

const Quote = z.object({ page: z.number().int().positive(), quote: z.string().min(1).max(TRADE.QUOTE_MAX_CHARS), doc: z.enum(['cur', 'prev']).optional() });
const Calc = z.object({ calc: z.string().min(3).max(300), uses: z.array(z.string()).max(12).default([]) });
const Fact = z.union([Quote, Calc]);
const ids = z.array(z.string().max(40)).max(30).default([]);
const Text = z.string().min(1).max(TRADE.REPORT_TEXT_MAX_CHARS);
const Lead = z.object({ lead: z.string().min(1).max(80), text: Text, facts: ids });

const Block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text: Text, facts: ids }),
  z.object({ type: z.literal('sub'), text: Text, facts: ids }),
  z.object({ type: z.literal('bullets'), items: z.array(Lead).min(1).max(8) }),
  z.object({ type: z.literal('table'), columns: z.array(z.string().max(30)).min(2).max(5), rows: z.array(z.array(z.string().max(80)).min(2).max(5)).min(1).max(12), facts: ids }),
  z.object({ type: z.literal('months'), series: z.array(z.enum(['exp', 'imp', 'bal', 'daily'])).min(1).max(2) }),
  z.object({ type: z.literal('contrib'), items: z.array(z.string().max(20)).min(2).max(10), labels: z.record(z.string().max(30)).default({}), total: z.number().positive(), facts: ids }),
  z.object({ type: z.literal('items'), top: z.number().int().min(3).max(20).default(8) }),
  z.object({ type: z.literal('regions') }),
]);

const Note = z.object({ text: z.string().min(1).max(80), facts: ids });

/** 모양 검사 — 화면 틀이 읽는 칸과 근거의 모양. 내용의 진위는 아래 대조가 본다 */
export const TradeDataSchema = z.object({
  format: z.literal(2),
  meta: z
    .object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
      label: z.string().min(1).max(40),
      month: z.string().min(1).max(10),
      prevMonth: z.string().min(1).max(10),
      published: z.string().max(60).optional(),
      sourceTitle: z.string().max(120).optional(),
      generator: z.string().max(80).optional(),
    })
    .passthrough(),
  tiles: z.array(z.object({ label: z.string().min(1).max(20), value: z.string().min(1).max(20), unit: z.string().max(12).default(''), lines: z.array(z.string().max(40)).max(2).default([]), facts: ids })).min(2).max(4),
  takeaways: z.array(Lead).min(2).max(4),
  sections: z.array(z.object({ id: z.string().min(1).max(30), kicker: z.string().min(1).max(30), title: z.string().min(1).max(80), facts: ids, blocks: z.array(Block).min(1).max(12) })).min(3).max(10),
  footnote: z.string().max(600).default(''),
  facts: z.record(Fact),
  notes: z.object({ items: z.record(Note).default({}), regions: z.record(Note).default({}) }).default({ items: {}, regions: {} }),
  series: z.object({ months: z.array(z.string().max(10)).default([]) }).passthrough().default({ months: [] }),
  tableRows: z.record(z.object({ source: Quote, values: z.array(z.number().nullable()).min(1).max(40) })).default({}),
  // 아래 둘은 서버가 표 줄에서 만든다 — 세션이 보내도 버리고 다시 만든다
  items: z.array(z.unknown()).optional(),
  regions: z.array(z.unknown()).optional(),
});

export type TradeData = z.infer<typeof TradeDataSchema>;
export type ItemRow = { name: string; amt: number; yoy: number | null; mom: number | null; prevYoy: number | null; increase: number; note: string };
export type RegionRow = { name: string; amt: number; yoy: number | null; balance: number | null; note: string };

/** sure: 계산 결과라 부호를 믿을 수 있다(인용은 원문이 감소를 글로만 적었을 수 있어 음수 표시만 믿는다) */
type FactNums = { ok: boolean; nums: number[]; sure: boolean; all: number[] };

class Checker {
  private readonly text: Record<'cur' | 'prev', string[]>;
  readonly report: VerifyReport = { checked: 0, passed: 0, dropped: [], fatal: [] };
  private readonly facts = new Map<string, FactNums>();

  constructor(pages: PageTexts) {
    this.text = { cur: pages.cur.map(norm), prev: (pages.prev ?? []).map(norm) };
  }

  has(doc: 'cur' | 'prev', page: number, quote: string): boolean {
    const q = norm(quote);
    return q.length > 0 && (this.text[doc][page - 1] ?? '').includes(q);
  }

  /** 근거를 먼저 가른다 — 인용, 그다음 계산식(계산식이 다른 계산식을 쓸 수 있어 더 풀리는 것이 없을 때까지 돈다) */
  loadFacts(facts: TradeData['facts']): void {
    const calcs: [string, z.infer<typeof Calc>][] = [];
    for (const [id, f] of Object.entries(facts)) {
      if ('calc' in f) {
        calcs.push([id, f]);
        continue;
      }
      this.report.checked++;
      const ok = this.has(f.doc ?? 'cur', f.page, f.quote);
      if (ok) this.report.passed++;
      else this.report.dropped.push(`facts/${id} — ${f.page}쪽에 그 글이 없음`);
      // all: 계산식의 재료로는 인용의 모든 숫자를 쓸 수 있다("10월22일"의 22처럼 날짜 꼴로 적힌 일수가 있다) — 식은 어차피 다시 계산한다
      this.facts.set(id, { ok, nums: ok ? quoteNumbers(f.quote) : [], sure: false, all: ok ? [...f.quote.matchAll(NUM)].map((m) => toNum(m[0])) : [] });
    }
    let pending = calcs;
    for (let round = 0; round < 6 && pending.length; round++) {
      const next: typeof pending = [];
      for (const [id, f] of pending) {
        if (f.uses.some((u) => !this.facts.has(u) && calcs.some(([c]) => c === u))) {
          next.push([id, f]);
          continue;
        }
        this.report.checked++;
        const r = checkCalc(f.calc, f.uses.flatMap((u) => this.facts.get(u)?.all ?? []));
        if (r.ok) this.report.passed++;
        else this.report.dropped.push(`facts/${id} — ${r.why}`);
        this.facts.set(id, r.ok ? { ok: true, nums: [r.value], sure: true, all: [r.value] } : { ok: false, nums: [], sure: true, all: [] });
      }
      pending = next;
    }
    for (const [id] of pending) this.report.dropped.push(`facts/${id} — 서로 물고 도는 계산식`);
  }

  /** 문장 하나 — 근거가 있어야 하는 숫자가 전부 그 문장의 근거 안에 있는가. 없으면 무엇이 비었는지 돌려준다 */
  missing(texts: string[], factIds: string[]): string | null {
    const nums = factIds.flatMap((id) => {
      const f = this.facts.get(id);
      return f ? f.nums.map((c) => ({ c, sure: f.sure })) : [];
    });
    for (const text of texts) {
      for (const n of numbersToBack(text)) {
        this.report.checked++;
        const same = nums.filter((x) => sameNumber(n.value, n.dec, x.c));
        // 방향도 본다 — ▲인데 근거가 감소(음수)뿐이거나, ▼인데 계산 결과가 증가뿐이면 틀린 것이다
        const ok = same.some((x) => (n.dir === 1 ? x.c >= 0 : n.dir === -1 ? x.c <= 0 || !x.sure : true));
        if (ok) this.report.passed++;
        else return same.length ? `숫자 ${n.token}의 방향(▲▼)이 근거와 다름` : `숫자 ${n.token}의 근거가 없음`;
      }
    }
    return null;
  }
}

/** 표 줄의 숫자들을 순서대로 — 쉼표는 무시, 원문의 △·-·▵는 음수 */
function lineNumbers(quote: string): number[] {
  return [...quote.matchAll(/([△▵\-−]?)\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => (m[1] ? -1 : 1) * toNum(m[2] ?? '0'));
}

/** 값들이 인용한 줄의 끝부분과 순서까지 같은가 — 줄 머리의 이름·연간 합계는 앞에 남아도 된다. 틀리면 어긋난 자리를 알려 준다 */
function tailMismatch(values: (number | null)[], quote: string): string | null {
  const line = lineNumbers(quote);
  if (values.length > line.length) return `값이 ${values.length}개인데 인용한 줄의 숫자는 ${line.length}개`;
  const tail = line.slice(line.length - values.length);
  const i = values.findIndex((v, k) => v !== null && v !== tail[k]);
  return i < 0 ? null : `${i + 1}번째 값 ${String(values[i])}이 인용한 줄의 그 자리(${String(tail[i])})와 다름 — 값은 줄의 끝에서부터 순서대로여야 한다`;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const last = <T>(a: T[], back = 0): T | null => a[a.length - 1 - back] ?? null;

/**
 * 대조하고, 틀린 것을 걷어 낸 data를 돌려준다. report.fatal이 비어 있지 않으면 저장하지 않는다(고쳐 다시).
 * 입력을 고치지 않는다 — 깊은 복사본 위에서 일한다
 */
export function verifyTradeData(input: TradeData, pages: PageTexts): { data: TradeData; report: VerifyReport } {
  const data = structuredClone(input);
  const ck = new Checker(pages);
  const { report } = ck;
  ck.loadFacts(data.facts);

  // 맨 위의 숫자 칸과 결론은 조용히 빼지 않고 거절한다 — 하나가 사라진 머리는 틀린 머리다
  for (const t of data.tiles) {
    const why = ck.missing([t.value, ...t.lines], t.facts);
    if (why) report.fatal.push(`tiles (${t.label}): ${why}`);
  }
  data.takeaways.forEach((t, i) => {
    const why = ck.missing([t.lead, t.text], t.facts);
    if (why) report.fatal.push(`takeaways/${i + 1}: ${why}`);
  });

  // 숫자 표 — 출처 줄이 원문에 있고, 값 하나하나가 그 줄에 있어야 한다
  const rows = new Map<string, (number | null)[]>();
  for (const [key, row] of Object.entries(data.tableRows)) {
    report.checked++;
    if (!ck.has(row.source.doc ?? 'cur', row.source.page, row.source.quote)) {
      report.fatal.push(`tableRows/${key}: 출처 줄이 ${row.source.page}쪽에 없음`);
      continue;
    }
    const months = data.series.months.length;
    const bad = months > 0 && row.values.length !== months ? `값이 ${row.values.length}개 — 달 이름(series.months)은 ${months}개` : tailMismatch(row.values, row.source.quote);
    if (bad) {
      report.fatal.push(`tableRows/${key}: ${bad}`);
      continue;
    }
    report.passed++;
    rows.set(key, row.values);
  }
  // 화면의 추이·품목 표·지역 표는 세션이 준 숫자를 쓰지 않고 대조를 통과한 줄에서 만든다 — 표와 글이 어긋날 수 없게
  const series: Record<string, unknown> = { months: data.series.months };
  for (const k of ['exp', 'imp', 'bal', 'daily']) if (rows.has(k)) series[k] = rows.get(k);
  data.series = series as TradeData['series'];

  const items: ItemRow[] = [];
  const regions: RegionRow[] = [];
  for (const [key, vals] of rows) {
    const [kind, name] = key.split(':');
    if (!name || (kind !== 'item' && kind !== 'region')) continue;
    const cur = last(vals);
    if (cur === null) continue;
    const yoys = rows.get(`${kind}yoy:${name}`) ?? [];
    const first = vals[0] ?? null;
    const prev = last(vals, 1);
    // 금액은 백만 달러 줄 → 억 달러. 증감률은 원문의 증감률 줄(나눠서 만들면 공식 값과 끝자리가 달라진다)
    if (kind === 'item') {
      const note = data.notes.items[name];
      const noteWhy = note ? ck.missing([note.text], note.facts) : null;
      if (noteWhy) report.dropped.push(`notes/items/${name} — ${noteWhy}`);
      items.push({ name, amt: r1(cur / 100), yoy: last(yoys), prevYoy: last(yoys, 1), mom: prev ? r1((cur / prev - 1) * 100) : null, increase: first !== null && vals.length === 13 ? r1((cur - first) / 100) : 0, note: note && !noteWhy ? note.text : '' });
    } else {
      const note = data.notes.regions[name];
      const noteWhy = note ? ck.missing([note.text], note.facts) : null;
      if (noteWhy) report.dropped.push(`notes/regions/${name} — ${noteWhy}`);
      regions.push({ name, amt: r1(cur / 100), yoy: last(yoys), balance: last(rows.get(`regionbal:${name}`) ?? []), note: note && !noteWhy ? note.text : '' });
    }
  }
  for (const n of Object.keys(data.notes.items)) if (!rows.has(`item:${n}`)) report.dropped.push(`notes/items/${n} — 그 이름의 표 줄(item:${n})이 없음`);
  for (const n of Object.keys(data.notes.regions)) if (!rows.has(`region:${n}`)) report.dropped.push(`notes/regions/${n} — 그 이름의 표 줄(region:${n})이 없음`);
  items.sort((a, b) => b.amt - a.amt);
  regions.sort((a, b) => b.amt - a.amt);
  data.items = items;
  data.regions = regions;

  // 본문 — 문장·표·그림 하나씩. 틀린 것만 빼고, 다 빠진 절은 절째 뺀다
  data.sections = data.sections.filter((s) => {
    const at = `sections/${s.id}`;
    const titleWhy = ck.missing([s.title], s.facts);
    if (titleWhy) report.fatal.push(`${at} 제목: ${titleWhy}`);
    s.blocks = s.blocks.filter((b, i) => {
      const where = `${at}/${i + 1}(${b.type})`;
      let why: string | null = null;
      if (b.type === 'p' || b.type === 'sub') why = ck.missing([b.text], b.facts);
      else if (b.type === 'table') why = ck.missing(b.rows.flat(), b.facts);
      else if (b.type === 'bullets') {
        b.items = b.items.filter((it, j) => {
          const w = ck.missing([it.lead, it.text], it.facts);
          if (w) report.dropped.push(`${where}/${j + 1} (${it.lead}) — ${w}`);
          return !w;
        });
        if (b.items.length === 0) why = '항목이 모두 빠짐';
      } else if (b.type === 'months') why = b.series.every((k) => rows.has(k)) ? null : '그릴 표 줄이 없음';
      else if (b.type === 'contrib') {
        b.items = b.items.filter((n) => items.some((it) => it.name === n && it.increase !== 0));
        why = ck.missing([b.total.toFixed(1), ...Object.values(b.labels)], b.facts) ?? (b.items.length < 2 ? '그릴 품목이 없음' : null);
      } else if (b.type === 'items') why = items.length ? null : '품목 표 줄이 없음';
      else if (b.type === 'regions') why = regions.length ? null : '지역 표 줄이 없음';
      if (why) report.dropped.push(`${where} — ${why}`);
      return !why;
    });
    if (s.blocks.length === 0) report.dropped.push(`${at} — 내용이 모두 빠져 절을 뺌`);
    return s.blocks.length > 0;
  });

  if (data.sections.length < 3) report.fatal.push('남은 절이 3개 미만');
  if (report.checked > 0 && report.dropped.length / report.checked > TRADE.DROP_REJECT_RATIO) {
    report.fatal.push(`대조 ${report.checked}개 중 ${report.dropped.length}개가 맞지 않음 (${Math.round(TRADE.DROP_REJECT_RATIO * 100)}% 초과)`);
  }
  (data.meta as Record<string, unknown>).checked = report.passed;
  return { data, report };
}

export function reportLines(r: VerifyReport): string[] {
  const lines = [`원문 대조 ${r.passed}/${r.checked} 통과`, `뺀 것 ${r.dropped.length}개`, ...r.dropped.map((d) => `  - ${d}`)];
  if (r.fatal.length) lines.push('고쳐야 받습니다:', ...r.fatal.map((f) => `  ! ${f}`));
  return lines;
}

const SERIES_NAME: Record<string, string> = { exp: '수출액', imp: '수입액', bal: '무역수지', daily: '하루 평균 수출' };
const REGION_NAME: Record<string, string> = { 'EU(27)': 'EU', CIS: '러시아 등 CIS' };

/** 독자 검수용 — 화면에 보이는 글자만 순서대로, 화면과 같은 표기로. 근거·쪽 번호는 넣지 않는다(독자는 원문 없이 이것만 읽는다) */
export function plainText(data: TradeData): string {
  const plain = (t: string) => t.replace(/\*\*/g, '');
  const out: string[] = [`${data.meta.label} 수출입 정리`, ''];
  for (const t of data.tiles) out.push(`[${t.label}] ${t.value}${t.unit} — ${t.lines.join(' / ')}`);
  out.push('');
  data.takeaways.forEach((t, i) => out.push(`${i + 1}. ${t.lead} ${plain(t.text)}`));
  const items = (data.items ?? []) as ItemRow[];
  const regions = (data.regions ?? []) as RegionRow[];
  const f1 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = (v: number | null) => (v === null ? '–' : `${v > 0 ? '▲' : v < 0 ? '▼' : ''}${f1(Math.abs(v))}%`);
  const signed = (v: number | null) => (v === null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US')}`);
  for (const s of data.sections) {
    out.push('', `## ${s.kicker} — ${s.title}`);
    for (const b of s.blocks) {
      if (b.type === 'p' || b.type === 'sub') out.push(plain(b.text));
      else if (b.type === 'bullets') for (const it of b.items) out.push(`- ${it.lead}: ${plain(it.text)}`);
      else if (b.type === 'table') out.push(b.columns.join(' | '), ...b.rows.map((r) => r.join(' | ')));
      else if (b.type === 'months') {
        const months = data.series.months;
        const series = data.series as Record<string, unknown>;
        out.push(`(막대 그래프와 표: 최근 ${months.length}개월 ${b.series.map((k) => SERIES_NAME[k]).join(', ')}, 억 달러)`);
        out.push(['월', ...Object.keys(SERIES_NAME).filter((k) => Array.isArray(series[k])).map((k) => SERIES_NAME[k])].join(' | '));
        months.forEach((m, i) => out.push([m, ...Object.keys(SERIES_NAME).filter((k) => Array.isArray(series[k])).map((k) => String((series[k] as (number | null)[])[i] ?? '–'))].join(' | ')));
      } else if (b.type === 'contrib') {
        const listed = b.items.map((n) => ({ n, v: items.find((i) => i.name === n)?.increase ?? 0 }));
        out.push(`(막대 그래프: 늘어난 수출 ${f1(b.total)}억 달러는 어디서 왔나 — 작년 같은 달보다 늘어난 금액, 억 달러)`, ...listed.map((x) => `  ${b.labels[x.n] ?? x.n} ${signed(x.v)}`), `  그 밖의 품목 합계 ${signed(Math.round((b.total - listed.reduce((a, x) => a + x.v, 0)) * 10) / 10)}`);
      } else if (b.type === 'items') out.push(`품목 | 수출액(억 달러) | 작년 ${data.meta.month}보다 | 한 달 전(${data.meta.prevMonth})보다 | 한마디`, ...items.map((i) => `${i.name} | ${f1(i.amt)} | ${pct(i.yoy)} | ${pct(i.mom)} | ${i.note}`));
      else if (b.type === 'regions') out.push(`지역 | 수출액(억 달러) | 작년 ${data.meta.month}보다 | ${data.meta.month} 무역수지(억 달러) | 한마디`, ...regions.map((r) => `${REGION_NAME[r.name] ?? r.name} | ${f1(r.amt)} | ${pct(r.yoy)} | ${signed(r.balance)} | ${r.note}`));
    }
  }
  if (data.footnote) out.push('', `자료: ${data.meta.sourceTitle ?? '산업통상부 수출입 동향'}. ${data.footnote}`);
  return out.join('\n') + '\n';
}
