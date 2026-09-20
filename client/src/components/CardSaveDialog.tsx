import { Suspense, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  cardToTreeFile,
  type CardDraft,
  type CardFront,
  type CardKind,
  type CardMerge,
  type CardSummary,
  type TreeFile,
} from '../lib/api';
import { getAppProseTheme } from '../lib/appTheme';
import { CARD_KINDS } from '../lib/frontmatter';
import { toast } from '../lib/toast';
import { renderers } from '../renderers';

type Props = {
  threadId: number;
  /** 이 답 하나로 카드를 만든다 */
  messageId?: number;
  /** 고른 답들로 한 장 (답 골라 담기). messageId도 messageIds도 없으면 대화 전체로 한 장 */
  messageIds?: number[];
  isPc: boolean;
  onClose: () => void;
  onSaved: (file: TreeFile) => void;
};

type Step =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'choose'; draft: CardDraft; similar: CardSummary }
  | { kind: 'form'; draft: CardDraft; linkTo: CardSummary | null }
  | { kind: 'merging'; card: CardSummary }
  | { kind: 'merge'; card: CardSummary; merged: CardMerge; current: { title: string; front: CardFront; body: string }; instruction: string };

const MdRenderer = renderers.md;

const RELATION_LABEL: Record<NonNullable<CardDraft['similar']>['relation'], string> = {
  same: '같은 개념',
  aspect: '같은 개념의 다른 측면',
  related: '관련은 있지만 다른 개념',
  different: '이름은 비슷하지만 다른 개념',
};

