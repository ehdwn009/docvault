import { useEffect, useRef } from 'react';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP } from '../lib/constants';

type Props = {
  /** 화면 맞춤 사용 여부 */
  fit: boolean;
  /** 지금 적용 중인 글자 크기 배율(%) */
  scale: number;
  /** 이 파일만의 배율인지 — false면 설정의 전역 기본값을 따르는 중 */
  isOverride: boolean;
  onFitChange: (v: boolean) => void;
  onScaleChange: (v: number) => void;
  onResetScale: () => void;
  onClose: () => void;
};

const clamp = (v: number) => Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v));

// SCR-150의 보기 옵션 팝오버 — 헤더 버튼이 늘어나는 걸 막으려고 표시 관련 조작을 한곳에 모았다
export default function ViewOptions({
  fit,
  scale,
  isOverride,
  onFitChange,
  onScaleChange,
  onResetScale,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const stepButton =
    'h-8 w-8 rounded border border-slate-700 text-slate-200 transition hover:bg-slate-800 disabled:opacity-30';

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-40 mt-1 w-60 rounded-md border border-slate-700 bg-slate-900 p-3 shadow-xl"
    >
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
  );
}
