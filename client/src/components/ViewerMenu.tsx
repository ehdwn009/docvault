import { useEffect, useRef } from 'react';
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

/** 표시 조작 — HTML 문서에만 의미가 있어서 없을 수도 있다 */
export type DisplayOptions = {
  fit: boolean;
  scale: number;
  isOverride: boolean;
  onFitChange: (v: boolean) => void;
  onScaleChange: (v: number) => void;
  onResetScale: () => void;
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

  const stepButton =
    'h-9 w-9 rounded border border-slate-700 text-slate-200 transition hover:bg-slate-800 disabled:opacity-30';
  const rowClass =
    'block w-full rounded px-2 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800';

  return (
    <div ref={ref} className="relative">
      <button onClick={onToggle} className={buttonClass(open)} title="더보기">
        ⋯
      </button>
      {open && (
        <div
          className={`absolute right-0 z-40 w-60 rounded-md border border-slate-700 bg-slate-900 p-3 shadow-xl ${
            placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {display && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">글자 크기</span>
                <span className={`text-xs ${display.isOverride ? 'text-sky-400' : 'text-slate-500'}`}>
                  {display.isOverride ? '이 문서만' : '기본값'}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  onClick={() => display.onScaleChange(clamp(display.scale - FONT_SCALE_STEP))}
                  disabled={display.scale <= FONT_SCALE_MIN}
                  title="작게"
                  className={stepButton}
                >
                  −
                </button>
                <span className="text-sm tabular-nums text-slate-100">{display.scale}%</span>
                <button
                  onClick={() => display.onScaleChange(clamp(display.scale + FONT_SCALE_STEP))}
                  disabled={display.scale >= FONT_SCALE_MAX}
                  title="크게"
                  className={stepButton}
                >
                  +
                </button>
              </div>
              {/* 되돌릴 길이 없으면 한 번 만진 파일이 영영 전역 설정에서 이탈한다 */}
              <button
                onClick={display.onResetScale}
                disabled={!display.isOverride}
                className="mt-2 w-full rounded border border-slate-800 py-1 text-xs text-slate-400 transition hover:bg-slate-800 disabled:opacity-30"
              >
                설정의 기본값 따르기
              </button>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={display.fit}
                  onChange={(e) => display.onFitChange(e.target.checked)}
                  className="accent-sky-500"
                />
                화면 맞춤
              </label>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                문서가 화면보다 넓으면 화면 폭에 맞춥니다.
              </p>
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
