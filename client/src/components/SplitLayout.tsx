import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { TreeFile } from '../lib/api';

type Props = {
  panes: TreeFile[];
  activeIdx: number;
  /** true면 좌우 프리셋(최대 4칸), false면 상하(최대 2칸) — 768px 기준 (IA — 반응형) */
  isWide: boolean;
  /** 첫 묶음(왼쪽/위)의 크기 비율 % */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onActivate: (idx: number) => void;
  onSwap: () => void;
  renderPane: (file: TreeFile, idx: number) => ReactNode;
};

/** 비율 조절 한계 — 한 칸이 사실상 사라질 만큼 좁아지지 않게 */
const RATIO_MIN = 20;
const RATIO_MAX = 80;

// SCR-154: 분할 레이아웃 — 프리셋: 1칸 / 2=좌우(모바일 상하) / 3=좌1+우2 / 4=2×2 (IA — 탭 바 + 분할 보기)
export default function SplitLayout({ panes, activeIdx, isWide, ratio, onRatioChange, onActivate, onSwap, renderPane }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 드래그 중에는 전체를 덮는 투명막을 깐다 — iframe(HTML·PDF) 위에서는 포인터 이동이 부모에 안 오기 때문
  const [dragging, setDragging] = useState(false);

  function startDrag(e: ReactPointerEvent) {
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    setDragging(true);
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const frac = isWide
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      onRatioChange(Math.round(Math.min(RATIO_MAX, Math.max(RATIO_MIN, frac * 100))));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const paneBox = (idx: number) => (
    <div
      key={panes[idx]!.id}
      onPointerDownCapture={() => onActivate(idx)}
      className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${
        panes.length > 1 && idx === activeIdx ? 'ring-1 ring-inset ring-sky-800' : ''
      }`}
    >
      {renderPane(panes[idx]!, idx)}
    </div>
  );

  /** 칸들을 두 묶음으로 배치 — 채우는 순서: 좌 → 우상 → 우하 → 좌하 */
  const groups: number[][] =
    panes.length <= 1 ? [[0]]
    : panes.length === 2 ? [[0], [1]]
    : panes.length === 3 ? [[0], [1, 2]]
    : [[0, 3], [1, 2]];

  const column = (idxs: number[]) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {idxs.map((i, k) => (
        <div key={panes[i]!.id} className="contents">
          {k > 0 && <div className="h-1.5 shrink-0 bg-slate-800" />}
          {paneBox(i)}
        </div>
      ))}
    </div>
  );

  if (panes.length === 1) {
    return <div className="min-h-0 flex-1">{paneBox(0)}</div>;
  }

  const mainDivider = (
    <div
      onPointerDown={startDrag}
      className={`relative shrink-0 bg-slate-800 transition hover:bg-slate-600 ${
        isWide ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
      }`}
    >
      {panes.length === 2 && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onSwap}
          title="자리 바꾸기"
          className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400 shadow transition hover:text-slate-100"
        >
          {isWide ? '⇄' : '⇅'}
        </button>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className={`flex min-h-0 flex-1 ${isWide ? 'flex-row' : 'flex-col'}`}>
      {/* 첫 묶음만 비율을 갖고 나머지는 남는 공간을 채운다 — 상태 하나로 모든 프리셋을 감당 */}
      <div
        className="flex min-h-0 min-w-0 flex-col"
        style={{ flex: `0 0 ${ratio}%` }}
      >
        {column(groups[0]!)}
      </div>
      {mainDivider}
      {column(groups[1]!)}
      {dragging && (
        <div className={`fixed inset-0 z-50 ${isWide ? 'cursor-col-resize' : 'cursor-row-resize'}`} />
      )}
    </div>
  );
}
