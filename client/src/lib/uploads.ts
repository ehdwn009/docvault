// 올리는 중인 파일 한 줄 — 목록(시안 B)과 진행 띠(시안 A)가 같은 상태를 본다 (알림 4단계 2026-11-05).
// 파일마다 요청 하나씩 보내므로 한 개가 막혀도 나머지는 올라가고, 줄마다 자기 진행·실패 이유를 가진다.

export type PendingUpload = {
  /** 한 묶음 안에서 유일 — 같은 이름을 두 폴더에 올릴 수도 있어 이름만으로는 부족하다 */
  key: string;
  name: string;
  folderId: number | null;
  size: number;
  loaded: number;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  /** 실패 이유 — 서버가 준 문구 그대로 (「30MB까지 가능합니다」 등) */
  message?: string;
};

export function pendingPercent(p: PendingUpload): number {
  if (p.status === 'done') return 100;
  return p.size > 0 ? Math.min(100, Math.round((p.loaded / p.size) * 100)) : 0;
}

export function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}
