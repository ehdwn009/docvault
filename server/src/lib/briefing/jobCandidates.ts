import { z } from 'zod/v4';
import { stripMeta } from './clean.js';
import { isAggregator, isDirectUrl, type Candidate } from './collect.js';
import { HANGUL, type Picked } from './select.js';
import { findSubById, type BriefingSub } from './taxonomy.js';

// 세션과 서버가 주고받는 후보·선별의 모양 — 재료는 서버가, 판단과 글은 세션이 (뉴스 브리핑 설계 "구독 생성 방식 — 재료는 서버가", v0.59).
// 같은 파일(candidates.json·selected.json)을 세션의 명령(briefing-job)과 서버(API-154~156)가 같은 코드로 읽고 쓴다 —
// 후보 번호 i는 전역 번호(배열 위치)라, 서버가 가진 후보와 세션이 받은 후보가 같은 번호로 같은 기사를 가리킨다

/** 후보 — Candidate에서 sub 객체를 id로 바꾼 저장용 모양. i는 전역 번호(분류·선별·요약 파일이 전부 이 번호로 가리킨다) */
export const StoredCandidateSchema = z.object({
  i: z.number(),
  title: z.string(),
  url: z.string(),
  publishedAt: z.number(),
  source: z.string(),
  snippet: z.string(),
  feedText: z.string(),
  region: z.enum(['국내', '세계']),
  subId: z.string().nullable(),
  related: z.array(z.object({ source: z.string(), url: z.string() })),
});
export type StoredCandidate = z.infer<typeof StoredCandidateSchema>;

/** 수집 결과의 건강 숫자 — candidates.json의 stats이자 API-154 응답의 stats */
export const CandidateStatsSchema = z.object({
  sources: z.number(),
  sourcesFailed: z.number(),
  failedSources: z.array(z.string()),
  candidates: z.number(),
  attached: z.number(),
  wouldMerge: z.number(),
  outletDrops: z.number().default(0),
  outletDropNames: z.array(z.string()).default([]),
});
export type CandidateStats = z.infer<typeof CandidateStatsSchema>;

export const CandidatesFileSchema = z.object({ stats: CandidateStatsSchema, candidates: z.array(StoredCandidateSchema) });
export type CandidatesFile = z.infer<typeof CandidatesFileSchema>;

/** 선별 답 — 전역 번호로 대표(main)와 같은 사건(related)을 가리킨다. 참고(1)만 title·summary·why를 쓴다. selected.json이자 API-155 본문 */
export const SelectedSchema = z.object({
  stories: z.array(
    z.object({
      subId: z.string(),
      main: z.number(),
      related: z.array(z.number()).default([]),
      importance: z.number(),
      prevStoryId: z.string().nullable().default(null),
      title: z.string().default(''),
      summary: z.string().default(''),
      why: z.string().default(''),
    }),
  ),
});
export type Selected = z.infer<typeof SelectedSchema>;

export function toStored(c: Candidate, i: number): StoredCandidate {
  return { i, title: c.title, url: c.url, publishedAt: c.publishedAt, source: c.source, snippet: c.snippet, feedText: c.feedText, region: c.region, subId: c.sub?.id ?? null, related: c.related };
}

export function toCandidate(s: StoredCandidate): Candidate {
  return { title: s.title, url: s.url, publishedAt: s.publishedAt, source: s.source, snippet: s.snippet, feedText: s.feedText, region: s.region, sub: s.subId ? (findSubById(s.subId) ?? null) : null, related: s.related };
}

function subOrThrow(id: string, where: string): BriefingSub {
  const sub = findSubById(id);
  if (!sub) throw new Error(`${where}: 분류표에 없는 분야 id "${id}"`);
  return sub;
}

/**
 * 선별 답 → Picked[] (서버 selectOne의 뒷부분과 같은 규칙 — 번호가 없거나 겹치면 버린다, 참고 제목에 한글이 없으면 싣지 않는다).
 * 분류표에 없는 분야 id는 Error — 세션이 지어낸 id로는 조립할 수 없다
 */
export function toPicked(selected: Selected, byIndex: Map<number, Candidate>, prevIds: ReadonlySet<string>): { picked: Picked[]; warnings: string[] } {
  const used = new Set<number>();
  const picked: Picked[] = [];
  const warnings: string[] = [];
  selected.stories.forEach((s, n) => {
    const main = byIndex.get(s.main);
    if (!main || used.has(s.main)) {
      warnings.push(`stories[${n}]: 대표 번호 ${s.main}이(가) 없거나 이미 쓰였음 — 버림`);
      return;
    }
    used.add(s.main);
    const related: Candidate[] = [];
    for (const r of s.related) {
      const c = byIndex.get(r);
      if (c && !used.has(r)) {
        used.add(r);
        related.push(c);
      }
    }
    const importance = Math.min(3, Math.max(1, Math.round(s.importance))) as 1 | 2 | 3;
    const title = s.title.trim() || main.title;
    if (importance === 1 && !HANGUL.test(title)) {
      warnings.push(`stories[${n}]: 참고 기사 제목에 한글이 없음("${title.slice(0, 30)}") — 싣지 않음`);
      return;
    }
    const summary = stripMeta(s.summary);
    // 발췌가 있고 받을 수 있는 주소(Google 아님)인 기사를 대표로 — 서버 selectOne과 같은 점수. 세션이 Google 링크를 대표로 고르면
    // 원문을 읽을 수 없어 참고로 내려갔다(11/1 14:35 회차에서 핵심·주요 16건 중 7건). 같은 사건의 피드 기사가 있으면 그쪽이 대표가 된다
    const pool = [main, ...related];
    const score = (c: Candidate) => (c.snippet ? 2 : 0) + (isAggregator(c.source) ? 0 : 1) + (isDirectUrl(c.url) ? 2 : 0) + (c.feedText ? 1 : 0);
    const lead = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
    picked.push({
      sub: subOrThrow(s.subId, `stories[${n}]`),
      main: lead,
      related: pool.filter((c) => c !== lead),
      importance,
      prevStoryId: s.prevStoryId && prevIds.has(s.prevStoryId) ? s.prevStoryId : null,
      brief: importance === 1 ? { title, summary, why: stripMeta(s.why) === s.why.trim() ? s.why.trim() : '' } : null,
    });
  });
  return { picked, warnings };
}

/** 서버가 읽은 재료(API-156 응답) — 기사는 대표 후보의 전역 번호(main)로 가리킨다. 세션은 같은 selected.json으로 다시 만든 Picked에 main으로 맞춘다 */
export const MaterialsResponseSchema = z.object({
  stats: z.object({ bodiesRead: z.number(), fromFeed: z.number(), extractRejected: z.number() }),
  stories: z.array(
    z.object({
      main: z.number(),
      materials: z.array(z.object({ id: z.string(), source: z.string(), url: z.string(), title: z.string(), text: z.string(), via: z.enum(['body', 'feed', 'web']) })),
    }),
  ),
  warnings: z.array(z.string()).default([]),
});
export type MaterialsResponse = z.infer<typeof MaterialsResponseSchema>;
