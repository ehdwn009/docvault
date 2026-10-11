import { BRIEFING } from '../../constants.js';
import { isAggregator, isDirectUrl, type Candidate } from './collect.js';
import { fetchGuarded } from './fetch.js';
import { mapLimit } from './limit.js';
import { plainText } from './rss.js';
import type { Picked } from './select.js';
import { bodyMatchesTitle } from './verify.js';

// 핵심·주요 기사의 원문 앞부분을 읽는다 (뉴스 브리핑 설계 "③-1 근거 보강" ②, 개선 합의안 S7).
// 읽은 본문은 요약 호출에만 쓰고 어디에도 저장하지 않는다. 실패하면 발췌로 돌아갈 뿐 실행은 계속된다.
// 핵심은 서로 다른 언론사 3곳, 주요는 2곳까지 읽고, 재료마다 기호(A·B·C)와 언론사 이름표를 달아 AI에게 준다 —
// 본문 글자만 남기고 어느 언론사였는지 버리면 모델이 한겨레 본문을 연합뉴스 글로 알고 썼다 (토론 발견 13-1)

/** 요약 재료 하나 — 어느 언론사의 어느 기사 글인지가 붙어 있다. via='web'은 웹 검색으로 찾은 것(S8), 'feed'는 피드가 준 본문(S2) */
export type Material = {
  id: string;
  source: string;
  url: string;
  title: string;
  text: string;
  via: 'body' | 'feed' | 'web';
};

const MATERIAL_IDS = ['A', 'B', 'C', 'D'] as const;

/** 시도할 후보 — 대표 기사와 같은 사건의 다른 보도 중 받을 수 있는 것. 언론사 주소를 재게재 주소보다 먼저, 언론사마다 하나 */
export function bodyCandidates(p: Picked): Candidate[] {
  const pool: Candidate[] = [p.main, ...p.related];
  const ok = pool.filter((c) => isDirectUrl(c.url));
  ok.sort((a, b) => Number(isAggregator(a.source)) - Number(isAggregator(b.source)));
  const seenUrl = new Set<string>();
  const seenSource = new Set<string>();
  const out: Candidate[] = [];
  for (const c of ok) {
    const src = c.source.trim().toLowerCase();
    if (seenUrl.has(c.url) || seenSource.has(src)) continue;
    seenUrl.add(c.url);
    seenSource.add(src);
    out.push(c);
  }
  return out.slice(0, BRIEFING.BODY_FETCH_TRIES);
}

const DROP_BLOCKS = /<(script|style|noscript|svg|header|footer|nav|aside|form|figure|iframe|button)\b[\s\S]*?<\/\1>/gi;

/** HTML → 본문 앞부분. 라이브러리 없이: <article> 안의 문단 → 줄바꿈 문단 → og:description 순 */
export function extractArticleText(html: string, maxChars: number = BRIEFING.BODY_MAX_CHARS): string {
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
  return text.slice(0, maxChars);
}

function wanted(p: Picked): { outlets: number; main: number; other: number } {
  return p.importance === 3
    ? { outlets: BRIEFING.BODY_OUTLETS_CORE, main: BRIEFING.BODY_MAIN_CHARS_CORE, other: BRIEFING.BODY_OTHER_CHARS_CORE }
    : { outlets: BRIEFING.BODY_OUTLETS_MAJOR, main: BRIEFING.BODY_MAIN_CHARS_MAJOR, other: BRIEFING.BODY_OTHER_CHARS_MAJOR };
}

export type ReadResult = {
  /** 열쇠는 picked 배열의 위치. 재료를 하나도 못 얻은 기사는 빠진다 */
  materials: Map<number, Material[]>;
  /** 받았지만 제목과 안 맞아 버린 본문 수 — 실행 기록의 건강 숫자 */
  rejected: number;
  /** 피드 본문으로 대신한 수 */
  fromFeed: number;
};

