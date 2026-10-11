import { BRIEFING } from '../../constants.js';
import { fetchGuarded } from './fetch.js';
import { errorText, mapLimit } from './limit.js';
import { parseFeed, type FeedItem } from './rss.js';
import { outletName } from './outlets.js';
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
  /** 피드가 통째로 준 본문 앞부분 — 원문을 받지 않아도 되는 재료. 메모리에서만 (S2) */
  feedText: string;
  region: BriefingSection;
  /** 검색으로 온 기사만 분야를 안다 — 나머지는 ② 분류가 정한다 */
  sub: BriefingSub | null;
  /** 같은 제목으로 합쳐진 다른 언론의 링크 */
  related: { source: string; url: string }[];
};

export type CollectResult = {
  candidates: Candidate[];
  sourceCount: number;
  /** kind: 검색 출처(Google 뉴스)는 실패율의 분모에서 뺀다 — 검색 40개가 한꺼번에 429를 받으면 회차가 통째로 실패했다 (v0.46) */
  failed: { name: string; reason: string; kind: 'feed' | 'search' }[];
  /** Google 기사를 직접 기사에 붙인 수 — 실행 기록의 건강 숫자 (S3) */
  attached: number;
  /** 수집 단계 사건 묶기를 켜면 묶일 후보 수 — 첫 실측 5회차는 세기만 한다 (v0.46) */
  wouldMerge: number;
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

/** 포털 재게재 주소 — 언론사 이름 자리에 이것이 오면 대표 기사·출처로 쓰지 않는다 (설계 "③-1 근거 보강") */
const AGGREGATORS = new Set(['v.daum.net', 'news.v.daum.net', 'n.news.naver.com', 'news.naver.com', 'm.news.naver.com']);
export function isAggregator(source: string): boolean {
  return AGGREGATORS.has(source.trim().toLowerCase());
}

/** 발췌가 제목을 되풀이할 뿐이면 빈 발췌 — Google 뉴스 RSS의 발췌는 "제목 + 언론사 이름"이다 */
export function usefulSnippet(title: string, snippet: string): string {
  const t = titleKey(title);
  const s = titleKey(snippet);
  if (!s) return '';
  if (t && s.startsWith(t) && s.length - t.length < BRIEFING.SNIPPET_MIN_EXTRA_CHARS) return '';
  return snippet;
}

function toCandidates(src: Source, items: FeedItem[], since: number, until: number, excludeUrls: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const it of items) {
    if (!it.title || !/^https?:\/\//i.test(it.link)) continue;
    // 발행 시각이 없으면 범위를 판정할 수 없다 — 버린다
    if (it.publishedAt === null || it.publishedAt <= since || it.publishedAt > until) continue;
    if (excludeUrls.has(it.link)) continue;
    const title = stripSourceSuffix(it.title, it.source);
    out.push({
      title,
      url: it.link,
      publishedAt: it.publishedAt,
      // 주소로 온 언론사는 이름으로 — 화면의 출처와 "다른 보도" 세기가 둘 다 이름 기준이 된다
      source: outletName(it.source ?? src.publisher),
      snippet: usefulSnippet(title, it.snippet),
      feedText: it.fullText,
      region: src.region,
      sub: src.sub,
      related: [],
    });
  }
  // 출처 하나가 후보를 독차지하지 않게 — 상한까지, 범위 전체에서 고르게. 검색은 신호용이라 더 적게 (S6)
  return spreadPick(out, src.sub ? BRIEFING.MAX_PER_SEARCH : BRIEFING.MAX_PER_SOURCE, since, until);
}

/** 원문 주소로 바로 쓸 수 있는 곳 — Google 뉴스 링크는 스크립트로 넘어가 원문 주소로 풀리지 않는다 */
export function isDirectUrl(url: string): boolean {
  return !/^https?:\/\/news\.google\.com\//i.test(url);
}

/** 글자 2개씩 겹치는 비율(0~1) — 제목 유사도. 짧은 쪽 기준이라 말줄임·부제가 붙어도 같은 기사를 알아본다 */
export function bigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return hit / Math.min(ga.size, gb.size);
}

