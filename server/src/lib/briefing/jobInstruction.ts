import { BRIEFING } from '../../constants.js';
import { checkDomainsOf } from './jobDomains.js';
import type { Slot } from './edition.js';
import type { SourcesDoc } from './sourcesDoc.js';
import { SUBS, subPath } from './taxonomy.js';
import { kstParts } from './time.js';

// 지시서(API-151 응답) — 예약 작업이 일할 재료 전부. 서버가 아는 것은 서버가 채운다(날짜·범위·직전 회차 연결은 AI에게 맡기지 않는다).
// 순수 함수라 서버(subscription.ts)와 시험용 명령(briefing-job instruction)이 같은 모양을 만든다 (뉴스 브리핑 설계 "지시서")

export type PrevStoryRef = { subId: string; storyId: string; title: string; summary: string };

export type Instruction = {
  kind: 'edition';
  jobId: string;
  slot: Slot;
  /** 회차 이름(타이머 이름 또는 시각) — 세션이 보고 글에 쓴다. 저장은 서버가 한다 (v0.52) */
  label: string | null;
  editionDate: string;
  since: number;
  until: number;
  deadline: number;
  wrapUpBefore: number;
  sources: SourcesDoc;
  allowedDomains: string[];
  excludeUrls: string[];
  prevStories: PrevStoryRef[];
  generator: { config: string };
  taxonomy: { id: string; path: string; max: number }[];
  limits: { titleMaxChars: number; blocksMax: number; relatedMax: number; resultMaxBytes: number; resendMax: number; itemsMax: number };
};

export function buildInstruction(args: { jobId: string; slot: Slot; label?: string | null; since: number; until: number; deadline: number; doc: SourcesDoc; excludeUrls: Iterable<string>; prevStories: PrevStoryRef[]; config: string }): Instruction {
  return {
    kind: 'edition',
    jobId: args.jobId,
    slot: args.slot,
    label: args.label ?? null,
    editionDate: kstParts(args.until).date,
    since: args.since,
    until: args.until,
    deadline: args.deadline,
    wrapUpBefore: BRIEFING.SUB_WRAPUP_BEFORE_MS,
    sources: args.doc,
    allowedDomains: checkDomainsOf(args.doc),
    excludeUrls: [...args.excludeUrls],
    prevStories: args.prevStories.slice(0, BRIEFING.SUB_PREV_STORIES_MAX),
    generator: { config: args.config },
    taxonomy: SUBS.map((s) => ({ id: s.id, path: subPath(s), max: s.wide ? BRIEFING.MAX_ITEMS_WIDE : BRIEFING.MAX_ITEMS_NARROW })),
    limits: { titleMaxChars: BRIEFING.TITLE_MAX_CHARS, blocksMax: BRIEFING.BLOCKS_MAX, relatedMax: BRIEFING.MAX_RELATED, resultMaxBytes: BRIEFING.SUB_RESULT_MAX_BYTES, resendMax: BRIEFING.SUB_RESEND_MAX, itemsMax: BRIEFING.SUB_ITEMS_MAX },
  };
}
