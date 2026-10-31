import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api, ApiError, isDarkViewerTheme, type ViewerTheme } from '../lib/api';
import { ASK_QUOTE_MAX_CHARS } from '../lib/constants';
import {
  BLOCK_LABEL,
  BRIEFING_READ_EVENT,
  EXPLAIN_LABEL,
  FLAG_LABEL,
  IMPACT_WORD,
  isSafeUrl,
  kstTime,
  kstToday,
  leadIdsOf,
  LENS_LABEL,
  longDate,
  outletsOf,
  parseEdition,
  slotShort,
  slotName,
  type Block,
  type Edition,
  type EditionItem,
  type EditionNav,
  type ExplainBlock,
  type FlagReason,
  type Importance,
  type LensKey,
  type ReaderResult,
  W5_KEYS,
  W5_LABEL,
} from '../lib/briefing';
import Icon from './Icon';
import type { AskSeed } from './AskPanel';

// SCR-191 회차 화면 (v0.45 개편, 개선 합의안 6장) — 회차 막대 → 오늘의 핵심 → 고정 [국내|세계]+분야 막대 → 목록.
// 폰: 핵심·주요는 전체 화면 시트로 열고(아래 고정 이전·다음, 좌우 밀기, 뒤로 제스처로 닫힘), 참고는 그 자리에서 펼친다.
// PC(보이는 폭 넓음): 목록|상세 두 칸. 상세는 리드 → 왜 중요한가 → 영향 → 골라 쓴 칸 → 해설 상자(접힘, v0.48) → 근거 줄 → 원문 카드 → 묻기.
// 요약 보기(기본·글머리표·5W·양쪽 시각)는 기기가 기억하지만 해설 상자는 기사마다 접힌 채 시작한다. 원문을 다녀오면 그 기사로 돌아온다.
// 상세 안의 드래그는 여기서 직접 읽어 묻기로 보낸다 — 폰 시트는 뷰어의 본문 상자 밖(fixed)이라 뷰어의 선택 흐름이 닿지 않는다 (해설 칸 토론 2026-10-15)
// (뉴스 브리핑 설계 "SCR-191", 시안 docs/뉴스브리핑_개선시안_20261011.html)

type Props = {
  fileId: number;
  content: string;
  /** 뷰어 테마 — 이 화면은 우리가 그려서 테마를 직접 따른다 */
  theme: ViewerTheme;
  /** 고정 막대·시트 배경 — 본문 배경(THEME_BG)과 같아야 아래 글이 비치지 않는다 */
  stickyBg: string;
  /** 활성 칸인가 — J/K/O/R/A 키는 활성 칸에서만 */
  isActive: boolean;
  /** 앱 안 원문 보기가 켜져 있나 (설정 → 뉴스 브리핑) */
  readerEnabled: boolean;
  onOpenFile: (fileId: number) => void;
  /** 이 기사에 대해 묻기 — 기사 id와 고른 문장만 넘긴다. 문맥(우리가 쓴 글 전체)은 서버가 회차에서 조립한다(원문은 질문 기록에 저장되므로 넘기지 않는다) */
  onAsk?: (seed: AskSeed) => void;
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
/** 원문을 다녀온 뒤 이 시간 안에 앱이 다시 뜨면 그 기사로 돌아온다 (개선 합의안 6.4) */
const RETURN_WINDOW_MS = 30 * 60 * 1000;
/** 좌우로 이만큼 밀면 이전·다음 기사 */
const SWIPE_PX = 60;
const FILTER_KEY = 'dv_briefing_filter';
const TAB_KEY = 'dv_briefing_tabs';
const LENS_KEY = 'dv_briefing_lens';
const RETURN_KEY = 'dv_briefing_return';
const LENS_KEYS: LensKey[] = ['base', 'bullets', 'w5', 'sides'];

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
function readLens(): LensKey {
  try {
    const v = localStorage.getItem(LENS_KEY);
    return LENS_KEYS.includes(v as LensKey) ? (v as LensKey) : 'base';
  } catch {
    return 'base';
  }
}
function writeLens(l: LensKey) {
  try {
    localStorage.setItem(LENS_KEY, l);
  } catch {
    /* 위와 같음 */
  }
}
type ReturnMark = { fileId: number; itemId: string; at: number };
function writeReturn(mark: ReturnMark) {
  try {
    localStorage.setItem(RETURN_KEY, JSON.stringify(mark));
  } catch {
    /* 돌아올 때 맨 위에서 열릴 뿐이다 */
  }
}
/** 한 번만 돌아온다 — 읽고 나면 지운다. 다른 회차 것이거나 30분이 지났으면 null */
function takeReturn(fileId: number): string | null {
  try {
    const raw = localStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as ReturnMark;
    if (Date.now() - m.at > RETURN_WINDOW_MS) {
      localStorage.removeItem(RETURN_KEY);
      return null;
    }
    if (m.fileId !== fileId) return null;
    localStorage.removeItem(RETURN_KEY);
    return typeof m.itemId === 'string' ? m.itemId : null;
  } catch {
    return null;
  }
}
/** 주소의 #a=기사id — 뒤로 제스처로 시트가 닫히게 기록을 쌓는다. 값은 회차의 기사 id 목록에 있을 때만 쓴다 */
function hashItemId(): string | null {
  const m = /^#a=([\w.-]{1,80})$/.exec(location.hash);
  return m ? m[1]! : null;
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
    updatedBg: dark ? 'bg-violet-400/15' : 'bg-violet-500/10',
    warn: dark ? 'text-amber-300' : 'text-amber-700',
    major: dark ? 'bg-amber-400/20 text-amber-200' : 'bg-amber-500/20 text-amber-800',
    line: dark ? 'border-white/10' : 'border-black/10',
    whyLine: dark ? 'border-[#38bdf8]' : 'border-[#0284c7]',
    soft: dark ? 'bg-white/[0.06]' : 'bg-black/[0.04]',
    softer: dark ? 'bg-white/[0.04]' : 'bg-white',
    seg: dark ? 'bg-white/10' : 'bg-black/[0.06]',
    segOn: dark ? 'bg-[#0f172a] text-[#f1f5f9] shadow' : 'bg-white text-[#0f172a] shadow',
    chipOn: 'bg-[#0284c7] text-white',
    chip: dark ? 'bg-white/10' : 'bg-black/[0.05]',
    selected: dark ? 'bg-[#0ea5e9]/15' : 'bg-[#0ea5e9]/10',
    scrim: dark ? 'bg-black/60' : 'bg-black/40',
  };
}
type Palette = ReturnType<typeof palette>;

function badgeOf(importance: Importance, p: Palette): { label: string; className: string } {
  if (importance === 3) return { label: '핵심', className: 'bg-red-600 text-white' };
  if (importance === 2) return { label: '주요', className: p.major };
  return { label: '참고', className: 'border border-current/25 opacity-60' };
}

/** 기사 하나와 그 자리(국내/세계·분야) */
type Located = { item: EditionItem; section: Section; category: string; sub: string; subId: string };

function locateAll(e: Edition): Map<string, Located> {
  const m = new Map<string, Located>();
  for (const s of e.sections) for (const c of s.categories) for (const sub of c.subs) for (const item of sub.items) m.set(item.id, { item, section: s.section, category: c.name, sub: sub.name, subId: sub.id });
  return m;
}

