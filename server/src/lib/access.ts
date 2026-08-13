import type { SessionUser } from '../types.js';

type FileAccess = { ownerId: number; isShared: number };

// 권한 검사는 이 두 함수로만 한다 (CLAUDE.md 보안 — 라우트마다 제각각 검사 금지)

/** 열람: 소유자, 공유 파일, 관리자 (API 명세서 — 파일 접근 규칙) */
export function canReadFile(user: SessionUser, file: FileAccess): boolean {
  return file.ownerId === user.id || user.role === 'admin' || file.isShared === 1;
}

/** 수정: 소유자 또는 관리자. 공유 파일은 열람 전용 */
export function canWriteFile(user: SessionUser, file: FileAccess): boolean {
  return file.ownerId === user.id || user.role === 'admin';
}
