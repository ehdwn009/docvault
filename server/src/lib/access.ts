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

/** 파일 자체가 공유이거나, 상위 폴더 체인 중 하나라도 공유면 열람 공개다 (API 명세 — 공유 폴더 하위 파일) */
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
