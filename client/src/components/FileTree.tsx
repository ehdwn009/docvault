import { useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { Tag, TreeFile, TreeFolder } from '../lib/api';
import ContextMenu, { type MenuItem } from './ContextMenu';

const TYPE_BADGE: Record<string, string> = {
  md: 'text-sky-400',
  html: 'text-orange-400',
  text: 'text-slate-400',
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
  uploadFiles: (files: File[], folderId: number | null) => void;
  editTags: (file: TreeFile) => void;
  shareFile: (file: TreeFile) => void;
  shareFolder: (folder: TreeFolder) => void;
};

type Props = {
  folders: TreeFolder[];
  files: TreeFile[];
  tags: Tag[];
  isAdmin: boolean;
  selectedId: number | null;
  onSelect: (file: TreeFile) => void;
  actions: TreeActions;
  /** 다중 선택된 파일 id — 하나라도 있으면 선택 모드 (SCR-110 다중 선택) */
  checked: Set<number>;
  onCheckChange: (next: Set<number>) => void;
};

type Renaming = { kind: 'file' | 'folder'; id: number; value: string };
type Menu = { x: number; y: number; items: MenuItem[] };
type DragPayload = { kind: 'file' | 'folder'; id: number };

// SCR-110: 파일 트리 — 우클릭 컨텍스트 메뉴, 인라인 이름변경, 드래그앤드롭 이동
export default function FileTree({ folders, files, tags, isAdmin, selectedId, onSelect, actions, checked, onCheckChange }: Props) {
  const tagColor = new Map(tags.map((t) => [t.id, t.color]));
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [dropTarget, setDropTarget] = useState<number | 'root' | null>(null);
  const lastCheckClickRef = useRef<number | null>(null); // Shift 범위 선택의 기준점
  const selectionMode = checked.size > 0;

  /** 화면에 보이는 순서 그대로의 파일 id 목록 — Shift 범위 선택의 기준 (접힌 폴더 안은 제외) */
  const visibleFileIds = (): number[] => {
    const out: number[] = [];
    const walk = (parentId: number | null) => {
      for (const folder of folders.filter((f) => f.parentId === parentId)) {
        if (!collapsed.has(folder.id)) walk(folder.id);
      }
      for (const file of files.filter((f) => f.folderId === parentId)) out.push(file.id);
    };
    walk(null);
    return out;
  };

  const toggleCheck = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    lastCheckClickRef.current = id;
    onCheckChange(next);
  };

  const rangeCheck = (id: number) => {
    const anchor = lastCheckClickRef.current;
    if (anchor === null) return toggleCheck(id);
    const order = visibleFileIds();
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    if (a === -1 || b === -1) return toggleCheck(id);
    const next = new Set(checked);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(order[i]!);
    onCheckChange(next);
  };

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
    // OS에서 끌어온 파일이면 그 폴더로 업로드 (트리 내부 이동과 같은 드롭 존을 공유)
    if (e.dataTransfer.files.length > 0) {
      actions.uploadFiles([...e.dataTransfer.files], target);
      return;
    }
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

  // 우클릭과 ⋯ 버튼이 같은 메뉴를 공유한다 (모바일은 우클릭이 없어서 ⋯가 유일한 진입점)
  const folderMenu = (folder: TreeFolder): MenuItem[] => [
    { label: '새 하위 폴더', action: () => actions.createFolder(folder.id) },
    { label: '여기에 업로드', action: () => actions.uploadTo(folder.id) },
    {
      label: '이름 변경',
      action: () => setRenaming({ kind: 'folder', id: folder.id, value: folder.name }),
    },
    ...(isAdmin
      ? [{ label: folder.isShared ? '공유 해제' : '공유하기', action: () => actions.shareFolder(folder) }]
      : []),
    { label: '삭제', danger: true, action: () => actions.deleteFolder(folder.id) },
  ];

  const fileMenu = (file: TreeFile): MenuItem[] => [
    // 터치 기기의 선택 모드 진입점 (PC는 Ctrl+클릭)
    { label: checked.has(file.id) ? '선택 해제' : '선택', action: () => toggleCheck(file.id) },
    {
      label: '이름 변경',
      action: () => setRenaming({ kind: 'file', id: file.id, value: file.name }),
    },
    { label: '태그', action: () => actions.editTags(file) },
    { label: '복사', action: () => actions.copyFile(file.id) },
    ...(isAdmin
      ? [{ label: file.isShared ? '공유 해제' : '공유하기', action: () => actions.shareFile(file) }]
      : []),
    { label: '삭제', danger: true, action: () => actions.deleteFile(file.id) },
  ];

  const moreButton = (items: () => MenuItem[]) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        openMenu(e, items());
      }}
      title="메뉴"
      className="shrink-0 rounded px-1 text-slate-500 hover:text-slate-200 pc:hidden pc:group-hover:block"
    >
      ⋯
    </button>
  );

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
      className="w-full rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-sm text-slate-100 outline-none"
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
                onContextMenu={(e) => openMenu(e, folderMenu(folder))}
                className={`group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm transition ${
                  dropTarget === folder.id ? 'bg-sky-900/50 outline outline-1 outline-sky-600' : 'text-slate-400 hover:bg-slate-900'
                }`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                <span className="text-[10px]">{collapsed.has(folder.id) ? '▸' : '▾'}</span>
                <span>📁</span>
                {isRenaming ? renameInput(renaming) : <span className="truncate">{folder.name}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {folder.isShared === 1 && <span className="text-[10px] text-sky-500">공유</span>}
                  {moreButton(() => folderMenu(folder))}
                </span>
              </div>
              {!collapsed.has(folder.id) && renderLevel(folder.id, depth + 1)}
            </div>
          );
        })}
        {childFiles.map((file) => {
          const isRenaming = renaming?.kind === 'file' && renaming.id === file.id;
          const isChecked = checked.has(file.id);
          return (
            <div
              key={file.id}
              draggable={!isRenaming}
              onDragStart={(e) => startDrag(e, { kind: 'file', id: file.id })}
              onClick={(e) => {
                // Ctrl/⌘ 클릭 = 선택 토글, Shift = 범위, 선택 모드 중엔 클릭도 토글 — 아니면 평소처럼 열람
                if (e.ctrlKey || e.metaKey) toggleCheck(file.id);
                else if (e.shiftKey && selectionMode) rangeCheck(file.id);
                else if (selectionMode) toggleCheck(file.id);
                else onSelect(file);
              }}
              onContextMenu={(e) => openMenu(e, fileMenu(file))}
              className={`group flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition ${
                isChecked
                  ? 'bg-sky-950/60 text-slate-100 outline outline-1 outline-sky-800'
                  : file.id === selectedId
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-300 hover:bg-slate-900'
              }`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              {selectionMode && (
                <span className={`text-xs ${isChecked ? 'text-sky-400' : 'text-slate-600'}`}>
                  {isChecked ? '☑' : '☐'}
                </span>
              )}
              <span className={`font-mono text-[10px] uppercase ${TYPE_BADGE[file.fileType] ?? ''}`}>
                {file.fileType}
              </span>
              {isRenaming ? renameInput(renaming) : <span className="truncate">{file.name}</span>}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {file.tags.map((tagId) => (
                  <span
                    key={tagId}
                    className="h-2 w-2 rounded-full"
                    style={{ background: tagColor.get(tagId) ?? '#71717a' }}
                  />
                ))}
                {file.isShared === 1 && <span className="text-[10px] text-sky-500">공유</span>}
                {moreButton(() => fileMenu(file))}
              </span>
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
        <p className="px-2 py-4 text-sm text-slate-600">파일이 없습니다. 업로드해 보세요.</p>
      ) : (
        renderLevel(null, 0)
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
