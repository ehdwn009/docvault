import { OUTLOOK } from '../../constants.js';
import { checkCalc, NUM, norm, numbersToBack, quoteNumbers, sameNumber, toNum, TRADE_UNITS, type BackedNumber } from '../factcheck.js';
import type { Fact, OutlookBlock, OutlookData } from './schema.js';

// 세계 전망 완성본을 근거와 대조한다 (세계전망 설계 9·10단계). 스킬의 outlook:job build와 나중의 서버가 같은 함수를 쓴다.
//  ① 근거 인용은 그 주(출처)의 원문 글에 글자 그대로 있어야 한다 — 원문을 받지 못한 출처는 "확인 못 함"으로 센다
//  ② 계산식은 다시 계산한다  ③ 글에 나온 숫자는 그 글이 가리킨 근거 안에 있어야 한다
//  ④ 주 번호는 1부터 본문에 처음 나오는 순서대로, 주 목록과 맞아야 한다  ⑤ 출처는 읽는 기간 안이어야 한다(비교 맥락은 밝힌 것만)

/** 주 번호 → 원문 글. null이면 받으려 했으나 못 받음(사이트가 막음 등), 없으면 아직 안 받음 — 둘 다 "확인 못 함" */
export type SourceTexts = Map<number, string | null>;

export type OutlookReport = {
  checked: number;
  passed: number;
  /** 원문을 못 받아 글자 대조를 못 한 인용 */
  unverified: string[];
  dropped: string[];
  fatal: string[];
};

const UNITS = [...TRADE_UNITS, ...OUTLOOK.EXTRA_UNITS];
const CITE = /\[(\d{1,3})\]/g;
// 지수·묶음 이름 속 숫자는 값이 아니다(S&P 500의 500)
const NAMED = /(S&P\s?500|S&P\s?400|닛케이\s?225|나스닥\s?100|Nasdaq\s?100|Stoxx\s?600|STOXX\s?600|Euro\s?Stoxx\s?50|FTSE\s?100|DAX\s?40|CAC\s?40|KOSPI\s?200|코스피\s?200|MSCI\s?ACWI|G\s?7|G\s?20|COP\s?\d+|ASEAN\s?\+\s?3)/gi;
const BANNED_CHARS = /[~∼$＄]/;

/** 글에서 근거가 있어야 하는 숫자 — 각주 표시·지수 이름·연도(쉼표 없는 1900~2100 정수)는 뺀다 */
export function outlookNumbers(text: string): BackedNumber[] {
  const plain = text.replace(CITE, ' ').replace(NAMED, ' ');
  return numbersToBack(plain, UNITS).filter((n) => !(n.dec === 0 && !n.token.includes(',') && n.value >= 1900 && n.value <= 2100));
}

export function citations(text: string): number[] {
  return [...text.matchAll(CITE)].map((m) => Number(m[1]));
}

/** 화면에 보이는 글을 읽는 순서대로 — 각주 순서와 금지 표기 검사, 독자 검수용 글에 쓴다 */
export function visibleTexts(d: OutlookData): string[] {
  const out: string[] = [d.meta.title, d.meta.subtitle];
  d.summary.forEach((s) => out.push(s.text));
  for (const sec of d.sections) {
    out.push(sec.title);
    for (const b of sec.blocks) out.push(...blockTexts(b));
  }
  out.push(d.about.title, d.about.text);
  return out.filter(Boolean);
}

function blockTexts(b: OutlookBlock): string[] {
  if (b.type === 'p') return [b.text];
  if (b.type === 'bullets') return b.items.flatMap((i) => [i.lead ?? '', i.text]);
  if (b.type === 'table') return [b.title ?? '', b.note ?? '', ...b.columns, ...b.rows.flat()];
  return [b.title, b.note ?? '', ...b.rows.flatMap((r) => [r.label, r.sub ?? '', r.text])];
}

type FactNums = { ok: boolean; nums: number[]; sure: boolean; all: number[] };

class Checker {
  readonly report: OutlookReport = { checked: 0, passed: 0, unverified: [], dropped: [], fatal: [] };
  private readonly facts = new Map<string, FactNums>();
  private readonly src = new Map<number, string | null>();

  constructor(sources: SourceTexts) {
    for (const [n, t] of sources) this.src.set(n, t === null ? null : norm(t));
  }

