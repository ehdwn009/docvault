import { and, eq, isNull } from 'drizzle-orm';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { files } from '../../db/schema.js';
import type { DbOrTx } from '../content.js';
import { basisOf, type Material } from './body.js';
import { isAggregator, numberSet } from './collect.js';
import { costOf, type Usage } from './ai.js';
import { uniqueFileName } from '../naming.js';
import type { PrevStory, Picked } from './select.js';
import type { Demoted } from './fallback.js';
import type { Lenses } from './lenses.js';
import { evidenceOf, type Block, type ExplainBlock, type ImpactLine, type Sides, type W5, type Written } from './summarize.js';
import { categoriesOf, SECTIONS, SUBS, type BriefingSection } from './taxonomy.js';
import { kstParts } from './time.js';

// 회차 JSON — 회차 하나 = 문서 하나의 본문 (뉴스 브리핑 설계 "회차 JSON (version 1)").
// 저장하는 것은 새로 쓴 제목·요약·의미, 언론사 이름, 원문 링크뿐이다. RSS 발췌는 여기 들어오지 않는다

export type Slot = 'morning' | 'noon' | 'evening' | 'adhoc';

/** v0.43의 고정 4칸 — 옛 회차에만 남아 있다. 화면은 blocks → detail → summary 순으로 찾아 그린다 */
export type Detail = { background: string; numbers: string; next: string };

export type EditionItem = {
  id: string;
  title: string;
  /** 리드(무슨 일). 참고는 한 문장. 제목뿐인 참고(titleOnly)는 빈 문자열 */
  summary: string;
  why: string;
  importance: 1 | 2 | 3;
  source: string;
  url: string;
  publishedAt: number;
  storyId: string;
  status: 'new' | 'updated';
  related: { source: string; url: string }[];
  /** 요약의 근거 — body(원문·피드 본문) · lede(발췌) · title(제목뿐) · web(웹 검색으로 찾은 보도, v0.45). v0.43부터, 옛 회차에는 없다 */
  basis?: 'body' | 'lede' | 'title' | 'web';
  /** 이 사건을 다룬 서로 다른 언론사 수(대표 포함, 상한 없음) — 오늘의 핵심 순위에 쓴다. v0.43부터, 없으면 related 수 + 1 */
  outlets?: number;
  /** v0.43의 펼침 칸 — v0.45부터는 쓰지 않고 blocks로 쓴다. 옛 회차용 */
  detail?: Detail;
  // ---- v0.45 (개선 합의안 5.1) — 모두 없어도 되는 칸. 형식 버전은 그대로 1 ----
  /** 대표 기사의 원 제목 — 원문 카드의 글자. AI 제목이 과장됐는지 견주는 기준 */
  originalTitle?: string;
  /** 실제로 읽은 재료 — 본문(A·B·C), 발췌(S1·S2), 웹 검색 보도(W1·W2). 칸의 from이 가리키는 기호 */
  sources?: { id: string; source: string; url: string; via: 'body' | 'feed' | 'lede' | 'web' }[];
  summaryFrom?: string[];
  whyFrom?: string[];
  /** 골라 쓴 칸 0~3개 — 재료가 있는 것만 */
  blocks?: Block[];
  /** 양쪽 시각 — 쟁점(dispute)이나 언론사마다 다른 강조(emphasis). 핵심·재료 2곳 이상일 때만 */
  sides?: Sides;
  /** 요약 보기 — 글머리표. 우리 요약을 Haiku가 다시 쓴 것 (v0.45의 쉽게·5W는 옛 회차에만 남아 있다) */
  lenses?: Lenses;
  // ---- v0.46 (영향 칸 토론·수집 재설계 토론 2026-10-11) ----
  /** 5W — 원문을 읽은 요약 호출이 쓴 것, 칸마다 근거 기호. 없는 칸은 없다(화면이 "기사에 없음") */
  w5?: W5;
  /** 영향 — 누구에게 어떤 영향인지, 경제·테크 핵심 2줄·주요 1줄. stated만 낱말이 붙고 inferred는 "AI 추론" */
  impact?: ImpactLine[];
  // ---- v0.48 (해설 칸 토론 2026-10-15) ----
  /** 해설 상자 — 말뜻·왜 이렇게 됐나·그래서 어떻게 되나·다음에 볼 것. 칸마다 basis(stated·inferred·outside). 핵심·주요만, 칸이 없으면 없다 */
  explain?: ExplainBlock[];
  /** 앱 안 원문으로 받을 주소 — 회차를 만들 때 본문 받기에 성공한 언론사 주소(본문이 아니라 주소). 없으면 사이트로 보낸다 */
  readUrl?: string;
  /** 갱신된 이슈 — 직전 회차 이후 바뀐 점 한 줄 */
  changed?: string;
  /** 재료가 없어 제목만 실은 참고 — AI 문장 없음. 화면은 펼치지 않고 바로 원문으로 */
  titleOnly?: boolean;
};

