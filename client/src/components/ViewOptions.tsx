import { useEffect, useRef } from 'react';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP } from '../lib/constants';

type Props = {
  open: boolean;
  /** 화면 맞춤 사용 여부 */
  fit: boolean;
  /** 지금 적용 중인 글자 크기 배율(%) */
  scale: number;
  /** 이 파일만의 배율인지 — false면 설정의 전역 기본값을 따르는 중 */
  isOverride: boolean;
  /** 헤더의 다른 버튼과 같은 모양을 쓰기 위해 부모가 넘긴다 */
  buttonClass: (active: boolean) => string;
  onToggle: () => void;
  onClose: () => void;
  onFitChange: (v: boolean) => void;
  onScaleChange: (v: number) => void;
  onResetScale: () => void;
};

const clamp = (v: number) => Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v));

// SCR-150의 보기 옵션 — 헤더 버튼이 늘어나는 걸 막으려고 표시 관련 조작을 한곳에 모았다.
// 여는 버튼까지 이 컴포넌트가 들고 있는 이유: 버튼이 "바깥"으로 판정되면 바깥 클릭이 닫고
// 곧바로 버튼의 클릭이 다시 여는 탓에 한 번 더 눌러도 안 닫히는 것처럼 보인다.
export default function ViewOptions({
  open,
  fit,
  scale,
  isOverride,
  buttonClass,
  onToggle,
  onClose,
  onFitChange,
  onScaleChange,
  onResetScale,
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
    'h-8 w-8 rounded border border-slate-700 text-slate-200 transition hover:bg-slate-800 disabled:opacity-30';

  return (
    <div ref={ref} className="relative">
      <button onClick={onToggle} className={buttonClass(open)} title="보기 — 글자 크기·화면 맞춤">
        보기
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-md border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">글자 크기</span>
            <span className={`text-xs ${isOverride ? 'text-sky-400' : 'text-slate-500'}`}>
              {isOverride ? '이 문서만' : '기본값'}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              onClick={() => onScaleChange(clamp(scale - FONT_SCALE_STEP))}
              disabled={scale <= FONT_SCALE_MIN}
              title="작게"
              className={stepButton}
            >
              −
            </button>
            <span className="text-sm tabular-nums text-slate-100">{scale}%</span>
            <button
              onClick={() => onScaleChange(clamp(scale + FONT_SCALE_STEP))}
              disabled={scale >= FONT_SCALE_MAX}
              title="크게"
              className={stepButton}
            >
              +
            </button>
          </div>
          {/* 되돌릴 길이 없으면 한 번 만진 파일이 영영 전역 설정에서 이탈한다 */}
          <button
            onClick={onResetScale}
            disabled={!isOverride}
            className="mt-2 w-full rounded border border-slate-800 py-1 text-xs text-slate-400 transition hover:bg-slate-800 disabled:opacity-30"
          >
            설정의 기본값 따르기
          </button>

          <label className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={fit}
              onChange={(e) => onFitChange(e.target.checked)}
              className="accent-sky-500"
            />
            화면 맞춤
          </label>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            문서가 화면보다 넓으면 화면 폭에 맞춥니다. 끄면 문서 원본 그대로 보입니다.
          </p>
        </div>
      )}
    </div>
  );
}
