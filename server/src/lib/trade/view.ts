import { and, desc, eq, inArray } from 'drizzle-orm';
import { HOME, TRADE } from '../../constants.js';
import { db } from '../../db/index.js';
import { files, tradeJobs, tradeReleases, userFileState } from '../../db/schema.js';
import type { SessionUser } from '../../types.js';
import { kstParts } from '../briefing/time.js';
import { addMonths, periodLabel, previousMonth } from './match.js';

// 동향 탭(SCR-195)과 홈의 한 줄이 읽는 모양 — 받은 호 목록·최신 호 카드·기다리는 일 (API-171, 수출입 동향 설계 3·4단계)

/** 최신 호 큰 카드 — 정리본의 숫자 칸과 결론 줄. format은 정리본(2)인지 v0.68~0.70의 해부(1)인지 */
export type TradeCard = { format: 1 | 2; kpis: { label: string; value: string; lines: string[] }[]; points: string[]; trend: TradeTrend | null; movers: TradeMover[] };
/** 최근 달들의 수출·수입·무역수지(억 달러) — 정리본의 그래프와 같은 숫자(대조를 통과한 원문 표 줄). periods는 각 칸의 달(YYYY-MM), 마지막이 이 호 */
export type TradeTrend = { periods: string[]; exp: number[]; imp: number[]; bal: number[] };
/** 작년 같은 달보다 가장 크게 움직인 품목 — 금액(억 달러)과 증감률(%) */
export type TradeMover = { name: string; amt: number; yoy: number };
export type TradeReleaseView = { period: string; label: string; publishedDate: string; pdfFileId: number | null; analysisFileId: number | null; read: boolean };
export type TradePending = { period: string; label: string; state: 'waiting' | 'analyzing' | 'failed'; checks: readonly string[]; laterCheck: string; message: string | null };
export type TradeView = { releases: TradeReleaseView[]; latest: (TradeReleaseView & { card: TradeCard | null }) | null; pending: TradePending | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** 저장된 자료에서 카드에 쓸 것만 — 서버의 대조를 통과해 저장된 것이라 모양은 믿되, 빠진 칸은 비운다.
 *  v0.68~0.70에 저장된 해부(format 없음)도 다시 만들기 전까지는 읽어야 한다 */
const nums = (v: unknown): number[] | null => (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);

/** 정리본의 13개월 숫자 — 세 줄의 길이가 같을 때만. 달 이름("’25.10")은 화면용이라 쓰지 않고, 이 호의 달에서 거꾸로 세어 YYYY-MM으로 준다 */
function trendOf(d: Record<string, unknown>, period: string | null): TradeTrend | null {
  if (!isRecord(d.series) || period === null || !/^\d{4}-\d{2}$/.test(period)) return null;
  const exp = nums(d.series.exp);
  const imp = nums(d.series.imp);
  const bal = nums(d.series.bal);
  if (!exp || !imp || !bal || exp.length !== imp.length || exp.length !== bal.length) return null;
  return { periods: exp.map((_, i) => addMonths(period, i - (exp.length - 1))), exp, imp, bal };
}

function moversOf(d: Record<string, unknown>): TradeMover[] {
  return arr(d.items)
    .filter(isRecord)
    .flatMap((it) => {
      const name = str(it.name);
      return name !== null && typeof it.amt === 'number' && typeof it.yoy === 'number' ? [{ name, amt: it.amt, yoy: it.yoy }] : [];
    })
    .sort((a, b) => Math.abs(b.yoy) - Math.abs(a.yoy))
    .slice(0, HOME.TRADE_MOVERS);
}

function cardOf(json: string | null): TradeCard | null {
  if (!json) return null;
  let d: unknown;
  try {
    d = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(d) || !isRecord(d.meta)) return null;
  if (d.format === 2) {
    const kpis = arr(d.tiles)
      .filter(isRecord)
      .slice(0, 4)
      .map((t) => ({ label: str(t.label) ?? '', value: `${str(t.value) ?? ''}${str(t.unit) ?? ''}`, lines: arr(t.lines).filter((l): l is string => typeof l === 'string') }));
    const points = arr(d.takeaways)
      .filter(isRecord)
      .map((t) => str(t.lead))
      .filter((l): l is string => l !== null)
      .slice(0, 4);
    return { format: 2, kpis, points, trend: trendOf(d, str(d.meta.period)), movers: moversOf(d) };
  }
  const first = arr(d.meta.cards).find(isRecord);
  const claim = first ? arr(d.claims).find((c) => isRecord(c) && c.id === first.id) : undefined;
  const quote = isRecord(claim) && isRecord(claim.claim) ? str(claim.claim.quote) : null;
  const kpis = arr(d.meta.kpis)
    .filter(isRecord)
    .slice(0, 4)
    .map((k) => ({
      label: str(k.label) ?? '',
      value: str(k.value) ?? '',
      lines: [arr(k.sub).filter((x): x is unknown[] => Array.isArray(x) && typeof x[0] === 'string').map((x) => x[0] as string).join('')].filter((l) => l !== ''),
    }));
  return { format: 1, kpis, points: [quote, first ? str(first.pair) : null].filter((l): l is string => l !== null), trend: null, movers: [] };
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
    // 정리본이 있으면 정리본을, 없으면 원문을 열었는지로 본다
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
    // 정리본을 못 만든 호 — 할 수 있는 일이 있는 관리자에게만 이유를 보인다
    const job = db.select().from(tradeJobs).where(eq(tradeJobs.period, newest.period)).orderBy(desc(tradeJobs.id)).limit(1).get();
    if (job && (job.status === 'error' || job.status === 'missing')) pending = { period: newest.period, label: periodLabel(newest.period), state: 'failed', message: job.message, ...base };
  }
  return { releases, latest, pending };
}
