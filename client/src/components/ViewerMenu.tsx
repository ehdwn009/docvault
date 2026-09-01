import { useEffect, useRef, useState } from 'react';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP } from '../lib/constants';

/** 메뉴 한 줄 — 링크(다운로드)와 동작 둘 다 담는다 */
export type ViewerAction = {
  label: string;
  onClick?: () => void;
  /** 다운로드처럼 주소를 여는 항목 (브라우저가 디스크로 바로 흘리게 <a>를 쓴다) */
  href?: string;
  download?: string;
  active?: boolean;
};

/** 표시 조작 — 글자 크기는 모든 문서 형식이, 화면 맞춤은 HTML만 갖는다 */
export type DisplayOptions = {
  /** 조작판 제목 — 기본 "글자 크기". PDF처럼 통째로 커지는 형식은 "확대/축소"로 바꿔 단다 */
  label?: string;
  scale: number;
  isOverride: boolean;
  onScaleChange: (v: number) => void;
  onResetScale: () => void;
  /** 화면 맞춤은 HTML 전용 — md·텍스트는 우리가 그리므로 이미 화면 폭에 맞는다 */
  fit?: { on: boolean; onChange: (v: boolean) => void };
};

type Props = {
  open: boolean;
  /** 헤더에서는 아래로, 하단 도구막대에서는 위로 펼친다 */
  placement: 'up' | 'down';
  buttonClass: (active: boolean) => string;
  display: DisplayOptions | null;
  items: ViewerAction[];
  onToggle: () => void;
  onClose: () => void;
};

const clamp = (v: number) => Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v));

