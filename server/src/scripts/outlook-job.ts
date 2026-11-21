import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { renderOutlookHtml, renderOutlookPage } from '../lib/outlook/document.js';
import { OutlookDataSchema } from '../lib/outlook/schema.js';
import { fetchSource } from '../lib/outlook/sources.js';
import { outlookPlainText, outlookReportLines, verifyOutlookData, type SourceTexts } from '../lib/outlook/verify.js';

// outlook-report 스킬의 기계적인 일 — 원문 받기와 대조·화면 만들기. 대조는 나중에 서버가 완성본을 받을 때와 같은 함수다(lib/outlook/verify.ts).
// 사용: npm run outlook:job -w server -- <명령> …
//   grab <W> <url>   그 주소의 원문 글을 받아 W/sources/에 둔다 — 노트의 인용은 이 글에서 글자 그대로 옮긴다. 받은 파일 경로를 찍는다
//   fetch <W>        W/out/report.json의 주 목록 가운데 아직 안 받은 주소를 받는다
//   build <W>        W/out/report.json을 원문과 대조 → W/data.json, verify-report.txt, report.txt(독자용 글), page.html(완성 화면), artifact.html(게시용 조각)

type IndexEntry = { file: string | null; ok: boolean; kind?: string; why?: string; chars?: number; at: string };
type Index = Record<string, IndexEntry>;

const indexPath = (w: string) => path.join(w, 'sources', 'index.json');

function readIndex(work: string): Index {
  const p = indexPath(work);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as Index) : {};
}

async function grab(work: string, url: string, quiet = false): Promise<IndexEntry> {
  const dir = path.join(work, 'sources');
  fs.mkdirSync(dir, { recursive: true });
  const r = await fetchSource(url);
  const at = new Date().toISOString();
  let entry: IndexEntry;
  if (r.ok) {
    const file = path.join(dir, `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.txt`);
    fs.writeFileSync(file, r.text);
    entry = { file, ok: true, kind: r.kind, chars: r.text.length, at };
  } else entry = { file: null, ok: false, why: r.why, at };
  const index = readIndex(work);
  index[url] = entry;
  fs.writeFileSync(indexPath(work), JSON.stringify(index, null, 2));
  if (!quiet) console.log(entry.ok ? `받음 (${entry.kind}, ${entry.chars}자) → ${entry.file}` : `못 받음: ${entry.why} — 우회하지 말고, 보도자료나 그 글을 인용한 기사로 대신한다`);
  return entry;
}

function readReport(work: string): unknown {
  const p = path.join(work, 'out', 'report.json');
  if (!fs.existsSync(p)) throw new Error(`${p}가 없습니다`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function fetchAll(work: string): Promise<void> {
  const parsed = OutlookDataSchema.safeParse(readReport(work));
  if (!parsed.success) throw new Error('report.json 형식이 맞지 않습니다 — 먼저 build로 형식을 확인한다');
  const index = readIndex(work);
  for (const n of parsed.data.notes) {
    if (index[n.url]?.ok) continue;
    const e = await grab(work, n.url, true);
    console.log(`주 ${n.n}: ${e.ok ? `받음 (${e.kind}, ${e.chars}자)` : `못 받음 — ${e.why}`}`);
  }
}

function build(work: string): void {
  const parsed = OutlookDataSchema.safeParse(readReport(work));
  if (!parsed.success) {
    const lines = parsed.error.issues.slice(0, 20).map((i) => `  ! ${i.path.join('.') || '(본문)'}: ${i.message}`);
    fs.writeFileSync(path.join(work, 'verify-report.txt'), ['형식이 맞지 않습니다 (references/schema.md):', ...lines].join('\n') + '\n');
    console.error(['형식이 맞지 않습니다:', ...lines].join('\n'));
    process.exit(1);
  }
  const index = readIndex(work);
  const sources: SourceTexts = new Map();
  for (const n of parsed.data.notes) {
    const e = index[n.url];
    if (!e) continue;
    sources.set(n.n, e.ok && e.file && fs.existsSync(e.file) ? fs.readFileSync(e.file, 'utf8') : null);
  }
  const { data, report } = verifyOutlookData(parsed.data, sources);
  const lines = outlookReportLines(report);
  fs.writeFileSync(path.join(work, 'verify-report.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  if (report.fatal.length) process.exit(1);
  fs.writeFileSync(path.join(work, 'data.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(work, 'report.txt'), outlookPlainText(data));
  fs.writeFileSync(path.join(work, 'page.html'), renderOutlookHtml(data));
  fs.writeFileSync(path.join(work, 'artifact.html'), renderOutlookPage(data));
  console.log(`→ ${path.join(work, 'data.json')} · report.txt · page.html · artifact.html`);
}

async function main(): Promise<void> {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'grab' && a && b) await grab(a, b);
  else if (cmd === 'fetch' && a) await fetchAll(a);
  else if (cmd === 'build' && a) build(a);
  else {
    console.error('사용: npm run outlook:job -w server -- grab <W> <url> | fetch <W> | build <W>');
    process.exit(2);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