  loadFacts(facts: Record<string, Fact>, noteNs: Set<number>): void {
    const calcs: [string, Extract<Fact, { calc: string }>][] = [];
    for (const [id, f] of Object.entries(facts)) {
      if ('calc' in f) {
        calcs.push([id, f]);
        continue;
      }
      this.report.checked++;
      let ok = true;
      if (!noteNs.has(f.note)) {
        ok = false;
        this.report.dropped.push(`facts/${id} — 주 ${f.note}이(가) 주 목록에 없음`);
      } else {
        const text = this.src.get(f.note);
        if (text === undefined || text === null) this.report.unverified.push(`facts/${id} — 주 ${f.note}의 원문을 받지 못해 글자 대조를 못 함`);
        else if (!text.includes(norm(f.quote))) {
          ok = false;
          this.report.dropped.push(`facts/${id} — 주 ${f.note}의 원문에 그 글이 없음`);
        }
      }
      if (ok) this.report.passed++;
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

  /** 글 여러 개 — 근거가 있어야 하는 숫자가 전부 그 글들의 근거 안에 있는가. 없으면 무엇이 비었는지 */
  missing(texts: string[], factIds: string[]): string | null {
    for (const id of factIds) if (!this.facts.has(id)) return `근거 id ${id}가 facts에 없음`;
    const nums = factIds.flatMap((id) => {
      const f = this.facts.get(id);
      return f ? f.nums.map((c) => ({ c, sure: f.sure })) : [];
    });
    for (const text of texts) {
      for (const n of outlookNumbers(text)) {
        this.report.checked++;
        const same = nums.filter((x) => sameNumber(n.value, n.dec, x.c));
        const ok = same.some((x) => (n.dir === 1 ? x.c >= 0 : n.dir === -1 ? x.c <= 0 || !x.sure : true));
        if (ok) this.report.passed++;
        else return same.length ? `숫자 ${n.token}의 방향(▲▼)이 근거와 다름` : `숫자 ${n.token}의 근거가 없음`;
      }
    }
    return null;
  }
}

function inWindow(date: string, since: string, until: string): boolean {
  // 일을 모르는 'YYYY-MM'은 그 달이 기간과 겹치면 기간 안으로 본다
  if (date.length === 7) return date >= since.slice(0, 7) && date <= until.slice(0, 7);
  return date >= since && date <= until;
}

/** 대조하고, 틀린 문단을 걷어 낸 data를 돌려준다. report.fatal이 비어 있지 않으면 내보내지 않는다(고쳐 다시) */
export function verifyOutlookData(input: OutlookData, sources: SourceTexts): { data: OutlookData; report: OutlookReport } {
  const data = structuredClone(input);
  const ck = new Checker(sources);
  const { report } = ck;

  // ---- 주 목록과 각주 ----
  const ns = data.notes.map((n) => n.n);
  if (ns.some((n, i) => n !== i + 1)) report.fatal.push('주 번호가 1부터 끊김 없이 이어지지 않음');
  const noteNs = new Set(ns);
  const order: number[] = [];
  for (const t of visibleTexts(data)) for (const n of citations(t)) if (!order.includes(n)) order.push(n);
  const unknown = order.filter((n) => !noteNs.has(n));
  if (unknown.length) report.fatal.push(`주 목록에 없는 번호를 본문이 가리킴: ${unknown.join(', ')}`);
  if (order.some((n, i) => n !== i + 1)) report.fatal.push(`각주 번호가 본문에 처음 나오는 순서와 다름(처음 나오는 순서: ${order.slice(0, 12).join(', ')}…)`);
  const unused = ns.filter((n) => !order.includes(n));
  if (unused.length) report.fatal.push(`본문이 가리키지 않는 주: ${unused.join(', ')}`);
  for (const n of data.notes) {
    if (!n.context && !inWindow(n.date, data.meta.since, data.meta.until)) report.fatal.push(`주 ${n.n}의 발표일 ${n.date}이(가) 읽는 기간 밖 — 비교 맥락이면 context에 이유를 적는다`);
  }

  // ---- 금지 표기 ----
  for (const t of visibleTexts(data)) {
    if (BANNED_CHARS.test(t)) {
      report.fatal.push(`쓰지 않는 표기(물결표·달러 기호)가 있음: "${t.slice(0, 40)}…"`);
      break;
    }
  }

  ck.loadFacts(data.facts, noteNs);

  // ---- 꼭 맞아야 하는 곳(틀리면 고쳐 다시): 제목·부제·요약·절 제목·맺음 ----
  const must = (where: string, texts: string[], facts: string[]) => {
    const why = ck.missing(texts, facts);
    if (why) report.fatal.push(`${where} — ${why}`);
  };
  must('제목·부제', [data.meta.title, data.meta.subtitle], []);
  data.summary.forEach((s, i) => must(`요약 ${i + 1}`, [s.text], s.facts));
  must(data.about.title, [data.about.text], data.about.facts);

  // ---- 본문: 틀린 블록(글머리표는 그 항목)만 뺀다 ----
  let units = 0;
  let droppedUnits = 0;
  for (const sec of data.sections) {
    must(`절 「${sec.title}」 제목`, [sec.title], []);
    const kept: OutlookBlock[] = [];
    sec.blocks.forEach((b, bi) => {
      const where = `${sec.id}/${bi + 1}(${b.type})`;
      if (b.type === 'bullets') {
        const items = b.items.filter((it, ii) => {
          units++;
          const why = ck.missing([it.lead ?? '', it.text], it.facts);
          if (why) {
            droppedUnits++;
            report.dropped.push(`${where} 항목 ${ii + 1} — ${why}`);
          }
          return !why;
        });
        if (items.length) kept.push({ ...b, items });
        return;
      }
      units++;
      let why = ck.missing(blockTexts(b), b.facts);
      if (!why && b.type === 'chart') {
        // 막대 길이(value)가 적힌 값(text)과 같은가 — 그림과 글이 어긋나지 않게
        const bad = b.rows.find((r) => {
          const n = outlookNumbers(r.text)[0] ?? numbersToBack(r.text, UNITS)[0];
          return !n || !sameNumber(Math.abs(r.value), n.dec, n.value);
        });
        if (bad) why = `도표 줄 「${bad.label}」의 value ${bad.value}가 적힌 값 "${bad.text}"와 다름`;
      }
      if (why) {
        droppedUnits++;
        report.dropped.push(`${where} — ${why}`);
      } else kept.push(b);
    });
    sec.blocks = kept;
  }
  const before = data.sections.length;
  data.sections = data.sections.filter((s) => s.blocks.length > 0);
  if (data.sections.length < before) report.dropped.push(`다 빠진 절 ${before - data.sections.length}개`);
  if (data.sections.length < 2) report.fatal.push('남은 절이 2개 미만');
  if (units && droppedUnits / units > OUTLOOK.DROP_REJECT_RATIO) report.fatal.push(`본문의 ${droppedUnits}/${units}이 빠짐 — ${Math.round(OUTLOOK.DROP_REJECT_RATIO * 100)}% 초과`);
  return { data, report };
}

export function outlookReportLines(r: OutlookReport): string[] {
  const lines = [`대조 ${r.passed}/${r.checked} 통과 · 원문 확인 못 한 인용 ${r.unverified.length} · 뺀 것 ${r.dropped.length}`];
  if (r.fatal.length) lines.push('', '고쳐야 받습니다:', ...r.fatal.map((f) => `  ! ${f}`));
  if (r.dropped.length) lines.push('', '뺀 것:', ...r.dropped.map((d) => `  - ${d}`));
  if (r.unverified.length) lines.push('', '원문 확인 못 함:', ...r.unverified.map((d) => `  ? ${d}`));
  return lines;
}

/** 독자 검수가 읽을 글 — 화면에 보이는 것만, 각주 표시 없이 */
export function outlookPlainText(d: OutlookData): string {
  const strip = (s: string) => s.replace(CITE, '').replace(/\*\*/g, '');
  const out: string[] = [d.meta.title, d.meta.subtitle, d.meta.label, '', '요약', ...d.summary.map((s) => strip(s.text)), ''];
  for (const sec of d.sections) {
    out.push(`## ${sec.title}`);
    for (const b of sec.blocks) {
      if (b.type === 'p') out.push(strip(b.text));
      else if (b.type === 'bullets') b.items.forEach((i) => out.push(`- ${i.lead ? `${i.lead}: ` : ''}${strip(i.text)}`));
      else if (b.type === 'table') {
        if (b.title) out.push(`[표] ${strip(b.title)}`);
        out.push(b.columns.join(' | '), ...b.rows.map((r) => r.map(strip).join(' | ')));
        if (b.note) out.push(strip(b.note));
      } else {
        out.push(`[도표] ${strip(b.title)}${b.unit ? ` (단위 ${b.unit})` : ''}`);
        if (b.note) out.push(strip(b.note));
        b.rows.forEach((r) => out.push(`  ${r.label}${r.sub ? ` (${r.sub})` : ''}: ${r.text}`));
      }
    }
    out.push('');
  }
  out.push(`## ${d.about.title}`, strip(d.about.text));
  return out.join('\n') + '\n';
}
