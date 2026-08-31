import { useState, type DragEvent } from 'react';
import type { TreeFile } from '../lib/api';
import ContextMenu, { type MenuItem } from './ContextMenu';

/** 탭 드래그의 dataTransfer 타입 — OS 파일 드롭(Files)과 구분하는 표식 */
export const TAB_DRAG_TYPE = 'application/x-docvault-tab';

type Props = {
  tabs: TreeFile[];
  /** 활성 칸에 보이는 문서 — 밝게 강조 */
  activeId: number | null;
  /** 화면(칸)에 떠 있는 문서들 — 대기 탭과 톤을 구분 */
  paneIds: number[];
  onPick: (file: TreeFile) => void;
  onClose: (file: TreeFile) => void;
  /** 분할로 열기 — Alt+클릭·우클릭 메뉴 공용 (트리·md 링크와 같은 문법) */
  onSplit: (file: TreeFile) => void;
  onCloseOthers: (file: TreeFile) => void;
  onCloseRight: (file: TreeFile) => void;
  /** 탭 순서 바꾸기 — beforeId 앞에 삽입, null이면 맨 뒤로 */
  onReorder: (fromId: number, beforeId: number | null) => void;
  /** 드래그 시작/끝 보고 — 부모가 본문 위 드롭 존 오버레이를 켜고 끈다 (IA — 탭 드래그 배치) */
  onDragState: (file: TreeFile | null) => void;
};

// SCR-153: 탭 바 — "열려 있다"(탭)와 "보이고 있다"(분할 칸)의 분리 (IA — 탭 바 + 분할 보기)
export default function TabBar({ tabs, activeId, paneIds, onPick, onClose, onSplit, onCloseOthers, onCloseRight, onReorder, onDragState }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; file: TreeFile } | null>(null);
  // 드래그 중 삽입 위치 표시 — 이 id의 탭 앞, 'end'면 맨 뒤
  const [dropHint, setDropHint] = useState<number | 'end' | null>(null);

  const menuItems = (f: TreeFile): MenuItem[] => {
    const idx = tabs.findIndex((t) => t.id === f.id);
    return [
      { label: '◫ 분할로 열기', action: () => onSplit(f) },
      { label: '닫기', action: () => onClose(f) },
      ...(tabs.length > 1 ? [{ label: '다른 탭 모두 닫기', action: () => onCloseOthers(f) }] : []),
      ...(idx !== -1 && idx < tabs.length - 1
        ? [{ label: '오른쪽 탭 모두 닫기', action: () => onCloseRight(f) }]
        : []),
    ];
  };

  // dragover 단계에서는 dataTransfer의 내용(getData)을 못 읽는다 — 타입 표식만으로 판정
  const isTabDrag = (e: DragEvent) => e.dataTransfer.types.includes(TAB_DRAG_TYPE);

  return (
    <div
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-slate-800 bg-slate-950 px-1 pt-1"
      onDragOver={(e) => {
        if (!isTabDrag(e)) return;
        e.preventDefault();
        // 탭이 아니라 빈 여백 위 — 맨 뒤 삽입 (탭 위에서는 각 탭의 핸들러가 위치를 정한다)
        if (e.target === e.currentTarget) setDropHint('end');
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHint(null);
      }}
      onDrop={(e) => {
        if (!isTabDrag(e)) return;
        e.preventDefault();
        const fromId = Number(e.dataTransfer.getData(TAB_DRAG_TYPE));
        if (fromId && dropHint !== null) onReorder(fromId, dropHint === 'end' ? null : dropHint);
        setDropHint(null);
      }}
    >
      {tabs.map((f) => {
        const active = f.id === activeId;
        const visible = paneIds.includes(f.id);
        return (
          <div key={f.id} className="contents">
            {dropHint === f.id && <div className="h-6 w-0.5 shrink-0 rounded bg-sky-400" />}
            <div
              role="tab"
              title={f.name}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DRAG_TYPE, String(f.id));
                e.dataTransfer.effectAllowed = 'move';
                onDragState(f);
              }}
              onDragEnd={() => {
                // 어디에 놓였든(취소 포함) 여기서 정리된다 — drop 쪽에서는 상태를 만질 필요 없음
                setDropHint(null);
                onDragState(null);
              }}
              onDragOver={(e) => {
                if (!isTabDrag(e)) return;
                e.preventDefault();
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                const before = e.clientX < r.left + r.width / 2;
                const idx = tabs.findIndex((t) => t.id === f.id);
                setDropHint(before ? f.id : (tabs[idx + 1]?.id ?? 'end'));
              }}
              onClick={(e) => (e.altKey ? onSplit(f) : onPick(f))}
              onContextMenu={(e) => {
                e.preventDefault();
                // 열린 메뉴의 창 수준 닫기 리스너에 닿기 전에 끊는다 — 안 끊으면 방금 연 메뉴가 도로 닫힌다
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, file: f });
              }}
              // 가운데 클릭으로도 닫기 — 브라우저 탭과 같은 문법
              onAuxClick={(e) => e.button === 1 && onClose(f)}
              className={`group flex max-w-48 shrink-0 cursor-pointer items-center gap-1 rounded-t-md border-x border-t px-2.5 py-1.5 text-xs transition ${
                active
                  ? 'border-slate-700 bg-slate-800 text-slate-100'
                  : visible
                    ? 'border-slate-800 bg-slate-900 text-slate-300'
                    : 'border-transparent text-slate-500 hover:bg-slate-900 hover:text-slate-300'
              }`}
            >
              <span className="truncate">{f.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(f);
                }}
                title="닫기"
                className="shrink-0 rounded px-0.5 text-slate-600 transition hover:text-slate-200"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      {dropHint === 'end' && <div className="h-6 w-0.5 shrink-0 rounded bg-sky-400" />}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.file)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
