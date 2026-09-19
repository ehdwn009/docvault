import type { ReactNode } from 'react';
import { ACTION_WIDTH, useRowSwipe } from '../lib/rowSwipe';

export type SwipeAction = { label: string; danger?: boolean; onAction: () => void };

/** 한 행에 붙는 스와이프 구성 — 목록마다 다르므로 만드는 쪽(Workspace·CardsPanel)이 정한다 */
export type SwipeConfig = {
  /** 왼쪽으로 밀면 오른쪽에서 나온다 (파괴적인 것을 끝에 둔다 — 카톡·메일 앱의 관례) */
  right?: SwipeAction[];
  /** 오른쪽으로 밀면 왼쪽에서 나온다 */
  left?: SwipeAction[];
  /** 끝까지 밀면 트레이를 거치지 않고 바로 실행 — 보통 right의 삭제와 같은 동작 */
  fullSwipe?: SwipeAction;
};

type Props = SwipeConfig & { children: ReactNode };

/**
 * 목록 행을 옆으로 밀면 버튼이 나오게 감싸는 껍데기 (SCR-110·112·120·181 공용).
 *
 * 스와이프는 눈에 보이지 않는 기능이라 **유일한 진입점이 되면 안 된다** — ⋯ 버튼과
 * 우클릭 메뉴는 그대로 두고, 이건 손에 익은 사람을 위한 지름길이다.
 */
export default function SwipeRow({ right = [], left = [], fullSwipe, children }: Props) {
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
          onClick={() => {
            close();
            a.onAction();
          }}
          style={{ width: ACTION_WIDTH }}
          className={`flex items-center justify-center text-[11px] font-medium ${
            a.danger ? 'bg-red-900 text-red-100' : 'bg-slate-800 text-slate-200'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {left.length > 0 && tray(left, 'left')}
      {right.length > 0 && tray(right, 'right')}
      {/* 끝까지 밀면 트레이가 통째로 붉게 차오른다 — 손을 떼면 바로 실행된다는 신호 */}
      {armed && fullSwipe && (
        <div className="absolute inset-0 flex items-center justify-end bg-red-900 pr-4 text-[11px] font-medium text-red-100">
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
        // 트레이가 비쳐 보이지 않게 행은 불투명해야 한다 (bg-slate-950 = 앱 배경, 라이트 테마에서도 같다)
        className={`relative bg-slate-950 ${rowProps.className}`}
      >
        {children}
      </div>
    </div>
  );
}
