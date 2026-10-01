import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isDarkViewerTheme, type ViewerTheme } from '../lib/api';
import {
  BRIEFING_READ_EVENT,
  isSafeUrl,
  kstTime,
  kstToday,
  leadIdsOf,
  longDate,
  outletsOf,
  parseEdition,
  SLOT_SHORT,
  slotName,
  type Edition,
  type EditionItem,
  type EditionNav,
  type Importance,
} from '../lib/briefing';
import Icon from './Icon';

// SCR-191 회차 화면 (v0.43 개편) — 회차 막대 → 오늘의 핵심 → 고정 [국내|세계]+분야 막대 → 보기 고르기 → 목록.
// 폰은 누른 자리에서 펼치고, 보이는 폭이 넓으면(PC) 목록|상세 두 칸. 읽은 기사는 흐리게, 서버에 더하기만 한다
// (뉴스 브리핑 설계 "SCR-191", 시안 https://claude.ai/artifact/55AAfNufzn4VEcD5qFBYF5)

type Props = {
  fileId: number;
  content: string;
  /** 뷰어 테마 — 이 화면은 우리가 그려서 테마를 직접 따른다 */
  theme: ViewerTheme;
  /** 고정 막대 배경 — 본문 배경(THEME_BG)과 같아야 아래 글이 비치지 않는다 */
  stickyBg: string;
  /** 활성 칸인가 — J/K/O 키는 활성 칸에서만 */
  isActive: boolean;
  onOpenFile: (fileId: number) => void;
  /** 브리핑 형식이 아니면(깨진 JSON·모르는 version) 대신 그릴 것 — 뷰어의 코드 렌더러 */
  fallback: ReactNode;
};

type Section = '국내' | '세계';
type Filter = 'all' | 'major' | 'core';
const FILTER_LABEL: Record<Filter, string> = { all: '전체', major: '주요 이상', core: '핵심만' };
const NEXT_FILTER: Record<Filter, Filter> = { all: 'major', major: 'core', core: 'all' };
const FILTER_MIN: Record<Filter, Importance> = { all: 1, major: 2, core: 3 };
/** 두 칸으로 나누는 보이는 폭 (설계 — PC 두 칸) */
const WIDE_MIN_PX = 880;
/** 읽음을 모아 보내는 간격 — 연달아 펼쳐도 요청 하나로 */
const MARK_READ_DELAY_MS = 600;
/** 회차별로 기억하는 탭 수 — 오래된 것부터 잊는다 */
const TAB_MEMORY = 60;
const FILTER_KEY = 'dv_briefing_filter';
const TAB_KEY = 'dv_briefing_tabs';

// 보는 취향은 기기에 둔다 — 사생활 모드 등에서 저장소가 막혀도 화면은 기본값으로 그린다
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
    /* 저장 못 해도 이번 화면에는 적용된다 */
  }
}
function readTabs(): [number, Section][] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TAB_KEY) ?? '[]');
    return Array.isArray(v) ? (v as [number, Section][]) : [];
  } catch {
    return [];
  }
}
function readTab(fileId: number): Section {
  return readTabs().find(([id]) => id === fileId)?.[1] ?? '국내';
}
function writeTab(fileId: number, tab: Section) {
  try {
    const rest = readTabs().filter(([id]) => id !== fileId);
    localStorage.setItem(TAB_KEY, JSON.stringify([...rest, [fileId, tab]].slice(-TAB_MEMORY)));
  } catch {
    /* 위와 같음 */
  }
}

/** 테마별 색 — Tailwind의 dark 변형은 OS 설정을 따라 뷰어 테마와 어긋나므로 쓰지 않는다.
    slate·sky는 고정 색(hex)으로 쓴다: 앱 테마(페이퍼·아이보리 등)가 그 두 램프를 뒤집어 정의해서,
    text-slate-900을 쓰면 밝은 앱 테마에서 밝은 글자가 된다 (본문 배경 THEME_BG와 같은 이유) */
