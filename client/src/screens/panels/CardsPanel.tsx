import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from 'react';
import ContextMenu, { type MenuItem } from '../../components/ContextMenu';
import FileName from '../../components/FileName';
import SwipeRow from '../../components/SwipeRow';
import { api, ApiError, cardToTreeFile, type CardSummary, type TreeFile } from '../../lib/api';
import { promptDialog } from '../../lib/dialog';
import { runGuarded } from '../../lib/guard';
import { toast } from '../../lib/toast';

type Props = {
  selectedId: number | null;
  onSelect: (file: TreeFile) => void;
  /** 지운 카드가 열려 있으면 탭·칸에서도 빼야 한다 — 탭을 아는 건 Workspace뿐이라 위로 올린다 */
  onDeleted: (id: number) => void;
};

type Group = 'topic' | 'recent';
type Menu = { x: number; y: number; items: MenuItem[] };

// SCR-181: 배움 카드 서랍 — 카드는 파일 트리에 안 나오고 여기서만 보인다 (설계 — 문서와 섞이지 않게)
export default function CardsPanel({ selectedId, onSelect, onDeleted }: Props) {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>('topic');
  const [menu, setMenu] = useState<Menu | null>(null);

  const reload = () => {
    void api<{ cards: CardSummary[] }>('/cards')
      .then((r) => setCards(r.cards))
      .catch(() => setCards([]));
  };
  useEffect(reload, []);
  // 카드가 저장되면 (질문 패널에서) 목록을 다시 받는다 — 화면끼리 직접 연결하지 않고 창 이벤트로
  useEffect(() => {
    window.addEventListener('dv:cards-changed', reload);
    return () => window.removeEventListener('dv:cards-changed', reload);
  }, []);

  const filtered = useMemo(() => {
    if (!cards) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((c) =>
      [c.title, c.oneLine, ...c.aliases, ...c.tags].some((s) => s.toLowerCase().includes(needle)),
    );
  }, [cards, q]);

  const sections = useMemo(() => {
    if (group === 'recent') {
      return [{ label: '최근 수정순', items: [...filtered].sort((a, b) => b.updatedAt - a.updatedAt) }];
    }
    const byTopic = new Map<string, CardSummary[]>();
    for (const c of filtered) {
      const key = c.topic || '주제 없음';
      byTopic.set(key, [...(byTopic.get(key) ?? []), c]);
    }
    return [...byTopic.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
      .map(([label, items]) => ({ label, items }));
  }, [filtered, group]);

  async function createBlank() {
    const title = await promptDialog('카드 제목 (예: 커널)');
    if (!title?.trim()) return;
    try {
      const r = await api<{ card: CardSummary }>('/cards', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), oneLine: '(한 줄 정의를 적어 주세요)', body: '' }),
      });
      reload();
      onSelect(cardToTreeFile(r.card));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '카드를 만들지 못했습니다', 'error');
    }
  }

  function openMenu(e: ReactMouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  // 카드도 files의 한 행(kind='card')이라 파일 삭제 API를 그대로 쓴다 —
  // 휴지통·복원·30일 자동 정리가 문서와 같은 규칙으로 따라온다
  function deleteCard(c: CardSummary) {
    onDeleted(c.id);
    void runGuarded(
      () => api(`/files/${c.id}`, { method: 'DELETE' }),
      () => {
        reload();
        // 확인 대화상자 없이 휴지통으로 — 실행 취소가 안전망이다 (파일 삭제와 같은 흐름)
        toast('휴지통으로 이동했습니다', 'success', {
          action: {
            label: '실행 취소',
            onAction: () =>
              void runGuarded(() => api(`/files/${c.id}/restore`, { method: 'POST' }), reload),
          },
        });
      },
    );
  }

  const cardMenu = (c: CardSummary): MenuItem[] => [
    { label: '삭제', danger: true, action: () => deleteCard(c) },
  ];

  if (cards === null) return <p className="px-4 py-4 text-sm text-slate-600">불러오는 중…</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-3 pb-2">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="제목·별칭·한 줄·태그"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
          />
          <button
            onClick={() => void createBlank()}
            title="AI 없이 빈 카드로 시작"
            className="shrink-0 rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            + 빈 카드
          </button>
        </div>
        <div className="flex gap-1 text-xs">
          {(
            [
              ['topic', '주제별'],
              ['recent', '최근'],
            ] as [Group, string][]
          ).map(([g, label]) => (
            <button
              key={g}
              onClick={() => setGroup(g)}
              className={`rounded px-2 py-0.5 transition ${group === g ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-slate-600">{cards.length}장</span>
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-600">
          아직 카드가 없어요. 문서를 읽다 질문하고, 답 아래 [카드로 저장]을 누르면 여기 쌓입니다.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {sections.map((sec) => (
            <div key={sec.label} className="mb-2">
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-slate-500">
                {sec.label} · {sec.items.length}
              </div>
              {sec.items.map((c) => (
                <SwipeRow
                  key={c.id}
                  right={[{ label: '삭제', danger: true, onAction: () => deleteCard(c) }]}
                  fullSwipe={{ label: '삭제', danger: true, onAction: () => deleteCard(c) }}
                >
                  <div
                    onClick={() => onSelect(cardToTreeFile(c))}
                    onContextMenu={(e) => openMenu(e, cardMenu(c))}
                    className={`group block w-full cursor-pointer rounded px-2 py-1.5 text-left transition ${
                      c.id === selectedId ? 'bg-slate-800' : 'hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <FileName
                        name={c.title}
                        expanded={c.id === selectedId}
                        className="text-sm text-slate-200"
                      />
                      <span className="shrink-0 rounded border border-slate-700 px-1 text-[10px] text-slate-500">{c.kind}</span>
                      {/* 모바일은 우클릭이 없어 ⋯가 유일한 진입점이다 (파일 트리와 같은 규칙) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openMenu(e, cardMenu(c));
                        }}
                        title="메뉴"
                        className="ml-auto shrink-0 rounded px-1 text-slate-500 hover:text-slate-200 pc:hidden pc:group-hover:block"
                      >
                        ⋯
                      </button>
                    </div>
                    <div className="truncate text-xs text-slate-500">{c.oneLine}</div>
                  </div>
                </SwipeRow>
              ))}
            </div>
          ))}
        </div>
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
