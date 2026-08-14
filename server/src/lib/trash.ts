import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { TRASH_RETENTION_MS } from '../constants.js';
import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import { deleteBinary } from './storage.js';

/** 보관 기한이 지난 휴지통 파일을 영구 삭제한다. 기동 시 + 하루 주기로 호출 (IA — 휴지통) */
export function purgeExpiredTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  const rows = db
    .select({ id: files.id, storagePath: files.storagePath })
    .from(files)
    .where(and(isNotNull(files.deletedAt), lt(files.deletedAt, cutoff)))
    .all();
  for (const row of rows) {
    db.delete(files).where(eq(files.id, row.id)).run();
    deleteBinary(row.storagePath);
  }
  if (rows.length > 0) console.log(`[docvault] 휴지통 자동 비움: ${rows.length}개 영구 삭제`);
}
