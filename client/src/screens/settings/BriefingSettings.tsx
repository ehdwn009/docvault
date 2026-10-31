import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BRIEFING_TIMER_LABEL_MAX, BRIEFING_TIMERS_MAX, kstTime, timerLabel, type AutoSchedule, type BriefingMode, type BriefingStatus, type Timer } from '../../lib/briefing';
import { toast } from '../../lib/toast';
import { rowId } from './catalog';
import SettingRow, { btnClass, selectClass, Switch, Value } from './SettingRow';
import { useSubscription } from './useSubscription';

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
  /** 구독 연결 카테고리로 — 생성 방식을 구독으로 바꾸려면 열쇠·트리거가 먼저다 */
  onOpenSubscription: () => void;
};

// SCR-147: 설정 → 뉴스 브리핑 (관리자만) — 자동 생성·타이머(v0.52)·이번 달 비용·생성 방식(v0.50)·앱 안 원문 보기·수집 목록.
// 열쇠·트리거·연결 확인은 구독 연결(SCR-402)로 갔다 (IA — 안 B "나")
export default function BriefingSettings({ onOpenSources, onOpenSubscription }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timersOpen, setTimersOpen] = useState(false);
  /** 서버가 확인해 준 마지막 타이머 목록 — 잘못 친 시각을 되돌리고, 바뀐 게 없으면 저장하지 않으려고 */
  const savedTimers = useRef<Timer[]>([]);

  const reloadStatus = () =>
    void api<BriefingStatus>('/briefing/status').then((s) => {
      savedTimers.current = s.schedule.timers;
      setStatus(s);
    }, () => setError('상태를 불러오지 못했어요'));
  useEffect(reloadStatus, []);

  const mode: BriefingMode = status?.mode ?? 'api';
  // 방식이 바뀌면 상태를 다시 읽어 "다음" 표시를 맞춘다
  const sub = useSubscription({ remoteRunning: status?.running?.stage === 'remote', onModeChange: reloadStatus });
  /** 라디오에서 고른 것 — 열쇠·트리거가 없어 서버가 거절해도 고른 채로 두어 준비하게 */
  const [want, setWant] = useState<BriefingMode>(mode);
  useEffect(() => setWant(mode), [mode]);

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
      reloadStatus();
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

  async function pickMode(next: BriefingMode) {
    setWant(next);
    // 준비가 안 됐으면 고른 것만 바꿔 둔다 — 안내는 설명 줄이 한다
    if (next === 'subscription' && !sub.ready) return;
    const ok = await sub.changeMode(next, mode);
    if (!ok) setWant(mode);
  }

  if (!status) return error ? <p className="py-3 text-sm text-danger-400">{error}</p> : <p className="py-3 text-sm text-slate-500">불러오는 중…</p>;

  const id = (item: string) => rowId('briefing', item);
  const timersSummary = status.schedule.timers.map((t) => `${timerLabel(t)} ${t.at}${t.on ? '' : ' (꺼짐)'}`).join(' · ');
  const costRatio = status.monthBudgetUsd > 0 ? status.monthCostUsd / status.monthBudgetUsd : 0;
  const inputCls = 'min-h-11 rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50';

  return (
    <>
      <SettingRow
        id={id('auto')}
        title="자동 생성"
        desc={
          <>
            {status.mode === 'subscription'
              ? '켠 타이머의 90분 전에 claude.ai 예약 작업을 켜고, 회차 시각 30분 뒤까지 완성본을 기다려요. 안 오면 패널에 알리고 [지금 만들기]로 만들 수 있어요'
              : '켠 타이머의 시각(한국시간)에 만들기 시작합니다. 서버가 꺼져 있었으면 2시간 안에 늦게라도 시작해요. 실패한 회차는 다시 시도하지 않으니 패널의 버튼으로 만드세요'}
            {status.autoEnabled && status.nextAutoAt && (
              <span className="mt-0.5 block text-slate-400">다음 {status.mode === 'subscription' ? '예약 작업 ' : ''}{kstTime(status.nextAutoAt)} {status.nextAutoLabel ?? ''}판</span>
            )}
            {!status.configured && status.mode !== 'subscription' && <span className="mt-0.5 block text-warn-400">AI 키가 연결되지 않아 켤 수 없어요</span>}
          </>
        }
      >
        {/* 구독 모드는 API 키 없이도 돈다(트리거·마감만) — 키 검사는 api 모드만 (v0.50) */}
        <Switch checked={status.autoEnabled} disabled={!status.configured && status.mode !== 'subscription'} onChange={(v) => void save({ autoEnabled: v })} label="자동 생성" />
      </SettingRow>

      {/* 타이머 목록 — 고정 세 회차(v0.43)를 대체. 처음엔 하나, [+ 추가]로 최대 5개, 켜진 것끼리 2시간 이상(서버가 거절) (v0.52, 사용자 결정 2026-10-31) */}
      <SettingRow
        id={id('timers')}
        title="타이머"
        desc={timersOpen ? `${status.schedule.timers.length}/${BRIEFING_TIMERS_MAX} · 이름을 비우면 시각이 회차 이름 · 켜진 타이머끼리 2시간 이상 · 24시간제, 21:59까지` : timersSummary}
        below={
          timersOpen && (
            <div className={`flex max-w-md flex-col gap-2 ${status.autoEnabled ? '' : 'opacity-60'}`}>
              {status.schedule.timers.map((t, i) => (
                <div key={t.id || `new-${i}`} className="flex items-center gap-2">
                  <Switch checked={t.on} disabled={!status.autoEnabled} onChange={(v) => patchTimer(t.id, { on: v })} label="이 타이머 켜기" />
                  <input
                    type="text"
                    value={t.label}
                    maxLength={BRIEFING_TIMER_LABEL_MAX}
                    placeholder={`${t.at}판`}
                    disabled={!status.autoEnabled}
                    onChange={(e) => editTimer(t.id, { label: e.target.value })}
                    onBlur={() => (t.id ? patchTimer(t.id, { label: t.label.trim() }) : undefined)}
                    aria-label="회차 이름"
                    className={`${inputCls} w-24 min-w-0 flex-1`}
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
                    className={`${inputCls} w-20 text-center font-mono`}
                  />
                  <button
                    onClick={() => removeTimer(t.id)}
                    disabled={!status.autoEnabled || status.schedule.timers.length <= 1}
                    title={status.schedule.timers.length <= 1 ? '타이머는 하나는 있어야 해요' : '이 타이머 지우기'}
                    aria-label="이 타이머 지우기"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded text-slate-500 hover:text-danger-300 disabled:opacity-40"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={addTimer} disabled={!status.autoEnabled || status.schedule.timers.length >= BRIEFING_TIMERS_MAX} className={btnClass}>
                  + 타이머 추가
                </button>
                <button onClick={() => setTimersOpen(false)} className="min-h-11 px-3 text-sm text-slate-500 hover:text-slate-300">닫기</button>
              </div>
              {status.mode === 'subscription' && (
                <p className="text-xs text-slate-500">
                  {status.schedule.timers.filter((t) => t.on).map((t) => `${timerLabel(t)}판 ${t.at} → ${triggerTimeOf(t.at)} 켜짐`).join(' · ') || '켜 둔 타이머가 없어요'}
                </p>
              )}
            </div>
          )
        }
      >
        {!timersOpen && <button onClick={() => setTimersOpen(true)} className={btnClass}>편집</button>}
      </SettingRow>

      <SettingRow id={id('cost')} title="이번 달 비용" desc={`한도에 닿으면 자동 생성이 멈춥니다${status.mode === 'subscription' ? ' (구독 회차는 $0으로, 비용에 쌓이지 않아요)' : ''}`}>
        <Value tone={costRatio >= (status.budgetWarnRatio ?? 0.8) ? 'warn' : 'normal'}>≈ ${status.monthCostUsd.toFixed(2)} / ${status.monthBudgetUsd}</Value>
      </SettingRow>

      {/* 생성 방식 — API/구독 (v0.50). 열쇠·트리거 준비는 구독 연결(SCR-402)에서 */}
      <SettingRow
        id={id('mode')}
        title="생성 방식"
        desc={
          <>
            {want === 'subscription' && mode !== 'subscription' ? (
              sub.ready ? (
                <span className="text-warn-400">열쇠와 트리거가 준비됐어요 — [연결 확인]이 "연결 확인됨"이면 바꾸세요</span>
              ) : (
                <span className="text-warn-400">
                  <button onClick={onOpenSubscription} className="underline underline-offset-2">구독 연결</button>에서 열쇠와 트리거를 준비하면 바꿀 수 있어요. 그동안은 앱이 직접 만들어요
                </span>
              )
            ) : mode === 'subscription' ? (
              '정한 시각 90분 전에 서버가 claude.ai 예약 작업을 켜고, 완성본을 받아 저장해요 — 내 Claude 구독으로, 추가 비용 없음. 앱이 직접 만들기로 바꾸면 지금 도는 예약 작업은 취소로 기록되고 더 켜지지 않아요 — claude.ai의 예약 작업도 꺼 두세요. 열쇠·트리거는 남아 있어 다시 구독으로 바꾸면 바로 이어서 써요'
            ) : (
              '서버가 Anthropic API로 만들어요 — 회차마다 비용이 들고 월 한도가 있어요. 타이머는 두 방식이 함께 써요'
            )}
          </>
        }
      >
        <select value={want} onChange={(e) => void pickMode(e.target.value as BriefingMode)} className={selectClass} aria-label="생성 방식">
          <option value="api">앱이 직접 만들기 (API)</option>
          <option value="subscription">구독으로 받기 (Claude 예약 작업)</option>
        </select>
        {want === 'subscription' && mode !== 'subscription' && sub.ready && (
          <button onClick={() => void pickMode('subscription')} className="min-h-11 rounded-md border border-warn-600/60 px-3 text-sm font-semibold text-warn-400 hover:bg-warn-800/40">
            구독으로 바꾸기
          </button>
        )}
      </SettingRow>

      {/* 앱 안 원문 보기 — 기본 꺼짐. 서버에서 추출 품질을 잰 뒤 켠다 (개선 합의안 7장) */}
      <SettingRow
        id={id('reader')}
        title="앱 안 원문 보기"
        desc={
          <>
            기사 화면에서 [요약 | 원문]을 바꿔 가며 원문을 앱 안에서 읽습니다. 누를 때만 받아 오고 저장하지 않으며, 관리자만 봅니다. 켜기 전에 서버에서{' '}
            <code className="text-slate-400">npm run briefing:readcheck -w server</code>로 추출 품질(70% 이상)과 범위(50% 이상)를 재 보세요. 유료 기사나 뽑지 못한 기사는 사이트로 보냅니다
          </>
        }
      >
        <Switch checked={status.readerEnabled ?? false} onChange={(v) => void save({ readerEnabled: v })} label="앱 안 원문 보기" />
      </SettingRow>

      <SettingRow id={id('sources')} title="수집 목록" desc="RSS 주소와 검색어는 문서로 둡니다 — 고치는 곳은 설정이 아니라 그 문서예요">
        <button onClick={onOpenSources} className={btnClass}>열기</button>
      </SettingRow>

      {(error || sub.error) && <p className="mt-2 text-xs text-danger-400">{error ?? sub.error}</p>}
    </>
  );
}
