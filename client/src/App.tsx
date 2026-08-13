import { useEffect, useState } from 'react';
import { api, type User } from './lib/api';
import Login from './screens/Login';
import Workspace from './screens/Workspace';

type AuthState = { status: 'loading' } | { status: 'guest' } | { status: 'authed'; user: User };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  // 새로고침해도 세션 쿠키가 살아 있으면 로그인 상태를 복원한다
  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then(({ user }) => setAuth({ status: 'authed', user }))
      .catch(() => setAuth({ status: 'guest' }));
  }, []);

  if (auth.status === 'loading') {
    return <div className="min-h-screen bg-zinc-950" />;
  }
  if (auth.status === 'guest') {
    return <Login onLogin={(user) => setAuth({ status: 'authed', user })} />;
  }
  return <Workspace user={auth.user} onLogout={() => setAuth({ status: 'guest' })} />;
}
