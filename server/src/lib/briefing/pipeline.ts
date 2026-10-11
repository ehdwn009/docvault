import { BRIEFING } from '../../constants.js';
import { emptyUsage, type AiCaller, type Usage, type WebCaller } from './ai.js';
import { readBodies, type Material } from './body.js';
import { classify } from './classify.js';
import { collect, type Candidate } from './collect.js';
import { assembleEdition, readPrevious, type Edition, type Slot } from './edition.js';
import { needsDemotion, writeFallbacks } from './fallback.js';
import { writeLenses } from './lenses.js';
import { mergeSameStories } from './merge.js';
import { select } from './select.js';
import { loadSources } from './sources.js';
import { summarize } from './summarize.js';
import type { BriefingSub } from './taxonomy.js';
import { allowedDomainsOf, webFill } from './webfill.js';

// 회차 하나를 만드는 순서 — 수집 → 분류 → 선별 → 합치기 → 원문 읽기 → 웹 검색 보강 → 요약 → 보기 쓰기 → 조립.
// 저장과 실행 기록은 run.ts가 한다 (뉴스 브리핑 설계 "만드는 과정", 개선 합의안 2026-10-11).
// 실패는 이유를 담아 던지고, 어느 단계에서 실패하든 파일은 생기지 않는다

export type Stage = 'collect' | 'classify' | 'select' | 'read' | 'fill' | 'summarize' | 'lens' | 'save';

export type PipelineProgress = {
  onStage: (stage: Stage, done: number, total: number) => void;
  /** 수집이 끝나면 한 번 — 실행 기록에 출처 수·실패 출처·후보 수를 먼저 적어 둔다 */
  onCollected?: (info: { sourceCount: number; failed: { name: string; reason: string }[]; candidateCount: number }) => void;
  /** 진행 기록 한 줄 — 화면의 [진행 기록]에 쌓인다 (설계 "실행 관리 — 진행 기록") */
  log?: (text: string) => void;
  /** 바깥에서 받는 일(피드·원문) 하나의 시작. 돌려받은 함수로 끝을 알린다 — 오래 걸리면 "기다리는 중"으로 보인다 */
  track?: (name: string) => () => void;
};

export type PipelineResult =
  | { kind: 'ok'; edition: Edition; usage: Usage }
  | { kind: 'empty'; usage: Usage; message: string };

/** 실패 — message는 화면에 그대로 보인다. usage는 실패 전까지 쓴 만큼(돈은 이미 나갔다) */
export class BriefingFailure extends Error {
  constructor(message: string, readonly usage: Usage) {
    super(message);
  }
}

