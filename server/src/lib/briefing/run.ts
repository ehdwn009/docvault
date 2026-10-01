import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { briefingRuns, files } from '../../db/schema.js';
import { callClaude, costOf, type AiCaller, type Usage } from './ai.js';
import { saveEdition, type Slot } from './edition.js';
import { abortLive, addLog, closeLive, liveView, openLive, track } from './live.js';
import { BriefingFailure, generateEdition, type Stage } from './pipeline.js';
import { kstMonthStart, kstParts } from './time.js';

// 실행 관리 — 한 번에 하나, 진행 상태, 실패 이유, 비용 기록 (뉴스 브리핑 설계 "실행 관리").
// 만드는 일은 응답을 기다리지 않고 뒤에서 돈다. 화면은 실행 기록(briefing_runs)을 읽어 진행을 보여 준다

type RunRow = typeof briefingRuns.$inferSelect;

/** 실행 기록에 남기는 실패 이유 길이 상한 — 화면 한두 줄 */
const MESSAGE_MAX = 200;

export class BriefingBusyError extends Error {
  constructor(readonly run: RunRow) {
    super('이미 만드는 중이에요');
  }
}
export class BriefingBudgetError extends Error {
  constructor(readonly monthCostUsd: number) {
    super(`이번 달 한도($${BRIEFING.MONTHLY_BUDGET_USD})를 넘었어요`);
  }
}

export function isConfigured(): boolean {
  return config.anthropicApiKey !== '';
}

export function runningRun(): RunRow | null {
  return db.select().from(briefingRuns).where(eq(briefingRuns.status, 'running')).orderBy(desc(briefingRuns.startedAt)).get() ?? null;
}

/** 이번 달(한국시간) 브리핑 추정 비용 합계 — 문서를 지워도 줄지 않는다(실행 기록에서 센다) */
export function monthCostUsd(ownerId: number, now = Date.now()): number {
  const row = db
    .select({ sum: sql<number>`coalesce(sum(${briefingRuns.costUsd}), 0)` })
    .from(briefingRuns)
    .where(and(eq(briefingRuns.ownerId, ownerId), gte(briefingRuns.startedAt, kstMonthStart(now))))
    .get();
  return Math.round((row?.sum ?? 0) * 100) / 100;
}

function lastOkRun(ownerId: number): RunRow | null {
  return (
    db
      .select()
      .from(briefingRuns)
      .where(and(eq(briefingRuns.ownerId, ownerId), eq(briefingRuns.status, 'ok')))
      .orderBy(desc(briefingRuns.untilAt))
      .get() ?? null
  );
}

/** 다음 실행이 모을 기사의 시작 시각 — 직전 ok 실행이 끝을 잡은 시각부터, 최대 24시간 전까지 */
export function nextSinceAt(ownerId: number, now = Date.now(), prev = lastOkRun(ownerId)): number {
  return Math.max(prev?.untilAt ?? 0, now - BRIEFING.MAX_RANGE_MS);
}

function usageColumns(u: Usage) {
  return {
    haikuInputTokens: u.haikuInput,
    haikuOutputTokens: u.haikuOutput,
    sonnetInputTokens: u.sonnetInput,
    sonnetOutputTokens: u.sonnetOutput,
    costUsd: costOf(u),
  };
}

/**
 * 도는 실행을 지금 끝난 것으로 닫는다 — 아직 running일 때만. 뒤에서 도는 일이 신호를 무시하고 매달려 있어도
 * 기록이 먼저 닫혀야 "만드는 중"이 풀리고 다음 실행·자동 생성이 막히지 않는다 (2026-10-02 수집 멈춤).
 * 늦게 끝난 그 일은 아래 execute가 status 조건으로 걸러 아무것도 덮어쓰지 않는다
 */
function closeRun(runId: number, status: 'error' | 'cancelled', message: string): boolean {
  const r = db
    .update(briefingRuns)
    .set({ status, message, finishedAt: Date.now() })
    .where(and(eq(briefingRuns.id, runId), eq(briefingRuns.status, 'running')))
    .run();
  abortLive(runId);
  closeLive(runId);
  return r.changes > 0;
}

/** API-137 중지 — 이미 쓴 AI 비용은 그 일이 끝나는 대로 기록에 더해진다 */
export function cancelRun(runId: number): boolean {
  return closeRun(runId, 'cancelled', '직접 멈췄어요');
}

