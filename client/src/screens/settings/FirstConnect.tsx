import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { BriefingStatus } from '../../lib/briefing';
import { IS_TOUCH } from '../../lib/device';
import { btnClass, primaryBtnClass } from './SettingRow';
import { CopyButton, FreshTokenBox, PingControl, tokenLine, TriggerForm } from './SubscriptionParts';
import { useSubscription } from './useSubscription';

type Props = { onClose: () => void };

const STEPS = ['연결 열쇠 발급', '네트워크 시크릿 · 환경 변수', '네트워크 허용 목록', '예약 작업 만들기', '트리거 저장', '연결 확인'];

// SCR-149: 처음 연결하기 — 구독 생성 방식의 여섯 단계를 한 화면에 하나씩. 왼쪽 단계 목록, 오른쪽 현재 단계.
// 단계는 순서가 곧 조건이라 선행 조건 표시는 두지 않는다(v0.50). 문구는 v0.50 체크리스트 그대로 (IA — 안 B 결정 3)
export default function FirstConnect({ onClose }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const reloadStatus = () => void api<BriefingStatus>('/briefing/status').then(setStatus, () => {});
  useEffect(reloadStatus, []);
  const sub = useSubscription({ remoteRunning: status?.running?.stage === 'remote', onModeChange: reloadStatus });
  const [step, setStep] = useState(0);
  const info = sub.info;
  const mode = status?.mode ?? 'api';

  const nav = (
    <div className="flex items-center justify-between gap-2">
      <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className={btnClass}>‹ 이전</button>
      {step < STEPS.length - 1 ? (
        <button onClick={() => setStep((s) => s + 1)} className={primaryBtnClass}>다음 ›</button>
      ) : (
        <button onClick={onClose} className={btnClass}>닫기</button>
      )}
    </div>
  );

  const codeCls = 'rounded bg-slate-900 px-1.5 py-0.5 text-slate-300';

  function body() {
    if (!info) return sub.loadError ? <p className="text-sm text-danger-400">구독 상태를 불러오지 못했어요 — {sub.loadError}</p> : <p className="text-sm text-slate-500">불러오는 중…</p>;
    const c = info.checklist;
    switch (step) {
      case 0:
        return (
          <>
            <p>연결 열쇠는 예약 작업이 docvault에 들어올 때 쓰는 열쇠예요. 한 번만 보여요 — 발급하면 바로 다음 단계의 네트워크 시크릿에 넣어 두세요.</p>
            <p className="text-slate-400">{tokenLine(sub)}</p>
            <div className="flex gap-2">
              <button onClick={() => void sub.issueToken()} className={btnClass}>{info.tokenPrefix ? '다시 발급' : '발급'}</button>
            </div>
            <FreshTokenBox sub={sub} />
          </>
        );
      case 1:
        return (
          <>
            <p>claude.ai → 설정 → Claude Code → 환경(기본 브랜치 main)에 두 가지를 넣어요:</p>
            <div className="space-y-1.5">
              <p className="font-semibold text-slate-200">네트워크 시크릿</p>
              <p>
                [시크릿 추가] → 유형 <code className={codeCls}>{c.secret.prefix}</code> · 허용된 웹사이트 <code className={codeCls}>{c.secret.host}</code>{' '}
                <CopyButton sub={sub} text={c.secret.host} what="호스트를" label="복사" />
                {' · '}경로 접두사 <code className={codeCls}>{c.secret.pathPrefix}</code> <CopyButton sub={sub} text={c.secret.pathPrefix} what="경로 접두사를" label="복사" />
                {' · '}헤더 <code className={codeCls}>{c.secret.header}</code> / 접두사 <code className={codeCls}>{c.secret.prefix}</code> / 값 = 발급한 열쇠
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold text-slate-200">환경 변수</p>
              <p>
                {c.envNames.map((n) => (
                  <code key={n} className={codeCls}>{n}</code>
                ))}
                {' = '}
                <code className={codeCls}>{c.docvaultUrl}</code>{' '}
                <CopyButton sub={sub} text={`${c.envNames[0]}=${c.docvaultUrl}`} what="환경 변수 한 줄을" label="한 줄 복사" />
              </p>
            </div>
            <p className="text-slate-500">열쇠는 환경 변수에 넣지 않아요 — 그 화면은 환경을 쓰는 모두가 값을 볼 수 있어요</p>
          </>
        );
      case 2:
        return (
          <>
            <p>
              같은 환경의 네트워크 허용 목록(Network access → Custom)에 아래 줄들을 붙여 넣어요 — docvault 주소와 언론사 도메인(맨몸과 <code className={codeCls}>*.</code> 둘 다)
            </p>
            <CopyButton sub={sub} text={info.allowlist.join('\n')} what={`허용 목록 ${info.allowlist.length}줄을`} label={`허용 목록 ${info.allowlist.length}줄 복사`} />
            <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-400">{info.allowlist.join('\n')}</pre>
            <p className="text-slate-500">맨몸 도메인만 넣으면 www.·rss.·feeds. 주소가 막혀 피드와 원문을 못 받아요. 수집 목록을 고치면 다시 복사해 맞추세요</p>
          </>
        );
      case 3:
        return (
          <>
            <p>예약 작업을 만들어요 — 저장소는 docvault, 일정은 비워 두고(서버가 켜요), 지시문은 아래 한 줄:</p>
            <code className="block rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-300">{c.taskPrompt}</code>
            <CopyButton sub={sub} text={c.taskPrompt} what="지시문을" label="지시문 복사" />
          </>
        );
      case 4:
        return (
          <>
            <p>예약 작업의 트리거 주소와 토큰을 저장해요. 값은 서버가 암호화해 두고 다시 보이지 않아요.</p>
            {info.triggerSet && <p className="text-good-400">설정됨 ✓</p>}
            <TriggerForm sub={sub} />
          </>
        );
      default:
        return (
          <>
            <p>[연결 확인]을 눌러 "연결 확인됨"이 나오면 [구독으로 바꾸기]를 눌러요. 회차는 만들지 않아요.</p>
            <div className="flex flex-wrap items-center gap-2">
              <PingControl sub={sub} />
            </div>
            {mode === 'subscription' ? (
              <p className="text-good-400">생성 방식이 이미 구독이에요</p>
            ) : (
              <button
                onClick={() => void sub.changeMode('subscription', mode)}
                disabled={!sub.ready}
                className="min-h-11 rounded-md border border-warn-600/60 px-3 text-sm font-semibold text-warn-400 hover:bg-warn-800/40 disabled:opacity-40"
              >
                구독으로 바꾸기
              </button>
            )}
          </>
        );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 pc:px-6">
        <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="구독 연결로 돌아가기">‹</button>
        <h2 className="text-base font-bold">처음 연결하기</h2>
        <span className="text-xs text-slate-500">{step + 1} / {STEPS.length}</span>
      </div>
      {IS_TOUCH && <p className="px-4 pt-2 text-xs text-slate-500">한 번 하고 끝나는 작업이라 PC에서 하는 걸 권해요</p>}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-20 pc:flex-row pc:p-6">
        <ol className="flex shrink-0 gap-1 overflow-x-auto pc:w-56 pc:flex-col">
          {STEPS.map((name, i) => (
            <li key={name}>
              <button
                onClick={() => setStep(i)}
                aria-current={i === step ? 'step' : undefined}
                className={`flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-md px-3 text-left text-sm transition ${i === step ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${i === step ? 'bg-accent-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{i + 1}</span>
                {name}
              </button>
            </li>
          ))}
        </ol>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <h3 className="text-sm font-semibold text-slate-200">{step + 1}. {STEPS[step]}</h3>
          <div className="space-y-3 text-sm leading-relaxed text-slate-300">{body()}</div>
          {sub.error && <p className="text-xs text-danger-400">{sub.error}</p>}
          <div className="mt-auto pt-4">{nav}</div>
        </div>
      </div>
    </div>
  );
}