function palette(dark: boolean) {
  return {
    text: dark ? 'text-[#f1f5f9]' : 'text-[#0f172a]',
    muted: dark ? 'text-[#94a3b8]' : 'text-[#64748b]',
    accent: dark ? 'text-[#7dd3fc]' : 'text-[#0369a1]',
    updated: dark ? 'text-violet-300' : 'text-violet-700',
    major: dark ? 'bg-amber-400/20 text-amber-200' : 'bg-amber-500/20 text-amber-800',
    line: dark ? 'border-white/10' : 'border-black/10',
    soft: dark ? 'bg-white/[0.06]' : 'bg-black/[0.04]',
    softer: dark ? 'bg-white/[0.04]' : 'bg-white',
    whyBg: dark ? 'bg-[#0ea5e9]/15' : 'bg-[#0ea5e9]/10',
    seg: dark ? 'bg-white/10' : 'bg-black/[0.06]',
    segOn: dark ? 'bg-[#0f172a] text-[#f1f5f9] shadow' : 'bg-white text-[#0f172a] shadow',
    chipOn: 'bg-[#0284c7] text-white',
    chip: dark ? 'bg-white/10' : 'bg-black/[0.05]',
    selected: dark ? 'bg-[#0ea5e9]/15' : 'bg-[#0ea5e9]/10',
  };
}
type Palette = ReturnType<typeof palette>;

function badgeOf(importance: Importance, p: Palette): { label: string; className: string } {
  if (importance === 3) return { label: '핵심', className: 'bg-red-600 text-white' };
  if (importance === 2) return { label: '주요', className: p.major };
  return { label: '참고', className: 'border border-current/25 opacity-60' };
}

const BASIS_LABEL: Record<NonNullable<EditionItem['basis']>, string> = { body: '본문 앞부분 기준', lede: '발췌 기준', title: '제목 기준' };

/** 기사 하나와 그 자리(국내/세계·분야) */
type Located = { item: EditionItem; section: Section; category: string; sub: string; subId: string };

function locateAll(e: Edition): Map<string, Located> {
  const m = new Map<string, Located>();
  for (const s of e.sections) for (const c of s.categories) for (const sub of c.subs) for (const item of sub.items) m.set(item.id, { item, section: s.section, category: c.name, sub: sub.name, subId: sub.id });
  return m;
}

/** "증시 · 연합뉴스 외 3곳 · 15:40 · 갱신됨" — NEW는 거의 전부라 정보가 없어서 뺐다(설계) */
function metaLine(l: Located): string {
  const more = outletsOf(l.item) - 1;
  const parts = [l.sub, more > 0 ? `${l.item.source} 외 ${more}곳` : l.item.source, kstTime(l.item.publishedAt, false)];
  if (l.item.status === 'updated') parts.push('갱신됨');
  return parts.join(' · ');
}

