import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';

/**
 * 목록 행을 손가락으로 옆으로 밀어 버튼 트레이를 여는 제스처 (카톡 채팅 목록과 같은 결).
 *
 * 세로 스크롤과 같은 손가락을 두고 다투므로, 처음 몇 px으로 **가로인지 세로인지 먼저 정하고**
 * 가로일 때만 행을 움직인다. 세로로 정해지면 끝까지 스크롤에 양보한다 (한 번 정한 방향은
 * 그 끌기가 끝날 때까지 안 바꾼다 — 중간에 바뀌면 손에 들러붙는 느낌이 난다).
 *
 * 바텀 시트의 `sheetDrag.ts`와 같은 자리의 코드지만, 저쪽은 세로 한 방향 + 닫기 하나라
 * 합치면 양쪽 다 읽기 어려워진다. 상수 이름과 흐름만 맞춰 둔다.
 */

/** 트레이 버튼 하나의 너비(px) — SwipeRow가 그리는 버튼 너비와 반드시 같아야 한다 */
export const ACTION_WIDTH = 64;
/** 행 너비의 이 비율을 넘겨 밀면, 손을 떼는 순간 트레이를 거치지 않고 바로 실행한다 */
const FULL_RATIO = 0.55;
/** 트레이 너비의 이 비율을 넘겨 밀면 놓아도 열린 채로 둔다 */
const OPEN_RATIO = 0.4;
/** 가로·세로 중 어느 쪽 끌기인지 정하기 전에 기다리는 거리 */
const AXIS_SLOP = 8;
/** 트레이가 없는 쪽으로 밀면 고무줄처럼 조금만 따라온다 — "이쪽은 없다"는 신호 */
const RUBBER = 5;
const RUBBER_MAX = 16;

/** 다른 행이 열렸음을 알리는 창 이벤트 — 한 번에 한 행만 열려 있게 한다 */
const OPEN_EVENT = 'dv:row-swipe-open';
let seq = 0;

type Start = { x: number; y: number; base: number; axis: 'x' | 'y' | null };

type Options = {
  /** 왼쪽으로 밀 때 오른쪽에서 나오는 트레이 너비(px). 0이면 그 방향은 잠긴다 */
  rightWidth: number;
  /** 오른쪽으로 밀 때 왼쪽에서 나오는 트레이 너비(px) */
  leftWidth: number;
  /** 끝까지 밀었을 때 실행할 동작 — 없으면 트레이 너비까지만 열린다 */
  onFullSwipe?: () => void;
};

export function useRowSwipe({ rightWidth, leftWidth, onFullSwipe }: Options) {
  const hasFullSwipe = onFullSwipe !== undefined;
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = ++seq;

  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  // 상태는 렌더용, ref는 판정용 — 손을 뗄 때는 마지막 렌더가 아니라 마지막 좌표로 판단해야 한다
  const dxRef = useRef(0);
  const armedRef = useRef(false);
  const rowWidthRef = useRef(0);
  const startRef = useRef<Start | null>(null);
  /** 행 + 트레이를 감싼 껍데기 — 바깥을 눌렀는지 판단하는 기준 */
  const containerRef = useRef<HTMLDivElement | null>(null);

  const setDelta = (v: number) => {
    dxRef.current = v;
    setDx(v);
    armedRef.current = hasFullSwipe && rowWidthRef.current > 0 && -v > rowWidthRef.current * FULL_RATIO;
    setArmed(armedRef.current);
  };

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<number>).detail !== idRef.current) setDelta(0);
    };
    window.addEventListener(OPEN_EVENT, onOther);
    return () => window.removeEventListener(OPEN_EVENT, onOther);
  }, []);

  // 열어 둔 채 다른 곳을 누르거나 목록을 굴리면 닫는다 — 열린 행이 남아 있으면 다음 탭이 엉뚱하게 먹힌다
  useEffect(() => {
    if (dx === 0) return;
    const onOutside = (e: Event) => {
      const el = containerRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setDelta(0);
    };
    const onScroll = () => setDelta(0);
    window.addEventListener('touchstart', onOutside, true);
    window.addEventListener('mousedown', onOutside, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('touchstart', onOutside, true);
      window.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [dx]);

  const clamp = (next: number) => {
    if (next < 0) {
      if (rightWidth === 0) return -Math.min(RUBBER_MAX, -next / RUBBER);
      return Math.max(next, hasFullSwipe ? -rowWidthRef.current : -(rightWidth + RUBBER_MAX));
    }
    if (leftWidth === 0) return Math.min(RUBBER_MAX, next / RUBBER);
    return Math.min(next, leftWidth + RUBBER_MAX);
  };

  const rowProps = {
    // touch-pan-y: 세로 스크롤은 브라우저에 맡기고 가로 끌기만 우리가 받는다.
    // 안 걸면 브라우저가 가로 끌기를 제스처로 가로채 touchcancel로 끊어 버린다
    className: 'touch-pan-y',
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => {
      const t = e.touches[0];
      if (!t) return;
      rowWidthRef.current = e.currentTarget.clientWidth;
      startRef.current = { x: t.clientX, y: t.clientY, base: dxRef.current, axis: null };
    },
    onTouchMove: (e: ReactTouchEvent<HTMLElement>) => {
      const s = startRef.current;
      const t = e.touches[0];
      if (!s || !t) return;
      const mx = t.clientX - s.x;
      const my = t.clientY - s.y;
      if (s.axis === null) {
        if (Math.abs(mx) < AXIS_SLOP && Math.abs(my) < AXIS_SLOP) return;
        s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (s.axis === 'x') {
          setDragging(true);
          window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: idRef.current }));
        }
      }
      if (s.axis !== 'x') return;
      setDelta(clamp(s.base + mx));
    },
    onTouchEnd: () => {
      const s = startRef.current;
      startRef.current = null;
      setDragging(false);
      if (!s || s.axis !== 'x') return;
      if (armedRef.current) {
        setDelta(0);
        onFullSwipe?.();
        return;
      }
      const v = dxRef.current;
      if (rightWidth > 0 && v <= -rightWidth * OPEN_RATIO) setDelta(-rightWidth);
      else if (leftWidth > 0 && v >= leftWidth * OPEN_RATIO) setDelta(leftWidth);
      else setDelta(0);
    },
    onTouchCancel: () => {
      startRef.current = null;
      setDragging(false);
      setDelta(0);
    },
  };

  return { dx, dragging, armed, open: dx !== 0, close: () => setDelta(0), containerRef, rowProps };
}
