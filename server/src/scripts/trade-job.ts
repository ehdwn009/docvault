import fs from 'node:fs';
import path from 'node:path';
import { pdfPageTexts } from '../lib/trade/pages.js';
import { reportLines, TradeDataSchema, verifyTradeData, type PageTexts } from '../lib/trade/verify.js';

// trade-report 스킬의 기계적인 일 — 쪽 텍스트·대조·서버와 주고받기. 대조는 서버가 완성본을 받을 때와 **같은 함수**다(lib/trade/verify.ts).
// 사용: npm run trade:job -w server -- <명령> …
//   pages <W>            W/cur.pdf·prev.pdf → W/pages/{cur,prev}/NN.txt, all.txt   (수동 모드, pdftotext 필요)
//   pull <jobId> <W>     서버에서 지시서·쪽 텍스트를 받는다                          (자동 모드, DOCVAULT_URL)
//   build <W>            W/out/*.json을 엮어 원문과 대조 → W/data.json, verify-report.txt
//   send <jobId> <W>     W/data.json을 서버에 보낸다                               (자동 모드)

const pad = (n: number) => String(n).padStart(2, '0');

function writePages(work: string, doc: 'cur' | 'prev', pages: string[]): void {
  const dir = path.join(work, 'pages', doc);
  fs.mkdirSync(dir, { recursive: true });
  pages.forEach((text, i) => fs.writeFileSync(path.join(dir, `${pad(i + 1)}.txt`), text));
  fs.writeFileSync(path.join(dir, 'all.txt'), pages.map((text, i) => `===== ${i + 1}쪽 =====\n${text}`).join('\n'));
}

function readPages(work: string, doc: 'cur' | 'prev'): string[] | null {
  const dir = path.join(work, 'pages', doc);
  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir).filter((f) => /^\d+\.txt$/.test(f)).sort();
  return names.length ? names.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')) : null;
}

// ---- 서버 (자동 모드) — 열쇠는 네트워크 시크릿이 붙이고, DOCVAULT_TOKEN이 있을 때만 직접 붙인다(값은 어디에도 찍지 않는다). briefing-job.ts와 같은 규칙 ----

function serverBase(jobId: string): { url: string; headers: Record<string, string> } {
  const base = process.env.DOCVAULT_URL?.replace(/\/+$/, '');
  // https만 — 평문으로 열쇠가 나가면 안 된다. 로컬 시험(같은 기계)만 http를 허용한다
  if (!base || !(base.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))) throw new Error('환경 변수 DOCVAULT_URL(https://…)이 필요합니다');
  const token = process.env.DOCVAULT_TOKEN;
  return { url: `${base}/api/v1/briefing/jobs/${encodeURIComponent(jobId)}`, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } };
}

async function failure(res: Response): Promise<Error> {
  let text = '';
  try {
    const body = (await res.json()) as { code?: string; message?: string; fatal?: string[]; dropped?: string[] };
    text = `${body.code ?? ''}${body.message ? ` — ${body.message}` : ''}`;
    if (body.fatal?.length) text += `\n${body.fatal.map((f) => `  ! ${f}`).join('\n')}`;
    if (body.dropped?.length) text += `\n뺀 항목 ${body.dropped.length}개`;
  } catch {
    // JSON이 아니면 상태 코드만
  }
  const hint = res.status === 409 ? ' → 실행이 닫혔다. 멈추고 보고한다' : res.status === 401 ? ' → 연결 열쇠(네트워크 시크릿)가 안 붙었다. 우회하지 말고 보고한다' : '';
  return new Error(`서버 ${res.status} ${text}${hint}`);
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers, redirect: 'error' });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

