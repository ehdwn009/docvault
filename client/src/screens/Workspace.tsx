import { useCallback, useEffect, useRef, useState } from 'react';
import FileTree, { type TreeActions } from '../components/FileTree';
import { api, ApiError, type Tree, type TreeFile, type User } from '../lib/api';
import Viewer from './Viewer';

// SCR-100: 워크스페이스 — 좌측 패널(파일 트리) + 본문(뷰어/편집기). 아이콘 레일은 패널이 늘어나는 단계에서
export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tree, setTree] = useState<Tree>({ folders: [], files: [] });
  const [selected, setSelected] = useState<TreeFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef<number | null>(null);

  const loadTree = useCallback(async () => {
    const t = await api<Tree>('/tree').catch(() => null);
    if (t) {
      setTree(t);
      // 이름변경·이동·삭제가 반영되도록 선택 파일을 새 트리와 동기화한다
      setSelected((prev) => (prev ? (t.files.find((f) => f.id === prev.id) ?? null) : null));
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

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
      void guard(() => api(`/files/${id}`, { method: 'DELETE' }));
    },
    copyFile: (id) => void guard(() => api(`/files/${id}/copy`, { method: 'POST' })),
    uploadTo: (folderId) => {
      uploadFolderRef.current = folderId;
      uploadRef.current?.click();
    },
  };

  async function handleLogout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    onLogout();
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800">
        <div className="flex items-center gap-2 px-4 py-3">
          <h1 className="font-bold tracking-tight">docvault</h1>
          <span className="ml-auto truncate text-xs text-zinc-500">
            {user.displayName ?? user.username}
          </span>
          <button
            onClick={handleLogout}
            title="로그아웃"
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            로그아웃
          </button>
        </div>

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

        <nav className="mt-3 min-h-0 flex-1 overflow-auto px-2 pb-4">
          <FileTree
            folders={tree.folders}
            files={tree.files}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            actions={actions}
          />
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        {selected ? (
          <Viewer file={selected} onContentSaved={() => void loadTree()} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            좌측에서 파일을 선택하거나 업로드하세요
          </div>
        )}
      </main>
    </div>
  );
}
