import type { TreeFile } from '../lib/api';

type Props = {
  tabs: TreeFile[];
  activeId: number | null;
  /** 화면(칸)에 떠 있는 문서들 — "분할" 버튼을 숨길 대상 */
  paneIds: number[];
  onPick: (file: TreeFile) => void;
  onSplit: (file: TreeFile) => void;
  onCloseTab: (file: TreeFile) => void;
  onClose: () => void;
};

// SCR-153(터치 변형): 문서 스위처 — 폰에서 탭은 가로줄이 아니라 세로 목록 시트다 (IA — 모바일 재편).
// 가로 탭 바는 폰 폭에서 이름이 다 잘리고, 시트는 이름·활성·분할·닫기를 한 줄에 담는다
export default function TabSwitcher({ tabs, activeId, paneIds, onPick, onSplit, onCloseTab, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-slate-700 bg-slate-900 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        {/* 알약 손잡이 — 시트 관례: 아래서 왔고 아래로 보낼 수 있다는 표식 */}
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-slate-600" />
        <p className="px-4 pb-1 pt-2 text-xs font-medium text-slate-500">열린 문서 {tabs.length}개</p>
        {tabs.map((f) => {
          const active = f.id === activeId;
          const visible = paneIds.includes(f.id);
          return (
            <div
              key={f.id}
              className={`flex items-center gap-2 px-2 py-1 ${active ? 'bg-slate-800/60' : ''}`}
            >
              <button
                onClick={() => {
                  onPick(f);
                  onClose();
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2.5 text-left"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-sky-400' : visible ? 'bg-slate-500' : 'bg-transparent'}`} />
                <span className={`truncate text-sm ${active ? 'text-slate-100' : 'text-slate-300'}`}>{f.name}</span>
              </button>
              {!visible && (
                <button
                  onClick={() => {
                    onSplit(f);
                    onClose();
                  }}
                  title="분할로 보기"
                  className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300"
                >
                  ◫ 분할
                </button>
              )}
              <button
                onClick={() => onCloseTab(f)}
                title="닫기"
                className="shrink-0 rounded-md px-2.5 py-1.5 text-slate-500"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
