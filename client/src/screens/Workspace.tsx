import { useCallback, useEffect, useRef, useState } from 'react';
import FileTree from '../components/FileTree';
import { api, ApiError, type Tree, type TreeFile, type User } from '../lib/api';
import Viewer from './Viewer';

// SCR-100: 워크스페이스 — 좌측 패널(파일 트리) + 본문(뷰어/편집기). 아이콘 레일은 패널이 늘어나는 단계에서
export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tree, setTree] = useState<Tree>({ folders: [], files: [] });
  const [selected, setSelected] = useState<TreeFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const loadTree = useCallback(async () => {
    const t = await api<Tree>('/tree').catch(() => null);
    if (t) setTree(t);
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setNotice(null);
    const fd = new FormData();
    for (const f of fileList) fd.append('files', f);
    try {
      const { files } = await api<{ files: TreeFile[] }>('/files', { method: 'POST', body: fd });
      await loadTree();
      if (files[0]) setSelected(files[0]);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : '업로드에 실패했습니다');
    } finally {
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }

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

        <div className="px-3">
          <input
            ref={uploadRef}
            type="file"
            multiple
            accept=".md,.markdown,.html,.txt"
            className="hidden"
            onChange={(e) => void handleUpload(e.target.files)}
          />
          <button
            onClick={() => uploadRef.current?.click()}
            className="w-full rounded-md border border-dashed border-zinc-700 py-2 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
          >
            + 파일 업로드 (.md .html .txt)
          </button>
          {notice && <p className="mt-2 text-xs text-red-400">{notice}</p>}
        </div>

        <nav className="mt-3 min-h-0 flex-1 overflow-auto px-2 pb-4">
          <FileTree
            folders={tree.folders}
            files={tree.files}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
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
