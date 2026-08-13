import { useEffect, useState } from 'react';

type Health = { status: string; version: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">docvault</h1>
        <p className="mt-2 text-zinc-400">폐쇄형 문서 열람·편집 플랫폼</p>
        <p className="mt-6 text-sm">
          {health && (
            <span className="text-emerald-400">
              API 연결됨 · v{health.version}
            </span>
          )}
          {error && <span className="text-red-400">API 연결 실패: {error}</span>}
          {!health && !error && <span className="text-zinc-500">API 확인 중…</span>}
        </p>
      </div>
    </div>
  );
}