export type Edition = {
  version: number;
  edition: {
    date: string;
    slot: Slot;
    label: string;
    since: number;
    until: number;
    createdAt: number;
    /** 구독 생성 방식으로 만든 회차 — 누가 만들었나 (v0.50). API 방식 회차에는 없다 */
    generator?: { mode: 'subscription'; config?: string; models?: string[]; skillVersion?: string };
  };
  stats: {
    sources: number;
    sourcesFailed: number;
    candidates: number;
    items: number;
    /** v0.45 건강 숫자 — 근거 분포, 읽은 본문·검증·보강의 결과. "요약 없음 0건"을 회차마다 숫자로 확인한다 */
    basis?: { body: number; lede: number; title: number; web: number };
    bodiesRead?: number;
    fromFeed?: number;
    extractRejected?: number;
    attached?: number;
    webFilled?: number;
    numberDrops?: number;
    lensDrops?: number;
    demoted?: number;
    overruns?: number;
    // ---- v0.46 실측 칸 (수집 재설계 토론) — 2주 10회차의 기준선. 되돌림 기준은 설계 문서 "④-3·실측" ----
    /** 영향 줄 수(stated·inferred)와 검증에서 지운 줄 수 */
    impact?: { stated: number; inferred: number; dropped: number };
    /** 해설(v0.48) — 상자가 있는 기사 수, 기사 밖 지식 칸 수, 검증에서 지운 칸 수 */
    explain?: { items: number; outside: number; dropped: number };
    /** 핵심 중 본문·웹 재료 2곳 이상 수 — 품질 병목 지표(목표 70% 이상) */
    coreDeep?: { deep: number; core: number };
    /** 실린 기사의 발행 시각 12칸 분포 — 빈 칸 수와 가장 큰 칸 비율(최신 쏠림 감시) */
    slotGaps?: { empty: number; maxShare: number };
    /** 세계 비율 — 실린 기사 중 세계, 오늘의 핵심 중 세계 */
    worldShare?: { items: number; lead: number };
    /** 기사가 0건인 세부 분야 수 (40개 중) */
    emptySubs?: number;
    /** 원 제목의 숫자와 AI 제목의 숫자가 다른 기사 수 — 과장·오기 감시 */
    titleMismatch?: number;
    /** 수집 단계 사건 묶기를 켰다면 묶였을 후보 수 */
    wouldMerge?: number;
    /** 단계별 비용 분해 (모델·호출 수·토큰·추정 비용) */
    byStage?: Record<string, { model: string; calls: number; input: number; output: number; webSearches: number; usd: number }>;
  };
  cost: { usd: number; haiku: { input: number; output: number }; sonnet: { input: number; output: number }; opus?: { input: number; output: number }; webSearches?: number };
  /** 영향 칸을 화면에 그리나 — IMPACT_MODE가 show일 때 true. 옛 회차(없음)는 그리지 않는다 */
  impactVisible?: boolean;
  /** 해설 상자를 그리나 — EXPLAIN_MODE가 show일 때 true (v0.48) */
  explainVisible?: boolean;
  /** 오늘의 핵심 기사 id (최대 LEAD_COUNT). v0.43부터, 옛 회차에는 없다 — 화면이 같은 규칙(leadIdsOf)으로 계산한다 */
  lead?: string[];
  sections: {
    section: BriefingSection;
    categories: { name: string; subs: { id: string; name: string; items: EditionItem[] }[] }[];
  }[];
};

const SLOT_LABEL: Record<Exclude<Slot, 'adhoc'>, string> = { morning: '아침', noon: '점심', evening: '저녁' };

