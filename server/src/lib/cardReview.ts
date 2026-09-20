import { and, eq, isNull } from 'drizzle-orm';
import { CARD } from '../constants.js';
import { db } from '../db/index.js';
import { files, userFileState } from '../db/schema.js';
import { listCards, type CardSummary } from './cards.js';
import { splitCard } from './frontmatter.js';

// 복습 모드 (API-119·120, 배움 카드 활용 ③). 라이트너 상자를 가장 단순하게:
// 몰랐다 → 내일 다시(간격 1일), 알았다 → 간격 두 배(1 → 2 → 4 → 8 … 상한). 점수·연속 일수는 두지 않는다 —
// 공부가 게임이 되면 카드가 가벼워진다 (설계 — 활용 ③).

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewCard = CardSummary & {
  body: string;
  /** 이번 복습 전 간격(일). 0 = 처음 */
  intervalDays: number;
  dueAt: number;
};

/** 카드의 복습 예정 시각 — 복습 기록이 없으면 만든 날 + 1일 (새 카드는 다음 날 첫 복습에 들어온다) */
function dueAtOf(createdAt: number, state: { nextReviewAt: number | null } | undefined): number {
  return state?.nextReviewAt ?? createdAt + CARD.REVIEW_NEW_CARD_DELAY_DAYS * DAY_MS;
}

/** 오늘 복습할 카드(예정 시각이 지난 것, 오래된 순, 하루 상한) + 내일까지 예정된 장수 */
export function listDueCards(ownerId: number, now = Date.now()): { due: ReviewCard[]; tomorrow: number; total: number } {
  const cards = listCards(ownerId).filter((c) => c.kind !== '주제'); // 주제 카드는 묶음이라 외울 것이 아니다
  if (cards.length === 0) return { due: [], tomorrow: 0, total: 0 };
  const rows = db
    .select({ id: files.id, createdAt: files.createdAt, contentText: files.contentText, nextReviewAt: userFileState.nextReviewAt, intervalDays: userFileState.reviewIntervalDays })
    .from(files)
    .leftJoin(userFileState, and(eq(userFileState.fileId, files.id), eq(userFileState.userId, ownerId)))
    .where(and(eq(files.ownerId, ownerId), eq(files.kind, 'card'), isNull(files.deletedAt)))
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const withDue = cards.map((c) => {
    const r = byId.get(c.id);
    return { card: c, row: r, dueAt: dueAtOf(r?.createdAt ?? now, r?.nextReviewAt == null ? undefined : { nextReviewAt: r.nextReviewAt }) };
  });
  const due = withDue
    .filter((x) => x.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, CARD.REVIEW_DAILY_MAX)
    .map((x) => ({
      ...x.card,
      body: splitCard(x.row?.contentText ?? '').body,
      intervalDays: x.row?.intervalDays ?? 0,
      dueAt: x.dueAt,
    }));
  const tomorrow = withDue.filter((x) => x.dueAt > now && x.dueAt <= now + DAY_MS).length;
  return { due, tomorrow, total: cards.length };
}

/** 다음 간격(일) — 몰랐으면 1, 알았으면 두 배(처음 알았으면 2), 상한까지 */
export function nextIntervalDays(prev: number, result: 'ok' | 'again'): number {
  if (result === 'again') return CARD.REVIEW_AGAIN_DAYS;
  return Math.min(CARD.REVIEW_MAX_INTERVAL_DAYS, Math.max(CARD.REVIEW_FIRST_OK_DAYS, prev * 2));
}

/** 채점 — 열람 상태 표의 복습 칸만 갱신한다 (즐겨찾기·읽던 위치는 건드리지 않는다) */
export function gradeCard(ownerId: number, cardId: number, result: 'ok' | 'again', now = Date.now()): { nextReviewAt: number; intervalDays: number } {
  const existing = db
    .select()
    .from(userFileState)
    .where(and(eq(userFileState.userId, ownerId), eq(userFileState.fileId, cardId)))
    .get();
  const intervalDays = nextIntervalDays(existing?.reviewIntervalDays ?? 0, result);
  const nextReviewAt = now + intervalDays * DAY_MS;
  if (existing) {
    db.update(userFileState)
      .set({ nextReviewAt, reviewIntervalDays: intervalDays })
      .where(and(eq(userFileState.userId, ownerId), eq(userFileState.fileId, cardId)))
      .run();
  } else {
    db.insert(userFileState).values({ userId: ownerId, fileId: cardId, nextReviewAt, reviewIntervalDays: intervalDays }).run();
  }
  return { nextReviewAt, intervalDays };
}
