import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { kstTime, type AutoSchedule, type AutoSlot, type BriefingStatus } from '../../lib/briefing';

const SLOTS: { slot: AutoSlot; label: string }[] = [
  { slot: 'morning', label: '아침' },
  { slot: 'noon', label: '점심' },
  { slot: 'evening', label: '저녁' },
];

type Props = {
  /** 수집 목록 문서를 연다 — 고치는 곳은 설정이 아니라 그 문서다 */
  onOpenSources: () => void;
};

// SCR-147: 설정 → 뉴스 브리핑 (관리자만) — 자동 생성 켜기/끄기와 회차별 켜기·시각(v0.43), 이번 달 비용·한도 표시
export default function BriefingSettings({ onOpenSources }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<BriefingStatus>('/briefing/status').then(setStatus, () => setError('상태를 불러오지 못했어요'));
  }, []);

  /** 보낸 것만 바뀐다 — 실패하면(순서가 어긋난 시각 등) 화면을 서버 값으로 되돌린다 */
  async function save(patch: { autoEnabled?: boolean; schedule?: AutoSchedule }) {
    setError(null);
    try {
      const r = await api<Pick<BriefingStatus, 'autoEnabled' | 'schedule' | 'nextAutoAt' | 'nextAutoSlot'>>('/briefing/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setStatus((s) => (s ? { ...s, ...r } : s));
    } catch (err) {
      // 검증 오류 앞의 칸 이름("schedule: ")은 떼고 보여 준다
      setError(err instanceof ApiError ? err.message.replace(/^[\w.]+: /, '') : '바꾸지 못했어요');
      void api<BriefingStatus>('/briefing/status').then(setStatus, () => {});
    }
  }
  const setSlot = (slot: AutoSlot, patch: Partial<AutoSchedule[AutoSlot]>) => {
    if (!status) return;
    const schedule = { ...status.schedule, [slot]: { ...status.schedule[slot], ...patch } };
    setStatus({ ...status, schedule });
    void save({ schedule });
  };

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">뉴스 브리핑</h3>
      {status && (
        <>
          <label className="mt-2 flex items-start gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={status.autoEnabled}
              disabled={!status.configured}
              onChange={(e) => void save({ autoEnabled: e.target.checked })}
              className="mt-0.5 accent-slate-400"
            />
            <span>
              자동 생성
              <span className="block text-slate-600">
                아래에서 켠 회차를 정한 시각(한국시간)에 만들기 시작합니다. 서버가 꺼져 있었으면 2시간 안에 늦게라도 시작해요. 실패한 회차는 다시 시도하지 않으니 패널의 버튼으로 만드세요
                {status.autoEnabled && status.nextAutoAt ? ` · 다음 ${kstTime(status.nextAutoAt)}` : ''}
              </span>
            </span>
          </label>
          {/* 회차마다 켜기·시각 — 사람마다 하루 리듬이 달라 고정 시각(06:30·11:30·17:30)이 안 맞았다 (v0.43, 사용자 요청) */}
          <div className={`mt-2 flex flex-col gap-1.5 pl-6 ${status.autoEnabled ? '' : 'opacity-50'}`}>
            {SLOTS.map(({ slot, label }) => (
              <div key={slot} className="flex items-center gap-2 text-xs text-slate-400">
                <label className="flex min-h-9 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={status.schedule[slot].on}
                    disabled={!status.autoEnabled}
                    onChange={(e) => setSlot(slot, { on: e.target.checked })}
                    className="accent-slate-400"
                  />
                  {label}
                </label>
                <input
                  type="time"
                  value={status.schedule[slot].at}
                  max="21:59"
                  disabled={!status.autoEnabled || !status.schedule[slot].on}
                  // 다 고른 뒤(포커스를 떠날 때) 저장한다 — 시·분을 고르는 도중의 값마다 순서 검사에 걸리지 않게
                  onChange={(e) => setStatus({ ...status, schedule: { ...status.schedule, [slot]: { ...status.schedule[slot], at: e.target.value } } })}
                  onBlur={(e) => e.target.value && setSlot(slot, { at: e.target.value })}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 disabled:opacity-50"
                />
              </div>
            ))}
            <p className="text-[11px] text-slate-600">아침 → 점심 → 저녁 순서로, 21:59까지 고를 수 있어요</p>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            이번 달 ≈ ${status.monthCostUsd.toFixed(2)} / 한도 ${status.monthBudgetUsd} — 한도에 닿으면 자동 생성이 멈춥니다
          </p>
          <button onClick={onOpenSources} className="mt-2 text-xs text-slate-400 underline hover:text-slate-200">
            수집 목록 열기 (RSS 주소·검색어)
          </button>
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