const NUMBERS = /\d+(?:[.,]\d+)*/g;
export function numberSet(s: string): string[] {
  return [...new Set((s.match(NUMBERS) ?? []).map((n) => n.replace(/,/g, '')))].sort();
}

/**
 * Google 검색으로 온 기사를 같은 언론사의 직접 피드 기사에 붙인다 (개선 합의안 S3) — Google 링크는 원문을 읽을 수 없고,
 * 제목이 조금만 달라도(말줄임·부제) 같은 기사로 안 묶였다. 같은 언론사 + 제목 유사 + 6시간 안이면 직접 기사가 대표가 되고
 * Google 기사는 분야(sub)만 넘겨 준다. 두 제목에 숫자가 있으면 같아야 한다 — 같은 언론사가 비슷한 제목의 후속 기사를 연달아 낸다
 * ("코스피 2% 하락" → "코스피 3% 하락 마감"). 네트워크·AI 비용 0
 */
export function attachToDirect(list: Candidate[]): { list: Candidate[]; attached: number } {
  const isGoogle = (c: Candidate) => !isDirectUrl(c.url);
  const direct = new Map<string, Candidate[]>();
  for (const c of list) if (!isGoogle(c)) direct.set(c.source, [...(direct.get(c.source) ?? []), c]);
  let attached = 0;
  const out: Candidate[] = [];
  for (const c of list) {
    if (!isGoogle(c)) {
      out.push(c);
      continue;
    }
    const key = titleKey(c.title);
    const host = (direct.get(c.source) ?? []).find((d) => {
      if (Math.abs(d.publishedAt - c.publishedAt) > BRIEFING.ATTACH_MAX_GAP_MS) return false;
      if (bigramSimilarity(key, titleKey(d.title)) < BRIEFING.ATTACH_TITLE_SIMILARITY) return false;
      const na = numberSet(c.title);
      const nb = numberSet(d.title);
      return na.length === 0 || nb.length === 0 || na.join('|') === nb.join('|');
    });
    if (!host) {
      out.push(c);
      continue;
    }
    host.sub ??= c.sub;
    for (const r of c.related) if (r.source !== host.source && !host.related.some((x) => x.url === r.url)) host.related.push(r);
    attached++;
  }
  return { list: out, attached };
}

/**
 * 상한까지 자르되 범위 전체에서 고르게 남긴다 — 범위를 SPREAD_SLOTS칸으로 나눠 칸마다 최신 것부터 한 건씩 돌아가며.
 * 최신순으로 잘랐더니 24시간판의 137건이 전부 마지막 90분 기사였다 (설계 "① 수집", 사용성 평가 2026-10-01).
 * 기사가 적은 칸은 금방 바닥나고 남은 몫은 기사가 많은 칸이 가져간다 — 실제 뉴스 흐름의 굴곡은 남는다
 */
export function spreadPick<T extends { publishedAt: number }>(list: T[], max: number, since: number, until: number): T[] {
  const newest = [...list].sort((a, b) => b.publishedAt - a.publishedAt);
  if (newest.length <= max) return newest;
  const width = Math.max(1, (until - since) / BRIEFING.SPREAD_SLOTS);
  const slots: T[][] = Array.from({ length: BRIEFING.SPREAD_SLOTS }, () => []);
  for (const it of newest) {
    const i = Math.min(BRIEFING.SPREAD_SLOTS - 1, Math.max(0, Math.floor((until - it.publishedAt) / width)));
    slots[i]!.push(it); // 0번 칸이 가장 최근
  }
  const out: T[] = [];
  for (let round = 0; out.length < max; round++) {
    let took = false;
    for (const slot of slots) {
      const it = slot[round];
      if (!it) continue;
      out.push(it);
      took = true;
      if (out.length >= max) break;
    }
    if (!took) break;
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
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
    if (c.feedText.length > prev.feedText.length) prev.feedText = c.feedText;
    // 같은 언론사의 같은 기사(피드·검색 양쪽에서 온 것)는 "다른 보도"가 아니다
    if (c.source !== prev.source && !prev.related.some((r) => r.url === c.url)) prev.related.push({ source: c.source, url: c.url });
  }
  return [...byKey.values()];
}

