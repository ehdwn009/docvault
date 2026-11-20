import { IS_TOUCH } from '../lib/device';
import { kstToday, longDate } from '../lib/briefing';
import { HomeButton, MeButton } from '../lib/topNav';
import BriefingPanel from './panels/BriefingPanel';

type Props = {
  readOnly: boolean;
  onOpenFile: (fileId: number) => void;
  /** 넓은 화면에서 읽는 칸이 비어 있으면 오늘 회차를 알아서 연다 */
  autoOpen?: boolean;
  /** 옆 읽는 칸에 열려 있는 회차 */
  activeFileId?: number | null;
  onOpenSettings: () => void;
  onOpenSources: () => void;
};

// SCR-192: 브리핑 탭 — 본문 전체. 홈의 작은 회차 줄 대신 오늘 회차를 큰 카드로 열고, 만들기·진행·지난 브리핑·비용·실행 기록이 한 화면에 (IA — 탭 구조 개정 2026-11-20).
// 내용은 브리핑 패널(SCR-190) 그대로 — 이 화면은 머리와 폭만 잡는다
export default function FeedPage({ readOnly, onOpenFile, autoOpen = false, activeFileId = null, onOpenSettings, onOpenSources }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {IS_TOUCH ? (
        <div className="flex items-end gap-2 px-4 pb-2 pt-1">
          <HomeButton />
          {/* 좁은 목록 열(펼친 세로)에서는 제목이 아니라 날짜가 먼저 줄어든다 */}
          <h2 className="shrink-0 text-[30px] font-bold leading-tight tracking-tight">브리핑</h2>
          <span className="mb-2 min-w-0 flex-1 truncate text-right text-xs text-slate-500">{longDate(kstToday())}</span>
          <MeButton />
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-6 py-3">
          <h2 className="text-base font-bold">브리핑</h2>
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">{longDate(kstToday())}</span>
        </div>
      )}
      <div className="flex min-h-0 w-full max-w-2xl flex-1 flex-col pc:px-2">
        <BriefingPanel big readOnly={readOnly} onOpenFile={onOpenFile} autoOpen={autoOpen} activeFileId={activeFileId} onOpenSettings={onOpenSettings} onOpenSources={onOpenSources} />
      </div>
    </div>
  );
}