/** "증시 · 연합뉴스 외 3곳 · 15:40" — NEW는 거의 전부라 정보가 없어서 뺐다(설계). 갱신됨은 따로 색을 준다 */
function metaLine(l: Located): string {
  const more = outletsOf(l.item) - 1;
  return [l.sub, more > 0 ? `${l.item.source} 외 ${more}곳` : l.item.source, kstTime(l.item.publishedAt, false)].join(' · ');
}

/** 옛 회차(v0.43 detail)도 같은 모양으로 — blocks → detail → summary 순 */
function blocksOf(it: EditionItem): Block[] {
  if (it.blocks) return it.blocks;
  if (!it.detail) return [];
  const out: Block[] = [];
  if (it.detail.background) out.push({ kind: 'background', text: it.detail.background, from: [] });
  if (it.detail.numbers) out.push({ kind: 'numbers', text: it.detail.numbers, from: [] });
  if (it.detail.next) out.push({ kind: 'next', text: it.detail.next, from: [] });
  return out;
}

/** 이 기사에서 고를 수 있는 보기 — 보기 글이 있는 것만 */
function lensesOf(it: EditionItem): LensKey[] {
  const out: LensKey[] = ['base'];
  if (it.lenses?.bullets) out.push('bullets');
  // v0.46의 w5(근거 있음)가 먼저, 옛 회차는 lenses.w5. "쉽게"(lenses.easy)는 옛 회차에 남아 있어도 보이지 않는다
  if (it.w5 || it.lenses?.w5) out.push('w5');
  if (it.sides) out.push('sides');
  return out;
}

/** 재료 기호 → 언론사 이름. 본문·웹 재료가 2곳 이상일 때만 문단 끝에 보인다 (출처 번호 대신, 개선 합의안 6.2) */
function fromNames(it: EditionItem, from: string[]): string {
  const bodies = (it.sources ?? []).filter((s) => s.via !== 'lede');
  if (bodies.length < 2 || from.length === 0) return '';
  const names = [...new Set(from.map((id) => it.sources?.find((s) => s.id === id)?.source).filter((x): x is string => !!x))];
  return names.join('·');
}

/** 근거 줄 — 무엇을 보고 쓴 요약인지. 얇을 때만 경고색 */
function basisLine(it: EditionItem): { text: string; warn: boolean } {
  const bodies = (it.sources ?? []).filter((s) => s.via !== 'lede');
  const names = [...new Set(bodies.map((s) => s.source))].slice(0, 3).join('·');
  if (it.basis === 'web') return { text: `웹 검색으로 찾은 ${names || '다른 보도'}를 읽고 AI가 정리`, warn: false };
  if (it.basis === 'body') return { text: `${names ? `${names} 본문` : '본문 앞부분'}을 읽고 AI가 정리`, warn: false };
  if (it.basis === 'lede') return { text: '짧은 발췌만 보고 쓴 요약 — 원문으로 확인하세요', warn: true };
  if (it.basis === 'title') return { text: '제목만 보고 쓴 요약 — 원문으로 확인하세요', warn: true };
  return { text: 'AI가 쓴 요약', warn: false };
}

/** 첫 문장만 굵게 — 리드는 라벨 없이 첫 문장이 소제목 노릇을 한다 */
function splitLead(text: string): [string, string] {
  const m = /^(.+?[.!?。])\s+([\s\S]+)$/.exec(text.trim());
  return m ? [m[1]!, m[2]!] : [text.trim(), ''];
}

