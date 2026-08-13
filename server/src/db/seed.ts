import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
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
      passwordHash: bcrypt.hashSync(config.adminInitialPassword, 10),
      displayName: 'Administrator',
      role: 'admin',
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  db.insert(userSettings).values({ userId: admin.id, updatedAt: now }).run();

  console.log(
    `[docvault] Seeded initial admin account (username: admin). ` +
      `Change the password after first login.`,
  );
}
