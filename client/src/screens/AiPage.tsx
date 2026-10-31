import { useEffect, useState } from 'react';
import AskPanel from '../components/AskPanel';
import type { TreeFile } from '../lib/api';
import { IS_PC, IS_TOUCH } from '../lib/device';
import CardsPanel from './panels/CardsPanel';

type Tab = 'chat' | 'cards';

type Props = {
  /** 홈의 "최근 대화"에서 고른 대화 — null이면 목록(폰)/새 대화(PC) */
  initialThreadId: number | null;
  onOpenFile: (file: TreeFile) => void;
  onCardDeleted: (id: number) => void;
  onClose: () => void;
  /** 폰 1단계에서 탭 바를 숨기는 데 썼다 — 2단계(바 하나)부터는 안 쓴다 */
  onViewChange?: (view: 'list' | 'body') => void;
  /** 홈의 복습 띠에서 들어오면 배움 카드 탭 */
  initialTab?: Tab;
  /** 탭 재탭 — 대화 목록(뿌리)으로 */
  listSignal?: number;
  /** 두 열(PC·펼친 폰) */
  twoColumn?: boolean;
  /** 탭이 바뀌면 부모가 기억한다 — 문서를 열었다 ‹로 돌아올 때 같은 탭으로 */
  onTabChange?: (tab: Tab) => void;
};

// SCR-189: AI 화면 — 왼쪽 목록 칸 위에 「대화 ｜ 배움 카드」 탭, 오른쪽 본문(대화 SCR-188). 카드를 고르면 뷰어로 연다 (IA — 안 B)
export default function AiPage({ initialThreadId, onOpenFile, onCardDeleted, onClose, onViewChange, initialTab = 'chat', listSignal = 0, twoColumn = IS_PC, onTabChange }: Props) {
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    onTabChange?.(t);
  };
  useEffect(() => {
    if (listSignal > 0) setTab('chat');
  }, [listSignal]);
  // 폰 A안: 아이폰 분절 컨트롤(채운 홈 안에 흰 알약) — PC는 그대로
  const tabs = IS_TOUCH ? (
    <div className="mx-4 mb-1 mt-1 grid grid-cols-2 rounded-lg bg-fill p-0.5" role="tablist">
      {(
        [
          ['chat', '대화'],
          ['cards', '배움 카드'],
        ] as [Tab, string][]
      ).map(([t, label]) => (
        <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-9 rounded-md text-sm transition ${tab === t ? 'bg-panel font-semibold text-slate-100 shadow-sm' : 'text-slate-400'}`}>
          {label}
        </button>
      ))}
    </div>
  ) : (
    <div className="flex gap-1 px-3 pt-2" role="tablist">
      {(
        [
          ['chat', '대화'],
          ['cards', '배움 카드'],
        ] as [Tab, string][]
      ).map(([t, label]) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          onClick={() => setTab(t)}
          className={`min-h-9 rounded-md px-3 text-sm transition touch:min-h-11 ${tab === t ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // 대화는 탭을 오가도 내리지 않는다 — 내리면 생성 중인 답이 끊기고 보던 대화·쓰던 초안이 사라진다 (검수 2026-10-31)
  return (
    <>
      <div className={tab === 'chat' ? 'contents' : 'hidden'}>
        <AskPanel
          file={null}
          page
          listTop={tabs}
          initialThreadId={initialThreadId}
          seed={null}
          pendingQuote={null}
          onConsumePendingQuote={() => {}}
          onOpenFile={onOpenFile}
          isPc={IS_PC}
          twoColumn={twoColumn}
          listSignal={listSignal}
          onClose={onClose}
          onViewChange={onViewChange}
        />
      </div>
      {tab === 'cards' && (
        // 카드 서랍(SCR-181)은 그대로 — 본문은 카드를 고르면 뷰어가 맡는다
        <div className="flex min-h-0 flex-1">
          <aside className={`flex min-h-0 flex-col ${twoColumn ? 'w-72 shrink-0 border-r border-slate-800' : 'w-full'}`}>
            {IS_TOUCH && (
              <div className="flex items-end gap-2 px-4 pb-1 pt-1">
                <h1 className="min-w-0 flex-1 truncate text-[30px] font-bold leading-tight tracking-tight">AI</h1>
              </div>
            )}
            {tabs}
            <div className="h-2" />
            <CardsPanel selectedId={null} onSelect={onOpenFile} onDeleted={onCardDeleted} />
          </aside>
          {twoColumn && <div className="flex min-w-0 flex-1 items-center justify-center text-sm text-slate-600">카드를 고르면 문서로 열려요</div>}
        </div>
      )}
    </>
  );
}
