import { z } from 'zod/v4';
import { BRIEFING } from '../../constants.js';
import { checkUrl } from './jobDomains.js';

// 완성본(API-153 본문)의 모양과 기사 단위 검사 — DB를 모르는 순수 부분. 서버(subscription.ts)와 세션의 미리 검사(briefing-job verify)가
// 같은 코드로 본다 (뉴스 브리핑 설계 "구독 생성 방식 — 서버가 받는 쪽"). 기사 하나가 틀리면 그 기사만 빼고, 너무 많이 빠지면 통째로 거절한다

const short = (max: number) => z.string().max(max);
const srcList = z.array(z.string().max(8)).max(8);

const BlockSchema = z.object({
  kind: z.enum(['background', 'numbers', 'timeline', 'reactions', 'next', 'terms']),
  text: short(BRIEFING.SUB_TEXT_MAX_CHARS).optional(),
  pairs: z.array(z.object({ label: short(40), value: short(60) })).max(4).optional(),
  items: z.array(z.object({ date: short(40), text: short(200) })).max(5).optional(),
  from: srcList,
});

const ExplainSchema = z.object({
  kind: z.enum(['terms', 'why', 'effect', 'watch']),
  text: short(BRIEFING.EXPLAIN_TEXT_MAX_CHARS).optional(),
  items: z.array(z.object({ term: short(BRIEFING.EXPLAIN_TERM_MAX_CHARS), text: short(BRIEFING.EXPLAIN_TERM_TEXT_MAX_CHARS) })).max(BRIEFING.EXPLAIN_TERMS_MAX).optional(),
  from: srcList,
  basis: z.enum(['stated', 'inferred', 'outside']),
});

const W5Field = z.object({ text: short(BRIEFING.W5_TEXT_MAX_CHARS), from: srcList });

export const ResultItemSchema = z.object({
  subId: z.string().max(40),
  title: short(BRIEFING.SUB_TITLE_MAX_CHARS),
  summary: short(BRIEFING.SUB_TEXT_MAX_CHARS),
  why: short(BRIEFING.SUB_TEXT_MAX_CHARS),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  source: short(80),
  url: z.string().max(BRIEFING.SUB_URL_MAX_CHARS),
  publishedAt: z.number(),
  originalTitle: short(300),
  prevStoryId: z.string().max(120).nullable(),
  related: z.array(z.object({ source: short(80), url: z.string().max(BRIEFING.SUB_URL_MAX_CHARS) })).max(BRIEFING.SUB_RELATED_MAX_IN),
  basis: z.enum(['body', 'lede', 'title', 'web']),
  sources: z.array(z.object({ id: short(8), source: short(80), url: z.string().max(BRIEFING.SUB_URL_MAX_CHARS), via: z.enum(['body', 'feed', 'lede', 'web']) })).max(12),
  summaryFrom: srcList,
  whyFrom: srcList,
  blocks: z.array(BlockSchema).max(BRIEFING.BLOCKS_MAX),
  sides: z.object({ kind: z.enum(['dispute', 'emphasis']), items: z.array(z.object({ label: short(40), text: short(300), from: short(8) })).max(BRIEFING.ANGLES_MAX) }).nullable(),
  lenses: z.object({ bullets: z.array(short(200)).max(5) }).nullable(),
  w5: z.object({ who: W5Field.optional(), what: W5Field.optional(), when: W5Field.optional(), where: W5Field.optional(), why: W5Field.optional() }).nullable(),
  impact: z.array(z.object({ target: short(BRIEFING.IMPACT_TARGET_MAX_CHARS), direction: z.enum(['up', 'down', 'mixed', 'unclear']), kind: z.enum(['stated', 'inferred']), text: short(BRIEFING.IMPACT_TEXT_MAX_CHARS), from: short(8) })).max(BRIEFING.IMPACT_MAX_CORE).nullable(),
  explain: z.array(ExplainSchema).max(4).nullable(),
  readUrl: z.string().max(BRIEFING.SUB_URL_MAX_CHARS).nullable(),
  changed: short(300).nullable(),
  titleOnly: z.boolean(),
});
export type ResultItem = z.infer<typeof ResultItemSchema>;

