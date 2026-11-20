import { useEffect, useState, type ReactNode } from 'react';
import Icon, { type IconName } from '../components/Icon';
import Group from '../components/ui/Group';
import GroupRow from '../components/ui/GroupRow';
import { api, type TradeView } from '../lib/api';
import { BRIEFING_READ_EVENT, kstToday, slotName, type EditionSummary } from '../lib/briefing';
import { IS_TOUCH } from '../lib/device';

type Props = {
  /** 브리핑을 볼 수 있는 계정인가(관리자·열람 계정) — 아니면 수출입 동향 줄만 */
  hasBriefing: boolean;
  onOpenFileById: (id: number) => void;
  onOpenFeed: () => void;
  onOpenTrade: () => void;
};

type Row = { key: string; icon: IconName; title: string; subtitle: string; state: string; stateCls: string; on: () => void };

/** 오늘 회차의 읽음 상태 — 브리핑 탭의 큰 카드와 같은 말 */
function editionState(e: EditionSummary): { text: string; cls: string } {
  if (e.state === 'unread') return { text: '안 읽음', cls: 'text-red-400' };
  if (e.state === 'done') return { text: '다 읽음', cls: 'text-slate-500' };
  return { text: `핵심 ${Math.max(0, e.leadCount - e.leadRead)} 남음`, cls: 'text-slate-400' };
}

// 홈의 「오늘 볼 것」 — 홈에는 요약만 둔다(사용자 결정 2026-11-20). 오늘 브리핑 회차와, 새로 왔거나 기다리는 수출입 동향 한 줄.
// 만들기·진행·비용·지난 회차는 브리핑 탭(SCR-192), 지난 호는 동향 탭(SCR-195)에 있다
export default function HomeDigest({ hasBriefing, onOpenFileById, onOpenFeed, onOpenTrade }: Props) {
  const [editions, setEditions] = useState<EditionSummary[] | null>(null);
  const [trade, setTrade] = useState<TradeView | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (hasBriefing) void api<{ editions: EditionSummary[] }>('/briefing/editions').then((r) => alive && setEditions(r.editions)).catch(() => alive && setEditions([]));
      void api<TradeView>('/trade').then((v) => alive && setTrade(v)).catch(() => {});
    };
    load();
    // 회차를 읽고 돌아오면 읽음 상태가 바로 맞게
    window.addEventListener(BRIEFING_READ_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(BRIEFING_READ_EVENT, load);
    };
  }, [hasBriefing]);

  const today = kstToday();
  const rows: Row[] = [];
  if (hasBriefing && editions) {
    const todays = editions.filter((e) => e.editionDate === today);
    for (const e of todays.slice(0, 3)) {
      const st = editionState(e);
      rows.push({ key: `b${e.fileId}`, icon: 'news', title: `${slotName(e.slot, e.label)} 브리핑`, subtitle: `${e.itemCount}건${e.leadCount > 0 ? ` · 핵심 ${e.leadCount}` : ''}`, state: st.text, stateCls: st.cls, on: () => onOpenFileById(e.fileId) });
    }
    if (todays.length === 0) rows.push({ key: 'b0', icon: 'news', title: '오늘 브리핑이 아직 없어요', subtitle: '브리핑 탭에서 예정과 지난 회차를 봐요', state: '', stateCls: '', on: onOpenFeed });
  }
  if (trade) {
    const p = trade.pending;
    const l = trade.latest;
    const month = (label: string) => label.split(' ')[1];
    if (p && p.state !== 'failed') {
      rows.push({ key: 't-p', icon: 'chart', title: `${month(p.label)} 수출입 동향`, subtitle: p.state === 'waiting' ? '곧 올라와요 · 올라오면 알림이 와요' : '원문 도착 · 해부하는 중', state: p.state === 'waiting' ? '예정' : '만드는 중', stateCls: 'text-slate-500', on: onOpenTrade });
    } else if (l && !l.read) {
      const k = l.card?.kpis[0];
      rows.push({ key: 't-l', icon: 'chart', title: `${month(l.label)} 수출입 동향`, subtitle: k ? `${k.label} ${k.value} ${k.sub[0]?.[0] ?? ''}`.trim() : l.analysisFileId !== null ? '해부가 나왔어요' : '원문 PDF가 올라왔어요', state: '안 읽음', stateCls: 'text-red-400', on: onOpenTrade });
    }
  }
  if (rows.length === 0) return null;

  const title = '오늘 볼 것';
  const right = (r: Row): ReactNode => (r.state ? <span className={`shrink-0 text-xs font-semibold ${r.stateCls}`}>{r.state}</span> : undefined);
  if (IS_TOUCH) {
    return (
      <Group title={title}>
        {rows.map((r) => (
          <GroupRow key={r.key} icon={<Icon name={r.icon} size={21} />} tint="accent" title={r.title} subtitle={r.subtitle} right={right(r)} chevron={!r.state} onClick={r.on} />
        ))}
      </Group>
    );
  }
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold text-slate-200">{title}</h3>
      <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
        {rows.map((r) => (
          <button key={r.key} onClick={r.on} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-slate-900">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-500 text-white">
              <Icon name={r.icon} size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-semibold text-slate-200">{r.title}</span>
              <span className="truncate text-xs text-slate-500">{r.subtitle}</span>
            </span>
            {right(r)}
          </button>
        ))}
      </div>
    </section>
  );
}
