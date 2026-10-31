import type { CSSProperties, MouseEvent, ReactNode } from 'react';

type Props = {
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void;
  selected?: boolean;
  /** 흐린 글자(최근 열람처럼 보조 목록) */
  muted?: boolean;
  title?: string;
  /** 촘촘한 보조 목록(최근 열람) — PC에서만 작게, 터치는 그대로 44px */
  dense?: boolean;
  style?: CSSProperties;
  children: ReactNode;
  className?: string;
};

/** 목록의 한 행 — 파일·즐겨찾기·공유·최근 열람 (SCR-110·112·120·130 공용). 터치는 44px */
export default function ListRow({ onClick, onContextMenu, selected = false, muted = false, title, dense = false, style, children, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      style={style}
      className={`flex w-full items-start gap-1.5 rounded px-2 text-left transition touch:min-h-11 touch:items-center ${dense ? 'py-0.5 text-[13px]' : 'py-1 text-sm'} ${
        selected ? 'bg-slate-800 text-slate-100' : muted ? 'text-slate-400 hover:bg-slate-900 hover:text-slate-200' : 'text-slate-300 hover:bg-slate-900'
      } ${className}`}
    >
      {children}
    </button>
  );
}