/** 회차 이름표 — 정기판은 "저녁", 수시판은 만든 시각 "14시 23분" */
export function slotLabel(slot: Slot, createdAt: number): string {
  if (slot !== 'adhoc') return SLOT_LABEL[slot];
  const { hour, minute } = kstParts(createdAt);
  return `${hour}시 ${String(minute).padStart(2, '0')}분`;
}

/** 파일 이름 — 폴더 밖(검색 결과·탭·최근 열람)에서 이름만 보여도 무엇인지 알게 "뉴스 브리핑"을 다시 넣는다 */
export function editionFileName(date: string, label: string): string {
  return `${BRIEFING.FOLDER_NAME} ${date} ${label}.json`;
}

/** 조립에 넣는 기사 하나 — EditionItem에서 서버가 붙이는 칸(id·storyId·status)을 뺀 것. 어느 분야인지와 이어받은 이슈 id를 따로 든다 */
export type ItemDraft = { subId: string; prevStoryId: string | null; item: Omit<EditionItem, 'id' | 'storyId' | 'status'> };

/** 기사마다 Written을 보고 세는 검증 카운터 — 기존 파이프라인은 buildItem에서, 구독 경로는 완성본 stats에서 온다 (설계 "완성본") */
export type VerifyCounters = { numberDrops: number; demoted: number; overruns: number; impactDrops: number; explainDrops: number; titleMismatch: number };

export type EditionMeta = { slot: Slot; since: number; until: number; createdAt: number };

export function assembleEdition(args: {
  picked: Picked[];
  written: Map<number, Written>;
  materials: Map<number, Material[]>;
  lenses: Map<number, Lenses>;
  /** 재료가 없어 참고로 내린 핵심·주요 — 열쇠는 picked 위치 */
  demoted: Map<number, Demoted>;
  slot: Slot;
  since: number;
  until: number;
  createdAt: number;
  stats: { sources: number; sourcesFailed: number; candidates: number; attached: number; bodiesRead: number; fromFeed: number; extractRejected: number; webFilled: number; lensDrops: number; wouldMerge: number };
  usage: Usage;
}): Edition {
  const drafts: ItemDraft[] = [];
  const counters: VerifyCounters = { numberDrops: 0, demoted: 0, overruns: 0, impactDrops: 0, explainDrops: 0, titleMismatch: 0 };

  args.picked.forEach((p, i) => {
    const w = p.importance >= 2 ? args.written.get(i) : undefined;
    const fallback = p.importance >= 2 && !w?.summary ? args.demoted.get(i) : undefined;
    // 핵심·주요인데 리드를 못 받았으면 참고로 내리거나(재료 없음) 싣지 않는다 — 빈 요약을 내보내지 않는다 (S0)
    let importance: 1 | 2 | 3 = p.importance;
    let text: { title: string; summary: string; why: string } | null = null;
    if (w?.summary) {
      text = { title: w.title, summary: w.summary, why: w.why };
      // 왜 중요한가가 비면(근거 없음·일반론) 핵심 자격이 없다 — 주요로 (개선 합의안 4.4)
      if (importance === 3 && !w.why) importance = 2;
    } else if (fallback) {
      text = { title: fallback.title, summary: fallback.summary, why: '' };
      importance = 1;
      counters.demoted++;
    } else if (p.importance === 1 && p.brief) {
      text = p.brief;
    }
    if (!text) return;
    // 제목뿐인 참고 — AI 문장 없이 제목만 (재료 보장 규칙)
    const titleOnly = fallback ? fallback.titleOnly : importance === 1 && !text.summary;
    const others = otherOutlets(p);
    const materials = args.materials.get(i);
    const evidence = w ? evidenceOf(p, materials) : [];
    const readUrl = materials?.find((m) => m.via === 'body')?.url;
    if (w) {
      counters.numberDrops += w.numberDrops;
      if (w.overrun) counters.overruns++;
      counters.impactDrops += w.impactDrops;
      counters.explainDrops += w.explainDrops;
      // AI 제목에 원 제목에 없는 숫자가 들어오면 과장이거나 오기다 — 세기만 한다 (원 제목의 숫자를 덜 쓴 것은 괜찮다)
      const orig = numberSet(p.main.title);
      if (numberSet(w.title).some((n) => !orig.includes(n))) counters.titleMismatch++;
    }
    const lenses = args.lenses.get(i);
    drafts.push({
      subId: p.sub.id,
      prevStoryId: p.prevStoryId,
      item: {
        title: text.title,
        summary: text.summary,
        why: text.why,
        importance,
        source: p.main.source,
        url: p.main.url,
        publishedAt: p.main.publishedAt,
        basis: basisOf(p, materials),
        related: others.slice(0, BRIEFING.MAX_RELATED),
        outlets: 1 + others.length,
        originalTitle: p.main.title,
        ...(evidence.length ? { sources: evidence.map((e) => ({ id: e.id, source: e.source, url: e.url, via: e.via })) } : {}),
        ...(w ? { summaryFrom: w.summaryFrom, whyFrom: w.whyFrom, blocks: w.blocks } : {}),
        ...(w?.sides ? { sides: w.sides } : {}),
        ...(lenses ? { lenses } : {}),
        ...(w?.w5 ? { w5: w.w5 } : {}),
        ...(w?.impact ? { impact: w.impact } : {}),
        ...(w?.explain ? { explain: w.explain } : {}),
        ...(readUrl ? { readUrl } : {}),
        ...(w?.changed ? { changed: w.changed } : {}),
        ...(titleOnly ? { titleOnly: true } : {}),
      },
    });
  });

  return layoutEdition(drafts, { slot: args.slot, since: args.since, until: args.until, createdAt: args.createdAt }, args.stats, counters, {
    usd: costOf(args.usage),
    haiku: { input: args.usage.haikuInput, output: args.usage.haikuOutput },
    sonnet: { input: args.usage.sonnetInput, output: args.usage.sonnetOutput },
    opus: { input: args.usage.opusInput, output: args.usage.opusOutput },
    webSearches: args.usage.webSearches,
  }, args.usage.byStage);
}

