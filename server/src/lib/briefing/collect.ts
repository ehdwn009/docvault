import { BRIEFING } from '../../constants.js';
import { fetchFeedText } from './fetch.js';
import { errorText, mapLimit } from './limit.js';
import { parseFeed, type FeedItem } from './rss.js';
import type { Source } from './sources.js';
import type { BriefingSection, BriefingSub } from './taxonomy.js';

// ① 수집 — 출처를 동시에 받고, 범위 안 기사만 남기고, 같은 제목을 하나로 합친다 (뉴스 브리핑 설계 "① 수집").
// 여기서 남는 발췌(snippet)는 AI에게 보여 주는 데만 쓰고 회차 문서에는 저장하지 않는다

export type Candidate = {
  title: string;
  url: string;
  publishedAt: number;
  /** 언론사 이름 */
  source: string;
  snippet: string;
  region: BriefingSection;
  /** 검색으로 온 기사만 분야를 안다 — 나머지는 ② 분류가 정한다 */
  sub: BriefingSub | null;
  /** 같은 제목으로 합쳐진 다른 언론의 링크 */
  related: { source: string; url: string }[];
};

export type CollectResult = {
  candidates: Candidate[];
  sourceCount: number;
  failed: { name: string; reason: string }[];
};

/** 중복 판정용 제목 열쇠 — 말머리([속보]·[단독]), 공백, 문장부호를 지운다 */
export function titleKey(title: string): string {
  return title
    .replace(/^\s*(\[[^\]]{1,10}\]|【[^】]{1,10}】)\s*/g, '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** Google 뉴스 제목 끝의 " - 언론사" 꼬리를 뗀다 (언론사는 <source>로 따로 온다) */
function stripSourceSuffix(title: string, source: string | null): string {
  if (source && title.endsWith(` - ${source}`)) return title.slice(0, -(source.length + 3)).trim();
  return title;
}

function toCandidates(src: Source, items: FeedItem[], since: number, until: number, excludeUrls: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const it of items) {
    if (!it.title || !/^https?:\/\//i.test(it.link)) continue;
    // 발행 시각이 없으면 범위를 판정할 수 없다 — 버린다
    if (it.publishedAt === null || it.publishedAt <= since || it.publishedAt > until) continue;
    if (excludeUrls.has(it.link)) continue;
    out.push({
      title: stripSourceSuffix(it.title, it.source),
      url: it.link,
      publishedAt: it.publishedAt,
      source: it.source ?? src.publisher,
      snippet: it.snippet,
      region: src.region,
      sub: src.sub,
      related: [],
    });
  }
  // 출처 하나가 후보를 독차지하지 않게 — 최신순으로 상한까지
  return out.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, BRIEFING.MAX_PER_SOURCE);
}

/** 같은 제목은 하나로 — 분야를 아는 쪽(검색), 긴 발췌를 남기고 나머지는 related로 */
export function dedupe(list: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of list) {
    const key = titleKey(c.title);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...c, related: [...c.related] });
      continue;
    }
    if (prev.url === c.url) {
      prev.sub ??= c.sub;
      continue;
    }
    prev.sub ??= c.sub;
    if (c.snippet.length > prev.snippet.length) prev.snippet = c.snippet;
    if (!prev.related.some((r) => r.url === c.url)) prev.related.push({ source: c.source, url: c.url });
  }
  return [...byKey.values()];
}

export async function collect(
  sources: Source[],
  opts: { since: number; until: number; excludeUrls: Set<string>; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<CollectResult> {
  let done = 0;
  opts.onProgress?.(0, sources.length);
  const results = await mapLimit(sources, BRIEFING.FETCH_CONCURRENCY, async (src) => {
    try {
      const xml = await fetchFeedText(src.url, opts.signal);
      return toCandidates(src, parseFeed(xml), opts.since, opts.until, opts.excludeUrls);
    } finally {
      opts.onProgress?.(++done, sources.length);
    }
  });

  const failed: CollectResult['failed'] = [];
  const all: Candidate[] = [];
  results.forEach((r, i) => {
    if (r.ok) all.push(...r.value);
    else failed.push({ name: sources[i]?.name ?? '?', reason: errorText(r.error) });
  });
  const candidates = dedupe(all)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, BRIEFING.MAX_CANDIDATES);
  return { candidates, sourceCount: sources.length, failed };
}
