import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IS_TOUCH } from '../lib/device';
import { pushLayer } from '../lib/layers';
import Icon, { type IconName } from './Icon';

/** section: 그 항목 위에 작은 머리글(「정렬」「보기」)을 붙인다. checked: 고른 값 표시(✓). 둘 다 터치 시트에서만 그려진다 */
export type MenuItem = { label: string; danger?: boolean; icon?: IconName; section?: string; checked?: boolean; action: () => void };

/** 메뉴 최소 너비(px) — 화면 밖으로 나가지 않게 위치를 보정할 때 쓴다 (아래 min-w-40과 같아야 한다) */
const MENU_WIDTH = 160;
/** 터치 시트가 뜬 뒤 누름을 받기 시작하기까지(ms) */
const SHEET_GUARD_MS = 300;

type Props = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** 터치 시트의 머리 — 무엇의 메뉴인지(파일 이름) */
  title?: string;
};

export default function ContextMenu({ x, y, items, onClose, title }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // mousedown 기준으로 닫아야 메뉴 밖 드래그 시작 등에도 반응한다
    window.addEventListener('mousedown', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 터치 시트는 "열린 층" — 뒤로 가기가 시트만 닫는다 (폰 재설계 원칙: 뒤로 가기 = 맨 위 층 하나).
  // 한 틱 늦춰 쌓는다: StrictMode(개발)가 마운트 효과를 두 번 돌리면 쌓자마자 history.back()이 나가고 그 사이 또 쌓여 기록이 꼬였다 (검수 2026-10-31)
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

  // 뜬 직후 잠깐은 누름을 받지 않는다 — 길게 누르던 손가락이 떨어지며 시트 항목을 누르는 사고의 이중 안전망
  const [ready, setReady] = useState(!IS_TOUCH);
  useEffect(() => {
    if (!IS_TOUCH) return;
    const t = window.setTimeout(() => setReady(true), SHEET_GUARD_MS);
    return () => window.clearTimeout(t);
  }, []);

  if (IS_TOUCH) {
    // 폰 A안: 아이폰 동작 시트 — 아래에서 올라오는 둥근 카드, 위험한 것은 붉게, 맨 아래 [취소].
    // body에 포털로: 목록 층(z-25) 안에서 그리면 그 층의 z 문맥에 갇혀 탭 바(z-30)가 [취소]를 덮었다
    return createPortal(
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
        <div
          ref={ref}
          className={`absolute inset-x-2 bottom-0 pb-[calc(env(safe-area-inset-bottom)+8px)] ${ready ? '' : 'pointer-events-none'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="overflow-hidden rounded-2xl bg-panel">
            {title && <p className="truncate border-b border-hair px-4 py-2.5 text-center text-xs text-slate-500">{title}</p>}
            {items.map((item, i) => (
              <div key={`${item.section ?? ''}/${item.label}`}>
                {item.section && <p className={`bg-ground px-4 pb-1 pt-2.5 text-[11px] font-medium text-slate-500 ${i === 0 && !title ? '' : 'border-t border-hair'}`}>{item.section}</p>}
                <button
                  onClick={() => {
                    onClose();
                    item.action();
                  }}
                  className={`flex min-h-12 w-full items-center justify-between px-4 text-left text-[15px] active:bg-slate-800/40 ${
                    i === 0 || item.section ? '' : 'border-t border-hair'
                  } ${item.danger ? 'text-danger-400' : 'text-slate-100'}`}
                >
                  {item.label}
                  {item.checked ? (
                    <Icon name="check" size={18} className="text-accent-400" />
                  ) : (
                    item.icon && <Icon name={item.icon} size={18} className={item.danger ? 'text-danger-400' : 'text-slate-500'} />
                  )}
                </button>
              </div>
            ))}
          </div>
          <button onClick={onClose} className="mt-2 min-h-12 w-full rounded-2xl bg-panel text-[15px] font-semibold text-accent-400 active:bg-slate-800/40">
            취소
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-40 rounded-md border border-slate-700 bg-slate-900 py-1 shadow-xl"
      // 화면 밖으로 나가지 않게 가로·세로 모두 보정한다. 폰에서는 ⋯ 버튼이 패널 오른쪽 끝에 있어
      // 가로 보정이 없으면 메뉴가 잘린다 (항목 높이는 34px로 어림한다)
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - items.length * 34 - 16)),
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            onClose();
            item.action();
          }}
          className={`block w-full px-3 py-1.5 text-left text-sm transition hover:bg-slate-800 ${
            item.danger ? 'text-red-400' : 'text-slate-200'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
