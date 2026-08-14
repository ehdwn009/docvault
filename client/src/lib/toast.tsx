import { useEffect, useState } from 'react';

type ToastAction = { label: string; onAction: () => void };
type ToastItem = {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  action?: ToastAction;
};

// 어디서든 toast()를 부를 수 있게 모듈 레벨로 연결한다. ToastHost는 App에 1회 마운트.
let push: ((t: Omit<ToastItem, 'id'>, duration: number) => void) | null = null;
let seq = 0;

export function toast(
  message: string,
  type: ToastItem['type'] = 'info',
  opts?: { action?: ToastAction; duration?: number },
) {
  // 액션(실행 취소 등)이 있으면 누를 시간을 더 준다
  push?.({ message, type, action: opts?.action }, opts?.duration ?? (opts?.action ? 5000 : 3000));
}

const STYLE: Record<ToastItem['type'], string> = {
  success: 'border-emerald-700 bg-emerald-950 text-emerald-200',
  error: 'border-red-700 bg-red-950 text-red-200',
  info: 'border-slate-700 bg-slate-900 text-slate-200',
};

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    push = (t, duration) => {
      const id = ++seq;
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), duration);
    };
    return () => {
      push = null;
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-md border px-3 py-1.5 text-sm shadow-lg ${STYLE[t.type]}`}
        >
          {t.message}
          {t.action && (
            <button
              onClick={() => {
                t.action?.onAction();
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
              }}
              className="shrink-0 rounded border border-current px-2 py-0.5 text-xs font-medium hover:opacity-80"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
