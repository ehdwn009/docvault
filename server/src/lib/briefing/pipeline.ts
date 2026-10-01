import { BRIEFING } from '../../constants.js';
import { emptyUsage, type AiCaller, type Usage } from './ai.js';
import { classify } from './classify.js';
import { collect, type Candidate } from './collect.js';
import { assembleEdition, readPrevious, type Edition, type Slot } from './edition.js';
import { select } from './select.js';
import { loadSources } from './sources.js';
import { summarize } from './summarize.js';
import type { BriefingSub } from './taxonomy.js';

// 회차 하나를 만드는 순서 — 수집 → 분류 → 선별 → 요약 → 조립. 저장과 실행 기록은 run.ts가 한다
// (뉴스 브리핑 설계 "만드는 과정"). 실패는 이유를 담아 던지고, 어느 단계에서 실패하든 파일은 생기지 않는다

export type Stage = 'collect' | 'classify' | 'select' | 'summarize' | 'save';

export type PipelineProgress = {
  onStage: (stage: Stage, done: number, total: number) => void;
  /** 수집이 끝나면 한 번 — 실행 기록에 출처 수·실패 출처·후보 수를 먼저 적어 둔다 */
  onCollected?: (info: { sourceCount: number; failed: { name: string; reason: string }[]; candidateCount: number }) => void;
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
  signal?: AbortSignal;
  progress: PipelineProgress;
}): Promise<PipelineResult> {
  const usage = emptyUsage();
  const { progress, signal } = args;
  try {
    // ① 수집
    progress.onStage('collect', 0, 0);
    const { sources } = loadSources(args.ownerId);
    if (sources.length === 0) throw new Error('수집 목록이 비어 있습니다');
    const prev = readPrevious(args.prevFileId);
    const got = await collect(sources, {
      since: args.since,
      until: args.until,
      excludeUrls: prev.urls,
      signal,
      onProgress: (d, t) => progress.onStage('collect', d, t),
    });
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

    // ③ 선별
    const picked = await select(bySub, prev.storiesBySub, args.ai, usage, { signal, onProgress: (d, t) => progress.onStage('select', d, t) });

    // ④ 요약
    const written = await summarize(picked, args.ai, usage, { signal, onProgress: (d, t) => progress.onStage('summarize', d, t) });

    const edition = assembleEdition({
      picked,
      written,
      slot: args.slot,
      since: args.since,
      until: args.until,
      createdAt: Date.now(),
      stats: { sources: got.sourceCount, sourcesFailed: got.failed.length, candidates: got.candidates.length },
      usage,
    });
    if (edition.stats.items === 0) return { kind: 'empty', usage, message: '브리핑에 실을 기사가 없어요' };
    return { kind: 'ok', edition, usage };
  } catch (e) {
    const msg = signal?.aborted ? '시간 안에 끝나지 않아 멈췄어요' : e instanceof Error ? e.message : String(e);
    throw new BriefingFailure(msg, usage);
  }
}
