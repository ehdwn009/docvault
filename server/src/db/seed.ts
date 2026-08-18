import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { BCRYPT_ROUNDS, DEFAULT_USER_SETTINGS } from '../constants.js';
import { db } from './index.js';
import { users, userSettings } from './schema.js';

/** 최초 기동 시 admin 계정이 없으면 생성한다. 회원가입 경로가 없는 폐쇄형이므로 필수. */
export function seedAdmin() {
  const existing = db.get<{ count: number }>(sql`SELECT count(*) AS count FROM ${users}`);
  if (existing && existing.count > 0) return;

  const now = Date.now();
  const admin = db
    .insert(users)
    .values({
      username: 'admin',
      passwordHash: bcrypt.hashSync(config.adminInitialPassword, BCRYPT_ROUNDS),
      displayName: 'Administrator',
      role: 'admin',
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  // 설정 기본값은 constants.ts 한 곳에서만 온다 — 행이 없는 사용자(me.ts)와 같은 값에서 출발하도록
  db.insert(userSettings).values({ userId: admin.id, ...DEFAULT_USER_SETTINGS, updatedAt: now }).run();

  console.log(
    `[docvault] Seeded initial admin account (username: admin). ` +
      `Change the password after first login.`,
  );
}
