import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

// 업로드 진행 띠 (SCR-113, 2026-11-04 — 시안 A). 탭 바 바로 위(폰)·오른쪽 아래(PC)에 떠서 어느 탭에 있어도 보인다.
// 올리는 중: 막대 · 이름 · 올린 양/전체 · 남은 시간 · [취소]. 끝: 한 줄 요약(호출자가 잠시 뒤 지운다). 실패: 빨갛게 남아 이유 + [다시].

export type UploadState =
  | { phase: 'uploading'; names: string[]; loaded: number; total: number; startedAt: number }
  | { phase: 'done'; summary: string }
  | { phase: 'error'; message: string; names: string[]; retry: (() => void) | null };

type Props = {
  state: UploadState;
  onCancel: () => void;
  onClose: () => void;
};

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}

function namesLabel(names: string[]): string {
  if (names.length === 0) return '';
  return names.length === 1 ? names[0]! : `${names[0]} 외 ${names.length - 1}개`;
}

/** 남은 시간 — 전체 평균 속도로. 2초는 지나야 믿을 만하고, 3초 아래면 보여 봤자 깜빡인다 */
function etaLabel(loaded: number, total: number, startedAt: number, now: number): string | null {
  const elapsed = now - startedAt;
  if (elapsed < 2000 || loaded <= 0 || loaded >= total) return null;
  const remainMs = ((total - loaded) * elapsed) / loaded;
  if (remainMs < 3000) return null;
  const s = Math.round(remainMs / 1000);
  return s < 60 ? `약 ${s}초 남음` : `약 ${Math.round(s / 60)}분 남음`;
}

export default function UploadStrip({ state, onCancel, onClose }: Props) {
  // 남은 시간 계산용 1초 시계 — 진행 이벤트가 뜸할 때(큰 파일 한 개)도 숫자가 흐르게
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.phase !== 'uploading') return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [state.phase]);

  // body에 포털로, z-50: 작업 공간 안에서 그리면 조상 층에 갇혀 홈·설정 페이지(z-45) 아래로 숨었다 — 알림함과 같은 처방
  const box =
    'fixed z-50 w-[calc(100%-24px)] max-w-sm rounded-xl border bg-panel px-3.5 py-2.5 shadow-xl left-3 bottom-[calc(var(--tab-bar-h)+12px)] pc:left-auto pc:right-4 pc:bottom-4';

  if (state.phase === 'uploading') {
    const pct = state.total > 0 ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : 0;
    const eta = etaLabel(state.loaded, state.total, state.startedAt, now);
    return createPortal(
      <div role="status" aria-live="polite" className={`${box} border-slate-700`}>
        <div className="flex items-center gap-2">
          <Icon name="upload" size={16} className="shrink-0 text-accent-400" />
          <span className="text-sm font-semibold text-slate-100">올리는 중</span>
          <span className="ml-auto text-xs tabular-nums text-slate-400">{pct}%</span>
          <button onClick={onCancel} className="min-h-8 rounded-md px-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 touch:min-h-9">
            취소
          </button>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-slate-800">
          <div className="h-full rounded bg-accent-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="min-w-0 flex-1 truncate">{namesLabel(state.names)}</span>
          <span className="shrink-0 tabular-nums">
            {formatMB(state.loaded)} / {formatMB(state.total)}
            {eta ? ` · ${eta}` : ''}
          </span>
        </div>
      </div>,
      document.body,
    );
  }

  if (state.phase === 'done') {
    return createPortal(
      <div role="status" aria-live="polite" className={`${box} flex items-center gap-2 border-good-800`}>
        <Icon name="check" size={16} className="shrink-0 text-good-400" />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{state.summary}</span>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div role="alert" className={`${box} border-danger-800`}>
      <div className="flex items-center gap-2">
        <Icon name="info" size={16} className="shrink-0 text-danger-400" />
        <span className="text-sm font-semibold text-slate-100">올리지 못했어요</span>
        <span className="ml-auto flex items-center gap-1">
          {state.retry && (
            <button onClick={state.retry} className="min-h-8 rounded-md px-2 text-xs font-semibold text-accent-400 hover:bg-slate-800 touch:min-h-9">
              다시
            </button>
          )}
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="닫기">
            <Icon name="close" size={14} />
          </button>
        </span>
      </div>
      <p className="mt-1 text-xs text-danger-400">{state.message}</p>
      {state.names.length > 0 && <p className="mt-0.5 truncate text-[11px] text-slate-500">{namesLabel(state.names)}</p>}
    </div>,
    document.body,
  );
}