export default function BriefingView({ fileId, content, theme, stickyBg, isActive, readerEnabled, onOpenFile, onAsk, fallback }: Props) {
  const edition = useMemo(() => parseEdition(content), [content]);
  const located = useMemo(() => (edition ? locateAll(edition) : new Map<string, Located>()), [edition]);
  const lead = useMemo(() => (edition ? leadIdsOf(edition).map((id) => located.get(id)).filter((l): l is Located => !!l) : []), [edition, located]);
  const [tab, setTabState] = useState<Section>(() => readTab(fileId));
  const [filter, setFilterState] = useState<Filter>(readFilter);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [refOpen, setRefOpen] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  /** 폰 시트에 열린 기사 */
  const [sheet, setSheet] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const [flagged, setFlagged] = useState<Set<string>>(() => new Set());
  const [lens, setLensState] = useState<LensKey>(readLens);
  /** 요약 ↔ 원문. 기사를 바꾸면 요약으로 돌아간다 */
  const [mode, setMode] = useState<'sum' | 'read'>('sum');
  const [readers, setReaders] = useState<Map<string, { status: 'loading' | 'ok' | 'fail'; data?: ReaderResult; message?: string }>>(() => new Map());
  /** 지난번에 마지막으로 읽은 기사 — [이어 읽기]가 데려갈 곳. 회차는 항상 맨 위에서 열린다 (설계 SCR-191 9) */
  const [resumeId, setResumeId] = useState<string | null>(null);
  /** 그림이 바뀐 뒤 해야 할 스크롤 — 탭을 바꾸면 목록 시작, 이어 읽기면 그 기사 */
  const [pendingScroll, setPendingScroll] = useState<{ to: 'list' } | { to: 'item'; id: string } | { to: 'edge'; which: 'first' | 'last' } | null>(null);
  /** 키보드 J/K·시트의 이전·다음이 따라가는 줄 — 핵심 상자에서 골랐으면 핵심 순서로, 목록에서 골랐으면 목록 순서로 */
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
  /** 원문을 다녀와 복귀할 기사 — located가 준비된 뒤 한 번 */
  const returnRef = useRef<string | null>(null);
  const p = palette(isDarkViewerTheme(theme));

  // 회차를 바꿔 열면 그 회차의 상태로 — 같은 컴포넌트가 다른 회차를 받는다(‹ › 이동)
  useEffect(() => {
    setTabState(readTab(fileId));
    setOpen(new Set());
    setRefOpen(new Set());
    setSelected(null);
    setSheet(null);
    setMode('sum');
    setReaders(new Map());
    setRead(new Set());
    setFlagged(new Set());
    setResumeId(null);
    setPendingScroll(null);
    setNav(null);
    returnRef.current = takeReturn(fileId) ?? hashItemId();
    let alive = true;
    void api<{ state: { readItems?: string[]; flagItems?: { id: string }[] } }>(`/me/files/${fileId}/state`)
      .then((r) => {
        if (!alive) return;
        const items = r.state.readItems ?? [];
        setRead((prev) => new Set([...prev, ...items]));
        setFlagged(new Set((r.state.flagItems ?? []).map((f) => f.id)));
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

  const markRead = useCallback((id: string) => {
    // 이번에 읽기 시작했으면 [이어 읽기]는 할 일을 다 했다
    setResumeId(null);
    setRead((prev) => {
      if (prev.has(id)) return prev;
      pendingRead.current.add(id);
      return new Set(prev).add(id);
    });
  }, []);

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

  /** J/K·이전·다음 순서 — 지금 보이는 줄 그대로 (펼친 참고 포함, 제목만인 참고는 뺀다) */
  const order = useMemo(
    () => visible.flatMap((c) => c.subs.flatMap((s) => [...s.items, ...(refOpen.has(s.id) ? s.refs.filter((r) => !r.titleOnly) : [])].map((i) => i.id))),
    [visible, refOpen],
  );
  const leadOrder = useMemo(() => lead.map((l) => l.item.id), [lead]);
  /** 이 탭의 모든 기사 순서(필터와 상관없이) — 필터에 가려진 선택의 "가장 가까운 다음 기사"를 찾는 데 쓴다 */
  const fullOrder = useMemo(
    () => (edition?.sections.find((s) => s.section === tab)?.categories ?? []).flatMap((c) => c.subs.flatMap((s) => s.items.map((i) => i.id))),
    [edition, tab],
  );

  const setLens = (l: LensKey) => {
    setLensState(l);
    writeLens(l);
  };

  /** 원문을 새 탭으로 — 돌아오면 이 기사로 복귀하게 표시를 남긴다 */
  const openOriginal = useCallback(
    (id: string) => {
      const url = located.get(id)?.item.url;
      if (!url || !isSafeUrl(url)) return;
      markRead(id);
      writeReturn({ fileId, itemId: id, at: Date.now() });
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [located, fileId, markRead],
  );

  /** 폰 시트 열기 — 주소에 #a=기사id를 쌓아 뒤로 제스처로 닫히게. 이전·다음은 기록을 바꿔치기(쌓이지 않게) */
  const openSheet = useCallback((id: string, how: 'push' | 'replace') => {
    setSheet(id);
    setMode('sum');
    const url = `${location.pathname}#a=${id}`;
    if (how === 'push' && !(history.state as { dvBriefingItem?: string } | null)?.dvBriefingItem) history.pushState({ dvBriefingItem: id }, '', url);
    else history.replaceState({ dvBriefingItem: id }, '', url);
  }, []);
  const closeSheet = useCallback(() => {
    setSheet(null);
    setMode('sum');
    if ((history.state as { dvBriefingItem?: string } | null)?.dvBriefingItem) history.back();
  }, []);
  useEffect(() => {
    const onPop = () => {
      const st = history.state as { dvBriefingItem?: string } | null;
      if (!st?.dvBriefingItem) {
        setSheet(null);
        setMode('sum');
      } else if (located.has(st.dvBriefingItem)) setSheet(st.dvBriefingItem);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [located]);

  /** key: 펼침 자리 — 핵심 상자와 목록에 같은 기사가 있어도 따로 펼친다 */
  const pick = useCallback(
    (id: string, key: string) => {
      const it = located.get(id)?.item;
      if (!it) return;
      // 제목만인 참고는 펼칠 것이 없다 — 바로 원문으로
      if (it.titleOnly) return openOriginal(id);
      markRead(id);
      setCursor({ id, fromLead: key.startsWith('lead:') });
      if (wide) {
        setSelected(id);
        setMode('sum');
      } else if (it.importance >= 2) {
        // 핵심·주요는 전체 화면 — 목록 안에서 들여쓴 채 펼치면 360px 폭에서 글 폭이 290px로 줄어 긴 글을 넣을 수 없다 (개선 합의안 6.2)
        openSheet(id, 'push');
      } else
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
    },
    [wide, markRead, located, openOriginal, openSheet],
  );

  /** 키보드·이전·다음으로 기사 하나로 가기 — 두 칸이면 오른쪽에, 한 칸이면 시트를 바꿔 끼운다 */
  const go = useCallback(
    (id: string, fromLead: boolean) => {
      const key = fromLead ? `lead:${id}` : id;
      const it = located.get(id)?.item;
      markRead(id);
      setCursor({ id, fromLead });
      if (wide) {
        setSelected(id);
        setMode('sum');
        requestAnimationFrame(() => rowRefs.current.get(key)?.scrollIntoView({ block: 'center' }));
      } else if (it && it.importance >= 2) openSheet(id, sheet ? 'replace' : 'push');
      else {
        setSheet(null);
        setOpen(new Set([key]));
        requestAnimationFrame(() => rowRefs.current.get(key)?.scrollIntoView({ block: 'center' }));
      }
    },
    [wide, markRead, located, openSheet, sheet],
  );

  // 원문을 다녀왔거나 주소에 기사가 있으면 그 기사로 — 회차는 맨 위에서 열린다는 규칙의 유일한 예외 (개선 합의안 6.4)
  useEffect(() => {
    const id = returnRef.current;
    if (!id || !edition) return;
    returnRef.current = null;
    const l = located.get(id);
    if (!l || l.item.titleOnly) return;
    if (l.section !== tab) {
      setTabState(l.section);
      writeTab(fileId, l.section);
    }
    if (l.item.importance === 1) setRefOpen((prev) => new Set(prev).add(l.subId));
    if (wide || l.item.importance >= 2) {
      setCursor({ id, fromLead: false });
      if (wide) setSelected(id);
      else openSheet(id, hashItemId() === id ? 'replace' : 'push');
    } else setPendingScroll({ to: 'item', id });
  }, [edition, located, wide]); // eslint-disable-line react-hooks/exhaustive-deps

  // 필터를 바꿔 고른 기사가 목록에서 빠지면, 그 자리에서 가장 가까운 다음 기사로 옮긴다 —
  // 숨은 기사가 오른쪽에 남고 J가 맨 앞으로 가던 것 (사용성 평가 2026-10-01)
  useEffect(() => {
    if (!wide || !selected || cursor?.fromLead || order.includes(selected)) return;
    const at = fullOrder.indexOf(selected);
    const next = order.find((id) => fullOrder.indexOf(id) >= at) ?? order.at(-1) ?? null;
    setSelected(next);
    if (next) setCursor({ id: next, fromLead: false });
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 지금 기사 기준 이전·다음 — 시트의 아래 막대와 J/K가 같은 규칙 */
  const step = useCallback(
    (dir: 1 | -1): boolean => {
      const fromLead = cursor?.fromLead ?? false;
      const seq = fromLead ? leadOrder : order;
      const i = cursor ? seq.indexOf(cursor.id) : -1;
      const nextId = i === -1 ? (dir === 1 ? seq[0] : seq.at(-1)) : seq[i + dir];
      if (!nextId) return false;
      go(nextId, fromLead);
      return true;
    },
    [cursor, leadOrder, order, go],
  );
  const stepPos = useMemo(() => {
    if (!cursor) return null;
    const seq = cursor.fromLead ? leadOrder : order;
    const i = seq.indexOf(cursor.id);
    return i === -1 ? null : { i, n: seq.length };
  }, [cursor, leadOrder, order]);

  /** 앱 안 원문 — 기사 id만 보낸다. 받은 글은 화면 상태에만 있고 회차를 바꾸면 사라진다 */
  const loadReader = useCallback(
    (id: string) => {
      setReaders((prev) => {
        if (prev.has(id)) return prev;
        const next = new Map(prev);
        next.set(id, { status: 'loading' });
        return next;
      });
      void api<ReaderResult>(`/briefing/editions/${fileId}/items/${encodeURIComponent(id)}/reader`)
        .then((data) => setReaders((prev) => new Map(prev).set(id, { status: 'ok', data })))
        .catch((e: unknown) => setReaders((prev) => new Map(prev).set(id, { status: 'fail', message: e instanceof ApiError ? e.message : '원문을 받지 못했어요' })));
    },
    [fileId],
  );
  const canRead = useCallback((it: EditionItem | undefined) => !!it?.readUrl && readerEnabled, [readerEnabled]);
  const currentId = wide ? selected : sheet;
  useEffect(() => {
    if (mode !== 'read' || !currentId) return;
    const it = located.get(currentId)?.item;
    if (!canRead(it) || readers.has(currentId)) return;
    loadReader(currentId);
  }, [mode, currentId, located, canRead, readers, loadReader]);

  /** 기사 묻기 — pick이 있으면 고른 문장이 인용, 없으면 제목. 원문 탭에서 고른 문장(fromOriginal)은 그 호출에만 싣고 기록에 남기지 않는다.
      문맥은 클라이언트가 만들지 않는다 — 서버가 회차에서 "우리가 쓴 글 전체"를 조립해야 원문이 섞이지 않는다 (해설 칸 토론 B, 개선 합의안 6.6) */
  const ask = useCallback(
    (id: string, pick?: { quote: string; fromOriginal: boolean }) => {
      const it = located.get(id)?.item;
      if (!it || !onAsk) return;
      onAsk({ quote: (pick?.quote ?? it.title).slice(0, ASK_QUOTE_MAX_CHARS), context: '', itemId: it.id, ...(pick?.fromOriginal ? { transientQuote: true } : {}) });
    },
    [located, onAsk],
  );

  const flag = useCallback(
    (id: string, reason: FlagReason) => {
      setFlagged((prev) => new Set(prev).add(id));
      void api(`/me/files/${fileId}/state`, { method: 'PUT', body: JSON.stringify({ flag: { id, reason } }) }).catch(() => {});
    },
    [fileId],
  );

  // J/K 다음·이전 기사, O 원문(앱 안 또는 새 탭), Shift+O 새 탭, R 요약↔원문, A 묻기, Esc 시트 닫기 (활성 칸에서만, 입력 중·수식키 조합은 무시).
  // 목록 끝에서 J는 다른 탭의 첫 기사로, 세계 맨 앞에서 K는 국내 끝으로 — 한 회차를 키보드만으로 끝까지 읽게
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' && sheet) return closeSheet();
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        if (step(k === 'j' ? 1 : -1)) return;
        const fromLead = cursor?.fromLead ?? false;
        if (k === 'j' && !fromLead && tab === '국내' && edition?.sections.some((s) => s.section === '세계')) {
          setTabState('세계');
          writeTab(fileId, '세계');
          setPendingScroll({ to: 'edge', which: 'first' });
        } else if (k === 'k' && !fromLead && tab === '세계' && edition?.sections.some((s) => s.section === '국내')) {
          setTabState('국내');
          writeTab(fileId, '국내');
          setPendingScroll({ to: 'edge', which: 'last' });
        }
      } else if (k === 'o' && cursor) {
        if (!e.shiftKey && canRead(located.get(cursor.id)?.item)) setMode('read');
        else openOriginal(cursor.id);
      } else if (k === 'r' && cursor && canRead(located.get(cursor.id)?.item)) {
        setMode((m) => (m === 'read' ? 'sum' : 'read'));
      } else if (k === 'a' && cursor) {
        ask(cursor.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, cursor, tab, edition, located, step, fileId, sheet, closeSheet, canRead, openOriginal, ask]);

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
  const sheetItem = sheet ? located.get(sheet) : undefined;
  const countOf = (section: Section) =>
    (edition.sections.find((s) => s.section === section)?.categories ?? []).reduce(
      (n, c) => n + c.subs.reduce((m, sub) => m + sub.items.filter((i) => i.importance >= FILTER_MIN[filter]).length, 0),
      0,
    );

  const detailProps = (l: Located) => ({
    l,
    p,
    lens: lensesOf(l.item).includes(lens) ? lens : ('base' as LensKey),
    setLens,
    mode: canRead(l.item) ? mode : ('sum' as const),
    setMode,
    canRead: canRead(l.item),
    reader: readers.get(l.item.id),
    onOpenOriginal: () => openOriginal(l.item.id),
    onRetryReader: () => {
      setReaders((prev) => {
        const next = new Map(prev);
        next.delete(l.item.id);
        return next;
      });
    },
    flagged: flagged.has(l.item.id),
    onFlag: (reason: FlagReason) => flag(l.item.id, reason),
    onAsk: onAsk ? () => ask(l.item.id) : undefined,
    // 영향 칸·해설 상자는 회차가 켜 둔 경우에만(v0.46·v0.48). 옛 회차에는 그 칸이 없다
    impactOn: edition?.impactVisible === true,
    explainOn: edition?.explainVisible === true,
  });
  /** 상세 안에서 고른 문장으로 묻기 — 원문 탭이면 그 문장은 기록에 남기지 않는다 */
  const askQuote = (id: string, quote: string) => {
    const it = located.get(id)?.item;
    if (!it) return;
    ask(id, { quote, fromOriginal: mode === 'read' && canRead(it) });
    window.getSelection()?.removeAllRanges();
  };
  const wideDetailRef = useRef<HTMLDivElement>(null);
  const wideQuote = useQuote(wideDetailRef, wide && !!sel && !!onAsk);

  const row = (l: Located, opts: { lead?: number } = {}) => {
    const id = l.item.id;
    const key = opts.lead ? `lead:${id}` : id;
    const isOpen = !wide && open.has(key);
    const isCurrent = (wide && selected === id) || (!wide && sheet === id);
    // 펼친 채로 흐려지면 읽는 중인 글이 꺼진 것처럼 보인다 — 접은 뒤에 흐리게
    const isRead = read.has(id) && !isOpen && !isCurrent;
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
          aria-expanded={wide || l.item.importance >= 2 ? undefined : isOpen}
          aria-current={isCurrent ? 'true' : undefined}
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
            {opts.lead && !isOpen && !isCurrent && l.item.summary && <span className={`line-clamp-1 text-[0.82em] ${p.muted}`}>{l.item.summary}</span>}
            {!opts.lead && (
              <span className={`text-[0.78em] ${p.muted}`}>
                {metaLine(l)}
                {l.item.status === 'updated' && <span className={`font-semibold ${p.updated}`}> · 갱신됨</span>}
                {l.item.titleOnly && <span className={`ml-1.5 rounded border border-dashed px-1 text-[0.9em] ${p.line}`}>제목만 · 원문 ↗</span>}
              </span>
            )}
            {/* 갱신된 기사만 셋째 줄 — 같은 이야기를 다시 펼쳐 읽는 낭비가 더 크다 (개선 합의안 6.1) */}
            {!opts.lead && l.item.changed && <span className={`line-clamp-1 text-[0.78em] ${p.updated}`}>지난 판 이후: {l.item.changed}</span>}
          </span>
          {!wide && !l.item.titleOnly && (
            <Icon name={l.item.importance >= 2 ? 'chevron' : 'chevron'} size={16} className={`mt-[0.2em] shrink-0 opacity-40 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          )}
          {!wide && l.item.titleOnly && <Icon name="external" size={14} className="mt-[0.25em] shrink-0 opacity-40" />}
        </button>
        {isOpen && (
          <div className="px-1 pb-4">
            <ItemDetail {...detailProps(l)} compact />
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
                {d.slot === 'adhoc' ? slotName(d.slot, d.label).replace(' 수시판', '') : slotShort(d.slot, d.label)}
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
          <aside className={`sticky top-4 flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border ${p.line}`}>
            {sel ? (
              <>
                <DetailTop l={sel} p={p} mode={canRead(sel.item) ? mode : 'sum'} setMode={setMode} canRead={canRead(sel.item)} />
                <div ref={wideDetailRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <ItemDetail {...detailProps(sel)} />
                </div>
                {wideQuote ? (
                  <AskBar p={p} quote={wideQuote} onAsk={() => askQuote(sel.item.id, wideQuote)} />
                ) : (
                  <StepBar p={p} pos={stepPos} onStep={step} hint="J/K 이동 · O 원문 · Shift+O 새 탭 · R 요약/원문 · A 묻기" />
                )}
              </>
            ) : (
              <p className={`m-0 px-5 py-10 text-center text-[0.9em] ${p.muted}`}>
                기사를 고르면 여기에 펼쳐집니다
                <br />
                <span className="text-[0.85em]">J/K 다음·이전 · O 원문 · A 묻기</span>
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

      {/* 폰 시트 — 핵심·주요를 전체 화면으로. 뒤로 제스처(popstate)와 [← 목록]으로 닫힌다 */}
      {!wide && sheetItem && (
        <Sheet
          p={p}
          stickyBg={stickyBg}
          l={sheetItem}
          onClose={closeSheet}
          onStep={step}
          pos={stepPos}
          mode={canRead(sheetItem.item) ? mode : 'sum'}
          setMode={setMode}
          canRead={canRead(sheetItem.item)}
          onAskQuote={onAsk ? (q) => askQuote(sheetItem.item.id, q) : undefined}
        >
          <ItemDetail {...detailProps(sheetItem)} />
        </Sheet>
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

/** 상세 머리 — 분야 경로와 [요약|원문] 전환(앱 안 원문이 될 때만) */
function DetailTop({ l, p, mode, setMode, canRead, onClose }: { l: Located; p: Palette; mode: 'sum' | 'read'; setMode: (m: 'sum' | 'read') => void; canRead: boolean; onClose?: () => void }) {
  return (
    <div className={`flex h-12 shrink-0 items-center gap-2 border-b px-3 ${p.line}`}>
      {onClose && (
        <button onClick={onClose} className="flex h-10 shrink-0 items-center gap-0.5 pr-2 text-[0.9em] font-semibold">
          <Icon name="chevron" size={16} className="rotate-180" /> 목록
        </button>
      )}
      <span className={`min-w-0 flex-1 truncate text-[0.78em] font-semibold ${p.muted}`}>
        {l.section} · {l.category} · {l.sub}
      </span>
      {canRead && (
        <div className={`flex shrink-0 rounded-lg p-[3px] ${p.seg}`}>
          {(['sum', 'read'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={`h-7 rounded-md px-3 text-[0.8em] font-semibold transition ${mode === m ? p.segOn : 'opacity-60'}`}>
              {m === 'sum' ? '요약' : '원문'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 상세 상자 안의 드래그를 읽는다 — 선택이 상자 안에 있을 때만, 손을 뗀 뒤 잠시 모아서. 뷰어의 readOwnSelection과 같은 방식 */
function useQuote(ref: RefObject<HTMLElement | null>, on: boolean): string | null {
  const [quote, setQuote] = useState<string | null>(null);
  useEffect(() => {
    if (!on) {
      setQuote(null);
      return;
    }
    let timer = 0;
    const read = () => {
      const sel = window.getSelection();
      const box = ref.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !box || !box.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        setQuote(null);
        return;
      }
      const q = sel.toString().replace(/\s+/g, ' ').trim().slice(0, ASK_QUOTE_MAX_CHARS);
      setQuote(q || null);
    };
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 300);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.clearTimeout(timer);
    };
  }, [ref, on]);
  return quote;
}

/** 문장을 고르면 이동 막대 자리에 통째로 들어서는 묻기 막대 — 같은 높이라 밀기 영역이 흔들리지 않고, 엄지 자리라 iOS 선택 메뉴와 안 겹친다 */
function AskBar({ p, quote, onAsk }: { p: Palette; quote: string; onAsk: () => void }) {
  return (
    <div className={`shrink-0 border-t ${p.line}`}>
      <div className="flex h-12 items-center gap-2 px-3">
        <button onClick={onAsk} className="h-10 min-w-0 flex-1 truncate rounded-lg bg-sky-600 px-4 text-[0.9em] font-semibold text-white">
          💬 「{quote.length > 12 ? `${quote.slice(0, 12)}…` : quote}」 물어보기
        </button>
        <button onClick={() => window.getSelection()?.removeAllRanges()} className={`h-10 w-10 shrink-0 rounded-lg border ${p.line}`} aria-label="선택 풀기">
          ✕
        </button>
      </div>
    </div>
  );
}

/** 아래 고정 이동 막대 — ‹ 이전 · 3/18 · 다음 › */
function StepBar({ p, pos, onStep, hint }: { p: Palette; pos: { i: number; n: number } | null; onStep: (dir: 1 | -1) => boolean; hint?: string }) {
  return (
    <div className={`shrink-0 border-t ${p.line}`}>
      <div className="grid h-12 grid-cols-[1fr_auto_1fr] items-center px-3">
        <button onClick={() => onStep(-1)} disabled={!pos || pos.i <= 0} className="h-10 justify-self-start font-semibold disabled:opacity-30">
          ‹ 이전
        </button>
        <span className={`text-[0.78em] tabular-nums ${p.muted}`}>{pos ? `${pos.i + 1} / ${pos.n}` : ''}</span>
        <button onClick={() => onStep(1)} disabled={!pos || pos.i >= pos.n - 1} className="h-10 justify-self-end font-semibold disabled:opacity-30">
          다음 ›
        </button>
      </div>
      {hint && <p className={`m-0 px-3 pb-2 text-center text-[0.68em] ${p.muted}`}>{hint}</p>}
    </div>
  );
}

/** 폰 전체 화면 시트 — 좌우로 밀면 이전·다음 */
function Sheet({
  p,
  stickyBg,
  l,
  onClose,
  onStep,
  pos,
  mode,
  setMode,
  canRead,
  onAskQuote,
  children,
}: {
  p: Palette;
  stickyBg: string;
  l: Located;
  onClose: () => void;
  onStep: (dir: 1 | -1) => boolean;
  pos: { i: number; n: number } | null;
  mode: 'sum' | 'read';
  setMode: (m: 'sum' | 'read') => void;
  canRead: boolean;
  /** 시트 안에서 고른 문장으로 묻기 — 없으면 묻기 기능이 꺼진 것 */
  onAskQuote?: (quote: string) => void;
  children: ReactNode;
}) {
  const touch = useRef<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const quote = useQuote(scrollRef, !!onAskQuote);
  // 기사를 바꾸면 맨 위부터
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [l.item.id, mode]);
  return (
    <div className={`fixed inset-0 z-40 flex flex-col ${stickyBg} ${p.text}`} style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} role="dialog" aria-modal="true">
      <DetailTop l={l} p={p} mode={mode} setMode={setMode} canRead={canRead} onClose={onClose} />
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const s = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          // 선택 손잡이를 끄는 중에는 밀기가 아니다 — 60px 넘게 끌었다고 다음 기사로 튀지 않게
          if (quote) return;
          if (Math.abs(dx) >= SWIPE_PX && Math.abs(dy) < SWIPE_PX * 0.7) onStep(dx < 0 ? 1 : -1);
        }}
      >
        {children}
      </div>
      {quote && onAskQuote ? <AskBar p={p} quote={quote} onAsk={() => onAskQuote(quote)} /> : <StepBar p={p} pos={pos} onStep={onStep} />}
    </div>
  );
}

type DetailProps = {
  l: Located;
  p: Palette;
  lens: LensKey;
  setLens: (l: LensKey) => void;
  mode: 'sum' | 'read';
  setMode: (m: 'sum' | 'read') => void;
  canRead: boolean;
  reader?: { status: 'loading' | 'ok' | 'fail'; data?: ReaderResult; message?: string };
  onOpenOriginal: () => void;
  onRetryReader: () => void;
  flagged: boolean;
  onFlag: (reason: FlagReason) => void;
  onAsk?: () => void;
  /** 영향 칸을 그리나 — 회차의 impactVisible */
  impactOn: boolean;
  /** 해설 상자를 그리나 — 회차의 explainVisible (v0.48) */
  explainOn: boolean;
  /** 목록 안 펼침(참고) — 제목·배지는 줄에 이미 있으니 뺀다 */
  compact?: boolean;
};

/** 펼친 내용 (개선 합의안 6.2) — 제목 → 출처 줄 → 바뀐 점 → 보기 칩 → 리드 → 왜 중요한가 → 칸 → 근거 줄 → 원문 카드 → 묻기 */
function ItemDetail(props: DetailProps) {
  const { l, p, lens, setLens, mode, compact } = props;
  const { item } = l;
  const [flagOpen, setFlagOpen] = useState(false);
  const badge = badgeOf(item.importance, p);
  const lensKeys = lensesOf(item);
  const bodies = (item.sources ?? []).filter((s) => s.via !== 'lede');
  const basis = basisLine(item);
  const more = outletsOf(item) - 1;

  if (mode === 'read') return <ReaderBody {...props} />;

  return (
    <div className="flex flex-col gap-3.5 text-[0.95em]">
      {!compact && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[0.7em] font-bold ${badge.className}`}>{badge.label}</span>
            <span className={`text-[0.75em] font-semibold ${p.muted}`}>{l.sub}</span>
          </div>
          <h2 className="m-0 text-[1.3em] font-bold leading-snug">{item.title}</h2>
          <p className={`m-0 text-[0.8em] ${p.muted}`}>
            {more > 0 ? `${item.source} 외 ${more}곳 보도` : item.source}
            {bodies.length > 0 && ` · ${bodies.length}곳 ${item.basis === 'web' ? '보도' : '본문'} 정리`} · {kstTime(item.publishedAt)}
            {item.status === 'updated' && <span className={`font-semibold ${p.updated}`}> · 갱신됨</span>}
          </p>
        </div>
      )}
      {item.changed && (
        <p className={`m-0 flex items-baseline gap-2 rounded-lg px-3 py-1.5 text-[0.85em] ${p.updatedBg} ${p.updated}`}>
          <b className="shrink-0">지난 판 이후</b>
          <span>{item.changed}</span>
        </p>
      )}
      {lensKeys.length > 1 && (
        <div className="-mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5" role="group" aria-label="요약 보기">
          {lensKeys.map((k) => (
            <button key={k} onClick={() => setLens(k)} aria-pressed={lens === k} className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[0.8em] font-semibold transition ${lens === k ? p.chipOn : `border ${p.line} opacity-80`}`}>
              {LENS_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      {lens === 'bullets' && item.lenses?.bullets ? (
        <ul className="m-0 flex flex-col gap-1.5 pl-5">
          {item.lenses.bullets.map((b, i) => (
            <li key={i} className="leading-relaxed">
              {b}
            </li>
          ))}
        </ul>
      ) : lens === 'w5' && (item.w5 || item.lenses?.w5) ? (
        <W5Table item={item} p={p} />
      ) : lens === 'sides' && item.sides ? (
        <div className="flex flex-col gap-2">
          <span className={`text-[0.75em] font-semibold ${p.muted}`}>{item.sides.kind === 'dispute' ? '찬반이 갈리는 쟁점' : '언론사마다 강조한 점'}</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {item.sides.items.map((s, i) => (
              <div key={i} className={`flex flex-col gap-1 rounded-xl px-3 py-2.5 ${p.soft}`}>
                <b className="text-[0.95em]">{s.label}</b>
                <p className="m-0 text-[0.92em] leading-relaxed">{s.text}</p>
                <span className={`text-[0.75em] ${p.muted}`}>{item.sources?.find((x) => x.id === s.from)?.source ?? ''}</span>
              </div>
            ))}
          </div>
          <span className={`text-[0.72em] ${p.muted}`}>언론사 원문에서 쓴 것 · 한쪽 주장만 있으면 이 보기는 나오지 않아요</span>
        </div>
      ) : (
        <BaseBody item={item} p={p} impactOn={props.impactOn} explainOn={props.explainOn} />
      )}
      {lens === 'bullets' && <span className={`text-[0.72em] ${p.muted}`}>기본 보기의 요약을 다시 쓴 것이라 새 사실은 들어가지 않아요</span>}
      {lens === 'w5' && <span className={`text-[0.72em] ${p.muted}`}>{item.w5 ? '원문을 읽은 요약이 같이 쓴 것 · 기사에 없는 칸은 비워 둬요' : '기본 보기의 요약을 다시 쓴 것이라 새 사실은 들어가지 않아요'}</span>}

      {(item.summary || item.titleOnly) && (
        <div className={`flex items-baseline gap-2 border-t pt-2.5 text-[0.78em] ${p.line} ${basis.warn ? p.warn : p.muted}`}>
          <span>{basis.text}</span>
          {props.flagged ? (
            <span className={`ml-auto shrink-0 font-semibold ${p.accent}`}>알렸어요</span>
          ) : (
            <button onClick={() => setFlagOpen((v) => !v)} className={`ml-auto shrink-0 underline underline-offset-2 ${p.muted}`}>
              틀린 곳 알리기
            </button>
          )}
        </div>
      )}
      {flagOpen && !props.flagged && (
        <div className={`flex flex-col gap-1.5 rounded-xl border p-2.5 ${p.line}`}>
          <span className="text-[0.85em] font-bold">어디가 틀렸나요?</span>
          {(Object.keys(FLAG_LABEL) as FlagReason[]).map((r) => (
            <button
              key={r}
              onClick={() => {
                props.onFlag(r);
                setFlagOpen(false);
              }}
              className={`h-10 rounded-lg border px-3 text-left text-[0.9em] font-semibold ${p.line}`}
            >
              {FLAG_LABEL[r]}
            </button>
          ))}
          <span className={`text-[0.72em] ${p.muted}`}>한 번 누르면 끝나요. 이번 달 신고 수는 브리핑 패널에 보여요</span>
        </div>
      )}

      <OriginalCard {...props} />

      {props.onAsk && (
        <button onClick={props.onAsk} className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-[0.9em] font-bold ${p.soft}`}>
          <Icon name="sparkle" size={15} /> 이 기사 묻기
        </button>
      )}
    </div>
  );
}

/** 5W(v0.46) — 칸마다 근거 언론사, 없는 칸은 "기사에 없음". 옛 회차(lenses.w5)는 글자만 */
function W5Table({ item, p }: { item: EditionItem; p: Palette }) {
  const old = item.lenses?.w5;
  return (
    <dl className={`m-0 grid grid-cols-[4.6em_1fr] overflow-hidden rounded-xl border text-[0.95em] ${p.line}`}>
      {W5_KEYS.map((k) => {
        const field = item.w5?.[k];
        const text = field?.text ?? old?.[k] ?? '';
        return [
          <dt key={`${k}-t`} className={`border-b px-2.5 py-2 font-bold ${p.line} ${p.soft} ${p.accent}`}>
            {W5_LABEL[k]}
          </dt>,
          <dd key={`${k}-d`} className={`m-0 flex items-baseline justify-between gap-2 border-b px-2.5 py-2 ${p.line} ${text ? '' : p.muted}`}>
            <span>{text || '기사에 없음'}</span>
            {field && <From item={item} from={field.from} p={p} />}
          </dd>,
        ];
      })}
    </dl>
  );
}

/** 영향 칸(v0.46, 영향 칸 토론) — 점선 상자(보조·추론의 기호), 색 없음. 기사가 말한 줄은 낱말(부담/기회/갈림)과 근거 언론사,
    AI가 짚은 줄은 낱말 없이 "AI 추론"으로 따로 표시한다(사용자 결정 2026-10-11). 성립하지 않으면 상자 자체가 없다 */
function ImpactBox({ item, p }: { item: EditionItem; p: Palette }) {
  const lines = item.impact ?? [];
  if (lines.length === 0) return null;
  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-dashed px-3 py-2.5 ${p.line}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <b className="text-[0.92em]">영향</b>
        <span className={`text-[0.72em] ${p.muted}`}>기사가 말한 영향은 언론사, AI가 짚은 것은 "AI 추론"으로 표시해요 · 전망이 아니에요</span>
      </div>
      {lines.map((line, i) => {
        const word = line.kind === 'stated' ? IMPACT_WORD[line.direction] : '';
        const src = line.kind === 'stated' ? fromNames(item, [line.from]) || item.sources?.find((x) => x.id === line.from)?.source || '' : 'AI 추론';
        return (
          <div key={i} className="flex flex-col gap-0.5">
            <span className="text-[0.9em] font-bold">
              {line.target}
              {word && <span className={`font-normal ${p.muted}`}> · </span>}
              {word}
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <p className="m-0 flex-1 text-[0.92em] leading-relaxed">{line.text}</p>
              <span className={`shrink-0 text-[0.75em] ${line.kind === 'inferred' ? `rounded-full border px-1.5 ${p.line}` : ''} ${p.muted}`}>{src}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 기본 보기 — 리드(첫 문장 굵게) → 왜 중요한가(왼쪽 선) → 영향(점선 상자, v0.46) → 칸(문단 첫머리 굵은 라벨, 숫자는 칩, 경과는 날짜 열) → 해설 상자(접힘, v0.48) */
function BaseBody({ item, p, impactOn, explainOn }: { item: EditionItem; p: Palette; impactOn: boolean; explainOn: boolean }) {
  const blocks = blocksOf(item);
  if (!item.summary && !item.why && blocks.length === 0) {
    return <p className={`m-0 text-[0.9em] ${p.muted}`}>{item.titleOnly ? '재료가 없어 제목만 실었어요 · 원문에서 확인하세요' : '요약이 없는 기사예요 · 원문을 확인하세요'}</p>;
  }
  const [first, rest] = splitLead(item.summary);
  return (
    <div className="flex flex-col gap-3">
      {item.summary && (
        <p className="m-0 text-[1.02em] leading-[1.7]">
          <b>{first}</b>
          {rest && ` ${rest}`}
          <From item={item} from={item.summaryFrom ?? []} p={p} />
        </p>
      )}
      {item.why && (
        <p className={`m-0 border-l-[3px] pl-3 leading-relaxed ${p.whyLine}`}>
          <b className={p.accent}>왜 중요한가</b> · {item.why}
          <From item={item} from={item.whyFrom ?? []} p={p} />
        </p>
      )}
      {impactOn && <ImpactBox item={item} p={p} />}
      {blocks.map((b, i) => (
        <div key={i} className="leading-relaxed">
          {b.pairs ? (
            <>
              <b>{BLOCK_LABEL[b.kind]}</b>
              <From item={item} from={b.from} p={p} />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {b.pairs.map((x, j) => (
                  <span key={j} className={`flex flex-col rounded-lg px-2.5 py-1 leading-tight ${p.soft}`}>
                    <span className={`text-[0.7em] ${p.muted}`}>{x.label}</span>
                    <b className="text-[0.95em] tabular-nums">{x.value}</b>
                  </span>
                ))}
              </div>
            </>
          ) : b.items ? (
            <>
              <b>{BLOCK_LABEL[b.kind]}</b>
              <From item={item} from={b.from} p={p} />
              <div className={`mt-1.5 flex flex-col border-l-2 pl-3 ${p.line}`}>
                {b.items.map((x, j) => (
                  <div key={j} className="grid grid-cols-[4.5em_1fr] gap-2 py-1 text-[0.92em]">
                    <span className={`tabular-nums ${p.muted}`}>{x.date}</span>
                    <span>{x.text}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="m-0">
              <b>{BLOCK_LABEL[b.kind]} · </b>
              {b.text}
              <From item={item} from={b.from} p={p} />
            </p>
          )}
        </div>
      ))}
      {explainOn && <ExplainBox key={item.id} item={item} p={p} />}
    </div>
  );
}

const EXPLAIN_PEEK: Record<ExplainBlock['kind'], string> = { terms: '말뜻', why: '왜', effect: '그래서', watch: '다음' };

/** 해설 상자(v0.48, 해설 칸 토론 — 에이전트 4인 합의) — 기본 보기 맨 아래의 점선 상자. 탭이 아닌 이유: 보기 칩은 기기가 기억해 한 번 고르면 다음 기사부터
    AI 글로 열린다. 기사마다 접힌 채 시작하고 기억하지 않는다(key=item.id). 접힌 줄에 용어를 미리 보여 "이 말이 뭐지"가 한 번 눌러 끝나게.
    칸 제목 옆 기호는 영향 칸과 같은 둘뿐 — 기사가 말한 칸은 언론사 이름, 기사 밖·AI가 짚은 칸은 "AI 추론" 알약. 칸이 없으면 상자도 없다 */
function ExplainBox({ item, p }: { item: EditionItem; p: Palette }) {
  const blocks = item.explain ?? [];
  const [open, setOpen] = useState(false);
  if (blocks.length === 0) return null;
  const terms = blocks.find((b) => b.kind === 'terms')?.items ?? [];
  const peek = terms.length > 0 ? terms.map((t) => t.term).join(' · ') : blocks.map((b) => EXPLAIN_PEEK[b.kind]).join(' · ');
  return (
    <div className={`rounded-xl border border-dashed ${p.line}`}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex h-11 w-full items-center gap-2 px-3 text-left">
        <b className="shrink-0 text-[0.92em]">해설</b>
        <span className={`min-w-0 flex-1 truncate text-[0.82em] ${p.muted}`}>{peek}</span>
        <Icon name="chevron" size={14} className={`shrink-0 opacity-60 transition ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <span className={`text-[0.72em] ${p.muted}`}>요약을 보고 AI가 푼 글 · 기사가 아니에요 · 제도·수치는 바뀔 수 있어요</span>
          {blocks.map((b) => {
            const src = b.basis === 'stated' ? fromNames(item, b.from) || item.sources?.find((x) => x.id === b.from[0])?.source || '' : 'AI 추론';
            return (
              <div key={b.kind} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-[0.9em]">{EXPLAIN_LABEL[b.kind]}</b>
                  <span className={`shrink-0 text-[0.75em] ${b.basis === 'stated' ? '' : `rounded-full border px-1.5 ${p.line}`} ${p.muted}`}>{b.basis === 'stated' ? `— ${src}` : src}</span>
                </div>
                {b.items ? (
                  b.items.map((t, i) => (
                    <p key={i} className="m-0 text-[0.92em] leading-relaxed">
                      <b>{t.term}</b> — {t.text}
                    </p>
                  ))
                ) : (
                  <p className="m-0 text-[0.92em] leading-relaxed">{b.text}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 문단 끝의 근거 언론사 — 본문을 2곳 이상 읽었을 때만 */
function From({ item, from, p }: { item: EditionItem; from: string[]; p: Palette }) {
  const names = fromNames(item, from);
  return names ? <span className={`ml-1.5 whitespace-nowrap text-[0.75em] ${p.muted}`}>— {names}</span> : null;
}

/** 원문 카드 — 원 제목이 큰 글자(AI 제목과 견주는 기준), [앱에서 읽기] 또는 [사이트에서 열기 ↗], 다른 보도 */
function OriginalCard({ l, p, canRead, setMode, onOpenOriginal }: DetailProps) {
  const { item } = l;
  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 ${p.line}`}>
      <span className={`text-[0.72em] ${p.muted}`}>원문</span>
      <span className="text-[0.98em] font-bold leading-snug">{item.originalTitle ?? item.title}</span>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8em] ${p.muted}`}>
        <span>
          {item.source} · {kstTime(item.publishedAt)}
        </span>
        {canRead ? (
          <button onClick={() => setMode('read')} className={`ml-auto font-bold ${p.accent}`}>
            앱에서 읽기
          </button>
        ) : (
          isSafeUrl(item.url) && (
            <button onClick={onOpenOriginal} className={`ml-auto flex items-center gap-1 font-bold ${p.accent}`}>
              사이트에서 열기 <Icon name="external" size={13} />
            </button>
          )
        )}
      </div>
      {canRead && isSafeUrl(item.url) && (
        <button onClick={onOpenOriginal} className={`self-start text-[0.78em] underline underline-offset-2 ${p.muted}`}>
          사이트에서 열기 ↗
        </button>
      )}
      {item.related.length > 0 && (
        <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t pt-1.5 text-[0.8em] ${p.line}`}>
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

/** 앱 안 원문 — 받는 중에도 [사이트에서 열기]를 바로 보인다(기다리기 싫으면 바로 나갈 길). 실패하면 새 탭을 저절로 열지 않는다 */
function ReaderBody({ l, p, reader, onOpenOriginal, onRetryReader }: DetailProps) {
  const { item } = l;
  const [sumOpen, setSumOpen] = useState(false);
  const outBtn = (label: string) => (
    <button onClick={onOpenOriginal} className={`flex h-10 items-center justify-center gap-1 rounded-xl border text-[0.9em] font-semibold ${p.line}`}>
      {label} <Icon name="external" size={13} className="opacity-60" />
    </button>
  );
  if (!reader || reader.status === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        <span className={`text-[0.8em] ${p.muted}`}>{item.source}에서 원문을 받는 중…</span>
        {[70, 100, 85, 60].map((w, i) => (
          <div key={i} className={`h-3 animate-pulse rounded ${p.soft}`} style={{ width: `${w}%` }} />
        ))}
        {outBtn('기다리지 않고 사이트에서 열기')}
      </div>
    );
  }
  if (reader.status === 'fail' || !reader.data) {
    return (
      <div className="flex flex-col gap-3 py-4 text-center">
        <b className="text-[1.05em]">앱에서 보여 줄 수 없는 기사예요</b>
        <span className={`text-[0.85em] ${p.muted}`}>{reader.message ?? '유료 기사이거나 본문을 뽑지 못했어요'}</span>
        {outBtn('사이트에서 열기')}
        <button onClick={onRetryReader} className={`text-[0.8em] underline underline-offset-2 ${p.muted}`}>
          다시 받기
        </button>
      </div>
    );
  }
  const d = reader.data;
  const [first] = splitLead(item.summary);
  // data-no-ask: 이 글은 끌어서 묻기 대상이 아니다 (Viewer.readOwnSelection)
  return (
    <div className="flex flex-col gap-3" data-no-ask="1">
      {item.summary && (
        <div className={`flex flex-col gap-1.5 rounded-xl px-3 py-2 text-[0.88em] ${p.soft}`}>
          <div className="flex items-baseline gap-2">
            <span className="line-clamp-1">{sumOpen ? item.summary : first}</span>
            <button onClick={() => setSumOpen((v) => !v)} className={`ml-auto shrink-0 font-semibold ${p.accent}`}>
              {sumOpen ? '요약 접기' : '요약 펼치기'}
            </button>
          </div>
          {sumOpen && item.why && <span className={p.muted}>{item.why}</span>}
        </div>
      )}
      <h2 className="m-0 text-[1.25em] font-bold leading-snug">{d.title}</h2>
      <div className={`flex flex-wrap items-center gap-x-2 text-[0.8em] ${p.muted}`}>
        <span>
          {d.source}
          {d.byline ? ` · ${d.byline}` : ''} · {kstTime(item.publishedAt)}
        </span>
        <button onClick={onOpenOriginal} className={`ml-auto font-semibold ${p.accent}`}>
          사이트에서 보기 ↗
        </button>
      </div>
      {d.paragraphs.map((t, i) => (
        <p key={i} className="m-0 text-[1.02em] leading-[1.85]">
          {t}
        </p>
      ))}
      <span className={`text-[0.78em] ${p.muted}`}>사진·표는 원문에서 보세요 ↗</span>
      <span className={`text-[0.72em] ${p.muted}`}>누를 때만 받아 와서 보여 주고, 저장하지 않아요</span>
    </div>
  );
}
