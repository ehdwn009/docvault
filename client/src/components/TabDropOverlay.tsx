import { useState, type DragEvent } from 'react';
import type { TreeFile } from '../lib/api';
import { paneGroups } from './SplitLayout';
import { TAB_DRAG_TYPE } from './TabBar';

type Props = {
  panes: TreeFile[];
  isWide: boolean;
  /** 첫 묶음의 크기 비율 % — SplitLayout과 같은 기하를 그려야 존이 칸과 겹친다 */
  ratio: number;
  /** 칸 상한 미달일 때만 "새 칸으로 분할" 스트립을 보여준다 */
  canAdd: boolean;
  onDropPane: (idx: number) => void;
  onDropNew: () => void;
};

// 탭 드래그 중에만 본문 위에 깔리는 드롭 존 (IA — 탭 드래그 배치).
// iframe(HTML·PDF)이 드래그 이벤트를 삼키므로, 비율 드래그의 투명막과 같은 수법으로
// 전체를 덮는 층에서 dragover/drop을 받는다
export default function TabDropOverlay({ panes, isWide, ratio, canAdd, onDropPane, onDropNew }: Props) {
  // 지금 포개져 있는 존 — 칸 인덱스 또는 'new'
  const [hover, setHover] = useState<number | 'new' | null>(null);

  const isTabDrag = (e: DragEvent) => e.dataTransfer.types.includes(TAB_DRAG_TYPE);
  const zoneProps = (key: number | 'new', drop: () => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!isTabDrag(e)) return;
      e.preventDefault();
      setHover(key);
    },
    onDragLeave: () => setHover((h) => (h === key ? null : h)),
    onDrop: (e: DragEvent) => {
      if (!isTabDrag(e)) return;
      e.preventDefault();
      setHover(null);
      drop();
    },
  });

  const cell = (idx: number) => (
    <div
      key={panes[idx]!.id}
      {...zoneProps(idx, () => onDropPane(idx))}
      className={`flex flex-1 items-center justify-center border border-dashed transition ${
        hover === idx ? 'border-sky-400 bg-sky-500/15' : 'border-slate-700/60 bg-slate-950/30'
      }`}
    >
      {hover === idx && <span className="rounded bg-slate-900/90 px-3 py-1.5 text-sm text-sky-300">여기에 표시</span>}
    </div>
  );

  const groups = paneGroups(panes.length);
  const column = (idxs: number[]) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{idxs.map(cell)}</div>
  );

  return (
    <div className={`absolute inset-0 z-40 flex ${isWide ? 'flex-row' : 'flex-col'}`}>
      {panes.length === 1 ? (
        column(groups[0]!)
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-col" style={{ flex: `0 0 ${ratio}%` }}>
            {column(groups[0]!)}
          </div>
          <div className={isWide ? 'w-1.5 shrink-0' : 'h-1.5 shrink-0'} />
          {column(groups[1]!)}
        </>
      )}
      {/* 새 칸 스트립 — 칸 존들 위에 겹쳐 가장자리에 둔다 (실제 칸 기하를 흐트러뜨리지 않게) */}
      {canAdd && (
        <div
          {...zoneProps('new', onDropNew)}
          className={`absolute flex items-center justify-center border border-dashed transition ${
            isWide ? 'inset-y-0 right-0 w-24 flex-col gap-1.5' : 'inset-x-0 bottom-0 h-20 gap-2'
          } ${hover === 'new' ? 'border-sky-400 bg-sky-500/20' : 'border-slate-600 bg-slate-950/70'}`}
        >
          <span className={`text-lg leading-none ${hover === 'new' ? 'text-sky-300' : 'text-slate-400'}`}>⊞</span>
          <span className={`px-2 text-center text-sm leading-snug ${hover === 'new' ? 'text-sky-300' : 'text-slate-400'}`}>
            {/* 좌우 스트립은 폭이 좁아 두 줄로 나눠야 어색하게 접히지 않는다 */}
            {isWide ? <>새 칸으로<br />분할</> : '새 칸으로 분할'}
          </span>
        </div>
      )}
    </div>
  );
}
