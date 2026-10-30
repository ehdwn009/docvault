import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BRIEFING_PING_POLL_MS, BRIEFING_PING_WAIT_MS, kstTime, PING_LABEL, type AutoSchedule, type AutoSlot, type BriefingMode, type SubscriptionInfo } from '../../lib/briefing';
import { confirmDialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';

const SLOT_LABEL: Record<AutoSlot, string> = { morning: '아침', noon: '점심', evening: '저녁' };
/** 트리거 주소의 모양 — 서버 SUB_TRIGGER_HOST·SUB_TRIGGER_PATH와 같은 규칙. 화면은 미리 알려 주기만 하고 검사는 서버가 한다 */
const TRIGGER_URL_HINT = 'https://api.anthropic.com/v1/claude_code/routines/<id>/fire';

type Props = {
  mode: BriefingMode;
  schedule: AutoSchedule;
  /** 지금 예약 작업이 일하는 중인가 — 방식을 바꾸면 그 실행이 취소되므로 한 번 묻는다 */
  remoteRunning: boolean;
  /** 생성 방식이 바뀌었다 — 부모(자동 생성 설정)가 상태를 다시 읽는다 */
  onModeChange: (mode: BriefingMode) => void;
};

// SCR-147 "생성 방식" 블록 (v0.50) — 회차를 앱이 직접(API) 만들지, 서버가 켠 claude.ai 예약 작업(사용자의 Claude 구독)이 만들지.
// 열쇠 두 개는 반대 방향이다: 연결 열쇠(예약 작업 → docvault, 발급 때 한 번만 보임)와 트리거 토큰(docvault → claude.ai, 저장 뒤 "설정됨"만).
// 설계: 뉴스브리핑 문서 "구독 생성 방식", IA SCR-147
export default function BriefingSubscriptionSettings({ mode, schedule, remoteRunning, onModeChange }: Props) {
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** API-143을 못 읽었다(수집 목록 문서가 깨졌을 때 500) — 블록이 말없이 사라지지 않게 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 라디오에서 고른 것 — 열쇠·트리거가 없어 서버가 거절해도 블록은 펼쳐 두어 준비하게 */
  const [want, setWant] = useState<BriefingMode>(mode);
  /** 발급 직후 한 번만 보이는 열쇠 원문 — 닫으면 다시 볼 수 없다(서버는 해시만 둔다) */
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [triggerUrl, setTriggerUrl] = useState('');
  const [triggerToken, setTriggerToken] = useState('');
  const [savingTrigger, setSavingTrigger] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [pinging, setPinging] = useState(false);
  const pingTimer = useRef<number | null>(null);
  /** 화면을 떠난 뒤 폴링이 이어지지 않게 — 기다리던 응답이 돌아와도 버린다 */
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await api<SubscriptionInfo>('/briefing/subscription');
      if (!alive.current) return;
      setInfo(r);
      setLoadError(null);
    } catch (err) {
      if (!alive.current) return;
      setLoadError(err instanceof ApiError ? err.message : '구독 상태를 불러오지 못했어요');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // 회차 시각을 바꾸면 켜지는 시각(triggerTimes)도 바뀐다 — 부모가 schedule을 새로 주면 다시 읽는다(첫 실전에서 옛 값이 남았다, 2026-10-30)
  const scheduleKey = JSON.stringify(schedule);
  useEffect(() => {
    void load();
  }, [scheduleKey, load]);
  useEffect(() => setWant(mode), [mode]);
  useEffect(
    () => () => {
      alive.current = false;
      if (pingTimer.current) window.clearTimeout(pingTimer.current);
    },
    [],
  );

  const ready = !!info?.tokenPrefix && !!info?.triggerSet;
  const showBlock = want === 'subscription' || mode === 'subscription';
  // 열쇠 원문은 블록을 접는 순간 버린다 — [닫기]를 안 누르고 라디오를 바꿔도 다음에 다시 보이지 않게
  useEffect(() => {
    if (!showBlock) setFreshToken(null);
  }, [showBlock]);

  /** 방식 저장 — 구독은 열쇠·트리거가 있어야 받아 준다(409). 바꾸는 순간 도는 구독 실행은 멈춘다 */
  async function saveMode(next: BriefingMode) {
    setError(null);
    setWant(next);
    if (next === mode) return;
    // 준비가 안 됐으면 라디오만 바꿔 두고 블록을 펼친다 — 안내는 라디오 아래 한 줄이 한다
    if (next === 'subscription' && !ready) return;
    if (next === 'api' && remoteRunning) {
      const ok = await confirmDialog('앱이 직접 만들기로 바꿀까요?', {
        message: '지금 도는 예약 작업은 취소로 기록되고 완성본을 받지 않아요. claude.ai의 세션은 스스로 멈추지 않으니 거기서도 꺼 두세요.',
        confirmLabel: '바꾸기',
        danger: true,
      });
      if (!ok) {
        setWant(mode);
        return;
      }
    }
    try {
      await api('/briefing/settings', { method: 'PUT', body: JSON.stringify({ mode: next }) });
      onModeChange(next);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '바꾸지 못했어요');
      setWant(mode);
    }
  }

  async function issueToken() {
    if (info?.tokenPrefix) {
      const ok = await confirmDialog('연결 열쇠를 다시 발급할까요?', {
        // 열쇠가 새면 남이 완성본을 보내 가짜 회차를 만들 수 있다 — 재발급은 그럴 때 하는 것(설계 "보안 — 구독 연결 열쇠")
        message: `열쇠가 샌 것 같을 때만 하세요 — 새면 남이 가짜 회차를 보낼 수 있어요. 지금 열쇠는 바로 쓸 수 없게 되고, claude.ai 환경의 DOCVAULT_TOKEN도 새 값으로 바꿔야 해요.${remoteRunning ? ' 지금 도는 예약 작업은 옛 열쇠라 완성본을 보내지 못해요.' : ''}`,
        confirmLabel: '다시 발급',
        danger: true,
      });
      if (!ok) return;
    }
    setError(null);
    try {
      const r = await api<{ token: string; prefix: string; createdAt: number }>('/briefing/token', { method: 'POST' });
      setFreshToken(r.token);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '발급하지 못했어요');
    }
  }

  async function revokeToken() {
    const ok = await confirmDialog('연결 열쇠를 삭제할까요?', {
      message: `예약 작업이 더는 docvault에 들어올 수 없고, 생성 방식은 "앱이 직접 만들기"로 돌아갑니다.${remoteRunning ? ' 지금 도는 예약 작업은 취소로 기록돼요.' : ''}`,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api('/briefing/token', { method: 'DELETE' });
      setFreshToken(null);
      onModeChange('api');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '삭제하지 못했어요');
    }
  }

  /** 트리거 저장 — 값은 서버가 암호화해 두고 다시 내려오지 않는다. 방식은 여기서 바꾸지 않는다 — [연결 확인]을 거쳐 사람이 [구독으로 바꾸기]를 누른다 */
  async function saveTrigger() {
    const url = triggerUrl.trim();
    const token = triggerToken.trim();
    if (!url || !token) {
      setError('트리거 주소와 토큰을 둘 다 넣어 주세요');
      return;
    }
    setSavingTrigger(true);
    setError(null);
    try {
      await api('/briefing/settings', { method: 'PUT', body: JSON.stringify({ trigger: { url, token } }) });
      setTriggerUrl('');
      setTriggerToken('');
      await load();
      toast('트리거를 저장했어요 — [연결 확인]으로 시험해 보세요', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message.replace(/^trigger\.url: /, '주소: ') : '저장하지 못했어요');
    } finally {
      setSavingTrigger(false);
    }
  }

  async function clearTrigger() {
    const ok = await confirmDialog('예약 작업 트리거를 지울까요?', {
      message: `서버가 예약 작업을 켤 수 없게 되고, 생성 방식은 "앱이 직접 만들기"로 돌아갑니다.${remoteRunning ? ' 지금 도는 예약 작업은 취소로 기록돼요.' : ''}`,
      confirmLabel: '지우기',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api('/briefing/settings', { method: 'PUT', body: JSON.stringify({ trigger: null }) });
      onModeChange('api');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했어요');
    }
  }

  /** [연결 확인] — ping을 쏘고, 결과가 굳을 때까지 몇 초마다 다시 읽는다 (fired → ok / token_invalid / no_request) */
  async function ping() {
    setPinging(true);
    setError(null);
    try {
      await api('/briefing/subscription/ping', { method: 'POST' });
      await load();
      const startedAt = Date.now();
      const poll = async () => {
        const r = await api<SubscriptionInfo>('/briefing/subscription').catch(() => null);
        if (!alive.current) return;
        if (r) setInfo(r);
        const settled = r && r.lastPingResult !== 'fired';
        if (settled || Date.now() - startedAt > BRIEFING_PING_WAIT_MS) {
          setPinging(false);
          return;
        }
        pingTimer.current = window.setTimeout(() => void poll(), BRIEFING_PING_POLL_MS);
      };
      pingTimer.current = window.setTimeout(() => void poll(), BRIEFING_PING_POLL_MS);
    } catch (err) {
      setPinging(false);
      await load();
      setError(err instanceof ApiError ? err.message : '연결 확인을 보내지 못했어요');
    }
  }

  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(`${what} 복사했어요`), () => toast('복사하지 못했어요', 'error'));

  const recent = info?.recent;
  // 앰버 램프는 앱 테마가 재정의하지 않는다(index.css) — 밝은 테마에서 amber-100 글자가 안 보여 버튼·상자 글자는 amber-500 (첫 실전 2026-10-30)
  const btn = 'min-h-9 rounded-md border border-slate-700 px-3 text-slate-300 hover:bg-slate-800 disabled:opacity-50';
  const smallBtn = 'min-h-9 rounded border border-slate-700 px-2 text-[11px] text-slate-300 hover:bg-slate-800';

  return (
    <div className="mt-4 text-xs text-slate-400">
      <p className="font-semibold text-slate-300">생성 방식</p>
      <div className="mt-1.5 flex flex-col gap-1">
        {(
          [
            { value: 'api', label: '앱이 직접 만들기 (API)', desc: '서버가 Anthropic API로 만들어요 — 회차마다 비용이 들고 월 한도가 있어요' },
            { value: 'subscription', label: '구독으로 받기 (Claude 예약 작업)', desc: '정한 시각 90분 전에 서버가 claude.ai 예약 작업을 켜고, 완성본을 받아 저장해요 — 내 Claude 구독으로, 추가 비용 없음' },
          ] as { value: BriefingMode; label: string; desc: string }[]
        ).map((o) => (
          <label key={o.value} className="flex min-h-9 items-start gap-2">
            <input type="radio" name="briefing-mode" checked={want === o.value} onChange={() => void saveMode(o.value)} className="mt-0.5 accent-slate-400" />
            <span>
              {o.label}
              <span className="block text-slate-600">{o.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {want === 'subscription' && mode !== 'subscription' && (
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-6 text-[11px] text-amber-400">
          {ready ? (
            <>
              <span>열쇠와 트리거가 준비됐어요 — [연결 확인]이 "연결 확인됨"이면 바꾸세요</span>
              <button onClick={() => void saveMode('subscription')} className="min-h-9 rounded-md border border-amber-600/60 px-3 text-xs font-semibold text-amber-500 hover:bg-amber-800/40">
                구독으로 바꾸기
              </button>
            </>
          ) : (
            <span>아래 열쇠와 트리거를 준비하면 바꿀 수 있어요. 그동안은 앱이 직접 만들어요</span>
          )}
        </div>
      )}
      <p className="mt-1 pl-6 text-[11px] text-slate-600">
        {mode === 'subscription'
          ? '앱이 직접 만들기로 바꾸면 지금 도는 예약 작업은 취소로 기록되고 더 켜지지 않아요 — claude.ai의 예약 작업도 꺼 두세요. 열쇠·트리거는 남아 있어 다시 구독으로 바꾸면 바로 이어서 써요'
          : '회차 켜기·시각은 두 방식이 함께 써요'}
      </p>

      {showBlock && !info && loadError && <p className="mt-2 text-xs text-red-400">구독 상태를 불러오지 못했어요 — {loadError}</p>}
      {showBlock && info && (
        <div className="mt-3 space-y-4 rounded-lg border border-slate-800 p-3">
          {/* ① 연결 열쇠 — 예약 작업 → docvault */}
          <div>
            <p className="font-semibold text-slate-300">연결 열쇠 (예약 작업이 docvault에 들어올 때)</p>
            {freshToken ? (
              <div className="mt-1.5 rounded-md border border-amber-700/50 bg-amber-900/20 p-2 text-amber-500">
                <p className="text-[11px]">이 창을 닫으면 다시 볼 수 없어요 — claude.ai 환경의 네트워크 시크릿(Bearer)의 헤더 값에 넣어 두세요(체크리스트 ②)</p>
                <code className="mt-1 block break-all rounded bg-slate-950 px-2 py-1 text-[11px] text-slate-200">{freshToken}</code>
                <div className="mt-1.5 flex gap-2">
                  <button onClick={() => copy(freshToken, '연결 열쇠를')} className="min-h-9 rounded border border-amber-600/60 px-2.5 text-[11px] font-semibold text-amber-500 hover:bg-amber-800/40">
                    복사
                  </button>
                  <button onClick={() => setFreshToken(null)} className="min-h-9 rounded border border-slate-700 px-2.5 text-[11px] text-slate-300 hover:bg-slate-800">
                    닫기
                  </button>
                </div>
              </div>
            ) : info.tokenPrefix ? (
              <p className="mt-1 text-slate-500">
                <code className="text-slate-300">{info.tokenPrefix}…</code> · 발급 {info.tokenCreatedAt ? kstTime(info.tokenCreatedAt) : ''}
                {' · '}
                {info.tokenLastUsedAt ? `마지막 사용 ${kstTime(info.tokenLastUsedAt)}` : '아직 사용 안 함'}
              </p>
            ) : (
              <p className="mt-1 text-slate-600">아직 발급하지 않았어요</p>
            )}
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => void issueToken()} className={btn}>
                {info.tokenPrefix ? '다시 발급' : '발급'}
              </button>
              {info.tokenPrefix && (
                <button onClick={() => void revokeToken()} className="min-h-9 rounded-md px-3 text-slate-500 hover:text-red-300">
                  삭제
                </button>
              )}
            </div>
          </div>

          {/* ② 예약 작업 트리거 — docvault → claude.ai */}
          <div>
            <p className="font-semibold text-slate-300">예약 작업 트리거 (docvault가 예약 작업을 켤 때)</p>
            <p className="mt-0.5 text-slate-600">
              claude.ai에서 예약 작업을 만들면 나오는 트리거 주소와 토큰. 주소는 <code className="break-all text-slate-500">{TRIGGER_URL_HINT}</code> 모양만 받아요. 저장하면 값은 다시 보이지 않아요
            </p>
            {info.triggerSet && <p className="mt-1 text-emerald-400/90">설정됨 ✓</p>}
            {info.triggerBroken && <p className="mt-1 text-amber-400">트리거를 읽을 수 없어요(서버 비밀키가 바뀜) — 다시 넣어 주세요</p>}
            <div className="mt-1.5 flex flex-col gap-1.5">
              {/* 글자 칸 + 비밀번호 칸을 브라우저가 로그인 폼으로 오해해 저장된 아이디·비밀번호를 채워 넣었다(첫 배포 2026-10-30) — autocomplete=off는 비밀번호 칸에 안 먹으므로 new-password와 낯선 name으로 */}
              <input
                type="url"
                name="briefing-trigger-fire-url"
                value={triggerUrl}
                onChange={(e) => setTriggerUrl(e.target.value)}
                placeholder={info.triggerSet ? '바꾸려면 새 주소' : TRIGGER_URL_HINT}
                autoComplete="off"
                spellCheck={false}
                className="min-h-9 rounded border border-slate-700 bg-slate-900 px-2 text-slate-200 placeholder:text-slate-700"
              />
              <input
                type="password"
                name="briefing-trigger-secret"
                value={triggerToken}
                onChange={(e) => setTriggerToken(e.target.value)}
                placeholder={info.triggerSet ? '바꾸려면 새 토큰' : '트리거 토큰'}
                autoComplete="new-password"
                className="min-h-9 rounded border border-slate-700 bg-slate-900 px-2 text-slate-200 placeholder:text-slate-700"
              />
              <div className="flex gap-2">
                <button onClick={() => void saveTrigger()} disabled={savingTrigger} className={btn}>
                  {savingTrigger ? '저장하는 중…' : info.triggerSet ? '바꾸기' : '저장'}
                </button>
                {info.triggerSet && (
                  <button onClick={() => void clearTrigger()} className="min-h-9 rounded-md px-3 text-slate-500 hover:text-red-300">
                    지우기
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ③ 설정 체크리스트 — 처음 연결할 때 순서대로. 복사 버튼은 사람이 옮겨 적다 틀리는 것을 막는다 */}
          <div>
            <button onClick={() => setChecklistOpen((v) => !v)} className="min-h-9 text-left font-semibold text-slate-300 underline-offset-2 hover:underline" aria-expanded={checklistOpen}>
              설정 체크리스트 {checklistOpen ? '접기' : '펼치기'}
            </button>
            {checklistOpen && (
              <ol className="mt-1 list-decimal space-y-2 pl-5 text-slate-400">
                <li>
                  위에서 연결 열쇠를 발급해 두세요 (한 번만 보여요)
                </li>
                <li>
                  claude.ai → 설정 → Claude Code → 환경(기본 브랜치 main)에 두 가지를 넣어요:
                  <span className="mt-1 block">
                    <b className="text-slate-300">네트워크 시크릿</b> — [시크릿 추가] → 유형 <code>{info.checklist.secret.prefix}</code> · 허용된 웹사이트{' '}
                    <code className="text-slate-300">{info.checklist.secret.host}</code>
                    <button onClick={() => copy(info.checklist.secret.host, '호스트를')} className={`ml-1 ${smallBtn}`}>복사</button>
                    {' · '}경로 접두사 <code className="text-slate-300">{info.checklist.secret.pathPrefix}</code>
                    <button onClick={() => copy(info.checklist.secret.pathPrefix, '경로 접두사를')} className={`ml-1 ${smallBtn}`}>복사</button>
                    {' · '}헤더 <code>{info.checklist.secret.header}</code> / 접두사 <code>{info.checklist.secret.prefix}</code> / 값 = 발급한 열쇠
                  </span>
                  <span className="mt-1 block">
                    <b className="text-slate-300">환경 변수</b> —{' '}
                    {info.checklist.envNames.map((n) => (
                      <code key={n} className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">{n}</code>
                    ))}
                    {' = '}
                    <code className="text-slate-300">{info.checklist.docvaultUrl}</code>
                    <button onClick={() => copy(`${info.checklist.envNames[0]}=${info.checklist.docvaultUrl}`, '환경 변수 한 줄을')} className={`ml-1 ${smallBtn}`}>
                      한 줄 복사
                    </button>
                  </span>
                  <span className="block text-slate-600">열쇠는 환경 변수에 넣지 않아요 — 그 화면은 환경을 쓰는 모두가 값을 볼 수 있어요</span>
                </li>
                <li>
                  같은 환경의 네트워크 허용 목록에 docvault 주소와 수집 목록의 언론사 도메인을 넣어요
                  <button onClick={() => copy(info.allowedDomains.join('\n'), `허용 도메인 ${info.allowedDomains.length}곳을`)} className={`ml-1.5 ${smallBtn}`}>
                    도메인 {info.allowedDomains.length}곳 복사
                  </button>
                </li>
                <li>
                  예약 작업을 만들어요 — 저장소는 docvault, 일정은 비워 두고(서버가 켜요), 지시문은 아래 한 줄:
                  <code className="mt-1 block rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-300">{info.checklist.taskPrompt}</code>
                  <button onClick={() => copy(info.checklist.taskPrompt, '지시문을')} className={`mt-1 ${smallBtn}`}>
                    지시문 복사
                  </button>
                </li>
                <li>예약 작업의 트리거 주소와 토큰을 위 칸에 저장해요</li>
                <li>[연결 확인]을 눌러 "연결 확인됨"이 나오면 위의 [구독으로 바꾸기]를 눌러요</li>
              </ol>
            )}
          </div>

          {/* ④ 연결 확인 — 회차를 만들지 않고 왕복만 확인한다 */}
          <div>
            <div className="flex items-center gap-2">
              <button onClick={() => void ping()} disabled={!info.triggerSet || pinging} className={btn}>
                {pinging ? '확인하는 중…' : '연결 확인'}
              </button>
              {info.lastPingResult && (
                <span className={info.lastPingResult === 'ok' ? 'text-emerald-400/90' : info.lastPingResult === 'fired' ? 'text-sky-300' : 'text-amber-400'}>
                  {PING_LABEL[info.lastPingResult]}
                  {info.lastPingAt && info.lastPingResult !== 'no_request' ? ` (${kstTime(info.lastPingAt, false)})` : ''}
                </span>
              )}
            </div>
            <p className="mt-1 text-slate-600">예약 작업을 한 번 켜서 지시서만 받아 가게 해요. 회차는 만들지 않아요</p>
          </div>

          {/* ⑤ 시각과 최근 7회 */}
          <div className="text-slate-500">
            <p>
              예약 작업은 회차 {Math.round(info.leadMs / 60_000)}분 전에 켜지고, 마감은 회차 {Math.round(info.deadlineAfterMs / 60_000)}분 뒤예요 —{' '}
              {(Object.keys(SLOT_LABEL) as AutoSlot[])
                .filter((s) => schedule[s].on && info.triggerTimes[s])
                .map((s) => `${SLOT_LABEL[s]} ${schedule[s].at} → ${info.triggerTimes[s]} 켜기`)
                .join(' · ') || '켜 둔 회차가 없어요'}
            </p>
            {recent && recent.ok + recent.missing + recent.error > 0 && (
              <p className="mt-1">
                최근 {recent.ok + recent.missing + recent.error}회: 성공 {recent.ok} · 도착 안 함 {recent.missing} · 실패 {recent.error}
                {recent.avgMinutes !== null ? ` · 평균 ${recent.avgMinutes}분` : ''}
                {recent.hint === 'earlier' && <span className="text-amber-400"> — 마감에 자주 몰려요. 수집 목록의 출처나 켜 둔 분야를 줄여 보세요</span>}
                {recent.hint === 'later' && <span> — 넉넉히 끝나요. 회차 시각을 30분 늦추면 더 최근 기사까지 담을 수 있어요</span>}
              </p>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
