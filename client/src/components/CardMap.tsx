import { useEffect, useMemo, useRef, useState } from 'react';
import type { Core, ElementDefinition } from 'cytoscape';
import { api, ApiError, cardToTreeFile, type CardSummary, type TreeFile } from '../lib/api';
import { toast } from '../lib/toast';

type Props = {
  cards: CardSummary[];
  onOpen: (file: TreeFile) => void;
  onCardsChanged: () => void;
};

/** 주제별 색 — 순서대로 돌려 쓴다. 주제 없음은 회색, 주제 카드는 파랑 */
const PALETTE = ['#2dd4bf', '#f59e0b', '#a78bfa', '#f472b6', '#4ade80', '#fb7185', '#facc15', '#60a5fa'];
const TOPIC_CARD_COLOR = '#0284c7';
const NO_TOPIC_COLOR = '#94a3b8';
const GHOST_PREFIX = 'ghost:';

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 카드 목록 → 점·선. 연결 칸의 이름이 어느 카드도 아니면 점선 점("없는 카드")으로 그린다 */
function buildElements(cards: CardSummary[], colorOf: (topic: string) => string): { elements: ElementDefinition[]; ghosts: number; edges: number } {
  const byName = new Map<string, CardSummary>();
  for (const c of cards) for (const n of [c.title, ...c.aliases]) byName.set(norm(n), c);
  const elements: ElementDefinition[] = cards.map((c) => ({
    data: { id: String(c.id), label: c.title, color: c.kind === '주제' ? TOPIC_CARD_COLOR : colorOf(c.topic), size: c.kind === '주제' ? 34 : 22, cardId: c.id },
  }));
  const ghosts = new Set<string>();
  const seen = new Set<string>();
  let edges = 0;
  for (const c of cards) {
    for (const l of c.links) {
      const target = byName.get(norm(l));
      const targetId = target ? String(target.id) : `${GHOST_PREFIX}${norm(l)}`;
      if (!target && !ghosts.has(targetId)) {
        ghosts.add(targetId);
        elements.push({ data: { id: targetId, label: l, ghost: true, size: 18 } });
      }
      const key = [String(c.id), targetId].sort().join('|');
      if (seen.has(key) || targetId === String(c.id)) continue;
      seen.add(key);
      edges++;
      elements.push({ data: { id: `e:${key}`, source: String(c.id), target: targetId } });
    }
  }
  return { elements, ghosts: ghosts.size, edges };
}

