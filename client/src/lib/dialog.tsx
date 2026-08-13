import { useEffect, useState } from 'react';

// 브라우저 기본 confirm/prompt 대체 — 앱 스타일의 모달. DialogHost는 App에 1회 마운트.

type DialogRequest =
  | { kind: 'confirm'; title: string; message?: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; message?: string; defaultValue?: string; resolve: (value: string | null) => void };

let open: ((r: DialogRequest) => void) | null = null;

export function confirmDialog(
  title: string,
  opts?: { message?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    if (open) open({ kind: 'confirm', title, ...opts, resolve });
    else resolve(window.confirm(title)); // Host 미마운트 시 안전한 폴백
  });
}

export function promptDialog(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (open) open({ kind: 'prompt', title, defaultValue, resolve });
    else resolve(window.prompt(title, defaultValue));
  });
}

export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    open = (r) => {
      setReq(r);
      setValue(r.kind === 'prompt' ? (r.defaultValue ?? '') : '');
    };
    return () => {
      open = null;
    };
  }, []);

  if (!req) return null;

  const close = (result: boolean) => {
    if (req.kind === 'confirm') req.resolve(result);
    else req.resolve(result ? value : null);
    setReq(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && close(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      }}
    >
      <div className="w-80 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <h3 className="text-sm font-medium text-slate-100">{req.title}</h3>
        {req.message && <p className="mt-1.5 text-xs text-slate-400">{req.message}</p>}
        {req.kind === 'prompt' && (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-3 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-400"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => close(false)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            취소
          </button>
          <button
            autoFocus={req.kind === 'confirm'}
            onClick={() => close(true)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              req.kind === 'confirm' && req.danger
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-slate-100 text-slate-900 hover:bg-white'
            }`}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
