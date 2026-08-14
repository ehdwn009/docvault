import { useEffect, useState } from 'react';

// 브라우저 기본 confirm/prompt 대체 — 앱 스타일의 모달. DialogHost는 App에 1회 마운트.

export type ChoiceOption = { label: string; value: string; danger?: boolean };

type DialogRequest =
  | { kind: 'confirm'; title: string; message?: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; message?: string; defaultValue?: string; resolve: (value: string | null) => void }
  | { kind: 'choice'; title: string; message?: string; choices: ChoiceOption[]; resolve: (value: string | null) => void };

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

/** 여러 선택지 중 하나를 고르는 대화상자 — 취소하면 null (충돌 처리 등) */
export function choiceDialog(
  title: string,
  opts: { message?: string; choices: ChoiceOption[] },
): Promise<string | null> {
  return new Promise((resolve) => {
    if (open) open({ kind: 'choice', title, ...opts, resolve });
    else resolve(null); // Host 미마운트 시 안전한 폴백 — 아무것도 선택하지 않음
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
    else if (req.kind === 'prompt') req.resolve(result ? value : null);
    else req.resolve(null); // choice는 버튼별 pick으로만 값이 정해진다
    setReq(null);
  };

  const pick = (v: string) => {
    if (req.kind === 'choice') req.resolve(v);
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
        {req.kind === 'choice' && (
          <div className="mt-3 flex flex-col gap-1.5">
            {req.choices.map((c) => (
              <button
                key={c.value}
                onClick={() => pick(c.value)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                  c.danger
                    ? 'border-red-900 text-red-400 hover:bg-red-950'
                    : 'border-slate-700 text-slate-200 hover:bg-slate-800'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => close(false)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            취소
          </button>
          {req.kind !== 'choice' && (
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
          )}
        </div>
      </div>
    </div>
  );
}
