import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { files, folders, users } from '../db/schema.js';
import type { AppEnv } from '../types.js';

// API-061: 공유 파일·폴더 트리 (전체 사용자 대상, 열람 전용)
export const sharedRoutes = new Hono<AppEnv>().get('/tree', (c) => {
  const allFolders = db
    .select({
      id: folders.id,
      parentId: folders.parentId,
      name: folders.name,
      isShared: folders.isShared,
      ownerId: folders.ownerId,
    })
    .from(folders)
    .all();

  // 공유 폴더 + 그 하위 전체를 수집 (하위는 플래그와 무관하게 포함)
  const childrenOf = new Map<number | null, typeof allFolders>();
  for (const f of allFolders) {
    const list = childrenOf.get(f.parentId) ?? [];
    list.push(f);
    childrenOf.set(f.parentId, list);
  }
  const sharedFolderIds = new Set<number>();
  const queue = allFolders.filter((f) => f.isShared === 1);
  const roots = new Set(queue.map((f) => f.id));
  while (queue.length) {
    const cur = queue.pop()!;
    if (sharedFolderIds.has(cur.id)) continue;
    sharedFolderIds.add(cur.id);
    for (const child of childrenOf.get(cur.id) ?? []) queue.push(child);
  }

  const ownerNames = new Map(
    db.select({ id: users.id, name: users.displayName, username: users.username }).from(users).all()
      .map((u) => [u.id, u.name ?? u.username]),
  );

  const sharedFolders = allFolders
    .filter((f) => sharedFolderIds.has(f.id))
    .map((f) => ({
      id: f.id,
      // 공유 루트는 부모가 공유 집합 밖이므로 루트로 올려 렌더링한다
      parentId: roots.has(f.id) ? null : f.parentId,
      name: f.name,
      ownerName: ownerNames.get(f.ownerId) ?? '?',
    }));

  const sharedFiles = db
    .select({
      id: files.id,
      folderId: files.folderId,
      name: files.name,
      fileType: files.fileType,
      isShared: files.isShared,
      ownerId: files.ownerId,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .all()
    .filter((f) => f.isShared === 1 || (f.folderId !== null && sharedFolderIds.has(f.folderId)))
    .map((f) => ({
      id: f.id,
      folderId: f.folderId !== null && sharedFolderIds.has(f.folderId) ? f.folderId : null,
      name: f.name,
      fileType: f.fileType,
      updatedAt: f.updatedAt,
      ownerName: ownerNames.get(f.ownerId) ?? '?',
    }));

  return c.json({ folders: sharedFolders, files: sharedFiles });
});