/**
 * 핵심·주요 기사들(BODY_FETCH_MIN_IMPORTANCE 이상)의 재료 — 피드가 준 본문(S2)이 있으면 그것부터, 모자라면 원문을 받는다.
 * 핵심은 언론사 3곳, 주요는 2곳까지. 국내 출처는 20초 기다린다 (S1). 받은 본문이 제목과 안 맞으면 버린다 (verify)
 */
export async function readBodies(
  picked: Picked[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; track?: (name: string) => () => void } = {},
): Promise<ReadResult> {
  const targets = picked.map((p, i) => ({ p, i })).filter(({ p }) => p.importance >= BRIEFING.BODY_FETCH_MIN_IMPORTANCE);
  const materials = new Map<number, Material[]>();
  let rejected = 0;
  let fromFeed = 0;
  let done = 0;
  opts.onProgress?.(0, targets.length);
  await mapLimit(targets, BRIEFING.BODY_FETCH_CONCURRENCY, async ({ p, i }) => {
    const finish = opts.track?.(`${p.main.source} — ${p.main.title.slice(0, BRIEFING.LIVE_TITLE_CHARS)}`);
    const want = wanted(p);
    const got: Material[] = [];
    const usedSources = new Set<string>();
    const add = (c: Candidate, text: string, via: Material['via']) => {
      const id = MATERIAL_IDS[got.length];
      if (!id) return;
      got.push({ id, source: c.source, url: c.url, title: c.title, text: text.slice(0, got.length === 0 ? want.main : want.other), via });
      usedSources.add(c.source.trim().toLowerCase());
    };
    try {
      // 피드가 통째로 준 본문은 받을 필요가 없다 — 대표 기사부터
      for (const c of [p.main, ...p.related]) {
        if (got.length >= want.outlets) break;
        if (!c.feedText || usedSources.has(c.source.trim().toLowerCase())) continue;
        if (!bodyMatchesTitle(c.title, c.feedText)) continue;
        add(c, c.feedText, 'feed');
        fromFeed++;
      }
      for (const c of bodyCandidates(p)) {
        if (got.length >= want.outlets) break;
        if (usedSources.has(c.source.trim().toLowerCase())) continue;
        const domestic = p.sub.section === '국내';
        const timeoutMs = domestic ? BRIEFING.BODY_FETCH_TIMEOUT_DOMESTIC_MS : BRIEFING.BODY_FETCH_TIMEOUT_MS;
        try {
          const html = await fetchGuarded('page', c.url, { label: `원문 ${c.source}`, timeoutMs, signal: opts.signal });
          const text = extractArticleText(html, Math.max(want.main, want.other));
          if (text.length < 100) continue;
          if (!bodyMatchesTitle(c.title, text)) {
            rejected++;
            continue;
          }
          add(c, text, 'body');
        } catch {
          // 다음 주소로 — 막히거나 유료벽이어도 실행은 계속된다
        }
      }
      if (got.length > 0) materials.set(i, got);
    } finally {
      finish?.();
      opts.onProgress?.(++done, targets.length);
    }
  });
  return { materials, rejected, fromFeed };
}

/** 요약의 근거 — 화면이 "무엇을 보고 쓴 요약인지" 밝히는 데 쓴다 */
export function basisOf(p: Picked, materials: Material[] | undefined): 'body' | 'lede' | 'title' | 'web' {
  if (materials && materials.length > 0) return materials.every((m) => m.via === 'web') ? 'web' : 'body';
  const all: Candidate[] = [p.main, ...p.related];
  return all.some((c) => c.snippet) ? 'lede' : 'title';
}

/** 재료 글자 수 합 — 요약 목표 길이의 근거 (재료 ÷ 3) */
export function materialChars(p: Picked, materials: Material[] | undefined): number {
  if (materials && materials.length > 0) return materials.reduce((n, m) => n + m.text.length, 0);
  return [p.main, ...p.related].reduce((n, c) => n + c.snippet.length, 0);
}
