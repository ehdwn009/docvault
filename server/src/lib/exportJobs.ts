import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { and, eq, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { EXPORT } from '../constants.js';
import { db } from '../db/index.js';
import { exportJobs } from '../db/schema.js';
import type { SessionUser } from '../types.js';
import { buildManifest, createArchiveStream, type ArchiveEntry } from './archive.js';
import { pushNotification } from './notifications.js';

// 내보내기 작업 (알림 4단계 2026-11-05). 작은 범위는 지금처럼 요청 안에서 흘려보내고(API-040),
// 큰 범위는 뒤에서 ZIP을 파일로 만들어 두고 끝나면 알림 한 줄 — 폰에서 탭을 닫아도 받을 수 있게.

function dirFor(userId: number): string {
  const dir = path.join(config.dataDir, EXPORT.DIR, String(userId));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function exportFilePath(userId: number, id: string): string {
  return path.join(dirFor(userId), `${id}.zip`);
}

/** 바로 보낼지, 뒤에서 만들지 — 개수와 바이트 둘 다 작아야 바로 */
export function shouldInline(entries: ArchiveEntry[]): boolean {
  const bytes = entries.reduce((n, e) => n + e.file.sizeBytes, 0);
  return entries.length <= EXPORT.INLINE_MAX_ENTRIES && bytes <= EXPORT.INLINE_MAX_BYTES;
}

export function downloadPath(id: string): string {
  return `/api/v1/files/archive/jobs/${id}/download`;
}

/** 작업을 만들고 바로 돌린다 — 호출자는 id만 받고 돌아간다 */
export function startExportJob(user: SessionUser, entries: ArchiveEntry[], name: string, manifest: boolean): string {
  const id = randomUUID();
  const now = Date.now();
  db.insert(exportJobs).values({ id, userId: user.id, status: 'running', name, entryCount: entries.length, createdAt: now }).run();
  void (async () => {
    const target = exportFilePath(user.id, id);
    try {
      await pipeline(createArchiveStream(entries, manifest ? buildManifest(user, entries) : null), createWriteStream(target));
      const size = statSync(target).size;
      db.update(exportJobs).set({ status: 'done', sizeBytes: size, finishedAt: Date.now() }).where(eq(exportJobs.id, id)).run();
      pushNotification({
        userIds: [user.id],
        kind: 'export_done',
        title: '내보내기가 끝났어요',
        body: `${name} · ${entries.length}개 · ${Math.max(1, Math.round(size / 1024 / 1024))}MB · 하루 동안 받을 수 있어요`,
        href: downloadPath(id),
        dedupeKey: `export:${id}`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      db.update(exportJobs).set({ status: 'error', message, finishedAt: Date.now() }).where(eq(exportJobs.id, id)).run();
      rmSync(target, { force: true });
      console.log(`[export] job ${id} failed: ${message}`);
    }
  })();
  return id;
}

export function getExportJob(userId: number, id: string) {
  return db.select().from(exportJobs).where(and(eq(exportJobs.id, id), eq(exportJobs.userId, userId))).get() ?? null;
}

/** 하루 지난 ZIP과 행 정리 — 기동 시 + 하루 한 번 */
export function purgeOldExports(now = Date.now()): void {
  const old = db.select({ id: exportJobs.id, userId: exportJobs.userId }).from(exportJobs).where(lt(exportJobs.createdAt, now - EXPORT.KEEP_MS)).all();
  for (const j of old) {
    const p = exportFilePath(j.userId, j.id);
    if (existsSync(p)) rmSync(p, { force: true });
    db.delete(exportJobs).where(eq(exportJobs.id, j.id)).run();
  }
}