/** 기동 시: running으로 남은 실행은 끝난 것이다 — 남겨 두면 영원히 "만드는 중"으로 보이고 새 실행을 막는다 */
export function recoverStaleRuns(): void {
  db.update(briefingRuns)
    .set({ status: 'error', message: '서버 재시작으로 중단됐어요', finishedAt: Date.now() })
    .where(eq(briefingRuns.status, 'running'))
    .run();
}

/**
 * 실행 하나를 시작하고 곧바로 돌려준다 — 만드는 일은 뒤에서. 범위는 직전 ok 실행의 until부터 지금까지(최대 24시간).
 * 자동 실행(스케줄러)과 버튼(API-132)이 같은 입구를 쓴다
 */
export function startRun(args: { ownerId: number; trigger: 'manual' | 'auto'; slot: Slot; force?: boolean; ai?: AiCaller; now?: number }): RunRow {
  const now = args.now ?? Date.now();
  // 잠금은 DB의 running 행 하나 — better-sqlite3는 동기라 이 검사와 아래 insert 사이에 다른 요청이 끼어들 수 없다
  const busy = runningRun();
  if (busy) throw new BriefingBusyError(busy);
  const spent = monthCostUsd(args.ownerId, now);
  if (spent >= BRIEFING.MONTHLY_BUDGET_USD && !args.force) throw new BriefingBudgetError(spent);

  const prev = lastOkRun(args.ownerId);
  const since = nextSinceAt(args.ownerId, now, prev);
  const run = db
    .insert(briefingRuns)
    .values({
      ownerId: args.ownerId,
      trigger: args.trigger,
      slot: args.slot,
      editionDate: kstParts(now).date,
      status: 'running',
      stage: 'collect',
      sinceAt: since,
      untilAt: now,
      startedAt: now,
    })
    .returning()
    .get();
  void execute(run, prev?.fileId ?? null, args.ai ?? callClaude);
  return run;
}

/** 자동 실행이 건너뛴 사실도 기록으로 남긴다 — "왜 오늘 아침판이 없지?"에 답할 수 있게 */
export function recordSkipped(ownerId: number, slot: Slot, message: string, now = Date.now()): void {
  db.insert(briefingRuns)
    .values({ ownerId, trigger: 'auto', slot, editionDate: kstParts(now).date, status: 'skipped', message, sinceAt: now, untilAt: now, startedAt: now, finishedAt: now })
    .run();
}

