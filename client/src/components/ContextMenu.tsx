import { useEffect, useRef } from 'react';

export type MenuItem = { label: string; danger?: boolean; action: () => void };

/** 메뉴 최소 너비(px) — 화면 밖으로 나가지 않게 위치를 보정할 때 쓴다 (아래 min-w-40과 같아야 한다) */
const MENU_WIDTH = 160;

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
      className="fixed z-50 min-w-40 rounded-md border border-slate-700 bg-slate-900 py-1 shadow-xl"
      // 화면 밖으로 나가지 않게 가로·세로 모두 보정한다. 폰에서는 ⋯ 버튼이 패널 오른쪽 끝에 있어
      // 가로 보정이 없으면 메뉴가 잘린다 (항목 높이는 34px로 어림한다)
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - items.length * 34 - 16)),
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            onClose();
            item.action();
          }}
          className={`block w-full px-3 py-1.5 text-left text-sm transition hover:bg-slate-800 ${
            item.danger ? 'text-red-400' : 'text-slate-200'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
