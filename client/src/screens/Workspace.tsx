import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CommandPalette from '../components/CommandPalette';
import FileTree, { type TreeActions } from '../components/FileTree';
import RecentList from '../components/RecentList';
import TagEditor from '../components/TagEditor';
import {
  api,
  ApiError,
  uploadFiles,
  type SharedFile,
  type Tag,
  type Tree,
  type TreeFile,
  type User,
  type UserSettings,
} from '../lib/api';
import { confirmDialog, promptDialog } from '../lib/dialog';
import { toast } from '../lib/toast';
import AdminPanel from './panels/AdminPanel';
import FavoritesPanel from './panels/FavoritesPanel';
import SettingsPanel from './panels/SettingsPanel';
import SharedPanel from './panels/SharedPanel';
import Viewer from './Viewer';

type Panel = 'files' | 'favorites' | 'shared' | 'settings' | 'admin';
type SortBy = 'name' | 'updated';

const DEFAULT_SETTINGS: UserSettings = {
  viewerTheme: 'light',
  fontSize: 16,
  fontFamily: null,
  lineHeight: null,
  contentWidth: 'normal',
};

const PANEL_TITLE: Record<Panel, string> = {
  files: '내 파일',
  favorites: '즐겨찾기',
  shared: '공유 파일',
  settings: '설정',
  admin: '관리자',
};

/** 공유 트리 항목을 뷰어가 받는 TreeFile 형태로 맞춘다 (내 트리에 없는 파일) */
function sharedToTreeFile(f: SharedFile): TreeFile {
  return {
    id: f.id,
    folderId: f.folderId,
    name: f.name,
    fileType: f.fileType,
    sizeBytes: 0,
    isShared: 1,
    sortOrder: 0,
    updatedAt: f.updatedAt,
    tags: [],
    state: { isFavorite: 0, lastOpenedAt: null, readingPosition: null },
  };
}

