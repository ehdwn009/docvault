import { useEffect, useRef } from 'react';

export type MenuItem = { label: string; danger?: boolean; action: () => void };

type Props = { x: number; y: number; items: MenuItem[]; onClose: () => void };

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // mousedown 기준으로 닫아야 메뉴 밖 드래그 시작 등에도 반응한다
    window.addEventListener('mousedown', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-40 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
      style={{ left: x, top: Math.min(y, window.innerHeight - items.length * 34 - 16) }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            onClose();
            item.action();
          }}
          className={`block w-full px-3 py-1.5 text-left text-sm transition hover:bg-zinc-800 ${
            item.danger ? 'text-red-400' : 'text-zinc-200'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
