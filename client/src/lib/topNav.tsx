import { createContext, useContext } from 'react';
import Icon from '../components/Icon';

// 폰의 홈·나 단추 — 아래 탭이 문서·브리핑·동향·AI가 되면서 홈과 「나」는 각 화면 머리로 올라왔다 (IA — 탭 구조 개정 2026-11-20).
// 머리는 화면마다 제 컴포넌트가 그리므로(홈·문서·AI·브리핑·동향·나) 단추를 한 벌로 두고 문맥으로 잇는다.
// 문맥이 없으면(이전 레이아웃·PC) 아무것도 그리지 않는다 — PC는 레일이 맡는다

type TopNav = { goHome: () => void; openMe: () => void };
export const TopNavContext = createContext<TopNav | null>(null);

const circle = 'mb-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fill active:opacity-70';

/** 머리 왼쪽 — 홈으로. 홈 화면 자신은 그리지 않는다 */
export function HomeButton() {
  const nav = useContext(TopNavContext);
  if (!nav) return null;
  return (
    <button onClick={nav.goHome} className={`${circle} text-accent-400`} aria-label="홈으로">
      <Icon name="home" size={19} />
    </button>
  );
}

/** 머리 오른쪽 — 나(설정) */
export function MeButton() {
  const nav = useContext(TopNavContext);
  if (!nav) return null;
  return (
    <button onClick={nav.openMe} className={`${circle} text-slate-200`} aria-label="나 (설정)">
      <Icon name="user" size={19} />
    </button>
  );
}
