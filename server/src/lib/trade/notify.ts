import { pushNotification } from '../notifications.js';
import { periodLabel } from './match.js';
import { activeUserIds, adminIds, type SavedRelease } from './store.js';

// 수출입 동향 알림 문구 — 도착은 모든 계정에, 못 찾음은 할 수 있는 일이 있는 관리자에게 (수출입 동향 설계 "알림")

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

export function notifyReady(saved: SavedRelease & { publishedDate: string; bytes: number }): void {
  const [, m, d] = saved.publishedDate.split('-').map(Number);
  pushNotification({
    userIds: activeUserIds(),
    kind: 'trade_ready',
    title: `${periodLabel(saved.period).split(' ')[1]} 수출입 동향이 올라왔어요`,
    body: `산업통상부 · ${m}월 ${d}일 게시 · PDF ${mb(saved.bytes)} · 수출입동향 폴더`,
    fileId: saved.fileId,
    dedupeKey: `trade:${saved.period}:ready`,
  });
}

/** 처음 소급 — 달마다 보내면 12통이라 한 통으로 */
export function notifyBackfill(saved: SavedRelease[]): void {
  if (saved.length === 0) return;
  const sorted = [...saved].sort((a, b) => a.period.localeCompare(b.period));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  pushNotification({
    userIds: activeUserIds(),
    kind: 'trade_ready',
    title: `수출입 동향 지난 ${saved.length}개월치를 담았어요`,
    body: `${periodLabel(first.period)} ~ ${periodLabel(last.period)} · 수출입동향 폴더 · 앞으로는 매달 1일에 알려 드려요`,
    fileId: last.fileId,
    dedupeKey: 'trade:backfill',
  });
}

export function notifyMissing(args: { dedupeKey: string; title: string; body: string }): void {
  pushNotification({ userIds: adminIds(), kind: 'trade_missing', title: args.title, body: args.body, dedupeKey: args.dedupeKey });
}
