import { useEffect, useMemo, useRef, useState } from 'react';
import ContextMenu, { type MenuItem } from '../../components/ContextMenu';
import FileGrid from '../../components/FileGrid';
import FileName from '../../components/FileName';
import { formatMB, pendingPercent, type PendingUpload } from '../../lib/uploads';
import type { TreeActions } from '../../components/FileTree';
import FolderPicker from '../../components/FolderPicker';
import { HomeButton, MeButton } from '../../lib/topNav';
import Icon, { FILE_TYPE_ICON, FILE_TYPE_LABEL } from '../../components/Icon';
import SwipeRow, { type SwipeConfig } from '../../components/SwipeRow';
import Group from '../../components/ui/Group';
import GroupRow from '../../components/ui/GroupRow';
import { api, type SharedFile, type SharedFolder, type Tag, type TreeFile, type TreeFolder } from '../../lib/api';
import { formatDate } from '../../lib/date';
import { promptDialog } from '../../lib/dialog';
import { pushLayer } from '../../lib/layers';

export type SortBy = 'name' | 'updated';
export type ViewMode = 'list' | 'grid';

/** 지금 보고 있는 화면 — 뿌리(문서) → 폴더 → 하위 폴더…, 또는 즐겨찾기·공유받음. 한 칸 들어갈 때마다 기록에 층을 쌓는다 */
type View = { kind: 'root' } | { kind: 'folder'; id: number } | { kind: 'favorites' } | { kind: 'shared'; folderId: number | null };

type Menu = { x: number; y: number; items: MenuItem[]; title?: string };

type Props = {
  /** 이름순 정렬된 폴더 전체 */
  folders: TreeFolder[];
  /** 정렬·태그 거르기를 거친 파일 */
  files: TreeFile[];
  /** 올리는 중인 파일 줄(시안 B) — 그 폴더 목록 맨 위에 진행 막대와 함께 (알림 4단계) */
  pending: PendingUpload[];
  /** 거르기 전 파일 전체 — 즐겨찾기 수·폴더 안 개수 */
  allFiles: TreeFile[];
  tags: Tag[];
  isAdmin: boolean;
  selectedId: number | null;
  onSelect: (file: TreeFile) => void;
  onSelectShared: (file: SharedFile) => void;
  actions: TreeActions;
  onToggleFavorite: (file: TreeFile) => void;
  /** 다중 선택(SCR-110) — 하나라도 있으면 선택 모드 */
  checked: Set<number>;
  onCheckChange: (next: Set<number>) => void;
  onBulkDownload: () => void;
  onBulkMove: () => void;
  onBulkDelete: () => void;
  swipe: (file: TreeFile) => SwipeConfig;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  tagFilter: number | null;
  onTagFilterChange: (id: number | null) => void;
  /** [+]·업로드의 대상 폴더 = 지금 보는 폴더. 밖에서 바뀌면(속성창의 위치 누르기) 그 폴더로 들어간다 */
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  onOpenTrash: () => void;
  onSearch: () => void;
  /** 홈의 「함께 보는 파일」처럼 밖에서 바로 공유받음·즐겨찾기로 — n이 바뀔 때마다 */
  jump?: { to: 'shared' | 'favorites'; n: number } | null;
  /** 값이 바뀌면 뿌리(내 파일 맨 위)로 — 탭 재탭 */
  rootSignal?: number;
  /** 넓은 터치 화면의 사이드바 — 폴더를 다음 화면으로 들어가지 않고 그 자리에서 펴고 접는다 (사용자 결정 2026-11-20). 격자 보기에서는 쓰지 않는다 */
  tree?: boolean;
  /** 사이드바 접기 단추 — 있으면 머리에 그린다 (넓은 터치 화면) */
  onCollapse?: () => void;
};

