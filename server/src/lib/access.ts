import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { folders } from '../db/schema.js';
import type { SessionUser } from '../types.js';

type FileAccess = {
  ownerId: number;
  isShared: number;
  folderId?: number | null;
  deletedAt?: number | null;
};

/** 파일 자체가 공유이거나, 상위 폴더 체인 중 하나라도 공유면 열람 공개다 (API 명세 — 공유 폴더 하위 파일).
 *  부모를 거슬러 오르는 반복에 순환 방어가 없는 것은 routes/folders.ts의 wouldCycle이
 *  "자기 하위로의 이동"을 막아 순환이 생길 수 없기 때문이다. 폴더 이동 경로를 새로 만들면 그쪽에도 같은 검사가 필요하다 */
export function isEffectivelyShared(file: { isShared: number; folderId?: number | null }): boolean {
  if (file.isShared === 1) return true;
  let cursor = file.folderId ?? null;
  while (cursor !== null) {
    const folder = db
      .select({ parentId: folders.parentId, isShared: folders.isShared })
      .from(folders)
      .where(eq(folders.id, cursor))
      .get();
    if (!folder) return false;
    if (folder.isShared === 1) return true;
    cursor = folder.parentId;
  }
  return false;
}

// 권한 검사는 이 두 함수로만 한다 (CLAUDE.md 보안 — 라우트마다 제각각 검사 금지)

/** 열람: 소유자, 공유 파일(폴더 상속 포함), 관리자 (API 명세서 — 파일 접근 규칙).
 *  휴지통의 파일은 누구에게도 일반 접근을 허용하지 않는다 — 복원·영구삭제 전용 라우트만 예외 */
export function canReadFile(user: SessionUser, file: FileAccess): boolean {
  if (file.deletedAt != null) return false;
  return file.ownerId === user.id || user.role === 'admin' || isEffectivelyShared(file);
}

/** 수정: 소유자 또는 관리자. 공유 파일은 열람 전용 */
export function canWriteFile(user: SessionUser, file: FileAccess): boolean {
  if (file.deletedAt != null) return false;
  return file.ownerId === user.id || user.role === 'admin';
}

/** 폴더 열람: 소유자, 관리자, 또는 자신이나 상위 체인이 공유된 폴더 (API-040 폴더째 내보내기) */
export function canReadFolder(
  user: SessionUser,
  folder: { ownerId: number; isShared: number; parentId: number | null },
): boolean {
  if (folder.ownerId === user.id || user.role === 'admin') return true;
  // 자신의 공유 여부 + 상위 체인 상속을 파일과 같은 규칙으로 판정한다
  return isEffectivelyShared({ isShared: folder.isShared, folderId: folder.parentId });
}
