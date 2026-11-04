import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Notification } from '../lib/api';
import { formatDateTime } from '../lib/date';
import { IS_TOUCH } from '../lib/device';
import { pushLayer } from '../lib/layers';
import Icon, { type IconName } from './Icon';
import Group from './ui/Group';
import GroupRow from './ui/GroupRow';

// SCR-103 알림함 (알림 설계 2026-11-04, 1단계): PC는 레일의 종 옆에 뜨는 작은 창, 폰은 홈의 종에서 들어오는 전체 화면 층.
// 둘 다 같은 목록을 그린다 — 오늘 · 어제 · 그 전으로 묶고, 안 읽은 줄은 점과 옅은 바탕으로.

type Props = {
  items: Notification[];
  unread: number;
  onClose: () => void;
  /** 누르면 읽음 처리 + 그 사건의 자리로 (회차 문서, 없으면 브리핑 패널) */
  onOpen: (n: Notification) => void;
  onReadAll: () => void;
  /** 톱니 — 설정 › 알림(SCR-406)으로 */
  onOpenSettings: () => void;
};

const KIND_ICON: Record<Notification['kind'], { icon: IconName; tint: 'accent' | 'warn' | 'good' }> = {
  briefing_ready: { icon: 'news', tint: 'accent' },
  briefing_missing: { icon: 'info', tint: 'warn' },
  upload_done: { icon: 'upload', tint: 'good' },
  export_done: { icon: 'download', tint: 'good' },
};

function dayKey(ms: number, now: Date): '오늘' | '어제' | '그 전' {
  const d = new Date(ms);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return '오늘';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  return sameDay(d, y) ? '어제' : '그 전';
}

function groupByDay(items: Notification[]): [string, Notification[]][] {
  const now = new Date();
  const map = new Map<string, Notification[]>();
  for (const n of items) {
    const k = dayKey(n.createdAt, now);
    (map.get(k) ?? map.set(k, []).get(k)!).push(n);
  }
  return [...map.entries()];
}

function Rows({ items, onOpen }: { items: Notification[]; onOpen: (n: Notification) => void }) {
  return (
    <>
      {items.map((n) => {
        const k = KIND_ICON[n.kind];
        const unread = n.readAt === null;
        return (
          <GroupRow
            key={n.id}
            icon={<Icon name={k.icon} size={16} />}
            tint={k.tint}
            title={
              <span className={`flex items-center gap-2 ${unread ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>
                {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" aria-label="안 읽음" />}
                <span className="min-w-0 truncate">{n.title}</span>
              </span>
            }
            subtitle={
              <span className="block">
                {n.body && <span className="block truncate">{n.body}</span>}
                <span className="text-slate-500">{formatDateTime(n.createdAt)}</span>
              </span>
            }
            chevron={n.fileId !== null}
            onClick={() => onOpen(n)}
            className={unread ? 'bg-accent-500/5' : ''}
          />
        );
      })}
    </>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-slate-500">
      <Icon name="bell" size={28} className="text-slate-700" />
      <p>아직 알림이 없어요</p>
      <p className="text-xs">브리핑이 도착하거나 만들지 못했을 때, 오래 걸린 올리기가 끝났을 때 여기에 쌓여요</p>
    </div>
  );
}

export default function NotificationCenter({ items, unread, onClose, onOpen, onReadAll, onOpenSettings }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const groups = groupByDay(items);

  // PC: 바깥 클릭·Esc로 닫는다 (ContextMenu와 같은 규칙)
  useEffect(() => {
    if (IS_TOUCH) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 폰: 열린 층 — 뒤로 가기가 이 화면만 닫는다. 한 틱 늦춰 쌓는 이유는 ContextMenu와 같다 (StrictMode 이중 마운트)
  useEffect(() => {
    if (!IS_TOUCH) return;
    let dismiss: (() => void) | null = null;
    const t = window.setTimeout(() => {
      dismiss = pushLayer(onClose);
    }, 0);
    return () => {
      window.clearTimeout(t);
      dismiss?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const readAllButton = (
    <button onClick={onReadAll} disabled={unread === 0} className="min-h-9 rounded-md px-2 text-xs font-semibold text-accent-400 disabled:text-slate-600 touch:min-h-11 touch:text-[15px]">
      모두 읽음
    </button>
  );
  const settingsButton = (
    <button
      onClick={() => {
        onClose();
        onOpenSettings();
      }}
      className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-200 touch:h-10 touch:w-10 touch:rounded-full touch:bg-fill touch:text-slate-200"
      aria-label="알림 설정"
    >
      <Icon name="sliders" size={16} />
    </button>
  );

  if (IS_TOUCH) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-ground pt-[env(safe-area-inset-top)]" role="dialog" aria-label="알림">
        <div className="flex items-center gap-1 px-2 pt-2">
          <button onClick={onClose} className="flex min-h-11 items-center gap-0.5 pr-2 text-[15px] text-accent-400" aria-label="뒤로">
            <Icon name="chevronLeft" size={20} />홈
          </button>
          <span className="flex-1" />
          {readAllButton}
          {settingsButton}
        </div>
        <div className="flex items-baseline gap-2 px-4 pb-2">
          <h2 className="text-[30px] font-bold leading-tight tracking-tight">알림</h2>
          {unread > 0 && <span className="text-sm text-slate-500">안 읽음 {unread}</span>}
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-10">
          {groups.length === 0 ? (
            <div className="rounded-xl bg-panel">
              <Empty />
            </div>
          ) : (
            groups.map(([day, list]) => (
              <Group key={day} title={day}>
                <Rows items={list} onOpen={onOpen} />
              </Group>
            ))
          )}
          <p className="px-1 text-xs text-slate-600">30일 지난 알림은 자동으로 지워져요</p>
        </div>
      </div>,
      document.body,
    );
  }

  // body에 포털로, z-50 — 홈·설정 같은 전체 페이지가 z-45로 덮여 있어 그 위에 떠야 한다 (ContextMenu와 같은 층)
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="알림"
      className="fixed bottom-14 left-14 z-50 flex max-h-[640px] w-[400px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-panel shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-slate-800 px-3.5 py-2.5">
        <h2 className="text-sm font-bold">알림</h2>
        {unread > 0 && <span className="text-xs text-slate-500">안 읽음 {unread}</span>}
        <span className="flex-1" />
        {readAllButton}
        {settingsButton}
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="닫기">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-2">
        {groups.length === 0 ? (
          <Empty />
        ) : (
          groups.map(([day, list]) => (
            <Group key={day} title={day}>
              <Rows items={list} onOpen={onOpen} />
            </Group>
          ))
        )}
      </div>
      <p className="border-t border-slate-800 px-3.5 py-2 text-[11px] text-slate-600">30일 지난 알림은 자동으로 지워져요</p>
    </div>,
    document.body,
  );
}
