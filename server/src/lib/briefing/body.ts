import { BRIEFING } from '../../constants.js';
import { isAggregator, type Candidate } from './collect.js';
import { fetchPageText } from './fetch.js';
import { mapLimit } from './limit.js';
import { plainText } from './rss.js';
import type { Picked } from './select.js';

// 핵심 기사만 원문 앞부분을 읽는다 (뉴스 브리핑 설계 "③-1 근거 보강" ②).
// 읽은 본문은 요약 호출에만 쓰고 어디에도 저장하지 않는다. 실패하면 발췌로 돌아갈 뿐 실행은 계속된다

/** 원문 주소로 바로 쓸 수 없는 곳 — Google 뉴스 링크는 스크립트로 넘어가 원문 주소로 풀리지 않는다 */
function fetchable(c: { url: string; source: string }): boolean {
  return !/^https?:\/\/news\.google\.com\//i.test(c.url);
}

/** 시도할 주소 — 대표 기사와 같은 사건의 다른 보도 중 받을 수 있는 것, 언론사 주소를 재게재 주소보다 먼저 */
export function bodyUrls(p: Picked): string[] {
  const pool: { url: string; source: string }[] = [p.main, ...p.related, ...p.main.related];
  const ok = pool.filter(fetchable);
  ok.sort((a, b) => Number(isAggregator(a.source)) - Number(isAggregator(b.source)));
  return [...new Set(ok.map((c) => c.url))].slice(0, BRIEFING.BODY_FETCH_TRIES);
}

const DROP_BLOCKS = /<(script|style|noscript|svg|header|footer|nav|aside|form|figure|iframe|button)\b[\s\S]*?<\/\1>/gi;

/** HTML → 본문 앞부분. 라이브러리 없이: <article> 안의 문단 → 줄바꿈 문단 → og:description 순 */
export function extractArticleText(html: string): string {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_BLOCKS, ' ');
  const articles = [...cleaned.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map((m) => m[0]);
  const region = articles.sort((a, b) => b.length - a.length)[0] ?? cleaned;
  const min = BRIEFING.BODY_MIN_PARAGRAPH_CHARS;

  let paras = [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plainText(m[1] ?? '')).filter((t) => t.length >= min);
  if (paras.join('').length < 200) {
    // 문단 태그 없이 <br>로 줄을 나누는 국내 기사 페이지가 많다
    const lines = region
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|h\d)>/gi, '\n')
      .split('\n')
      .map((l) => plainText(l))
      .filter((t) => t.length >= min);
    if (lines.join('').length > paras.join('').length) paras = lines;
  }
  let text = paras.join('\n');
  if (text.length < 100) {
    const og =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
      '';
    text = plainText(og);
  }
  return text.slice(0, BRIEFING.BODY_MAX_CHARS);
}

/** 핵심·주요 기사들(BODY_FETCH_MIN_IMPORTANCE 이상)의 본문 앞부분 — 열쇠는 picked 배열의 위치. 못 읽은 기사는 빠진다 */
export async function readBodies(
  picked: Picked[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<number, string>> {
  const targets = picked.map((p, i) => ({ p, i })).filter(({ p }) => p.importance >= BRIEFING.BODY_FETCH_MIN_IMPORTANCE);
  const bodies = new Map<number, string>();
  let done = 0;
  opts.onProgress?.(0, targets.length);
  await mapLimit(targets, BRIEFING.BODY_FETCH_CONCURRENCY, async ({ p, i }) => {
    try {
      for (const url of bodyUrls(p)) {
        try {
          const text = extractArticleText(await fetchPageText(url, opts.signal));
          if (text.length >= 100) {
            bodies.set(i, text);
            return;
          }
        } catch {
          // 다음 주소로 — 막히거나 유료벽이어도 실행은 계속된다
        }
      }
    } finally {
      opts.onProgress?.(++done, targets.length);
    }
  });
  return bodies;
}

/** 요약의 근거 — 화면이 "무엇을 보고 쓴 요약인지" 밝히는 데 쓴다 */
export function basisOf(p: Picked, hasBody: boolean): 'body' | 'lede' | 'title' {
  if (hasBody) return 'body';
  const all: Candidate[] = [p.main, ...p.related];
  return all.some((c) => c.snippet) ? 'lede' : 'title';
}
