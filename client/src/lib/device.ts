import { useEffect, useState } from 'react';
import { WINDOW_CLASS_DEBOUNCE_MS, WINDOW_WIDE_MIN_H, WINDOW_WIDE_MIN_W, WINDOW_XWIDE_MIN_W } from './constants';

// 기기 판정 한 곳 — CSS의 pc:/touch: 변형(index.css)과 같은 질문을 JS에서도 한다.
// 화면 너비가 아니라 "입력 방식"으로 가른다: 폰을 눕혀 넓어져도 터치 기기면 터치 UI를 유지.
// 기기 특성이라 실행 중 안 바뀌므로 한 번만 잰다 (IA — 모바일 재편).

const PC_QUERY = '(hover: hover) and (pointer: fine)';

/** 터치 기기(폰·태블릿)인가 */
export const IS_TOUCH = !window.matchMedia(PC_QUERY).matches;

/** 마우스·트랙패드 기기인가 — 문서 안 스크립트처럼 문자열로 심어야 할 때는 PC_MEDIA_QUERY를 쓴다 */
export const IS_PC = !IS_TOUCH;

export const PC_MEDIA_QUERY = PC_QUERY;

/** 창 너비가 px 이상인가 — 레이아웃 판정(기기 판정과 달리 실행 중 바뀐다) */
export function useMinWidth(px: number): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(`(min-width: ${px}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [px]);
  return matches;
}

/** 창 등급 — 폭 기준(기기 무관). CSS의 narrow:/wide: 변형(index.css)과 같은 식. 접고 펼 때 resize로 바뀌므로 훅이다 */
export type WindowClass = 'narrow' | 'wide' | 'xwide';
export const WIDE_QUERY = `(min-width: ${WINDOW_WIDE_MIN_W}px) and (min-height: ${WINDOW_WIDE_MIN_H}px)`;
export const XWIDE_QUERY = `(min-width: ${WINDOW_XWIDE_MIN_W}px) and (min-height: ${WINDOW_WIDE_MIN_H}px)`;
function readWindowClass(): WindowClass {
  if (window.matchMedia(XWIDE_QUERY).matches) return 'xwide';
  if (window.matchMedia(WIDE_QUERY).matches) return 'wide';
  return 'narrow';
}
export function useWindowClass(): WindowClass {
  const [wc, setWc] = useState<WindowClass>(readWindowClass);
  useEffect(() => {
    let timer = 0;
    // 접는 기기는 펴는 동안 중간 크기를 잠깐 거친다 — 그 값으로 레이아웃을 바꾸지 않게 잠시 기다린다
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWc(readWindowClass()), WINDOW_CLASS_DEBOUNCE_MS);
    };
    const a = window.matchMedia(WIDE_QUERY);
    const b = window.matchMedia(XWIDE_QUERY);
    a.addEventListener('change', onChange);
    b.addEventListener('change', onChange);
    return () => {
      a.removeEventListener('change', onChange);
      b.removeEventListener('change', onChange);
      window.clearTimeout(timer);
    };
  }, []);
  return wc;
}
