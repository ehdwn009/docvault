import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { files, folders, userFileState } from '../db/schema.js';
import type { AppEnv } from '../types.js';

// API-021: 내 폴더·파일 트리 — 탐색기 초기 로드를 1 요청으로 (중첩 조립은 클라이언트가 수행)
export const treeRoutes = new Hono<AppEnv>().get('/', (c) => {
  const user = c.get('user');

  const folderRows = db
    .select({
      id: folders.id,
      parentId: folders.parentId,
      name: folders.name,
      isShared: folders.isShared,
      sortOrder: folders.sortOrder,
    })
    .from(folders)
    .where(eq(folders.ownerId, user.id))
    .all();

  // content_text는 트리에 싣지 않는다 — 본문은 파일을 열 때만 (API-021)
  const fileRows = db
    .select({
      id: files.id,
      folderId: files.folderId,
      name: files.name,
      fileType: files.fileType,
      sizeBytes: files.sizeBytes,
      isShared: files.isShared,
      sortOrder: files.sortOrder,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .where(eq(files.ownerId, user.id))
    .all();

  const states = db
    .select()
    .from(userFileState)
    .where(eq(userFileState.userId, user.id))
    .all();
  const stateByFile = new Map(states.map((s) => [s.fileId, s]));

  return c.json({
    folders: folderRows,
    files: fileRows.map((f) => {
      const s = stateByFile.get(f.id);
      return {
        ...f,
        tags: [] as number[], // 태그는 5단계에서 조인 예정 — 응답 형태만 미리 맞춰둔다
        state: s
          ? { isFavorite: s.isFavorite, lastOpenedAt: s.lastOpenedAt }
          : { isFavorite: 0, lastOpenedAt: null },
      };
    }),
  });
});
