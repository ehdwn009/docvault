import { useEffect } from 'react';
import { SHORTCUTS } from '../lib/shortcuts';

// SCR-145: 단축키·제스처 치트시트 — 내용은 레지스트리(lib/shortcuts.ts)를 읽어 그린다.
// 표를 여기 손으로 쓰지 않는 이유: 단축키가 늘 때 도움말이 낡는 것을 구조로 막는다 (IA)
export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 레지스트리의 등장 순서를 유지하며 문맥별로 묶는다
  const groups: { context: string; items: typeof SHORTCUTS }[] = [];
  for (const s of SHORTCUTS) {
    const g = groups.find((x) => x.context === s.context);
    if (g) g.items.push(s);
    else groups.push({ context: s.context, items: [s] });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="font-medium text-slate-100">단축키 · 제스처</h2>
          <button onClick={onClose} title="닫기 (Esc)" className="rounded px-2 text-slate-500 transition hover:text-slate-200">
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="columns-1 gap-8 sm:columns-2">
            {groups.map((g) => (
              <section key={g.context} className="mb-5 break-inside-avoid">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {g.context}
                </h3>
                {g.items.map((s, i) => (
                  <div key={i} className="flex items-baseline gap-3 py-1 text-sm">
                    <kbd className="shrink-0 whitespace-nowrap rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-200">
                      {s.input}
                    </kbd>
                    <span className="min-w-0 text-slate-400">
                      {s.effect}
                      {s.pcOnly && <span className="ml-1.5 text-[10px] text-slate-600">PC</span>}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
