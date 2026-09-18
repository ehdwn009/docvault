import { eq, sql } from 'drizzle-orm';
import { MAX_VERSIONS_PER_FILE } from '../constants.js';
import { db } from '../db/index.js';
import { files, fileVersions } from '../db/schema.js';

/**
 * 텍스트 본문 저장 — 저장 전 현재 본문을 스냅샷하고 파일당 최근 N개만 남긴다 (아키텍처 — 편집 저장 흐름).
 * 편집기 저장(API-034)과 카드 재구성 저장(API-115)이 같은 규칙을 타야 해서 라우트 밖으로 뽑았다.
 */
export function saveTextContent(
  file: { id: number; contentText: string; sizeBytes: number },
  content: string,
  savedBy: number,
): { updatedAt: number; versionId: number } {
  const now = Date.now();
  return db.transaction((tx) => {
    // 저장 전 현재 본문을 스냅샷 — 복원 지점이 된다
    const version = tx
      .insert(fileVersions)
      .values({
        fileId: file.id,
        savedBy,
        contentText: file.contentText,
        sizeBytes: file.sizeBytes,
        createdAt: now,
      })
      .returning({ id: fileVersions.id })
      .get();

    tx.update(files)
      .set({ contentText: content, sizeBytes: Buffer.byteLength(content, 'utf8'), updatedAt: now })
      .where(eq(files.id, file.id))
      .run();

    // 파일당 최근 N개만 유지, 초과분은 오래된 것부터 삭제 (ERD)
    tx.run(sql`
      DELETE FROM file_versions
      WHERE file_id = ${file.id}
        AND id NOT IN (
          SELECT id FROM file_versions
          WHERE file_id = ${file.id}
          ORDER BY id DESC
          LIMIT ${MAX_VERSIONS_PER_FILE}
        )
    `);

    return { updatedAt: now, versionId: version.id };
  });
}
