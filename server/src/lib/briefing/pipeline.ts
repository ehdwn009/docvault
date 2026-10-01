import { BRIEFING } from '../../constants.js';
import { emptyUsage, type AiCaller, type Usage } from './ai.js';
import { readBodies } from './body.js';
import { classify } from './classify.js';
import { collect, type Candidate } from './collect.js';
import { assembleEdition, readPrevious, type Edition, type Slot } from './edition.js';
import { mergeSameStories } from './merge.js';
import { select, type Picked } from './select.js';
import { loadSources } from './sources.js';
import { summarize } from './summarize.js';
import type { BriefingSub } from './taxonomy.js';

// 회차 하나를 만드는 순서 — 수집 → 분류 → 선별 → 합치기 → 원문 읽기 → 요약 → 조립. 저장과 실행 기록은 run.ts가 한다
// (뉴스 브리핑 설계 "만드는 과정"). 실패는 이유를 담아 던지고, 어느 단계에서 실패하든 파일은 생기지 않는다

export type Stage = 'collect' | 'classify' | 'select' | 'read' | 'summarize' | 'save';

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
    log(`수집 끝 — 후보 ${got.candidates.length}건${got.roundups ? ` (모음 기사 ${got.roundups}건 뺌)` : ''}${got.failed.length ? `, 못 받은 출처 ${got.failed.length}곳(${got.failed.slice(0, 3).map((f) => f.name).join(', ')}${got.failed.length > 3 ? ' 외' : ''})` : ''}`);
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
    const merged = await mergeSameStories(selected, args.ai, usage, signal);
    log(`선별 끝 — ${merged.length}건${selected.length > merged.length ? ` (같은 사건 ${selected.length - merged.length}건 합침)` : ''}`);

    // ③-1 핵심·주요 기사 원문 앞부분 읽기 — 실패한 기사는 발췌로 돌아간다 (설계 "③-1 근거 보강")
    const read = await readBodies(merged, { signal, onProgress: (d, t) => progress.onStage('read', d, t), track: progress.track });
    const readTargets = merged.filter((p) => p.importance >= BRIEFING.BODY_FETCH_MIN_IMPORTANCE).length;
    log(`원문 읽기 끝 — ${readTargets}건 중 ${read.bodies.size}건${read.roundups.size ? ` (모음 기사 ${read.roundups.size}건 뺌)` : ''}`);
    // 열어 보니 모음 기사였던 것은 싣지 않는다 — 본문 열쇠(picked 위치)를 남은 기사 기준으로 다시 붙인다 (roundup.ts ③)
    const picked: Picked[] = [];
    const bodies = new Map<number, string>();
    merged.forEach((p, i) => {
      if (read.roundups.has(i)) return;
      const body = read.bodies.get(i);
      if (body !== undefined) bodies.set(picked.length, body);
      picked.push(p);
    });

    // ④ 요약
    const written = await summarize(picked, bodies, args.ai, usage, { signal, onProgress: (d, t) => progress.onStage('summarize', d, t) });
    log(`요약 끝 — ${written.size}건`);

    const edition = assembleEdition({
      picked,
      written,
      bodies,
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
