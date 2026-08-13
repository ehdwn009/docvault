import { useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { TreeFile, TreeFolder } from '../lib/api';
import ContextMenu, { type MenuItem } from './ContextMenu';

const TYPE_BADGE: Record<string, string> = {
  md: 'text-sky-400',
  html: 'text-orange-400',
  text: 'text-zinc-400',
  code: 'text-emerald-400',
  image: 'text-purple-400',
  pdf: 'text-red-400',
};

export type TreeActions = {
  createFolder: (parentId: number | null) => void;
  renameFolder: (id: number, name: string) => void;
  moveFolder: (id: number, parentId: number | null) => void;
  deleteFolder: (id: number) => void;
  renameFile: (id: number, name: string) => void;
  moveFile: (id: number, folderId: number | null) => void;
  deleteFile: (id: number) => void;
  copyFile: (id: number) => void;
  uploadTo: (folderId: number | null) => void;
};

type Props = {
  folders: TreeFolder[];
  files: TreeFile[];
  selectedId: number | null;
  onSelect: (file: TreeFile) => void;
  actions: TreeActions;
};

type Renaming = { kind: 'file' | 'folder'; id: number; value: string };
type Menu = { x: number; y: number; items: MenuItem[] };
type DragPayload = { kind: 'file' | 'folder'; id: number };

// SCR-110: 파일 트리 — 우클릭 컨텍스트 메뉴, 인라인 이름변경, 드래그앤드롭 이동
export default function FileTree({ folders, files, selectedId, onSelect, actions }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [dropTarget, setDropTarget] = useState<number | 'root' | null>(null);

  function openMenu(e: ReactMouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startDrag(e: DragEvent, payload: DragPayload) {
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }

  function allowDrop(e: DragEvent, target: number | 'root') {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(target);
  }

  function handleDrop(e: DragEvent, target: number | null) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    let payload: DragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain')) as DragPayload;
    } catch {
      return;
    }
    if (payload.kind === 'file') actions.moveFile(payload.id, target);
    else if (payload.id !== target) actions.moveFolder(payload.id, target);
  }

  function commitRename() {
    if (!renaming) return;
    const name = renaming.value.trim();
    if (name) {
      if (renaming.kind === 'folder') actions.renameFolder(renaming.id, name);
      else actions.renameFile(renaming.id, name);
    }
    setRenaming(null);
  }

  const renameInput = (r: Renaming) => (
    <input
      value={r.value}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => setRenaming({ ...r, value: e.target.value })}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitRename();
        if (e.key === 'Escape') setRenaming(null);
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-full rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-sm text-zinc-100 outline-none"
    />
  );

  const renderLevel = (parentId: number | null, depth: number) => {
    const childFolders = folders.filter((f) => f.parentId === parentId);
    const childFiles = files.filter((f) => f.folderId === parentId);

    return (
      <>
        {childFolders.map((folder) => {
          const isRenaming = renaming?.kind === 'folder' && renaming.id === folder.id;
          return (
            <div key={`d${folder.id}`}>
              <div
                draggable={!isRenaming}
                onDragStart={(e) => startDrag(e, { kind: 'folder', id: folder.id })}
                onDragOver={(e) => allowDrop(e, folder.id)}
                onDragLeave={() => setDropTarget((t) => (t === folder.id ? null : t))}
                onDrop={(e) => handleDrop(e, folder.id)}
                onClick={() => toggleCollapse(folder.id)}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: '새 하위 폴더', action: () => actions.createFolder(folder.id) },
                    { label: '여기에 업로드', action: () => actions.uploadTo(folder.id) },
                    {
                      label: '이름 변경',
                      action: () => setRenaming({ kind: 'folder', id: folder.id, value: folder.name }),
                    },
                    { label: '삭제', danger: true, action: () => actions.deleteFolder(folder.id) },
                  ])
                }
                className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm transition ${
                  dropTarget === folder.id ? 'bg-sky-900/50 outline outline-1 outline-sky-600' : 'text-zinc-400 hover:bg-zinc-900'
                }`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                <span className="text-[10px]">{collapsed.has(folder.id) ? '▸' : '▾'}</span>
                <span>📁</span>
                {isRenaming ? renameInput(renaming) : <span className="truncate">{folder.name}</span>}
              </div>
              {!collapsed.has(folder.id) && renderLevel(folder.id, depth + 1)}
            </div>
          );
        })}
        {childFiles.map((file) => {
          const isRenaming = renaming?.kind === 'file' && renaming.id === file.id;
          return (
            <div
              key={file.id}
              draggable={!isRenaming}
              onDragStart={(e) => startDrag(e, { kind: 'file', id: file.id })}
              onClick={() => onSelect(file)}
              onContextMenu={(e) =>
                openMenu(e, [
                  {
                    label: '이름 변경',
                    action: () => setRenaming({ kind: 'file', id: file.id, value: file.name }),
                  },
                  { label: '복사', action: () => actions.copyFile(file.id) },
                  { label: '삭제', danger: true, action: () => actions.deleteFile(file.id) },
                ])
              }
              className={`flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition ${
                file.id === selectedId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'
              }`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              <span className={`font-mono text-[10px] uppercase ${TYPE_BADGE[file.fileType] ?? ''}`}>
                {file.fileType}
              </span>
              {isRenaming ? renameInput(renaming) : <span className="truncate">{file.name}</span>}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div
      className={`min-h-full space-y-0.5 rounded pb-8 ${dropTarget === 'root' ? 'bg-sky-950/30' : ''}`}
      onDragOver={(e) => allowDrop(e, 'root')}
      onDragLeave={() => setDropTarget((t) => (t === 'root' ? null : t))}
      onDrop={(e) => handleDrop(e, null)}
    >
      {folders.length === 0 && files.length === 0 ? (
        <p className="px-2 py-4 text-sm text-zinc-600">파일이 없습니다. 업로드해 보세요.</p>
      ) : (
        renderLevel(null, 0)
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