// 터치 기기에서는 팝오버 대신 바텀 시트로 — 메뉴가 엄지 앞에 오게 (IA — 모바일 재편).
// 기기 특성이라 실행 중 안 바뀌므로 한 번만 잰다 (CSS pc:/touch: 변형과 같은 판정)
const IS_TOUCH = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// SCR-150의 더보기 메뉴 — 헤더에 버튼이 늘어나는 걸 막으려고 뷰어의 조작을 한곳에 모았다.
// 여는 버튼까지 이 컴포넌트가 들고 있는 이유: 버튼이 "바깥"으로 판정되면 바깥 클릭이 닫고
// 곧바로 버튼의 클릭이 다시 여는 탓에 한 번 더 눌러도 안 닫히는 것처럼 보인다.
export default function ViewerMenu({
  open,
  placement,
  buttonClass,
  display,
  items,
  onToggle,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<HTMLDivElement>(null);
  // 입력 중인 글자(“1”만 친 순간 10으로 튀지 않게) — null이면 실제 배율을 그대로 보여준다
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // pointerdown이면 마우스·터치·펜을 한 번에 받는다 (터치에서 mousedown은 안 오는 경우가 있다)
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // 휠로도 1%씩(Shift면 10%씩) 맞출 수 있게 한다. 리액트의 onWheel은 passive라
  // preventDefault가 안 먹어 뒤쪽 본문이 같이 밀린다 — 그래서 직접 등록한다
  const displayRef = useRef(display);
  displayRef.current = display;
  useEffect(() => {
    const el = sizeRef.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      const d = displayRef.current;
      if (!d) return;
      e.preventDefault();
      const step = e.shiftKey ? FONT_SCALE_STEP : 1;
      d.onScaleChange(clamp(d.scale + (e.deltaY < 0 ? step : -step)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  // 입력 중에 메뉴를 닫으면 그 글자는 버린다 (다시 열었을 때 남아 있으면 헷갈린다)
  useEffect(() => {
    if (!open) setDraft(null);
  }, [open]);

  /** 직접 입력 확정 — 빈 칸이나 숫자가 아니면 원래 값으로 되돌린다 */
  function commitDraft(display: DisplayOptions) {
    if (draft !== null) {
      const n = Number(draft);
      if (draft.trim() !== '' && Number.isFinite(n)) display.onScaleChange(clamp(Math.round(n)));
    }
    setDraft(null);
  }

  const stepButton =
    'h-9 w-9 rounded border border-slate-700 text-slate-200 transition hover:bg-slate-800 disabled:opacity-30';
  const rowClass =
    'block w-full rounded px-2 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800';

  return (
    <div ref={ref} className="relative">
      <button onClick={onToggle} className={buttonClass(open)} title="더보기">
        ⋯
      </button>
      {open && IS_TOUCH && (
        // 시트의 배경막 — ref 안에 있어서 바깥 클릭 판정을 안 타므로 직접 닫는다
        <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      )}
      {open && (
        <div
          className={
            IS_TOUCH
              ? 'fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]'
              : `absolute right-0 z-40 w-60 rounded-md border border-slate-700 bg-slate-900 p-3 shadow-xl ${
                  placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
                }`
          }
        >
          {IS_TOUCH && <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-slate-600" />}
          {display && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">{display.label ?? '글자 크기'}</span>
                <span className={`text-xs ${display.isOverride ? 'text-sky-400' : 'text-slate-500'}`}>
                  {display.isOverride ? '이 문서만' : '기본값'}
                </span>
              </div>
              {/* 조작을 세 층으로 둔다: −/+는 큼직하게 10%씩, 슬라이더·휠은 1%씩, 숫자는 정확한 값 */}
              <div ref={sizeRef} className="mt-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => display.onScaleChange(clamp(display.scale - FONT_SCALE_STEP))}
                    disabled={display.scale <= FONT_SCALE_MIN}
                    title="작게"
                    className={stepButton}
                  >
                    −
                  </button>
                  <label className="flex items-center gap-1 text-sm text-slate-100">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={FONT_SCALE_MIN}
                      max={FONT_SCALE_MAX}
                      value={draft ?? display.scale}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitDraft(display)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setDraft(null);
                      }}
                      title={`${FONT_SCALE_MIN}~${FONT_SCALE_MAX} 사이 값`}
                      className="w-14 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center tabular-nums outline-none focus:border-sky-500"
                    />
                    %
                  </label>
                  <button
                    onClick={() => display.onScaleChange(clamp(display.scale + FONT_SCALE_STEP))}
                    disabled={display.scale >= FONT_SCALE_MAX}
                    title="크게"
                    className={stepButton}
                  >
                    +
                  </button>
                </div>
                <input
                  type="range"
                  min={FONT_SCALE_MIN}
                  max={FONT_SCALE_MAX}
                  step={1}
                  value={display.scale}
                  onChange={(e) => display.onScaleChange(Number(e.target.value))}
                  title="드래그하면 1%씩 (마우스 휠도 가능, Shift와 함께면 10%씩)"
                  className="mt-2 w-full accent-sky-500"
                />
              </div>
              {/* 되돌릴 길이 없으면 한 번 만진 파일이 영영 전역 설정에서 이탈한다 */}
              <button
                onClick={display.onResetScale}
                disabled={!display.isOverride}
                className="mt-2 w-full rounded border border-slate-800 py-1 text-xs text-slate-400 transition hover:bg-slate-800 disabled:opacity-30"
              >
                설정의 기본값 따르기
              </button>
              {display.fit && (
                <>
                  <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={display.fit.on}
                      onChange={(e) => display.fit?.onChange(e.target.checked)}
                      className="accent-sky-500"
                    />
                    화면 맞춤
                  </label>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    문서가 화면보다 넓으면 화면 폭에 맞춥니다.
                  </p>
                </>
              )}
              <div className="my-3 border-t border-slate-800" />
            </>
          )}

          {items.map((item) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                download={item.download}
                onClick={onClose}
                className={rowClass}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                onClick={() => {
                  onClose();
                  item.onClick?.();
                }}
                className={`${rowClass} ${item.active ? 'bg-slate-800 text-slate-100' : ''}`}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
