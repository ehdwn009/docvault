import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BRIEFING_STATUS_POLL_MS, kstTime, STAGE_LABEL, type BriefingRun, type BriefingStatus } from '../../lib/briefing';
import { confirmDialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';

type Props = {
  onOpenFile: (fileId: number) => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  /** 새 회차가 생겼다 — 트리를 다시 받아 폴더에 보이게 */
  onCreated: () => void;
};

const SLOT_LABEL: Record<BriefingRun['slot'], string> = { morning: '아침판', noon: '점심판', evening: '저녁판', adhoc: '수시판' };

/** "뉴스 브리핑 2026-10-01 저녁.json" → "10/1 저녁" */
function shortName(name: string): string {
  const m = /(\d{4})-(\d{2})-(\d{2}) (.+?)(?: \(\d+\))?\.json$/.exec(name);
  return m ? `${Number(m[2])}/${Number(m[3])} ${m[4]}` : name;
}

function runLine(r: BriefingRun): string {
  const when = kstTime(r.finishedAt ?? r.startedAt);
  if (r.status === 'ok') return `${SLOT_LABEL[r.slot]} ${r.itemCount ?? 0}건 · ≈ $${r.costUsd.toFixed(2)} · ${when}`;
  if (r.status === 'skipped') return `${r.message ?? '건너뜀'} · ${when}`;
  if (r.status === 'error') return `실패: ${r.message ?? '알 수 없는 오류'} · ${when}`;
  return `만드는 중 · ${when}`;
}

const STATUS_COLOR: Record<BriefingRun['status'], string> = {
  ok: 'text-slate-300',
  skipped: 'text-slate-500',
  error: 'text-red-400',
  running: 'text-sky-300',
};

// SCR-190: 뉴스 브리핑 패널 (관리자만) — 만들기 버튼·진행·최근 결과·이번 달 비용·최근 회차·실행 기록.
// 실행 중에만 2초마다 상태를 다시 읽는다. 패널을 닫았다 열어도 같은 상태가 보인다(서버 실행 기록이 원천)
export default function BriefingPanel({ onOpenFile, onOpenFolder, onOpenSettings, onCreated }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const [starting, setStarting] = useState(false);
  /** 실패 출처 목록을 펼친 실행 — 새 실행이 끝나면 저절로 접힌다 */
  const [failedOpenFor, setFailedOpenFor] = useState<number | null>(null);
  const [runs, setRuns] = useState<BriefingRun[] | null>(null);
  /** 이 화면에서 지켜보던 실행 — 끝나는 순간을 알아채 토스트를 띄운다 */
  const watchingRef = useRef<number | null>(null);
  // 부모가 매 렌더 새 함수를 넘겨도 load가 다시 만들어지지 않게 — 그러면 첫 로드가 무한히 반복된다
  const handlersRef = useRef({ onCreated, onOpenFile });
  handlersRef.current = { onCreated, onOpenFile };

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
        handlersRef.current.onCreated();
        toast(`${SLOT_LABEL[last.slot]} ${last.itemCount ?? 0}건을 만들었어요`, 'success', { action: { label: '열기', onAction: () => handlersRef.current.onOpenFile(fileId) } });
      } else if (last.status === 'error') {
        toast(`브리핑을 만들지 못했어요 — ${last.message ?? ''}`, 'error');
      } else if (last.status === 'skipped') {
        toast(last.message ?? '새 기사가 없어요', 'info');
      }
      setRuns(null); // 실행 기록을 펼쳐 둔 상태였으면 다시 받게
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 실행 중일 때만 다시 읽는다 — 평소에는 한 번 읽고 끝
  const running = status?.running ?? null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void load(), BRIEFING_STATUS_POLL_MS);
    return () => window.clearInterval(id);
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
          message: `이번 달 브리핑 비용이 한도($${status?.monthBudgetUsd ?? 50})에 닿았습니다. 그래도 만들까요?`,
        });
        if (ok) await start(true);
      } else {
        toast(err instanceof ApiError ? err.message : '시작하지 못했어요', 'error');
      }
    } finally {
      setStarting(false);
    }
  }

  async function toggleRuns() {
    if (runs) {
      setRuns(null);
      return;
    }
    const r = await api<{ runs: BriefingRun[] }>('/briefing/runs?limit=30').catch(() => null);
    setRuns(r?.runs ?? []);
  }

  if (!status) return <p className="px-4 py-4 text-sm text-slate-600">불러오는 중…</p>;

  const last = status.last;
  const progress = running && running.progressTotal > 0 ? Math.round((running.progressDone / running.progressTotal) * 100) : null;
  const elapsed = running ? Math.max(0, Math.round((Date.now() - running.startedAt) / 1000)) : 0;

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-2 pb-8">
      <section className="space-y-2">
        {!status.configured && (
          <p className="rounded-md border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
            API 키가 연결되지 않았어요. 서버의 .env에 ANTHROPIC_API_KEY를 넣으면 쓸 수 있습니다.
          </p>
        )}
        {running ? (
          <div className="rounded-md border border-sky-800 bg-sky-950/40 px-3 py-2.5">
            <p className="text-sm text-sky-200">
              {STAGE_LABEL[running.stage ?? 'collect']} 중
              {running.progressTotal > 0 && ` ${running.progressDone}/${running.progressTotal}`}
              <span className="ml-1 text-xs text-sky-400/80">· {elapsed < 60 ? `${elapsed}초` : `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초`}</span>
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded bg-sky-900/60">
              <div className="h-full bg-sky-400 transition-all" style={{ width: `${progress ?? 5}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">{running.trigger === 'auto' ? '자동 생성' : '버튼으로 시작'} · 화면을 닫아도 계속 만듭니다</p>
          </div>
        ) : (
          <button
            onClick={() => void start()}
            disabled={!status.configured || starting}
            className="w-full rounded-md bg-sky-600 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? '시작하는 중…' : '브리핑 만들기'}
          </button>
        )}
        <p className="text-[11px] leading-relaxed text-slate-600">직전 회차 이후의 새 기사로 만듭니다 (최대 24시간).</p>
        {last && (
          <div className={`text-xs ${STATUS_COLOR[last.status]}`}>
            <span>최근: {runLine(last)}</span>
            {last.status === 'ok' && last.fileId && (
              <button onClick={() => onOpenFile(last.fileId!)} className="ml-1.5 text-sky-400 underline">
                열기
              </button>
            )}
            {last.failedSources.length > 0 && (
              <button onClick={() => setFailedOpenFor((v) => (v === last.id ? null : last.id))} className="ml-1.5 text-amber-400 underline">
                출처 {last.failedSources.length}곳 실패
              </button>
            )}
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

      <section className="space-y-1 text-xs text-slate-400">
        <p>
          이번 달 ≈ <span className="text-slate-200">${status.monthCostUsd.toFixed(2)}</span> / ${status.monthBudgetUsd}
        </p>
        <button onClick={onOpenSettings} className="text-left text-slate-500 hover:text-slate-300">
          자동: {status.autoEnabled && status.nextAutoAt ? `켜짐 · 다음 ${kstTime(status.nextAutoAt)}` : '꺼짐 (설정에서 켜기)'}
        </button>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">최근 회차</h3>
        {status.recent.length === 0 ? (
          <p className="mt-2 text-xs text-slate-600">아직 만든 회차가 없습니다.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {status.recent.map((r) => (
              <li key={r.fileId}>
                <button onClick={() => onOpenFile(r.fileId)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-slate-300 transition hover:bg-slate-900">
                  <span className="min-w-0 flex-1 truncate">{shortName(r.name)}</span>
                  <span className="shrink-0 text-[11px] text-slate-600">{r.itemCount}건</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={onOpenFolder} className="mt-2 w-full rounded-md border border-slate-700 py-1.5 text-xs text-slate-300 transition hover:bg-slate-900">
          뉴스 브리핑 폴더 열기
        </button>
      </section>

      <section>
        <button onClick={() => void toggleRuns()} className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-300">
          실행 기록 {runs ? '접기' : '보기'}
        </button>
        {runs && (
          <ul className="mt-2 space-y-1.5">
            {runs.length === 0 && <li className="text-xs text-slate-600">기록이 없습니다.</li>}
            {runs.map((r) => (
              <li key={r.id} className={`text-[11px] leading-snug ${STATUS_COLOR[r.status]}`}>
                <span className="text-slate-600">{r.trigger === 'auto' ? '자동' : '버튼'} · </span>
                {runLine(r)}
                {r.finishedAt && r.status !== 'skipped' && <span className="text-slate-600"> · {Math.round((r.finishedAt - r.startedAt) / 1000)}초</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
