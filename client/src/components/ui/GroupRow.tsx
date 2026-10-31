import type { MouseEvent, ReactNode } from 'react';
import { useLongPress } from '../../lib/longPress';
import Icon from '../Icon';

/** 아이콘 타일의 채움색 — 즐겨찾기·공유받음·휴지통처럼 "장소"를 뜻하는 행은 색을 채우고, 폴더·문서는 선 아이콘만 */
export type Tint = 'warn' | 'accent' | 'muted' | 'card' | 'good';
const TINT: Record<Tint, string> = {
  warn: 'bg-warn-500 text-white',
  accent: 'bg-accent-500 text-white',
  muted: 'bg-slate-500 text-white',
  card: 'bg-card-500 text-white',
  good: 'bg-good-500 text-white',
};

type Props = {
  /** 왼쪽 아이콘(선 아이콘). tint가 있으면 채운 타일 안에, 없으면 iconClass 색의 선으로 */
  icon?: ReactNode;
  tint?: Tint;
  /** tint 없는 아이콘의 글자색 — 폴더는 강조색, 문서는 회색 */
  iconClass?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** 오른쪽 끝(개수·날짜·태그 점·스위치) */
  right?: ReactNode;
  /** › — 누르면 다음 화면으로 들어간다는 표시 */
  chevron?: boolean;
  selected?: boolean;
  danger?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** 길게 누르기(터치) — 좌표를 받아 메뉴를 연다. 있으면 iOS 글자 선택을 막는다 */
  onLongPress?: (x: number, y: number) => void;
  /** 제목을 두 줄까지 허용(긴 파일 이름) */
  wrap?: boolean;
  /** 눌리지 않는 행(값만 보여 주는 줄) */
  as?: 'button' | 'div';
  className?: string;
};

// 묶음 카드(Group)의 한 행 — 아이콘 · 제목/둘째 줄 · 오른쪽 값 · ›. 터치 44px 이상.
// 행 안에 "…" 단추를 두지 않는다: 누르기=열기, 길게 누르기=메뉴, 옆으로 밀기=빠른 동작 (폰 A안 규칙)
export default function GroupRow({ icon, tint, iconClass = 'text-slate-400', title, subtitle, right, chevron = false, selected = false, danger = false, onClick, onContextMenu, onLongPress, wrap = false, as, className = '' }: Props) {
  const lp = useLongPress(onLongPress);
  const Tag = as ?? (onClick ? 'button' : 'div');
  const hasIcon = icon !== undefined;
  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      onClick={() => {
        if (lp.consume()) return; // 길게 누른 뒤 손을 떼며 생기는 클릭은 삼킨다
        onClick?.();
      }}
      onContextMenu={onContextMenu}
      {...lp.handlers}
      className={`dv-row relative flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition select-none touch-callout-none ${
        hasIcon ? '[--row-inset:58px]' : '[--row-inset:16px]'
      } ${selected ? 'bg-slate-800/60' : onClick ? 'active:bg-slate-800/40 pc:hover:bg-slate-800/30' : ''} ${danger ? 'text-danger-400' : 'text-slate-100'} ${className}`}
    >
      {hasIcon && (
        <span className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] ${tint ? TINT[tint] : iconClass}`}>{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] leading-snug ${wrap ? '' : 'truncate'}`}>{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-slate-500">{subtitle}</span>}
      </span>
      {(right || chevron) && (
        <span className="flex shrink-0 items-center gap-2 text-sm text-slate-500">
          {right}
          {chevron && <Icon name="chevron" size={16} className="-mr-1 text-slate-600" />}
        </span>
      )}
    </Tag>
  );
}
