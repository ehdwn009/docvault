import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 터치 기기의 크롬(헤더·하단 도구막대·드로어 버튼·HTML 문서 상자) 접힘 — 진행도 하나(0=펼침, 1=접힘)로
 * 여러 요소를 함께 움직인다 (IA — 크롬 추종).
 *
 * 스크롤 보고는 프레임마다 온다. 그걸 React 상태로 들면 프레임마다 리렌더가 나서 스크롤이 먼저 끊기므로,
 * 여기서는 진행도를 모듈 변수로 들고 등록된 요소의 transform을 **DOM에 직접** 쓴다. React가 알아야 하는 건
 * 안착한 뒤의 켜짐/꺼짐뿐이라(aria·pointer-events) 그것만 useChromeHidden으로 내보낸다.
 * 모듈 변수여도 되는 이유: 크롬은 화면에 하나뿐이고, PC에서는 등록되는 요소가 없어 아무 일도 안 한다.
 */

/** 헤더 높이 — 진행도 1에 이르는 스크롤 거리이자 HTML 문서 상자를 밀어 두는 거리. 본문의 touch:pt-14와 같은 값 */
export const CHROME_HEIGHT = 56;
/** 문서 맨 위 근처에서는 항상 펼친다 */
const NEAR_TOP = 48;
/** 손을 뗀 뒤 스크롤 보고가 이만큼 없으면 가까운 쪽으로 붙인다 (ms) */
const SNAP_IDLE = 140;
/** 내려가는 중엔 절반을 넘겨야 접히고, 올라오는 중엔 1/4만 되돌아와도 편다 — 복귀가 더 쉬워야 한다 */
const HIDE_SNAP = 0.5;
const SHOW_SNAP = 0.75;

export type ChromeTarget = {
  /** 접힐 때 움직이는 방향 */
  dir: 'up' | 'down';
  /** 움직이는 거리(px). 없으면 요소 자신의 높이 */
  distance?: number;
  /** 펼쳐졌을 때의 기준 위치(px) — HTML 문서 상자는 헤더만큼 내려가 있다가 접히면 0으로 */
  base?: number;
};

type Registered = ChromeTarget & { el: HTMLElement };

const targets = new Set<Registered>();
const listeners = new Set<(hidden: boolean) => void>();
let progress = 0;
let resting = false;
let lastDir = 0;
let snapTimer: ReturnType<typeof setTimeout> | null = null;

function paintOne(t: Registered, animate: boolean) {
  const d = t.distance ?? t.el.offsetHeight;
  const y = (t.base ?? 0) + (t.dir === 'up' ? -d : d) * progress;
  // 손가락을 따라가는 동안에는 전환을 끈다 — 켜 두면 손보다 늦게 따라와 미끄러지는 느낌이 난다
  t.el.style.transition = animate ? 'transform 200ms ease' : 'none';
  t.el.style.transform = `translateY(${y}px)`;
}

function paint(p: number, animate: boolean) {
  progress = p;
  for (const t of targets) paintOne(t, animate);
}

function settle(hidden: boolean) {
  if (resting === hidden) return;
  resting = hidden;
  for (const cb of listeners) cb(hidden);
}

function clearSnap() {
  if (snapTimer === null) return;
  clearTimeout(snapTimer);
  snapTimer = null;
}

/** 손을 뗀 뒤: 반쯤 접힌 채 두지 않고 가까운 쪽으로 붙인다 — 반만 보이는 목차 버튼은 눌리지도 않는다 */
function snap() {
  snapTimer = null;
  const hide = lastDir < 0 ? progress >= SHOW_SNAP : progress > HIDE_SNAP;
  paint(hide ? 1 : 0, true);
  settle(hide);
}

/** 뷰어가 스크롤 위치를 보고할 때마다 부른다 — 민 만큼 그대로 접히고, 멈추면 붙인다 */
export function reportChromeScroll(y: number, delta: number) {
  clearSnap();
  if (y < NEAR_TOP) {
    paint(0, true);
    settle(false);
    return;
  }
  if (delta === 0) return;
  lastDir = delta > 0 ? 1 : -1;
  paint(Math.min(1, Math.max(0, progress + delta / CHROME_HEIGHT)), false);
  snapTimer = setTimeout(snap, SNAP_IDLE);
}

/** 크롬을 즉시 펼친다 — 문서를 바꾸거나 편집기로 들어갈 때 */
export function showChrome() {
  clearSnap();
  paint(0, true);
  settle(false);
}

/**
 * 요소를 크롬 접힘에 태운다. 돌려주는 ref를 요소에 걸면 된다.
 * null을 주면 태우지 않는다 (PC). ref는 안정적이라 리렌더로 등록이 풀렸다 붙지 않는다 —
 * 풀렸다 붙으면 진행 중인 전환이 끊긴다.
 */
export function useChromeTarget(target: ChromeTarget | null) {
  const unregister = useRef<(() => void) | null>(null);
  const { dir, distance, base } = target ?? {};
  return useCallback(
    (el: HTMLElement | null) => {
      unregister.current?.();
      unregister.current = null;
      if (!el || !dir) return;
      const reg: Registered = { el, dir, distance, base };
      targets.add(reg);
      paintOne(reg, false); // 몰입 모드에서 돌아온 도구막대처럼 늦게 붙는 요소도 현재 진행도에 맞춘다
      unregister.current = () => {
        targets.delete(reg);
        el.style.transform = '';
        el.style.transition = '';
      };
    },
    [dir, distance, base],
  );
}

/** 안착한 상태(접힘/펼침) — 전환 중의 중간값은 알려주지 않는다. aria·pointer-events용 */
export function useChromeHidden(): boolean {
  const [hidden, setHidden] = useState(resting);
  useEffect(() => {
    listeners.add(setHidden);
    setHidden(resting);
    return () => {
      listeners.delete(setHidden);
    };
  }, []);
  return hidden;
}
