import { pushNotification } from '../notifications.js';
import { periodLabel } from './match.js';
import { activeUserIds, adminIds, releaseOf, type SavedRelease } from './store.js';

// 수출입 동향 알림 문구 — 도착은 모든 계정에, 못 찾음은 할 수 있는 일이 있는 관리자에게 (수출입 동향 설계 "알림")

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/** 원문 도착 — v0.69부터는 정리본을 시키지 못했거나 정리본이 실패했을 때만 부른다(알림은 호마다 한 번, 정리본 도착이 먼저다) */
export function notifyPdfReady(period: string): void {
  const r = releaseOf(period);
  if (!r || r.fileId === null) return;
  const [, m, d] = r.publishedDate.split('-').map(Number);
  pushNotification({
    userIds: activeUserIds(),
    kind: 'trade_ready',
    title: `${periodLabel(period).split(' ')[1]} 수출입 동향이 올라왔어요`,
    body: `산업통상부 · ${m}월 ${d}일 게시 · 원문 PDF ${mb(r.pdfBytes)} · 동향 탭`,
    fileId: r.fileId,
    dedupeKey: `trade:${period}:ready`,
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
    body: `${periodLabel(first.period)} ~ ${periodLabel(last.period)} · 동향 탭 · 앞으로는 매달 1일에 알려 드려요`,
    fileId: last.fileId,
    dedupeKey: 'trade:backfill',
  });
}

export function notifyMissing(args: { dedupeKey: string; title: string; body: string }): void {
  pushNotification({ userIds: adminIds(), kind: 'trade_missing', title: args.title, body: args.body, dedupeKey: args.dedupeKey });
}

/** 정리본 도착 — 한 호의 알림은 이것 하나다(누르면 정리본). 원문은 동향 탭에서 함께 열린다.
 *  관리자가 [다시 만들기]로 만든 것은 그 일을 시킨 관리자들에게만 알린다(모두에게 두 번 알리지 않는다) */
export function notifyAnalysisReady(a: { period: string; fileId: number; headline: string; passed: number; rerunJobId: string | null }): void {
  const month = periodLabel(a.period).split(' ')[1];
  pushNotification({
    userIds: a.rerunJobId ? adminIds() : activeUserIds(),
    kind: 'trade_ready',
    title: a.rerunJobId ? `${month} 수출입 동향 정리를 다시 만들었어요` : `${month} 수출입 동향이 나왔어요`,
    body: `${a.headline} · 숫자 ${a.passed}곳 원문 대조`,
    fileId: a.fileId,
    dedupeKey: a.rerunJobId ? `trade:${a.period}:analysis:${a.rerunJobId}:ok` : `trade:${a.period}:analysis`,
  });
}

/** 정리본 실패 — 원문 PDF는 이미 받아 뒀다(동향 탭). 할 수 있는 일이 있는 관리자에게만 */
export function notifyAnalysisFailed(period: string, jobId: string, reason: string): void {
  pushNotification({
    userIds: adminIds(),
    kind: 'trade_missing',
    title: `${periodLabel(period).split(' ')[1]} 수출입 동향 정리를 만들지 못했어요`,
    body: `${reason} · 원문 PDF는 동향 탭에 있어요`,
    dedupeKey: `trade:${period}:analysis:${jobId}`,
  });
}
