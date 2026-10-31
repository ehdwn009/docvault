import type { MouseEvent, ReactNode } from 'react';

type Props = {
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void;
  selected?: boolean;
  /** 흐린 글자(최근 열람처럼 보조 목록) */
  muted?: boolean;
  title?: string;
  children: ReactNode;
  className?: string;
};

/** 목록의 한 행 — 파일·즐겨찾기·공유·최근 열람 (SCR-110·112·120·130 공용). 터치는 44px */
export default function ListRow({ onClick, onContextMenu, selected = false, muted = false, title, children, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={`flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-sm transition touch:min-h-11 touch:items-center ${
        selected ? 'bg-slate-800 text-slate-100' : muted ? 'text-slate-400 hover:bg-slate-900 hover:text-slate-200' : 'text-slate-300 hover:bg-slate-900'
      } ${className}`}
    >
      {children}
    </button>
  );
}
