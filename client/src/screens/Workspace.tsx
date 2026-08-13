import { useCallback, useEffect, useRef, useState } from 'react';
import CommandPalette from '../components/CommandPalette';
import FileTree, { type TreeActions } from '../components/FileTree';
import RecentList from '../components/RecentList';
import TagEditor from '../components/TagEditor';
import {
  api,
  ApiError,
  type SharedFile,
  type Tag,
  type Tree,
  type TreeFile,
  type User,
  type UserSettings,
} from '../lib/api';
import AdminPanel from './panels/AdminPanel';
import FavoritesPanel from './panels/FavoritesPanel';
import SettingsPanel from './panels/SettingsPanel';
import SharedPanel from './panels/SharedPanel';
import Viewer from './Viewer';

type Panel = 'files' | 'favorites' | 'shared' | 'settings' | 'admin';

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

// SCR-100: 워크스페이스 — 아이콘 레일 + 패널 + 본문(뷰어/편집기)
export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tree, setTree] = useState<Tree>({ folders: [], files: [] });
  const [selected, setSelected] = useState<TreeFile | null>(null);
  const [panel, setPanel] = useState<Panel>('files');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [tagEditorFile, setTagEditorFile] = useState<TreeFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef<number | null>(null);

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

  const loadTree = useCallback(async () => {
    const t = await api<Tree>('/tree').catch(() => null);
    if (t) {
      setTree(t);
      // 이름변경·이동이 반영되도록 선택 파일을 새 트리와 동기화.
      // 트리에 없으면(공유 파일 열람 중) 선택을 유지한다 — 삭제는 deleteFile에서 직접 해제
      setSelected((prev) => (prev ? (t.files.find((f) => f.id === prev.id) ?? prev) : null));
    }
  }, []);

  const loadTags = useCallback(async () => {
    const r = await api<{ tags: Tag[] }>('/tags').catch(() => null);
    if (r) setTags(r.tags);
  }, []);

  useEffect(() => {
    void loadTree();
    void loadTags();
    void api<{ settings: UserSettings }>('/me/settings')
      .then(({ settings }) => setSettings(settings))
      .catch(() => {});
  }, [loadTree, loadTags]);

  /** 트리 조작 공통 래퍼: 에러는 notice로, 성공하면 트리 재조회 */
  const guard = useCallback(
    async (fn: () => Promise<unknown>) => {
      setNotice(null);
      try {
        await fn();
        await loadTree();
      } catch (e) {
        setNotice(e instanceof ApiError ? e.message : '작업에 실패했습니다');
      }
    },
    [loadTree],
  );

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const folderId = uploadFolderRef.current;
    uploadFolderRef.current = null;
    const fd = new FormData();
    for (const f of fileList) fd.append('files', f);
    if (folderId !== null) fd.append('folderId', String(folderId));
    await guard(async () => {
      const { files } = await api<{ files: TreeFile[] }>('/files', { method: 'POST', body: fd });
      if (files[0]) setSelected(files[0]);
    });
    if (uploadRef.current) uploadRef.current.value = '';
  }

  const actions: TreeActions = {
    createFolder: (parentId) => {
      const name = window.prompt('폴더 이름');
      if (!name?.trim()) return;
      void guard(() =>
        api('/folders', { method: 'POST', body: JSON.stringify({ name: name.trim(), parentId }) }),
      );
    },
    renameFolder: (id, name) =>
      void guard(() => api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })),
    moveFolder: (id, parentId) =>
      void guard(() => api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ parentId }) })),
    deleteFolder: (id) => {
      if (!window.confirm('폴더와 하위 폴더·파일이 모두 삭제됩니다. 계속할까요?')) return;
      void guard(() => api(`/folders/${id}`, { method: 'DELETE' }));
    },
    renameFile: (id, name) =>
      void guard(() => api(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })),
    moveFile: (id, folderId) =>
      void guard(() => api(`/files/${id}`, { method: 'PUT', body: JSON.stringify({ folderId }) })),
    deleteFile: (id) => {
      if (!window.confirm('파일을 삭제할까요?')) return;
      if (selected?.id === id) setSelected(null);
      void guard(() => api(`/files/${id}`, { method: 'DELETE' }));
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

  const railButton = (target: Panel, icon: string, label: string) => (
    <button
      onClick={() => setPanel(target)}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg transition ${
        panel === target ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* 아이콘 레일 — 유일한 전역 내비게이션 (IA) */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-zinc-800 py-3">
        {railButton('files', '📄', '내 파일')}
        {railButton('favorites', '★', '즐겨찾기')}
        {railButton('shared', '🔗', '공유 파일')}
        {railButton('settings', '⚙', '설정')}
        {user.role === 'admin' && railButton('admin', '🛠', '관리자')}
        <button
          onClick={handleLogout}
          title={`로그아웃 (${user.displayName ?? user.username})`}
          className="mt-auto flex h-10 w-10 items-center justify-center rounded-lg text-lg text-zinc-600 transition hover:text-zinc-300"
        >
          ⏻
        </button>
      </div>

      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800">
        <div className="flex items-center gap-2 px-4 py-3">
          <h1 className="text-sm font-bold tracking-tight">{PANEL_TITLE[panel]}</h1>
          <span className="ml-auto truncate text-xs text-zinc-600">
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
                accept=".md,.markdown,.html,.txt"
                className="hidden"
                onChange={(e) => void handleUpload(e.target.files)}
              />
              <button
                onClick={() => actions.uploadTo(null)}
                className="flex-1 rounded-md border border-dashed border-zinc-700 py-2 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
              >
                + 업로드
              </button>
              <button
                onClick={() => actions.createFolder(null)}
                className="rounded-md border border-dashed border-zinc-700 px-3 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
              >
                + 폴더
              </button>
            </div>
            {notice && <p className="px-3 pt-2 text-xs text-red-400">{notice}</p>}
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 px-3">
                <button
                  onClick={() => setTagFilter(null)}
                  className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                    tagFilter === null ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  전체
                </button>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => setTagFilter((cur) => (cur === tag.id ? null : tag.id))}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition ${
                      tagFilter === tag.id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
            <nav className="mt-3 min-h-0 flex-1 overflow-auto px-2 pb-4">
              <RecentList files={tree.files} onSelect={setSelected} />
              <FileTree
                folders={tree.folders}
                files={tagFilter === null ? tree.files : tree.files.filter((f) => f.tags.includes(tagFilter))}
                tags={tags}
                isAdmin={user.role === 'admin'}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                actions={actions}
              />
            </nav>
          </>
        )}

        {panel === 'favorites' && (
          <FavoritesPanel
            files={tree.files}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />
        )}

        {panel === 'shared' && (
          <SharedPanel
            selectedId={selected?.id ?? null}
            onSelect={(f) => setSelected(sharedToTreeFile(f))}
          />
        )}

        {panel === 'settings' && <SettingsPanel settings={settings} onChange={changeSettings} />}

        {panel === 'admin' && user.role === 'admin' && (
          <AdminPanel meId={user.id} onSelectFile={setSelected} />
        )}
      </aside>

      <main className="min-w-0 flex-1">
        {selected ? (
          <Viewer
            file={selected}
            settings={settings}
            onContentSaved={() => void loadTree()}
            onToggleFavorite={toggleFavorite}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            좌측에서 파일을 선택하거나 업로드하세요 <span className="ml-2 rounded border border-zinc-800 px-1.5 py-0.5 text-xs">Ctrl+K 검색</span>
          </div>
        )}
      </main>

      {paletteOpen && (
        <CommandPalette
          files={tree.files}
          onPick={setSelected}
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
