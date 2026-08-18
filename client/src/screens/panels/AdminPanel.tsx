import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, DEFAULT_FILE_STATE, type TreeFile, type User } from '../../lib/api';
import { confirmDialog, promptDialog } from '../../lib/dialog';

type Stats = {
  userCount: number;
  fileCount: number;
  folderCount: number;
  versionCount: number;
  totalBytes: number;
  sharedCount: number;
};

type AdminUser = User & { isActive: number; createdAt: number; lastSignedIn: number | null };

type AdminTreeUser = {
  id: number;
  username: string;
  displayName: string | null;
  folders: { id: number; parentId: number | null; name: string; isShared: number }[];
  files: {
    id: number;
    folderId: number | null;
    name: string;
    fileType: TreeFile['fileType'];
    sizeBytes: number;
    isShared: number;
    updatedAt: number;
  }[];
};

type Tab = 'stats' | 'users' | 'tree';

type Props = { meId: number; onSelectFile: (file: TreeFile) => void };

// SCR-300: 관리자 — 대시보드(301)·사용자 관리(302)·전체 파일(303)
export default function AdminPanel({ meId, onSelectFile }: Props) {
  const [tab, setTab] = useState<Tab>('users');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [treeUsers, setTreeUsers] = useState<AdminTreeUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    if (tab === 'stats')
      void api<{ stats: Stats }>('/admin/stats').then((r) => setStats(r.stats)).catch(() => {});
    if (tab === 'users')
      void api<{ users: AdminUser[] }>('/admin/users').then((r) => setUsers(r.users)).catch(() => {});
    if (tab === 'tree')
      void api<{ users: AdminTreeUser[] }>('/admin/tree').then((r) => setTreeUsers(r.users)).catch(() => {});
  }, [tab]);

  useEffect(reload, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '작업에 실패했습니다');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 px-3 pb-2">
        {(
          [
            ['stats', '통계'],
            ['users', '사용자'],
            ['tree', '전체 파일'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-2 py-1 text-xs transition ${
              tab === t ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="px-3 pb-2 text-xs text-red-400">{error}</p>}

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {tab === 'stats' && stats && (
          <dl className="space-y-2 text-sm">
            {(
              [
                ['사용자', stats.userCount],
                ['파일', stats.fileCount],
                ['폴더', stats.folderCount],
                ['버전 스냅샷', stats.versionCount],
                ['공유 파일', stats.sharedCount],
                ['총 용량', `${(stats.totalBytes / 1024 / 1024).toFixed(2)} MB`],
              ] as [string, string | number][]
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between rounded bg-slate-900 px-3 py-2">
                <dt className="text-slate-400">{label}</dt>
                <dd className="font-medium text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {tab === 'users' && (
          <UsersTab users={users} meId={meId} run={run} />
        )}

        {tab === 'tree' && (
          <div className="space-y-3">
            {treeUsers.map((u) => (
              <div key={u.id}>
                <h4 className="px-1 text-xs font-semibold text-slate-400">
                  {u.displayName ?? u.username}
                  <span className="ml-1 text-slate-600">({u.files.length}개)</span>
                </h4>
                {u.files.map((f) => (
                  <button
                    key={f.id}
                    onClick={() =>
                      onSelectFile({
                        ...f,
                        sortOrder: 0,
                        tags: [],
                        state: { ...DEFAULT_FILE_STATE },
                      })
                    }
                    className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[13px] text-slate-400 transition hover:bg-slate-900 hover:text-slate-200"
                  >
                    <span className="truncate">{f.name}</span>
                    {f.isShared === 1 && <span className="ml-auto text-[10px] text-sky-500">공유</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UsersTab({
  users,
  meId,
  run,
}: {
  users: AdminUser[];
  meId: number;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function create(e: FormEvent) {
    e.preventDefault();
    void run(() =>
      api('/admin/users', { method: 'POST', body: JSON.stringify({ username, password }) }),
    ).then(() => {
      setUsername('');
      setPassword('');
    });
  }

  return (
    <div>
      {/* 계정 발급 */}
      <form onSubmit={create} className="space-y-2 rounded-md border border-slate-800 p-3">
        <h4 className="text-xs font-semibold text-slate-400">계정 발급</h4>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="아이디 (영소문자·숫자·_)"
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-400"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="초기 비밀번호 (8자 이상)"
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-400"
        />
        <button
          type="submit"
          disabled={username.length < 3 || password.length < 8}
          className="w-full rounded-md bg-slate-100 py-1.5 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-40"
        >
          발급
        </button>
      </form>

      {/* 사용자 목록 */}
      <div className="mt-3 space-y-2">
        {users.map((u) => (
          <div key={u.id} className="rounded-md bg-slate-900 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-100">{u.username}</span>
              <span className="text-[10px] text-slate-500">{u.role}</span>
              {u.isActive === 0 && <span className="text-[10px] text-red-400">비활성</span>}
              {u.id === meId && <span className="text-[10px] text-emerald-400">나</span>}
            </div>
            {u.id !== meId && (
              <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                <button
                  onClick={() =>
                    void run(() =>
                      api(`/admin/users/${u.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ isActive: u.isActive === 0 }),
                      }),
                    )
                  }
                  className="text-slate-500 hover:text-slate-300"
                >
                  {u.isActive === 1 ? '비활성화' : '활성화'}
                </button>
                <button
                  onClick={() =>
                    void run(() =>
                      api(`/admin/users/${u.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ role: u.role === 'admin' ? 'user' : 'admin' }),
                      }),
                    )
                  }
                  className="text-slate-500 hover:text-slate-300"
                >
                  {u.role === 'admin' ? '일반으로' : '관리자로'}
                </button>
                <button
                  onClick={() => {
                    void promptDialog('새 비밀번호 (8자 이상)').then((pw) => {
                      if (pw && pw.length >= 8)
                        void run(() =>
                          api(`/admin/users/${u.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ password: pw }),
                          }),
                        );
                    });
                  }}
                  className="text-slate-500 hover:text-slate-300"
                >
                  비밀번호 초기화
                </button>
                <button
                  onClick={() => {
                    void confirmDialog(`${u.username} 계정을 삭제할까요?`, {
                      message: '소유한 파일·폴더 등 모든 데이터가 함께 삭제됩니다.',
                      danger: true,
                    }).then((ok) => {
                      if (ok) void run(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }));
                    });
                  }}
                  className="text-red-500 hover:text-red-400"
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
