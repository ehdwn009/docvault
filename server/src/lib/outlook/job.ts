import { randomUUID } from 'node:crypto';
import { and, eq, lte } from 'drizzle-orm';
import { OUTLOOK } from '../../constants.js';
import { db } from '../../db/index.js';
import { outlookJobs } from '../../db/schema.js';
import { fireTrigger, JobError, triggerSet } from '../briefing/subscription.js';
import { adminIds, archiveOwnerId } from '../trade/store.js';
import { bigWindow, daySpan, manualLabel, smallWindow, type AutoSlot } from './calendar.js';
import { renderOutlookHtml } from './document.js';
import { notifyOutlookFailed, notifyOutlookReady } from './notify.js';
import { OutlookDataSchema } from './schema.js';
import { fetchSource, type SourceResult } from './sources.js';
import { baselineEdition, editionById, editionText, editionUrls, firstSentence, labelUsed, lastPublishedUntil, latestPublished, saveEdition, smallEditionsAfter } from './store.js';
import { verifyOutlookData, type OutlookReport, type SourceTexts } from './verify.js';

// 자동 세계 전망 — 서버가 claude.ai 예약 작업을 켜고(브리핑 구독의 트리거를 그대로 쓴다), outlook-report 스킬이 보낸 완성본을
// 원문과 다시 대조해 저장한다 (세계전망 설계 출시 2·3단계). 원문 받기는 서버가 한다 — 예약 작업 세션의 네트워크가 좁아서(브리핑 v0.59 "재료는 서버가"와 같은 결정).
// 이 경로에서 서버는 AI를 부르지 않는다

type JobRow = typeof outlookJobs.$inferSelect;
export type StartResult = 'fired' | 'exists' | 'running' | 'no_trigger' | 'nothing' | 'failed';

export function outlookJobByJobId(jobId: string): JobRow | null {
  return db.select().from(outlookJobs).where(eq(outlookJobs.jobId, jobId)).get() ?? null;
}

// 서버가 받은 원문 — 실행 동안만 메모리에 둔다(jobId → 주소 → 글, null은 받으려 했으나 못 받음). 완성본 대조가 같은 글을 다시 쓴다.
// 서버가 재시작해 비면 대조 때 다시 받는다
const grabbed = new Map<string, Map<string, Extract<SourceResult, { ok: true }> | null>>();
const grabCount = new Map<string, number>();

function forget(jobId: string): void {
  grabbed.delete(jobId);
  grabCount.delete(jobId);
}

function closeJob(job: JobRow, status: 'ok' | 'missing' | 'error', message: string | null, extra: { report?: OutlookReport; editionId?: number } = {}): void {
  db.update(outlookJobs)
    .set({ status, message, finishedAt: Date.now(), ...(extra.report ? { report: JSON.stringify(extra.report) } : {}), ...(extra.editionId ? { editionId: extra.editionId } : {}) })
    .where(eq(outlookJobs.id, job.id))
    .run();
  forget(job.jobId);
}

/** 트리거를 빌려줄 관리자 — 자료의 주인이 넣어 뒀으면 그 사람, 아니면 넣어 둔 아무 관리자 (수출입 동향과 같은 규칙) */
function triggerOwner(): number | null {
  const owner = archiveOwnerId();
  if (owner !== null && triggerSet(owner)) return owner;
  return adminIds().find((id) => triggerSet(id)) ?? null;
}

export type JobPlan = { kind: 'big' | 'small'; label: string; since: string; until: string; origin: 'auto' | 'manual' };

/** 자동 발행일의 판 — 큰 판은 전년 9~12월, 작은 판은 마지막 판 다음 날 ~ 어제 */
export function autoPlan(slot: AutoSlot, now = Date.now()): JobPlan {
  const window = slot.kind === 'big' ? bigWindow(slot.year) : smallWindow(lastPublishedUntil(), now);
  return { kind: slot.kind, label: slot.label, ...window, origin: 'auto' };
}

/** 관리자의 [지금 만들기] — 작은 판. 같은 날 두 번이면 이름 뒤에 " (2)" */
export function manualPlan(now = Date.now()): JobPlan {
  const base = manualLabel(now);
  let label = base;
  for (let n = 2; labelUsed(label); n++) label = `${base} (${n})`;
  return { kind: 'small', label, ...smallWindow(lastPublishedUntil(), now, true), origin: 'manual' };
}

/** 판을 시킨다. 자동 판은 이름마다 한 번 — 실패해도 다시 켜지 않는다(사용량이 새지 않게). 트리거가 없으면 줄을 남기지 않는다(나중에 넣으면 그때 켜지게).
 *  한 번에 하나만 돈다 — 구독 실행은 한 번에 하나이고, 둘이 같은 기간을 읽으면 다음 판의 기간이 꼬인다 */
