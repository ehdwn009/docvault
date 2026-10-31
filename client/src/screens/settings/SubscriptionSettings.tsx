import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { BriefingStatus } from '../../lib/briefing';
import { rowId } from './catalog';
import SettingRow, { btnClass, dangerBtnClass, Value } from './SettingRow';
import { FreshTokenBox, PingControl, tokenLine, TriggerForm } from './SubscriptionParts';
import { useSubscription } from './useSubscription';

type Props = {
  /** 처음 연결하기(SCR-149) 화면을 연다 */
  onOpenFirstConnect: () => void;
};

// SCR-402: 구독 연결 — 연결 열쇠·예약 작업 트리거·연결 확인·예약 시각·최근 회차. 여섯 단계 안내는 처음 연결하기(SCR-149)로 (IA — 안 B 결정 3)
export default function SubscriptionSettings({ onOpenFirstConnect }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const reloadStatus = () => void api<BriefingStatus>('/briefing/status').then(setStatus, () => {});
  useEffect(reloadStatus, []);
  const sub = useSubscription({ remoteRunning: status?.running?.stage === 'remote', onModeChange: reloadStatus });
  const [triggerOpen, setTriggerOpen] = useState(false);
  const info = sub.info;
  const id = (item: string) => rowId('subscription', item);

  if (!info) return sub.loadError ? <p className="py-3 text-sm text-danger-400">구독 상태를 불러오지 못했어요 — {sub.loadError}</p> : <p className="py-3 text-sm text-slate-500">불러오는 중…</p>;

  const recent = info.recent;
  const recentTotal = recent.ok + recent.missing + recent.error;

  return (
    <>
      <SettingRow id={id('firstConnect')} title="처음 연결하기" desc="여섯 단계 — 열쇠 발급 · 네트워크 시크릿과 환경 변수 · 허용 목록 · 예약 작업 만들기 · 트리거 저장 · 연결 확인">
        <button onClick={onOpenFirstConnect} className={btnClass}>안내 열기</button>
      </SettingRow>

      {/* ① 연결 열쇠 — 예약 작업 → docvault */}
      <SettingRow id={id('token')} title="연결 열쇠" desc={<>예약 작업이 docvault에 들어올 때 쓰는 열쇠. <span className="text-slate-400">{tokenLine(sub)}</span></>} below={<FreshTokenBox sub={sub} />}>
        <button onClick={() => void sub.issueToken()} className={btnClass}>{info.tokenPrefix ? '다시 발급' : '발급'}</button>
        {info.tokenPrefix && <button onClick={() => void sub.revokeToken()} className={dangerBtnClass}>삭제</button>}
      </SettingRow>

      {/* ② 예약 작업 트리거 — docvault → claude.ai */}
      <SettingRow
        id={id('trigger')}
        title="예약 작업 트리거"
        desc={
          <>
            docvault가 예약 작업을 켤 때 쓰는 주소와 토큰. claude.ai에서 예약 작업을 만들면 나와요. 저장하면 값은 다시 보이지 않아요
            {info.triggerBroken && <span className="mt-0.5 block text-warn-400">트리거를 읽을 수 없어요(서버 비밀키가 바뀜) — 다시 넣어 주세요</span>}
          </>
        }
        below={
          triggerOpen && (
            <div className="flex flex-col gap-2">
              <TriggerForm sub={sub} onSaved={() => setTriggerOpen(false)} />
              <button onClick={() => setTriggerOpen(false)} className="self-start px-1 text-sm text-slate-500 hover:text-slate-300">닫기</button>
            </div>
          )
        }
      >
        <Value tone={info.triggerSet ? 'good' : 'muted'}>{info.triggerSet ? '설정됨 ✓' : '아직 없어요'}</Value>
        {!triggerOpen && <button onClick={() => setTriggerOpen(true)} className={btnClass}>{info.triggerSet ? '바꾸기' : '저장'}</button>}
      </SettingRow>

      {/* ③ 연결 확인 — 회차를 만들지 않고 왕복만 확인한다 */}
      <SettingRow id={id('ping')} title="연결 확인" desc="예약 작업을 한 번 켜서 지시서만 받아 가게 해요. 회차는 만들지 않아요">
        <PingControl sub={sub} />
      </SettingRow>

      <SettingRow id={id('times')} title="예약 시각" desc={`예약 작업은 회차 ${Math.round(info.leadMs / 60_000)}분 전에 켜지고, 마감은 회차 ${Math.round(info.deadlineAfterMs / 60_000)}분 뒤예요`}>
        <Value>{info.triggerTimes.map((t) => `${t.label} ${t.at} → ${t.triggerAt} 켜기`).join(' · ') || '켜 둔 타이머가 없어요'}</Value>
      </SettingRow>

      <SettingRow
        id={id('recent')}
        title={`최근 ${recentTotal}회`}
        desc={
          recent.hint === 'earlier' ? <span className="text-warn-400">마감에 자주 몰려요. 수집 목록의 출처나 켜 둔 분야를 줄여 보세요</span>
          : recent.hint === 'later' ? '넉넉히 끝나요. 회차 시각을 30분 늦추면 더 최근 기사까지 담을 수 있어요'
          : undefined
        }
      >
        <Value tone={recentTotal === 0 ? 'muted' : 'normal'}>
          {recentTotal === 0 ? '아직 없어요' : `성공 ${recent.ok} · 도착 안 함 ${recent.missing} · 실패 ${recent.error}${recent.avgMinutes !== null ? ` · 평균 ${recent.avgMinutes}분` : ''}`}
        </Value>
      </SettingRow>

      {sub.error && <p className="mt-2 text-xs text-danger-400">{sub.error}</p>}
    </>
  );
}
