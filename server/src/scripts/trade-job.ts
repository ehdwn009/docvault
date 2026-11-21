import fs from 'node:fs';
import path from 'node:path';
import { pdfPageTexts } from '../lib/trade/pages.js';
import { renderTradeHtml } from '../lib/trade/document.js';
import { plainText, reportLines, TradeDataSchema, verifyTradeData, type PageTexts } from '../lib/trade/verify.js';
import { getJson, postJson, serverBase } from './jobServer.js';

// trade-report 스킬의 기계적인 일 — 쪽 텍스트·대조·서버와 주고받기. 대조는 서버가 완성본을 받을 때와 **같은 함수**다(lib/trade/verify.ts).
// 사용: npm run trade:job -w server -- <명령> …
//   pages <W>            W/cur.pdf·prev.pdf → W/pages/{cur,prev}/NN.txt, all.txt   (수동 모드, pdftotext 필요)
//   pull <jobId> <W>     서버에서 지시서·쪽 텍스트를 받는다                          (자동 모드, DOCVAULT_URL)
//   build <W>            W/out/report.json + tables.json을 원문과 대조 → W/data.json, verify-report.txt, report.txt(독자용 글), page.html(완성 화면)
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

// ---- 서버 (자동 모드) — 주소·열쇠 규칙은 jobServer.ts ----

async function pull(jobId: string, work: string): Promise<void> {
  const { url, headers } = serverBase(jobId);
  fs.mkdirSync(work, { recursive: true });
  const ins = await getJson<{ kind?: string; prev?: unknown }>(url, headers);
  if (ins.kind !== 'trade') throw new Error(`수출입 동향 일감이 아닙니다 (kind=${String(ins.kind)})`);
  fs.writeFileSync(path.join(work, 'instruction.json'), JSON.stringify(ins, null, 2));
  for (const doc of ['cur', 'prev'] as const) {
    if (doc === 'prev' && !ins.prev) {
      console.log('전월 호 없음 — 지난달과의 비교는 이번 호 표에 실린 값으로만 씁니다');
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
  console.log(JSON.stringify(await postJson(`${url}/trade/result`, headers, body), null, 2));
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
  // 리더가 쓴 정리본(out/report.json)에 숫자 표 줄(out/tables.json)을 합친다 — 형식은 references/schema.md
  const tb = readOut(work, 'tables', { series: { months: [] }, rows: {} });
  const assembled = { ...readOut(work, 'report'), series: tb.series ?? { months: [] }, tableRows: tb.rows ?? {} };
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
  // 독자 검수가 읽을 글(근거 없이 화면에 보이는 것만)과, 눈으로 확인할 완성 화면
  fs.writeFileSync(path.join(work, 'report.txt'), plainText(data));
  fs.writeFileSync(path.join(work, 'page.html'), renderTradeHtml(data));
  console.log(`→ ${path.join(work, 'data.json')} · report.txt · page.html`);
}

async function main(): Promise<void> {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'pages' && a) {
    for (const doc of ['cur', 'prev'] as const) {
      const pdf = path.join(a, `${doc}.pdf`);
      if (!fs.existsSync(pdf)) {
        if (doc === 'cur') throw new Error(`${pdf}가 없습니다 — 먼저 npm run trade:fetch`);
        console.log('prev.pdf 없음 — 지난달과의 비교는 이번 호 표에 실린 값으로만 씁니다');
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
