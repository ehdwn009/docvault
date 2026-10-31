import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  askStream,
  toTreeFile,
  type AskMessage,
  type AskStatus,
  type AskThread,
  type AskUsedDoc,
  type CardSummary,
  type TreeFile,
} from '../lib/api';
import CardSaveDialog from './CardSaveDialog';
import ThreadCardsDialog from './ThreadCardsDialog';
import { getAppProseTheme } from '../lib/appTheme';
import { confirmDialog } from '../lib/dialog';
import { ASK_CONTEXT_MAX_CARDS, ASK_PANEL_OVERLAY_BELOW, ASK_PANEL_WIDTH_DEFAULT, ASK_PANEL_WIDTH_MAX, ASK_PANEL_WIDTH_MIN, ASK_QUESTION_MAX_CHARS } from '../lib/constants';
import { useMinWidth } from '../lib/device';
import { useSheetDrag } from '../lib/sheetDrag';
import { useVisualViewport } from '../lib/visualViewport';
import { toast } from '../lib/toast';
import { renderers } from '../renderers';
import ContextMenu, { type MenuItem } from './ContextMenu';
import Icon from './Icon';
import SwipeRow from './SwipeRow';
import { formatDate } from '../lib/date';

/** 드래그로 시작할 때 붙는 문맥 — 선택 문장 + 앞뒤 문단 (설계 — 문서 전체는 보내지 않는다).
    itemId: 브리핑 기사 — 문맥은 서버가 회차에서 "우리가 쓴 글 전체"를 조립한다(context는 비워 보낸다, v0.48).
    transientQuote: 원문 탭에서 고른 문장 — 그 호출에만 싣고 대화 기록(DB)에는 남기지 않는다 (해설 칸 토론 ⑦) */
export type AskSeed = { quote: string; context: string; itemId?: string; transientQuote?: boolean };

type Props = {
  /** 읽던 문서. null이면 문서 없이 시작하는 대화 — 챗봇(SCR-187): 인용 대신 "내 자료 참고" 스위치가 있다 */
  file: TreeFile | null;
  /** true면 본문 전체를 쓰는 대화 화면(SCR-188) — PC는 왼쪽 목록 + 오른쪽 본문, 폰은 목록 → 본문 푸시. file은 null */
  page?: boolean;
  /** 열릴 때의 문맥. null이면 문맥 없는 대화(설계 흐름 G) */
  seed: AskSeed | null;
  /** 대화 중 문서에서 다시 드래그한 문장 — 다음 질문에 인용으로 붙는다. 붙이고 나면 부모가 비운다 */
  pendingQuote: string | null;
  /** 그 문장이 원문 탭에서 온 것 — 호출에만 싣고 저장하지 않는다 */
  pendingTransient?: boolean;
  onConsumePendingQuote: () => void;
  /** 대화가 실제로 시작됐는지(질문을 한 번이라도 보냈는지) — 부모가 새 선택을 "문맥 교체"로 볼지 "인용 추가"로 볼지 정한다 */
  onConversingChange?: (conversing: boolean) => void;
  /** 카드를 저장하면 그 카드 파일을 연다 (SCR-182) */
  onOpenFile?: (file: TreeFile) => void;
  /** 질문할 때 관련 카드를 문맥으로 함께 보내기 (설정, 활용 ④) — 꺼져 있으면 띠도 없다 */
  withCards?: boolean;
  isPc: boolean;
  onClose: () => void;
};

type UsedCard = { id: number; title: string };

/** 챗봇 "내 자료 참고" 스위치의 기억 — 기기별 취향이라 localStorage. 기본 꺼짐(순수 대화) */
const MY_STUFF_KEY = 'dv_chat_mystuff';
/** 새 대화에 쓸 모델 — 마지막에 고른 것을 기억한다. 없으면 서버 기본(균형) */
const MODEL_KEY = 'dv_ask_model';
/** 챗봇 빈 화면에 보여 주는 최근 대화 수 */
const RECENT_THREADS = 5;
/** 오른쪽 질문 패널 폭의 기억 — 기기별 취향이라 localStorage */
const ASK_WIDTH_KEY = 'dv_ask_width';
const clampWidth = (w: number) => Math.min(ASK_PANEL_WIDTH_MAX, Math.max(ASK_PANEL_WIDTH_MIN, w));
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 사생활 모드 등 */
  }
}

/** 글에 카드 이름이 나오나 — 서버 lib/cards.ts mentions와 같은 규칙 (띠를 보내기 전에 미리 보여 주기 위해 클라이언트도 안다) */
function mentions(text: string, name: string): boolean {
  const n = name.replace(/\s+/g, ' ').trim();
  if (n.length < 2) return false;
  if (/^[A-Za-z0-9._-]+$/.test(n)) return new RegExp(`(^|[^A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^A-Za-z0-9])`, 'i').test(text);
  return text.replace(/\s+/g, '').toLowerCase().includes(n.replace(/\s+/g, '').toLowerCase());
}

type Bubble = AskMessage | { id: 'streaming'; role: 'assistant'; content: string; createdAt: number };

const MdRenderer = renderers.md;
/** 인용을 붙여 열었을 때 한 번 탭으로 보내는 첫 질문들 */
const QUICK_QUESTIONS = ['무슨 뜻이야?', '쉽게 설명해 줘', '왜 그래?'];
/** 터치 시트의 기본 높이 — 보이는 영역의 비율 */
const SHEET_RATIO = 0.78;
/** 펼쳤을 때 위에 남기는 여백(px) — 상태 표시줄 밑에 딱 붙지 않게 */
const SHEET_EXPANDED_TOP_INSET = 44;

