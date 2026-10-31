import { createContext, useContext, useEffect } from 'react';

/**
 * 폰의 아래 바 하나(안 ㄴ, 2026-10-31 사용자 결정) — 바의 "슬롯"에 열린 화면의 도구가 들어간다.
 *
 * 바는 Workspace가 하나만 그린다. 접은 폰은 탭 넷 또는 슬롯(‹ + 문서 도구막대 / ‹ + 대화 입력줄) 중 하나,
 * 펼친 폰은 왼쪽 탭 넷(목록 열 너비) + 오른쪽 슬롯. 뷰어·대화 패널은 자기 도구를 `createPortal`로 슬롯에 그리고,
 * 슬롯을 "쓰고 있다"는 사실만 claim으로 알린다 — Workspace는 그 수로 탭을 보일지 슬롯을 보일지 정한다.
 * ReactNode를 상태로 올리지 않는 이유: 도구막대는 렌더마다 새 노드라 상태로 들면 무한 렌더가 난다.
 */
type Slot = {
  /** 포털 대상. 바가 아직 안 그려졌으면 null */
  el: HTMLElement | null;
  /** 슬롯을 쓰기 시작한다 — 돌려주는 함수로 놓는다 */
  claim: () => () => void;
};

export const BottomSlotContext = createContext<Slot | null>(null);

/** 활성인 동안 슬롯을 잡고 포털 대상을 돌려준다. 바가 없는 곳(PC)에서는 늘 null */
export function useBottomSlot(active: boolean): HTMLElement | null {
  const ctx = useContext(BottomSlotContext);
  useEffect(() => {
    if (!active || !ctx) return;
    return ctx.claim();
  }, [active, ctx]);
  return active && ctx ? ctx.el : null;
}
