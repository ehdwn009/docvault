import fs from 'node:fs';
import path from 'node:path';
import { TRADE } from '../constants.js';
import { downloadPdf, fetchAttachments, fetchListPage, sleep } from '../lib/trade/board.js';
import { addMonths, periodOf, previousMonth, type BoardRow } from '../lib/trade/match.js';
import { kstParts } from '../lib/briefing/time.js';

// trade-report 스킬이 쓰는 PDF 받기 — 서버의 정기 확인과 같은 코드(게시판 읽기·제목 판정)로, DB 없이 폴더에만 받는다.
// 사용: npm run trade:fetch -w server -- <YYYY-MM | latest> <폴더>
//   → <폴더>/cur.pdf, prev.pdf(전월 호), release.json { cur, prev } — 전월 호는 "지난달과 달라진 것"의 비교 대상

type Found = { period: string; row: BoardRow; pdfName: string; url: string };

async function findRelease(period: string): Promise<Found | null> {
  const from = `${addMonths(period, 1)}-01`;
  const to = `${addMonths(period, 1)}-${String(TRADE.LAST_DAY).padStart(2, '0')}`;
  for (let page = 1; page <= 3; page++) {
    const rows = await fetchListPage(from, to, page);
    const row = rows.find((r) => periodOf(r) === period);
    if (row) {
      await sleep(TRADE.REQUEST_GAP_MS);
      const pdf = (await fetchAttachments(row.articleId)).find((a) => /\.pdf$/i.test(a.name));
      if (!pdf) throw new Error(`${period}호 글(${row.articleId})에 PDF가 없습니다`);
      return { period, row, pdfName: pdf.name, url: pdf.url };
    }
    if (rows.length < 10) break;
    await sleep(TRADE.REQUEST_GAP_MS);
  }
  return null;
}

async function main(): Promise<void> {
  const [arg, outDir] = process.argv.slice(2);
  if (!arg || !outDir) {
    console.error('사용: npm run trade:fetch -w server -- <YYYY-MM | latest> <폴더>');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  // latest: 지난달 호부터 거슬러 올라가며 처음 찾히는 호 (1일 오전처럼 아직 안 올라온 때를 위해 두 달까지)
  let cur: Found | null = null;
  if (arg === 'latest') {
    let p = previousMonth(kstParts(Date.now()).month);
    for (let i = 0; i < 2 && !cur; i++, p = previousMonth(p)) cur = await findRelease(p);
  } else {
    if (!/^\d{4}-\d{2}$/.test(arg)) throw new Error(`달은 YYYY-MM으로: ${arg}`);
    cur = await findRelease(arg);
  }
  if (!cur) throw new Error(`게시판에서 ${arg} 호를 찾지 못했습니다`);
  await sleep(TRADE.REQUEST_GAP_MS);
  const prev = await findRelease(previousMonth(cur.period));
  const save = async (f: Found | null, name: string) => {
    if (!f) return null;
    await sleep(TRADE.REQUEST_GAP_MS);
    const buf = await downloadPdf({ name: f.pdfName, url: f.url });
    fs.writeFileSync(path.join(outDir, name), buf);
    return { period: f.period, articleId: f.row.articleId, title: f.row.title, dept: f.row.dept, date: f.row.date, pdfName: f.pdfName, bytes: buf.length, articleUrl: `${TRADE.ORIGIN}${TRADE.BOARD_PATH}/${f.row.articleId}/view`, file: name };
  };
  const release = { cur: await save(cur, 'cur.pdf'), prev: await save(prev, 'prev.pdf') };
  fs.writeFileSync(path.join(outDir, 'release.json'), JSON.stringify(release, null, 2));
  console.log(JSON.stringify(release, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
