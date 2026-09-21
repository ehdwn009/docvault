import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { DEFAULT_FILE_STATE } from '../constants.js';
import { db } from '../db/index.js';
import { files, fileTags, folders, userFileState } from '../db/schema.js';
import type { AppEnv } from '../types.js';

// API-021: 내 폴더·파일 트리 — 탐색기 초기 로드를 1 요청으로 (중첩 조립은 클라이언트가 수행)
export const treeRoutes = new Hono<AppEnv>().get('/', (c) => {
  const user = c.get('user');
  // 부분별 시간을 Server-Timing에 단다 — 이 요청이 시작 시간의 대부분이라, 느려지면 네 질의 중 어디인지 바로 보이게
  let mark = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    c.header('Server-Timing', `${name};dur=${(now - mark).toFixed(1)}`, { append: true });
    mark = now;
  };

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
  lap('folders');

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
    // 휴지통 파일 제외. 카드(kind='card')도 제외 — 서랍(SCR-181)에서만 보인다 (설계 — 문서와 섞이지 않게)
    .where(and(eq(files.ownerId, user.id), isNull(files.deletedAt), eq(files.kind, 'doc')))
    .all();
  lap('files');

  const states = db
    .select()
    .from(userFileState)
    .where(eq(userFileState.userId, user.id))
    .all();
  const stateByFile = new Map(states.map((s) => [s.fileId, s]));
  lap('state');

  const tagRows = db
    .select({ fileId: fileTags.fileId, tagId: fileTags.tagId })
    .from(fileTags)
    .innerJoin(files, eq(fileTags.fileId, files.id))
    .where(eq(files.ownerId, user.id))
    .all();
  const tagsByFile = new Map<number, number[]>();
  for (const t of tagRows) {
    const list = tagsByFile.get(t.fileId) ?? [];
    list.push(t.tagId);
    tagsByFile.set(t.fileId, list);
  }
  lap('tags');

  // 응답을 줄인다 — 파일마다 반복되는 기본값 state·빈 tags는 빼고, 읽던 위치(JSON)는 싣지 않는다(열 때 API-073 GET).
  // 폰에서 목록 다운로드가 1초를 먹고 그동안 작은 요청들이 뒤에 줄을 섰다 (IA — 시작 시간 측정)
  return c.json({
    folders: folderRows,
    files: fileRows.map((f) => {
      const s = stateByFile.get(f.id);
      const tags = tagsByFile.get(f.id);
      const state = s ? { isFavorite: s.isFavorite, lastOpenedAt: s.lastOpenedAt, viewerFit: s.viewerFit, fontScale: s.fontScale } : null;
      const isDefault =
        !state || (state.isFavorite === DEFAULT_FILE_STATE.isFavorite && state.lastOpenedAt === null && state.viewerFit === DEFAULT_FILE_STATE.viewerFit && state.fontScale === null);
      return { ...f, ...(tags ? { tags } : {}), ...(isDefault ? {} : { state }) };
    }),
  });
});