export async function startOutlookJob(plan: JobPlan, now = Date.now()): Promise<StartResult> {
  if (db.select({ id: outlookJobs.id }).from(outlookJobs).where(eq(outlookJobs.status, 'running')).get()) return 'running';
  if (plan.origin === 'auto' && labelUsed(plan.label)) return 'exists';
  // 연결이 없는 것을 먼저 알린다 — 날짜와 상관없이 관리자가 고칠 수 있는 일이라
  const ownerId = triggerOwner();
  if (ownerId === null) return 'no_trigger';
  if (plan.since > plan.until) return 'nothing';
  // 자동 작은 판은 읽을 날이 너무 적으면 건너뛴다 — 관리자가 며칠 전에 [지금 만들기]로 낸 판이 있으면 하루치 판이 생기지 않게. 다음 자동 판이 그 기간까지 읽는다
  if (plan.origin === 'auto' && plan.kind === 'small' && daySpan(plan.since, plan.until) < OUTLOOK.MIN_AUTO_WINDOW_DAYS) return 'nothing';
  const job = db
    .insert(outlookJobs)
    .values({ jobId: randomUUID(), kind: plan.kind, label: plan.label, since: plan.since, until: plan.until, origin: plan.origin, ownerId, status: 'running', deadlineAt: now + OUTLOOK.JOB_DEADLINE_MS, startedAt: now })
    .returning()
    .get();
  // 예약 작업의 지시문은 "BRIEFING_JOB_ID로 briefing-subscription 스킬을 실행해"다 — 그 스킬이 지시서의 kind: "outlook"을 보고 outlook-report로 넘긴다.
  // 이 글은 예약 작업에 "신뢰하지 않는 데이터"로 들어가므로 id만 읽힌다
  const fired = await fireTrigger(ownerId, `BRIEFING_JOB_ID=${job.jobId} — docvault 세계 전망 ${plan.label} 차례입니다. 지시서의 kind가 outlook이면 outlook-report 스킬을 실전 모드로 실행하세요.`);
  if (!fired.ok) {
    const message = `예약 작업을 켜지 못했어요 — ${fired.reason}`;
    closeJob(job, 'error', message);
    notifyOutlookFailed(plan.label, job.jobId, message);
    console.log(`[outlook] ${plan.label} 트리거 실패: ${fired.reason}`);
    return 'failed';
  }
  console.log(`[outlook] ${plan.label} 예약 작업을 켰어요 (job ${job.jobId}, ${plan.since} ~ ${plan.until})`);
  return 'fired';
}

/** 마감 지난 실행을 닫는다 — 매 틱 */
export function sweepExpiredOutlookJobs(now = Date.now()): void {
  for (const j of db.select().from(outlookJobs).where(and(eq(outlookJobs.status, 'running'), lte(outlookJobs.deadlineAt, now))).all()) {
    const message = j.remoteStartedAt === null ? '예약 작업이 서버를 부르지 않았어요 (예약 작업·네트워크 설정 확인)' : '마감까지 완성본이 오지 않았어요';
    closeJob(j, 'missing', message);
    notifyOutlookFailed(j.label, j.jobId, message);
    console.log(`[outlook] ${j.label} 마감 초과 (job ${j.jobId})`);
  }
}

// ---- 예약 작업이 부르는 쪽 (routes/outlookJobs.ts) ----

function assertOpen(job: JobRow): void {
  if (job.status !== 'running') throw new JobError(409, 'OUTLOOK_JOB_CLOSED', '이미 닫힌 실행이에요', { status: job.status });
}

/** 지시서 — 두 번 받아도 같다. 받아 간 시각만 처음 한 번 적는다 */
export function outlookInstruction(job: JobRow, now = Date.now()) {
  assertOpen(job);
  if (job.remoteStartedAt === null) db.update(outlookJobs).set({ remoteStartedAt: now }).where(eq(outlookJobs.id, job.id)).run();
  const base = baselineEdition();
  const prev = latestPublished();
  return {
    kind: 'outlook' as const,
    jobId: job.jobId,
    skill: 'outlook-report',
    edition: job.kind,
    label: job.label,
    since: job.since,
    until: job.until,
    deadline: job.deadlineAt,
    wrapUpBefore: OUTLOOK.WRAP_UP_BEFORE_MS,
    searchQuota: OUTLOOK.SEARCH_QUOTA[job.kind],
    baseline: base ? { label: base.label, title: base.title, text: editionText(base) } : null,
    later: smallEditionsAfter(base).map((e) => ({ label: e.label, since: e.since, until: e.until, text: editionText(e) })),
    // 직전 판이 이미 다룬 출처 — 같은 글을 두 판에 걸쳐 새 소식처럼 쓰지 않게
    excludeUrls: prev ? editionUrls(prev) : [],
    limits: { resultMaxBytes: OUTLOOK.RESULT_MAX_BYTES, resendMax: OUTLOOK.RESULT_RESEND_MAX },
  };
}

