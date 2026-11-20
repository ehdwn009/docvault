import { and, desc, eq, inArray } from 'drizzle-orm';
import { TRADE } from '../../constants.js';
import { db } from '../../db/index.js';
import { files, tradeJobs, tradeReleases, userFileState } from '../../db/schema.js';
import type { SessionUser } from '../../types.js';
import { kstParts } from '../briefing/time.js';
import { periodLabel, previousMonth } from './match.js';

// 동향 탭(SCR-195)과 홈의 한 줄이 읽는 모양 — 받은 호 목록·최신 호 카드·기다리는 일 (API-171, 수출입 동향 설계 3단계)

type Tone = 'up' | 'down' | 'muted';
export type TradeCard = {
  kpis: { label: string; value: string; sub: [string, Tone][] }[];
  headline: string | null;
  pair: string | null;
  counts: { claims: number; links: number; changes: number; nih: number; pages: number };
};
export type TradeReleaseView = { period: string; label: string; publishedDate: string; pdfFileId: number | null; analysisFileId: number | null; read: boolean };
export type TradePending = { period: string; label: string; state: 'waiting' | 'analyzing' | 'failed'; checks: readonly string[]; laterCheck: string; message: string | null };
export type TradeView = { releases: TradeReleaseView[]; latest: (TradeReleaseView & { card: TradeCard | null }) | null; pending: TradePending | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** 해부 JSON에서 카드에 쓸 것만 — 서버의 대조를 통과해 저장된 것이라 모양은 믿되, 빠진 칸은 비운다 */
function cardOf(json: string | null): TradeCard | null {
  if (!json) return null;
  let d: unknown;
  try {
    d = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(d) || !isRecord(d.meta)) return null;
  const first = arr(d.meta.cards).find(isRecord);
  const claim = first ? arr(d.claims).find((c) => isRecord(c) && c.id === first.id) : undefined;
  const quote = isRecord(claim) && isRecord(claim.claim) ? str(claim.claim.quote) : null;
  const kpis = arr(d.meta.kpis)
    .filter(isRecord)
    .slice(0, 4)
    .map((k) => ({
      label: str(k.label) ?? '',
      value: str(k.value) ?? '',
      sub: arr(k.sub)
        .filter((s): s is unknown[] => Array.isArray(s) && typeof s[0] === 'string')
        .map((s): [string, Tone] => [s[0] as string, s[1] === 'up' || s[1] === 'down' ? s[1] : 'muted']),
    }));
  return {
    kpis,
    headline: quote,
    pair: first ? str(first.pair) : null,
    counts: { claims: arr(d.claims).length, links: arr(d.links).length, changes: arr(d.changes).length, nih: arr(d.nih).length, pages: arr(d.pages).length },
  };
}

export function tradeView(user: SessionUser, now = Date.now()): TradeView {
  const rows = db.select().from(tradeReleases).where(eq(tradeReleases.source, TRADE.SOURCE)).orderBy(desc(tradeReleases.period)).all();
  const fileIds = rows.flatMap((r) => [r.fileId, r.analysisFileId]).filter((id): id is number => id !== null);
  // 휴지통에 간 파일은 없는 것으로 — 열 수 없는 id를 내주지 않는다
  const alive = new Set(fileIds.length ? db.select({ id: files.id, deletedAt: files.deletedAt }).from(files).where(inArray(files.id, fileIds)).all().filter((f) => f.deletedAt === null).map((f) => f.id) : []);
  const opened = new Set(
    fileIds.length
      ? db.select({ fileId: userFileState.fileId, at: userFileState.lastOpenedAt }).from(userFileState).where(and(eq(userFileState.userId, user.id), inArray(userFileState.fileId, fileIds))).all().filter((s) => s.at !== null).map((s) => s.fileId)
      : [],
  );
  const live = (id: number | null) => (id !== null && alive.has(id) ? id : null);
  const releases: TradeReleaseView[] = rows.map((r) => {
    const pdfFileId = live(r.fileId);
    const analysisFileId = live(r.analysisFileId);
    // 해부가 있으면 해부를, 없으면 원문을 열었는지로 본다
    const key = analysisFileId ?? pdfFileId;
    return { period: r.period, label: periodLabel(r.period), publishedDate: r.publishedDate, pdfFileId, analysisFileId, read: key !== null && opened.has(key) };
  });
  const newest = rows[0];
  const latest = newest && releases[0] ? { ...releases[0], card: releases[0].analysisFileId !== null ? cardOf(newest.analysisJson) : null } : null;

  let pending: TradePending | null = null;
  const base = { checks: TRADE.DAY1_CHECKS, laterCheck: TRADE.LATER_CHECK };
  const running = db.select().from(tradeJobs).where(eq(tradeJobs.status, 'running')).orderBy(desc(tradeJobs.id)).limit(1).get();
  const { month, date } = kstParts(now);
  const target = previousMonth(month);
  if (running) {
    pending = { period: running.period, label: periodLabel(running.period), state: 'analyzing', message: null, ...base };
  } else if (Number(date.slice(8, 10)) <= TRADE.LAST_DAY && !rows.some((r) => r.period === target)) {
    pending = { period: target, label: periodLabel(target), state: 'waiting', message: null, ...base };
  } else if (user.role === 'admin' && newest && newest.analysisJson === null) {
    // 해부를 못 만든 호 — 할 수 있는 일이 있는 관리자에게만 이유를 보인다
    const job = db.select().from(tradeJobs).where(eq(tradeJobs.period, newest.period)).orderBy(desc(tradeJobs.id)).limit(1).get();
    if (job && (job.status === 'error' || job.status === 'missing')) pending = { period: newest.period, label: periodLabel(newest.period), state: 'failed', message: job.message, ...base };
  }
  return { releases, latest, pending };
}