/** 딥링크 경로(/f/{id})에서 파일 ID 추출 (IA — URL 라우팅) */
function fileIdFromPath(pathname: string): number | null {
  const m = pathname.match(/^\/f\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

// SCR-100: 워크스페이스 — 아이콘 레일 + 패널 + 본문(뷰어/편집기)
export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tree, setTree] = useState<Tree>({ folders: [], files: [] });
  const [selected, setSelected] = useState<TreeFile | null>(null);
  const [panel, setPanel] = useState<Panel>('files');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [tagEditorFile, setTagEditorFile] = useState<TreeFile | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [immersive, setImmersive] = useState(false); // 몰입 모드: 레일·패널·헤더 숨기고 본문만
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef<number | null>(null);
  const treeRef = useRef<Tree>(tree);
  const dirtyRef = useRef(false); // 편집기의 미저장 변경 여부 — 파일 전환 가드용

  const loadTree = useCallback(async (): Promise<Tree | null> => {
    const t = await api<Tree>('/tree').catch(() => null);
    if (t) {
      setTree(t);
      treeRef.current = t;
      // 이름변경·이동이 반영되도록 선택 파일을 새 트리와 동기화.
      // 트리에 없으면(공유 파일 열람 중) 선택을 유지한다 — 삭제는 deleteFile에서 직접 해제
      setSelected((prev) => (prev ? (t.files.find((f) => f.id === prev.id) ?? prev) : null));
    }
    return t;
  }, []);

  const loadTags = useCallback(async () => {
    const r = await api<{ tags: Tag[] }>('/tags').catch(() => null);
    if (r) setTags(r.tags);
  }, []);

  /** 트리 밖 파일(공유·타 사용자)도 메타 조회로 열 수 있게 한다 */
  const resolveFile = useCallback(async (id: number): Promise<TreeFile | null> => {
    const inTree = treeRef.current.files.find((f) => f.id === id);
    if (inTree) return inTree;
    const meta = await api<Omit<TreeFile, 'tags' | 'state'>>(`/files/${id}`).catch(() => null);
    return meta
      ? { ...meta, tags: [], state: { isFavorite: 0, lastOpenedAt: null, readingPosition: null } }
      : null;
  }, []);

  // 초기 로드 + 딥링크(/f/{id}) 복원
  useEffect(() => {
    void (async () => {
      await Promise.all([loadTree(), loadTags()]);
      const id = fileIdFromPath(location.pathname);
      if (id !== null) {
        const f = await resolveFile(id);
        if (f) setSelected(f);
      }
    })();
    void api<{ settings: UserSettings }>('/me/settings')
      .then(({ settings }) => setSettings(settings))
      .catch(() => {});
  }, [loadTree, loadTags, resolveFile]);

  // 뒤로가기/앞으로가기
  useEffect(() => {
    const handler = () => {
      const id = fileIdFromPath(location.pathname);
      if (id === null) setSelected(null);
      else void resolveFile(id).then((f) => f && setSelected(f));
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [resolveFile]);

  /** 파일 선택 — 미저장 편집 확인 → URL 갱신 → 모바일 드로어 닫기 */
  const selectFile = useCallback(async (file: TreeFile) => {
    if (dirtyRef.current) {
      const ok = await confirmDialog('저장하지 않은 변경이 있습니다', {
        message: '이동하면 작성한 내용이 사라집니다.',
        danger: true,
      });
      if (!ok) return;
      dirtyRef.current = false;
    }
    setSelected(file);
    setDrawerOpen(false);
    if (location.pathname !== `/f/${file.id}`) {
      history.pushState(null, '', `/f/${file.id}`);
    }
  }, []);

  /** 트리 조작 공통 래퍼: 에러는 토스트로, 성공하면 트리 재조회 */
  const guard = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await loadTree();
      } catch (e) {
        toast(e instanceof ApiError ? e.message : '작업에 실패했습니다', 'error');
      }
    },
    [loadTree],
  );

  const doUpload = useCallback(
    async (fileList: FileList | File[], folderId: number | null) => {
      const list = [...fileList];
      if (list.length === 0) return;
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      if (folderId !== null) fd.append('folderId', String(folderId));
      setUploadProgress(0);
      try {
        const { files } = await uploadFiles(fd, setUploadProgress);
        await loadTree();
        toast(`${files.length}개 파일을 업로드했습니다`, 'success');
        if (files[0]) void selectFile(files[0]);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : '업로드에 실패했습니다', 'error');
      } finally {
        setUploadProgress(null);
      }
    },
    [loadTree, selectFile],
  );

  // Ctrl+K: 커맨드 팔레트 (IA — 단축키)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Escape로 몰입 모드 종료
  useEffect(() => {
    if (!immersive) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && setImmersive(false);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [immersive]);

  const actions: TreeActions = {
    createFolder: (parentId) => {
      void promptDialog('폴더 이름').then((name) => {
        if (!name?.trim()) return;
        void guard(() =>
          api('/folders', { method: 'POST', body: JSON.stringify({ name: name.trim(), parentId }) }),
        );
      });
    },
    renameFolder: (id, name) =>
      void guard(() => api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })),
    moveFolder: (id, parentId) =>
      void guard(() => api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ parentId }) })),
    deleteFolder: (id) => {
      void confirmDialog('폴더를 삭제할까요?', {
        message: '하위 폴더와 파일이 모두 삭제됩니다.',
        danger: true,
      }).then((ok) => {
        if (ok) void guard(() => api(`/folders/${id}`, { method: 'DELETE' }));
      });
    },
    renameFile: (id, name) =>
      void guard(() => api(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })),
    moveFile: (id, folderId) =>
      void guard(() => api(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ folderId }) })),
    deleteFile: (id) => {
      void confirmDialog('파일을 삭제할까요?', { danger: true }).then((ok) => {
        if (!ok) return;
        if (selected?.id === id) {
          setSelected(null);
          history.replaceState(null, '', '/');
        }
        void guard(() => api(`/files/${id}`, { method: 'DELETE' }));
      });
    },
    copyFile: (id) => void guard(() => api(`/files/${id}/copy`, { method: 'POST' })),
    uploadTo: (folderId) => {
      uploadFolderRef.current = folderId;
      uploadRef.current?.click();
    },
    editTags: setTagEditorFile,
    shareFile: (file) =>
      void guard(() =>
        api(`/files/${file.id}/share`, {
          method: 'PUT',
          body: JSON.stringify({ isShared: file.isShared !== 1 }),
        }),
      ),
    shareFolder: (folder) =>
      void guard(() =>
        api(`/folders/${folder.id}/share`, {
          method: 'PUT',
          body: JSON.stringify({ isShared: folder.isShared !== 1 }),
        }),
      ),
  };

  function toggleFavorite(file: TreeFile) {
    void guard(() =>
      api(`/me/files/${file.id}/state`, {
        method: 'PUT',
        body: JSON.stringify({ isFavorite: file.state.isFavorite !== 1 }),
      }),
    );
  }

  function changeSettings(patch: Partial<UserSettings>) {
    // 실시간 미리보기: 화면에 즉시 반영하고 서버에는 바로 저장 (SCR-141)
    setSettings((prev) => ({ ...prev, ...patch }));
    void api('/me/settings', { method: 'PUT', body: JSON.stringify(patch) }).catch(() => {});
  }

  async function handleLogout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    onLogout();
  }

  // 정렬 (SCR-111) + 태그 필터를 적용한 트리 데이터
  const visibleFiles = useMemo(() => {
    const filtered =
      tagFilter === null ? tree.files : tree.files.filter((f) => f.tags.includes(tagFilter));
    return [...filtered].sort((a, b) =>
      sortBy === 'name' ? a.name.localeCompare(b.name, 'ko') : b.updatedAt - a.updatedAt,
    );
  }, [tree.files, tagFilter, sortBy]);
  const sortedFolders = useMemo(
    () => [...tree.folders].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [tree.folders],
  );

  const railButton = (target: Panel, icon: string, label: string) => (
    <button
      onClick={() => setPanel(target)}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg transition ${
        panel === target ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-200'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-dvh bg-slate-950 text-slate-100">
      {/* 터치 기기: 드로어 토글 (입력 방식 기준 — 가로모드에서도 드로어 유지) */}
      <button
        onClick={() => setDrawerOpen(true)}
        className={`fixed left-3 top-2 z-20 rounded-md border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-slate-300 pc:hidden ${immersive ? 'hidden' : ''}`}
      >
        ☰
      </button>
      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 pc:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      <div
        className={`z-40 flex shrink-0 bg-slate-950 touch:fixed touch:inset-y-0 touch:left-0 touch:transition-transform ${
          drawerOpen ? '' : 'touch:-translate-x-full'
        } ${immersive ? 'hidden' : ''}`}
      >
      {/* 아이콘 레일 — 유일한 전역 내비게이션 (IA) */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-slate-800 py-3">
        {railButton('files', '📄', '내 파일')}
        {railButton('favorites', '★', '즐겨찾기')}
        {railButton('shared', '🔗', '공유 파일')}
        {railButton('settings', '⚙', '설정')}
        {user.role === 'admin' && railButton('admin', '🛠', '관리자')}
        <button
          onClick={handleLogout}
          title={`로그아웃 (${user.displayName ?? user.username})`}
          className="mt-auto flex h-10 w-10 items-center justify-center rounded-lg text-lg text-slate-600 transition hover:text-slate-300"
        >
          ⏻
        </button>
      </div>

      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-800">
        <div className="flex items-center gap-2 px-4 py-3">
          <h1 className="text-sm font-bold tracking-tight">{PANEL_TITLE[panel]}</h1>
          <span className="ml-auto truncate text-xs text-slate-600">
            {user.displayName ?? user.username}
          </span>
        </div>

        {panel === 'files' && (
          <>
            <div className="flex gap-2 px-3">
              <input
                ref={uploadRef}
                type="file"
                multiple
                accept=".md,.markdown,.html,.txt,.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf"
                className="hidden"
                onChange={(e) => {
                  const folderId = uploadFolderRef.current;
                  uploadFolderRef.current = null;
                  if (e.target.files) void doUpload(e.target.files, folderId);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => actions.uploadTo(null)}
                title="md·html·txt·이미지·PDF"
                className="flex-1 rounded-md border border-dashed border-slate-700 py-2 text-sm text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                + 업로드
              </button>
              <button
                onClick={() => actions.createFolder(null)}
                className="rounded-md border border-dashed border-slate-700 px-3 text-sm text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
              >
                + 폴더
              </button>
            </div>
            {uploadProgress !== null && (
              <div className="mx-3 mt-2 h-1 overflow-hidden rounded bg-slate-800">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
            <div className="mt-2 flex items-start gap-1 px-3">
              {tags.length > 0 && (
                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                  <button
                    onClick={() => setTagFilter(null)}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                      tagFilter === null ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    전체
                  </button>
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => setTagFilter((cur) => (cur === tag.id ? null : tag.id))}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition ${
                        tagFilter === tag.id ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                title="정렬"
                className="ml-auto rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-400 outline-none"
              >
                <option value="name">이름순</option>
                <option value="updated">최근 수정순</option>
              </select>
            </div>
            <nav className="mt-3 min-h-0 flex-1 overflow-auto px-2 pb-4">
              <RecentList files={tree.files} onSelect={(f) => void selectFile(f)} />
              <FileTree
                folders={sortedFolders}
                files={visibleFiles}
                tags={tags}
                isAdmin={user.role === 'admin'}
                selectedId={selected?.id ?? null}
                onSelect={(f) => void selectFile(f)}
                actions={actions}
              />
            </nav>
          </>
        )}

        {panel === 'favorites' && (
          <FavoritesPanel
            files={tree.files}
            selectedId={selected?.id ?? null}
            onSelect={(f) => void selectFile(f)}
          />
        )}

        {panel === 'shared' && (
          <SharedPanel
            selectedId={selected?.id ?? null}
            onSelect={(f) => void selectFile(sharedToTreeFile(f))}
          />
        )}

        {panel === 'settings' && <SettingsPanel settings={settings} onChange={changeSettings} />}

        {panel === 'admin' && user.role === 'admin' && (
          <AdminPanel meId={user.id} onSelectFile={(f) => void selectFile(f)} />
        )}
      </aside>
      </div>

      <main
        className="min-w-0 flex-1"
        onDragOver={(e) => {
          // OS 파일 드롭 업로드 허용 (트리 내부 이동 DnD는 nav 안에서 처리됨)
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length > 0) {
            e.preventDefault();
            void doUpload(e.dataTransfer.files, null);
          }
        }}
      >
        {selected ? (
          <Viewer
            file={selected}
            settings={settings}
            immersive={immersive}
            onToggleImmersive={() => setImmersive((v) => !v)}
            onContentSaved={() => void loadTree()}
            onToggleFavorite={toggleFavorite}
            onDirtyChange={(d) => (dirtyRef.current = d)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-600">
            <p>좌측에서 파일을 선택하거나, 여기로 파일을 끌어다 놓으세요</p>
            <p>
              <span className="rounded border border-slate-800 px-1.5 py-0.5 text-xs">Ctrl+K</span>{' '}
              검색
            </p>
          </div>
        )}
      </main>

      {paletteOpen && (
        <CommandPalette
          files={tree.files}
          onPick={(f) => void selectFile(f)}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {tagEditorFile && (
        <TagEditor
          file={tagEditorFile}
          tags={tags}
          onChanged={() => {
            void loadTags();
            void loadTree();
          }}
          onClose={() => setTagEditorFile(null)}
        />
      )}
    </div>
  );
}
