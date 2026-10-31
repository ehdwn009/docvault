import type { ReactNode } from 'react';
import { ACTION_WIDTH, useRowSwipe } from '../lib/rowSwipe';
import Icon, { type IconName } from './Icon';

/** tone: 트레이 단추 색 — warn(즐겨찾기 같은 표시), accent(이동·태그), 없으면 회색. danger는 붉은색 */
export type SwipeAction = { label: string; danger?: boolean; tone?: 'warn' | 'accent'; icon?: IconName; onAction: () => void };

/** 한 행에 붙는 스와이프 구성 — 목록마다 다르므로 만드는 쪽(Workspace·CardsPanel)이 정한다 */
export type SwipeConfig = {
  /** 왼쪽으로 밀면 오른쪽에서 나온다 (파괴적인 것을 끝에 둔다 — 카톡·메일 앱의 관례) */
  right?: SwipeAction[];
  /** 오른쪽으로 밀면 왼쪽에서 나온다 */
  left?: SwipeAction[];
  /** 끝까지 밀면 트레이를 거치지 않고 바로 실행. 삭제처럼 되돌리기 어려운 동작에는 걸지 않는다 —
      스크롤하다 옆으로 밀린 손가락이 파일을 지웠다 (사용성 평가 2026-10-01) */
  fullSwipe?: SwipeAction;
};

type Props = SwipeConfig & {
  children: ReactNode;
  /** 행이 놓인 표면 — 트레이가 비치지 않게 행은 불투명해야 한다. 묶음 카드(Group) 안이면 panel */
  surface?: 'ground' | 'panel';
};

/**
 * 목록 행을 옆으로 밀면 버튼이 나오게 감싸는 껍데기 (SCR-110·112·120·181 공용).
 *
 * 스와이프는 눈에 보이지 않는 기능이라 **유일한 진입점이 되면 안 된다** — ⋯ 버튼과
 * 우클릭 메뉴는 그대로 두고, 이건 손에 익은 사람을 위한 지름길이다.
 */
export default function SwipeRow({ right = [], left = [], fullSwipe, children, surface = 'ground' }: Props) {
  const rightWidth = right.length * ACTION_WIDTH;
  const leftWidth = left.length * ACTION_WIDTH;
  const { dx, dragging, armed, open, close, containerRef, rowProps } = useRowSwipe({
    rightWidth,
    leftWidth,
    onFullSwipe: fullSwipe ? () => fullSwipe.onAction() : undefined,
  });

  if (rightWidth === 0 && leftWidth === 0) return <>{children}</>;

  const tray = (actions: SwipeAction[], side: 'left' | 'right') => (
    // 클래스 이름을 문자열로 조립하면 Tailwind가 못 찾는다 — 양쪽을 통째로 적는다
    <div
      className={`absolute inset-y-0 flex ${side === 'left' ? 'left-0' : 'right-0'}`}
      style={{ width: actions.length * ACTION_WIDTH }}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          // 닫힌 트레이의 버튼은 보이지 않으니 Tab 순서에서도 뺀다 — 키보드 포커스가 화면에서 사라졌다
          tabIndex={open ? 0 : -1}
          onClick={() => {
            close();
            a.onAction();
          }}
          style={{ width: ACTION_WIDTH }}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            a.danger ? 'bg-danger-600 text-white' : a.tone === 'warn' ? 'bg-warn-500 text-white' : a.tone === 'accent' ? 'bg-accent-600 text-white' : 'bg-slate-700 text-slate-100'
          }`}
        >
          {a.icon && <Icon name={a.icon} size={18} />}
          {a.label}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {/* 트레이는 밀기 시작해야 그린다 — 가만히 있을 때 둥근 카드 모서리로 붉은 트레이가 비쳤다 (폰 A안 검수) */}
      {(dx !== 0 || open) && left.length > 0 && tray(left, 'left')}
      {(dx !== 0 || open) && right.length > 0 && tray(right, 'right')}
      {/* 끝까지 밀면 트레이가 통째로 붉게 차오른다 — 손을 떼면 바로 실행된다는 신호 */}
      {armed && fullSwipe && (
        <div className="absolute inset-0 flex items-center justify-end bg-danger-600 pr-4 text-[11px] font-medium text-white">
          {fullSwipe.label}
        </div>
      )}
      <div
        {...rowProps}
        // 열려 있을 때의 첫 탭은 행을 여는 대신 트레이를 닫는다 (실수로 문서가 열리지 않게)
        onClickCapture={(e) => {
          if (!open) return;
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 160ms ease-out',
        }}
        // 트레이가 비쳐 보이지 않게 행은 불투명해야 한다 — 표면색은 놓인 자리(앱 바탕/묶음 카드)를 따른다
        className={`relative ${surface === 'panel' ? 'bg-panel' : 'bg-ground'} ${rowProps.className}`}
      >
        {children}
      </div>
    </div>
  );
}
