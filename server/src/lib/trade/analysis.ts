import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { TRADE } from '../../constants.js';
import { db } from '../../db/index.js';
import { files, tradeJobs, tradeReleases } from '../../db/schema.js';
import { fireTrigger, JobError, triggerSet } from '../briefing/subscription.js';
import { kstParts } from '../briefing/time.js';
import { uniqueFileName } from '../naming.js';
import { binaryAbsPath } from '../storage.js';
import { renderTradeHtml } from './document.js';
import { periodLabel, previousMonth } from './match.js';
import { notifyAnalysisFailed, notifyAnalysisReady, notifyPdfReady } from './notify.js';
import { pdfPageTexts } from './pages.js';
import { adminIds, archiveOwnerId, releaseOf, tradeNameTaken } from './store.js';
import { TradeDataSchema, verifyTradeData, type PageTexts, type VerifyReport } from './verify.js';

// 자동 정리본 — 서버가 claude.ai 예약 작업을 켜고(브리핑 구독의 트리거를 그대로 쓴다), trade-report 스킬이 보낸 완성본을
// 원문과 다시 대조해 저장한다 (수출입 동향 설계 2단계). 이 경로에서 서버는 AI를 부르지 않는다

type JobRow = typeof tradeJobs.$inferSelect;
type ReleaseRow = typeof tradeReleases.$inferSelect;


export function tradeJobByJobId(jobId: string): JobRow | null {
  return db.select().from(tradeJobs).where(eq(tradeJobs.jobId, jobId)).get() ?? null;
}

function closeJob(id: number, status: 'ok' | 'missing' | 'error', message: string | null, report?: VerifyReport): void {
  db.update(tradeJobs).set({ status, message, finishedAt: Date.now(), ...(report ? { report: JSON.stringify(report) } : {}) }).where(eq(tradeJobs.id, id)).run();
}

/** 트리거를 빌려줄 관리자 — 자료의 주인이 넣어 뒀으면 그 사람, 아니면 넣어 둔 아무 관리자 */
function triggerOwner(): number | null {
  const owner = archiveOwnerId();
  if (owner !== null && triggerSet(owner)) return owner;
  return adminIds().find((id) => triggerSet(id)) ?? null;
}

/** 정리본을 시킨다 — 호마다 자동 시도는 한 번. 트리거가 없으면 줄을 남기지 않는다(나중에 넣으면 그때 켜지게).
 *  rerun은 관리자가 [다시 만들기]를 누른 경우(API-172) — 이미 있어도 새 실행을 만들고, 원문 도착 알림은 다시 보내지 않는다 */
export async function startAnalysis(period: string, now = Date.now(), rerun = false): Promise<'fired' | 'exists' | 'no_trigger' | 'no_release' | 'failed' | 'running'> {
  const release = releaseOf(period);
  if (!release || release.fileId === null) return 'no_release';
  if (db.select({ id: tradeJobs.id }).from(tradeJobs).where(and(eq(tradeJobs.period, period), eq(tradeJobs.status, 'running'))).get()) return rerun ? 'running' : 'exists';
  if (!rerun && (release.analysisJson !== null || db.select({ id: tradeJobs.id }).from(tradeJobs).where(eq(tradeJobs.period, period)).get())) return 'exists';
  const ownerId = triggerOwner();
  if (ownerId === null) return 'no_trigger';
  const job = db
    .insert(tradeJobs)
    .values({ jobId: randomUUID(), period, ownerId, status: 'running', deadlineAt: now + TRADE.JOB_DEADLINE_MS, startedAt: now })
    .returning()
    .get();
  // 예약 작업의 지시문은 "BRIEFING_JOB_ID로 briefing-subscription 스킬을 실행해"다 — 그 스킬이 지시서의 kind: "trade"를 보고 trade-report로 넘긴다.
  // 이 글은 예약 작업에 "신뢰하지 않는 데이터"로 들어가므로 id만 읽힌다
  const fired = await fireTrigger(ownerId, `BRIEFING_JOB_ID=${job.jobId} — docvault ${periodLabel(period)} 수출입 동향 정리본 차례입니다. 지시서의 kind가 trade이면 trade-report 스킬을 실전 모드로 실행하세요.`);
  if (!fired.ok) {
    closeJob(job.id, 'error', `예약 작업을 켜지 못했어요 — ${fired.reason}`);
    notifyAnalysisFailed(period, job.jobId, `예약 작업을 켜지 못했어요 — ${fired.reason}`);
    // 원문 도착 알림은 그 호에 저장된 것이 없을 때만 — 마감 초과 때와 같은 규칙(이미 알린 호면 같은 열쇠라 다시 가지 않는다)
    if (release.analysisJson === null) notifyPdfReady(period);
    console.log(`[trade] ${period} 정리본 트리거 실패: ${fired.reason}`);
    return 'failed';
  }
  console.log(`[trade] ${period} 정리본 예약 작업을 켰어요 (job ${job.jobId})`);
  return 'fired';
}

