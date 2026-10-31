import { kstTime, PING_LABEL } from '../../lib/briefing';
import { btnClass, dangerBtnClass, inputClass, smallBtnClass } from './SettingRow';
import type { Subscription } from './useSubscription';

// 구독 연결의 작은 부품들 — 구독 연결 카테고리(SCR-402)와 처음 연결하기(SCR-149)가 같은 모양으로 쓴다

/** 트리거 주소의 모양 — 서버 SUB_TRIGGER_HOST·SUB_TRIGGER_PATH와 같은 규칙. 화면은 미리 알려 주기만 하고 검사는 서버가 한다 */
export const TRIGGER_URL_HINT = 'https://api.anthropic.com/v1/claude_code/routines/<id>/fire';

/** 발급 직후 한 번만 보이는 열쇠 원문 상자 */
export function FreshTokenBox({ sub }: { sub: Subscription }) {
  if (!sub.freshToken) return null;
  return (
    <div className="max-w-xl rounded-md border border-warn-700/50 bg-warn-900/20 p-3 text-sm text-warn-400">
      <p className="text-xs">이 창을 닫으면 다시 볼 수 없어요 — claude.ai 환경의 네트워크 시크릿(Bearer)의 헤더 값에 넣어 두세요</p>
      <code className="mt-1.5 block break-all rounded bg-slate-950 px-2 py-1.5 text-xs text-slate-200">{sub.freshToken}</code>
      <div className="mt-2 flex gap-2">
        <button onClick={() => sub.copy(sub.freshToken!, '연결 열쇠를')} className="min-h-11 rounded-md border border-warn-600/60 px-3 text-sm font-semibold text-warn-400 hover:bg-warn-800/40">
          복사
        </button>
        <button onClick={sub.closeFreshToken} className={btnClass}>닫기</button>
      </div>
    </div>
  );
}

/** 연결 열쇠 상태 한 줄 — 접두어 · 발급 · 마지막 사용 */
export function tokenLine(sub: Subscription): string {
  const info = sub.info;
  if (!info?.tokenPrefix) return '아직 발급하지 않았어요';
  return `${info.tokenPrefix}… · 발급 ${info.tokenCreatedAt ? kstTime(info.tokenCreatedAt) : ''} · ${info.tokenLastUsedAt ? `마지막 사용 ${kstTime(info.tokenLastUsedAt)}` : '아직 사용 안 함'}`;
}

/** 트리거 주소·토큰 입력 + 저장 */
export function TriggerForm({ sub, onSaved }: { sub: Subscription; onSaved?: () => void }) {
  const set = !!sub.info?.triggerSet;
  return (
    <div className="flex max-w-xl flex-col gap-2">
      {/* 글자 칸 + 비밀번호 칸을 브라우저가 로그인 폼으로 오해해 저장된 아이디·비밀번호를 채워 넣었다(첫 배포 2026-10-30) — autocomplete=off는 비밀번호 칸에 안 먹으므로 new-password와 낯선 name으로 */}
      <input
        type="url"
        name="briefing-trigger-fire-url"
        value={sub.triggerUrl}
        onChange={(e) => sub.setTriggerUrl(e.target.value)}
        placeholder={set ? '바꾸려면 새 주소' : TRIGGER_URL_HINT}
        autoComplete="off"
        spellCheck={false}
        className={inputClass}
      />
      <input
        type="password"
        name="briefing-trigger-secret"
        value={sub.triggerToken}
        onChange={(e) => sub.setTriggerToken(e.target.value)}
        placeholder={set ? '바꾸려면 새 토큰' : '트리거 토큰'}
        autoComplete="new-password"
        className={inputClass}
      />
      <div className="flex gap-2">
        <button onClick={() => void sub.saveTrigger().then((ok) => ok && onSaved?.())} disabled={sub.savingTrigger} className={btnClass}>
          {sub.savingTrigger ? '저장하는 중…' : set ? '바꾸기' : '저장'}
        </button>
        {set && <button onClick={() => void sub.clearTrigger()} className={dangerBtnClass}>지우기</button>}
      </div>
    </div>
  );
}

/** [연결 확인] 단추 + 마지막 결과 */
export function PingControl({ sub }: { sub: Subscription }) {
  const info = sub.info;
  if (!info) return null;
  const tone = info.lastPingResult === 'ok' ? 'text-good-400' : info.lastPingResult === 'fired' ? 'text-accent-300' : 'text-warn-400';
  return (
    <>
      {info.lastPingResult && (
        <span className={`text-sm ${tone}`}>
          {PING_LABEL[info.lastPingResult]}
          {info.lastPingAt && info.lastPingResult !== 'no_request' ? ` (${kstTime(info.lastPingAt, false)})` : ''}
        </span>
      )}
      <button onClick={() => void sub.ping()} disabled={!info.triggerSet || sub.pinging} className={btnClass}>
        {sub.pinging ? '확인하는 중…' : '연결 확인'}
      </button>
    </>
  );
}

export function CopyButton({ sub, text, what, label }: { sub: Subscription; text: string; what: string; label: string }) {
  return (
    <button onClick={() => sub.copy(text, what)} className={smallBtnClass}>
      {label}
    </button>
  );
}
