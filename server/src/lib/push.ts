import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import { config } from '../config.js';
import { PUSH } from '../constants.js';
import { db } from '../db/index.js';
import { pushSubscriptions } from '../db/schema.js';

// 웹 푸시 — 알림 표에 줄이 생기면 그 사람의 기기들로 밀어 준다 (알림 2단계 2026-11-04).
// 우리 서버가 직접 보낸다(VAPID): 가입·비용 없이 브라우저 제조사의 푸시 서버만 거친다. 본문은 기기 열쇠로 잠겨 푸시 서버도 못 읽는다.

type Vapid = { publicKey: string; privateKey: string };

let vapid: Vapid | null = null;

/** VAPID 열쇠 한 쌍 — 처음 한 번 만들어 data/에 둔다. 바뀌면 모든 기기가 다시 구독해야 하므로 파일로 고정 */
export function getVapid(): Vapid {
  if (vapid) return vapid;
  const file = path.join(config.dataDir, PUSH.KEY_FILE);
  if (fs.existsSync(file)) {
    vapid = JSON.parse(fs.readFileSync(file, 'utf8')) as Vapid;
  } else {
    vapid = webpush.generateVAPIDKeys();
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(vapid), { mode: 0o600 });
    console.log('[docvault] generated VAPID keys for web push');
  }
  webpush.setVapidDetails(PUSH.CONTACT, vapid.publicKey, vapid.privateKey);
  return vapid;
}

export type PushPayload = { title: string; body?: string | null; url: string; tag: string };

type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

/** 기기 등록 — 같은 endpoint가 다시 오면 열쇠만 갱신 (브라우저가 구독을 바꿀 때) */
export function saveSubscription(userId: number, sub: SubscriptionInput, label: string): { id: number; created: boolean } {
  const now = Date.now();
  const existing = db.select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).get();
  if (existing) {
    // 다른 계정이 쓰던 기기면 새 주인에게 — 같은 폰에서 로그아웃하고 다른 계정으로 들어온 경우
    db.update(pushSubscriptions).set({ userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label }).where(eq(pushSubscriptions.id, existing.id)).run();
    return { id: existing.id, created: false };
  }
  const row = db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label, createdAt: now })
    .returning({ id: pushSubscriptions.id })
    .get();
  return { id: row.id, created: true };
}

export function countDevices(userId: number): number {
  return db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all().length;
}

export function listDevices(userId: number) {
  return db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, label: pushSubscriptions.label, createdAt: pushSubscriptions.createdAt, lastSentAt: pushSubscriptions.lastSentAt })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .all();
}

/** 끊기 — id 또는 endpoint로. 남의 것은 조건에서 걸러진다 */
export function removeDevice(userId: number, by: { id?: number; endpoint?: string }): boolean {
  const cond = by.id !== undefined ? eq(pushSubscriptions.id, by.id) : eq(pushSubscriptions.endpoint, by.endpoint ?? '');
  return db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), cond)).run().changes > 0;
}

/** 한 기기로 한 통. 푸시 서버가 "이 기기 없음"(404·410)이면 구독을 지운다 — 다음부터 헛수고하지 않게 */
async function sendOne(row: { id: number; endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<'sent' | 'gone' | 'failed'> {
  getVapid();
  try {
    await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), { TTL: PUSH.TTL_S, urgency: 'normal' });
    db.update(pushSubscriptions).set({ lastSentAt: Date.now() }).where(eq(pushSubscriptions.id, row.id)).run();
    return 'sent';
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id)).run();
      return 'gone';
    }
    console.log(`[push] send failed (${status ?? 'network'}) for subscription ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    return 'failed';
  }
}

/** 한 사람의 모든 기기로. 기다리지 않는다 — 알림을 만든 쪽(브리핑 저장)이 푸시 서버를 기다리면 안 된다 */
export function sendPushToUser(userId: number, payload: PushPayload): void {
  const rows = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all();
  for (const row of rows) void sendOne(row, payload);
}

/** [시험 알림] — 그 기기 한 대로만, 결과를 기다려 화면에 알려 준다 */
export async function sendTest(userId: number, id: number): Promise<'sent' | 'gone' | 'failed' | 'none'> {
  const row = db.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id))).get();
  if (!row) return 'none';
  return sendOne(row, { title: '시험 알림이에요', body: '이 기기로 푸시가 잘 옵니다', url: '/', tag: `test:${Date.now()}` });
}
