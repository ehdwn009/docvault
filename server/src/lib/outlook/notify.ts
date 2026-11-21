import { pushNotification } from '../notifications.js';
import { activeUserIds, adminIds } from '../trade/store.js';
import type { EditionRow } from './store.js';

// 세계 전망 알림 — 새 판은 모든 활성 계정에(읽기 권한과 같은 범위), 실패는 할 수 있는 일이 있는 관리자에게 (사용자 결정 2026-11-21)

/** 받침에 맞춘 조사 — 판 이름은 서버가 정하므로("…판", "…전망", 같은 날 두 번이면 " (2)") 마지막 한글 글자로 고른다 */
function withParticle(word: string, withFinal: string, withoutFinal: string): string {
  const ch = [...word].reverse().find((c) => c >= '가' && c <= '힣');
  if (!ch) return `${word}${withFinal}(${withoutFinal})`;
  return word + ((ch.charCodeAt(0) - 0xac00) % 28 === 0 ? withoutFinal : withFinal);
}

export function notifyOutlookReady(e: EditionRow): void {
  pushNotification({
    userIds: activeUserIds(),
    kind: 'outlook_ready',
    // 제목은 서버가 정한 판 이름으로 — 세션이 쓴 meta.title에 기대지 않는다
    title: e.kind === 'small' ? `글로벌 리서치 동향 ${withParticle(e.label, '이', '가')} 나왔어요` : `${withParticle(e.label, '이', '가')} 나왔어요`,
    body: e.lead,
    fileId: e.fileId,
    dedupeKey: `outlook:${e.label}:ready`,
  });
}

export function notifyOutlookFailed(label: string, jobId: string, reason: string): void {
  pushNotification({
    userIds: adminIds(),
    kind: 'outlook_missing',
    title: `세계 전망 ${withParticle(label, '을', '를')} 만들지 못했어요`,
    body: reason,
    dedupeKey: `outlook:${jobId}:failed`,
  });
}