function listToText(a: string[]) {
  return a.join(', ');
}
function textToList(s: string) {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

// SCR-182: 카드로 저장 — 초안(AI) → 비슷한 카드가 있으면 판단·선택 → 머리말+본문 확인 → 저장.
// 합치기는 덧붙이기가 아니라 재구성이고, 저장 전에 지금→합친 뒤를 나란히 본다 (설계 — 구조가 잡힌 채로)
export default function CardSaveDialog({ threadId, messageId, messageIds, isPc, onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  /** 재료가 무엇인지 — 답 하나 / 고른 답 N개 / 대화 전체. 머리에 적어 두어야 "왜 이런 초안이 나왔나"가 읽힌다 */
  const scopeLabel = messageId !== undefined ? '' : messageIds ? `재료: 고른 답 ${messageIds.length}개` : '재료: 이 대화 전체';

  useEffect(() => {
    let alive = true;
    void api<{ draft: CardDraft; similarCard: CardSummary | null }>('/cards/draft', {
      method: 'POST',
      body: JSON.stringify({ threadId, ...(messageId !== undefined ? { messageId } : messageIds ? { messageIds } : {}) }),
    })
      .then(({ draft, similarCard }) => {
        if (!alive) return;
        if (draft.similar && similarCard) setStep({ kind: 'choose', draft, similar: similarCard });
        else setStep({ kind: 'form', draft, linkTo: null });
      })
      .catch((e: unknown) => alive && setStep({ kind: 'error', message: e instanceof ApiError ? e.message : '초안을 만들지 못했습니다' }));
    return () => {
      alive = false;
    };
  }, [threadId, messageId, messageIds]);

  async function startMerge(card: CardSummary, instruction?: string) {
    setStep({ kind: 'merging', card });
    try {
      const r = await api<{ merged: CardMerge; current: { title: string; front: CardFront; body: string } }>('/cards/merge-preview', {
        method: 'POST',
        body: JSON.stringify({ cardId: card.id, threadId, ...(instruction ? { instruction } : {}) }),
      });
      setStep({ kind: 'merge', card, merged: r.merged, current: r.current, instruction: '' });
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof ApiError ? e.message : '합친 결과를 만들지 못했습니다' });
    }
  }

  async function saveNew(draft: CardDraft, linkTo: CardSummary | null) {
    setBusy(true);
    try {
      const links = linkTo && !draft.links.includes(linkTo.title) ? [...draft.links, linkTo.title] : draft.links;
      const r = await api<{ card: CardSummary }>('/cards', {
        method: 'POST',
        body: JSON.stringify({ ...draft, links, threadId, similar: undefined }),
      });
      window.dispatchEvent(new Event('dv:cards-changed'));
      toast(`카드 "${r.card.title}" 저장`);
      onSaved(cardToTreeFile(r.card));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '저장하지 못했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveMerge(card: CardSummary, merged: CardMerge, topic: string) {
    setBusy(true);
    try {
      const r = await api<{ card: CardSummary }>(`/cards/${card.id}`, {
        method: 'PUT',
        body: JSON.stringify({ oneLine: merged.oneLine, aliases: merged.aliases, kind: merged.kind, topic, tags: merged.tags, links: merged.links, body: merged.body, threadId }),
      });
      window.dispatchEvent(new Event('dv:cards-changed'));
      toast(`카드 "${r.card.title}" 다시 짬 — 이전 판은 버전 기록에`);
      onSaved(cardToTreeFile(r.card));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '저장하지 못했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  const shell = (title: string, subtitle: string, body: React.ReactNode, footer: React.ReactNode) => (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={busy ? undefined : onClose} />
      <div
        className={`fixed z-50 flex flex-col overflow-hidden bg-slate-950 text-slate-100 ${
          isPc ? 'left-1/2 top-1/2 h-[min(760px,92vh)] w-[min(1080px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-700 shadow-2xl' : 'inset-0'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <span className="text-teal-300">📚</span>
          <h3 className="shrink-0 whitespace-nowrap text-sm font-semibold">{title}</h3>
          <span className="truncate text-xs text-slate-500">{subtitle}</span>
          <button onClick={onClose} disabled={busy} className="ml-auto px-1 text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{body}</div>
        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pc:pb-3">{footer}</div>
      </div>
    </>
  );

  const btn = 'rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40';
  const primary = 'rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-40';

  if (step.kind === 'loading' || step.kind === 'merging') {
    return shell(
      step.kind === 'loading' ? '카드로 저장' : '합치는 중',
      step.kind === 'loading' ? scopeLabel : '',
      <p className="py-10 text-center text-sm text-slate-400">
        {step.kind === 'loading' ? 'AI가 초안을 짜고 비슷한 카드가 있는지 보는 중…' : `AI가 "${step.card.title}" 카드를 다시 짜는 중…`}
      </p>,
      <button onClick={onClose} className={`${btn} ml-auto`}>취소</button>,
    );
  }

  if (step.kind === 'error') {
    return shell('카드로 저장', '', <p className="py-6 text-sm text-red-300">{step.message}</p>, <button onClick={onClose} className={`${btn} ml-auto`}>닫기</button>);
  }

  if (step.kind === 'choose') {
    const sim = step.draft.similar!;
    const recommendMerge = sim.recommendation === 'merge';
    return shell(
      '카드로 저장',
      '비슷한 카드가 있어요',
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid gap-3 pc:grid-cols-2">
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
            <div className="text-xs text-slate-500">이번 답에서 만들려는 카드</div>
            <div className="mt-1 font-semibold">{step.draft.title}</div>
            <div className="text-slate-300">{step.draft.oneLine}</div>
          </div>
          <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3">
            <div className="text-xs text-amber-300/80">이미 있는 카드 · {new Date(step.similar.updatedAt).toLocaleDateString()}</div>
            <div className="mt-1 font-semibold">{step.similar.title}</div>
            <div className="text-slate-300">{step.similar.oneLine}</div>
          </div>
        </div>
        <div className="rounded-r-lg border-l-4 border-teal-500 bg-teal-950/40 px-4 py-3">
          <div className="text-xs font-semibold text-teal-300">AI 판단: {RELATION_LABEL[sim.relation]}</div>
          <p className="mt-1 text-slate-200">{sim.reason}</p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => void startMerge(step.similar)}
            className={`rounded-lg border-2 p-3 text-left ${recommendMerge ? 'border-teal-500 bg-slate-900' : 'border-slate-700 bg-slate-900'}`}
          >
            <div className="font-medium">
              "{step.similar.title}"에 합쳐서 다시 짜기 {recommendMerge && <span className="ml-1 rounded-full bg-teal-900 px-2 py-0.5 text-[10px] text-teal-200">추천</span>}
            </div>
            <div className="text-xs text-slate-400">AI가 기존 카드 + 이번 답을 읽고 카드를 통째로 다시 구성해요. 아래에 덧붙이는 게 아니에요. 저장 전에 지금→합친 뒤를 나란히 보여 줘요</div>
          </button>
          <button
            onClick={() => setStep({ kind: 'form', draft: step.draft, linkTo: step.similar })}
            className={`rounded-lg border-2 p-3 text-left ${!recommendMerge ? 'border-teal-500 bg-slate-900' : 'border-slate-700 bg-slate-900'}`}
          >
            <div className="font-medium">
              "{step.draft.title}"를 따로 만들고 서로 연결 {!recommendMerge && <span className="ml-1 rounded-full bg-teal-900 px-2 py-0.5 text-[10px] text-teal-200">추천</span>}
            </div>
            <div className="text-xs text-slate-400">두 카드의 연결 칸에 서로가 들어가요. 나중에 합치기·나누기로 되돌릴 수 있어요</div>
          </button>
          <button
            onClick={() => {
              onSaved(cardToTreeFile(step.similar));
            }}
            className="rounded-lg border-2 border-slate-700 bg-slate-900 p-3 text-left"
          >
            <div className="font-medium">저장 안 하고 기존 카드만 열기</div>
            <div className="text-xs text-slate-400">이미 알던 거였을 때</div>
          </button>
        </div>
      </div>,
      <button onClick={onClose} className={`${btn} ml-auto`}>취소</button>,
    );
  }

  if (step.kind === 'form') {
    const d = step.draft;
    const set = (patch: Partial<CardDraft>) => setStep({ ...step, draft: { ...d, ...patch } });
    const field = 'w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 focus:border-teal-600 focus:outline-none';
    const label = 'text-[11px] font-medium text-slate-500';
    return shell(
      '카드로 저장',
      `${scopeLabel ? `${scopeLabel} · ` : ''}AI 초안 — 머리말과 본문 둘 다 고칠 수 있어요`,
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-teal-800/60 bg-teal-950/20 p-3">
          <div className="mb-2 text-[11px] font-semibold text-teal-300">머리말 — 필수는 제목·한 줄뿐</div>
          <div className="grid gap-2 pc:grid-cols-[1fr_150px]">
            <div><div className={label}>제목 *</div><input value={d.title} onChange={(e) => set({ title: e.target.value })} className={`${field} text-base font-semibold`} /></div>
            <div><div className={label}>종류 (AI 판단)</div>
              <select value={d.kind} onChange={(e) => set({ kind: e.target.value as CardKind })} className={field}>
                {CARD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-2"><div className={label}>한 줄 *</div><input value={d.oneLine} onChange={(e) => set({ oneLine: e.target.value })} className={field} /></div>
          <div className="mt-2 grid gap-2 pc:grid-cols-3">
            <div><div className={label}>별칭 (쉼표로)</div><input value={listToText(d.aliases)} onChange={(e) => set({ aliases: textToList(e.target.value) })} className={field} /></div>
            <div><div className={label}>태그</div><input value={listToText(d.tags)} onChange={(e) => set({ tags: textToList(e.target.value) })} className={field} /></div>
            <div><div className={label}>주제 폴더</div><input value={d.topic} onChange={(e) => set({ topic: e.target.value })} className={field} /></div>
          </div>
          <div className="mt-2"><div className={label}>연결 (다른 개념 이름, 쉼표로){step.linkTo ? ` · "${step.linkTo.title}"는 저장 때 자동으로 붙어요` : ''}</div><input value={listToText(d.links)} onChange={(e) => set({ links: textToList(e.target.value) })} className={field} /></div>
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between"><span className="text-[11px] font-semibold text-slate-400">본문 — 자유 (md)</span><span className="text-[11px] text-slate-600">필요한 것만. 없는 건 안 씀</span></div>
          <textarea value={d.body} onChange={(e) => set({ body: e.target.value })} rows={isPc ? 12 : 10} className={`${field} resize-y font-mono text-[13px] leading-relaxed`} />
        </div>
      </div>,
      <>
        <span className="text-xs text-slate-500">저장 = {d.title || '제목'}.md · 서랍 / {d.topic || '주제 없음'}</span>
        <button onClick={onClose} disabled={busy} className={`${btn} ml-auto`}>취소</button>
        <button onClick={() => void saveNew(d, step.linkTo)} disabled={busy || !d.title.trim() || !d.oneLine.trim()} className={primary}>
          {busy ? '저장 중…' : '저장하고 카드 열기'}
        </button>
      </>,
    );
  }

  // merge
  const { card, merged, current } = step;
  const proseTheme = getAppProseTheme();
  const renderMd = (md: string) =>
    MdRenderer ? (
      <Suspense fallback={<pre className="whitespace-pre-wrap text-xs">{md}</pre>}>
        <div className="ask-md"><MdRenderer content={md} theme={proseTheme} /></div>
      </Suspense>
    ) : (
      <pre className="whitespace-pre-wrap text-xs">{md}</pre>
    );
  return shell(
    `합친 결과 — ${card.title}`,
    '저장 전에 확인. 이전 판은 버전 기록에 남아요',
    <div className="flex flex-col gap-4 text-sm">
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
        <div className="text-[11px] font-semibold text-slate-400">무엇이 바뀌었나</div>
        <ul className="mt-1 list-disc pl-5 text-slate-200">{merged.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </div>
      <div className="grid gap-3 pc:grid-cols-2">
        <div className="rounded-lg border border-slate-800 p-3">
          <div className="mb-2 text-[11px] font-semibold text-slate-500">지금 카드</div>
          <div className="mb-2 rounded-r border-l-4 border-slate-600 bg-slate-900 px-3 py-1.5">{current.front.oneLine}</div>
          {renderMd(current.body)}
        </div>
        <div className="rounded-lg border border-teal-800/60 p-3">
          <div className="mb-2 text-[11px] font-semibold text-teal-300">합친 뒤 (AI가 다시 짬)</div>
          <div className="mb-2 rounded-r border-l-4 border-teal-500 bg-teal-950/30 px-3 py-1.5">{merged.oneLine}</div>
          {renderMd(merged.body)}
          <div className="mt-2 text-xs text-slate-500">연결: {merged.links.join(', ') || '없음'} · 태그: {merged.tags.join(', ') || '없음'}</div>
        </div>
      </div>
      <div className="flex gap-2">
        <input
          value={step.instruction}
          onChange={(e) => setStep({ ...step, instruction: e.target.value })}
          placeholder="다르게 짜고 싶으면 적어요 — 예: 종류는 표로, 비유는 빼 줘"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 focus:border-teal-600 focus:outline-none"
        />
        <button onClick={() => void startMerge(card, step.instruction || undefined)} disabled={busy} className={btn}>다시 짜기</button>
      </div>
    </div>,
    <>
      <button onClick={onClose} disabled={busy} className={`${btn} ml-auto`}>취소</button>
      <button onClick={() => void saveMerge(card, merged, card.topic)} disabled={busy} className={primary}>{busy ? '저장 중…' : '이대로 저장'}</button>
    </>,
  );
}
