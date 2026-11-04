import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { NOTIFICATION } from '../constants.js';
import { db } from '../db/index.js';
import { briefingRuns, notifications, userSettings } from '../db/schema.js';
import { slotLabel } from './briefing/edition.js';

// 알림은 "사건 한 표"에 쌓고, 화면·푸시·메신저는 그 위의 배달 통로다 (알림 설계 2026-11-04 — 1단계는 앱 안 알림함만).
// 사건을 만드는 쪽(브리핑 실행)은 배달 방식을 모른다 — 여기 함수 하나만 부른다.

export type NotificationKind = 'briefing_ready' | 'briefing_missing';

type NewNotification = {
  userIds: number[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  fileId?: number | null;
  /** 같은 사건의 두 번째 호출은 조용히 무시된다 (user_id + dedupe_key 유일) */
  dedupeKey: string;
};

export function pushNotification(n: NewNotification): void {
  const now = Date.now();
  for (const userId of new Set(n.userIds)) {
    db.insert(notifications)
      .values({ userId, kind: n.kind, title: n.title, body: n.body ?? null, fileId: n.fileId ?? null, dedupeKey: n.dedupeKey, createdAt: now })
      .onConflictDoNothing()
      .run();
  }
}

/** 알림함 목록 — 최신순, 상한까지만 (API-160) */
export function listNotifications(userId: number) {
  return db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      fileId: notifications.fileId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATION.LIST_MAX)
    .all();
}

export function countUnread(userId: number): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .get()?.n ?? 0
  );
}

/** 읽음 처리 — ids가 없으면 전부. 남의 알림 id는 조건에서 걸러져 아무 일도 없다 */
export function markNotificationsRead(userId: number, ids: number[] | null): void {
  const mine = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  db.update(notifications)
    .set({ readAt: Date.now() })
    .where(ids ? and(mine, inArray(notifications.id, ids)) : mine)
    .run();
}

/** 오래된 알림 정리 — 기동 시 + 하루 한 번 (휴지통·대화 정리와 같은 주기) */
export function purgeOldNotifications(now = Date.now()): void {
  db.delete(notifications).where(lt(notifications.createdAt, now - NOTIFICATION.KEEP_MS)).run();
}

/** 브리핑을 함께 보는 계정 — 회차 도착은 만든 사람과 열람 계정 모두에게 (설계 — 열람 계정) */
function briefingAudience(ownerId: number): number[] {
  const readers = db
    .select({ id: userSettings.userId })
    .from(userSettings)
    .where(and(eq(userSettings.briefingReader, 1), ne(userSettings.userId, ownerId)))
    .all()
    .map((r) => r.id);
  return [ownerId, ...readers];
}

/** 회차 도착 — 실행 기록이 ok로 닫힌 직후 부른다 */
export function notifyBriefingReady(runId: number): void {
  const r = db.select().from(briefingRuns).where(eq(briefingRuns.id, runId)).get();
  if (!r || r.status !== 'ok' || !r.fileId) return;
  // 직접 [지금 만들기]로 만든 회차는 보고 있는 사람이 만든 것 — 알리지 않는다
  if (r.trigger === 'manual') return;
  const label = slotLabel(r.slot, r.startedAt, r.label);
  pushNotification({
    userIds: briefingAudience(r.ownerId),
    kind: 'briefing_ready',
    title: `${label} 브리핑이 도착했어요`,
    body: `${r.editionDate} · 핵심 ${r.itemCount}건`,
    fileId: r.fileId,
    dedupeKey: `briefing-run:${runId}:ok`,
  });
}

/** 못 만듦 — 구독 마감 초과(missing)·자동 실행 실패(error). 만든 사람(관리자)에게만 — 열람 계정이 할 수 있는 일이 없다 */
export function notifyBriefingFailed(runId: number): void {
  const r = db.select().from(briefingRuns).where(eq(briefingRuns.id, runId)).get();
  if (!r || (r.status !== 'missing' && r.status !== 'error') || r.trigger === 'manual') return;
  const label = slotLabel(r.slot, r.startedAt, r.label);
  pushNotification({
    userIds: [r.ownerId],
    kind: 'briefing_missing',
    title: `${label} 브리핑을 만들지 못했어요`,
    body: r.message ?? null,
    dedupeKey: `briefing-run:${runId}:${r.status}`,
  });
}
