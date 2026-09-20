import { Suspense, useEffect, useState } from 'react';
import { api, ApiError, cardToTreeFile, type CardBatchResult, type CardOutline, type CardSummary, type TreeFile } from '../lib/api';
import { getAppProseTheme } from '../lib/appTheme';
import { toast } from '../lib/toast';
import { renderers } from '../renderers';

type Props = {
  threadId: number;
  isPc: boolean;
  onClose: () => void;
  /** "전부 한 장으로" — 이 창을 닫고 기존 저장 창(SCR-182)을 대화 전체로 연다 */
  onWholeAsOne: () => void;
  onSaved: (file: TreeFile) => void;
};

type Step = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'list'; outline: CardOutline };

const MdRenderer = renderers.md;

// SCR-183: 대화 정리 — 대화 하나에서 개념 N개를 체크리스트로 받아 고른 것만 카드로 (설계 흐름 M).
// 기존 카드와 같은 개념은 새 카드가 아니라 "이어쓰기"로 표시된다 — "개념 하나 = 카드 한 장"이 여기서 지켜진다.
// 버튼 글자가 곧 계약이다: 몇 장이 새로 생기고 몇 장에 이어 쓰는지 누르기 전에 안다.
export default function ThreadCardsDialog({ threadId, isPc, onClose, onWholeAsOne, onSaved }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [withTopic, setWithTopic] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void api<CardOutline>('/cards/outline', { method: 'POST', body: JSON.stringify({ threadId }) })
      .then((outline) => {
        if (!alive) return;
        setStep({ kind: 'list', outline });
        setChecked(new Set(outline.items.map((_, i) => i))); // 기본은 전부 체크 — 빼는 쪽이 고르는 쪽보다 적다
        setExpanded(new Set(outline.items.length > 0 ? [0] : [])); // 첫 항목만 펼쳐 "이런 모양"을 보여 준다
      })
      .catch((e: unknown) => alive && setStep({ kind: 'error', message: e instanceof ApiError ? e.message : '대화를 정리하지 못했습니다' }));
    return () => {
      alive = false;
    };
  }, [threadId]);

  const toggle = (set: Set<number>, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  };

  /** 되돌리기 — 새 카드는 휴지통으로, 이어쓴 카드는 저장 전 버전으로. 여섯 장을 하나씩 지우게 하지 않는다 */
  async function undo(r: CardBatchResult) {
    try {
      const gone = [...r.created, ...(r.topic ? [r.topic] : [])];
      await Promise.all([
        ...gone.map((c) => api(`/files/${c.id}`, { method: 'DELETE' })),
        ...r.merged.map((m) => api(`/files/${m.card.id}/versions/${m.versionId}/restore`, { method: 'POST' })),
      ]);
      window.dispatchEvent(new Event('dv:cards-changed'));
      toast('되돌렸습니다 — 새 카드는 휴지통에, 이어쓴 카드는 이전 판으로');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '되돌리지 못했습니다', 'error');
    }
  }

  async function save(outline: CardOutline) {
    setBusy(true);
    try {
      const items = outline.items
        .filter((_, i) => checked.has(i))
        .map(({ concept, existing, merged }) =>
          existing && merged
            ? {
                title: existing.title,
                oneLine: merged.oneLine,
                aliases: merged.aliases,
                kind: merged.kind,
                topic: existing.topic,
                tags: merged.tags,
                links: merged.links,
                body: merged.body,
                existingCardId: existing.id,
              }
            : { title: concept.title, oneLine: concept.oneLine, aliases: concept.aliases, kind: concept.kind, topic: concept.topic, tags: concept.tags, links: concept.links, body: concept.body },
        );
      // 주제 카드는 개념 카드들이 가장 많이 쓴 주제 폴더에 — 따로 묻지 않는다
      const topicFolder = mostCommon(items.map((i) => i.topic).filter(Boolean));
      const r = await api<CardBatchResult>('/cards/batch', {
        method: 'POST',
        body: JSON.stringify({
          threadId,
          items,
          ...(withTopic ? { topic: { title: outline.topic.title, oneLine: outline.topic.oneLine, body: outline.topic.body, topic: topicFolder, tags: [] } } : {}),
        }),
      });
      window.dispatchEvent(new Event('dv:cards-changed'));
      const parts = [];
      if (r.created.length) parts.push(`카드 ${r.created.length}장 저장`);
      if (r.merged.length) parts.push(`${r.merged.length}장 이어씀`);
      if (r.topic) parts.push('주제 1장');
      toast(parts.join(' · '), 'success', { action: { label: '되돌리기', onAction: () => void undo(r) }, duration: 8000 });
      const open: CardSummary | undefined = r.topic ?? r.created[0] ?? r.merged[0]?.card;
      if (open) onSaved(cardToTreeFile(open));
      else onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '저장하지 못했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  const shell = (subtitle: string, body: React.ReactNode, footer: React.ReactNode) => (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={busy ? undefined : onClose} />
      <div
        className={`fixed z-50 flex flex-col overflow-hidden bg-slate-950 text-slate-100 ${
          isPc ? 'left-1/2 top-1/2 h-[min(760px,92vh)] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-700 shadow-2xl' : 'inset-0'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <span className="text-teal-300">📚</span>
          <h3 className="text-sm font-semibold">대화 정리</h3>
          <span className="truncate text-xs text-slate-500">{subtitle}</span>
          <button onClick={onClose} disabled={busy} className="ml-auto px-1 text-slate-500 hover:text-slate-300">✕</button>
        </div>
        {/* 개념별로 나누기 / 전부 한 장으로 — 같은 재료의 두 모양. 한 장은 기존 저장 창이 맡는다 */}
        <div className="mx-4 mt-3 grid grid-cols-2 rounded-lg bg-slate-900 p-0.5 text-xs">
          <span className="rounded-md bg-slate-800 py-1.5 text-center font-medium text-slate-100">개념별로 나누기</span>
          <button onClick={onWholeAsOne} disabled={busy} className="rounded-md py-1.5 text-slate-400 hover:text-slate-200">전부 한 장으로</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{body}</div>
        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pc:pb-3">{footer}</div>
      </div>
    </>
  );
  const btn = 'rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40';
  const primary = 'rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-40';

  if (step.kind === 'loading') {
    return shell('', <p className="py-10 text-center text-sm text-slate-400">AI가 대화에서 개념을 뽑고, 이미 있는 카드와 겹치는지 보는 중…</p>, <button onClick={onClose} className={`${btn} ml-auto`}>취소</button>);
  }
  if (step.kind === 'error') {
    return shell('', <p className="py-6 text-sm text-red-300">{step.message}</p>, <button onClick={onClose} className={`${btn} ml-auto`}>닫기</button>);
  }

  const { outline } = step;
  const picked = outline.items.filter((_, i) => checked.has(i));
  const fresh = picked.filter((it) => !it.existing).length;
  const merge = picked.length - fresh;
  const ctaParts = [];
  if (fresh) ctaParts.push(`카드 ${fresh}장 만들기`);
  if (merge) ctaParts.push(`${merge}장 이어쓰기`);
  const cta = ctaParts.length ? ctaParts.join(' + ') : withTopic ? '주제 카드만 만들기' : '고른 개념이 없어요';
  const canSave = !busy && (picked.length > 0 || withTopic);
  const proseTheme = getAppProseTheme();
  const renderMd = (md: string) =>
    MdRenderer ? (
      <Suspense fallback={<pre className="whitespace-pre-wrap text-xs">{md}</pre>}>
        <div className="ask-md text-[13px]"><MdRenderer content={md} theme={proseTheme} /></div>
      </Suspense>
    ) : (
      <pre className="whitespace-pre-wrap text-xs">{md}</pre>
    );
  const chip = (s: string) => <span key={s} className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400">{s}</span>;
  const box = (on: boolean) => (
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] ${on ? 'border-teal-500 bg-teal-600 text-white' : 'border-slate-600 text-transparent'}`}>✓</span>
  );

  return shell(
    `${outline.source} · 개념 ${outline.items.length}개`,
    <div className="flex flex-col gap-2 text-sm">
      {outline.items.length === 0 && <p className="py-4 text-center text-slate-500">이 대화에서는 카드로 만들 개념을 찾지 못했어요. "전부 한 장으로"를 써 보세요.</p>}
      {outline.items.map((it, i) => {
        const on = checked.has(i);
        const open = expanded.has(i);
        return (
          <div key={i} className={`rounded-lg border ${on ? 'border-slate-700 bg-slate-900' : 'border-slate-800 bg-slate-950 opacity-60'}`}>
            <div className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5" onClick={() => setExpanded(toggle(expanded, i))}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setChecked(toggle(checked, i));
                }}
                title={on ? '빼기' : '넣기'}
                className="shrink-0"
              >
                {box(on)}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{it.existing ? it.existing.title : it.concept.title}</span>
                  <span className="shrink-0 rounded border border-slate-700 px-1 text-[10px] text-slate-500">{it.merged?.kind ?? it.concept.kind}</span>
                </div>
                <div className="truncate text-xs text-slate-400">{it.merged?.oneLine ?? it.concept.oneLine}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${it.existing ? 'bg-amber-950/60 text-amber-300' : 'bg-emerald-950/60 text-emerald-300'}`}>
                {it.existing ? `"${it.existing.title}"에 이어쓰기` : '새 카드'}
              </span>
            </div>
            {open && (
              <div className="border-t border-dashed border-slate-800 px-3 py-2.5 text-xs text-slate-300">
                {it.existing && it.merged ? (
                  <>
                    <div className="mb-1 text-[11px] font-semibold text-amber-300/80">기존 카드에 더해지는 것</div>
                    <ul className="mb-2 list-disc pl-4 text-slate-300">{it.merged.changes.map((c, k) => <li key={k}>{c}</li>)}</ul>
                    <div className="mb-1 text-[11px] font-semibold text-slate-500">다시 짠 본문</div>
                    <div className="rounded-md bg-slate-950 p-2">{renderMd(it.merged.body)}</div>
                  </>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {it.concept.aliases.map((a) => chip(`별칭 ${a}`))}
                      {it.concept.topic && chip(`주제 ${it.concept.topic}`)}
                      {it.concept.tags.map((t) => chip(`#${t}`))}
                      {it.concept.links.map((l) => chip(`→ ${l}`))}
                    </div>
                    <div className="rounded-md bg-slate-950 p-2">{renderMd(it.concept.body)}</div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={() => setWithTopic((v) => !v)}
        className={`mt-1 flex items-start gap-2.5 rounded-lg border border-dashed px-3 py-2.5 text-left ${withTopic ? 'border-teal-700 bg-teal-950/30' : 'border-slate-800 opacity-70'}`}
      >
        <span className="mt-0.5">{box(withTopic)}</span>
        <span className="min-w-0">
          <span className="block font-medium">주제 카드도 만들기 — "{outline.topic.title}"</span>
          <span className="block text-xs text-slate-400">{outline.topic.oneLine}</span>
          <span className="block text-[11px] text-slate-500">위 카드들로 가는 연결을 담은 요약 한 장. 개념 카드에도 이 카드로 가는 연결이 붙어요</span>
        </span>
      </button>
    </div>,
    <>
      <button onClick={onClose} disabled={busy} className={`${btn} ml-auto`}>취소</button>
      <button onClick={() => void save(outline)} disabled={!canSave} className={primary}>
        {busy ? '저장 중…' : cta}
        {!busy && ctaParts.length > 0 && <span className="block text-[11px] font-normal opacity-80">{withTopic ? '주제 카드 1장 포함' : '주제 카드 없이'}</span>}
      </button>
    </>,
  );
}

function mostCommon(list: string[]): string {
  const count = new Map<string, number>();
  for (const s of list) count.set(s, (count.get(s) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
