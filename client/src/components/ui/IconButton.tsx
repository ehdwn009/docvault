import type { ReactNode } from 'react';

type Props = {
  onClick?: () => void;
  title?: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
};

/** 아이콘만 있는 단추 — 이름은 label(접근성)과 title(툴팁)로. PC 36px, 터치 44px */
export default function IconButton({ onClick, title, label, active = false, disabled, children, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-md transition touch:h-11 touch:w-11 disabled:opacity-40 ${
        active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      } ${className}`}
    >
      {children}
    </button>
  );
}