export async function generateEdition(args: {
  ownerId: number;
  slot: Slot;
  since: number;
  until: number;
  prevFileId: number | null;
  ai: AiCaller;
  /** 웹 검색 보강(S8). 없으면 보강을 건너뛴다(키 없는 시험 실행) */
  web?: WebCaller;
  signal?: AbortSignal;
  progress: PipelineProgress;
}): Promise<PipelineResult> {
  const usage = emptyUsage();
  const { progress, signal } = args;
  try {
    // ① 수집
    const log = (text: string) => progress.log?.(text);
    progress.onStage('collect', 0, 0);
    const { sources } = loadSources(args.ownerId);
    if (sources.length === 0) throw new Error('수집 목록이 비어 있습니다');
    log(`수집 시작 — 출처 ${sources.length}곳`);
    const prev = readPrevious(args.prevFileId);
    const got = await collect(sources, {
      since: args.since,
      until: args.until,
      excludeUrls: prev.urls,
      signal,
      onProgress: (d, t) => progress.onStage('collect', d, t),
      track: progress.track,
    });
    log(
      `수집 끝 — 후보 ${got.candidates.length}건${got.attached ? `, Google 기사 ${got.attached}건을 직접 기사에 붙임` : ''}${got.failed.length ? `, 못 받은 출처 ${got.failed.length}곳(${got.failed.slice(0, 3).map((f) => f.name).join(', ')}${got.failed.length > 3 ? ' 외' : ''})` : ''}`,
    );
    progress.onCollected?.({ sourceCount: got.sourceCount, failed: got.failed, candidateCount: got.candidates.length });
    const okCount = got.sourceCount - got.failed.length;
    // 망가진 수집으로 만든 회차는 직전 회차보다 나쁘다
    if (okCount < got.sourceCount * BRIEFING.MIN_SOURCE_OK_RATIO) {
      throw new Error(`출처 ${got.sourceCount}곳 중 ${got.failed.length}곳을 받지 못했습니다`);
    }
    if (got.candidates.length === 0) return { kind: 'empty', usage, message: '새 기사가 없어요' };

    // ② 분류
    const classified = await classify(got.candidates, args.ai, usage, { signal, onProgress: (d, t) => progress.onStage('classify', d, t) });
    const bySub = new Map<BriefingSub, Candidate[]>();
    for (const c of classified) if (c.sub) bySub.set(c.sub, [...(bySub.get(c.sub) ?? []), c]);
    if (bySub.size === 0) return { kind: 'empty', usage, message: '브리핑에 실을 기사가 없어요' };
    log(`분류 끝 — ${classified.length}건이 ${bySub.size}개 분야로`);

    // ③ 선별
    const selected = await select(bySub, prev.storiesBySub, args.ai, usage, {
      since: args.since,
      until: args.until,
      signal,
      onProgress: (d, t) => progress.onStage('select', d, t),
    });

    // ③-2 분야를 넘는 같은 사건을 하나로 — 분야별 선별은 서로를 못 본다 (설계 "③-2"). 진행 표시는 선별에 포함
    const picked = await mergeSameStories(selected, args.ai, usage, signal);
    log(`선별 끝 — ${picked.length}건${selected.length > picked.length ? ` (같은 사건 ${selected.length - picked.length}건 합침)` : ''}`);

    // ③-1 핵심·주요 기사의 재료 — 피드 본문·원문(핵심 3곳, 주요 2곳). 실패한 기사는 발췌로 돌아간다 (설계 "③-1", 합의안 S7)
    const read = await readBodies(picked, { signal, onProgress: (d, t) => progress.onStage('read', d, t), track: progress.track });
    const readTargets = picked.filter((p) => p.importance >= BRIEFING.BODY_FETCH_MIN_IMPORTANCE).length;
    const materials: Map<number, Material[]> = read.materials;
    log(`원문 읽기 끝 — ${readTargets}건 중 ${materials.size}건${read.fromFeed ? ` (피드 본문 ${read.fromFeed})` : ''}${read.rejected ? `, 제목과 안 맞아 버림 ${read.rejected}` : ''}`);

    // ③-3 웹 검색 보강 — 그래도 제목뿐인 핵심·주요만 (합의안 S8)
    let webFilled = 0;
    if (args.web) {
      const fill = await webFill(picked, materials, allowedDomainsOf(sources), args.web, usage, {
        since: args.since,
        until: args.until,
        signal,
        onProgress: (d, t) => progress.onStage('fill', d, t),
      });
      for (const [i, m] of fill.filled) materials.set(i, m);
      webFilled = fill.filled.size;
      if (fill.tried > 0) log(`웹 검색 보강 끝 — 제목뿐인 ${fill.tried}건 중 ${webFilled}건 채움`);
    }

    // 재료 보장 — 그래도 재료가 없는 핵심·주요는 참고로 내린다 (S0)
    const demoteIdx = picked.map((p, i) => i).filter((i) => needsDemotion(picked[i]!, materials.get(i)));
    const keptIdx = picked.map((p, i) => i).filter((i) => !demoteIdx.includes(i));
    const demoted = await writeFallbacks(picked, demoteIdx, args.ai, usage, signal);
    if (demoteIdx.length > 0) log(`재료 없는 핵심·주요 ${demoteIdx.length}건을 참고로 내림`);

    // ④ 요약 — 재료가 있는 핵심·주요만
    const forSummary = picked.map((p, i) => (keptIdx.includes(i) ? p : { ...p, importance: 1 as const }));
    const written = await summarize(forSummary, materials, args.ai, usage, {
      prevSummaries: prev.summaries,
      signal,
      onProgress: (d, t) => progress.onStage('summarize', d, t),
    });
    log(`요약 끝 — ${written.size}건`);

    // ④-2 요약 보기(글머리표·쉽게·5W) — 우리 요약만 재료로 Haiku가 다시 쓴다 (합의안 4.7)
    const lens = await writeLenses(written, args.ai, usage, { signal, onProgress: (d, t) => progress.onStage('lens', d, t) });
    log(`요약 보기 끝 — ${lens.lenses.size}건`);

    const edition = assembleEdition({
      picked,
      written,
      materials,
      lenses: lens.lenses,
      demoted,
      slot: args.slot,
      since: args.since,
      until: args.until,
      createdAt: Date.now(),
      stats: {
        sources: got.sourceCount,
        sourcesFailed: got.failed.length,
        candidates: got.candidates.length,
        attached: got.attached,
        bodiesRead: materials.size,
        fromFeed: read.fromFeed,
        extractRejected: read.rejected,
        webFilled,
        lensDrops: lens.dropped,
      },
      usage,
    });
    if (edition.stats.items === 0) return { kind: 'empty', usage, message: '브리핑에 실을 기사가 없어요' };
    return { kind: 'ok', edition, usage };
  } catch (e) {
    const msg = signal?.aborted ? '시간 안에 끝나지 않아 멈췄어요' : e instanceof Error ? e.message : String(e);
    throw new BriefingFailure(msg, usage);
  }
}
