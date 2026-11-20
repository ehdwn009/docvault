import type { ReactNode } from 'react';

type Props = {
  /** 그 탭의 목록(회차 목록, 최신 호 카드와 지난 호) */
  list: ReactNode;
  /** 고른 것을 읽는 칸 — 없으면 아직 고르지 않은 것 */
  reader: ReactNode | null;
  /** 접은 폰처럼 좁으면 한 열 — 읽는 칸이 목록을 덮는다 */
  narrow: boolean;
  /** 넓은 화면에서 아직 고른 것이 없을 때 읽는 칸에 보일 말 */
  empty: string;
  /** 읽는 칸이 아래 바 밑까지 깔려 있다(터치에서 읽는 중) — 넓은 화면의 목록 열은 바에 가리지 않게 바닥을 비운다 */
  underBar?: boolean;
};

/** 넓은 화면의 목록 열 너비 — 아래 바의 탭 칸(Workspace)도 이 값을 써서 세로 선이 이어진다.
 *  기본은 폭의 42%(300~400px). 창이 1228px 이상이면 읽는 칸에 880px를 먼저 내준다 — 회차 화면이 두 칸(목록 + 기사)이 되는 폭이라서
 *  (BriefingView WIDE_MIN_PX). 1228 = PC 레일 48 + 목록 최소 300 + 880. 1280px 화면에서 회차가 한 칸으로 줄지 않게 */
export const CHANNEL_LIST_WIDTH = 'w-[min(400px,max(300px,42%))] min-[1228px]:w-[clamp(300px,calc(100%-880px),400px)]';

// 브리핑·동향 탭의 뼈대 — 넓으면 "왼쪽 목록 | 오른쪽 읽는 칸", 좁으면 읽는 칸이 목록 위에 열린다.
// 회차·정리본이 문서 탭으로 넘어가 열리던 것을 그 탭 안에서 열리게 한다 (IA — 탭 안의 읽는 칸 2026-11-20)
export default function ChannelSplit({ list, reader, narrow, empty, underBar = false }: Props) {
  if (narrow) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* 목록은 지우지 않고 가려 둔다 — 읽고 돌아왔을 때 스크롤 자리와 불러온 내용이 그대로.
            display:none이 아니라 invisible인 이유: 브라우저에 따라 display:none은 스크롤 자리를 잃는다 */}
        <div className={`flex min-h-0 flex-1 flex-col ${reader ? 'invisible' : ''}`}>{list}</div>
        {reader && <div className="absolute inset-0 flex flex-col bg-slate-950">{reader}</div>}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1">
      <div className={`flex min-h-0 ${CHANNEL_LIST_WIDTH} shrink-0 flex-col border-r border-slate-800 ${underBar ? 'pb-[var(--tab-bar-h)]' : ''}`}>{list}</div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {reader ?? <p className="m-auto px-6 text-center text-sm text-slate-600">{empty}</p>}
      </div>
    </div>
  );
}
