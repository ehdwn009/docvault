import { useCallback, useEffect, useState, type FormEvent } from 'react';
import BootTimingTable from '../../components/BootTimingTable';
import { api, toTreeFile, type TreeFile, type User } from '../../lib/api';
import { confirmDialog, promptDialog } from '../../lib/dialog';
import { runGuarded } from '../../lib/guard';

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

type Tab = 'stats' | 'users' | 'tree' | 'ai' | 'perf';

type UsageRow = {
  id: number; username: string; displayName: string | null;
  today: number; week: number; month: number;
  inputTokens: number; outputTokens: number; webSearches: number; costUsd: number;
};
type AskUsage = {
  users: UsageRow[];
  totals: Omit<UsageRow, 'id' | 'username' | 'displayName'>;
  topFiles: { fileName: string | null; count: number }[];
  pricing: { models: { id: string; name: string; inputPerMtok: number; outputPerMtok: number }[]; searchPer1000: number; krwPerUsd: number };
};

type Props = { meId: number; onSelectFile: (file: TreeFile) => void };

// SCR-300: 관리자 — 대시보드(301)·사용자 관리(302)·전체 파일(303)·AI 사용량(305)·성능(306)
export default function AdminPanel({ meId, onSelectFile }: Props) {
  const [tab, setTab] = useState<Tab>('users');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [treeUsers, setTreeUsers] = useState<AdminTreeUser[]>([]);
  const [usage, setUsage] = useState<AskUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    if (tab === 'stats')
      void api<{ stats: Stats }>('/admin/stats').then((r) => setStats(r.stats)).catch(() => {});
    if (tab === 'users')
      void api<{ users: AdminUser[] }>('/admin/users').then((r) => setUsers(r.users)).catch(() => {});
    if (tab === 'tree')
      void api<{ users: AdminTreeUser[] }>('/admin/tree').then((r) => setTreeUsers(r.users)).catch(() => {});
    if (tab === 'ai')
      void api<AskUsage>('/admin/ask-usage').then(setUsage).catch(() => {});
  }, [tab]);

  useEffect(reload, [reload]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    // 관리자 작업의 실패는 토스트가 아니라 패널 안에 띄운다 — 작업한 자리 바로 옆이라야 보인다
    await runGuarded(fn, reload, setError);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 overflow-x-auto px-3 pb-2">
        {(
          [
            ['stats', '통계'],
            ['users', '사용자'],
            ['tree', '전체 파일'],
            ['ai', 'AI 사용량'],
            ['perf', '성능'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs transition ${
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

        {tab === 'ai' && usage && <UsageTab usage={usage} />}
        {tab === 'perf' && <BootTimingTable />}

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
                      onSelectFile(toTreeFile(f))
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

// SCR-305: AI 사용량 — 청구서가 오기 전에 "누가 얼마나 쓰나"를 본다. 비용은 단가 상수로 추정한 대략값
function UsageTab({ usage }: { usage: AskUsage }) {
  const won = (usd: number) => `${Math.round(usd * usage.pricing.krwPerUsd).toLocaleString()}원`;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const t = usage.totals;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-2">
        {(
          [
            ['오늘 질문', t.today],
            ['30일 질문', t.month],
            ['30일 웹 검색', t.webSearches],
            ['30일 추정 비용', `$${t.costUsd.toFixed(2)} ≈ ${won(t.costUsd)}`],
          ] as [string, string | number][]
        ).map(([label, value]) => (
          <div key={label} className="rounded bg-slate-900 px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-medium text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="mb-1 text-xs text-slate-500">사용자별 (질문 오늘 / 7일 / 30일 · 30일 토큰 입력+출력 · 검색 · 추정 비용)</p>
        <div className="space-y-1">
          {usage.users.map((u) => (
            <div key={u.id} className="rounded bg-slate-900 px-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className="font-medium text-slate-100">{u.displayName ?? u.username}</span>
                <span className="text-xs text-slate-300">{u.today} / {u.week} / {u.month}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                토큰 {k(u.inputTokens)}+{k(u.outputTokens)} · 검색 {u.webSearches} · ${u.costUsd.toFixed(2)} ≈ {won(u.costUsd)}
              </div>
            </div>
          ))}
        </div>
      </div>
      {usage.topFiles.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-slate-500">30일 동안 많이 물어본 문서</p>
          <ul className="space-y-1">
            {usage.topFiles.map((f, i) => (
              <li key={i} className="flex justify-between rounded bg-slate-900 px-3 py-1.5">
                <span className="truncate text-slate-300">{f.fileName ?? '문서 없음'}</span>
                <span className="shrink-0 pl-2 text-xs text-slate-500">{f.count}번</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-slate-600">
        단가(백만 토큰당 입력/출력): {usage.pricing.models.map((m) => `${m.name} $${m.inputPerMtok}/$${m.outputPerMtok}`).join(' · ')} · 검색 ${usage.pricing.searchPer1000}/1000회 · 1달러 {usage.pricing.krwPerUsd}원 기준의 대략값. 답마다 쓴 모델로 계산합니다. 정확한 금액은 console.anthropic.com
      </p>
    </div>
  );
}
