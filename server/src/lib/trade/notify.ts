import { pushNotification } from '../notifications.js';
import { periodLabel } from './match.js';
import { activeUserIds, adminIds, releaseOf, type SavedRelease } from './store.js';

// 수출입 동향 알림 문구 — 도착은 모든 계정에, 못 찾음은 할 수 있는 일이 있는 관리자에게 (수출입 동향 설계 "알림")

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/** 원문 도착 — v0.69부터는 해부를 시키지 못했거나 해부가 실패했을 때만 부른다(알림은 호마다 한 번, 해부 도착이 먼저다) */
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

/** 해부 도착 — 한 호의 알림은 이것 하나다(누르면 해부 문서). 원문은 동향 탭에서 함께 열린다 */
export function notifyAnalysisReady(a: { period: string; fileId: number; claims: number; links: number; passed: number }): void {
  pushNotification({
    userIds: activeUserIds(),
    kind: 'trade_ready',
    title: `${periodLabel(a.period).split(' ')[1]} 수출입 동향이 나왔어요`,
    body: `해부 완료 · 1쪽 문장 ${a.claims}개 · 쪽 넘는 연결 ${a.links}개 · 인용 ${a.passed}개 원문 대조`,
    fileId: a.fileId,
    dedupeKey: `trade:${a.period}:analysis`,
  });
}

/** 해부 실패 — 원문 PDF는 이미 받아 뒀다(동향 탭). 할 수 있는 일이 있는 관리자에게만 */
export function notifyAnalysisFailed(period: string, jobId: string, reason: string): void {
  pushNotification({
    userIds: adminIds(),
    kind: 'trade_missing',
    title: `${periodLabel(period).split(' ')[1]} 수출입 동향 해부를 만들지 못했어요`,
    body: `${reason} · 원문 PDF는 동향 탭에 있어요`,
    dedupeKey: `trade:${period}:analysis:${jobId}`,
  });
}
