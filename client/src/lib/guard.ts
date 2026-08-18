import { ApiError } from './api';
import { toast } from './toast';

/**
 * 서버 조작의 공통 뒷정리 — 실행 → 목록 갱신 → 실패 시 알림.
 * Workspace(트리)·AdminPanel(사용자)·TrashPanel(휴지통)이 같은 모양을 쓰고 있어 한곳으로 모았다.
 * 다른 것은 둘뿐이라 인자로 받는다: 성공 후 무엇을 다시 불러올지, 실패를 어떻게 알릴지.
 */
export async function runGuarded(
  fn: () => Promise<unknown>,
  onSuccess: () => void | Promise<unknown>,
  onError: (message: string) => void = (m) => toast(m, 'error'),
): Promise<void> {
  try {
    await fn();
    await onSuccess();
  } catch (e) {
    onError(e instanceof ApiError ? e.message : '작업에 실패했습니다');
  }
}
