import crypto from 'node:crypto';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { TRADE } from '../../constants.js';
import { db } from '../../db/index.js';
import { appSettings, files, folders, tradeReleases, users } from '../../db/schema.js';
import { uniqueFileName } from '../naming.js';
import { deleteBinary, saveBinary } from '../storage.js';
import type { BoardRow } from './match.js';
import { periodLabel } from './match.js';

// 받은 호를 Loft 파일로 남긴다 — PDF는 문서 탭에 안 나오는 kind='trade' 파일, 기록은 trade_releases 한 줄 (수출입 동향 설계 "저장"·3단계)

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

export function releaseOf(period: string) {
  return db.select().from(tradeReleases).where(and(eq(tradeReleases.source, TRADE.SOURCE), eq(tradeReleases.period, period))).get();
}

export function releaseCount(): number {
  return db.select({ n: sql<number>`count(*)` }).from(tradeReleases).get()?.n ?? 0;
}

/** v0.67~0.68의 「수출입동향」 폴더에 있던 파일을 문서 밖 보관(kind='trade')으로 옮긴다 — 서버가 켜질 때 한 번, 여러 번 돌아도 같은 결과.
 *  폴더는 비었을 때만 지운다: files.folder_id가 CASCADE라 남은 파일이 있으면 함께 지워진다 (수출입 동향 설계 3단계 "옮기기") */
export function relocateTradeFiles(now = Date.now()): void {
  const ids = db
    .select({ a: tradeReleases.fileId, b: tradeReleases.analysisFileId })
    .from(tradeReleases)
    .all()
    .flatMap((r) => [r.a, r.b])
    .filter((id): id is number => id !== null);
  let moved = 0;
  for (const id of ids) {
    moved += db.update(files).set({ kind: 'trade', folderId: null, isShared: 0, updatedAt: now }).where(and(eq(files.id, id), ne(files.kind, 'trade'))).run().changes;
  }
  const saved = Number(db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, TRADE.FOLDER_SETTING_KEY)).get()?.v);
  if (Number.isInteger(saved)) {
    const left = db.select({ n: sql<number>`count(*)` }).from(files).where(eq(files.folderId, saved)).get()?.n ?? 0;
    const sub = db.select({ n: sql<number>`count(*)` }).from(folders).where(eq(folders.parentId, saved)).get()?.n ?? 0;
    if (left === 0 && sub === 0) db.delete(folders).where(and(eq(folders.id, saved), eq(folders.name, TRADE.FOLDER_NAME))).run();
    db.delete(appSettings).where(eq(appSettings.key, TRADE.FOLDER_SETTING_KEY)).run();
  }
  if (moved > 0) console.log(`[trade] 원문·해부 ${moved}개를 문서 밖 보관으로 옮겼어요`);
}

/** 보관함 안에서 같은 이름이 있는가 — 폴더가 없으므로 주인의 trade 파일끼리만 본다 */
export function tradeNameTaken(ownerId: number, name: string): boolean {
  return !!db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.ownerId, ownerId), eq(files.kind, 'trade'), eq(files.name, name), isNull(files.deletedAt)))
    .get();
}

/** PDF를 폴더에 넣고 기록을 남긴다. 기록이 막히면(같은 달이 먼저 들어옴) 방금 만든 파일과 바이너리를 걷어낸다 */
export function saveRelease(args: { row: BoardRow; period: string; pdfName: string; pdf: Buffer; foundBy: 'schedule' | 'backfill'; now?: number }): SavedRelease | null {
  const now = args.now ?? Date.now();
  const ownerId = archiveOwnerId();
  if (ownerId === null) throw new Error('활성 관리자 계정이 없어 보관할 곳이 없어요');
  const name = uniqueFileName(`${periodLabel(args.period)} 수출입 동향.pdf`, (n) => tradeNameTaken(ownerId, n));
  const storagePath = saveBinary(ownerId, args.pdf);
  // kind='trade' — 문서 트리·공유받음·검색에 안 나오고 동향 탭에서만 보인다. 읽기는 모든 계정(canReadFile)
  const file = db
    .insert(files)
    .values({ ownerId, folderId: null, name, fileType: 'pdf', mimeType: 'application/pdf', sizeBytes: args.pdf.length, storagePath, kind: 'trade', createdAt: now, updatedAt: now })
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
