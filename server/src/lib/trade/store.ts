import crypto from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { TRADE } from '../../constants.js';
import { db } from '../../db/index.js';
import { appSettings, files, folders, tradeReleases, users } from '../../db/schema.js';
import { uniqueFileName } from '../naming.js';
import { deleteBinary, saveBinary } from '../storage.js';
import type { BoardRow } from './match.js';
import { periodLabel } from './match.js';

// 받은 호를 Loft 문서로 남긴다 — PDF는 「수출입동향」 폴더의 보통 파일, 기록은 trade_releases 한 줄 (수출입 동향 설계 "저장")

export type SavedRelease = { period: string; fileId: number; title: string };

/** 폴더와 PDF의 주인 — 가장 먼저 만든 활성 관리자. 계정이 아니라 앱이 받는 자료라 한 사람에게 모은다 */
export function archiveOwnerId(): number | null {
  return db.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, 1))).orderBy(asc(users.id)).limit(1).get()?.id ?? null;
}

export function adminIds(): number[] {
  return db.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, 1))).all().map((r) => r.id);
}

export function activeUserIds(): number[] {
  return db.select({ id: users.id }).from(users).where(eq(users.isActive, 1)).all().map((r) => r.id);
}

export function hasRelease(period: string): boolean {
  return !!db.select({ id: tradeReleases.id }).from(tradeReleases).where(and(eq(tradeReleases.source, TRADE.SOURCE), eq(tradeReleases.period, period))).get();
}

export function releaseCount(): number {
  return db.select({ n: sql<number>`count(*)` }).from(tradeReleases).get()?.n ?? 0;
}

/** 「수출입동향」 폴더 — 적어 둔 id가 살아 있으면 그것, 아니면 같은 이름의 최상위 폴더, 그것도 없으면 새로.
 *  모든 계정이 읽게 전체 공개(is_shared=1)로 둔다 — 공공누리 제1유형 자료 */
export function ensureFolder(ownerId: number, now = Date.now()): number {
  const saved = Number(db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, TRADE.FOLDER_SETTING_KEY)).get()?.v);
  let folder = Number.isInteger(saved) ? db.select().from(folders).where(eq(folders.id, saved)).get() : undefined;
  folder ??= db.select().from(folders).where(and(eq(folders.ownerId, ownerId), isNull(folders.parentId), eq(folders.name, TRADE.FOLDER_NAME))).get();
  folder ??= db.insert(folders).values({ ownerId, parentId: null, name: TRADE.FOLDER_NAME, isShared: 1, createdAt: now, updatedAt: now }).returning().get();
  if (folder.isShared !== 1) db.update(folders).set({ isShared: 1, updatedAt: now }).where(eq(folders.id, folder.id)).run();
  db.insert(appSettings)
    .values({ key: TRADE.FOLDER_SETTING_KEY, value: String(folder.id), updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(folder.id), updatedAt: now } })
    .run();
  return folder.id;
}

function nameTaken(ownerId: number, folderId: number, name: string): boolean {
  return !!db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.ownerId, ownerId), eq(files.folderId, folderId), eq(files.name, name), isNull(files.deletedAt)))
    .get();
}

/** PDF를 폴더에 넣고 기록을 남긴다. 기록이 막히면(같은 달이 먼저 들어옴) 방금 만든 파일과 바이너리를 걷어낸다 */
export function saveRelease(args: { row: BoardRow; period: string; pdfName: string; pdf: Buffer; foundBy: 'schedule' | 'backfill'; now?: number }): SavedRelease | null {
  const now = args.now ?? Date.now();
  const ownerId = archiveOwnerId();
  if (ownerId === null) throw new Error('활성 관리자 계정이 없어 보관할 곳이 없어요');
  const folderId = ensureFolder(ownerId, now);
  const name = uniqueFileName(`${periodLabel(args.period)} 수출입 동향.pdf`, (n) => nameTaken(ownerId, folderId, n));
  const storagePath = saveBinary(ownerId, args.pdf);
  const file = db
    .insert(files)
    .values({ ownerId, folderId, name, fileType: 'pdf', mimeType: 'application/pdf', sizeBytes: args.pdf.length, storagePath, createdAt: now, updatedAt: now })
    .returning()
    .get();
  const rec = db
    .insert(tradeReleases)
    .values({
      source: TRADE.SOURCE,
      period: args.period,
      articleId: args.row.articleId,
      title: args.row.title,
      dept: args.row.dept,
      publishedDate: args.row.date,
      fileId: file.id,
      pdfName: args.pdfName,
      pdfSha256: crypto.createHash('sha256').update(args.pdf).digest('hex'),
      pdfBytes: args.pdf.length,
      foundBy: args.foundBy,
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();
  if (rec.changes === 0) {
    db.delete(files).where(eq(files.id, file.id)).run();
    deleteBinary(storagePath);
    return null;
  }
  return { period: args.period, fileId: file.id, title: args.row.title };
}