// SCR-180: 질문 패널 — 드래그한 문장을 문맥으로 LLM에 묻고 꼬리질문을 잇는다 (배움 카드 1판).
// file이 null이면 SCR-187 대화(챗봇): 같은 부품이 레일 패널 안에서 문서 없이 돈다
export default function AskPanel({ file, page = false, seed, pendingQuote, pendingTransient = false, onConsumePendingQuote, onConversingChange, onOpenFile, withCards = false, isPc, onClose }: Props) {
  const chatMode = file === null;
  const [status, setStatus] = useState<AskStatus | null>(null);
  // 챗봇: 내 자료 참고 스위치 — 질문마다 바꿀 수 있고 끈 상태를 기기가 기억한다 (기본 꺼짐)
  const [myStuff, setMyStuff] = useState(() => readLocal(MY_STUFF_KEY) === '1');
  // 새 대화에 쓸 모델(칩). 대화가 생기면 thread.model이 진실이고, 바꾸면 서버에도 저장한다 (API-107)
  const [pendingModel, setPendingModel] = useState<string | null>(() => readLocal(MODEL_KEY));
  // 머리의 ⋯ 메뉴 — 모델 고르기·지난 대화·삭제 (머리 버튼 7개 → 2개 + ⋯, IA — 안 B SCR-188)
  const [moreOpen, setMoreOpen] = useState(false);
  // 대화 화면(page)의 폰: 목록을 보여 주는 중인가 — 대화를 고르거나 새로 열면 본문으로 넘어간다
  const [showList, setShowList] = useState(true);
  // 오른쪽 패널 폭 — 드래그로 320~560px, 기기가 기억한다
  const [askWidth, setAskWidth] = useState(() => clampWidth(Number(readLocal(ASK_WIDTH_KEY)) || ASK_PANEL_WIDTH_DEFAULT));
  const askWidthRef = useRef(askWidth);
  askWidthRef.current = askWidth;
  // 좁은 창(1024px 미만)에서는 본문을 밀지 않고 위에 덮인다
  const wide = useMinWidth(ASK_PANEL_OVERLAY_BELOW);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = askWidthRef.current;
    const move = (ev: PointerEvent) => setAskWidth(clampWidth(startW + (startX - ev.clientX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      writeLocal(ASK_WIDTH_KEY, String(askWidthRef.current));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // 지난 대화의 제목 편집 — 그 자리가 입력창이 되고, 오른쪽 끝의 ✦가 AI 제목을 채운다 (VS Code의 커밋 메시지 생성 자리와 같은 발상)
  const [renaming, setRenaming] = useState<{ id: number; draft: string } | null>(null);
  const [titleBusy, setTitleBusy] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  // 답마다 함께 본 내 문서 — 카드와 같은 방식 (meta로 먼저, done에서 답의 id에 붙인다)
  const [usedDocs, setUsedDocs] = useState<Record<number, AskUsedDoc[]>>({});
  const pendingDocsRef = useRef<AskUsedDoc[]>([]);
  const [thread, setThread] = useState<AskThread | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 마지막에 실패한 질문 — [다시 시도]가 이것을 다시 보낸다 (질문 글은 서버에 이미 남아 있다)
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // 카드로 저장 창(SCR-182)의 재료 — 답 하나 / 고른 답들 / 대화 전체. null이면 닫힘.
  // 배열은 여기서 한 번 만들어 넘긴다 — 렌더마다 새 배열이면 저장 창이 초안을 다시 받는다
  const [save, setSave] = useState<{ messageId?: number; messageIds?: number[] } | null>(null);
  // 답 골라 담기(C) — 답 오른쪽 위 네모로 고른 답 id들. 하나라도 있으면 아래에 띠가 뜬다
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // 대화 정리 창(SCR-183) — 헤더 [카드로]
  const [outlineOpen, setOutlineOpen] = useState(false);
  // 질문 때 함께 보낼 내 카드 (활용 ④) — 입력·인용·문맥에 이름이 나오는 카드. ✕로 뺀 것은 이번 질문에서 제외
  const [myCards, setMyCards] = useState<CardSummary[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  // 답마다 함께 본 카드 — meta로 먼저 오고 done에서 답의 id에 붙인다
  const [usedCards, setUsedCards] = useState<Record<number, UsedCard[]>>({});
  const pendingCardsRef = useRef<UsedCard[]>([]);
  // 카드를 함께 보내나 — 문서 질문은 설정(withCards), 챗봇은 스위치(myStuff)
  const cardsOn = chatMode ? myStuff : withCards;
  useEffect(() => {
    if (!cardsOn) return;
    const load = () => void api<{ cards: CardSummary[] }>('/cards').then((r) => setMyCards(r.cards)).catch(() => {});
    load();
    window.addEventListener('dv:cards-changed', load);
    return () => window.removeEventListener('dv:cards-changed', load);
  }, [cardsOn]);
  // 모델이 웹 검색 중 — 답이 늦는 이유를 보여 준다 (글자가 오기 시작하면 끈다)
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState<AskThread[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 이 패널이 지금 들고 있는 seed로 대화를 만들었는지 — 같은 seed로 두 번 만들지 않게
  const seedUsedRef = useRef(false);
  const matchedCards = (() => {
    if (!cardsOn || myCards.length === 0) return [];
    const text = [input, pendingQuote ?? '', thread?.quote ?? (seed && !seedUsedRef.current ? seed.quote : ''), seed && !seedUsedRef.current ? seed.context : ''].join('\n');
    if (!text.trim()) return [];
    return myCards
      .filter((c) => c.kind !== '주제' && !excluded.has(c.id))
      .filter((c) => [c.title, ...c.aliases].some((n) => mentions(text, n)))
      .sort((a, b) => b.title.length - a.title.length)
      .slice(0, ASK_CONTEXT_MAX_CARDS);
  })();
  // 터치: 손잡이를 끌어올리면 화면 가득 펼쳐지고, 펼친 상태에서 끌어내리면 먼저 원래 크기로 돌아온다 (닫히는 건 그다음)
  const [expanded, setExpanded] = useState(false);
  const sheet = useSheetDrag(expanded ? () => setExpanded(false) : onClose, expanded ? undefined : () => setExpanded(true));
  // 터치: 키보드가 올라오면 보이는 영역이 줄어든다 — 시트를 그 안에 맞춰야 머리와 입력창이 함께 보인다
  const vv = useVisualViewport(!isPc);
  /** 펼치면 위 여백(안전 영역 + 12px)만 남기고 다 쓴다 */
  const sheetHeight = expanded ? vv.height - SHEET_EXPANDED_TOP_INSET : Math.round(vv.height * SHEET_RATIO);

  useEffect(() => {
    void api<AskStatus>('/ask/status').then(setStatus).catch(() => setStatus(null));
  }, []);
  // 챗봇은 열자마자 최근 대화를 보여 준다 — 어제 하던 걸 이어 가는 일이 새 질문보다 잦다
  useEffect(() => {
    if (!chatMode) return;
    void api<{ threads: AskThread[] }>('/ask/threads').then((r) => setHistory(r.threads)).catch(() => {});
  }, [chatMode]);
  // ⋯ 메뉴는 바깥을 누르면 닫힌다
  useEffect(() => {
    if (!moreOpen) return;
    const close = () => setMoreOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [moreOpen]);

  // 문맥(seed)이 새로 오면 아직 대화가 없는 한 그것을 쓴다 — 안 보내고 닫았다가 다른 문장을 고른 경우 (설계 흐름 A 되풀이).
  // 입력창은 채우지 않는다: 채워 두면 다른 걸 묻고 싶을 때 지우는 일이 생긴다. 대신 빠른 질문 버튼을 둔다
  // 폰은 붙어 온 문장이 있을 때만 커서를 둔다 — 이 효과는 패널이 처음 뜰 때도 돌아, '대화'를 열자마자 키보드가 최근 대화 목록을 덮었다 (2026-10-19)
  useEffect(() => {
    if (!thread) seedUsedRef.current = false;
    if (isPc || seed) inputRef.current?.focus();
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  // 새 메시지가 오면 아래로 — 스트리밍 중에는 매 조각마다
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const refreshStatus = useCallback(() => {
    void api<AskStatus>('/ask/status').then(setStatus).catch(() => {});
  }, []);

  /** 대화가 아직 없으면 지금 만든다 — 첫 질문에서만 문맥(seed)이 붙는다 */
  async function ensureThread(): Promise<AskThread> {
    if (thread) return thread;
    const useSeed = seed && !seedUsedRef.current ? seed : null;
    // 브리핑 기사: 기사 id만 — 문맥은 서버가 조립하고, 원문 탭에서 고른 문장(transient)은 대화에 저장하지 않는다
    const seedBody = !useSeed
      ? {}
      : useSeed.itemId
        ? { itemId: useSeed.itemId, ...(useSeed.transientQuote ? {} : { quote: useSeed.quote }) }
        : { quote: useSeed.quote, context: useSeed.context };
    const { thread: t } = await api<{ thread: AskThread }>('/ask/threads', {
      method: 'POST',
      body: JSON.stringify({
        ...(file ? { fileId: file.id } : {}),
        ...(pendingModel ? { model: pendingModel } : {}),
        ...seedBody,
      }),
    });
    seedUsedRef.current = true;
    setThread(t);
    onConversingChange?.(true);
    return t;
  }

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setFailedQuestion(null);
    // 저장하지 않는 인용(원문 탭 문장) — 첫 질문이면 seed에서, 대화 중이면 pendingQuote에서. 화면에는 보이고 서버에는 ephemeralQuote로 간다
    const seedTransient = seed && !seedUsedRef.current && seed.transientQuote ? seed.quote : null;
    const ephemeral = seedTransient ?? (pendingQuote && pendingTransient ? pendingQuote : null);
    const quote = pendingQuote && !pendingTransient ? pendingQuote : undefined;
    if (pendingQuote) onConsumePendingQuote();
    const shown = quote ?? ephemeral ? `「${quote ?? ephemeral}」\n\n${q}` : q;
    const now = Date.now();
    setMessages((m) => [
      ...m,
      { id: -now, role: 'user', content: shown, createdAt: now },
      { id: 'streaming', role: 'assistant', content: '', createdAt: now },
    ]);
    setInput('');
    try {
      const t = await ensureThread();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      pendingCardsRef.current = [];
      pendingDocsRef.current = [];
      const excludeCardIds = [...excluded];
      setExcluded(new Set()); // 뺀 것은 이번 질문에만 — 다음 질문에서 다시 걸리면 다시 보인다
      await askStream(
        t.id,
        {
          question: q,
          ...(quote ? { quote } : {}),
          ...(ephemeral ? { ephemeralQuote: ephemeral } : {}),
          ...(excludeCardIds.length ? { excludeCardIds } : {}),
          // 챗봇만 스위치를 보낸다 — 문서 질문은 지금 동작(설정에 따라 카드만) 그대로
          ...(chatMode ? { myStuff } : {}),
        },
        {
          onMeta: (m) => {
            pendingCardsRef.current = m.cards ?? [];
            pendingDocsRef.current = m.docs ?? [];
          },
          onSearching: () => setSearching(true),
          onDelta: (text) => {
            setSearching(false);
            setMessages((m) =>
              m.map((b) => (b.id === 'streaming' ? { ...b, content: b.content + text } : b)),
            );
          },
          onDone: ({ assistantMessageId, content, model }) => {
            const used = pendingCardsRef.current;
            if (used.length) setUsedCards((prev) => ({ ...prev, [assistantMessageId]: used }));
            const docs = pendingDocsRef.current;
            if (docs.length) setUsedDocs((prev) => ({ ...prev, [assistantMessageId]: docs }));
            setMessages((m) =>
              m.map((b) =>
                b.id === 'streaming' ? { id: assistantMessageId, role: 'assistant', content, model: model ?? null, createdAt: Date.now() } : b,
              ),
            );
            if (chatMode) void api<{ threads: AskThread[] }>('/ask/threads').then((r) => setHistory(r.threads)).catch(() => {});
          },
          onError: ({ message }) => {
            setMessages((m) => m.filter((b) => b.id !== 'streaming'));
            setError(message);
            setFailedQuestion(q);
          },
        },
        ctrl.signal,
      );
    } catch (e) {
      setMessages((m) => m.filter((b) => b.id !== 'streaming'));
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof ApiError ? e.message : '질문을 보내지 못했습니다';
      setError(msg);
      // 한도·설정 오류는 서버가 질문을 받지 않은 것 — 다시 시도 버튼 대신 입력창에 돌려준다
      if (e instanceof ApiError && (e.code === 'ASK_LIMIT_EXCEEDED' || e.code === 'ASK_NOT_CONFIGURED')) {
        setMessages((m) => m.filter((b) => b.id !== -now));
        setInput(q);
      } else {
        setFailedQuestion(q);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setSearching(false);
      refreshStatus();
    }
  }

  /** 모델 칩 — 대화가 있으면 서버에 저장(다음 답부터), 없으면 새 대화에 쓸 값으로. 고른 것은 기기가 기억한다 */
  async function chooseModel(id: string) {
    setMoreOpen(false);
    setPendingModel(id);
    writeLocal(MODEL_KEY, id);
    if (!thread) return;
    try {
      const r = await api<{ thread: AskThread }>(`/ask/threads/${thread.id}`, { method: 'PUT', body: JSON.stringify({ model: id }) });
      setThread(r.thread);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '모델을 바꾸지 못했습니다', 'error');
    }
  }

  function toggleMyStuff() {
    setMyStuff((v) => {
      writeLocal(MY_STUFF_KEY, v ? '0' : '1');
      return !v;
    });
  }

  /** 제목 저장 (API-107). 직접 쓴 제목은 AI가 덮어쓰지 않는다 — AI는 버튼을 눌렀을 때만 입력창을 채운다 */
  async function saveTitle() {
    if (!renaming) return;
    const title = renaming.draft.trim();
    const { id } = renaming;
    setRenaming(null);
    if (!title) return;
    try {
      const r = await api<{ thread: AskThread }>(`/ask/threads/${id}`, { method: 'PUT', body: JSON.stringify({ title }) });
      setHistory((h) => h.map((t) => (t.id === id ? r.thread : t)));
      if (thread?.id === id) setThread(r.thread);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '제목을 바꾸지 못했습니다', 'error');
    }
  }

  /** ✦ — AI가 지은 제목을 입력창에 채운다 (API-109). 저장은 사용자가 확인한 뒤 */
  async function fillAiTitle() {
    if (!renaming || titleBusy) return;
    setTitleBusy(true);
    try {
      const r = await api<{ title: string }>(`/ask/threads/${renaming.id}/title`, { method: 'POST' });
      setRenaming((cur) => (cur ? { ...cur, draft: r.title } : cur));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '제목을 짓지 못했습니다', 'error');
    } finally {
      setTitleBusy(false);
    }
  }

  const rowMenuItems = (t: AskThread): MenuItem[] => [
    { label: '제목 바꾸기', action: () => setRenaming({ id: t.id, draft: t.title }) },
    { label: '삭제', danger: true, action: () => void deleteThread(t.id) },
  ];

  async function openHistory() {
    setShowHistory(true);
    try {
      const { threads } = await api<{ threads: AskThread[] }>('/ask/threads');
      setHistory(threads);
    } catch {
      setHistory([]);
    }
  }

  async function loadThread(id: number) {
    try {
      const r = await api<{ thread: AskThread; messages: AskMessage[] }>(`/ask/threads/${id}`);
      setThread(r.thread);
      setMessages(r.messages);
      setPicked(new Set());
      onConversingChange?.(true);
      seedUsedRef.current = true; // 옛 대화를 이었으니 지금 seed는 쓰지 않는다
      setShowHistory(false);
      setShowList(false);
      setError(null);
      setFailedQuestion(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '대화를 불러오지 못했습니다', 'error');
    }
  }

  /** 대화 삭제 (API-106). 지금 보는 대화면 빈 대화로 돌아간다 */
  async function deleteThread(id: number) {
    const ok = await confirmDialog('이 대화를 지울까요? 되돌릴 수 없어요.', { danger: true, confirmLabel: '대화 지우기' });
    if (!ok) return;
    try {
      await api(`/ask/threads/${id}`, { method: 'DELETE' });
      setHistory((h) => h.filter((t) => t.id !== id));
      if (thread?.id === id) newThread();
      toast('대화를 지웠습니다');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '지우지 못했습니다', 'error');
    }
  }

  function newThread() {
    abortRef.current?.abort();
    setThread(null);
    setMessages([]);
    setPicked(new Set());
    setError(null);
    setFailedQuestion(null);
    setShowHistory(false);
    setShowList(false);
    seedUsedRef.current = true; // 새 대화는 문맥 없이 — 문맥이 필요하면 문서에서 다시 드래그
    onConversingChange?.(false);
    inputRef.current?.focus();
  }

  const limitReached = status !== null && status.remaining !== null && status.remaining <= 0;
  const currentModelId = thread?.model ?? pendingModel ?? status?.defaultModel ?? null;
  const currentModel = status?.models.find((m) => m.id === currentModelId) ?? null;
  const modelName = (id: string | null | undefined) => status?.models.find((m) => m.id === id)?.name ?? (id ? id : 'Opus 5');
  // 줄의 맨 끝에 두고 이름만 줄어들게 한다 — 덩어리(inline-flex)로 두면 줄어들지 못해 제목을 0칸으로 밀고 상자 밖으로 넘쳤다 (2026-10-19)
  const threadKind = (t: AskThread) => {
    const doc = t.fileId !== null || !!t.fileName;
    return (
      <span className="flex min-w-0 items-center gap-1">
        <Icon name={doc ? 'doc' : 'chat'} size={11} className="shrink-0" />
        <span className="truncate">{doc ? (t.fileName ?? '문서') : '자유 대화'}</span>
      </span>
    );
  };
  const notConfigured = status !== null && !status.configured;
  const canSend = !busy && !limitReached && !notConfigured && input.trim().length > 0;
  const hasAnswer = messages.some((m) => m.role === 'assistant' && typeof m.id === 'number' && m.id > 0);
  const picking = picked.size > 0;

  // 브리핑 기사면 무엇이 함께 가는지 적어 준다 — 모델이 무엇을 보고 답하는지 알아야 한다 (해설 칸 토론, 읽는 사람 조건)
  const articleNote = seed?.itemId ? (seed.transientQuote ? '원문에서 고른 문장 · 이 문장은 저장하지 않아요 · 기사 요약·해설 함께' : '기사 제목·요약·해설을 함께 보내요') : null;
  const contextChip =
    thread?.quote || (seed && !seedUsedRef.current) ? (
      <div className="rounded-md border border-slate-800 border-l-2 border-l-amber-500 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-400">
        <div className="mb-0.5 truncate text-slate-500">
          {thread?.fileName ?? file?.name}
          {articleNote && ` · ${articleNote}`}
        </div>
        <div className="line-clamp-3">“{thread?.quote ?? seed?.quote}”</div>
      </div>
    ) : null;

  const menuItem = 'flex min-h-11 w-full items-center rounded-lg px-2.5 text-left text-sm text-slate-200 hover:bg-slate-800';
  // 머리: 제목 한 줄 + [카드로] [새 대화] + ⋯(모델·지난 대화·삭제) + ✕ — 버튼 7개가 두 줄로 꺾이던 것을 둘로 (IA — 안 B SCR-188)
  const header = (
    <div className={`relative flex items-center gap-1.5 border-b border-slate-800 py-2 pr-3 [&_button]:whitespace-nowrap ${page && !isPc ? 'pl-14' : 'pl-3'}`}>
      {/* 폰의 대화 화면: 떠 있는 ☰ 자리(pl-14)를 비우고 그 옆에 ‹ 대화 */}
      {page && !isPc && (
        <button onClick={() => setShowList(true)} className="flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm text-slate-300 hover:bg-slate-800" aria-label="대화 목록으로">
          ‹ 대화
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-slate-200">{page ? (thread?.title ?? '새 대화') : '질문'}</h3>
        {status && status.configured && (
          <p className={`truncate text-[11px] ${limitReached ? 'text-warn-400' : 'text-slate-600'}`}>
            오늘 {status.used}{status.limit !== null ? `/${status.limit}` : '번'}
            {currentModel ? ` · ${currentModel.name.split(' ')[0]}` : ''}
            {page && thread?.fileName ? ` · ${thread.fileName}` : ''}
          </p>
        )}
      </div>
      {thread && !showHistory && hasAnswer && (
        <button
          onClick={() => setOutlineOpen(true)}
          title="이 대화 전체를 카드로 — 개념별로 나누거나 한 장으로"
          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-600 px-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <Icon name="cards" size={13} />카드로
        </button>
      )}
      <button onClick={newThread} className="min-h-9 rounded-md border border-slate-700 px-2.5 text-xs text-slate-300 hover:bg-slate-800">
        새 대화
      </button>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setMoreOpen((v) => !v)}
        title="더 보기 — 답변 모델·지난 대화·삭제"
        aria-label="더 보기"
        aria-expanded={moreOpen}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      >
        <Icon name="more" size={16} />
      </button>
      {!page && (
        <button onClick={onClose} title="닫기 (대화는 남아 있어요)" aria-label="닫기" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-300">
          <Icon name="close" size={16} />
        </button>
      )}
      {moreOpen && status && (
        <div onPointerDown={(e) => e.stopPropagation()} className="absolute right-3 top-full z-20 mt-1 w-64 rounded-xl border border-slate-700 bg-slate-950 p-1.5 text-sm shadow-xl shadow-black/40">
          {status.configured && (
            <>
              {/* 답변 모델 — 셋 중 하나. 고른 모델은 대화에 저장되고 다음 답부터. 답마다 아래에 어느 모델인지 남는다 */}
              <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">답변 모델</p>
              {status.models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => void chooseModel(m.id)}
                  className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-slate-800 ${m.id === currentModelId ? 'bg-accent-950/60' : ''}`}
                >
                  <span className="flex items-center gap-1.5 font-semibold text-slate-100">
                    {m.label}
                    <span className="ml-auto text-[10px] font-medium text-slate-500">{m.name}</span>
                  </span>
                  <span className="text-[11px] text-slate-400">{m.note}</span>
                </button>
              ))}
              <p className="px-2.5 pb-1.5 pt-1 text-[10px] text-slate-500">다음 답부터 적용 · 답마다 어느 모델인지 표시</p>
              <div className="my-1 border-t border-slate-800" />
            </>
          )}
          {!page && (
            <button onClick={() => { setMoreOpen(false); void openHistory(); }} className={menuItem}>
              지난 대화
            </button>
          )}
          {thread && (
            <button onClick={() => { setMoreOpen(false); void deleteThread(thread.id); }} className={`${menuItem} text-danger-300`}>
              이 대화 삭제
            </button>
          )}
        </div>
      )}
    </div>
  );

  // 대화 화면(page)의 왼쪽 목록 머리 — 폰은 떠 있는 ☰ 자리(pl-14)를 비운다
  const listHeader = (
    <div className={`flex items-center gap-2 pr-2 ${isPc ? 'px-4 py-3' : 'py-2 pl-14'}`}>
      <h2 className="text-sm font-bold">대화</h2>
      <button onClick={newThread} className="ml-auto min-h-9 rounded-md border border-slate-700 px-2.5 text-xs text-slate-300 hover:bg-slate-800">
        + 새 대화
      </button>
    </div>
  );

  const historyView = (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {!page && (
          <div className="mb-1 flex items-center justify-between px-1 text-xs text-slate-500">
            <span>최근 30일</span>
            <button onClick={() => setShowHistory(false)} className="hover:text-slate-300">← 돌아가기</button>
          </div>
          )}
          {history.length === 0 ? (
            <p className="px-2 py-4 text-xs text-slate-600">지난 대화가 없습니다</p>
          ) : (
            history.map((t) =>
              renaming?.id === t.id ? (
                // 제목 편집 — 그 자리에 입력창. 오른쪽 끝 ✦ = AI가 짓기(입력창만 채움), 확인 = 저장
                <form
                  key={t.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveTitle();
                  }}
                  className="flex items-center gap-1 rounded-md border border-slate-600 bg-slate-950 px-2 py-1"
                >
                  <input
                    autoFocus
                    value={renaming.draft}
                    onChange={(e) => setRenaming({ id: t.id, draft: e.target.value.slice(0, 60) })}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    placeholder="대화 제목"
                    className="min-w-0 flex-1 bg-transparent py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
                  />
                  <button type="button" onClick={() => void fillAiTitle()} disabled={titleBusy} title="AI가 제목 짓기 — 대화 내용으로 8자 안팎" className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40">
                    <Icon name="sparkle" size={16} className={titleBusy ? 'animate-pulse' : ''} />
                  </button>
                  <button type="submit" title="저장" className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
                    <Icon name="check" size={16} />
                  </button>
                </form>
              ) : (
                <SwipeRow
                  key={t.id}
                  left={[{ label: '제목', onAction: () => setRenaming({ id: t.id, draft: t.title }) }]}
                  right={[{ label: '삭제', danger: true, onAction: () => void deleteThread(t.id) }]}
                >
                  <div className={`flex items-center rounded-md hover:bg-slate-900 ${page && thread?.id === t.id ? 'bg-slate-800' : ''}`} onContextMenu={(e) => { e.preventDefault(); setRowMenu({ x: e.clientX, y: e.clientY, items: rowMenuItems(t) }); }}>
                    <button onClick={() => void loadThread(t.id)} className="min-w-0 flex-1 px-2 py-2 text-left">
                      <div className="truncate text-sm text-slate-200">{t.title}</div>
                      <div className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
                        <span className="shrink-0">{formatDate(t.updatedAt)} · {t.messageCount ?? 0}개 ·</span>
                        {threadKind(t)}
                      </div>
                    </button>
                    <button
                      onClick={(e) => setRowMenu({ x: e.clientX, y: e.clientY, items: rowMenuItems(t) })}
                      title="메뉴"
                      className="h-11 w-9 shrink-0 text-slate-500 hover:text-slate-200"
                    >
                      <Icon name="more" size={16} className="mx-auto" />
                    </button>
                  </div>
                </SwipeRow>
              ),
            )
          )}
        </div>
  );

  const conversation = (
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain p-3 text-sm">
        <div className={`flex flex-col gap-3 ${page ? 'mx-auto w-full max-w-3xl' : ''}`}>
          {contextChip}
          {notConfigured && (
            // 일반 사용자에게 "LLM", "ANTHROPIC_API_KEY"는 뜻 모를 말이었다(사용성 평가 2026-10-01) — 관리자에게만 설정 방법을
            <p className="rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              {status?.canConfigure ? (
                <>
                  AI 키가 아직 연결되지 않았어요. 서버의 .env에 <code>ANTHROPIC_API_KEY</code>를 넣고 다시 시작하면 켜집니다.
                </>
              ) : (
                '지금은 AI에게 물어볼 수 없어요. 관리자에게 알려 주세요.'
              )}
            </p>
          )}
          {messages.length === 0 && !notConfigured && (
            <p className="px-1 text-xs text-slate-600">
              {chatMode
                ? '무엇이든 물어보세요. 공부든 아니든 괜찮아요. 답은 카드로 남길 수 있어요.'
                : seed
                  ? '아래 문장에 대해 물어보세요.'
                  : isPc
                    ? '문서에서 문장을 드래그하면 그 부분이 문맥으로 붙어요. 그냥 물어봐도 됩니다.'
                    : '시트를 내리고 문장을 길게 눌러 고른 뒤 [질문]을 누르면 그 문장이 붙어요. 그냥 물어봐도 됩니다.'}
            </p>
          )}
          {chatMode && !page && messages.length === 0 && !notConfigured && history.length > 0 && (
            // 최근 대화가 먼저 — 문서에서 시작한 대화도 같은 대화라 섞어 보여 주고 표시만 다르다
            <div className="rounded-lg border border-slate-800">
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold tracking-wide text-slate-500">최근 대화</div>
              {history.slice(0, RECENT_THREADS).map((t) => (
                // 두 줄 — 대화를 알아보는 이름은 제목이라 한 줄을 통째로 준다. 아랫줄에서 잘리는 쪽은 늘 문서 이름 (2026-10-19)
                <button key={t.id} onClick={() => void loadThread(t.id)} className="block w-full border-t border-slate-800 px-2.5 py-2 text-left hover:bg-slate-900">
                  <span className="block truncate text-slate-200">{t.title}</span>
                  <span className="flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
                    <span className="shrink-0">{formatDate(t.updatedAt)} ·</span>
                    {threadKind(t)}
                  </span>
                </button>
              ))}
              {history.length > RECENT_THREADS && (
                <button onClick={() => void openHistory()} className="w-full border-t border-slate-800 px-2.5 py-1.5 text-left text-xs text-slate-500 hover:text-slate-300">더 보기 → 지난 대화</button>
              )}
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className={`ml-6 self-end whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent-700 px-3 py-2 text-slate-50 ${page ? 'max-w-[640px]' : ''}`}>
                {m.content}
              </div>
            ) : (
              <div key={m.id} className={`relative mr-2 rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-900 px-3 py-2 pr-9 text-slate-200 ${page ? 'max-w-[640px]' : ''}`}>
                {thread && typeof m.id === 'number' && m.id > 0 && (
                  // 답 골라 담기 — 평소엔 흐리게, 하나라도 고르면 전부 또렷하게 (파일 트리의 선택 모드와 같은 규칙)
                  <button
                    onClick={() => {
                      const id = m.id as number;
                      setPicked((p) => {
                        const next = new Set(p);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
                    title={picked.has(m.id) ? '고른 답에서 빼기' : '이 답 골라 담기 (여러 답을 한 카드로)'}
                    className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-md border text-[11px] transition ${
                      picked.has(m.id) ? 'border-slate-300 bg-slate-200 text-slate-900' : `border-slate-600 text-transparent hover:border-slate-400 ${picking ? '' : 'opacity-40'}`
                    }`}
                  >
                    <Icon name="check" size={12} />
                  </button>
                )}
                {m.content === '' ? (
                  <span className="inline-flex items-center gap-1 text-slate-500">{searching ? <><Icon name="globe" size={13} />웹에서 찾는 중…</> : '생각 중…'}</span>
                ) : MdRenderer ? (
                  <Suspense fallback={<span className="whitespace-pre-wrap">{m.content}</span>}>
                    <div className="ask-md">
                      <MdRenderer content={m.content} theme={getAppProseTheme()} />
                    </div>
                  </Suspense>
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
                {typeof m.id === 'number' && usedCards[m.id] && (
                  // 이 답이 어떤 카드를 읽고 답했는지 — 누르면 그 카드
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    <Icon name="card" size={12} /> 함께 본 카드:
                    {usedCards[m.id]!.map((k) => (
                      <button
                        key={k.id}
                        onClick={() => onOpenFile?.(toTreeFile({ id: k.id, name: `${k.title}.md`, fileType: 'md', kind: 'card' }))}
                        className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-200 hover:bg-slate-800"
                      >
                        {k.title}
                      </button>
                    ))}
                  </div>
                )}
                {typeof m.id === 'number' && usedDocs[m.id] && (
                  // 이 답이 어떤 내 문서 단락을 읽고 답했는지 — 누르면 그 문서
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    <Icon name="doc" size={12} /> 함께 본 문서:
                    {usedDocs[m.id]!.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => onOpenFile?.(toTreeFile({ id: d.id, name: d.name, fileType: d.fileType as TreeFile['fileType'] }))}
                        className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-200 hover:bg-slate-800"
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                )}
                {m.id !== 'streaming' && (
                  // 좁은 드로어(288px)에서도 버튼 글자가 두 줄로 꺾이지 않게 — 줄이 모자라면 버튼째 다음 줄로
                  <div className="mt-1.5 flex flex-wrap gap-1 text-xs [&_button]:whitespace-nowrap">
                    {thread && typeof m.id === 'number' && m.id > 0 && (
                      <button
                        onClick={() => setSave({ messageId: m.id as number })}
                        className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-0.5 font-medium text-slate-200 hover:bg-slate-800"
                      >
                        <Icon name="card" size={12} />카드로 저장
                      </button>
                    )}
                    <button
                      onClick={() => void navigator.clipboard.writeText(m.content).then(() => toast('복사했습니다'))}
                      className="rounded border border-slate-700 px-2 py-0.5 text-slate-400 hover:bg-slate-800"
                    >
                      복사
                    </button>
                    <button
                      onClick={() => void send('방금 답을 더 쉽게, 비유를 들어서 다시 설명해 줘')}
                      disabled={busy || limitReached}
                      className="rounded border border-slate-700 px-2 py-0.5 text-slate-400 hover:bg-slate-800 disabled:opacity-40"
                    >
                      더 쉽게
                    </button>
                    {typeof m.id === 'number' && m.id > 0 && (
                      // 어느 모델이 답했나 — 모델을 바꿔 가며 물을 때 나중에 봐도 안다
                      <span className="ml-auto self-center whitespace-nowrap text-[10px] text-slate-600">{modelName(m.model)}</span>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
          {error && (
            <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {error}
              {failedQuestion && (
                <button onClick={() => void send(failedQuestion)} className="ml-2 underline hover:text-white">
                  다시 시도
                </button>
              )}
            </div>
          )}
        </div>
        </div>
  );

  const composer = (
      <div className="border-t border-slate-800 p-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pc:pb-2">
        <div className={page ? 'mx-auto w-full max-w-3xl' : ''}>
        {picking && thread && (
          <div className="mb-1.5 flex items-center gap-2 rounded-md border border-teal-900 bg-teal-950/40 px-2.5 py-1.5 text-xs">
            <span className="text-slate-200"><b className="text-teal-300">{picked.size}</b>개 답 골라짐</span>
            <button onClick={() => setPicked(new Set())} className="ml-auto rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800">해제</button>
            <button
              onClick={() => setSave({ messageIds: [...picked].sort((a, b) => a - b) })}
              className="rounded bg-teal-600 px-2.5 py-1 font-medium text-white hover:bg-teal-500"
            >
              한 장으로
            </button>
          </div>
        )}
        {chatMode && (
          // "내 자료 참고" 스위치 — 켜면 이름이 걸린 내 카드 + 질문 낱말로 찾은 내 문서 단락을 함께 보낸다. 질문마다 바꿀 수 있다
          <button
            onClick={toggleMyStuff}
            className="mb-1.5 flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs text-slate-300 hover:bg-slate-900"
            title={myStuff ? '끄면 질문과 대화 이력만 보냅니다 (순수 대화)' : '켜면 관련 카드·문서 단락을 함께 보냅니다'}
          >
            <span className={`relative h-[18px] w-8 shrink-0 rounded-full transition ${myStuff ? 'bg-sky-600' : 'bg-slate-700'}`}>
              <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition ${myStuff ? 'left-[15px]' : 'left-0.5'}`} />
            </span>
            <span className="whitespace-nowrap">내 자료 참고</span>
            <span className="ml-auto min-w-0 truncate text-[11px] text-slate-500">{myStuff ? '관련 카드 · 문서 단락을 함께 보냄' : '끔 — 질문과 대화만 보냄'}</span>
          </button>
        )}
        {matchedCards.length > 0 && !busy && (
          // 무엇을 보내는지 모르게 하지 않는다 — 함께 갈 카드를 보여 주고 ✕로 뺄 수 있다
          <div className="mb-1.5 flex flex-wrap items-center gap-1 rounded-md border border-slate-800 border-l-2 border-l-slate-500 bg-slate-900 px-2 py-1 text-[11px] text-slate-300">
            <Icon name="card" size={12} /> 내 카드 {matchedCards.length}장 함께 보냄
            {matchedCards.map((k) => (
              <span key={k.id} className="inline-flex items-center gap-0.5 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-200">
                {k.title}
                <button onClick={() => setExcluded((p) => new Set(p).add(k.id))} title="이번 질문에서 빼기" className="px-0.5 text-slate-500 hover:text-red-300"><Icon name="close" size={10} /></button>
              </span>
            ))}
          </div>
        )}
        {pendingQuote && (
          <div className="mb-1.5 flex items-start gap-1 rounded-md border border-slate-800 border-l-2 border-l-amber-500 bg-slate-900 px-2 py-1 text-xs text-slate-400">
            <span className="line-clamp-2 flex-1">“{pendingQuote}”</span>
            <button onClick={onConsumePendingQuote} className="text-slate-500 hover:text-slate-300" title="인용 빼기"><Icon name="close" size={12} /></button>
          </div>
        )}
        {messages.length === 0 && !notConfigured && !limitReached && ((seed && !seedUsedRef.current) || pendingQuote) && (
          // 자주 하는 첫 질문은 한 번 탭으로 — 입력창을 채워 두는 대신 (지우는 일이 안 생기게)
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => void send(q)}
                disabled={busy}
                className="rounded-full border border-sky-800 bg-sky-950/60 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-900 disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, ASK_QUESTION_MAX_CHARS))}
            onKeyDown={(e) => {
              // PC: Enter 보내기 · Shift+Enter 줄바꿈. 터치: 키보드의 Enter는 줄바꿈, 보내기는 버튼으로
              // (폰에는 Shift+Enter가 없다). 한글 조합 중 Enter는 무시(조합 확정용)
              if (isPc && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) void send(input);
              }
            }}
            rows={2}
            disabled={limitReached || notConfigured}
            placeholder={
              limitReached
                ? '오늘 질문을 다 썼어요 — 읽기는 계속 됩니다'
                : isPc
                  ? `${messages.length ? '꼬리질문' : chatMode ? '무엇이든 물어보세요' : '질문'}… (Enter 보내기 · Shift+Enter 줄바꿈)`
                  : messages.length ? '꼬리질문…' : chatMode ? '무엇이든 물어보세요' : '질문을 입력하세요'
            }
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none disabled:opacity-50"
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.abort()}
              title="답변 중단"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              onClick={() => void send(input)}
              disabled={!canSend}
              title="보내기 (Enter)"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40"
            >
              <Icon name="send" size={18} />
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-600">
          {chatMode
            ? myStuff
              ? '내 카드 최대 3장과 내 문서에서 찾은 단락 최대 3개를 함께 보냅니다. 문서 전체는 가지 않습니다'
              : '내 자료 없이 답합니다. 카드·문서를 함께 보내려면 스위치를 켜세요'
            : isPc
              ? '문서 전체가 아니라 드래그한 문장의 앞뒤 문단만 AI에 보냅니다'
              : '문서 전체가 아니라 고른 문장의 앞뒤 문단만 AI에 보냅니다'}
        </p>
        </div>
      </div>
  );

  const dialogs = (
    <>
      {rowMenu && <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowMenu.items} onClose={() => setRowMenu(null)} />}
      {save && thread && (
        <CardSaveDialog
          threadId={thread.id}
          messageId={save.messageId}
          messageIds={save.messageIds}
          isPc={isPc}
          onClose={() => setSave(null)}
          onSaved={(f) => {
            setSave(null);
            setPicked(new Set());
            onOpenFile?.(f);
          }}
        />
      )}
      {outlineOpen && thread && (
        <ThreadCardsDialog
          threadId={thread.id}
          isPc={isPc}
          onClose={() => setOutlineOpen(false)}
          onWholeAsOne={() => {
            setOutlineOpen(false);
            setSave({});
          }}
          onSaved={(f) => {
            setOutlineOpen(false);
            onOpenFile?.(f);
          }}
        />
      )}
    </>
  );

  const body = (
    <>
      {header}
      {showHistory ? historyView : conversation}
      {composer}
      {dialogs}
    </>
  );

  if (page) {
    // SCR-188 대화 화면 — PC: 왼쪽 목록(288px) + 오른쪽 본문(말풍선 최대 640px). 폰: 목록 → 본문 푸시 (IA — 안 B)
    if (isPc) {
      return (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r border-slate-800">
            {listHeader}
            {historyView}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            {header}
            {conversation}
            {composer}
          </div>
          {dialogs}
        </div>
      );
    }
    return showList ? (
      <div className="flex min-h-0 flex-1 flex-col">
        {listHeader}
        {historyView}
        {dialogs}
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    );
  }
  if (isPc) {
    // 오른쪽 질문 패널(SCR-180 개정) — 폭은 왼쪽 모서리를 끌어 320~560px, 좁은 창에서는 본문 위에 덮인다
    return (
      <aside
        className={`relative flex shrink-0 flex-col border-l border-slate-800 bg-slate-950 ${wide ? '' : 'absolute inset-y-0 right-0 z-30 max-w-full shadow-2xl shadow-black/50'}`}
        style={{ width: askWidth }}
      >
        <div onPointerDown={startResize} title="끌어서 폭 조절" className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent-500/40" />
        {body}
      </aside>
    );
  }
  return (
    <>
      {/* 브리핑 기사 시트(z-40)보다 위에 — 시트에서 고른 문장으로 열리는 질문이 시트 밑에 깔리지 않게 (v0.48) */}
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div
        className="fixed inset-x-0 z-[60] flex flex-col rounded-t-2xl border-t border-slate-700 bg-slate-950"
        // 시트 높이는 "보이는 영역"의 78% — 키보드가 올라오면 그만큼 줄고, 아래 끝은 키보드 위에 붙는다
        style={{ ...sheet.sheetStyle, top: vv.offsetTop + vv.height - sheetHeight, height: sheetHeight }}
      >
        <div {...sheet.handleProps} className={`${sheet.handleProps.className} px-4 pb-1 pt-3`}>
          <div className="mx-auto h-1 w-9 rounded-full bg-slate-600" />
        </div>
        {body}
      </div>
    </>
  );
}
