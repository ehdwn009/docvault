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
  /** 넓은 화면에서 목록 열을 접는다(읽는 칸이 있을 때만) — 펼친 폰을 세로로 쥐면 읽는 칸이 좁아서 */
  collapsed?: boolean;
};

/** 넓은 화면의 목록 열 너비 — 값은 index.css의 .dv-shell(--channel-list-w)이 정한다. 아래 바(Workspace)도 같은 변수를 쓴다 */
export const CHANNEL_LIST_WIDTH = 'w-[var(--channel-list-w)]';

// 브리핑·동향 탭의 뼈대 — 넓으면 "왼쪽 목록 | 오른쪽 읽는 칸", 좁으면 읽는 칸이 목록 위에 열린다.
// 회차·정리본이 문서 탭으로 넘어가 열리던 것을 그 탭 안에서 열리게 한다 (IA — 탭 안의 읽는 칸 2026-11-20)
export default function ChannelSplit({ list, reader, narrow, empty, underBar = false, collapsed = false }: Props) {
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
      {/* 접어도 지우지 않는다 — 펼쳤을 때 스크롤 자리와 불러온 내용이 그대로 */}
      <div className={`${collapsed && reader ? 'hidden' : 'flex'} min-h-0 ${CHANNEL_LIST_WIDTH} shrink-0 flex-col border-r border-slate-800 ${underBar ? 'pb-[var(--tab-bar-h)]' : ''}`}>{list}</div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {reader ?? <p className="m-auto px-6 text-center text-sm text-slate-600">{empty}</p>}
      </div>
    </div>
  );
}
