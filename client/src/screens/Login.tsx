import { useState, type FormEvent } from 'react';
import { api, ApiError, type User } from '../lib/api';

// SCR-901: 로그인
export default function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user } = await api<{ user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '서버에 연결할 수 없습니다');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl bg-slate-900 p-8 shadow-lg">
        <h1 className="text-2xl font-bold tracking-tight">docvault</h1>
        <p className="mt-1 text-sm text-slate-400">로그인이 필요합니다</p>

        <label className="mt-6 block text-sm text-slate-300">
          아이디
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none focus:border-slate-400"
          />
        </label>

        <label className="mt-4 block text-sm text-slate-300">
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none focus:border-slate-400"
          />
        </label>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="mt-6 w-full rounded-md bg-slate-100 py-2 font-medium text-slate-900 transition hover:bg-white disabled:opacity-40"
        >
          {submitting ? '확인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
