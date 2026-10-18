import { eq } from 'drizzle-orm';
import { DEFAULT_USER_SETTINGS } from '../../constants.js';
import { db } from '../../db/index.js';
import { users, userSettings } from '../../db/schema.js';

// 열람 계정 — 관리자가 고른 일반 계정은 그 관리자의 브리핑 회차를 읽기만 할 수 있다 (v0.49, 사용자 결정).
// 어느 관리자의 것을 보는지는 user_settings.briefing_owner_id 한 칸이다: 사람에 붙여 두면 앞으로 생길 회차까지 한 번에 열린다

/** 이 사용자가 함께 보는 브리핑의 주인 — 없으면 null */
export function briefingOwnerOf(userId: number): number | null {
  const row = db.select({ v: userSettings.briefingOwnerId }).from(userSettings).where(eq(userSettings.userId, userId)).get();
  return row?.v ?? null;
}

export type ReaderCandidate = { id: number; username: string; displayName: string | null; isActive: number; on: boolean };

/** 고를 수 있는 계정 전부(일반 계정) + 지금 켜져 있는지 — 관리자는 자기 브리핑이 있으니 목록에 없다 */
export function listReaderCandidates(ownerId: number): ReaderCandidate[] {
  return db
    .select({ id: users.id, username: users.username, displayName: users.displayName, isActive: users.isActive, ownerId: userSettings.briefingOwnerId })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.role, 'user'))
    .orderBy(users.id)
    .all()
    .map(({ ownerId: o, ...u }) => ({ ...u, on: o === ownerId }));
}

/** 켜기/끄기. 끄기는 내가 주인일 때만 지운다 — 다른 관리자가 열어 준 것을 내가 닫지 않게. 일반 계정이 아니면 false */
export function setReader(ownerId: number, userId: number, on: boolean): boolean {
  const target = db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();
  if (!target || target.role !== 'user') return false;
  const current = briefingOwnerOf(userId);
  if (!on && current !== ownerId) return true;
  const set = { briefingOwnerId: on ? ownerId : null, updatedAt: Date.now() };
  db.insert(userSettings)
    .values({ ...DEFAULT_USER_SETTINGS, userId, ...set })
    .onConflictDoUpdate({ target: userSettings.userId, set })
    .run();
  return true;
}
