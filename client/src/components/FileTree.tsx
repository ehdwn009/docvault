import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { Tag, TreeFile, TreeFolder } from '../lib/api';
import ContextMenu, { type MenuItem } from './ContextMenu';

const TYPE_BADGE: Record<string, string> = {
  md: 'text-sky-400',
  html: 'text-orange-400',
  text: 'text-slate-400',
  code: 'text-emerald-400',
  image: 'text-purple-400',
  pdf: 'text-red-400',
  audio: 'text-pink-400',
  video: 'text-rose-400',
  binary: 'text-slate-500',
};

// 뱃지가 이름 자리를 잡아먹지 않게 긴 타입명은 줄여 쓴다
const BADGE_LABEL: Record<string, string> = { binary: 'bin', audio: 'aud', video: 'vid' };

export type TreeActions = {
  createFolder: (parentId: number | null) => void;
  renameFolder: (id: number, name: string) => void;
  moveFolder: (id: number, parentId: number | null) => void;
  deleteFolder: (id: number) => void;
  renameFile: (id: number, name: string) => void;
  moveFile: (id: number, folderId: number | null) => void;
  deleteFile: (id: number) => void;
  copyFile: (id: number) => void;
  /** 분할 칸에 열기 — 보던 문서 옆(모바일은 아래) (IA — 탭 바 + 분할 보기) */
  openSplit: (file: TreeFile) => void;
  downloadFile: (file: TreeFile) => void;
  /** 폴더를 하위 구조 그대로 ZIP 하나로 (API-040) */
  downloadFolder: (folder: TreeFolder) => void;
  uploadTo: (folderId: number | null) => void;
  /** OS 드롭 처리 — 폴더 항목이 섞여 있으면 구조째 업로드. 드롭 이벤트 스택 안에서 호출할 것 */
  uploadDropped: (dt: DataTransfer, folderId: number | null) => void;
  moveFiles: (ids: number[], folderId: number | null) => void;
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
type DragPayload = { kind: 'file' | 'folder'; id: number } | { kind: 'files'; ids: number[] };

/** 드래그 중 커서를 따라다니는 라벨 — 브라우저 기본(반투명 행 복제) 대신 이름/개수를 보여준다 */
function setDragGhost(e: DragEvent, label: string) {
  const el = document.createElement('div');
  el.textContent = label;
  el.style.cssText =
    'position:fixed;top:-100px;left:-100px;padding:4px 10px;background:#1e293b;border:1px solid #475569;' +
    'border-radius:6px;color:#e2e8f0;font-size:12px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  document.body.appendChild(el);
  e.dataTransfer.setDragImage(el, 12, 12);
  window.setTimeout(() => el.remove(), 0);
}

// SCR-110: 파일 트리 — 우클릭 컨텍스트 메뉴, 인라인 이름변경, 드래그앤드롭 이동
export default function FileTree({ folders, files, tags, isAdmin, selectedId, onSelect, actions, checked, onCheckChange }: Props) {
  const tagColor = new Map(tags.map((t) => [t.id, t.color]));
  // "접힌 목록"이 아니라 "펼친 목록"으로 들고 있는다 — 빈 집합이 곧 전부 접힘(기본값)이다
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [dropTarget, setDropTarget] = useState<number | 'root' | null>(null);
  const lastCheckClickRef = useRef<number | null>(null); // Shift 범위 선택의 기준점
  const selectionMode = checked.size > 0;

  // 트리는 기본이 접힘이라, 밖에서 고른 파일(최근 열람·검색·커맨드 팔레트·딥링크)은
  // 조상 폴더를 열어 주지 않으면 트리에서 보이지 않는다
  useEffect(() => {
    if (selectedId == null) return;
    const file = files.find((f) => f.id === selectedId);
    if (!file) return;
    const byId = new Map(folders.map((f) => [f.id, f]));
    const chain: number[] = [];
    let parent = file.folderId;
    // 자기참조가 꼬여도 멈추도록 방문한 폴더는 다시 따라가지 않는다
    while (parent != null && !chain.includes(parent)) {
      chain.push(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    if (chain.length === 0) return;
    setExpanded((prev) => {
      if (chain.every((id) => prev.has(id))) return prev; // 이미 열려 있으면 그대로 (불필요한 리렌더 방지)
      const next = new Set(prev);
      for (const id of chain) next.add(id);
      return next;
    });
  }, [selectedId, files, folders]);

  /** 화면에 보이는 순서 그대로의 파일 id 목록 — Shift 범위 선택의 기준 (접힌 폴더 안은 제외) */
  const visibleFileIds = (): number[] => {
    const out: number[] = [];
    const walk = (parentId: number | null) => {
      for (const folder of folders.filter((f) => f.parentId === parentId)) {
        if (expanded.has(folder.id)) walk(folder.id);
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

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startDrag(e: DragEvent, payload: DragPayload, label: string) {
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    setDragGhost(e, label);
  }

  // 스프링 로딩: 접힌 폴더 위에 드래그를 잠시 머물면 자동으로 펼친다
  const springRef = useRef<{ id: number; timer: number } | null>(null);

  function cancelSpring() {
    if (springRef.current) {
      window.clearTimeout(springRef.current.timer);
      springRef.current = null;
    }
  }

  function scheduleSpring(target: number | 'root') {
    if (typeof target !== 'number' || expanded.has(target)) {
      cancelSpring();
      return;
    }
    if (springRef.current?.id === target) return;
    cancelSpring();
    const timer = window.setTimeout(() => {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(target);
        return next;
      });
      springRef.current = null;
    }, 700);
    springRef.current = { id: target, timer };
  }

  function allowDrop(e: DragEvent, target: number | 'root') {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(target);
    scheduleSpring(target);
  }

  function handleDrop(e: DragEvent, target: number | null) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    cancelSpring();
    // OS에서 끌어온 파일/폴더면 그 자리로 업로드 (트리 내부 이동과 같은 드롭 존을 공유)
    if (e.dataTransfer.types.includes('Files')) {
      actions.uploadDropped(e.dataTransfer, target);
      return;
    }
    let payload: DragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain')) as DragPayload;
    } catch {
      return;
    }
    if (payload.kind === 'files') actions.moveFiles(payload.ids, target);
    else if (payload.kind === 'file') actions.moveFile(payload.id, target);
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
    { label: '폴더째 다운로드', action: () => actions.downloadFolder(folder) },
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
    // PC는 Alt+클릭도 같은 동작 (Ctrl+클릭은 다중 선택이 선점)
    { label: '분할로 열기', action: () => actions.openSplit(file) },
    {
      label: '이름 변경',
      action: () => setRenaming({ kind: 'file', id: file.id, value: file.name }),
    },
    { label: '태그', action: () => actions.editTags(file) },
    { label: '다운로드', action: () => actions.downloadFile(file) },
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
                onDragStart={(e) => startDrag(e, { kind: 'folder', id: folder.id }, `📁 ${folder.name}`)}
                onDragOver={(e) => allowDrop(e, folder.id)}
                onDragLeave={() => setDropTarget((t) => (t === folder.id ? null : t))}
                onDrop={(e) => handleDrop(e, folder.id)}
                onClick={() => toggleExpand(folder.id)}
                onContextMenu={(e) => openMenu(e, folderMenu(folder))}
                className={`group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm transition ${
                  dropTarget === folder.id ? 'bg-sky-900/50 outline outline-1 outline-sky-600' : 'text-slate-400 hover:bg-slate-900'
                }`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
              >
                <span className="text-[10px]">{expanded.has(folder.id) ? '▾' : '▸'}</span>
                <span>📁</span>
                {isRenaming ? renameInput(renaming) : <span className="truncate">{folder.name}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {folder.isShared === 1 && <span className="text-[10px] text-sky-500">공유</span>}
                  {moreButton(() => folderMenu(folder))}
                </span>
              </div>
              {expanded.has(folder.id) && renderLevel(folder.id, depth + 1)}
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
              onDragStart={(e) => {
                // 선택된 파일을 끌면 선택 전체가 같이 움직인다
                if (isChecked && checked.size > 1) {
                  startDrag(e, { kind: 'files', ids: [...checked] }, `📄 ${checked.size}개 파일`);
                } else {
                  startDrag(e, { kind: 'file', id: file.id }, `📄 ${file.name}`);
                }
              }}
              onClick={(e) => {
                // Ctrl/⌘ 클릭 = 선택 토글, Alt = 분할로 열기, Shift = 범위, 선택 모드 중엔 클릭도 토글
                if (e.ctrlKey || e.metaKey) toggleCheck(file.id);
                else if (e.altKey) actions.openSplit(file);
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
                {BADGE_LABEL[file.fileType] ?? file.fileType}
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
