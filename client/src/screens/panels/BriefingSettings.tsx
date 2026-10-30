import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { kstTime, type AutoSchedule, type AutoSlot, type BriefingStatus } from '../../lib/briefing';
import BriefingSubscriptionSettings from './BriefingSubscriptionSettings';

const SLOTS: { slot: AutoSlot; label: string }[] = [
  { slot: 'morning', label: '아침' },
  { slot: 'noon', label: '점심' },
  { slot: 'evening', label: '저녁' },
];

type Props = {
  /** 수집 목록 문서를 연다 — 고치는 곳은 설정이 아니라 그 문서다 */
  onOpenSources: () => void;
};

/** API-139 — 고를 수 있는 일반 계정 한 줄 */
type ReaderCandidate = { id: number; username: string; displayName: string | null; isActive: number; on: boolean };

// SCR-147: 설정 → 뉴스 브리핑 (관리자만) — 자동 생성 켜기/끄기와 회차별 켜기·시각(v0.43), 이번 달 비용·한도 표시, 함께 보는 계정(v0.49), 생성 방식 API/구독(v0.50)
export default function BriefingSettings({ onOpenSources }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readers, setReaders] = useState<ReaderCandidate[] | null>(null);

  useEffect(() => {
    void api<BriefingStatus>('/briefing/status').then(setStatus, () => setError('상태를 불러오지 못했어요'));
    void api<{ users: ReaderCandidate[] }>('/briefing/readers').then((r) => setReaders(r.users), () => {});
  }, []);

  /** 계정 하나 켜기/끄기 — 서버가 돌려준 목록으로 화면을 맞춘다 */
  async function toggleReader(id: number, on: boolean) {
    setError(null);
    try {
      const r = await api<{ users: ReaderCandidate[] }>(`/briefing/readers/${id}`, { method: 'PUT', body: JSON.stringify({ on }) });
      setReaders(r.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '바꾸지 못했어요');
    }
  }

  /** 보낸 것만 바뀐다 — 실패하면(순서가 어긋난 시각 등) 화면을 서버 값으로 되돌린다 */
  async function save(patch: { autoEnabled?: boolean; schedule?: AutoSchedule; readerEnabled?: boolean }) {
    setError(null);
    try {
      const r = await api<Pick<BriefingStatus, 'autoEnabled' | 'schedule' | 'nextAutoAt' | 'nextAutoSlot' | 'readerEnabled' | 'mode'>>('/briefing/settings', {
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
              // 구독 모드는 API 키 없이도 돈다(트리거·마감만) — 키 검사는 api 모드만 (v0.50)
              disabled={!status.configured && status.mode !== 'subscription'}
              onChange={(e) => void save({ autoEnabled: e.target.checked })}
              className="mt-0.5 accent-slate-400"
            />
            <span>
              자동 생성
              <span className="block text-slate-600">
                {status.mode === 'subscription'
                  ? '아래에서 켠 회차의 90분 전에 claude.ai 예약 작업을 켜고, 회차 시각 30분 뒤까지 완성본을 기다려요. 안 오면 패널에 알리고 [지금 만들기]로 만들 수 있어요'
                  : '아래에서 켠 회차를 정한 시각(한국시간)에 만들기 시작합니다. 서버가 꺼져 있었으면 2시간 안에 늦게라도 시작해요. 실패한 회차는 다시 시도하지 않으니 패널의 버튼으로 만드세요'}
                {status.autoEnabled && status.nextAutoAt ? ` · 다음 ${status.mode === 'subscription' ? '예약 작업 ' : ''}${kstTime(status.nextAutoAt)}` : ''}
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
            이번 달 ≈ ${status.monthCostUsd.toFixed(2)} / 한도 ${status.monthBudgetUsd} — 한도에 닿으면 자동 생성이 멈춥니다{status.mode === 'subscription' ? ' (구독 회차는 $0으로, 비용에 쌓이지 않아요)' : ''}
          </p>
          {/* 생성 방식 — API/구독, 연결 열쇠·트리거·체크리스트·연결 확인 (v0.50). 방식이 바뀌면 상태를 다시 읽어 "다음" 표시를 맞춘다 */}
          <BriefingSubscriptionSettings
            mode={status.mode ?? 'api'}
            schedule={status.schedule}
            onModeChange={() => void api<BriefingStatus>('/briefing/status').then(setStatus, () => {})}
          />
          {/* 앱 안 원문 보기 — 기본 꺼짐. 서버에서 추출 품질을 잰 뒤 켠다 (개선 합의안 7장) */}
          <label className="mt-3 flex items-start gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={status.readerEnabled ?? false}
              onChange={(e) => void save({ readerEnabled: e.target.checked })}
              className="mt-0.5 accent-slate-400"
            />
            <span>
              앱 안 원문 보기
              <span className="block text-slate-600">
                기사 화면에서 [요약 | 원문]을 바꿔 가며 원문을 앱 안에서 읽습니다. 누를 때만 받아 오고 저장하지 않으며, 관리자만 봅니다. 켜기 전에 서버에서{' '}
                <code className="text-slate-500">npm run briefing:readcheck -w server</code>로 추출 품질(70% 이상)과 범위(50% 이상)를 재 보세요. 유료 기사나 뽑지 못한 기사는 사이트로 보냅니다
              </span>
            </span>
          </label>
          <button onClick={onOpenSources} className="mt-2 text-xs text-slate-400 underline hover:text-slate-200">
            수집 목록 열기 (RSS 주소·검색어)
          </button>
          {/* 함께 보는 계정 — 고른 일반 계정에만 내 회차가 읽기 전용으로 열린다. 비용은 그대로 내가 낸다 (v0.49, 사용자 결정) */}
          <div className="mt-4 text-xs text-slate-400">
            <p className="font-semibold text-slate-300">함께 보는 계정</p>
            <p className="mt-0.5 text-slate-600">
              고른 계정에 뉴스 브리핑 패널이 생기고, 내가 만든 회차(앞으로 생길 것 포함)를 읽기만 할 수 있어요. 읽음 표시·틀린 곳 알리기는 그 사람 것으로 따로 남고, 만들기·앱 안 원문 보기는 열리지 않아요
            </p>
            {readers && readers.length === 0 && <p className="mt-2 text-slate-600">일반 계정이 아직 없어요 — 관리자 → 사용자 관리에서 계정을 만들면 여기에 나타나요</p>}
            {readers && readers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {readers.map((u) => (
                  <li key={u.id}>
                    <label className={`flex min-h-9 items-center gap-2 ${u.isActive ? '' : 'opacity-50'}`}>
                      <input type="checkbox" checked={u.on} onChange={(e) => void toggleReader(u.id, e.target.checked)} className="accent-slate-400" />
                      <span className="truncate">
                        {u.displayName ?? u.username}
                        {u.displayName && <span className="text-slate-600"> · {u.username}</span>}
                        {!u.isActive && <span className="text-slate-600"> (비활성)</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