async function pull(jobId: string, work: string): Promise<void> {
  const { url, headers } = serverBase(jobId);
  fs.mkdirSync(work, { recursive: true });
  const ins = await getJson<{ kind?: string; prev?: unknown }>(url, headers);
  if (ins.kind !== 'trade') throw new Error(`수출입 동향 일감이 아닙니다 (kind=${String(ins.kind)})`);
  fs.writeFileSync(path.join(work, 'instruction.json'), JSON.stringify(ins, null, 2));
  for (const doc of ['cur', 'prev'] as const) {
    if (doc === 'prev' && !ins.prev) {
      console.log('전월 호 없음 — 전월 비교(vsPrev·changes)는 비워 둡니다');
      continue;
    }
    const r = await getJson<{ pages: string[] }>(`${url}/trade/pages?doc=${doc}`, headers);
    writePages(work, doc, r.pages);
    console.log(`${doc}: ${r.pages.length}쪽`);
  }
  console.log(JSON.stringify(ins, null, 2));
}

async function send(jobId: string, work: string): Promise<void> {
  const { url, headers } = serverBase(jobId);
  const body = fs.readFileSync(path.join(work, 'data.json'), 'utf8');
  const res = await fetch(`${url}/trade/result`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body, redirect: 'error' });
  if (!res.ok) throw await failure(res);
  console.log(JSON.stringify(await res.json(), null, 2));
}

// ---- 엮기 + 대조 ----

function readOut(work: string, name: string, fallback?: unknown): Record<string, unknown> {
  const p = path.join(work, 'out', `${name}.json`);
  if (!fs.existsSync(p)) {
    if (fallback !== undefined) return fallback as Record<string, unknown>;
    throw new Error(`${p}가 없습니다`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function build(work: string): void {
  const cur = readPages(work, 'cur');
  if (!cur) throw new Error('pages/cur가 없습니다 — 먼저 pages(수동) 또는 pull(자동)');
  const pages: PageTexts = { cur, prev: readPages(work, 'prev') };
  const h = readOut(work, 'headline');
  const l = readOut(work, 'links');
  const ch = readOut(work, 'changes', { changes: [], vsPrev: [] });
  const tb = readOut(work, 'tables', { series: { months: [] }, rows: {} });
  const assembled = {
    meta: readOut(work, 'meta'),
    claims: h.claims,
    vsPrev: ch.vsPrev ?? [],
    items20: h.items20 ?? [],
    items20_summary: h.items20_summary ?? {},
    regions: h.regions ?? [],
    nih: h.nih ?? [],
    links: l.links ?? [],
    changes: ch.changes ?? [],
    topics: l.topics ?? [],
    pages: l.pages ?? [],
    series: tb.series ?? { months: [] },
    tableRows: tb.rows ?? {},
  };
  const parsed = TradeDataSchema.safeParse(assembled);
  if (!parsed.success) {
    const lines = parsed.error.issues.slice(0, 20).map((i) => `  ! ${i.path.join('.') || '(본문)'}: ${i.message}`);
    fs.writeFileSync(path.join(work, 'verify-report.txt'), ['형식이 맞지 않습니다 (references/schema.md):', ...lines].join('\n') + '\n');
    console.error(['형식이 맞지 않습니다:', ...lines].join('\n'));
    process.exit(1);
  }
  const { data, report } = verifyTradeData(parsed.data, pages);
  const lines = reportLines(report);
  fs.writeFileSync(path.join(work, 'verify-report.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  if (report.fatal.length) process.exit(1);
  fs.writeFileSync(path.join(work, 'data.json'), JSON.stringify(data));
  console.log(`→ ${path.join(work, 'data.json')}`);
}

async function main(): Promise<void> {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'pages' && a) {
    for (const doc of ['cur', 'prev'] as const) {
      const pdf = path.join(a, `${doc}.pdf`);
      if (!fs.existsSync(pdf)) {
        if (doc === 'cur') throw new Error(`${pdf}가 없습니다 — 먼저 npm run trade:fetch`);
        console.log('prev.pdf 없음 — 전월 비교(vsPrev·changes)는 비워 둡니다');
        continue;
      }
      const pages = await pdfPageTexts(pdf);
      writePages(a, doc, pages);
      console.log(`${doc}: ${pages.length}쪽`);
    }
  } else if (cmd === 'pull' && a && b) await pull(a, b);
  else if (cmd === 'build' && a) build(a);
  else if (cmd === 'send' && a && b) await send(a, b);
  else {
    console.error('사용: npm run trade:job -w server -- pages <W> | pull <jobId> <W> | build <W> | send <jobId> <W>');
    process.exit(2);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