/** 기동 뒤·매 틱 — 가장 최근 호에 정리본이 없고 시도한 적도 없으면 켠다(처음 배포, 서버가 꺼져 있던 1일) */
export async function startPendingAnalysis(now = Date.now()): Promise<void> {
  const latest = db.select({ period: tradeReleases.period }).from(tradeReleases).where(and(eq(tradeReleases.source, TRADE.SOURCE), isNull(tradeReleases.analysisJson))).orderBy(desc(tradeReleases.period)).limit(1).get();
  const newest = db.select({ period: tradeReleases.period }).from(tradeReleases).where(eq(tradeReleases.source, TRADE.SOURCE)).orderBy(desc(tradeReleases.period)).limit(1).get();
  // 소급으로 들어온 옛 호까지 거슬러 올라가며 켜지 않는다 — 가장 최근 호만
  if (!latest || !newest || latest.period !== newest.period) return;
  // 그리고 지난달 호이거나(이미 발표됨) 그 전달 호일 때만(이번 달 발표가 아직 안 올라온 1일 오전) — 몇 달 묵은 호를 뒤늦게 정리본하지 않는다
  const target = previousMonth(kstParts(now).month);
  if (latest.period !== target && latest.period !== previousMonth(target)) return;
  await startAnalysis(latest.period, now);
}

/** 마감 지난 실행을 닫는다 — 매 틱 */
export function sweepExpiredTradeJobs(now = Date.now()): void {
  for (const j of db.select().from(tradeJobs).where(and(eq(tradeJobs.status, 'running'), lte(tradeJobs.deadlineAt, now))).all()) {
    const message = j.remoteStartedAt === null ? '예약 작업이 서버를 부르지 않았어요 (예약 작업·네트워크 설정 확인)' : '마감까지 완성본이 오지 않았어요';
    closeJob(j.id, 'missing', message);
    notifyAnalysisFailed(j.period, j.jobId, message);
    // 정리본 없이도 한 번은 알린다 — 원문은 이미 보관함에 있다 (알림은 호마다 한 번, 3단계). 다시 만들기가 실패한 것이면 이미 알린 호라 보내지 않는다
    if (releaseOf(j.period)?.analysisJson == null) notifyPdfReady(j.period);
    console.log(`[trade] ${j.period} 정리본 마감 초과 (job ${j.jobId})`);
  }
}

// ---- 예약 작업이 부르는 쪽 (routes/tradeJobs.ts) ----

function assertOpen(job: JobRow): void {
  if (job.status !== 'running') throw new JobError(409, 'TRADE_JOB_CLOSED', '이미 닫힌 실행이에요', { status: job.status });
}

/** 지시서 — 두 번 받아도 같다. 받아 간 시각만 처음 한 번 적는다 */
export function tradeInstruction(job: JobRow, now = Date.now()) {
  assertOpen(job);
  const cur = releaseOf(job.period);
  if (!cur) throw new JobError(409, 'TRADE_JOB_CLOSED', '그 호의 기록이 없어졌어요');
  const prev = releaseOf(previousMonth(job.period));
  if (job.remoteStartedAt === null) db.update(tradeJobs).set({ remoteStartedAt: now }).where(eq(tradeJobs.id, job.id)).run();
  const brief = (r: ReleaseRow) => ({ period: r.period, title: r.title, dept: r.dept, date: r.publishedDate, articleUrl: `${TRADE.ORIGIN}${TRADE.BOARD_PATH}/${r.articleId}/view` });
  return {
    kind: 'trade' as const,
    jobId: job.jobId,
    skill: 'trade-report',
    period: job.period,
    deadline: job.deadlineAt,
    cur: brief(cur),
    prev: prev && prev.fileId !== null ? brief(prev) : null,
    limits: { resultMaxBytes: TRADE.RESULT_MAX_BYTES, resendMax: TRADE.RESULT_RESEND_MAX },
  };
}

// 쪽 텍스트는 PDF가 바뀌지 않으므로 메모리에 둔다 — 한 실행이 cur·prev를 받아 가고, 완성본 대조 때 다시 쓴다
const pageCache = new Map<number, string[]>();

async function pagesOfRelease(r: ReleaseRow | undefined): Promise<string[] | null> {
  if (!r || r.fileId === null) return null;
  const cached = pageCache.get(r.fileId);
  if (cached) return cached;
  const file = db.select({ storagePath: files.storagePath, deletedAt: files.deletedAt }).from(files).where(eq(files.id, r.fileId)).get();
  if (!file?.storagePath || file.deletedAt !== null) return null;
  const pages = await pdfPageTexts(binaryAbsPath(file.storagePath));
  pageCache.set(r.fileId, pages);
  return pages;
}