/** 펼쳐 둔 폴더 기억(기기별) — 사이드바를 접었다 펴거나 앱을 다시 켜도 그대로 */
const TREE_OPEN_KEY = 'dv_tree_open';
/** 트리 한 단계의 들여쓰기(px) */
const TREE_INDENT = 18;
function readOpenFolders(): Set<number> {
  try {
    const v = JSON.parse(localStorage.getItem(TREE_OPEN_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
  } catch {
    return new Set();
  }
}

const ICON_SIZE = 21;

// SCR-110 (폰 A안, 2026-10-31): 문서 탭 — 큰 제목 + [+]·[⋯], 검색 칸, 묶음 카드(즐겨찾기·공유받음 / 폴더·문서 / 휴지통).
// 폴더는 펼치지 않고 다음 화면으로 들어간다(아이폰 파일 앱처럼, ‹·뒤로 가기로 나온다). 행에는 단추가 없다 —
// 누르기=열기, 길게 누르기=메뉴, 옆으로 밀기=빠른 동작. 정렬·보기·태그·선택은 머리의 ⋯ 안에 (사용자 결정 2026-10-31)
export default function FilesBrowser({ folders, files, pending, allFiles, tags, isAdmin, selectedId, onSelect, onSelectShared, actions, onToggleFavorite, checked, onCheckChange, onBulkDownload, onBulkMove, onBulkDelete, swipe, sortBy, onSortChange, viewMode, onViewModeChange, tagFilter, onTagFilterChange, selectedFolderId, onSelectFolder, onOpenTrash, onSearch, jump = null, rootSignal = 0, tree = false, onCollapse }: Props) {
  const [stack, setStack] = useState<View[]>([{ kind: 'root' }]);
  const cur = stack[stack.length - 1]!;
  const [menu, setMenu] = useState<Menu | null>(null);
  const [movePick, setMovePick] = useState<TreeFile | null>(null);
  const [shared, setShared] = useState<{ folders: SharedFolder[]; files: SharedFile[] } | null>(null);
  /** 트리로 그리는 중 — 격자 보기는 한 폴더씩 보는 화면이라 트리로 그리지 않는다 */
  const asTree = tree && viewMode === 'list';
  const [openFolders, setOpenFolders] = useState<Set<number>>(readOpenFolders);
  const setOpen = (next: Set<number>) => {
    setOpenFolders(next);
    try {
      localStorage.setItem(TREE_OPEN_KEY, JSON.stringify([...next]));
    } catch {
      /* 저장이 막혀도 이번에는 펼친다 */
    }
  };
  const toggleFolder = (id: number) => {
    const next = new Set(openFolders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
    // [+]의 대상 = 마지막으로 펼친 폴더. 접으면 한 칸 위(맨 위 폴더를 접었으면 폴더 밖)로 돌아간다
    onSelectFolder(next.has(id) ? id : (folders.find((f) => f.id === id)?.parentId ?? null));
  };

  // ── 화면 쌓기 — 한 칸 들어갈 때마다 기록에 층 하나. ‹는 그 층을 스스로 닫고, 뒤로 가기는 층 쪽에서 닫는다 ──
  const layers = useRef<(() => void)[]>([]);
  const push = (v: View) => {
    setStack((s) => [...s, v]);
    layers.current.push(
      pushLayer(() => {
        layers.current.pop();
        setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
      }),
    );
  };
  const back = () => {
    const d = layers.current.pop();
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    d?.();
  };
  const toRoot = () => {
    while (layers.current.length) back();
  };
  // 화면을 떠나면(홈·AI·나로) 쌓인 층을 기록에서도 걷는다 — 남겨 두면 뒤로 가기가 엉뚱한 층을 닫는다
  useEffect(() => () => toRoot(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 지금 보는 폴더 = [+]·업로드의 대상 폴더
  const curFolderId = cur.kind === 'folder' ? cur.id : null;
  useEffect(() => {
    if (cur.kind === 'root' || cur.kind === 'folder') onSelectFolder(curFolderId);
  }, [cur.kind, curFolderId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 밖에서 폴더를 골랐다(속성창 › 위치) — 그 폴더로 들어간다. 트리에서는 들어가는 대신 그 폴더까지 펼친다
  useEffect(() => {
    if (selectedFolderId === null || selectedFolderId === curFolderId) return;
    if (!folders.some((f) => f.id === selectedFolderId)) return;
    if (asTree) {
      const next = new Set(openFolders);
      const before = next.size;
      for (let f = folders.find((x) => x.id === selectedFolderId); f && f.parentId !== null; f = folders.find((x) => x.id === f!.parentId)) next.add(f.parentId);
      if (next.size !== before) setOpen(next);
      return;
    }
    toRoot();
    push({ kind: 'folder', id: selectedFolderId });
  }, [selectedFolderId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (rootSignal > 0) toRoot();
  }, [rootSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!jump) return;
    toRoot();
    push(jump.to === 'shared' ? { kind: 'shared', folderId: null } : { kind: 'favorites' });
  }, [jump?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // 공유받음은 들어갈 때 한 번 받는다 (SCR-130)
  useEffect(() => {
    if (cur.kind !== 'shared' || shared !== null) return;
    void api<{ folders: SharedFolder[]; files: SharedFile[] }>('/shared/tree').then(setShared).catch(() => setShared({ folders: [], files: [] }));
  }, [cur.kind, shared]);

  const tagColor = useMemo(() => new Map(tags.map((t) => [t.id, t.color])), [tags]);
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const favorites = useMemo(() => allFiles.filter((f) => f.state.isFavorite === 1), [allFiles]);
  const selectionMode = checked.size > 0;
  const sortLabel = sortBy === 'name' ? '이름순' : '최근 수정순';

  /** 폴더 안의 폴더·파일 수 — 행 오른쪽 숫자 */
  const countIn = (id: number) => folders.filter((f) => f.parentId === id).length + allFiles.filter((f) => f.folderId === id).length;

  function toggleCheck(id: number) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onCheckChange(next);
  }

  // ── 메뉴들 ──
  const fileMenu = (file: TreeFile): MenuItem[] => [
    { label: checked.has(file.id) ? '선택 해제' : '선택', icon: 'select', action: () => toggleCheck(file.id) },
    { label: file.state.isFavorite === 1 ? '즐겨찾기 해제' : '즐겨찾기', icon: 'star', action: () => onToggleFavorite(file) },
    {
      label: '이름 바꾸기',
      icon: 'pencil',
      action: () => void promptDialog('이름 바꾸기', file.name).then((name) => name?.trim() && actions.renameFile(file.id, name.trim())),
    },
    { label: '이동', icon: 'move', action: () => setMovePick(file) },
    { label: '태그', icon: 'tag', action: () => actions.editTags(file) },
    ...(isAdmin ? [{ label: file.isShared ? '공유 해제' : '공유', icon: 'share' as const, action: () => actions.shareFile(file) }] : []),
    { label: '다운로드', icon: 'download', action: () => actions.downloadFile(file) },
    { label: '복사', icon: 'copy', action: () => actions.copyFile(file.id) },
    { label: '속성', icon: 'info', action: () => actions.showFileInfo(file) },
    { label: '휴지통으로', icon: 'trash', danger: true, action: () => actions.deleteFile(file.id) },
  ];
  const folderMenu = (folder: TreeFolder): MenuItem[] => [
    { label: '새 문서', icon: 'docPlus', action: () => actions.createDoc(folder.id) },
    { label: '새 하위 폴더', icon: 'folderPlus', action: () => actions.createFolder(folder.id) },
    { label: '여기에 올리기', icon: 'upload', action: () => actions.uploadTo(folder.id) },
    {
      label: '이름 바꾸기',
      icon: 'pencil',
      action: () => void promptDialog('폴더 이름 바꾸기', folder.name).then((name) => name?.trim() && actions.renameFolder(folder.id, name.trim())),
    },
    ...(isAdmin ? [{ label: folder.isShared ? '공유 해제' : '공유', icon: 'share' as const, action: () => actions.shareFolder(folder) }] : []),
    { label: '폴더째 다운로드', icon: 'download', action: () => actions.downloadFolder(folder) },
    { label: '속성', icon: 'info', action: () => actions.showFolderInfo(folder) },
    { label: '삭제', icon: 'trash', danger: true, action: () => actions.deleteFolder(folder.id) },
  ];
  /** 폴더 행 스와이프 — 파일과 같은 손동작, 트레이만 폴더에 맞게 (삭제는 확인 창을 거친다) */
  const folderSwipe = (folder: TreeFolder): SwipeConfig => ({
    right: [
      { label: '속성', icon: 'info', onAction: () => actions.showFolderInfo(folder) },
      { label: '삭제', icon: 'trash', danger: true, onAction: () => actions.deleteFolder(folder.id) },
    ],
    left: [
      { label: '올리기', icon: 'upload', tone: 'accent', onAction: () => actions.uploadTo(folder.id) },
      { label: '새 폴더', icon: 'folderPlus', onAction: () => actions.createFolder(folder.id) },
    ],
  });
  // 트리에서는 "지금 보는 폴더"가 없다 — 마지막으로 누른 폴더가 대상이고, 어디에 생기는지 메뉴 제목으로 알려 준다
  const plusTarget = asTree && cur.kind === 'root' ? (folderById.get(selectedFolderId ?? -1)?.id ?? null) : curFolderId;
  const plusMenu = (target: number | null = plusTarget): MenuItem[] => [
    { label: '새 문서', icon: 'docPlus', action: () => actions.createDoc(target) },
    { label: '파일 올리기', icon: 'upload', action: () => actions.uploadTo(target) },
    { label: '새 폴더', icon: 'folderPlus', action: () => actions.createFolder(target) },
    // 트리에서 폴더가 대상일 때 — 폴더를 접지 않고도 폴더 밖(맨 위)에 만들 수 있게
    ...(asTree && target !== null
      ? [
          {
            label: '폴더 밖(맨 위)에 만들기',
            action: () => {
              onSelectFolder(null);
              // 지금 메뉴가 닫힌 뒤에 맨 위용 메뉴를 다시 연다
              window.setTimeout(() => openSheet(plusMenu(null), '맨 위에'), 0);
            },
          },
        ]
      : []),
  ];
  const moreMenu = (): MenuItem[] => [
    ...(files.length > 0 ? [{ label: selectionMode ? '선택 끝내기' : '선택', icon: 'select' as const, action: () => onCheckChange(selectionMode ? new Set() : new Set([files[0]!.id])) }] : []),
    { section: '정렬', label: '이름순', checked: sortBy === 'name', action: () => onSortChange('name') },
    { label: '최근 수정순', checked: sortBy === 'updated', action: () => onSortChange('updated') },
    { section: '보기', label: '목록', checked: viewMode === 'list', action: () => onViewModeChange('list') },
    { label: '격자', checked: viewMode === 'grid', action: () => onViewModeChange('grid') },
    ...(tags.length > 0
      ? [
          { section: '태그', label: '전체', checked: tagFilter === null, action: () => onTagFilterChange(null) },
          ...tags.map((t) => ({ label: t.name, checked: tagFilter === t.id, action: () => onTagFilterChange(t.id) })),
        ]
      : []),
  ];
  const openSheet = (items: MenuItem[], title?: string) => setMenu({ x: 0, y: 0, items, title });

  // ── 행들 ──
  const fileRow = (file: TreeFile, depth = 0) => {
    const isChecked = checked.has(file.id);
    const dots = file.tags.map((id) => <span key={id} className="h-2 w-2 rounded-full" style={{ background: tagColor.get(id) ?? '#71717a' }} />);
    return (
      <SwipeRow key={file.id} {...(selectionMode ? {} : swipe(file))} surface="panel">
        <GroupRow
          icon={selectionMode ? <Icon name={isChecked ? 'select' : 'circle'} size={ICON_SIZE} className={isChecked ? 'text-accent-400' : 'text-slate-600'} /> : <Icon name={FILE_TYPE_ICON[file.fileType] ?? 'doc'} size={ICON_SIZE} />}
          title={<FileName name={file.name} wrap expanded={file.id === selectedId} />}
          subtitle={`${formatDate(file.updatedAt)} · ${FILE_TYPE_LABEL[file.fileType] ?? file.fileType}`}
          right={dots.length > 0 ? <span className="flex items-center gap-1">{dots}</span> : undefined}
          selected={isChecked || file.id === selectedId}
          wrap
          indent={depth * TREE_INDENT}
          onClick={() => (selectionMode ? toggleCheck(file.id) : onSelect(file))}
          onLongPress={() => openSheet(fileMenu(file), file.name)}
        />
      </SwipeRow>
    );
  };
  // 올리는 중인 줄 — 진짜 줄과 같은 모양이되 흐리고, 아래에 막대. 실패는 빨간 이유 한 줄
  const pendingRow = (p: PendingUpload, depth = 0) => (
    <GroupRow
      key={`u${p.key}`}
      icon={<Icon name={p.status === 'error' ? 'info' : 'upload'} size={ICON_SIZE} />}
      iconClass={p.status === 'error' ? 'text-danger-400' : 'text-accent-400'}
      title={<span className={p.status === 'error' ? 'text-slate-200' : 'text-slate-400'}>{p.name}</span>}
      subtitle={
        p.status === 'error' ? (
          <span className="text-danger-400">{p.message ?? '올리지 못했어요'}</span>
        ) : (
          <span className="block">
            <span className="mt-1 block h-1 w-full overflow-hidden rounded bg-slate-800">
              <span className="block h-full rounded bg-accent-500 transition-[width] duration-300" style={{ width: `${pendingPercent(p)}%` }} />
            </span>
            <span className="text-slate-500">{p.status === 'waiting' ? '대기 중' : `${formatMB(p.loaded)} / ${formatMB(p.size)}`}</span>
          </span>
        )
      }
      right={<span className={`text-[11px] ${p.status === 'error' ? 'text-danger-400' : 'text-slate-500'}`}>{p.status === 'error' ? '실패' : p.status === 'waiting' ? '대기' : `${pendingPercent(p)}%`}</span>}
      wrap
      as="div"
      indent={depth * TREE_INDENT}
    />
  );
  const folderRow = (folder: TreeFolder, depth = 0) => {
    const isOpen = asTree && openFolders.has(folder.id);
    return (
      <SwipeRow key={`d${folder.id}`} {...(selectionMode ? {} : folderSwipe(folder))} surface="panel">
        <GroupRow
          icon={<Icon name="folder" size={ICON_SIZE} />}
          iconClass="text-accent-400"
          title={folder.name}
          // 트리: ›가 펼치면 아래를 본다. 드릴다운: ›는 "다음 화면으로"
          right={
            asTree ? (
              <span className="flex items-center gap-2">
                {countIn(folder.id) || ''}
                <Icon name="chevron" size={16} className={`-mr-1 text-slate-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              </span>
            ) : (
              <span>{countIn(folder.id) || ''}</span>
            )
          }
          chevron={!asTree}
          selected={asTree && folder.id === selectedFolderId}
          indent={depth * TREE_INDENT}
          onClick={() => (asTree ? toggleFolder(folder.id) : push({ kind: 'folder', id: folder.id }))}
          onLongPress={() => openSheet(folderMenu(folder), folder.name)}
        />
      </SwipeRow>
    );
  };
  /** 트리 한 단계 — 폴더(펼쳐져 있으면 그 안까지), 올리는 중인 줄, 파일 순 */
  const treeLevel = (parentId: number | null, depth: number): React.ReactNode[] => [
    ...folders
      .filter((f) => f.parentId === parentId)
      .flatMap((f) => {
        if (!openFolders.has(f.id)) return [folderRow(f, depth)];
        const inner = treeLevel(f.id, depth + 1);
        return [
          folderRow(f, depth),
          ...(inner.length > 0
            ? inner
            : [
                <p key={`e${f.id}`} className="dv-row py-2.5 text-xs text-slate-600" style={{ paddingLeft: 16 + (depth + 1) * TREE_INDENT }}>
                  비어 있어요
                </p>,
              ]),
        ];
      }),
    ...pending.filter((p) => p.folderId === parentId).map((p) => pendingRow(p, depth)),
    ...files.filter((f) => f.folderId === parentId).map((f) => fileRow(f, depth)),
  ];
  const sharedFolderRow = (folder: SharedFolder) => (
    <GroupRow key={`s${folder.id}`} icon={<Icon name="folder" size={ICON_SIZE} />} iconClass="text-accent-400" title={folder.name} subtitle={folder.ownerName} chevron onClick={() => push({ kind: 'shared', folderId: folder.id })} />
  );
  const sharedFileRow = (file: SharedFile) => (
    <GroupRow
      key={`sf${file.id}`}
      icon={<Icon name={FILE_TYPE_ICON[file.fileType] ?? 'doc'} size={ICON_SIZE} />}
      title={<FileName name={file.name} wrap expanded={file.id === selectedId} />}
      subtitle={`${file.ownerName} · ${formatDate(file.updatedAt)}`}
      selected={file.id === selectedId}
      wrap
      onClick={() => onSelectShared(file)}
    />
  );

  const empty = (text: string) => <p className="px-4 py-6 text-center text-sm text-slate-500">{text}</p>;

  // ── 본문 ──
  let body: React.ReactNode;
  let title = '문서';
  let backLabel: string | null = null;
  if (cur.kind === 'root' || cur.kind === 'folder') {
    const parentId = cur.kind === 'folder' ? cur.id : null;
    const subFolders = folders.filter((f) => f.parentId === parentId);
    const subFiles = files.filter((f) => f.folderId === parentId);
    // 카드 이름: 뿌리는 「내 파일 · 이름순」, 폴더 안은 「n개 · 이름순」(+ 고른 태그)
    const groupTitle = `${cur.kind === 'root' ? '내 파일' : `${subFolders.length + subFiles.length}개`} · ${sortLabel}${tagFilter !== null ? ` · ${tags.find((t) => t.id === tagFilter)?.name ?? ''}` : ''}`;
    if (cur.kind === 'folder') {
      title = folderById.get(cur.id)?.name ?? '폴더';
      const prev = stack[stack.length - 2];
      backLabel = prev && prev.kind === 'folder' ? (folderById.get(prev.id)?.name ?? '폴더') : '문서';
    }
    body = (
      <>
        {cur.kind === 'root' && (
          <Group>
            <GroupRow icon={<Icon name="star" size={ICON_SIZE} />} tint="warn" title="즐겨찾기" right={favorites.length > 0 ? <span>{favorites.length}</span> : undefined} chevron onClick={() => push({ kind: 'favorites' })} />
            <GroupRow icon={<Icon name="users" size={ICON_SIZE} />} tint="accent" title="공유받음" chevron onClick={() => push({ kind: 'shared', folderId: null })} />
          </Group>
        )}
        {viewMode === 'grid' ? (
          <Group title={groupTitle}>
            <div className="px-2 pt-2">
              {subFolders.map((f) => folderRow(f))}
              <FileGrid files={subFiles} folders={folders} selectedId={selectedId} onSelect={onSelect} />
            </div>
          </Group>
        ) : (
          <Group title={groupTitle}>
            {asTree ? (
              treeLevel(parentId, 0)
            ) : (
              <>
                {subFolders.map((f) => folderRow(f))}
                {pending.filter((p) => p.folderId === parentId).map((p) => pendingRow(p))}
                {subFiles.map((f) => fileRow(f))}
              </>
            )}
            {subFolders.length === 0 && subFiles.length === 0 && empty(tagFilter !== null ? '이 태그의 문서가 없어요' : '아직 문서가 없어요. [+]로 새 문서를 만들거나 올려 보세요')}
          </Group>
        )}
        {cur.kind === 'root' && (
          <Group>
            <GroupRow icon={<Icon name="trash" size={ICON_SIZE} />} tint="muted" title="휴지통" chevron onClick={onOpenTrash} />
          </Group>
        )}
      </>
    );
  } else if (cur.kind === 'favorites') {
    title = '즐겨찾기';
    backLabel = '문서';
    body = <Group>{favorites.length === 0 ? empty('즐겨찾기가 없어요. 문서를 길게 누르거나 뷰어 위의 ★로 더해 보세요') : favorites.map((f) => fileRow(f))}</Group>;
  } else {
    const parentId = cur.folderId;
    const prev = stack[stack.length - 2];
    title = parentId === null ? '공유받음' : (shared?.folders.find((f) => f.id === parentId)?.name ?? '폴더');
    backLabel = prev && prev.kind === 'shared' && prev.folderId !== null ? (shared?.folders.find((f) => f.id === prev.folderId)?.name ?? '폴더') : prev && prev.kind === 'shared' ? '공유받음' : '문서';
    const sf = shared?.folders.filter((f) => f.parentId === parentId) ?? [];
    const sfiles = shared?.files.filter((f) => f.folderId === parentId) ?? [];
    body = (
      <Group>
        {shared === null ? empty('불러오는 중…') : sf.length === 0 && sfiles.length === 0 ? empty('공유된 파일이 없어요') : null}
        {sf.map(sharedFolderRow)}
        {sfiles.map(sharedFileRow)}
      </Group>
    );
  }

  const circle = 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fill text-accent-400 active:opacity-70';
  const mine = cur.kind === 'root' || cur.kind === 'folder';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 머리 — ‹ 온 곳 / 큰 제목 / [+]·[⋯] (내 파일에서만) */}
      {backLabel !== null && (
        <button onClick={back} className="-mb-1 flex min-h-10 items-center gap-0.5 self-start pl-2 pr-3 text-[15px] text-accent-400" aria-label={`${backLabel}(으)로 돌아가기`}>
          <Icon name="chevronLeft" size={22} />
          <span className="max-w-[12rem] truncate">{backLabel}</span>
        </button>
      )}
      <div className="flex items-end gap-2 px-4 pb-2 pt-1">
        {cur.kind === 'root' && <HomeButton />}
        <h1 className="min-w-0 flex-1 truncate text-[30px] font-bold leading-tight tracking-tight">{title}</h1>
        {mine && (
          <div className="flex gap-2 pb-1">
            <button onClick={() => openSheet(plusMenu(), plusTarget !== null && asTree ? `「${folderById.get(plusTarget)?.name ?? ''}」 안에` : undefined)} className={circle} aria-label="새로 만들기">
              <Icon name="plus" size={20} />
            </button>
            <button onClick={() => openSheet(moreMenu())} className={circle} aria-label="정렬·보기·선택">
              <Icon name="more" size={20} />
            </button>
          </div>
        )}
        {cur.kind === 'root' && <MeButton />}
        {onCollapse && (
          <button onClick={onCollapse} className={`${circle} mb-1`} aria-label="목록 접기">
            <Icon name="sidebar" size={19} />
          </button>
        )}
      </div>
      {cur.kind === 'root' && (
        <button onClick={onSearch} className="mx-4 mb-1 flex min-h-10 items-center gap-2 rounded-[10px] bg-fill px-3 text-[15px] text-slate-500" aria-label="검색">
          <Icon name="search" size={17} />
          검색
        </button>
      )}
      {/* 선택 모드 — 고른 개수와 한꺼번에 할 일 */}
      {selectionMode && (
        <div className="mx-4 mt-2 flex items-center gap-1 rounded-xl bg-accent-950/60 px-3 py-1.5 text-sm">
          <span className="font-medium text-accent-300">{checked.size}개 선택</span>
          <span className="ml-auto flex gap-1">
            <button onClick={onBulkDownload} className="min-h-10 px-2 text-slate-200">다운로드</button>
            <button onClick={onBulkMove} className="min-h-10 px-2 text-slate-200">이동</button>
            <button onClick={onBulkDelete} className="min-h-10 px-2 text-danger-400">삭제</button>
            <button onClick={() => onCheckChange(new Set())} className="grid h-10 w-10 place-items-center text-slate-500" aria-label="선택 해제">
              <Icon name="close" size={16} />
            </button>
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6 pt-3">{body}</div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {movePick && (
        <FolderPicker
          folders={folders}
          title={`「${movePick.name}」을 옮길 폴더`}
          onPick={(folderId) => {
            actions.moveFile(movePick.id, folderId);
            setMovePick(null);
          }}
          onClose={() => setMovePick(null)}
        />
      )}
    </div>
  );
}
