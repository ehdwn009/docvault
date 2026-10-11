import { Readability } from '@mozilla/readability';
import { and, eq, isNull } from 'drizzle-orm';
import { parseHTML } from 'linkedom';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { files } from '../../db/schema.js';
import { fetchGuarded } from './fetch.js';
import type { Edition, EditionItem } from './edition.js';
import { plainText } from './rss.js';
import { bodyMatchesTitle } from './verify.js';

// 앱 안 원문 보기 (개선 합의안 7장, 2026-10-11) — 누를 때만 받아 문단만 돌려주고, 디스크·DB에 저장하지 않는다.
// API는 기사 id만 받는다(임의 주소를 받으면 열린 프록시가 된다). 관리자 전용이고 설정(briefing_reader)으로 켠다.
// Readability + linkedom은 이 기능에만 쓴다 — 회차 만들기의 가벼운 추출(body.ts)과 다르다. jsdom은 메모리가 4배라 쓰지 않았다.
// 동시 1건(대기열), 20초. 유료벽·추출 실패(짧게 뽑힘)면 "사이트에서 보세요"로 돌린다. 우회 시도는 하지 않는다

export type ReaderResult = { title: string; byline: string | null; source: string; url: string; paragraphs: string[] };

export class ReaderError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NO_URL' | 'UNREADABLE' | 'FETCH_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** 회차 JSON에서 기사 하나 — 소유자의 회차만 */
export function findEditionItem(ownerId: number, fileId: number, itemId: string): EditionItem | null {
  const row = db
    .select({ contentText: files.contentText })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.ownerId, ownerId), eq(files.kind, 'briefing'), isNull(files.deletedAt)))
    .get();
  if (!row?.contentText) return null;
  try {
    const ed = JSON.parse(row.contentText) as Edition;
    for (const s of ed.sections ?? []) for (const c of s.categories ?? []) for (const sub of c.subs ?? []) for (const it of sub.items ?? []) if (it.id === itemId) return it;
  } catch {
    return null;
  }
  return null;
}

/** 기자 메일·"무단전재" 같은 군더더기 줄 — 국내 기사 페이지에 흔하다 */
const JUNK = /(무단\s*전재|재배포\s*금지|저작권자|기자\s*=|@[\w.-]+\.(com|co\.kr|net)|^\s*\[?사진\s*[=:]|관련\s*기사|^▶|^☞|구독하기|제보하기)/;

/** HTML → 문단 목록. Readability가 본문을 못 찾으면 빈 배열 */
export function extractParagraphs(html: string, url: string): { title: string; byline: string | null; paragraphs: string[] } {
  const { document } = parseHTML(html);
  // 서버에는 DOM 타입이 없다 — Readability가 요구하는 문서 타입으로만 맞춘다(linkedom이 그 역할을 한다)
  type ReadabilityDoc = ConstructorParameters<typeof Readability>[0];
  const reader = new Readability(document as unknown as ReadabilityDoc, { charThreshold: 200 });
  const article = reader.parse();
  if (!article?.content) return { title: '', byline: null, paragraphs: [] };
  const { document: doc } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
  const paragraphs: string[] = [];
  for (const el of doc.querySelectorAll('p, li, h2, h3, blockquote')) {
    const t = plainText(el.textContent ?? '');
    if (t.length < BRIEFING.BODY_MIN_PARAGRAPH_CHARS || JUNK.test(t)) continue;
    if (paragraphs[paragraphs.length - 1] === t) continue;
    paragraphs.push(t);
    if (paragraphs.length >= BRIEFING.READER_MAX_PARAGRAPHS) break;
  }
  void url;
  return { title: plainText(article.title ?? ''), byline: article.byline ? plainText(article.byline) : null, paragraphs };
}

// ---- 메모리 캐시 (10분·20건) — 같은 기사를 요약 ↔ 원문으로 오갈 때 매번 받지 않게. 디스크에는 두지 않는다 ----
const cache = new Map<string, { at: number; value: ReaderResult }>();
function cached(key: string): ReaderResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > BRIEFING.READER_CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function remember(key: string, value: ReaderResult): void {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > BRIEFING.READER_CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

// 동시 1건 — 1GB 서버에서 Readability 두 개가 겹치면 위험하다. 줄을 세운다
let chain: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** 기사 하나의 원문 문단 — readUrl이 없으면 NO_URL, 짧게 뽑히거나 제목과 안 맞으면 UNREADABLE */
export async function readOriginal(item: EditionItem, signal?: AbortSignal): Promise<ReaderResult> {
  const url = item.readUrl;
  if (!url) throw new ReaderError('NO_URL', '앱에서 받을 주소가 없는 기사예요');
  const hit = cached(url);
  if (hit) return hit;
  return queued(async () => {
    const again = cached(url);
    if (again) return again;
    let html: string;
    try {
      html = await fetchGuarded('page', url, { label: `원문 보기 ${item.source}`, timeoutMs: BRIEFING.READER_TIMEOUT_MS, signal });
    } catch (e) {
      throw new ReaderError('FETCH_FAILED', `원문을 받지 못했어요 (${e instanceof Error ? e.message : String(e)})`);
    }
    const ex = extractParagraphs(html, url);
    const text = ex.paragraphs.join('\n');
    const title = item.originalTitle ?? item.title;
    if (text.length < BRIEFING.READER_MIN_CHARS || !bodyMatchesTitle(title, text)) {
      throw new ReaderError('UNREADABLE', '앱에서 보여 줄 수 없는 기사예요 — 유료 기사이거나 본문을 뽑지 못했어요');
    }
    const value: ReaderResult = { title: ex.title || title, byline: ex.byline, source: item.source, url, paragraphs: ex.paragraphs };
    remember(url, value);
    return value;
  });
}

/** 추출 품질 판정 — 점검 명령(briefing:readcheck)이 같은 기준으로 센다 */
export function readerQualityOk(title: string, paragraphs: string[]): boolean {
  const text = paragraphs.join('\n');
  return text.length >= BRIEFING.READER_MIN_CHARS && bodyMatchesTitle(title, text);
}
