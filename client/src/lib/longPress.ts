import { useRef, type TouchEvent as ReactTouchEvent } from 'react';

/**
 * 길게 누르기(터치) — 행을 ~0.45초 누르고 있으면 메뉴를 연다 (폰 A안 2026-10-31: 행의 "…" 단추를 없앤 대신).
 *
 * iOS 사파리는 긴 누름에 contextmenu 이벤트를 내지 않아 직접 재야 한다. 스크롤·옆으로 밀기와 손가락을
 * 나눠 쓰므로, 처음 자리에서 몇 px 이상 움직이면 길게 누르기는 포기한다(rowSwipe.ts의 AXIS_SLOP과 같은 생각).
 * 메뉴가 뜬 뒤 손을 떼며 생기는 click은 consume()으로 한 번 삼킨다 — 안 그러면 메뉴와 함께 문서가 열린다.
 */
const HOLD_MS = 450;
const MOVE_SLOP = 8;

export function useLongPress(onLongPress?: (x: number, y: number) => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  };

  const handlers = onLongPress
    ? {
        onTouchStart: (e: ReactTouchEvent) => {
          const t = e.touches[0];
          if (!t || e.touches.length > 1) return;
          fired.current = false;
          start.current = { x: t.clientX, y: t.clientY };
          timer.current = window.setTimeout(() => {
            timer.current = null;
            if (!start.current) return;
            fired.current = true;
            onLongPress(start.current.x, start.current.y);
            start.current = null;
          }, HOLD_MS);
        },
        onTouchMove: (e: ReactTouchEvent) => {
          const t = e.touches[0];
          if (!t || !start.current) return;
          if (Math.abs(t.clientX - start.current.x) > MOVE_SLOP || Math.abs(t.clientY - start.current.y) > MOVE_SLOP) cancel();
        },
        onTouchEnd: (e: ReactTouchEvent) => {
          // 메뉴가 뜬 뒤 손을 떼면 브라우저가 그 자리에 click을 합성한다 — 시트의 항목이 눌려 버렸다(검수). touchend를 막으면 합성 click도 없다
          if (fired.current) e.preventDefault();
          cancel();
        },
        onTouchCancel: cancel,
      }
    : {};

  /** 길게 눌러 메뉴가 떴으면 true를 한 번 돌려주고 지운다 — 뒤따르는 click을 무시하라는 뜻 */
  const consume = () => {
    const was = fired.current;
    fired.current = false;
    return was;
  };

  return { handlers, consume };
}
