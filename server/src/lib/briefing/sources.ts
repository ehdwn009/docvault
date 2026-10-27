import { and, eq, isNull } from 'drizzle-orm';
import { BRIEFING } from '../../constants.js';
import { db } from '../../db/index.js';
import { files, folders } from '../../db/schema.js';
import type { DbOrTx } from '../content.js';
import { parseSourcesDoc, toSources, defaultSourcesDoc, type Source } from './sourcesDoc.js';

// 수집 목록 — 코드가 아니라 "뉴스 브리핑/수집 목록.json" 문서다. 폰 편집기로 고치고 버전 기록으로 되돌릴 수 있게
// (뉴스 브리핑 설계 "수집 목록"). 문서가 없으면 기본값으로 만든다. 형식이 틀리면 어디가 틀렸는지 알리고 실행을 멈춘다.
// 형식·기본값·변환은 sourcesDoc.ts(DB 없이 돌아가는 부분)에 있고, 여기는 문서를 찾고 만드는 DB 일만 (v0.50)

export { CANDIDATE_FEEDS, defaultSourcesDoc, googleNewsUrl, parseSourcesDoc, SourcesError, toSources } from './sourcesDoc.js';
export type { Source, SourcesDoc } from './sourcesDoc.js';

// ---- 문서 찾기·만들기 ----

/** 부모 폴더 아래 이름이 같은 폴더를 찾고, 없으면 만든다 */
export function findOrCreateFolder(tx: DbOrTx, ownerId: number, parentId: number | null, name: string): number {
  const found = tx
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.ownerId, ownerId), parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId), eq(folders.name, name)))
    .get();
  if (found) return found.id;
  const now = Date.now();
  return tx.insert(folders).values({ ownerId, parentId, name, createdAt: now, updatedAt: now }).returning({ id: folders.id }).get().id;
}

/** "뉴스 브리핑" 폴더 — 이름으로 찾는다. 사용자가 이름을 바꾸거나 지우면 다음 실행 때 새로 생긴다 */
export function briefingFolderId(tx: DbOrTx, ownerId: number): number {
  return findOrCreateFolder(tx, ownerId, null, BRIEFING.FOLDER_NAME);
}

/** 수집 목록 문서를 읽는다. 없으면 기본값으로 만든다(지웠어도 다시 생긴다) */
export function loadSources(ownerId: number): { sources: Source[]; fileId: number; created: boolean } {
  return db.transaction((tx) => {
    const folderId = briefingFolderId(tx, ownerId);
    const existing = tx
      .select({ id: files.id, contentText: files.contentText })
      .from(files)
      .where(and(eq(files.ownerId, ownerId), eq(files.folderId, folderId), eq(files.name, BRIEFING.SOURCES_FILE_NAME), isNull(files.deletedAt)))
      .get();
    if (existing) return { sources: toSources(parseSourcesDoc(existing.contentText ?? '')), fileId: existing.id, created: false };

    const doc = defaultSourcesDoc();
    const content = JSON.stringify(doc, null, 2) + '\n';
    const now = Date.now();
    const row = tx
      .insert(files)
      .values({
        ownerId,
        folderId,
        name: BRIEFING.SOURCES_FILE_NAME,
        fileType: 'code',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        contentText: content,
        storagePath: null,
        kind: 'doc',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: files.id })
      .get();
    return { sources: toSources(doc), fileId: row.id, created: true };
  });
}
