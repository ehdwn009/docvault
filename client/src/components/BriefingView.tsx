import { useMemo, useRef, useState, type ReactNode } from 'react';
import { isDarkViewerTheme, type ViewerTheme } from '../lib/api';
import { editionTitle, isSafeUrl, kstTime, parseEdition, type Edition, type EditionItem, type Importance } from '../lib/briefing';
import Icon from './Icon';

// SCR-191 브리핑 뷰어 — 회차 문서(kind=briefing)를 "넓게 훑고, 궁금한 것만 깊게" 그린다.
// 목록은 중요도와 제목만, 누르면 그 자리에서 요약·의미·원문이 펼쳐진다 (뉴스 브리핑 설계 "화면")

type Props = {
  content: string;
  /** 뷰어 테마 — md는 prose가 글자색을 정하지만 이 화면은 우리가 그려서 테마를 직접 따른다 */
  theme: ViewerTheme;
  /** 브리핑 형식이 아니면(깨진 JSON·모르는 version) 대신 그릴 것 — 뷰어의 코드 렌더러 */
  fallback: ReactNode;
};

type Filter = 'all' | 'major' | 'core';
const FILTER_MIN: Record<Filter, Importance> = { all: 1, major: 2, core: 3 };
const FILTER_LABEL: Record<Filter, string> = { all: '전체', major: '주요 이상', core: '핵심만' };
/** 마지막으로 고른 필터 — 보는 취향이라 기기에 둔다 */
const FILTER_KEY = 'dv_briefing_filter';

function readFilter(): Filter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    return v === 'major' || v === 'core' ? v : 'all';
  } catch {
    return 'all';
  }
}
function writeFilter(f: Filter) {
  try {
    localStorage.setItem(FILTER_KEY, f);
  } catch {
    /* 사생활 모드 등 */
  }
}

/** 테마별 색 — Tailwind의 dark 변형은 OS 설정을 따라 뷰어 테마와 어긋나므로 쓰지 않는다 */
function palette(dark: boolean) {
  return {
    text: dark ? 'text-slate-100' : 'text-slate-900',
    accent: dark ? 'text-sky-300' : 'text-sky-700',
    updated: dark ? 'text-violet-300' : 'text-violet-700',
    major: dark ? 'bg-amber-400/20 text-amber-200' : 'bg-amber-500/20 text-amber-800',
    chip: dark ? 'bg-white/10' : 'bg-black/5',
  };
}
type Palette = ReturnType<typeof palette>;

function badgeOf(importance: Importance, p: Palette): { label: string; className: string } {
  if (importance === 3) return { label: '핵심', className: 'bg-red-600 text-white' };
  if (importance === 2) return { label: '주요', className: p.major };
  return { label: '참고', className: 'border border-current/25 opacity-60' };
}

function countIn(e: Edition, section: string, min: Importance): number {
  let n = 0;
  for (const s of e.sections) {
    if (s.section !== section) continue;
    for (const c of s.categories) for (const sub of c.subs) n += sub.items.filter((i) => i.importance >= min).length;
  }
  return n;
}

