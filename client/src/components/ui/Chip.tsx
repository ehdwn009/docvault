import type { ReactNode } from 'react';

// 44px 규칙을 부품에 박는다 — 칩·행·아이콘 단추는 터치 기기에서 저절로 44px이 된다. 자리마다 touch: 크기를 따로 주지 않는다 (IA — 안 B 폰).

type Props = {
  active?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
};

/** 알약 모양 선택 칩 — 태그 필터·목록 전환 */
export default function Chip({ active = false, onClick, title, children, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs transition touch:min-h-11 touch:px-3 touch:text-sm ${
        active ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
      } ${className}`}
    >
      {children}
    </button>
  );
}
