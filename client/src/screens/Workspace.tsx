import { api, type User } from '../lib/api';

// SCR-100: 워크스페이스 — 3단계(탐색기·뷰어)에서 본격 구현. 지금은 인증 확인용 자리표시자.
export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  async function handleLogout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    onLogout();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">docvault</h1>
        <p className="mt-3 text-zinc-300">
          <span className="font-medium text-emerald-400">{user.displayName ?? user.username}</span>
          님, 환영합니다 {user.role === 'admin' && <span className="text-xs text-zinc-500">(관리자)</span>}
        </p>
        <p className="mt-1 text-sm text-zinc-500">워크스페이스는 3단계에서 구현됩니다</p>
        <button
          onClick={handleLogout}
          className="mt-6 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
