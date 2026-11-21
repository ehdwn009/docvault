import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { renderOutlookHtml, renderOutlookPage } from '../lib/outlook/document.js';
import { OutlookDataSchema } from '../lib/outlook/schema.js';
import { fetchSource, type SourceResult } from '../lib/outlook/sources.js';
import { outlookPlainText, outlookReportLines, verifyOutlookData, type SourceTexts } from '../lib/outlook/verify.js';
import { getJson, postJson, serverBase } from './jobServer.js';

// outlook-report 스킬의 기계적인 일 — 원문 받기와 대조·화면 만들기·서버와 주고받기. 대조는 서버가 완성본을 받을 때와 같은 함수다(lib/outlook/verify.ts).
// 사용: npm run outlook:job -w server -- <명령> …
//   pull <jobId> <W>               서버에서 지시서(W/instruction.json)·기준선 글(W/baseline.txt)·그 뒤 작은 판들의 글(W/later/NN.txt)을 받는다 (자동 모드, DOCVAULT_URL)
//   grab <W> <url> [--job <jobId>] 그 주소의 원문 글을 받아 W/sources/에 둔다 — 노트의 인용은 이 글에서 글자 그대로 옮긴다. 받은 파일 경로를 찍는다.
//                                  --job이면 서버가 받는다(자동 모드 — 세션의 네트워크가 좁아서). 서버는 그 글로 완성본을 다시 대조한다
//   fetch <W> [--job <jobId>]      W/out/report.json의 주 목록 가운데 아직 안 받은 주소를 받는다
//   build <W>                      W/out/report.json을 원문과 대조 → W/data.json, verify-report.txt, report.txt(독자용 글), page.html(완성 화면), artifact.html(게시용 조각)
//   send <jobId> <W>               W/data.json을 서버에 보낸다 — 서버가 다시 대조해 저장하고 모든 계정에 알린다 (자동 모드)

type IndexEntry = { file: string | null; ok: boolean; kind?: string; why?: string; chars?: number; at: string };
type Index = Record<string, IndexEntry>;

const indexPath = (w: string) => path.join(w, 'sources', 'index.json');

function readIndex(work: string): Index {
  const p = indexPath(work);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as Index) : {};
}

/** 서버에게 받아 달라고 한다(API-177) — 결과 모양은 로컬로 받을 때와 같다 */
function serverGrab(jobId: string, url: string): Promise<SourceResult> {
  const base = serverBase(jobId);
  return postJson<SourceResult>(`${base.url}/outlook/grab`, base.headers, JSON.stringify({ url }));
}

async function grab(work: string, url: string, quiet = false, jobId: string | null = null): Promise<IndexEntry> {
  const dir = path.join(work, 'sources');
  fs.mkdirSync(dir, { recursive: true });
  const r = jobId ? await serverGrab(jobId, url) : await fetchSource(url);
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

async function fetchAll(work: string, jobId: string | null): Promise<void> {
  const parsed = OutlookDataSchema.safeParse(readReport(work));
  if (!parsed.success) throw new Error('report.json 형식이 맞지 않습니다 — 먼저 build로 형식을 확인한다');
  const index = readIndex(work);
  for (const n of parsed.data.notes) {
    if (index[n.url]?.ok) continue;
    const e = await grab(work, n.url, true, jobId);
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

// ---- 서버 (자동 모드) — 주소·열쇠 규칙은 jobServer.ts ----

type Instruction = { kind?: string; baseline?: { label: string; title: string; text: string } | null; later?: { label: string; since: string; until: string; text: string }[] };

/** 지시서는 instruction.json에, 긴 글은 따로 — 에이전트가 지시서를 열 때 기준선 글 전체를 함께 읽지 않게 */
async function pull(jobId: string, work: string): Promise<void> {
  const { url, headers } = serverBase(jobId);
  const ins = await getJson<Instruction>(url, headers);
  if (ins.kind !== 'outlook') throw new Error(`세계 전망 일감이 아닙니다 (kind=${String(ins.kind)})`);
  fs.mkdirSync(path.join(work, 'later'), { recursive: true });
  const later = ins.later ?? [];
  if (ins.baseline) fs.writeFileSync(path.join(work, 'baseline.txt'), ins.baseline.text);
  later.forEach((e, i) => fs.writeFileSync(path.join(work, 'later', `${String(i + 1).padStart(2, '0')}.txt`), e.text));
  const slim = {
    ...ins,
    baseline: ins.baseline ? { label: ins.baseline.label, title: ins.baseline.title, file: 'baseline.txt' } : null,
    later: later.map((e, i) => ({ label: e.label, since: e.since, until: e.until, file: `later/${String(i + 1).padStart(2, '0')}.txt` })),
  };
  fs.writeFileSync(path.join(work, 'instruction.json'), JSON.stringify(slim, null, 2));
  console.log(JSON.stringify(slim, null, 2));
}

async function send(jobId: string, work: string): Promise<void> {
  const { url, headers } = serverBase(jobId);
  const body = fs.readFileSync(path.join(work, 'data.json'), 'utf8');
  console.log(JSON.stringify(await postJson(`${url}/outlook/result`, headers, body), null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // --job <jobId>는 어디에 와도 된다 — 에이전트 지시문이 grab 줄 끝에 붙여 넘긴다
  const at = args.indexOf('--job');
  const jobId = at >= 0 ? (args[at + 1] ?? null) : null;
  if (at >= 0) args.splice(at, 2);
  if (at >= 0 && !jobId) throw new Error('--job 뒤에 jobId가 필요합니다');
  const [cmd, a, b] = args;
  if (cmd === 'pull' && a && b) await pull(a, b);
  else if (cmd === 'grab' && a && b) await grab(a, b, false, jobId);
  else if (cmd === 'fetch' && a) await fetchAll(a, jobId);
  else if (cmd === 'build' && a) build(a);
  else if (cmd === 'send' && a && b) await send(a, b);
  else {
    console.error('사용: npm run outlook:job -w server -- pull <jobId> <W> | grab <W> <url> [--job <jobId>] | fetch <W> [--job <jobId>] | build <W> | send <jobId> <W>');
    process.exit(2);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
