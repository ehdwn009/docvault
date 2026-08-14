import type { ReactNode } from 'react';
import type { TreeFolder } from '../lib/api';

type Props = {
  folders: TreeFolder[];
  title: string;
  onPick: (folderId: number | null) => void;
  onClose: () => void;
};

// 폴더 선택 모달 — 일괄 이동, 터치 기기의 "이동..." 메뉴 등 DnD가 어려운 상황의 대체 수단
export default function FolderPicker({ folders, title, onPick, onClose }: Props) {
  const renderLevel = (parentId: number | null, depth: number): ReactNode =>
    folders
      .filter((f) => f.parentId === parentId)
      .map((folder) => (
        <div key={folder.id}>
          <button
            onClick={() => onPick(folder.id)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800"
            style={{ paddingLeft: `${8 + depth * 16}px` }}
          >
            <span>📁</span>
            <span className="truncate">{folder.name}</span>
          </button>
          {renderLevel(folder.id, depth + 1)}
        </div>
      ));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[70vh] w-80 flex-col rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="text-sm font-medium text-slate-100">{title}</h3>
        <div className="mt-3 flex-1 overflow-y-auto">
          <button
            onClick={() => onPick(null)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800"
          >
            <span>🏠</span> 최상위
          </button>
          {renderLevel(null, 0)}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
