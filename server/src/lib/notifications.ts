import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { NOTIFICATION, NOTIFICATION_KINDS } from '../constants.js';
import { db } from '../db/index.js';
import { briefingRuns, notifications, userSettings } from '../db/schema.js';
import { slotLabel } from './briefing/edition.js';
import { kstParts } from './briefing/time.js';
import { sendPushToUser } from './push.js';
import { sendTelegram } from './telegram.js';

// 알림은 "사건 한 표"에 쌓고, 화면·푸시·메신저는 그 위의 배달 통로다 (알림 설계 2026-11-04 — 1단계는 앱 안 알림함만).
// 사건을 만드는 쪽(브리핑 실행)은 배달 방식을 모른다 — 여기 함수 하나만 부른다.

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

type NewNotification = {
  userIds: number[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  fileId?: number | null;
  /** 문서가 아닌 곳(내보내기 내려받기 등)으로 — fileId 대신 */
  href?: string | null;
  /** 같은 사건의 두 번째 호출은 조용히 무시된다 (user_id + dedupe_key 유일) */
  dedupeKey: string;
};

export type NotifyPrefs = Partial<Record<NotificationKind, 0 | 1>>;
export type QuietHours = { enabled: 0 | 1; start: string; end: string };

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 사용자의 알림 취향 — 설정 행이 없으면 전부 켬·조용한 시간 없음 */
function loadPrefs(userId: number): { prefs: NotifyPrefs; quiet: QuietHours | null } {
  const row = db.select({ p: userSettings.notifyPrefs, q: userSettings.quietHours }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return { prefs: parseJson<NotifyPrefs>(row?.p) ?? {}, quiet: parseJson<QuietHours>(row?.q) };
}

/** 조용한 시간 안인가 — 한국시간 기준, "23:00~06:30"처럼 자정을 넘는 구간도 받는다 */
export function isQuietNow(q: QuietHours | null, now = Date.now()): boolean {
  if (!q || !q.enabled) return false;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const start = toMin(q.start);
  const end = toMin(q.end);
  const k = kstParts(now);
  const cur = k.hour * 60 + k.minute;
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/** 밖으로 보내는 통로 둘 — 푸시(기기들)와 텔레그램. 알림함은 이미 쌓였다 */
function deliver(userId: number, title: string, body: string | null, fileId: number | null, tag: string, href: string | null = null): void {
  sendPushToUser(userId, { title, body, url: href ?? (fileId ? `/f/${fileId}` : '/'), tag });
  void sendTelegram(userId, body ? `${title}\n${body}` : title);
}

export function pushNotification(n: NewNotification): void {
  const now = Date.now();
  for (const userId of new Set(n.userIds)) {
    const { prefs, quiet } = loadPrefs(userId);
    // 끈 종류는 알림함에도 안 쌓인다 — "안 받기"는 안 받기다 (알림 3단계)
    if (prefs[n.kind] === 0) continue;
    const quietNow = isQuietNow(quiet, now);
    const r = db
      .insert(notifications)
      .values({ userId, kind: n.kind, title: n.title, body: n.body ?? null, fileId: n.fileId ?? null, href: n.href ?? null, dedupeKey: n.dedupeKey, deferredPush: quietNow ? 1 : 0, createdAt: now })
      .onConflictDoNothing()
      .run();
    // 새로 생긴 줄만 밖으로 보낸다 — 중복으로 막힌 사건은 푸시도 가지 않는다 (2단계: 웹 푸시).
    // 조용한 시간이면 보류 표시만 — flushDeferredPushes가 끝난 뒤 한 통으로 묶는다
    if (r.changes > 0 && !quietNow) deliver(userId, n.title, n.body ?? null, n.fileId ?? null, n.dedupeKey, n.href ?? null);
  }
}

/** 조용한 시간이 끝난 사람의 보류 알림을 한 통으로 — 1분마다 (NOTIFICATION.QUIET_FLUSH_MS) */
export function flushDeferredPushes(now = Date.now()): void {
  const rows = db
    .select({ id: notifications.id, userId: notifications.userId, title: notifications.title, fileId: notifications.fileId })
    .from(notifications)
    .where(eq(notifications.deferredPush, 1))
    .orderBy(desc(notifications.createdAt))
    .all();
  const byUser = new Map<number, typeof rows>();
  for (const r of rows) (byUser.get(r.userId) ?? byUser.set(r.userId, []).get(r.userId)!).push(r);
  for (const [userId, list] of byUser) {
    if (isQuietNow(loadPrefs(userId).quiet, now)) continue;
    db.update(notifications).set({ deferredPush: 0 }).where(inArray(notifications.id, list.map((r) => r.id))).run();
    const first = list[0]!;
    const title = list.length === 1 ? first.title : `조용한 시간 동안 알림 ${list.length}개`;
    const body = list.length === 1 ? null : `${first.title} 외 ${list.length - 1}개`;
    deliver(userId, title, body, list.length === 1 ? first.fileId : null, `quiet-flush:${userId}:${now}`);
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
      href: notifications.href,
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
