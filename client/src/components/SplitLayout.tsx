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
  /** 분할 해제 — 활성 칸만 남긴다 (문서는 탭에 남음) */
  onUnsplit: () => void;
  renderPane: (file: TreeFile, idx: number) => ReactNode;
};

/** 비율 조절 한계 — 한 칸이 사실상 사라질 만큼 좁아지지 않게 */
const RATIO_MIN = 20;
const RATIO_MAX = 80;
/** 이 거리(px)를 넘게 움직이면 탭이 아니라 드래그로 판정 */
const DRAG_THRESHOLD = 6;
/** 컨트롤러의 비율 프리셋 — 폰에서 원하는 비율은 연속값이 아니라 이 셋이다 (IA — 분할 컨트롤러) */
const PRESETS = [66, 50, 34];

// SCR-154·155: 분할 레이아웃 + 컨트롤러 — 프리셋: 1칸 / 2=좌우(모바일 상하) / 3=좌1+우2 / 4=2×2.
// 구분선 손잡이는 "잡는 것"이 아니라 "컨트롤러를 여는 버튼"이 기본이고, 드래그는 보조 (IA)
export default function SplitLayout({ panes, activeIdx, isWide, ratio, onRatioChange, onActivate, onSwap, onUnsplit, renderPane }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 드래그 중에는 전체를 덮는 투명막을 깐다 — iframe(HTML·PDF) 위에서는 포인터 이동이 부모에 안 오기 때문
  const [dragging, setDragging] = useState(false);
  // 컨트롤러 팝업 위치 (탭한 지점) — null이면 닫힘
  const [controller, setController] = useState<{ x: number; y: number } | null>(null);

  // 짧게 탭 = 컨트롤러, 임계값 넘게 끌기 = 비율 드래그. 하나의 pointerdown에서 갈린다
  function handleDividerDown(e: ReactPointerEvent) {
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let isDrag = false;
    const move = (ev: PointerEvent) => {
      if (!isDrag) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) {
          return;
        }
        isDrag = true;
        setDragging(true);
      }
      const frac = isWide
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      onRatioChange(Math.round(Math.min(RATIO_MAX, Math.max(RATIO_MIN, frac * 100))));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      if (!isDrag) setController({ x: ev.clientX, y: ev.clientY });
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
    // flex 컨테이너여야 paneBox의 flex-1이 높이를 받는다 — 아니면 뷰어의 h-full 사슬이
    // 끊겨 본문이 잘리고 스크롤이 죽는다 (v0.15.1에서 수정)
    return <div className="flex min-h-0 flex-1 flex-col">{paneBox(0)}</div>;
  }

  const presetLabel = (p: number) =>
    p === 50 ? '반반' : p > 50 ? (isWide ? '왼쪽 크게' : '위 크게') : (isWide ? '오른쪽 크게' : '아래 크게');

  const controlButton =
    'flex-1 whitespace-nowrap rounded-md border border-slate-700 px-3 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800 active:bg-slate-700';

  const mainDivider = (
    <div
      className={`relative shrink-0 bg-slate-800 transition hover:bg-slate-600 ${
        isWide ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
      }`}
    >
      {/* 보이는 바는 얇게, 잡히는 영역은 넓게 — 터치 최소 타깃을 투명 존으로 확보 (IA) */}
      <div
        onPointerDown={handleDividerDown}
        className={`absolute z-10 ${isWide ? '-left-3 -right-3 inset-y-0 cursor-col-resize' : '-top-3 -bottom-3 inset-x-0 cursor-row-resize'}`}
      />
      {/* 알약 손잡이 — "여기를 탭하면 분할 조작"의 표식 */}
      <div
        className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-500 ${
          isWide ? 'h-9 w-1' : 'h-1 w-9'
        }`}
      />
    </div>
  );

  return (
    <div ref={containerRef} className={`flex min-h-0 flex-1 ${isWide ? 'flex-row' : 'flex-col'}`}>
      {/* 첫 묶음만 비율을 갖고 나머지는 남는 공간을 채운다 — 상태 하나로 모든 프리셋을 감당 */}
      <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: `0 0 ${ratio}%` }}>
        {column(groups[0]!)}
      </div>
      {mainDivider}
      {column(groups[1]!)}
      {dragging && (
        <div className={`fixed inset-0 z-50 ${isWide ? 'cursor-col-resize' : 'cursor-row-resize'}`} />
      )}
      {controller && (
        <div className="fixed inset-0 z-50" onPointerDown={() => setController(null)}>
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute w-64 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl"
            style={{
              left: Math.min(Math.max(controller.x, 140), window.innerWidth - 140),
              top: Math.min(Math.max(controller.y, 90), window.innerHeight - 90),
            }}
          >
            <div className="flex gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    onRatioChange(p);
                    setController(null);
                  }}
                  className={`${controlButton} ${ratio === p ? 'border-sky-700 bg-slate-800 text-sky-300' : ''}`}
                >
                  {presetLabel(p)}
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {panes.length === 2 && (
                <button
                  onClick={() => {
                    onSwap();
                    setController(null);
                  }}
                  className={controlButton}
                >
                  {isWide ? '⇄' : '⇅'} 자리 바꾸기
                </button>
              )}
              <button
                onClick={() => {
                  onUnsplit();
                  setController(null);
                }}
                className={controlButton}
              >
                ⊟ 분할 해제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