export default function BriefingView({ content, theme, fallback }: Props) {
  const edition = useMemo(() => parseEdition(content), [content]);
  const [tab, setTab] = useState<'국내' | '세계'>('국내');
  const [filter, setFilterState] = useState<Filter>(readFilter);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const categoryRefs = useRef(new Map<string, HTMLElement>());
  const p = palette(isDarkViewerTheme(theme));

  if (!edition) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm">브리핑 형식이 아니에요. 원문을 그대로 보여 드려요.</p>
        {fallback}
      </div>
    );
  }

  const min = FILTER_MIN[filter];
  const section = edition.sections.find((s) => s.section === tab);
  const visible = (section?.categories ?? [])
    .map((c) => ({ ...c, subs: c.subs.map((s) => ({ ...s, items: s.items.filter((i) => i.importance >= min) })).filter((s) => s.items.length > 0) }))
    .filter((c) => c.subs.length > 0);
  const visibleIds = visible.flatMap((c) => c.subs.flatMap((s) => s.items.map((i) => i.id)));
  const allOpen = visibleIds.length > 0 && visibleIds.every((id) => open.has(id));

  const setFilter = (f: Filter) => {
    setFilterState(f);
    writeFilter(f);
  };
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pill = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1 text-[0.85em] transition ${active ? 'bg-sky-600 text-white' : 'border border-current/20 opacity-80 hover:opacity-100'}`;

  return (
    <div className={`flex flex-col gap-4 ${p.text}`}>
      <header>
        <h1 className="m-0 text-[1.8em] font-bold leading-tight">{editionTitle(edition)}</h1>
        <p className="mt-1 text-[0.85em] opacity-60">
          {kstTime(edition.edition.since)} ~ {kstTime(edition.edition.until, false)} 기사 · {edition.stats.items}건
          {edition.stats.sourcesFailed > 0 && ` · 출처 ${edition.stats.sourcesFailed}곳 못 받음`} · 생성 비용 ≈ ${edition.cost.usd.toFixed(2)}
        </p>
      </header>

      <div className="flex gap-2 border-b border-current/15">
        {(['국내', '세계'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`-mb-px border-b-2 px-3 py-2 text-[1em] font-semibold ${tab === s ? 'border-sky-500' : 'border-transparent opacity-50 hover:opacity-80'}`}
          >
            {s} <span className="text-[0.8em] font-normal opacity-70">{countIn(edition, s, min)}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={pill(filter === f)}>
            {FILTER_LABEL[f]}
          </button>
        ))}
        <button onClick={() => setOpen(allOpen ? new Set() : new Set(visibleIds))} className="ml-auto whitespace-nowrap text-[0.85em] opacity-70 hover:opacity-100">
          {allOpen ? '모두 접기' : '모두 펼치기'}
        </button>
      </div>

      {visible.length > 1 && (
        <nav className="flex gap-2 overflow-x-auto pb-1">
          {visible.map((c) => (
            <button
              key={c.name}
              onClick={() => categoryRefs.current.get(c.name)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[0.85em] ${p.chip}`}
            >
              {c.name}
            </button>
          ))}
        </nav>
      )}

      {visible.length === 0 ? (
        <p className="py-8 text-center text-[0.9em] opacity-60">이 조건에 맞는 기사가 없어요</p>
      ) : (
        visible.map((c) => (
          <section
            key={c.name}
            ref={(el) => {
              if (el) categoryRefs.current.set(c.name, el);
              else categoryRefs.current.delete(c.name);
            }}
            className="scroll-mt-16 flex flex-col gap-3"
          >
            <h2 className="m-0 border-l-4 border-sky-500 pl-2 text-[1.25em] font-bold">{c.name}</h2>
            {c.subs.map((sub) => (
              <div key={sub.id} className="flex flex-col">
                <h3 className="m-0 mb-1 text-[0.85em] font-semibold opacity-60">{sub.name}</h3>
                <ul className="m-0 flex list-none flex-col divide-y divide-current/10 p-0">
                  {sub.items.map((item) => (
                    <ItemRow key={item.id} item={item} p={p} open={open.has(item.id)} onToggle={() => toggle(item.id)} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function ItemRow({ item, p, open, onToggle }: { item: EditionItem; p: Palette; open: boolean; onToggle: () => void }) {
  const badge = badgeOf(item.importance, p);
  return (
    <li className="m-0 p-0">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 py-2.5 text-left">
        <span className={`mt-[0.15em] shrink-0 rounded px-1.5 py-0.5 text-[0.7em] font-bold ${badge.className}`}>{badge.label}</span>
        <span className={`min-w-0 flex-1 text-[1em] leading-snug ${item.importance === 3 ? 'font-semibold' : ''}`}>
          {item.title}
          {item.status === 'updated' ? (
            <span className={`ml-1.5 align-middle text-[0.65em] font-bold ${p.updated}`}>업데이트</span>
          ) : (
            <span className={`ml-1.5 align-middle text-[0.65em] font-bold ${p.accent}`}>NEW</span>
          )}
        </span>
        <Icon name="chevron" size={16} className={`mt-[0.2em] shrink-0 opacity-40 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mb-3 ml-[2.6em] flex flex-col gap-2 text-[0.95em]">
          {item.summary && <p className="m-0 leading-relaxed">{item.summary}</p>}
          {item.why && <p className="m-0 rounded-r-md border-l-4 border-sky-500 bg-sky-500/10 px-3 py-2 leading-relaxed">{item.why}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85em]">
            <span className="opacity-60">
              {item.source} · {kstTime(item.publishedAt)}
            </span>
            {isSafeUrl(item.url) && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className={`font-medium underline ${p.accent}`}>
                원문 보기
              </a>
            )}
          </div>
          {item.related.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8em]">
              <span className="opacity-50">다른 보도</span>
              {item.related.map((r) =>
                isSafeUrl(r.url) ? (
                  <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="underline opacity-80 hover:opacity-100">
                    {r.source}
                  </a>
                ) : (
                  <span key={r.url} className="opacity-60">{r.source}</span>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
