import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { files, outlookEditions, outlookJobs, userFileState } from '../../db/schema.js';
import type { SessionUser } from '../../types.js';
import { OUTLOOK } from '../../constants.js';
import { daySpan, smallWindow, upcomingSlots } from './calendar.js';
import { baselineEdition, labelUsed, lastPublishedUntil, listEditions } from './store.js';

// 동향 탭(SCR-195)의 세계 전망 칸이 읽는 모양 — 판 목록·기준선·만드는 중·다음 판 (API-173, 세계전망 설계 출시 2단계)

export type OutlookEditionView = {
  id: number;
  kind: 'big' | 'small';
  label: string;
  title: string;
  subtitle: string;
  since: string;
  until: string;
  fileId: number | null;
  status: 'published' | 'hidden';
  origin: 'auto' | 'manual' | 'seed';
  publishedAt: number;
  lead: string;
  read: boolean;
};
export type OutlookPending = { state: 'running'; label: string; startedAt: number } | { state: 'failed'; label: string; message: string };
export type OutlookView = { editions: OutlookEditionView[]; baselineId: number | null; pending: OutlookPending | null; next: { label: string; at: number } | null };

/** 다음 자동 발행 — 창이 아직 안 끝났고 그 이름으로 아직 시킨 적 없는 가장 가까운 발행일 */
function nextAuto(now: number): { label: string; at: number } | null {
  for (const slot of upcomingSlots(now)) {
    if (labelUsed(slot.label)) continue;
    // 읽을 날이 모자라 건너뛸 자동 작은 판은 "다음 판"으로 보이지 않는다 (job.ts의 startOutlookJob과 같은 규칙)
    if (slot.kind === 'small') {
      const w = smallWindow(lastPublishedUntil(), slot.at);
      if (daySpan(w.since, w.until) < OUTLOOK.MIN_AUTO_WINDOW_DAYS) continue;
    }
    return { label: slot.label, at: slot.at };
  }
  return null;
}

function pendingOf(user: SessionUser): OutlookPending | null {
  const running = db.select().from(outlookJobs).where(eq(outlookJobs.status, 'running')).orderBy(desc(outlookJobs.id)).limit(1).get();
  if (running) return { state: 'running', label: running.label, startedAt: running.startedAt };
  // 못 만든 판 — 할 수 있는 일이 있는 관리자에게만, 그 뒤에 게시된 판이 없을 때만 이유를 보인다
  if (user.role !== 'admin') return null;
  const last = db.select().from(outlookJobs).orderBy(desc(outlookJobs.id)).limit(1).get();
  if (!last || (last.status !== 'error' && last.status !== 'missing')) return null;
  // 내린 판은 실패를 메우지 못한다 — 목록에서 감춘 판이 실패 사유까지 감추지 않게
  const after = db
    .select({ id: outlookEditions.id })
    .from(outlookEditions)
    .where(and(gt(outlookEditions.publishedAt, last.startedAt), eq(outlookEditions.status, 'published')))
    .get();
  return after ? null : { state: 'failed', label: last.label, message: last.message ?? '이유를 남기지 못했어요' };
}

export function outlookView(user: SessionUser, now = Date.now()): OutlookView {
  // 내린 판은 관리자에게만 — 다시 올릴 수 있게
  const rows = listEditions().filter((e) => e.status === 'published' || user.role === 'admin');
  const fileIds = rows.map((e) => e.fileId).filter((id): id is number => id !== null);
  // 휴지통에 간 파일은 없는 것으로 — 열 수 없는 id를 내주지 않는다
  const alive = new Set(fileIds.length ? db.select({ id: files.id, deletedAt: files.deletedAt }).from(files).where(inArray(files.id, fileIds)).all().filter((f) => f.deletedAt === null).map((f) => f.id) : []);
  const opened = new Set(
    fileIds.length
      ? db.select({ fileId: userFileState.fileId, at: userFileState.lastOpenedAt }).from(userFileState).where(and(eq(userFileState.userId, user.id), inArray(userFileState.fileId, fileIds))).all().filter((s) => s.at !== null).map((s) => s.fileId)
      : [],
  );
  const editions = rows.map((e): OutlookEditionView => {
    const fileId = e.fileId !== null && alive.has(e.fileId) ? e.fileId : null;
    return { id: e.id, kind: e.kind, label: e.label, title: e.title, subtitle: e.subtitle, since: e.since, until: e.until, fileId, status: e.status, origin: e.origin, publishedAt: e.publishedAt, lead: e.lead, read: fileId !== null && opened.has(fileId) };
  });
  return { editions, baselineId: baselineEdition()?.id ?? null, pending: pendingOf(user), next: nextAuto(now) };
}