/**
 * 수집 단계 사건 묶기 세기 (v0.46, 수집 재설계 토론) — 같은 region·6시간 안·제목 글자 묶음 겹침 0.7 이상·숫자 집합 같음·분야를 둘 다 알면 같음.
 * 지금은 켜지 않고 "묶였을 후보 수"만 센다(stats.wouldMerge) — 첫 5회차에서 묶음을 눈으로 보고 오결합 5% 이하면 켠다.
 * 비교는 발행 시각순으로 6시간 창 안에서만 해 600건이라도 가볍다. 네트워크·AI 비용 0
 */
export function countStoryGroups(list: Candidate[]): number {
  const sorted = [...list].map((c) => ({ c, key: titleKey(c.title), nums: numberSet(c.title) })).sort((a, b) => a.c.publishedAt - b.c.publishedAt);
  let merged = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (a.key.length < BRIEFING.STORY_GROUP_MIN_KEY_CHARS) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.c.publishedAt - a.c.publishedAt > BRIEFING.ATTACH_MAX_GAP_MS) break;
      if (b.c.region !== a.c.region || b.key.length < BRIEFING.STORY_GROUP_MIN_KEY_CHARS) continue;
      if (a.c.sub && b.c.sub && a.c.sub !== b.c.sub) continue;
      if (a.nums.length && b.nums.length && a.nums.join('|') !== b.nums.join('|')) continue;
      if (bigramSimilarity(a.key, b.key) >= BRIEFING.STORY_GROUP_SIMILARITY) {
        merged++;
        break; // 하나에만 묶인다
      }
    }
  }
  return merged;
}

/** 출처 하나의 피드 — 국내 출처는 더 기다린다(설계 "멈춤 대책 2차"). 점검 스크립트도 같은 길로 받는다 */
export function fetchSource(src: Source, signal?: AbortSignal): Promise<string> {
  const timeoutMs = src.region === '국내' ? BRIEFING.FETCH_TIMEOUT_DOMESTIC_MS : BRIEFING.FETCH_TIMEOUT_MS;
  return fetchGuarded('feed', src.url, { label: src.name, timeoutMs, signal });
}

export async function collect(
  sources: Source[],
  opts: {
    since: number;
    until: number;
    excludeUrls: Set<string>;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    /** 받는 중인 출처를 알린다 — 오래 걸리는 출처를 화면이 "기다리는 중"으로 보여 준다. 돌려받은 함수로 끝을 알린다 */
    track?: (name: string) => () => void;
  },
): Promise<CollectResult> {
  let done = 0;
  opts.onProgress?.(0, sources.length);
  const results = await mapLimit(sources, BRIEFING.FETCH_CONCURRENCY, async (src) => {
    const finish = opts.track?.(src.name);
    try {
      const xml = await fetchSource(src, opts.signal);
      return toCandidates(src, parseFeed(xml), opts.since, opts.until, opts.excludeUrls);
    } finally {
      finish?.();
      opts.onProgress?.(++done, sources.length);
    }
  });

  const failed: CollectResult['failed'] = [];
  const all: Candidate[] = [];
  results.forEach((r, i) => {
    if (r.ok) all.push(...r.value);
    else failed.push({ name: sources[i]?.name ?? '?', reason: errorText(r.error), kind: sources[i]?.sub ? 'search' : 'feed' });
  });
  const joined = attachToDirect(dedupe(all));
  const candidates = spreadPick(joined.list, BRIEFING.MAX_CANDIDATES, opts.since, opts.until);
  return { candidates, sourceCount: sources.length, failed, attached: joined.attached, wouldMerge: countStoryGroups(candidates) };
}
