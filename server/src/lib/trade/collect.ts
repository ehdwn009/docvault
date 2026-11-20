import { TRADE } from '../../constants.js';
import { kstParts } from '../briefing/time.js';
import { BoardError, downloadPdf, fetchAttachments, fetchListPage, sleep } from './board.js';
import { addMonths, periodLabel, periodOf, previousMonth, type BoardRow } from './match.js';
import { hasRelease, saveRelease, type SavedRelease } from './store.js';

// 게시판에서 호를 찾아 받는 일 — 한 달 확인(정기)과 처음 소급 (수출입 동향 설계 1단계).
// 한 번에 하나만 돈다: 소급이 도는 중에 정기 확인이 같은 달을 받으면 파일이 둘 생길 수 있다(기록은 막혀도 요청은 두 번)

export type Saved = SavedRelease & { publishedDate: string; bytes: number };

let running: Promise<unknown> | null = null;
export const isBusy = () => running !== null;

/** 하나씩만 — 이미 돌고 있으면 null (다음 틱이 다시 본다) */
export async function exclusive<T>(fn: () => Promise<T>): Promise<T | null> {
  if (running) return null;
  const p = fn();
  running = p;
  try {
    return await p;
  } finally {
    running = null;
  }
}

/** 찾은 줄의 PDF를 받아 보관 — 첨부에 PDF가 없으면 BoardError */
async function takeRow(row: BoardRow, period: string, foundBy: 'schedule' | 'backfill'): Promise<Saved | null> {
  const atts = await fetchAttachments(row.articleId);
  const pdf = atts.find((a) => /\.pdf$/i.test(a.name));
  if (!pdf) throw new BoardError(`${periodLabel(period)}호 글(${row.articleId})에 PDF 첨부가 없어요 — 첨부: ${atts.map((a) => a.name).join(', ') || '없음'}`);
  await sleep(TRADE.REQUEST_GAP_MS);
  const buf = await downloadPdf(pdf);
  const saved = saveRelease({ row, period, pdfName: pdf.name, pdf: buf, foundBy });
  return saved && { ...saved, publishedDate: row.date, bytes: buf.length };
}

/** 정기 확인 — 그 달 호가 게시판에 있으면 받아 둔다. 아직 없으면 null */
export async function checkPeriod(period: string, now = Date.now()): Promise<Saved | null> {
  if (hasRelease(period)) return null;
  // 게시는 다룬 달의 다음 달 — 그달 1일부터 오늘까지만 본다. "수출입" 검색이 한 달에 두 쪽을 넘는 일은 드물다
  const from = `${addMonths(period, 1)}-01`;
  const today = kstParts(now).date;
  for (let page = 1; page <= 3; page++) {
    const rows = await fetchListPage(from, today, page);
    const row = rows.find((r) => periodOf(r) === period);
    if (row) {
      await sleep(TRADE.REQUEST_GAP_MS);
      return takeRow(row, period, 'schedule');
    }
    if (rows.length < 10) return null;
    await sleep(TRADE.REQUEST_GAP_MS);
  }
  return null;
}

export type BackfillResult = { saved: Saved[]; missing: { period: string; reason: string }[] };

/** 처음 소급 — 대상 달(지난달)까지 BACKFILL_MONTHS개. 목록을 날짜 범위로 넘기며 후보를 모은 뒤 달마다 받는다 */
export async function backfill(now = Date.now()): Promise<BackfillResult> {
  const target = previousMonth(kstParts(now).month);
  const periods = Array.from({ length: TRADE.BACKFILL_MONTHS }, (_, i) => addMonths(target, i - TRADE.BACKFILL_MONTHS + 1));
  const from = `${addMonths(periods[0]!, 1)}-01`;
  const today = kstParts(now).date;
  const found = new Map<string, BoardRow>();
  for (let page = 1; page <= TRADE.BACKFILL_MAX_PAGES; page++) {
    const rows = await fetchListPage(from, today, page);
    for (const r of rows) {
      const p = periodOf(r);
      if (p && periods.includes(p) && !found.has(p)) found.set(p, r);
    }
    if (rows.length < 10 || found.size === periods.length) break;
    await sleep(TRADE.REQUEST_GAP_MS);
  }
  const result: BackfillResult = { saved: [], missing: [] };
  for (const period of periods) {
    if (hasRelease(period)) continue;
    const row = found.get(period);
    if (!row) {
      // 대상 달은 아직 안 올라왔을 수 있다(1일 오전) — 그건 정기 확인이 맡는다
      if (period !== target) result.missing.push({ period, reason: '게시판에서 글을 찾지 못했어요' });
      continue;
    }
    try {
      await sleep(TRADE.REQUEST_GAP_MS);
      const saved = await takeRow(row, period, 'backfill');
      if (saved) result.saved.push(saved);
    } catch (e) {
      result.missing.push({ period, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