export default function BriefingView({ fileId, content, theme, stickyBg, isActive, onOpenFile, fallback }: Props) {
  const edition = useMemo(() => parseEdition(content), [content]);
  const located = useMemo(() => (edition ? locateAll(edition) : new Map<string, Located>()), [edition]);
  const lead = useMemo(() => (edition ? leadIdsOf(edition).map((id) => located.get(id)).filter((l): l is Located => !!l) : []), [edition, located]);
  const [tab, setTabState] = useState<Section>(() => readTab(fileId));
  const [filter, setFilterState] = useState<Filter>(readFilter);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [refOpen, setRefOpen] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(() => new Set());
  /** 지난번에 마지막으로 읽은 기사 — [이어 읽기]가 데려갈 곳. 회차는 항상 맨 위에서 열린다 (설계 SCR-191 9) */
  const [resumeId, setResumeId] = useState<string | null>(null);
  /** 그림이 바뀐 뒤 해야 할 스크롤 — 탭을 바꾸면 목록 시작, 이어 읽기면 그 기사 */
  const [pendingScroll, setPendingScroll] = useState<{ to: 'list' } | { to: 'item'; id: string } | { to: 'edge'; which: 'first' | 'last' } | null>(null);
  /** 키보드 J/K가 따라가는 줄 — 핵심 상자에서 골랐으면 핵심 순서로, 목록에서 골랐으면 목록 순서로 */
  const [cursor, setCursor] = useState<{ id: string; fromLead: boolean } | null>(null);
  const listTopRef = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState<EditionNav | null>(null);
  const [wide, setWide] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const catRefs = useRef(new Map<string, HTMLElement>());
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const pendingRead = useRef<Set<string>>(new Set());
  const p = palette(isDarkViewerTheme(theme));

  // 회차를 바꿔 열면 그 회차의 상태로 — 같은 컴포넌트가 다른 회차를 받는다(‹ › 이동)
  useEffect(() => {
    setTabState(readTab(fileId));
    setOpen(new Set());
    setRefOpen(new Set());
    setSelected(null);
    setRead(new Set());
    setResumeId(null);
    setPendingScroll(null);
    setNav(null);
    let alive = true;
    void api<{ state: { readItems?: string[] } }>(`/me/files/${fileId}/state`)
      .then((r) => {
        if (!alive) return;
        const items = r.state.readItems ?? [];
        setRead((prev) => new Set([...prev, ...items]));
        // 읽음 기록은 읽은 순서대로 쌓인다 — 마지막 것이 지난번에 멈춘 곳
        setResumeId(items.at(-1) ?? null);
      })
      .catch(() => {});
    void api<EditionNav>(`/briefing/editions/${fileId}/nav`)
      .then((r) => alive && setNav(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fileId]);

  // 보이는 폭으로 한 칸/두 칸 — 창 크기가 아니라 이 칸의 폭(분할 화면에서도 맞게)
  useEffect(() => {
    const el = rootRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= WIDE_MIN_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, [edition]);

  // 읽음은 모아서 보낸다. 실패해도 화면의 흐림은 유지 — 다음 펼침 때 함께 다시 간다
  const flushRead = useCallback(() => {
    const ids = [...pendingRead.current];
    if (ids.length === 0) return;
    pendingRead.current = new Set();
    void api(`/me/files/${fileId}/state`, { method: 'PUT', body: JSON.stringify({ markRead: ids }) })
      .then(() => window.dispatchEvent(new CustomEvent(BRIEFING_READ_EVENT, { detail: { fileId } })))
      .catch(() => ids.forEach((id) => pendingRead.current.add(id)));
  }, [fileId]);
  useEffect(() => {
    const t = window.setTimeout(flushRead, MARK_READ_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [read, flushRead]);
  useEffect(() => () => flushRead(), [flushRead]);

  const markRead = useCallback(
    (id: string) => {
      // 이번에 읽기 시작했으면 [이어 읽기]는 할 일을 다 했다
      setResumeId(null);
      setRead((prev) => {
        if (prev.has(id)) return prev;
        pendingRead.current.add(id);
        return new Set(prev).add(id);
      });
    },
    [],
  );

  // 지금 보는 분야 강조 — 고정 막대 바로 아래를 지나는 분야. 스크롤 상자를 몰라도 되게 문서 전체의 scroll을 듣는다
  useEffect(() => {
    const onScroll = () => {
      const bar = stickyRef.current?.getBoundingClientRect().bottom ?? 0;
      let cur: string | null = null;
      for (const [name, el] of catRefs.current) if (el.getBoundingClientRect().top <= bar + 8) cur = name;
      setActiveCat(cur);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  const visible = useMemo(() => {
    const section = edition?.sections.find((s) => s.section === tab);
    const min = filter === 'core' ? 3 : 2;
    return (section?.categories ?? [])
      .map((c) => ({
        name: c.name,
        subs: c.subs
          .map((s) => ({
            id: s.id,
            name: s.name,
            items: s.items.filter((i) => i.importance >= min),
            // 전체일 때 참고 기사는 세부 분야마다 접어 둔다 — 핵심·주요를 먼저 훑게
            refs: filter === 'all' ? s.items.filter((i) => i.importance === 1) : [],
          }))
          .filter((s) => s.items.length + s.refs.length > 0),
      }))
      .filter((c) => c.subs.length > 0);
  }, [edition, tab, filter]);

  /** J/K 순서 — 지금 보이는 줄 그대로 (펼친 참고 포함) */
  const order = useMemo(
    () => visible.flatMap((c) => c.subs.flatMap((s) => [...s.items, ...(refOpen.has(s.id) ? s.refs : [])].map((i) => i.id))),
    [visible, refOpen],
  );
  const leadOrder = useMemo(() => lead.map((l) => l.item.id), [lead]);
  /** 이 탭의 모든 기사 순서(필터와 상관없이) — 필터에 가려진 선택의 "가장 가까운 다음 기사"를 찾는 데 쓴다 */
  const fullOrder = useMemo(
    () => (edition?.sections.find((s) => s.section === tab)?.categories ?? []).flatMap((c) => c.subs.flatMap((s) => s.items.map((i) => i.id))),
    [edition, tab],
  );

  /** key: 펼침 자리 — 핵심 상자와 목록에 같은 기사가 있어도 따로 펼친다 */
  const pick = useCallback(
    (id: string, key: string) => {
      markRead(id);
      setCursor({ id, fromLead: key.startsWith('lead:') });
      if (wide) setSelected(id);
      else
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else {
            // 핵심 상자는 한 번에 하나만 — 여러 개 펼치면 "1분 훑기" 상자가 화면 몇 장으로 늘어났다 (사용성 평가 2026-10-01)
            if (key.startsWith('lead:')) for (const k of prev) if (k.startsWith('lead:')) next.delete(k);
            next.add(key);
          }
          return next;
        });
    },
    [wide, markRead],
  );

  /** 키보드로 기사 하나로 가기 — 두 칸이면 오른쪽에 띄우고, 한 칸이면 그 줄만 펼친다. 줄은 화면 가운데로
      (맨 아래에 붙으면 다음 기사가 안 보이고, 위로 가면 고정 막대 뒤에 숨었다) */
  const go = useCallback(
    (id: string, fromLead: boolean) => {
      const key = fromLead ? `lead:${id}` : id;
      markRead(id);
      setCursor({ id, fromLead });
      if (wide) setSelected(id);
      else setOpen(new Set([key]));
      requestAnimationFrame(() => rowRefs.current.get(key)?.scrollIntoView({ block: 'center' }));
    },
    [wide, markRead],
  );

  // 필터를 바꿔 고른 기사가 목록에서 빠지면, 그 자리에서 가장 가까운 다음 기사로 옮긴다 —
  // 숨은 기사가 오른쪽에 남고 J가 맨 앞으로 가던 것 (사용성 평가 2026-10-01)
  useEffect(() => {
    if (!wide || !selected || cursor?.fromLead || order.includes(selected)) return;
    const at = fullOrder.indexOf(selected);
    const next = order.find((id) => fullOrder.indexOf(id) >= at) ?? order.at(-1) ?? null;
    setSelected(next);
    if (next) setCursor({ id: next, fromLead: false });
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  // J/K 다음·이전 기사, O 원문 (활성 칸에서만, 입력 중·수식키 조합은 무시). 두 칸이면 오른쪽에 띄우고 한 칸이면 펼친다.
  // 목록 끝에서 J는 다른 탭의 첫 기사로, 세계 맨 앞에서 K는 국내 끝으로 — 한 회차를 키보드만으로 끝까지 읽게
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        const fromLead = cursor?.fromLead ?? false;
        const seq = fromLead ? leadOrder : order;
        const i = cursor ? seq.indexOf(cursor.id) : -1;
        e.preventDefault();
        if (k === 'j') {
          if (i < seq.length - 1) return go(seq[i + 1]!, fromLead);
          if (!fromLead && tab === '국내' && edition?.sections.some((s) => s.section === '세계')) {
            setTabState('세계');
            writeTab(fileId, '세계');
            setPendingScroll({ to: 'edge', which: 'first' });
          }
        } else {
          if (i > 0) return go(seq[i - 1]!, fromLead);
          if (i === -1 && seq[0]) return go(seq[0], fromLead);
          if (!fromLead && tab === '세계' && edition?.sections.some((s) => s.section === '국내')) {
            setTabState('국내');
            writeTab(fileId, '국내');
            setPendingScroll({ to: 'edge', which: 'last' });
          }
        }
      } else if (k === 'o' && cursor) {
        const url = located.get(cursor.id)?.item.url;
        if (url && isSafeUrl(url)) {
          markRead(cursor.id);
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, cursor, order, leadOrder, tab, edition, located, go, markRead, fileId]);

  useEffect(() => {
    if (!pendingScroll) return;
    if (pendingScroll.to === 'list') {
      const anchor = listTopRef.current;
      // 이미 목록 시작이 보이면(맨 위 근처) 움직이지 않는다
      if (anchor && anchor.getBoundingClientRect().top < 0) anchor.scrollIntoView({ block: 'start' });
    } else if (pendingScroll.to === 'edge') {
      const id = pendingScroll.which === 'first' ? order[0] : order.at(-1);
      if (id) go(id, false);
    } else {
      rowRefs.current.get(pendingScroll.id)?.scrollIntoView({ block: 'center' });
      if (wide) setSelected(pendingScroll.id);
      setCursor({ id: pendingScroll.id, fromLead: false });
    }
    setPendingScroll(null);
  }, [pendingScroll, wide]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!edition) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm">브리핑 형식이 아니에요. 원문을 그대로 보여 드려요.</p>
        {fallback}
      </div>
    );
  }

  // 바꾼 쪽 목록의 첫 기사로 — 고정 막대로 스크롤하면 이미 화면 위에 붙어 있어 아무 일도 없었고,
  // 반대쪽 목록의 같은 높이나 끝에 떨어졌다 (사용성 평가 2026-10-01). 막대 원래 자리의 표지로 간다
  const setTab = (s: Section) => {
    setTabState(s);
    writeTab(fileId, s);
    setPendingScroll({ to: 'list' });
  };
  /** 이어 읽기 — 그 기사가 다른 탭이거나, 필터에 가렸거나, 접힌 참고면 보이게 바꾼 뒤 데려간다 */
  const resume = (id: string) => {
    const l = located.get(id);
    setResumeId(null);
    if (!l) return;
    if (l.section !== tab) {
      setTabState(l.section);
      writeTab(fileId, l.section);
    }
    if ((filter === 'core' && l.item.importance < 3) || (filter === 'major' && l.item.importance < 2)) setFilter('all');
    if (l.item.importance === 1) setRefOpen((prev) => new Set(prev).add(l.subId));
    setPendingScroll({ to: 'item', id });
  };
  const setFilter = (f: Filter) => {
    setFilterState(f);
    writeFilter(f);
  };
  const toggleRef = (subId: string) =>
    setRefOpen((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId);
      else next.add(subId);
      return next;
    });

  const e = edition.edition;
  const other: Section = tab === '국내' ? '세계' : '국내';
  const hasOther = edition.sections.some((s) => s.section === other);
  const leadRead = lead.filter((l) => read.has(l.item.id)).length;
  const sel = selected ? located.get(selected) : undefined;
  const countOf = (section: Section) =>
    (edition.sections.find((s) => s.section === section)?.categories ?? []).reduce(
      (n, c) => n + c.subs.reduce((m, sub) => m + sub.items.filter((i) => i.importance >= FILTER_MIN[filter]).length, 0),
      0,
    );

  const row = (l: Located, opts: { lead?: number } = {}) => {
    const id = l.item.id;
    const key = opts.lead ? `lead:${id}` : id;
    const isOpen = !wide && open.has(key);
    // 펼친 채로 흐려지면 읽는 중인 글이 꺼진 것처럼 보인다 — 접은 뒤에 흐리게
    const isRead = read.has(id) && !isOpen && !(wide && selected === id);
    const badge = badgeOf(l.item.importance, p);
    return (
      <li
        key={key}
        ref={(el) => {
          if (el) rowRefs.current.set(key, el);
          else rowRefs.current.delete(key);
        }}
        className={`m-0 list-none border-b p-0 last:border-b-0 ${p.line}`}
      >
        <button
          onClick={() => pick(id, key)}
          aria-expanded={wide ? undefined : isOpen}
          aria-current={wide && selected === id ? 'true' : undefined}
          // 마우스 클릭에는 테두리를 그리지 않는다 — J로 옮긴 뒤에도 클릭한 줄에 테두리가 남아 선택이 둘처럼 보였다
          className={`flex w-full items-start gap-2.5 rounded-md px-1 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9] ${wide && selected === id ? p.selected : ''}`}
        >
          {opts.lead ? (
            <span className={`mt-[0.1em] w-6 shrink-0 text-center text-[0.95em] font-bold ${isRead ? 'opacity-40' : p.accent}`}>{opts.lead}</span>
          ) : (
            <span className={`mt-[0.15em] shrink-0 rounded px-1.5 py-0.5 text-[0.7em] font-bold ${badge.className} ${isRead ? 'opacity-60' : ''}`}>{badge.label}</span>
          )}
          {/* 읽은 줄은 제목 색만 낮춘다 — 줄 전체를 흐리게 하면 둘째 줄(분야·언론사·시각) 대비가 2:1까지 떨어졌다 (사용성 평가 2026-10-01) */}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {opts.lead && <span className={`text-[0.72em] font-semibold ${p.muted}`}>{`${l.section} · ${l.sub}`}</span>}
            <span className={`text-[1em] leading-snug ${isRead ? p.muted : l.item.importance === 3 ? 'font-semibold' : ''}`}>{l.item.title}</span>
            {/* 핵심 상자는 펼치지 않아도 무슨 일인지 한 줄 — 제목만으로는 고르기 어려웠다 */}
            {opts.lead && !isOpen && !(wide && selected === id) && l.item.summary && (
              <span className={`line-clamp-1 text-[0.82em] ${p.muted}`}>{l.item.summary}</span>
            )}
            {!opts.lead && (
              <span className={`text-[0.78em] ${p.muted}`}>
                {metaLine(l).replace(/ · 갱신됨$/, '')}
                {l.item.status === 'updated' && <span className={`font-semibold ${p.updated}`}> · 갱신됨</span>}
              </span>
            )}
          </span>
          {!wide && <Icon name="chevron" size={16} className={`mt-[0.2em] shrink-0 opacity-40 transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
        </button>
        {isOpen && (
          <div className={`pb-4 ${opts.lead ? 'pl-9' : 'pl-[2.9em]'}`}>
            <ItemDetail l={l} p={p} onOpened={() => markRead(id)} />
          </div>
        )}
      </li>
    );
  };

  const leadBox = lead.length > 0 && (
    <section className={`rounded-2xl px-3.5 pb-1.5 pt-3.5 ${p.soft}`}>
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 text-[1.1em] font-bold">오늘의 핵심</h2>
        <span className={`text-[0.78em] ${p.muted}`}>{lead.length}건 · 약 1분</span>
        <span className={`ml-auto text-[0.78em] font-semibold ${p.accent}`}>
          {leadRead}/{lead.length} 읽음
        </span>
      </div>
      <ul className="m-0 mt-1 p-0">{lead.map((l, i) => row(l, { lead: i + 1 }))}</ul>
    </section>
  );

  const list = (
    <>
      {/* 터치는 위쪽 바(오버레이)가 가리지 않게 그 높이만큼 띄워 멈춘다 */}
      <div ref={listTopRef} aria-hidden="true" className="touch:scroll-mt-14" />
      <nav ref={stickyRef} className={`sticky top-0 z-[2] -mx-1 flex items-center gap-2 border-b px-1 py-2 ${p.line} ${stickyBg}`}>
        <div className={`flex shrink-0 rounded-lg p-[3px] ${p.seg}`}>
          {(['국내', '세계'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              aria-pressed={tab === s}
              className={`h-8 whitespace-nowrap rounded-md px-3 text-[0.88em] font-semibold transition ${tab === s ? p.segOn : 'opacity-60'}`}
            >
              {s}
              {/* 건수 — 국내 100 대 세계 37처럼 기울어 있어도 세계가 있다는 걸 탭에서 바로 알게 (지금 보기 조건 기준) */}
              <span className="ml-1 text-[0.85em] font-normal opacity-70">{countOf(s)}</span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 gap-1.5 overflow-x-auto">
          {visible.map((c) => (
            <button
              key={c.name}
              onClick={() => catRefs.current.get(c.name)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[0.82em] transition ${activeCat === c.name ? p.chipOn : p.chip}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        {/* 한 칸(폰)에서는 보기 고르기를 막대 안에 — 아래 칸은 스크롤하면 사라져 맨 위까지 올라가야 했다 (사용성 평가 2026-10-01).
            세 버튼을 다 넣을 자리가 없어 누를 때마다 다음 보기로 돈다 */}
        {!wide && (
          <button
            onClick={() => setFilter(NEXT_FILTER[filter])}
            title="보기 바꾸기: 전체 → 주요 이상 → 핵심만"
            className={`ml-auto h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[0.82em] transition ${filter === 'all' ? `border ${p.line}` : p.chipOn}`}
          >
            {FILTER_LABEL[filter]}
          </button>
        )}
      </nav>

      <div className={`mt-3 flex-wrap gap-1.5 ${wide ? 'flex' : 'hidden'}`}>
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`h-8 whitespace-nowrap rounded-full px-3 text-[0.82em] transition ${filter === f ? p.chipOn : `border ${p.line} opacity-80 hover:opacity-100`}`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-[0.9em] opacity-60">이 조건에 맞는 기사가 없어요</p>
      ) : (
        visible.map((c) => (
          <section
            key={c.name}
            ref={(el) => {
              if (el) catRefs.current.set(c.name, el);
              else catRefs.current.delete(c.name);
            }}
            className="scroll-mt-14 pt-4"
          >
            <h2 className="m-0 mb-0.5 text-[1.15em] font-bold">{c.name}</h2>
            {c.subs.map((sub) => (
              <div key={sub.id}>
                <ul className="m-0 p-0">{sub.items.map((i) => row(located.get(i.id)!))}</ul>
                {sub.refs.length > 0 && (
                  <div className={`border-b ${p.line}`}>
                    <button onClick={() => toggleRef(sub.id)} aria-expanded={refOpen.has(sub.id)} className={`flex h-11 w-full items-center gap-2 px-1 text-left text-[0.85em] ${p.muted}`}>
                      <span className="rounded border border-current/30 px-1.5 text-[0.8em] font-bold">참고</span>
                      <span className="flex-1">
                        {sub.name} {sub.refs.length}건 {refOpen.has(sub.id) ? '접기' : '더 보기'}
                      </span>
                      <Icon name="chevron" size={14} className={`opacity-50 transition-transform ${refOpen.has(sub.id) ? 'rotate-90' : ''}`} />
                    </button>
                    {refOpen.has(sub.id) && <ul className="m-0 p-0 pl-2">{sub.refs.map((i) => row(located.get(i.id)!))}</ul>}
                  </div>
                )}
              </div>
            ))}
          </section>
        ))
      )}

      <section className={`mb-6 mt-8 flex flex-col items-center gap-2.5 rounded-2xl border border-dashed px-4 py-5 text-center ${p.line}`}>
        <p className="m-0 text-[0.95em] font-bold">이번 브리핑 끝{hasOther ? ` — ${tab}` : ''}</p>
        <div className="flex w-full gap-2">
          {nav?.prevId && (
            <button onClick={() => onOpenFile(nav.prevId!)} className={`h-11 flex-1 rounded-xl border text-[0.88em] ${p.line}`}>
              ‹ 이전 판
            </button>
          )}
          {hasOther && (
            <button onClick={() => setTab(other)} className="h-11 flex-1 rounded-xl bg-[#0284c7] text-[0.88em] font-semibold text-white">
              {other === '세계' ? '세계 보기' : '국내로'}
            </button>
          )}
        </div>
      </section>
    </>
  );

  return (
    <div ref={rootRef} className={`mx-auto flex flex-col gap-4 ${p.text} ${wide ? 'max-w-[1400px]' : 'max-w-3xl'}`}>
      <header className="flex flex-col gap-2.5">
        <div className="flex items-center gap-1">
          <NavButton label="이전 회차" disabled={!nav?.prevId} onClick={() => nav?.prevId && onOpenFile(nav.prevId)} p={p} flip />
          <div className="min-w-0 flex-1 text-center">
            <h1 className="m-0 text-[1.2em] font-bold leading-tight">
              {longDate(e.date)} {slotName(e.slot, e.label)}
            </h1>
            <p className={`m-0 mt-0.5 text-[0.78em] ${p.muted}`}>
              {/* 날짜가 다르면 날짜를 붙인다 — 24시간 범위가 "14:51–14:51"로 0분처럼 읽혔다 */}
              {kstToday(e.since) === kstToday(e.until)
                ? `${kstTime(e.since, false)}–${kstTime(e.until, false)}`
                : `${kstTime(e.since)} – ${kstTime(e.until)}`}{' '}
              기사 · {edition.stats.items}건
              {edition.stats.sourcesFailed > 0 && ` · 출처 ${edition.stats.sourcesFailed}곳 못 받음`}
            </p>
            <p className={`m-0 mt-0.5 text-[0.72em] ${p.muted}`}>제목·요약은 AI가 기사를 읽고 다시 쓴 글이에요 · 원문으로 확인하세요</p>
          </div>
          <NavButton label="다음 회차" disabled={!nav?.nextId} onClick={() => nav?.nextId && onOpenFile(nav.nextId)} p={p} />
        </div>
        {nav && nav.sameDay.length > 1 && (
          <div className="flex justify-center gap-1.5">
            {nav.sameDay.map((d) => (
              <button
                key={d.fileId}
                onClick={() => d.fileId !== fileId && onOpenFile(d.fileId)}
                aria-current={d.fileId === fileId ? 'true' : undefined}
                className={`h-9 min-w-[3.5rem] rounded-lg px-2.5 text-[0.8em] font-semibold transition ${d.fileId === fileId ? p.chipOn : p.chip}`}
              >
                {d.slot === 'adhoc' ? slotName(d.slot, d.label).replace(' 수시판', '') : SLOT_SHORT[d.slot]}
              </button>
            ))}
          </div>
        )}
        {resumeId && located.has(resumeId) && (
          <button
            onClick={() => resume(resumeId)}
            className={`mx-auto flex h-9 items-center gap-1.5 rounded-full border px-4 text-[0.82em] font-semibold ${p.line} ${p.accent}`}
          >
            이어 읽기 <Icon name="chevron" size={14} className="rotate-90" />
          </button>
        )}
      </header>

      {wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            {leadBox}
            <div>{list}</div>
          </div>
          <aside className={`sticky top-4 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border p-5 ${p.line}`}>
            {sel ? (
              <div className="flex flex-col gap-3">
                <p className={`m-0 text-[0.78em] font-semibold ${p.muted}`}>
                  {sel.section} · {sel.category} · {sel.sub}
                </p>
                <h2 className="m-0 text-[1.3em] font-bold leading-snug">{sel.item.title}</h2>
                <ItemDetail l={sel} p={p} onOpened={() => markRead(sel.item.id)} />
              </div>
            ) : (
              <p className={`m-0 py-10 text-center text-[0.9em] ${p.muted}`}>
                기사를 고르면 여기에 펼쳐집니다
                <br />
                <span className="text-[0.85em]">J/K 다음·이전 · O 원문</span>
              </p>
            )}
          </aside>
        </div>
      ) : (
        <>
          {leadBox}
          <div>{list}</div>
        </>
      )}
    </div>
  );
}

function NavButton({ label, disabled, onClick, p, flip = false }: { label: string; disabled: boolean; onClick: () => void; p: Palette; flip?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition disabled:opacity-25 ${p.line}`}
    >
      <Icon name="chevron" size={18} className={flip ? 'rotate-180' : ''} />
    </button>
  );
}

/** 펼친 내용 — 요약 → 왜 중요한가 → 언론사·시각·근거 → [원문 보기] → 다른 보도 */
function ItemDetail({ l, p, onOpened }: { l: Located; p: Palette; onOpened: () => void }) {
  const { item } = l;
  // 칸 구성(v0.43): 무슨 일·배경·숫자로 보면·앞으로 — 요약 한 덩어리는 제목을 되풀이해 읽을 것이 없었다. 빈 칸은 숨긴다
  const parts = item.detail
    ? ([
        ['무슨 일', item.summary],
        ['배경', item.detail.background],
        ['숫자로 보면', item.detail.numbers],
        ['앞으로', item.detail.next],
      ] as const).filter(([, text]) => text)
    : null;
  return (
    <div className="flex flex-col gap-2.5 text-[0.95em]">
      {parts ? (
        <dl className="m-0 flex flex-col gap-2.5">
          {parts.map(([label, text]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className={`text-[0.72em] font-bold ${p.muted}`}>{label}</dt>
              <dd className="m-0 leading-relaxed">{text}</dd>
            </div>
          ))}
        </dl>
      ) : item.summary ? (
        <p className="m-0 leading-relaxed">{item.summary}</p>
      ) : (
        <p className={`m-0 text-[0.9em] ${p.muted}`}>요약이 없는 기사예요 · 원문을 확인하세요</p>
      )}
      {item.why && (
        <div className={`flex flex-col gap-0.5 rounded-xl px-3 py-2.5 ${p.whyBg}`}>
          <span className={`text-[0.72em] font-bold ${p.accent}`}>왜 중요한가</span>
          <span className="text-[0.95em] leading-relaxed">{item.why}</span>
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-x-2 text-[0.78em] ${p.muted}`}>
        <span>
          {item.source} · {kstTime(item.publishedAt)}
          {item.status === 'updated' && ' · 갱신됨'}
        </span>
        {(item.summary || item.detail) && <span className="ml-auto">AI 요약{item.basis ? ` · ${BASIS_LABEL[item.basis]}` : ''}</span>}
      </div>
      {isSafeUrl(item.url) && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpened}
          className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border text-[0.9em] font-semibold no-underline ${p.line} ${p.softer} ${p.text}`}
        >
          원문 보기 <Icon name="external" size={15} className="opacity-60" />
        </a>
      )}
      {item.related.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8em]">
          <span className={p.muted}>다른 보도</span>
          {item.related.map((r) =>
            isSafeUrl(r.url) ? (
              <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className={`underline ${p.accent}`}>
                {r.source}
              </a>
            ) : (
              <span key={r.url} className="opacity-60">
                {r.source}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
