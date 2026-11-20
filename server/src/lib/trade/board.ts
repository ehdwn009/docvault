import { TRADE } from '../../constants.js';
import type { BoardRow } from './match.js';

// 산업통상부 보도자료 게시판 읽기 — 목록(검색)·상세(첨부)·PDF 받기 (수출입 동향 설계 "어디를 보나").
// RSS는 쓰지 않는다: 최근 10건(약 3일치)뿐이라 1일 글이 밀려나고, 첨부·부서가 없다

/** 사람에게 그대로 보여 줄 실패 이유 — 알림 본문이 된다 */
export class BoardError extends Error {}

export type Attachment = { name: string; url: string };

async function get(url: string, accept: string): Promise<Response> {
  const once = () => fetch(url, { headers: { 'user-agent': TRADE.USER_AGENT, accept }, redirect: 'follow', signal: AbortSignal.timeout(TRADE.FETCH_TIMEOUT_MS) });
  let res: Response;
  try {
    res = await once();
  } catch {
    // 접속 실패는 한 번 더 — 실측 62번 중 2번이 시간 초과였고 다시 하면 됐다. 응답이 온 실패(404 등)는 다시 하지 않는다
    await sleep(TRADE.REQUEST_GAP_MS);
    try {
      res = await once();
    } catch (e) {
      throw new BoardError(`게시판에 접속하지 못했어요 (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  // 다른 도메인으로 넘어갔으면 부처 개편 등으로 주소가 바뀐 것 — 엉뚱한 곳의 내용을 받지 않는다
  if (new URL(res.url).origin !== TRADE.ORIGIN) throw new BoardError(`게시판 주소가 바뀐 것 같아요 (${new URL(res.url).origin}로 이동)`);
  if (!res.ok) throw new BoardError(`게시판이 ${res.status} 응답을 줬어요`);
  return res;
}

async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) throw new BoardError(`파일이 너무 커요 (${Math.round(declared / 1024 / 1024)}MB)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new BoardError(`파일이 너무 커요 (${Math.round(buf.length / 1024 / 1024)}MB)`);
  return buf;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** 목록 HTML → 줄들. 줄은 <tr> 하나 — 글 번호는 onclick의 article.view('172360') */
export function parseList(html: string): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const tr of html.split('<tr>').slice(1)) {
    const link = /article\.view\('(\d+)'\);\s*return false;">\s*<i>([\s\S]*?)<\/i>/.exec(tr);
    if (!link) continue;
    const date = /<td>(\d{4}-\d{2}-\d{2})<\/td>/.exec(tr);
    const dept = /<td><i>([^<]*)<\/i><\/td>/.exec(tr);
    if (!date) continue;
    rows.push({ articleId: link[1]!, title: clean(link[2]!), dept: dept ? clean(dept[1]!) : null, date: date[1]! });
  }
  return rows;
}

/** 상세 HTML → 첨부들. 첨부 순서는 달마다 다르다(PDF가 앞일 때도 뒤일 때도) — 이름의 확장자로 고른다 */
export function parseAttachments(html: string): Attachment[] {
  const out: Attachment[] = [];
  const re = /href="(\/attach\/down\/[^"]+)"[^>]*title="([^"]*?) 다운로드"/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const url = new URL(decodeEntities(m[1]!), TRADE.ORIGIN);
    // 첨부 주소는 같은 사이트의 /attach/down/ 아래만 — 페이지에 다른 호스트가 끼어 있어도 따라가지 않는다
    if (url.origin !== TRADE.ORIGIN || !url.pathname.startsWith('/attach/down/')) continue;
    out.push({ name: clean(m[2]!), url: url.toString() });
  }
  return out;
}

/** 목록 한 쪽 — 등록일 범위로 좁힌다(실측: 날짜 필터 동작). 한 쪽 10줄 */
export async function fetchListPage(fromDate: string, toDate: string, page: number): Promise<BoardRow[]> {
  const q = new URLSearchParams({ searchCondition: '1', searchKeyword: TRADE.SEARCH_KEYWORD, startDtD: fromDate, endDtD: toDate, pageIndex: String(page) });
  const res = await get(`${TRADE.ORIGIN}${TRADE.BOARD_PATH}?${q}`, 'text/html');
  const html = (await readCapped(res, TRADE.PAGE_MAX_BYTES)).toString('utf8');
  const rows = parseList(html);
  // 응답은 왔는데 줄을 하나도 못 읽고, 페이지에 글 링크 흔적도 없으면 "글이 없음"이 아니라 모양이 바뀐 것일 수 있다.
  // 빈 검색 결과 페이지에도 게시판 틀(searchForm)은 있으므로 그것까지 없을 때만 바뀐 것으로 본다
  if (rows.length === 0 && !html.includes('searchForm')) throw new BoardError('게시판 모양이 바뀐 것 같아요 — 목록을 읽지 못했어요');
  return rows;
}

export async function fetchAttachments(articleId: string): Promise<Attachment[]> {
  if (!/^\d+$/.test(articleId)) throw new BoardError(`글 번호가 이상해요 (${articleId})`);
  const res = await get(`${TRADE.ORIGIN}${TRADE.BOARD_PATH}/${articleId}/view`, 'text/html');
  return parseAttachments((await readCapped(res, TRADE.PAGE_MAX_BYTES)).toString('utf8'));
}

/** PDF 받기 — 첫 바이트가 %PDF가 아니면 받지 않는다(오류 페이지가 200으로 오는 경우) */
export async function downloadPdf(att: Attachment): Promise<Buffer> {
  const res = await get(att.url, 'application/pdf');
  const buf = await readCapped(res, TRADE.PDF_MAX_BYTES);
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') throw new BoardError(`${att.name}: PDF가 아닌 응답이 왔어요`);
  return buf;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