/**
 * 기사 목록 → 회차 — id·storyId·status 붙이기, 분야 묶기, 오늘의 핵심, 건강 숫자 합산. 기사 칸만 보는 순수 코드라
 * 기존 파이프라인(위)과 구독 경로(subscription.ts — 세션이 보낸 완성본)가 같은 함수를 쓴다 (설계 "구독 생성 방식 — 완성본").
 * 기사에서 셀 수 있는 것(basis·impact 종류·해설 outside·coreDeep)은 여기서 세고, Written에서만 알 수 있는 것은 counters로 받는다
 */
export function layoutEdition(
  drafts: ItemDraft[],
  meta: EditionMeta,
  stats: { sources: number; sourcesFailed: number; candidates: number; attached: number; bodiesRead: number; fromFeed: number; extractRejected: number; webFilled: number; lensDrops: number; wouldMerge: number },
  counters: VerifyCounters,
  cost: Edition['cost'],
  byStage: Edition['stats']['byStage'],
  generator?: Edition['edition']['generator'],
): Edition {
  const { date } = kstParts(meta.createdAt);
  const counter = new Map<string, number>();
  const bySub = new Map<string, EditionItem[]>();
  const basisCount = { body: 0, lede: 0, title: 0, web: 0 };
  const impactCount = { stated: 0, inferred: 0, dropped: counters.impactDrops };
  const explainCount = { items: 0, outside: 0, dropped: counters.explainDrops };
  const coreDeep = { deep: 0, core: 0 };

  for (const d of drafts) {
    const n = (counter.get(d.subId) ?? 0) + 1;
    counter.set(d.subId, n);
    const item: EditionItem = {
      id: `${d.subId}.${String(n).padStart(3, '0')}`,
      // 이어받은 이슈는 직전 id 그대로 — 다음 회차·2차 이슈 타임라인이 같은 열쇠로 묶는다
      storyId: d.prevStoryId ?? `${d.subId}.${date}.${meta.slot}.${n}`,
      status: d.prevStoryId ? 'updated' : 'new',
      ...d.item,
    };
    if (item.basis) basisCount[item.basis]++;
    for (const line of item.impact ?? []) impactCount[line.kind]++;
    if (item.explain) {
      explainCount.items++;
      explainCount.outside += item.explain.filter((b) => b.basis === 'outside').length;
    }
    if (item.importance === 3 && item.summaryFrom) {
      coreDeep.core++;
      if ((item.sources ?? []).filter((e) => e.via !== 'lede').length >= 2) coreDeep.deep++;
    }
    bySub.set(d.subId, [...(bySub.get(d.subId) ?? []), item]);
  }


  let total = 0;
  const sections = SECTIONS.map((section) => ({
    section,
    categories: categoriesOf(section)
      .map((cat) => ({
        name: cat.name,
        subs: cat.subs
          .map((s) => ({
            id: s.id,
            name: s.name,
            // 중요한 것부터, 같은 중요도면 최신부터
            items: (bySub.get(s.id) ?? []).sort((a, b) => b.importance - a.importance || b.publishedAt - a.publishedAt),
          }))
          .filter((s) => s.items.length > 0),
      }))
      .filter((c) => c.subs.length > 0),
  })).filter((s) => s.categories.length > 0);
  const allItems: { it: EditionItem; world: boolean }[] = [];
  for (const s of sections) for (const c of s.categories) for (const sub of c.subs) for (const it of sub.items) allItems.push({ it, world: s.section === '세계' });
  total = allItems.length;
  const lead = leadIdsOf(sections);
  const leadSet = new Set(lead);

  return {
    version: BRIEFING.EDITION_VERSION,
    lead,
    edition: { date, slot: meta.slot, label: slotLabel(meta.slot, meta.createdAt), since: meta.since, until: meta.until, createdAt: meta.createdAt, ...(generator ? { generator } : {}) },
    stats: {
      ...stats,
      items: total,
      basis: basisCount,
      numberDrops: counters.numberDrops,
      demoted: counters.demoted,
      overruns: counters.overruns,
      impact: impactCount,
      explain: explainCount,
      coreDeep,
      slotGaps: slotGapsOf(allItems.map((x) => x.it.publishedAt), meta.since, meta.until),
      worldShare: { items: allItems.filter((x) => x.world).length, lead: allItems.filter((x) => x.world && leadSet.has(x.it.id)).length },
      emptySubs: SUBS.length - bySub.size,
      titleMismatch: counters.titleMismatch,
      ...(byStage ? { byStage } : {}),
    },
    cost,
    ...(BRIEFING.IMPACT_MODE === 'show' ? { impactVisible: true } : {}),
    ...(BRIEFING.EXPLAIN_MODE === 'show' ? { explainVisible: true } : {}),
    sections,
  };
}

