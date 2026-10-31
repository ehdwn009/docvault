import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BRIEFING_TIMER_LABEL_MAX, BRIEFING_TIMERS_MAX, kstTime, timerLabel, type AutoSchedule, type BriefingStatus, type Timer } from '../../lib/briefing';
import { toast } from '../../lib/toast';
import BriefingSubscriptionSettings from './BriefingSubscriptionSettings';

/** 24시간제 HH:MM — 브라우저 time 입력칸은 OS 설정에 따라 오전/오후로 보여 글자 칸을 쓴다 (v0.52, 사용자 요청) */
const AT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 구독 모드에서 켜지는 시각 — 회차 시각 − 90분 (서버 BRIEFING.SUB_LEAD_MS와 같은 값) */
const SUB_LEAD_MIN = 90;
function triggerTimeOf(at: string): string {
  const m = (((Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5)) - SUB_LEAD_MIN) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 새 타이머의 시각 — 마지막 타이머 + 4시간(기사가 쌓이는 리듬), 21:59를 넘으면 06:30 */
function suggestAt(timers: Timer[]): string {
  const last = timers.at(-1);
  if (!last) return '06:30';
  const m = Number(last.at.slice(0, 2)) * 60 + Number(last.at.slice(3, 5)) + 240;
  if (m > 21 * 60 + 59) return '06:30';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

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
  /** 서버가 확인해 준 마지막 타이머 목록 — 잘못 친 시각을 되돌리고, 바뀐 게 없으면 저장하지 않으려고 */
  const savedTimers = useRef<Timer[]>([]);

  useEffect(() => {
    void api<BriefingStatus>('/briefing/status').then((s) => {
      savedTimers.current = s.schedule.timers;
      setStatus(s);
    }, () => setError('상태를 불러오지 못했어요'));
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
      const r = await api<Pick<BriefingStatus, 'autoEnabled' | 'schedule' | 'nextAutoAt' | 'nextAutoSlot' | 'nextAutoLabel' | 'readerEnabled' | 'mode' | 'startedNow'>>('/briefing/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      savedTimers.current = r.schedule.timers;
      setStatus((s) => (s ? { ...s, ...r } : s));
      // 회차 켜기·시각을 바꿨으면 서버가 어떻게 받았는지 바로 알린다 — 지금 켰는지, 아니면 다음은 언제인지 (v0.51)
      if (patch.autoEnabled !== undefined || patch.schedule) {
        if (r.startedNow) toast(`${r.startedNow.label}판 예약 작업을 지금 켰어요${r.startedNow.deadlineAt ? ` — 마감 ${kstTime(r.startedNow.deadlineAt, false)}` : ''}`, 'success');
        else if (r.autoEnabled && r.nextAutoAt) toast(`저장했어요 — 다음 ${r.mode === 'subscription' ? '예약 작업' : '자동 생성'} ${kstTime(r.nextAutoAt)} ${r.nextAutoLabel ?? ''}판`, 'info');
        else if (!r.autoEnabled) toast('자동 생성을 껐어요', 'info');
      }
    } catch (err) {
      // 검증 오류 앞의 칸 이름("schedule: ")은 떼고 보여 준다
      setError(err instanceof ApiError ? err.message.replace(/^[\w.]+: /, '') : '바꾸지 못했어요');
      void api<BriefingStatus>('/briefing/status').then((s) => {
        savedTimers.current = s.schedule.timers;
        setStatus(s);
      }, () => {});
    }
  }
  /** 타이머 목록 한 줄 바꾸기·추가·지우기 — 화면에 먼저 반영하고 저장. 서버가 정렬·검사한 목록으로 다시 맞춘다 */
  const saveTimers = (timers: Timer[]) => {
    if (!status) return;
    const schedule: AutoSchedule = { timers };
    setStatus({ ...status, schedule });
    void save({ schedule });
  };
  const savedOf = (id: string) => savedTimers.current.find((t) => t.id === id);
  /** 저장 — 서버가 확인한 값과 같으면 보내지 않는다(저장마다 토스트·틱·설정 변경 시각이 움직인다) */
  const patchTimer = (id: string, patch: Partial<Timer>) => {
    if (!status) return;
    const saved = savedOf(id);
    if (saved && (Object.keys(patch) as (keyof Timer)[]).every((k) => saved[k] === patch[k])) return;
    saveTimers(status.schedule.timers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };
  /** 시각·이름은 칸을 떠날 때 저장 — 글자를 치는 도중의 값마다 간격 검사에 걸리지 않게. 그 전까지는 화면 값만 바꾼다 */
  const editTimer = (id: string, patch: Partial<Timer>) => status && setStatus({ ...status, schedule: { timers: status.schedule.timers.map((t) => (t.id === id ? { ...t, ...patch } : t)) } });
  const addTimer = () => {
    if (!status || status.schedule.timers.length >= BRIEFING_TIMERS_MAX) return;
    // id는 서버가 만든다(빈 문자열) — 화면 key로는 임시 값을 쓴다
    saveTimers([...status.schedule.timers, { id: '', label: '', at: suggestAt(status.schedule.timers), on: true }]);
  };
  const removeTimer = (id: string) => status && status.schedule.timers.length > 1 && saveTimers(status.schedule.timers.filter((t) => t.id !== id));

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
          {/* 타이머 목록 — 고정 세 회차(v0.43)를 대체. 처음엔 하나, [+ 추가]로 최대 5개, 켜진 것끼리 2시간 이상(서버가 거절) (v0.52, 사용자 결정 2026-10-31) */}
          <div className={`mt-2 flex flex-col gap-1.5 pl-6 ${status.autoEnabled ? '' : 'opacity-50'}`}>
            {status.schedule.timers.map((t, i) => (
              <div key={t.id || `new-${i}`} className="flex items-center gap-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={t.on}
                  disabled={!status.autoEnabled}
                  onChange={(e) => patchTimer(t.id, { on: e.target.checked })}
                  aria-label="이 타이머 켜기"
                  className="accent-slate-400"
                />
                <input
                  type="text"
                  value={t.label}
                  maxLength={BRIEFING_TIMER_LABEL_MAX}
                  placeholder={`${t.at}판`}
                  disabled={!status.autoEnabled}
                  onChange={(e) => editTimer(t.id, { label: e.target.value })}
                  onBlur={() => (t.id ? patchTimer(t.id, { label: t.label.trim() }) : undefined)}
                  aria-label="회차 이름"
                  className="min-h-9 w-20 min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={t.at}
                  placeholder="HH:MM"
                  // 꺼진 타이머도 시각은 고칠 수 있어야 한다 — 켜려다 간격에 걸리면 시각부터 옮겨야 하므로(검토 2026-10-31)
                  disabled={!status.autoEnabled}
                  onChange={(e) => editTimer(t.id, { at: e.target.value })}
                  onBlur={(e) => {
                    const at = e.target.value.trim();
                    if (AT_RE.test(at)) patchTimer(t.id, { at });
                    else {
                      // 잘못 친 글자를 두면 다음 저장(체크 등)까지 거절된다 — 서버가 아는 값으로 되돌린다
                      setError('시각은 24시간제 HH:MM으로 적어 주세요 (예: 13:00)');
                      editTimer(t.id, { at: savedOf(t.id)?.at ?? t.at });
                    }
                  }}
                  aria-label="시작 시각 (24시간제)"
                  className="min-h-9 w-16 rounded border border-slate-700 bg-slate-900 px-2 text-center font-mono text-slate-200 disabled:opacity-50"
                />
                <button
                  onClick={() => removeTimer(t.id)}
                  disabled={!status.autoEnabled || status.schedule.timers.length <= 1}
                  title={status.schedule.timers.length <= 1 ? '타이머는 하나는 있어야 해요' : '이 타이머 지우기'}
                  aria-label="이 타이머 지우기"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-500 hover:text-red-300 disabled:opacity-40"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex flex-col items-start gap-1">
              <button
                onClick={addTimer}
                disabled={!status.autoEnabled || status.schedule.timers.length >= BRIEFING_TIMERS_MAX}
                className="min-h-9 whitespace-nowrap rounded-md border border-slate-700 px-3 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                + 타이머 추가
              </button>
              <span className="text-[11px] text-slate-600">
                {status.schedule.timers.length}/{BRIEFING_TIMERS_MAX} · 이름을 비우면 시각이 회차 이름 · 켜진 타이머끼리 2시간 이상 · 21:59까지
              </span>
            </div>
            {status.mode === 'subscription' && (
              <p className="text-[11px] text-slate-600">
                {status.schedule.timers
                  .filter((t) => t.on)
                  .map((t) => `${timerLabel(t)}판 ${t.at} → ${triggerTimeOf(t.at)} 켜짐`)
                  .join(' · ') || '켜 둔 타이머가 없어요'}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            이번 달 ≈ ${status.monthCostUsd.toFixed(2)} / 한도 ${status.monthBudgetUsd} — 한도에 닿으면 자동 생성이 멈춥니다{status.mode === 'subscription' ? ' (구독 회차는 $0으로, 비용에 쌓이지 않아요)' : ''}
          </p>
          {/* 생성 방식 — API/구독, 연결 열쇠·트리거·체크리스트·연결 확인 (v0.50). 방식이 바뀌면 상태를 다시 읽어 "다음" 표시를 맞춘다 */}
          <BriefingSubscriptionSettings
            mode={status.mode ?? 'api'}
            schedule={status.schedule}
            remoteRunning={status.running?.stage === 'remote'}
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
