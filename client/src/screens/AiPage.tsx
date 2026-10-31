import { useState } from 'react';
import AskPanel from '../components/AskPanel';
import type { TreeFile } from '../lib/api';
import { IS_PC } from '../lib/device';
import CardsPanel from './panels/CardsPanel';

type Tab = 'chat' | 'cards';

type Props = {
  /** 홈의 "최근 대화"에서 고른 대화 — null이면 목록(폰)/새 대화(PC) */
  initialThreadId: number | null;
  onOpenFile: (file: TreeFile) => void;
  onCardDeleted: (id: number) => void;
  onClose: () => void;
  onViewChange: (view: 'list' | 'body') => void;
};

// SCR-189: AI 화면 — 왼쪽 목록 칸 위에 「대화 ｜ 배움 카드」 탭, 오른쪽 본문(대화 SCR-188). 카드를 고르면 뷰어로 연다 (IA — 안 B)
export default function AiPage({ initialThreadId, onOpenFile, onCardDeleted, onClose, onViewChange }: Props) {
  const [tab, setTab] = useState<Tab>('chat');
  const tabs = (
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

  if (tab === 'cards') {
    // 카드 서랍(SCR-181)은 그대로 — 본문은 카드를 고르면 뷰어가 맡는다
    return (
      <div className="flex min-h-0 flex-1">
        <aside className={`flex min-h-0 flex-col ${IS_PC ? 'w-72 shrink-0 border-r border-slate-800' : 'w-full'}`}>
          {tabs}
          <div className="h-2" />
          <CardsPanel selectedId={null} onSelect={onOpenFile} onDeleted={onCardDeleted} />
        </aside>
        {IS_PC && (
          <div className="flex min-w-0 flex-1 items-center justify-center text-sm text-slate-600">카드를 고르면 문서로 열려요</div>
        )}
      </div>
    );
  }
  return (
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
      onClose={onClose}
      onViewChange={onViewChange}
    />
  );
}