/** 실린 기사의 발행 시각을 범위 12칸(SPREAD_SLOTS)에 놓았을 때 — 빈 칸 수와 가장 큰 칸의 비율. 최신 90분에 쏠리던 실패의 감시 지표 */
function slotGapsOf(times: number[], since: number, until: number): { empty: number; maxShare: number } {
  const n = BRIEFING.SPREAD_SLOTS;
  const counts = Array.from({ length: n }, () => 0);
  const width = Math.max(1, (until - since) / n);
  for (const t of times) counts[Math.min(n - 1, Math.max(0, Math.floor((until - t) / width)))]!++;
  const max = Math.max(0, ...counts);
  return { empty: counts.filter((c) => c === 0).length, maxShare: times.length ? Math.round((max / times.length) * 100) / 100 : 0 };
}

/** 다른 보도 — 언론사마다 하나만. 대표 기사의 언론사와 포털 재게재 주소는 뺀다.
    같은 언론사가 네 번 들어가 "외 5곳"이 실제 2곳이었고, 그 수로 오늘의 핵심 순위가 매겨졌다 (설계 "related", 사용성 평가 2026-10-01) */
function otherOutlets(p: Picked): { source: string; url: string }[] {
  const all = [...p.related.map((r) => ({ source: r.source, url: r.url })), ...p.related.flatMap((r) => r.related), ...p.main.related];
  const seen = new Set([p.main.source.trim().toLowerCase()]);
  const out: { source: string; url: string }[] = [];
  for (const r of all) {
    const key = r.source.trim().toLowerCase();
    if (r.url === p.main.url || isAggregator(r.source) || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** 오늘의 핵심 — 핵심(3) 기사를 다룬 언론사 수 많은 순, 같으면 최신순. 세계 핵심이 있으면 최소 LEAD_WORLD_MIN자리는 세계에 —
    영어 기사는 다른 보도가 거의 안 묶여 언론사 수로만 겨루면 구조적으로 밀린다(6건 모두 국내였다).
    AI를 부르지 않는다: 여러 언론이 다룬 사건일수록 큰 뉴스라는 신호다 (설계 "lead"). 클라이언트에도 같은 규칙이 있다(옛 회차용) */
export function leadIdsOf(sections: Edition['sections']): string[] {
  const top: { it: EditionItem; world: boolean }[] = [];
  for (const s of sections) for (const c of s.categories) for (const sub of c.subs) for (const it of sub.items) if (it.importance === 3) top.push({ it, world: s.section === '세계' });
  // 옛 회차(outlets 없음)는 related에서 서로 다른 언론사만 센다 — 옛 related에는 같은 언론사가 겹쳐 있다
  const outlets = (it: EditionItem) =>
    it.outlets ?? 1 + new Set((it.related ?? []).map((r) => r.source.trim().toLowerCase()).filter((src) => src !== it.source.trim().toLowerCase() && !isAggregator(src))).size;
  const ranked = top.sort((a, b) => outlets(b.it) - outlets(a.it) || b.it.publishedAt - a.it.publishedAt);
  const world = ranked.filter((x) => x.world).slice(0, BRIEFING.LEAD_WORLD_MIN);
  const rest = ranked.filter((x) => !world.includes(x)).slice(0, Math.max(0, BRIEFING.LEAD_COUNT - world.length));
  const chosen = new Set([...world, ...rest]);
  return ranked.filter((x) => chosen.has(x)).map((x) => x.it.id);
}

/** 직전 회차에서 다음 회차가 쓰는 것 — 분야별 이슈 목록(updated 판정)과 이미 실린 링크(중복 제외).
    문서를 지웠거나 깨졌으면 빈 값 — 범위는 실행 기록에서 계산하므로 흔들리지 않는다 */
export function readPrevious(fileId: number | null): { storiesBySub: Map<string, PrevStory[]>; urls: Set<string>; summaries: Map<string, string> } {
  const storiesBySub = new Map<string, PrevStory[]>();
  const urls = new Set<string>();
  /** storyId → 직전 요약 — "바뀐 점 한 줄"의 비교 대상 */
  const summaries = new Map<string, string>();
  if (fileId === null) return { storiesBySub, urls, summaries };
  const row = db.select({ contentText: files.contentText }).from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).get();
  if (!row?.contentText) return { storiesBySub, urls, summaries };
  try {
    const prev = JSON.parse(row.contentText) as Edition;
    for (const s of prev.sections ?? []) {
      for (const c of s.categories ?? []) {
        for (const sub of c.subs ?? []) {
          storiesBySub.set(sub.id, (sub.items ?? []).map((it) => ({ storyId: it.storyId, title: it.title, summary: it.summary ?? '' })));
          for (const it of sub.items ?? []) {
            if (it.summary) summaries.set(it.storyId, it.summary);
            urls.add(it.url);
            for (const r of it.related ?? []) urls.add(r.url);
          }
        }
      }
    }
  } catch {
    // 깨진 회차는 없는 것으로 친다
  }
  return { storiesBySub, urls, summaries };
}

/** 회차를 내 파일 최상위에 문서 하나로 저장한다 — 트리에는 안 나오고 브리핑 패널이 보관함이다(v0.43). 이름이 겹치면 (2).
    tx를 받는 이유: 실행 기록을 ok로 바꾸는 일과 한 트랜잭션이어야 한다 — 파일만 생기고 기록이 running으로 남으면 안 된다 */
export function saveEdition(tx: DbOrTx, ownerId: number, edition: Edition): { fileId: number; name: string } {
  const taken = new Set(
    tx
      .select({ name: files.name })
      .from(files)
      .where(and(eq(files.ownerId, ownerId), isNull(files.folderId), isNull(files.deletedAt)))
      .all()
      .map((r) => r.name),
  );
  const name = uniqueFileName(editionFileName(edition.edition.date, edition.edition.label), (n) => taken.has(n));
  const content = JSON.stringify(edition);
  const now = Date.now();
  const row = tx
    .insert(files)
    .values({
      ownerId,
      folderId: null,
      name,
      fileType: 'code',
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      contentText: content,
      storagePath: null,
      kind: 'briefing',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: files.id })
    .get();
  return { fileId: row.id, name };
}
