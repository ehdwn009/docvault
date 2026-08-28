import type { TreeFile } from '../lib/api';

type Props = {
  tabs: TreeFile[];
  /** 활성 칸에 보이는 문서 — 밝게 강조 */
  activeId: number | null;
  /** 화면(칸)에 떠 있는 문서들 — 대기 탭과 톤을 구분 */
  paneIds: number[];
  onPick: (file: TreeFile) => void;
  onClose: (file: TreeFile) => void;
};

// SCR-153: 탭 바 — "열려 있다"(탭)와 "보이고 있다"(분할 칸)의 분리 (IA — 탭 바 + 분할 보기)
export default function TabBar({ tabs, activeId, paneIds, onPick, onClose }: Props) {
  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-slate-800 bg-slate-950 px-1 pt-1">
      {tabs.map((f) => {
        const active = f.id === activeId;
        const visible = paneIds.includes(f.id);
        return (
          <div
            key={f.id}
            role="tab"
            title={f.name}
            onClick={() => onPick(f)}
            // 가운데 클릭으로도 닫기 — 브라우저 탭과 같은 문법
            onAuxClick={(e) => e.button === 1 && onClose(f)}
            className={`group flex max-w-48 shrink-0 cursor-pointer items-center gap-1 rounded-t-md border-x border-t px-2.5 py-1.5 text-xs transition ${
              active
                ? 'border-slate-700 bg-slate-800 text-slate-100'
                : visible
                  ? 'border-slate-800 bg-slate-900 text-slate-300'
                  : 'border-transparent text-slate-500 hover:bg-slate-900 hover:text-slate-300'
            }`}
          >
            <span className="truncate">{f.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(f);
              }}
              title="닫기"
              className="shrink-0 rounded px-0.5 text-slate-600 transition hover:text-slate-200"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
