import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { briefingRuns, files } from '../../db/schema.js';
import { callClaude, costOf, type AiCaller, type Usage } from './ai.js';
import { saveEdition, type Slot } from './edition.js';
import { BriefingFailure, generateEdition, type Stage } from './pipeline.js';
import { kstMonthStart, kstParts } from './time.js';

// 실행 관리 — 한 번에 하나, 진행 상태, 실패 이유, 비용 기록 (뉴스 브리핑 설계 "실행 관리").
// 만드는 일은 응답을 기다리지 않고 뒤에서 돈다. 화면은 실행 기록(briefing_runs)을 읽어 진행을 보여 준다

type RunRow = typeof briefingRuns.$inferSelect;

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

function usageColumns(u: Usage) {
  return {
    haikuInputTokens: u.haikuInput,
    haikuOutputTokens: u.haikuOutput,
    sonnetInputTokens: u.sonnetInput,
    sonnetOutputTokens: u.sonnetOutput,
    costUsd: costOf(u),
  };
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
  const since = Math.max(prev?.untilAt ?? 0, now - BRIEFING.MAX_RANGE_MS);
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
  const timer = setTimeout(() => controller.abort(), BRIEFING.RUN_TIMEOUT_MS);
  const started = Date.now();
  const setProgress = (stage: Stage, done: number, total: number) =>
    db.update(briefingRuns).set({ stage, progressDone: done, progressTotal: total }).where(eq(briefingRuns.id, run.id)).run();
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
        onStage: setProgress,
        onCollected: (info) =>
          db.update(briefingRuns)
            .set({ sourceCount: info.sourceCount, failedSources: JSON.stringify(info.failed.map((f) => `${f.name} (${f.reason})`)), candidateCount: info.candidateCount })
            .where(eq(briefingRuns.id, run.id))
            .run(),
      },
    });
    if (result.kind === 'empty') {
      db.update(briefingRuns)
        .set({ status: 'skipped', message: result.message, finishedAt: Date.now(), ...usageColumns(result.usage) })
        .where(eq(briefingRuns.id, run.id))
        .run();
      return;
    }
    setProgress('save', 0, 1);
    // 파일 생성과 실행 기록 ok는 한 트랜잭션 — 파일만 생기고 기록이 running으로 남으면 안 된다
    const saved = db.transaction((tx) => {
      const s = saveEdition(tx, run.ownerId, result.edition);
      tx.update(briefingRuns)
        .set({ status: 'ok', stage: 'save', progressDone: 1, progressTotal: 1, fileId: s.fileId, itemCount: result.edition.stats.items, finishedAt: Date.now(), ...usageColumns(result.usage) })
        .where(eq(briefingRuns.id, run.id))
        .run();
      return s;
    });
    const u = result.usage;
    console.log(
      `[briefing] ${result.edition.edition.date} ${result.edition.edition.label} ok ${result.edition.stats.items}건 ${Math.round((Date.now() - started) / 1000)}s ` +
        `haiku ${u.haikuInput}/${u.haikuOutput} sonnet ${u.sonnetInput}/${u.sonnetOutput} ≈ $${costOf(u)} → ${saved.name}`,
    );
  } catch (e) {
    const usage = e instanceof BriefingFailure ? e.usage : null;
    const message = e instanceof Error ? e.message : String(e);
    db.update(briefingRuns)
      .set({ status: 'error', message, finishedAt: Date.now(), ...(usage ? usageColumns(usage) : {}) })
      .where(eq(briefingRuns.id, run.id))
      .run();
    console.log(`[briefing] run ${run.id} error: ${message}`);
  } finally {
    clearTimeout(timer);
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
  };
}

export function listRuns(ownerId: number, limit: number): RunRow[] {
  return db.select().from(briefingRuns).where(eq(briefingRuns.ownerId, ownerId)).orderBy(desc(briefingRuns.startedAt)).limit(limit).all();
}