// SCR-184: 카드 지도 — 점=카드, 선=연결, 색=주제, 점선=아직 없는 카드. 어디가 빽빽하고 어디가 비었는지 한눈에.
// 점을 누르면 아래에 그 카드, 다시 누르면 연다. cytoscape는 mermaid 때문에 이미 번들에 있어 지연 로드만 한다
export default function CardMap({ cards, onOpen, onCardsChanged }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [ready, setReady] = useState(false);

  const topics = useMemo(() => [...new Set(cards.map((c) => c.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [cards]);
  const colorOf = (topic: string) => (topic ? PALETTE[topics.indexOf(topic) % PALETTE.length]! : NO_TOPIC_COLOR);
  const built = useMemo(() => buildElements(cards, colorOf), [cards, topics]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cy: Core | null = null;
    let alive = true;
    const el = boxRef.current;
    if (!el) return;
    // 글자색은 앱 테마 변수에서 — 캔버스라 CSS 클래스가 안 먹는다
    const css = getComputedStyle(document.documentElement);
    const labelColor = css.getPropertyValue('--color-slate-300').trim() || '#cbd5e1';
    const lineColor = css.getPropertyValue('--color-slate-700').trim() || '#334155';
    const bg = css.getPropertyValue('--color-slate-950').trim() || '#020617';
    void import('cytoscape').then(({ default: cytoscape }) => {
      if (!alive) return;
      cy = cytoscape({
        container: el,
        elements: built.elements,
        // cose: 연결된 것끼리 모이고 외딴 점은 밖으로 — "어디가 비었나"가 자리로 보인다
        layout: { name: 'cose', animate: false, padding: 24, nodeRepulsion: () => 8000, idealEdgeLength: () => 70 },
        style: [
          { selector: 'node', style: { 'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', label: 'data(label)', color: labelColor, 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 4, 'text-max-width': '90px', 'text-wrap': 'ellipsis', 'border-width': 0 } },
          { selector: 'node[?ghost]', style: { 'background-color': bg, 'background-opacity': 0.4, 'border-width': 1.5, 'border-style': 'dashed', 'border-color': labelColor, color: labelColor } },
          { selector: 'node.picked', style: { 'border-width': 3, 'border-style': 'solid', 'border-color': labelColor } },
          { selector: 'edge', style: { width: 1.5, 'line-color': lineColor, 'curve-style': 'bezier' } },
          { selector: 'edge.picked', style: { width: 2.5, 'line-color': '#38bdf8' } },
        ],
        wheelSensitivity: 0.2,
      });
      cy.on('tap', 'node', (ev) => {
        const n = ev.target;
        cy!.elements().removeClass('picked');
        n.addClass('picked');
        n.connectedEdges().addClass('picked');
        setPicked({ id: String(n.id()), label: String(n.data('label')) });
      });
      cy.on('tap', (ev) => {
        if (ev.target === cy) {
          cy!.elements().removeClass('picked');
          setPicked(null);
        }
      });
      cyRef.current = cy;
      setReady(true);
    });
    return () => {
      alive = false;
      cy?.destroy();
      cyRef.current = null;
    };
  }, [built]);

  const pickedCard = picked && !picked.id.startsWith(GHOST_PREFIX) ? cards.find((c) => String(c.id) === picked.id) ?? null : null;

  async function createBlank(title: string) {
    try {
      const r = await api<{ card: CardSummary }>('/cards', { method: 'POST', body: JSON.stringify({ title, oneLine: '(한 줄 정의를 적어 주세요)', body: '' }) });
      window.dispatchEvent(new Event('dv:cards-changed'));
      onCardsChanged();
      onOpen(cardToTreeFile(r.card));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '카드를 만들지 못했습니다', 'error');
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={boxRef} className="min-h-0 flex-1" />
      {!ready && <p className="absolute inset-x-0 top-6 text-center text-xs text-slate-600">지도를 그리는 중…</p>}
      {/* 범례 — 색이 곧 주제 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-500">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: TOPIC_CARD_COLOR }} />주제 카드</span>
        {topics.map((t) => (
          <span key={t}><i className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colorOf(t) }} />{t}</span>
        ))}
        {cards.some((c) => !c.topic) && <span><i className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: NO_TOPIC_COLOR }} />주제 없음</span>}
        {built.ghosts > 0 && <span><i className="mr-1 inline-block h-2 w-2 rounded-full border border-dashed border-slate-500 align-middle" />없는 카드 {built.ghosts}</span>}
        <span className="ml-auto">{cards.length}장 · 연결 {built.edges}</span>
      </div>
      {picked && (
        <div className="absolute inset-x-3 bottom-9 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm shadow-xl shadow-black/40">
          {pickedCard ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-100">{pickedCard.title}</span>
                <span className="rounded border border-slate-700 px-1 text-[10px] text-slate-500">{pickedCard.kind}</span>
                <span className="ml-auto text-[11px] text-slate-500">연결 {pickedCard.links.length}{pickedCard.topic ? ` · ${pickedCard.topic}` : ''}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{pickedCard.oneLine}</p>
              <button onClick={() => onOpen(cardToTreeFile(pickedCard))} className="mt-2 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-500">열기</button>
            </>
          ) : (
            <>
              <div className="font-semibold text-slate-100">{picked.label} <span className="text-[11px] font-normal text-slate-500">— 아직 없는 카드</span></div>
              <p className="mt-0.5 text-xs text-slate-400">다른 카드의 연결 칸에만 있어요. 빈 카드로 만들어 두고 나중에 채울 수 있습니다</p>
              <button onClick={() => void createBlank(picked.label)} className="mt-2 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800">빈 카드 만들기</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