async function execute(run: RunRow, prevFileId: number | null, ai: AiCaller): Promise<void> {
  const controller = new AbortController();
  const live = openLive(run.id, controller);
  // 신호만 보내면 신호를 안 듣는 곳에 걸린 실행은 영영 "만드는 중"이다 — 시간이 되면 기록부터 닫는다
  const timer = setTimeout(() => closeRun(run.id, 'error', `${BRIEFING.RUN_TIMEOUT_MS / 60_000}분 안에 끝나지 않아 멈췄어요`), BRIEFING.RUN_TIMEOUT_MS);
  const started = Date.now();
  // 닫힌 실행(중지·시간 초과)의 늦은 진행 보고는 버린다
  const stillRunning = and(eq(briefingRuns.id, run.id), eq(briefingRuns.status, 'running'));
  const setProgress = (stage: Stage, done: number, total: number) =>
    db.update(briefingRuns).set({ stage, progressDone: done, progressTotal: total }).where(stillRunning).run();
  const STAGE_START: Partial<Record<Stage, string>> = { classify: '분류 시작', select: '선별 시작', read: '원문 읽기 시작', summarize: '요약 시작', save: '저장' };
  let lastStage: Stage | null = null;
  try {
    const result = await generateEdition({
      ownerId: run.ownerId,
      slot: run.slot,
      since: run.sinceAt,
      until: run.untilAt,
      prevFileId,
      ai,
      signal: controller.signal,
      progress: {
        onStage: (stage, done, total) => {
          if (stage !== lastStage) {
            lastStage = stage;
            const text = STAGE_START[stage];
            if (text) addLog(live, total > 0 ? `${text} — ${total}${stage === 'read' ? '건' : '묶음'}` : text);
          }
          setProgress(stage, done, total);
        },
        log: (text) => addLog(live, text),
        track: (name) => track(live, name),
        onCollected: (info) =>
          db.update(briefingRuns)
            .set({ sourceCount: info.sourceCount, failedSources: JSON.stringify(info.failed.map((f) => `${f.name} (${f.reason})`)), candidateCount: info.candidateCount })
            .where(stillRunning)
            .run(),
      },
    });
    if (result.kind === 'empty') {
      db.update(briefingRuns)
        .set({ status: 'skipped', message: result.message, finishedAt: Date.now(), ...usageColumns(result.usage) })
        .where(stillRunning)
        .run();
      return;
    }
    setProgress('save', 0, 1);
    // 파일 생성과 실행 기록 ok는 한 트랜잭션 — 파일만 생기고 기록이 running으로 남으면 안 된다
    const saved = db.transaction((tx) => {
      // 그사이 중지·시간 초과로 닫혔으면 파일을 만들지 않는다 — 비용만 남긴다
      if (!tx.select({ id: briefingRuns.id }).from(briefingRuns).where(stillRunning).get()) {
        tx.update(briefingRuns).set(usageColumns(result.usage)).where(eq(briefingRuns.id, run.id)).run();
        return null;
      }
      const s = saveEdition(tx, run.ownerId, result.edition);
      tx.update(briefingRuns)
        .set({ status: 'ok', stage: 'save', progressDone: 1, progressTotal: 1, fileId: s.fileId, itemCount: result.edition.stats.items, leadIds: JSON.stringify(result.edition.lead ?? []), finishedAt: Date.now(), ...usageColumns(result.usage) })
        .where(eq(briefingRuns.id, run.id))
        .run();
      return s;
    });
    if (!saved) return;
    const u = result.usage;
    console.log(
      `[briefing] ${result.edition.edition.date} ${result.edition.edition.label} ok ${result.edition.stats.items}건 ${Math.round((Date.now() - started) / 1000)}s ` +
        `haiku ${u.haikuInput}/${u.haikuOutput} sonnet ${u.sonnetInput}/${u.sonnetOutput} ≈ $${costOf(u)} → ${saved.name}`,
    );
  } catch (e) {
    const usage = e instanceof BriefingFailure ? e.usage : null;
    // SDK 오류는 검증 내역 전체를 메시지에 싣는다(수천 자) — 패널 한 줄로 읽히게 자른다. 전문은 서버 로그에
    const full = e instanceof Error ? e.message : String(e);
    const message = full.length > MESSAGE_MAX ? `${full.slice(0, MESSAGE_MAX)}…` : full;
    // 이미 닫힌 실행(중지·시간 초과)이면 이유는 그대로 두고 쓴 비용만 더한다
    if (usage) db.update(briefingRuns).set(usageColumns(usage)).where(eq(briefingRuns.id, run.id)).run();
    db.update(briefingRuns).set({ status: 'error', message, finishedAt: Date.now() }).where(stillRunning).run();
    console.log(`[briefing] run ${run.id} error: ${full}`);
  } finally {
    clearTimeout(timer);
    closeLive(run.id);
  }
}

/** 화면용 실행 모양 (API 명세서 "실행 객체") */
export function toRunDto(r: RunRow) {
  const file = r.fileId ? db.select({ name: files.name, deletedAt: files.deletedAt }).from(files).where(eq(files.id, r.fileId)).get() : undefined;
  let failedSources: string[] = [];
  try {
    failedSources = r.failedSources ? (JSON.parse(r.failedSources) as string[]) : [];
  } catch {
    failedSources = [];
  }
  return {
    id: r.id,
    trigger: r.trigger,
    slot: r.slot,
    editionDate: r.editionDate,
    status: r.status,
    stage: r.stage,
    progressDone: r.progressDone,
    progressTotal: r.progressTotal,
    sinceAt: r.sinceAt,
    untilAt: r.untilAt,
    fileId: file && file.deletedAt === null ? r.fileId : null,
    fileName: file && file.deletedAt === null ? file.name : null,
    sourceCount: r.sourceCount,
    failedSources,
    candidateCount: r.candidateCount,
    itemCount: r.status === 'ok' ? r.itemCount : null,
    costUsd: r.costUsd,
    message: r.message,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    // 도는 중일 때만 — 진행 기록과 오래 기다리는 출처 (설계 "실행 관리 — 진행 기록")
    live: r.status === 'running' ? liveView(r.id) : null,
  };
}

export function listRuns(ownerId: number, limit: number): RunRow[] {
  return db.select().from(briefingRuns).where(eq(briefingRuns.ownerId, ownerId)).orderBy(desc(briefingRuns.startedAt)).limit(limit).all();
}
