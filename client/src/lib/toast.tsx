import { useEffect, useState } from 'react';

type ToastItem = { id: number; type: 'success' | 'error' | 'info'; message: string };

// 어디서든 toast()를 부를 수 있게 모듈 레벨로 연결한다. ToastHost는 App에 1회 마운트.
let push: ((t: Omit<ToastItem, 'id'>) => void) | null = null;
let seq = 0;

export function toast(message: string, type: ToastItem['type'] = 'info') {
  push?.({ message, type });
}

const STYLE: Record<ToastItem['type'], string> = {
  success: 'border-emerald-700 bg-emerald-950 text-emerald-200',
  error: 'border-red-700 bg-red-950 text-red-200',
  info: 'border-slate-700 bg-slate-900 text-slate-200',
};

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    push = (t) => {
      const id = ++seq;
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3000);
    };
    return () => {
      push = null;
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded-md border px-3 py-1.5 text-sm shadow-lg ${STYLE[t.type]}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
