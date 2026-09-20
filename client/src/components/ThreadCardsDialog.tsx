import { Suspense, useEffect, useRef, useState } from 'react';
import { api, ApiError, cardToTreeFile, type CardBatchResult, type CardOutline, type CardOutlineItem, type CardSummary, type TreeFile } from '../lib/api';
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

type Step =
  | { kind: 'checking' } // 저장된 정리가 있나 보는 중
  | { kind: 'choose' } // 시작 전 선택 — 개념별 / 한 장 (D1)
  | { kind: 'generating'; since: number } // 1단계: 개념 목록 뽑는 중
  | { kind: 'error'; message: string }
  | { kind: 'list'; outline: CardOutline };

const MdRenderer = renderers.md;
/** 2단계 본문 요청을 동시에 몇 개까지 — 너무 많이 쏘면 서버가 LLM 호출을 한꺼번에 연다 */
const ITEM_CONCURRENCY = 3;

// SCR-183: 대화 정리 — 시작 전에 방식을 고르고(D1), 결과는 대화에 저장돼 다시 열어도 그대로(C1),
// 개념 목록이 먼저 뜨고 본문은 항목별로 뒤에서 채워진다(B1). "개념 하나 = 카드 한 장"은 이어쓰기 배지가 지킨다.
export default function ThreadCardsDialog({ threadId, isPc, onClose, onWholeAsOne, onSaved }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [withTopic, setWithTopic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // 언마운트 뒤 도착한 응답은 버린다. 효과 안에서 true로 되돌리는 이유: 개발 모드(StrictMode)는 마운트 → 정리 → 마운트를
  // 한 번 더 돌리는데, 정리에서 false로 만든 채 두면 두 번째 마운트가 영원히 "죽은" 상태가 된다
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 저장된 정리가 있으면 바로 목록으로, 없으면 선택 화면 — 누르자마자 LLM을 부르지 않는다
  useEffect(() => {
    void api<{ outline: CardOutline | null }>(`/cards/outline?threadId=${threadId}`)
      .then((r) => {
        if (!aliveRef.current) return;
        if (r.outline) showList(r.outline);
        else setStep({ kind: 'choose' });
      })
      .catch(() => aliveRef.current && setStep({ kind: 'choose' }));
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 기다리는 동안 초를 센다 — "멈춘 건가"가 사라진다
  useEffect(() => {
    if (step.kind !== 'generating') return;
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - step.since) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [step]);

  function showList(outline: CardOutline) {
    setStep({ kind: 'list', outline });
    setChecked(new Set(outline.items.map((_, i) => i))); // 기본은 전부 체크 — 빼는 쪽이 고르는 쪽보다 적다
    setExpanded(new Set(outline.items.length > 0 ? [0] : []));
    void fillBodies(outline);
  }

  async function generate() {
    setStep({ kind: 'generating', since: Date.now() });
    setElapsed(0);
    try {
      const outline = await api<CardOutline>('/cards/outline', { method: 'POST', body: JSON.stringify({ threadId }) });
      if (aliveRef.current) showList(outline);
    } catch (e) {
      if (aliveRef.current) setStep({ kind: 'error', message: e instanceof ApiError ? e.message : '대화를 정리하지 못했습니다' });
    }
  }

  /** 2단계 — 아직 본문이 없는 항목을 몇 개씩 동시에 채운다. 도착하는 대로 그 항목만 갈아끼운다 */
  async function fillBodies(outline: CardOutline) {
    const queue = outline.items.map((it, i) => ({ it, i })).filter((x) => !x.it.ready);
    const worker = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        try {
          const r = await api<{ item: CardOutlineItem }>('/cards/outline/item', { method: 'POST', body: JSON.stringify({ threadId, title: next.it.concept.title }) });
          if (!aliveRef.current) return;
          setStep((s) => (s.kind === 'list' ? { kind: 'list', outline: { ...s.outline, items: s.outline.items.map((it, i) => (i === next.i ? r.item : it)) } } : s));
        } catch {
          // 한 항목이 실패해도 나머지는 계속 — 실패한 항목은 "초안 쓰는 중"으로 남고 저장 때 걸린다
        }
      }
    };
    await Promise.all(Array.from({ length: ITEM_CONCURRENCY }, worker));
  }

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
            ? { title: existing.title, oneLine: merged.oneLine, aliases: merged.aliases, kind: merged.kind, topic: existing.topic, tags: merged.tags, links: merged.links, body: merged.body, existingCardId: existing.id }
            : { title: concept.title, oneLine: concept.oneLine, aliases: concept.aliases, kind: concept.kind, topic: concept.topic, tags: concept.tags, links: concept.links, body: concept.body },
        );
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
          {/* shrink-0: 부제가 길면 제목이 세로로 부서졌다 — 제목은 절대 안 줄이고 부제만 자른다 */}
          <h3 className="shrink-0 whitespace-nowrap text-sm font-semibold">대화 정리</h3>
          <span className="min-w-0 truncate text-xs text-slate-500">{subtitle}</span>
          <button onClick={onClose} disabled={busy} className="ml-auto shrink-0 px-1 text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{body}</div>
        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pc:pb-3">{footer}</div>
      </div>
    </>
  );
  const btn = 'rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40';
  const primary = 'rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-40';

  if (step.kind === 'checking') {
    return shell('', <p className="py-10 text-center text-sm text-slate-500">지난 정리가 있는지 보는 중…</p>, <button onClick={onClose} className={`${btn} ml-auto`}>취소</button>);
  }

  if (step.kind === 'choose') {
    return shell(
      '이 대화를 어떻게 카드로 만들까요',
      <div className="flex flex-col gap-3">
        <button onClick={() => void generate()} className="rounded-xl border-2 border-teal-600 bg-slate-900 p-4 text-left hover:bg-slate-800">
          <div className="font-semibold">개념별로 나누기</div>
          <div className="mt-1 text-sm text-slate-400">AI가 대화에서 개념을 뽑아 체크리스트로 보여 줘요. 이미 있는 카드와 같은 개념은 이어쓰기로. 고른 것만 카드가 됩니다</div>
          <div className="mt-2 text-[11px] text-slate-500">목록은 몇 초, 본문은 그 뒤에 항목별로 채워져요 · 결과는 저장돼서 나갔다 와도 그대로</div>
        </button>
        <button onClick={onWholeAsOne} className="rounded-xl border-2 border-slate-700 bg-slate-900 p-4 text-left hover:bg-slate-800">
          <div className="font-semibold">전부 한 장으로</div>
          <div className="mt-1 text-sm text-slate-400">대화 전체를 카드 한 장 초안으로. 개념이 여럿이면 표나 소제목으로 묶여요</div>
          <div className="mt-2 text-[11px] text-slate-500">한 개념을 깊게 판 대화에 맞아요</div>
        </button>
      </div>,
      <button onClick={onClose} className={`${btn} ml-auto`}>취소</button>,
    );
  }

  if (step.kind === 'generating') {
    return shell(
      '',
      <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-400">
        <p>AI가 대화에서 개념을 뽑고, 이미 있는 카드와 겹치는지 보는 중…</p>
        <p className="text-xs text-slate-600">{elapsed}초 · 보통 5~15초 걸려요. 목록이 뜨면 본문은 뒤에서 채워집니다</p>
      </div>,
      <button onClick={onClose} className={`${btn} ml-auto`}>취소</button>,
    );
  }
  if (step.kind === 'error') {
    return shell(
      '',
      <p className="py-6 text-sm text-red-300">{step.message}</p>,
      <>
        <button onClick={() => setStep({ kind: 'choose' })} className={`${btn} ml-auto`}>돌아가기</button>
        <button onClick={() => void generate()} className={primary}>다시 시도</button>
      </>,
    );
  }

  const { outline } = step;
  const picked = outline.items.filter((_, i) => checked.has(i));
  const fresh = picked.filter((it) => !it.existing).length;
  const merge = picked.length - fresh;
  const pending = picked.filter((it) => !it.ready).length;
  const ctaParts = [];
  if (fresh) ctaParts.push(`카드 ${fresh}장 만들기`);
  if (merge) ctaParts.push(`${merge}장 이어쓰기`);
  const cta = ctaParts.length ? ctaParts.join(' + ') : withTopic ? '주제 카드만 만들기' : '고른 개념이 없어요';
  const canSave = !busy && pending === 0 && (picked.length > 0 || withTopic);
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
  const madeAt = new Date(outline.outlineAt);
  const madeLabel = `${madeAt.getMonth() + 1}/${madeAt.getDate()} ${String(madeAt.getHours()).padStart(2, '0')}:${String(madeAt.getMinutes()).padStart(2, '0')}`;

  return shell(
    `${outline.source} · 개념 ${outline.items.length}개`,
    <div className="flex flex-col gap-2 text-sm">
      {/* 요약 한 줄 + 다시 만들기 — 머리와 목록 사이의 구분선 역할도 한다 */}
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800 pb-2 text-[11px] text-slate-500">
        <span>정리 {madeLabel} · 새 카드 {outline.items.filter((it) => !it.existing).length} · 이어쓰기 {outline.items.filter((it) => it.existing).length}</span>
        {pending > 0 && <span className="text-teal-400">본문 쓰는 중 {pending}</span>}
        <span className="ml-auto flex gap-2">
          <button onClick={() => void generate()} disabled={busy} className="hover:text-slate-300">다시 만들기</button>
          <button onClick={onWholeAsOne} disabled={busy} className="hover:text-slate-300">한 장으로 바꾸기</button>
        </span>
      </div>
      {outline.stale && (
        <div className="flex items-center gap-2 rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          이 정리 뒤에 대화에 답이 더 붙었어요
          <button onClick={() => void generate()} className="ml-auto rounded border border-amber-700 px-2 py-0.5 hover:bg-amber-900/40">새로 정리</button>
        </div>
      )}
      {outline.items.length === 0 && <p className="py-4 text-center text-slate-500">이 대화에서는 카드로 만들 개념을 찾지 못했어요. "한 장으로 바꾸기"를 써 보세요.</p>}
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
                {!it.ready ? (
                  <p className="text-slate-500">{it.existing ? '기존 카드와 합쳐 다시 짜는 중…' : '본문 초안 쓰는 중…'}</p>
                ) : it.existing && it.merged ? (
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
      <button onClick={onClose} disabled={busy} className={`${btn} ml-auto`}>닫기</button>
      <button onClick={() => void save(outline)} disabled={!canSave} className={primary}>
        {busy ? '저장 중…' : cta}
        {!busy && ctaParts.length > 0 && (
          <span className="block text-[11px] font-normal opacity-80">{pending > 0 ? `본문 ${pending}개 쓰는 중 — 끝나면 눌러요` : withTopic ? '주제 카드 1장 포함' : '주제 카드 없이'}</span>
        )}
      </button>
    </>,
  );
}

function mostCommon(list: string[]): string {
  const count = new Map<string, number>();
  for (const s of list) count.set(s, (count.get(s) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