export async function tradePages(job: JobRow, doc: 'cur' | 'prev'): Promise<{ doc: string; period: string; pages: string[] }> {
  assertOpen(job);
  const period = doc === 'cur' ? job.period : previousMonth(job.period);
  const pages = await pagesOfRelease(releaseOf(period));
  if (!pages) throw new JobError(404, 'TRADE_PAGES_UNAVAILABLE', `${periodLabel(period)}호 원문이 서버에 없어요`);
  return { doc, period, pages };
}

/** 정리본 문서(HTML)를 보관함에(kind='trade') — 같은 호를 다시 받으면 그 문서를 고쳐 쓴다(이름도 새 이름으로) */
function saveDocument(release: ReleaseRow, html: string, now: number): number {
  const ownerId = archiveOwnerId();
  if (ownerId === null) throw new JobError(409, 'TRADE_JOB_CLOSED', '활성 관리자 계정이 없어 보관할 곳이 없어요');
  const size = Buffer.byteLength(html, 'utf8');
  const existing = release.analysisFileId === null ? undefined : db.select({ id: files.id, deletedAt: files.deletedAt }).from(files).where(eq(files.id, release.analysisFileId)).get();
  if (existing && existing.deletedAt === null) {
    // v0.68~0.70의 「…해부.html」을 고쳐 쓸 때 이름도 「…정리.html」로 바꾼다 — 내용과 이름이 어긋나지 않게
    const name = `${periodLabel(release.period)} 수출입 동향 정리.html`;
    db.update(files).set({ contentText: html, sizeBytes: size, updatedAt: now, ...(tradeNameTaken(ownerId, name) ? {} : { name }) }).where(eq(files.id, existing.id)).run();
    return existing.id;
  }
  const name = uniqueFileName(`${periodLabel(release.period)} 수출입 동향 정리.html`, (n) => tradeNameTaken(ownerId, n));
  return db.insert(files).values({ ownerId, folderId: null, name, fileType: 'html', mimeType: 'text/html', sizeBytes: size, contentText: html, kind: 'trade', createdAt: now, updatedAt: now }).returning().get().id;
}

export type AcceptResult = { fileId: number | null; checked: number; passed: number; dropped: string[]; already: boolean };

/** 완성본 — 모양 검사 → 원문 대조 → 저장 → 알림. 거절(400·422)이면 실행은 running 그대로다(고쳐 다시 보내게) */
export async function acceptTradeResult(job: JobRow, body: unknown, now = Date.now()): Promise<AcceptResult> {
  if (job.status === 'ok') {
    // 재전송 — 이미 저장됐다. 같은 답을 준다(멱등)
    const r = releaseOf(job.period);
    const rep = job.report ? (JSON.parse(job.report) as VerifyReport) : { checked: 0, passed: 0, dropped: [], fatal: [] };
    return { fileId: r?.analysisFileId ?? null, checked: rep.checked, passed: rep.passed, dropped: rep.dropped, already: true };
  }
  assertOpen(job);
  const release = releaseOf(job.period);
  const cur = await pagesOfRelease(release);
  if (!release || !cur) throw new JobError(409, 'TRADE_JOB_CLOSED', '그 호의 원문이 서버에 없어 대조할 수 없어요');
  const parsed = TradeDataSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new JobError(400, 'VALIDATION_ERROR', `${issue?.path.join('.') || '(본문)'}: ${issue?.message ?? '형식이 맞지 않습니다'}`);
  }
  if (parsed.data.meta.period !== job.period) throw new JobError(400, 'VALIDATION_ERROR', `meta.period: 이 실행은 ${job.period}호입니다`);
  const pages: PageTexts = { cur, prev: await pagesOfRelease(releaseOf(previousMonth(job.period))) };
  const { data, report } = verifyTradeData(parsed.data, pages);
  if (report.fatal.length) throw new JobError(422, 'TRADE_JOB_REJECTED', '원문 대조에서 거절됐어요 — 고쳐서 다시 보내 주세요', { fatal: report.fatal, dropped: report.dropped, checked: report.checked, passed: report.passed });
  const fileId = saveDocument(release, renderTradeHtml(data), now);
  db.update(tradeReleases).set({ analysisJson: JSON.stringify(data), analysisFileId: fileId, analysisAt: now }).where(eq(tradeReleases.id, release.id)).run();
  closeJob(job.id, 'ok', null, report);
  // 이 호에 정리본이 이미 있었다면 다시 만들기다 — 처음 만든 것만 모두에게 알린다
  notifyAnalysisReady({ period: job.period, fileId, headline: data.takeaways[0]?.lead ?? '정리 완료', passed: report.passed, rerunJobId: release.analysisJson !== null ? job.jobId : null });
  console.log(`[trade] ${job.period} 정리본 저장 — 대조 ${report.passed}/${report.checked}, 뺀 것 ${report.dropped.length} → 파일 ${fileId}`);
  return { fileId, checked: report.checked, passed: report.passed, dropped: report.dropped, already: false };
}