export const ResultStatsSchema = z.object({
  sources: z.number().int().min(0),
  sourcesFailed: z.number().int().min(0),
  failedSources: z.array(z.string().max(80)).max(200).default([]),
  candidates: z.number().int().min(0),
  attached: z.number().int().min(0).default(0),
  bodiesRead: z.number().int().min(0).default(0),
  fromFeed: z.number().int().min(0).default(0),
  extractRejected: z.number().int().min(0).default(0),
  webFilled: z.number().int().min(0).default(0),
  lensDrops: z.number().int().min(0).default(0),
  numberDrops: z.number().int().min(0).default(0),
  wouldMerge: z.number().int().min(0).default(0),
  demoted: z.number().int().min(0).default(0),
  overruns: z.number().int().min(0).default(0),
  impactDrops: z.number().int().min(0).default(0),
  explainDrops: z.number().int().min(0).default(0),
  titleMismatch: z.number().int().min(0).default(0),
});

export const ResultSchema = z.object({
  generator: z.object({
    mode: z.literal('subscription'),
    config: z.string().max(20).optional(),
    models: z.array(z.string().max(60)).max(6).optional(),
    skillVersion: z.string().max(20).optional(),
  }),
  items: z.array(ResultItemSchema).max(BRIEFING.SUB_ITEMS_MAX),
  stats: ResultStatsSchema,
  /** 진행 기록 — 줄 길이는 받는 쪽이 SUB_PROGRESS_MAX_CHARS로 자른다(기사 내용이 아니라 긴 줄 하나로 통째를 거절하지 않는다). 구성 B 시험에서 240자 줄이 있었다 */
  log: z.array(z.string().max(BRIEFING.SUB_TEXT_MAX_CHARS)).max(BRIEFING.SUB_LOG_MAX_LINES).default([]),
});
export type JobResult = z.infer<typeof ResultSchema>;

export type DropReason = 'domain' | 'scheme' | 'userinfo' | 'port' | 'invalid' | 'duplicate' | 'range' | 'subId';

/**
 * 기사 단위 검사 — 주소는 모든 주소 칸(url·related·readUrl·sources)을 허용 도메인으로, 발행 시각은 범위 안으로, 직전 회차와 겹치는 주소는 뺀다.
 * readUrl은 나중에 서버가 직접 받는 주소라 이 검사가 SSRF 방어선이다. 뺀 이유별 수는 실행 기록(dropped_items)에 남는다
 */
export function checkItems(
  items: ResultItem[],
  ctx: { allowedDomains: readonly string[]; excludeUrls: ReadonlySet<string>; since: number; until: number; knownSubIds: ReadonlySet<string> },
): { kept: ResultItem[]; dropped: Record<string, number>; reasons: { index: number; reason: DropReason; detail: string }[] } {
  const kept: ResultItem[] = [];
  const dropped: Record<string, number> = {};
  const reasons: { index: number; reason: DropReason; detail: string }[] = [];
  const drop = (index: number, reason: DropReason, detail: string) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
    reasons.push({ index, reason, detail });
  };
  const slack = BRIEFING.WEB_FILL_DATE_SLACK_MS;
  items.forEach((it, index) => {
    if (!ctx.knownSubIds.has(it.subId)) return drop(index, 'subId', it.subId);
    if (ctx.excludeUrls.has(it.url)) return drop(index, 'duplicate', it.url);
    // 발행 시각이 범위를 크게 벗어난 기사는 다른 날의 기사다 — 웹 보강과 같은 여유(±24시간)
    if (it.publishedAt < ctx.since - slack || it.publishedAt > ctx.until + slack) return drop(index, 'range', new Date(it.publishedAt).toISOString());
    const urls = [it.url, ...it.related.map((r) => r.url), ...it.sources.map((s) => s.url), ...(it.readUrl ? [it.readUrl] : [])];
    for (const u of urls) {
      const r = checkUrl(u, ctx.allowedDomains);
      if (!r.ok) return drop(index, r.reason, u);
    }
    kept.push(it);
  });
  return { kept, dropped, reasons };
}

/** 뺀 기사가 전체의 SUB_DROP_REJECT_RATIO를 넘으면 회차가 아니다 — 통째로 거절 */
export function tooManyDropped(total: number, keptCount: number): boolean {
  return total > 0 && (total - keptCount) / total > BRIEFING.SUB_DROP_REJECT_RATIO;
}
