import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { BRIEFING_PING_POLL_MS, BRIEFING_PING_WAIT_MS, type BriefingMode, type SubscriptionInfo } from '../../lib/briefing';
import { confirmDialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';

// 구독 연결(API-143)의 상태와 동작 한 벌 — 구독 연결 카테고리(SCR-402)·처음 연결하기(SCR-149)·생성 방식 줄(SCR-147)이 같이 쓴다.
// 열쇠 두 개는 반대 방향이다: 연결 열쇠(예약 작업 → docvault, 발급 때 한 번만 보임)와 트리거 토큰(docvault → claude.ai, 저장 뒤 "설정됨"만).
// 설계: 뉴스브리핑 문서 "구독 생성 방식"

type Opts = {
  /** 지금 예약 작업이 일하는 중인가 — 방식을 바꾸거나 열쇠를 지우면 그 실행이 취소되므로 확인창 문구에 넣는다 */
  remoteRunning: boolean;
  /** 생성 방식이 바뀌었다 — 부모가 브리핑 상태를 다시 읽는다 */
  onModeChange: (mode: BriefingMode) => void;
};

export function useSubscription({ remoteRunning, onModeChange }: Opts) {
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  /** API-143을 못 읽었다(수집 목록 문서가 깨졌을 때 500) — 화면이 말없이 비지 않게 */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 발급 직후 한 번만 보이는 열쇠 원문 — 닫으면 다시 볼 수 없다(서버는 해시만 둔다) */
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [triggerUrl, setTriggerUrl] = useState('');
  const [triggerToken, setTriggerToken] = useState('');
  const [savingTrigger, setSavingTrigger] = useState(false);
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
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      if (pingTimer.current) window.clearTimeout(pingTimer.current);
    };
  }, [load]);

  const ready = !!info?.tokenPrefix && !!info?.triggerSet;

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  async function issueToken() {
    if (info?.tokenPrefix) {
      const ok = await confirmDialog('연결 열쇠를 다시 발급할까요?', {
        // 열쇠가 새면 남이 완성본을 보내 가짜 회차를 만들 수 있다 — 재발급은 그럴 때 하는 것(설계 "보안 — 구독 연결 열쇠")
        message: `열쇠가 샌 것 같을 때만 하세요 — 새면 남이 가짜 회차를 보낼 수 있어요. 지금 열쇠는 바로 쓸 수 없게 되고, claude.ai 환경의 네트워크 시크릿도 새 값으로 바꿔야 해요.${remoteRunning ? ' 지금 도는 예약 작업은 옛 열쇠라 완성본을 보내지 못해요.' : ''}`,
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
      fail(err, '발급하지 못했어요');
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
      fail(err, '삭제하지 못했어요');
    }
  }

  /** 트리거 저장 — 값은 서버가 암호화해 두고 다시 내려오지 않는다. 방식은 여기서 바꾸지 않는다 — [연결 확인]을 거쳐 사람이 [구독으로 바꾸기]를 누른다 */
  async function saveTrigger(): Promise<boolean> {
    const url = triggerUrl.trim();
    const token = triggerToken.trim();
    if (!url || !token) {
      setError('트리거 주소와 토큰을 둘 다 넣어 주세요');
      return false;
    }
    setSavingTrigger(true);
    setError(null);
    try {
      await api('/briefing/settings', { method: 'PUT', body: JSON.stringify({ trigger: { url, token } }) });
      setTriggerUrl('');
      setTriggerToken('');
      await load();
      toast('트리거를 저장했어요 — [연결 확인]으로 시험해 보세요', 'success');
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message.replace(/^trigger\.url: /, '주소: ') : '저장하지 못했어요');
      return false;
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
      fail(err, '지우지 못했어요');
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
      fail(err, '연결 확인을 보내지 못했어요');
    }
  }

  /** 생성 방식 바꾸기 — 구독은 열쇠·트리거가 있어야 받아 준다(409). 바꾸는 순간 도는 구독 실행은 멈춘다 */
  async function changeMode(next: BriefingMode, current: BriefingMode): Promise<boolean> {
    setError(null);
    if (next === current) return true;
    if (next === 'api' && remoteRunning) {
      const ok = await confirmDialog('앱이 직접 만들기로 바꿀까요?', {
        message: '지금 도는 예약 작업은 취소로 기록되고 완성본을 받지 않아요. claude.ai의 세션은 스스로 멈추지 않으니 거기서도 꺼 두세요.',
        confirmLabel: '바꾸기',
        danger: true,
      });
      if (!ok) return false;
    }
    try {
      await api('/briefing/settings', { method: 'PUT', body: JSON.stringify({ mode: next }) });
      onModeChange(next);
      await load();
      return true;
    } catch (err) {
      fail(err, '바꾸지 못했어요');
      return false;
    }
  }

  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(`${what} 복사했어요`), () => toast('복사하지 못했어요', 'error'));

  return {
    info, loadError, error, setError, ready, reload: load,
    freshToken, closeFreshToken: () => setFreshToken(null), issueToken, revokeToken,
    triggerUrl, setTriggerUrl, triggerToken, setTriggerToken, savingTrigger, saveTrigger, clearTrigger,
    pinging, ping, changeMode, copy,
  };
}

export type Subscription = ReturnType<typeof useSubscription>;