/** 세션 대신 원문을 받는다 — 실행마다 상한까지. 받은 글은 완성본 대조에 다시 쓴다 */
export async function outlookGrab(job: JobRow, url: string): Promise<SourceResult> {
  assertOpen(job);
  const cache = grabbed.get(job.jobId) ?? new Map();
  grabbed.set(job.jobId, cache);
  const hit = cache.get(url);
  if (hit) return hit;
  const used = grabCount.get(job.jobId) ?? 0;
  if (used >= OUTLOOK.GRAB_MAX_PER_JOB) return { ok: false, why: `이 실행에서 받을 수 있는 원문 수(${OUTLOOK.GRAB_MAX_PER_JOB})를 넘었어요` };
  grabCount.set(job.jobId, used + 1);
  const r = await fetchSource(url);
  cache.set(url, r.ok ? r : null);
  return r;
}

/** 완성본의 주마다 원문 글 — 메모리에 있으면 그것, 없으면 서버가 받는다(몇 개씩 한꺼번에) */
async function sourcesFor(job: JobRow, notes: { n: number; url: string }[]): Promise<SourceTexts> {
  const cache = grabbed.get(job.jobId) ?? new Map<string, Extract<SourceResult, { ok: true }> | null>();
  const todo = [...new Set(notes.map((n) => n.url).filter((u) => !cache.has(u)))];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const url = todo[next++]!;
      const r = await fetchSource(url);
      cache.set(url, r.ok ? r : null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(OUTLOOK.RESULT_FETCH_CONCURRENCY, todo.length) }, worker));
  grabbed.set(job.jobId, cache);
  const out: SourceTexts = new Map();
  for (const n of notes) out.set(n.n, cache.get(n.url)?.text ?? null);
  return out;
}

const emptyReport = (): OutlookReport => ({ checked: 0, passed: 0, unverified: [], dropped: [], fatal: [] });

export type AcceptResult = { editionId: number | null; fileId: number | null; checked: number; passed: number; dropped: string[]; unverified: string[]; already: boolean };

function alreadyAccepted(job: JobRow): AcceptResult {
  const rep = job.report ? (JSON.parse(job.report) as OutlookReport) : emptyReport();
  const edition = job.editionId === null ? undefined : editionById(job.editionId);
  return { editionId: edition?.id ?? null, fileId: edition?.fileId ?? null, checked: rep.checked, passed: rep.passed, dropped: rep.dropped, unverified: rep.unverified, already: true };
}

/** 완성본 — 모양 검사 → 원문 대조 → 저장 → 알림. 거절(400·422)이면 실행은 running 그대로다(고쳐 다시 보내게) */
export async function acceptOutlookResult(job: JobRow, body: unknown, now = Date.now()): Promise<AcceptResult> {
  // 재전송 — 이미 저장됐다. 같은 답을 준다(멱등)
  if (job.status === 'ok') return alreadyAccepted(job);
  assertOpen(job);
  const parsed = OutlookDataSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new JobError(400, 'VALIDATION_ERROR', `${issue?.path.join('.') || '(본문)'}: ${issue?.message ?? '형식이 맞지 않습니다'}`);
  }
  const { meta } = parsed.data;
  if (meta.edition !== job.kind) throw new JobError(400, 'VALIDATION_ERROR', `meta.edition: 이 실행은 ${job.kind}입니다`);
  if (meta.since !== job.since || meta.until !== job.until) throw new JobError(400, 'VALIDATION_ERROR', `meta.since·until: 이 실행의 읽는 기간은 ${job.since} ~ ${job.until}입니다`);
  const sources = await sourcesFor(job, parsed.data.notes);
  const { data, report } = verifyOutlookData(parsed.data, sources);
  if (report.fatal.length) throw new JobError(422, 'OUTLOOK_JOB_REJECTED', '원문 대조에서 거절됐어요 — 고쳐서 다시 보내 주세요', { fatal: report.fatal, dropped: report.dropped, checked: report.checked, passed: report.passed });
  // 원문을 받는 동안 같은 실행의 다른 전송이 먼저 저장했거나 마감으로 닫혔을 수 있다 — 여기서부터 저장까지는 기다림이 없어 끼어들 수 없다
  const fresh = outlookJobByJobId(job.jobId);
  if (fresh?.status === 'ok') return alreadyAccepted(fresh);
  if (!fresh) throw new JobError(409, 'OUTLOOK_JOB_CLOSED', '실행 기록이 없어졌어요');
  assertOpen(fresh);
  const edition = saveEdition(
    {
      kind: job.kind,
      label: job.label,
      title: data.meta.title,
      subtitle: data.meta.subtitle,
      since: job.since,
      until: job.until,
      dataJson: JSON.stringify(data),
      baselineText: null,
      lead: data.meta.subtitle || firstSentence(data.summary[0]?.text ?? ''),
      status: 'published',
      origin: job.origin,
      jobId: job.jobId,
      publishedAt: now,
    },
    renderOutlookHtml(data),
    now,
  );
  closeJob(job, 'ok', null, { report, editionId: edition.id });
  notifyOutlookReady(edition);
  console.log(`[outlook] ${job.label} 저장 — 대조 ${report.passed}/${report.checked}, 확인 못 함 ${report.unverified.length}, 뺀 것 ${report.dropped.length} → 파일 ${edition.fileId}`);
  return { editionId: edition.id, fileId: edition.fileId, checked: report.checked, passed: report.passed, dropped: report.dropped, unverified: report.unverified, already: false };
}
