import { useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';

/** 이만큼 끌어내리면 놓는 순간 닫는다 */
const CLOSE_DISTANCE = 90;
/** 짧게 튕겨도 닫히게 — px/ms. 거리가 모자라도 빠르면 닫을 뜻으로 본다 */
const CLOSE_VELOCITY = 0.5;
/** 위로 끌 때는 고무줄처럼 조금만 따라온다 (시트는 위로 더 열리지 않는다) — 펼치기를 지원하는 시트는 예외 */
const RUBBER = 4;
/** 이만큼 끌어올리면 놓는 순간 펼친다 (onExpand가 있는 시트만) */
const EXPAND_DISTANCE = 60;

/**
 * 바텀 시트를 손가락으로 끌어 내려 닫는 제스처 (IA — 바텀 시트 통일).
 *
 * 시트마다 알약 손잡이를 그려 두고 있었는데 **장식일 뿐 아무 동작이 없었다** — 손잡이는
 * "끌 수 있다"는 약속이라, 그려 놓고 안 되면 없느니만 못하다. 이 훅이 그 약속을 이행한다.
 *
 * 손잡이에만 거는 이유: 시트 본문은 세로로 스크롤되므로(overflow-y-auto) 본문에 걸면
 * 스크롤과 끌기가 같은 손가락을 두고 다툰다. 손잡이는 스크롤할 것이 없는 자리라 안 다툰다.
 */
export function useSheetDrag(onClose: () => void, onExpand?: () => void) {
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  // 브라우저가 제스처를 가로채면 touchend 대신 touchcancel이 온다 — 그때 쓸 마지막 좌표를 들고 있는다
  const startRef = useRef<{ y: number; t: number; lastY: number } | null>(null);

  const finish = (endY: number) => {
    const s = startRef.current;
    startRef.current = null;
    setDragging(false);
    setDy(0);
    if (!s) return;
    const moved = endY - s.y;
    const speed = moved / Math.max(1, Date.now() - s.t);
    if (moved > CLOSE_DISTANCE || (moved > 16 && speed > CLOSE_VELOCITY)) onClose();
    // 위로 충분히(또는 빠르게) 끌어올리면 펼친다 — 손잡이는 "끌 수 있다"는 약속이라 양방향이어야 자연스럽다
    else if (onExpand && (moved < -EXPAND_DISTANCE || (moved < -16 && -speed > CLOSE_VELOCITY))) onExpand();
  };

  /** 손잡이에 펼쳐 넣을 속성들 */
  const handleProps = {
    // touch-none: 안 걸면 브라우저가 이 끌기를 스크롤로 가로채 touchcancel로 끊어 버린다
    className: 'touch-none',
    onTouchStart: (e: ReactTouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startRef.current = { y: t.clientY, t: Date.now(), lastY: t.clientY };
      setDragging(true);
    },
    onTouchMove: (e: ReactTouchEvent) => {
      const t = e.touches[0];
      const s = startRef.current;
      if (!t || !s) return;
      s.lastY = t.clientY;
      const d = t.clientY - s.y;
      // 펼칠 수 있는 시트는 위로도 1:1로 따라온다 — 고무줄이면 "더 열리지 않는다"는 신호가 된다
      setDy(d > 0 || onExpand ? d : d / RUBBER);
    },
    onTouchEnd: (e: ReactTouchEvent) => finish(e.changedTouches[0]?.clientY ?? startRef.current?.lastY ?? 0),
    onTouchCancel: () => finish(startRef.current?.lastY ?? 0),
  };

  /** 시트 바깥 상자에 얹을 스타일 — 끄는 동안에는 전환을 끈다(손가락을 그대로 따라가야 한다) */
  const sheetStyle = {
    transform: dy ? `translateY(${dy}px)` : undefined,
    transition: dragging ? 'none' : 'transform 200ms ease-out',
  };

  return { handleProps, sheetStyle };
}
