import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import { api, ApiError } from '../../lib/api';
import {
  BRIEFING_READ_EVENT,
  BRIEFING_STATUS_POLL_MS,
  kstTime,
  kstToday,
  longDate,
  shortDate,
  SLOT_SHORT,
  slotName,
  STAGE_LABEL,
  STAGE_ORDER,
  type BriefingRun,
  type BriefingStatus,
  type EditionSummary,
} from '../../lib/briefing';
import { confirmDialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';

type Props = {
  onOpenFile: (fileId: number) => void;
  /** 설정 패널의 자동 생성 설정으로 */
  onOpenSettings: () => void;
  /** 수집 목록 문서를 연다 */
  onOpenSources: () => void;
};

type EditionPage = { editions: EditionSummary[]; nextBefore: string | null };

const SLOT_FULL: Record<BriefingRun['slot'], string> = { morning: '아침판', noon: '점심판', evening: '저녁판', adhoc: '수시판' };

function runLine(r: BriefingRun): string {
  const when = kstTime(r.finishedAt ?? r.startedAt);
  if (r.status === 'ok') return `${SLOT_FULL[r.slot]} ${r.itemCount ?? 0}건 · ≈ $${r.costUsd.toFixed(2)} · ${when}`;
  if (r.status === 'skipped') return `${r.message ?? '건너뜀'} · ${when}`;
  if (r.status === 'cancelled') return `멈춤 · ${when}`;
  if (r.status === 'error') return `실패: ${r.message ?? '알 수 없는 오류'} · ${when}`;
  return `만드는 중 · ${when}`;
}

const STATUS_COLOR: Record<BriefingRun['status'], string> = {
  ok: 'text-slate-300',
  skipped: 'text-slate-500',
  cancelled: 'text-slate-500',
  error: 'text-red-400',
  running: 'text-sky-300',
};

function elapsedText(sec: number): string {
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

/** 오늘 카드의 읽음 상태 — 안 읽음 / 핵심 n 남음 / 다 읽음 */
function stateText(e: EditionSummary): { text: string; cls: string } {
  if (e.state === 'unread') return { text: '안 읽음', cls: 'text-red-400' };
  if (e.state === 'done') return { text: '다 읽음', cls: 'text-slate-500' };
  return { text: `핵심 ${e.leadCount - e.leadRead} 남음`, cls: 'text-slate-400' };
}

// SCR-190: 뉴스 브리핑 패널 (관리자만, v0.43 개편) — 회차의 보관함. 만들기·진행 → 오늘 회차 → 지난 브리핑(날짜별) → 자동·비용.
// 실행 중에만 2초마다 상태를 다시 읽는다. 패널을 닫았다 열어도 같은 상태가 보인다(서버 실행 기록이 원천)
export default function BriefingPanel({ onOpenFile, onOpenSettings, onOpenSources }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const [page, setPage] = useState<EditionPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [starting, setStarting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 실패 출처 목록을 펼친 실행 — 새 실행이 끝나면 저절로 접힌다 */
  const [failedOpenFor, setFailedOpenFor] = useState<number | null>(null);
  const [runs, setRuns] = useState<BriefingRun[] | null>(null);
  /** 진행 카드의 걸린 시간을 매초 다시 그리려고 */
  const [, setTick] = useState(0);
  /** 이 화면에서 지켜보던 실행 — 끝나는 순간을 알아채 토스트를 띄운다 */
  const watchingRef = useRef<number | null>(null);
  // 부모가 매 렌더 새 함수를 넘겨도 load가 다시 만들어지지 않게 — 그러면 첫 로드가 무한히 반복된다
  const openRef = useRef(onOpenFile);
  openRef.current = onOpenFile;

  /** 회차 목록 첫 쪽(오늘부터 7일). 더 본 쪽은 버린다 — 새 회차·읽음이 바뀌면 처음부터 다시 */
  const loadEditions = useCallback(async () => {
    const r = await api<EditionPage>('/briefing/editions').catch(() => null);
    if (r) setPage(r);
  }, []);

  const load = useCallback(async () => {
    const s = await api<BriefingStatus>('/briefing/status').catch(() => null);
    if (!s) return;
    setStatus(s);
    if (s.running) {
      watchingRef.current = s.running.id;
      return;
    }
    const watched = watchingRef.current;
    if (watched !== null && s.last?.id === watched) {
      watchingRef.current = null;
      const last = s.last;
      if (last.status === 'ok' && last.fileId) {
        const fileId = last.fileId;
        void loadEditions();
        toast(`${SLOT_FULL[last.slot]} ${last.itemCount ?? 0}건을 만들었어요`, 'success', { action: { label: '열기', onAction: () => openRef.current(fileId) } });
      } else if (last.status === 'error') {
        toast(`브리핑을 만들지 못했어요 — ${last.message ?? ''}`, 'error');
      } else if (last.status === 'cancelled') {
        toast('브리핑 만들기를 멈췄어요', 'info');
      } else if (last.status === 'skipped') {
        toast(last.message ?? '새 기사가 없어요', 'info');
      }
      setRuns(null); // 실행 기록을 펼쳐 둔 상태였으면 다시 받게
    }
  }, [loadEditions]);

  useEffect(() => {
    void load();
    void loadEditions();
  }, [load, loadEditions]);

  // 회차 화면에서 기사를 읽으면 읽음 상태가 바뀐다 — 연달아 읽어도 한 번만 다시 받게 잠깐 모은다
  useEffect(() => {
    let timer = 0;
    const onRead = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadEditions(), 800);
    };
    window.addEventListener(BRIEFING_READ_EVENT, onRead);
    return () => {
      window.removeEventListener(BRIEFING_READ_EVENT, onRead);
      window.clearTimeout(timer);
    };
  }, [loadEditions]);

  // 실행 중일 때만 다시 읽는다 — 평소에는 한 번 읽고 끝
  const running = status?.running ?? null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void load(), BRIEFING_STATUS_POLL_MS);
    const tick = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, [running, load]);

  async function start(force = false) {
    setStarting(true);
    try {
      const r = await api<{ run: BriefingRun }>('/briefing/runs', { method: 'POST', body: JSON.stringify(force ? { force: true } : {}) });
      watchingRef.current = r.run.id;
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BRIEFING_RUNNING') {
        await load(); // 이미 도는 실행(자동 포함)의 진행을 이어서 보여 준다
      } else if (err instanceof ApiError && err.code === 'BRIEFING_BUDGET_EXCEEDED') {
        const ok = await confirmDialog('이번 달 한도를 넘었어요', {
          message: `이번 달 브리핑 비용이 한도${status ? `($${status.monthBudgetUsd})` : ''}에 닿았습니다. 그래도 만들까요?`,
          confirmLabel: '그래도 만들기',
        });
        if (ok) await start(true);
      } else {
        toast(err instanceof ApiError ? err.message : '시작하지 못했어요', 'error');
      }
    } finally {
      setStarting(false);
    }
  }

  async function loadMore() {
    if (!page?.nextBefore) return;
    setLoadingMore(true);
    const r = await api<EditionPage>(`/briefing/editions?before=${page.nextBefore}`).catch(() => null);
    setLoadingMore(false);
    if (r) setPage({ editions: [...page.editions, ...r.editions], nextBefore: r.nextBefore });
  }

  async function showRuns() {
    setMenuOpen(false);
    const r = await api<{ runs: BriefingRun[] }>('/briefing/runs?limit=30').catch(() => null);
    setRuns(r?.runs ?? []);
  }

  if (!status) return <p className="px-4 py-4 text-sm text-slate-600">불러오는 중…</p>;

  const today = kstToday();
  const editions = page?.editions ?? [];
  const todays = editions.filter((e) => e.editionDate === today);
  const pastDays: { date: string; items: EditionSummary[] }[] = [];
  for (const e of editions) {
    if (e.editionDate === today) continue;
    const day = pastDays.at(-1);
    if (day?.date === e.editionDate) day.items.push(e);
    else pastDays.push({ date: e.editionDate, items: [e] });
  }
  const last = status.last;
  const nextAutoToday = status.autoEnabled && status.nextAutoAt !== null && kstToday(status.nextAutoAt) === today && !running;

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto pb-8">
      {/* 설정 단추 — 자동 생성 설정 · 수집 목록 · 실행 기록 */}
      <div className="flex justify-end px-2">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="브리핑 설정"
          aria-expanded={menuOpen}
          className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-900 hover:text-slate-300"
        >
          <Icon name="sliders" size={18} />
        </button>
      </div>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div role="menu" className="absolute right-3 top-10 z-20 w-48 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 text-sm shadow-lg">
            {[
              { label: '자동 생성 설정', on: () => (setMenuOpen(false), onOpenSettings()) },
              { label: '수집 목록 열기', on: () => (setMenuOpen(false), onOpenSources()) },
              { label: '실행 기록 보기', on: () => void showRuns() },
            ].map((m) => (
              <button key={m.label} role="menuitem" onClick={m.on} className="block w-full px-3 py-2.5 text-left text-slate-300 hover:bg-slate-800">
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="space-y-6 px-4">
        <section className="space-y-2">
          {!status.configured && (
            <p className="rounded-md border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
              AI 키가 연결되지 않아 브리핑을 만들 수 없어요. 서버의 .env에 ANTHROPIC_API_KEY를 넣고 다시 시작하면 켜집니다.
            </p>
          )}
          {running ? (
            <ProgressCard run={running} onStopped={() => void load()} />
          ) : (
            <>
              <button
                onClick={() => void start()}
                disabled={!status.configured || starting}
                className="h-12 w-full rounded-xl bg-sky-600 text-[15px] font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {starting ? '시작하는 중…' : '지금 브리핑 만들기'}
              </button>
              <p className="text-center text-xs text-slate-500">{kstTime(status.nextSinceAt, kstToday(status.nextSinceAt) !== today)} 이후 새 기사로 · 약 1~2분</p>
            </>
          )}
          {!running && last && last.status !== 'ok' && (
            <p className={`text-xs ${STATUS_COLOR[last.status]}`}>최근: {runLine(last)}</p>
          )}
          {!running && last && last.failedSources.length > 0 && (
            <div className="text-xs">
              <button onClick={() => setFailedOpenFor((v) => (v === last.id ? null : last.id))} className="text-amber-400 underline">
                지난 실행에서 출처 {last.failedSources.length}곳을 받지 못했어요
              </button>
              {failedOpenFor === last.id && (
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded border border-slate-800 p-2 text-[11px] text-slate-500">
                  {last.failedSources.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-baseline gap-1.5">
            <h3 className="text-sm font-bold text-slate-200">오늘</h3>
            <span className="text-xs text-slate-500">{longDate(today)}</span>
          </div>
          <div className="space-y-1.5">
            {nextAutoToday && status.nextAutoAt !== null && (
              <div className="flex min-h-14 items-center gap-2.5 rounded-xl border border-slate-800 px-3 py-2">
                <SlotChip label={SLOT_SHORT[status.nextAutoSlot ?? 'adhoc']} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-semibold text-slate-400">{SLOT_FULL[status.nextAutoSlot ?? 'adhoc']} (자동)</span>
                  <span className="text-xs text-slate-500">{kstTime(status.nextAutoAt, false)}에 만들기 시작</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-slate-500">예정</span>
              </div>
            )}
            {page && todays.length === 0 && !nextAutoToday && <p className="text-xs text-slate-600">오늘 만든 브리핑이 아직 없어요.</p>}
            {todays.map((e, i) => {
              const st = stateText(e);
              return (
                <button
                  key={e.fileId}
                  onClick={() => onOpenFile(e.fileId)}
                  className={`flex min-h-14 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition hover:bg-slate-900 ${
                    i === 0 ? 'border-sky-800' : 'border-slate-800'
                  }`}
                >
                  <SlotChip label={SLOT_SHORT[e.slot]} accent={i === 0} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-semibold text-slate-200">{slotName(e.slot, e.label)}</span>
                    <span className="text-xs text-slate-500">
                      {e.itemCount}건{e.leadCount > 0 ? ` · 핵심 ${e.leadCount}` : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 text-xs font-semibold ${st.cls}`}>{st.text}</span>
                </button>
              );
            })}
          </div>
        </section>

        {pastDays.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-200">지난 브리핑</h3>
            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
              {pastDays.map((d) => (
                <div key={d.date} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                  <span className="w-[4.6rem] shrink-0 text-[13px] font-semibold text-slate-300">{shortDate(d.date)}</span>
                  <div className="flex flex-wrap gap-1">
                    {/* 그날 이른 회차부터 — 목록은 최신순으로 오므로 뒤집는다 */}
                    {[...d.items].reverse().map((e) => (
                      <button
                        key={e.fileId}
                        onClick={() => onOpenFile(e.fileId)}
                        title={`${slotName(e.slot, e.label)} · ${e.itemCount}건`}
                        className={`h-[30px] rounded-lg px-2.5 text-xs transition ${
                          e.state === 'done' ? 'bg-slate-900 text-slate-500 hover:text-slate-300' : 'bg-sky-950/60 font-semibold text-sky-300 hover:bg-sky-900/60'
                        }`}
                      >
                        {e.slot === 'adhoc' ? kstTime(e.createdAt, false) : SLOT_SHORT[e.slot]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {page?.nextBefore && (
              <button onClick={() => void loadMore()} disabled={loadingMore} className="mt-1 h-11 w-full text-[13px] text-slate-400 hover:text-slate-200">
                {loadingMore ? '불러오는 중…' : '더 보기'}
              </button>
            )}
          </section>
        )}

        {runs && (
          <section>
            <div className="mb-2 flex items-center">
              <h3 className="flex-1 text-sm font-bold text-slate-200">실행 기록</h3>
              <button onClick={() => setRuns(null)} className="text-xs text-slate-500 hover:text-slate-300">
                접기
              </button>
            </div>
            <ul className="space-y-1.5">
              {runs.length === 0 && <li className="text-xs text-slate-600">기록이 없습니다.</li>}
              {runs.map((r) => (
                <li key={r.id} className={`text-[11px] leading-snug ${STATUS_COLOR[r.status]}`}>
                  <span className="text-slate-600">{r.trigger === 'auto' ? '자동' : '버튼'} · </span>
                  {runLine(r)}
                  {r.finishedAt && r.status !== 'skipped' && r.status !== 'cancelled' && <span className="text-slate-600"> · {Math.round((r.finishedAt - r.startedAt) / 1000)}초</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-1 border-t border-slate-800 pt-4 text-xs text-slate-500">
          <button onClick={onOpenSettings} className="block text-left hover:text-slate-300">
            {status.autoEnabled && status.nextAutoAt !== null ? (
              <>
                자동 생성 켜짐 · 다음 <b className="text-slate-300">{kstTime(status.nextAutoAt, kstToday(status.nextAutoAt) !== today)} {SLOT_FULL[status.nextAutoSlot ?? 'adhoc']}</b>
              </>
            ) : status.autoEnabled ? (
              '자동 생성 켜짐 · 켜 둔 회차가 없어요'
            ) : (
              '자동 생성 꺼짐 · 설정에서 켜기'
            )}
          </button>
          <p>
            이번 달 비용 ≈ ${status.monthCostUsd.toFixed(2)} / ${status.monthBudgetUsd}
          </p>
        </section>
      </div>
    </div>
  );
}

/** 자동 회차 시작 시각 → 칸. 06·11·17시 — 서버 BRIEFING.AUTO_SLOTS와 같은 순서 */
function SlotChip({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span className={`w-10 shrink-0 rounded-lg py-1 text-center text-xs font-bold ${accent ? 'bg-sky-950/60 text-sky-300' : 'bg-slate-900 text-slate-500'}`}>
      {label}
    </span>
  );
}

/** 진행 카드 — 지금 단계와 n/m, 걸린 시간, 막대, 단계 줄 */
function ProgressCard({ run, onStopped }: { run: BriefingRun; onStopped: () => void }) {
  const [showLog, setShowLog] = useState(false);
  const stage = run.stage ?? 'collect';
  const waiting = run.live?.waiting ?? [];
  const log = run.live?.log ?? [];
  // 받는 곳이 응답하지 않아 몇 분째 멈춘 실행을 사람이 끝낼 수 있게 (2026-10-02, 수집 63/67에서 멈춤)
  async function stop() {
    const ok = await confirmDialog('브리핑 만들기를 멈출까요?', {
      message: '만든 내용은 저장되지 않아요. 이미 쓴 AI 비용은 이번 달 비용에 남아요.',
      confirmLabel: '멈추기',
      cancelLabel: '계속 만들기',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/briefing/runs/${run.id}/cancel`, { method: 'POST' });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '멈추지 못했어요', 'error');
    }
    onStopped();
  }
  const at = STAGE_ORDER.indexOf(stage);
  const pct = run.progressTotal > 0 ? Math.round((run.progressDone / run.progressTotal) * 100) : 5;
  const elapsed = Math.max(0, Math.round((Date.now() - run.startedAt) / 1000));
  return (
    <div className="space-y-2 rounded-xl border border-sky-800 bg-sky-950/40 px-3.5 py-3">
      <p className="text-sm font-semibold text-sky-200">
        {STAGE_LABEL[stage]}
        {run.progressTotal > 0 && ` ${run.progressDone}/${run.progressTotal}`}
        <span className="ml-1 text-xs font-normal text-sky-400/80">· {elapsedText(elapsed)}</span>
      </p>
      <div className="h-1.5 overflow-hidden rounded bg-sky-900/60">
        <div className="h-full bg-sky-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-1 text-[11px] text-slate-500">
        {STAGE_ORDER.map((s, i) => (
          <span key={s} className={i < at ? 'text-sky-400' : i === at ? 'font-bold text-sky-200' : ''}>
            {STAGE_LABEL[s]}
            {i < at ? ' ✓' : ''}
            {i < STAGE_ORDER.length - 1 && <span className="ml-1 text-slate-600">·</span>}
          </span>
        ))}
      </p>
      {/* 8초 넘게 응답이 없는 출처 — 어디서 막혔는지 바로 보이게 */}
      {waiting.length > 0 && (
        <p className="text-[11px] leading-relaxed text-amber-300/90">
          기다리는 중: {waiting.map((w) => `${w.name} (${w.seconds}초)`).join(' · ')}
        </p>
      )}
      <p className="text-[11px] text-slate-500">{run.trigger === 'auto' ? '자동 생성' : '버튼으로 시작'} · 화면을 닫아도 계속 만듭니다</p>
      <div className="flex items-center gap-2">
        {log.length > 0 && (
          <button onClick={() => setShowLog((v) => !v)} className="min-h-9 text-[11px] text-slate-400 underline hover:text-slate-200">
            진행 기록 {showLog ? '접기' : '보기'}
          </button>
        )}
        <button
          // 오른쪽 끝 — 진행 기록이 없을 때도 같은 자리
          onClick={() => void stop()}
          className="ml-auto flex min-h-9 shrink-0 items-center rounded-lg border border-slate-700 px-3 text-xs text-slate-300 transition hover:border-red-800 hover:text-red-300"
        >
          중지
        </button>
      </div>
      {showLog && (
        <ol className="m-0 max-h-40 list-none space-y-0.5 overflow-y-auto p-0 text-[11px] text-slate-400">
          {log.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-slate-600">{elapsedText(Math.max(0, Math.round((l.at - run.startedAt) / 1000)))}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
