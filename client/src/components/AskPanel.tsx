import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  askStream,
  type AskMessage,
  type AskStatus,
  type AskThread,
  type TreeFile,
} from '../lib/api';
import CardSaveDialog from './CardSaveDialog';
import ThreadCardsDialog from './ThreadCardsDialog';
import { getAppProseTheme } from '../lib/appTheme';
import { confirmDialog } from '../lib/dialog';
import { ASK_QUESTION_MAX_CHARS } from '../lib/constants';
import { useSheetDrag } from '../lib/sheetDrag';
import { useVisualViewport } from '../lib/visualViewport';
import { toast } from '../lib/toast';
import { renderers } from '../renderers';

/** 드래그로 시작할 때 붙는 문맥 — 선택 문장 + 앞뒤 문단 (설계 — 문서 전체는 보내지 않는다) */
export type AskSeed = { quote: string; context: string };

type Props = {
  file: TreeFile;
  /** 열릴 때의 문맥. null이면 문맥 없는 대화(설계 흐름 G) */
  seed: AskSeed | null;
  /** 대화 중 문서에서 다시 드래그한 문장 — 다음 질문에 인용으로 붙는다. 붙이고 나면 부모가 비운다 */
  pendingQuote: string | null;
  onConsumePendingQuote: () => void;
  /** 대화가 실제로 시작됐는지(질문을 한 번이라도 보냈는지) — 부모가 새 선택을 "문맥 교체"로 볼지 "인용 추가"로 볼지 정한다 */
  onConversingChange?: (conversing: boolean) => void;
  /** 카드를 저장하면 그 카드 파일을 연다 (SCR-182) */
  onOpenFile?: (file: TreeFile) => void;
  isPc: boolean;
  onClose: () => void;
};

type Bubble = AskMessage | { id: 'streaming'; role: 'assistant'; content: string; createdAt: number };

const MdRenderer = renderers.md;
/** 인용을 붙여 열었을 때 한 번 탭으로 보내는 첫 질문들 */
const QUICK_QUESTIONS = ['무슨 뜻이야?', '쉽게 설명해 줘', '왜 그래?'];
/** 터치 시트의 기본 높이 — 보이는 영역의 비율 */
const SHEET_RATIO = 0.78;
/** 펼쳤을 때 위에 남기는 여백(px) — 상태 표시줄 밑에 딱 붙지 않게 */
const SHEET_EXPANDED_TOP_INSET = 44;

// SCR-180: 질문 패널 — 드래그한 문장을 문맥으로 LLM에 묻고 꼬리질문을 잇는다 (배움 카드 1판)
export default function AskPanel({ file, seed, pendingQuote, onConsumePendingQuote, onConversingChange, onOpenFile, isPc, onClose }: Props) {
  const [status, setStatus] = useState<AskStatus | null>(null);
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
  // 모델이 웹 검색 중 — 답이 늦는 이유를 보여 준다 (글자가 오기 시작하면 끈다)
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState<AskThread[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 이 패널이 지금 들고 있는 seed로 대화를 만들었는지 — 같은 seed로 두 번 만들지 않게
  const seedUsedRef = useRef(false);
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

  // 문맥(seed)이 새로 오면 아직 대화가 없는 한 그것을 쓴다 — 안 보내고 닫았다가 다른 문장을 고른 경우 (설계 흐름 A 되풀이).
  // 입력창은 채우지 않는다: 채워 두면 다른 걸 묻고 싶을 때 지우는 일이 생긴다. 대신 빠른 질문 버튼을 둔다
  useEffect(() => {
    if (!thread) seedUsedRef.current = false;
    inputRef.current?.focus();
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
    const { thread: t } = await api<{ thread: AskThread }>('/ask/threads', {
      method: 'POST',
      body: JSON.stringify({
        fileId: file.id,
        ...(useSeed ? { quote: useSeed.quote, context: useSeed.context } : {}),
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
    const quote = pendingQuote ?? undefined;
    if (pendingQuote) onConsumePendingQuote();
    const shown = quote ? `「${quote}」\n\n${q}` : q;
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
      await askStream(
        t.id,
        { question: q, ...(quote ? { quote } : {}) },
        {
          onSearching: () => setSearching(true),
          onDelta: (text) => {
            setSearching(false);
            setMessages((m) =>
              m.map((b) => (b.id === 'streaming' ? { ...b, content: b.content + text } : b)),
            );
          },
          onDone: ({ assistantMessageId, content }) =>
            setMessages((m) =>
              m.map((b) =>
                b.id === 'streaming' ? { id: assistantMessageId, role: 'assistant', content, createdAt: Date.now() } : b,
              ),
            ),
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
      setError(null);
      setFailedQuestion(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '대화를 불러오지 못했습니다', 'error');
    }
  }

  /** 대화 삭제 (API-106). 지금 보는 대화면 빈 대화로 돌아간다 */
  async function deleteThread(id: number) {
    const ok = await confirmDialog('이 대화를 지울까요? 되돌릴 수 없어요.');
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
    seedUsedRef.current = true; // 새 대화는 문맥 없이 — 문맥이 필요하면 문서에서 다시 드래그
    onConversingChange?.(false);
    inputRef.current?.focus();
  }

  const limitReached = status !== null && status.remaining !== null && status.remaining <= 0;
  const notConfigured = status !== null && !status.configured;
  const canSend = !busy && !limitReached && !notConfigured && input.trim().length > 0;
  const hasAnswer = messages.some((m) => m.role === 'assistant' && typeof m.id === 'number' && m.id > 0);
  const picking = picked.size > 0;

  const contextChip =
    thread?.quote || (seed && !seedUsedRef.current) ? (
      <div className="rounded-md border border-slate-800 border-l-2 border-l-amber-500 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-400">
        <div className="mb-0.5 truncate text-slate-500">{thread?.fileName ?? file.name}</div>
        <div className="line-clamp-3">“{thread?.quote ?? seed?.quote}”</div>
      </div>
    ) : null;

  const body = (
    <>
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <h3 className="text-sm font-medium text-slate-200">질문</h3>
        {status && status.configured && (
          <span className={`text-xs ${limitReached ? 'text-amber-400' : 'text-slate-600'}`}>
            오늘 {status.used}{status.limit !== null ? `/${status.limit}` : '번'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {thread && !showHistory && hasAnswer && (
            <button
              onClick={() => setOutlineOpen(true)}
              title="이 대화 전체를 카드로 — 개념별로 나누거나 한 장으로"
              className="rounded border border-teal-800 bg-teal-950/50 px-2 py-0.5 text-xs font-medium text-teal-200 hover:bg-teal-900"
            >
              카드로
            </button>
          )}
          <button onClick={() => void openHistory()} className="rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            지난 대화
          </button>
          {thread && !showHistory && (
            <button onClick={() => void deleteThread(thread.id)} className="rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-red-300">
              삭제
            </button>
          )}
          <button onClick={newThread} className="rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            새 대화
          </button>
          <button onClick={onClose} title="닫기 (대화는 남아 있어요)" className="ml-1 px-1 text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="mb-1 flex items-center justify-between px-1 text-xs text-slate-500">
            <span>최근 30일</span>
            <button onClick={() => setShowHistory(false)} className="hover:text-slate-300">← 돌아가기</button>
          </div>
          {history.length === 0 ? (
            <p className="px-2 py-4 text-xs text-slate-600">지난 대화가 없습니다</p>
          ) : (
            history.map((t) => (
              <div key={t.id} className="flex items-center rounded-md hover:bg-slate-900">
                <button onClick={() => void loadThread(t.id)} className="min-w-0 flex-1 px-2 py-2 text-left">
                  <div className="truncate text-sm text-slate-200">{t.title}</div>
                  <div className="truncate text-xs text-slate-500">
                    {t.fileName ?? '문서 없음'} · {t.messageCount ?? 0}개 · {new Date(t.updatedAt).toLocaleDateString()}
                  </div>
                </button>
                <button
                  onClick={() => void deleteThread(t.id)}
                  title="이 대화 지우기"
                  className="h-11 w-11 shrink-0 text-slate-600 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain p-3 text-sm">
          {contextChip}
          {notConfigured && (
            <p className="rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              관리자가 아직 LLM을 연결하지 않았어요. 서버의 <code>ANTHROPIC_API_KEY</code>가 필요합니다.
            </p>
          )}
          {messages.length === 0 && !notConfigured && (
            <p className="px-1 text-xs text-slate-600">
              {seed
                ? '아래 문장에 대해 물어보세요.'
                : isPc
                  ? '문서에서 문장을 드래그하면 그 부분이 문맥으로 붙어요. 그냥 물어봐도 됩니다.'
                  : '시트를 내리고 문장을 길게 눌러 고른 뒤 [질문]을 누르면 그 문장이 붙어요. 그냥 물어봐도 됩니다.'}
            </p>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="ml-6 self-end whitespace-pre-wrap rounded-2xl rounded-br-sm bg-sky-700 px-3 py-2 text-slate-50">
                {m.content}
              </div>
            ) : (
              <div key={m.id} className="relative mr-2 rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-900 px-3 py-2 pr-9 text-slate-200">
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
                      picked.has(m.id) ? 'border-teal-500 bg-teal-600 text-white' : `border-slate-600 text-transparent hover:border-slate-400 ${picking ? '' : 'opacity-40'}`
                    }`}
                  >
                    ✓
                  </button>
                )}
                {m.content === '' ? (
                  <span className="text-slate-500">{searching ? '🌐 웹에서 찾는 중…' : '생각 중…'}</span>
                ) : MdRenderer ? (
                  <Suspense fallback={<span className="whitespace-pre-wrap">{m.content}</span>}>
                    <div className="ask-md">
                      <MdRenderer content={m.content} theme={getAppProseTheme()} />
                    </div>
                  </Suspense>
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
                {m.id !== 'streaming' && (
                  <div className="mt-1.5 flex gap-1 text-xs">
                    {thread && typeof m.id === 'number' && m.id > 0 && (
                      <button
                        onClick={() => setSave({ messageId: m.id as number })}
                        className="rounded border border-teal-700 bg-teal-950/50 px-2 py-0.5 font-medium text-teal-200 hover:bg-teal-900"
                      >
                        📚 카드로 저장
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
      )}

      <div className="border-t border-slate-800 p-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pc:pb-2">
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
        {pendingQuote && (
          <div className="mb-1.5 flex items-start gap-1 rounded-md border border-slate-800 border-l-2 border-l-amber-500 bg-slate-900 px-2 py-1 text-xs text-slate-400">
            <span className="line-clamp-2 flex-1">“{pendingQuote}”</span>
            <button onClick={onConsumePendingQuote} className="text-slate-500 hover:text-slate-300" title="인용 빼기">✕</button>
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
                  ? '꼬리질문… (Enter 보내기 · Shift+Enter 줄바꿈)'
                  : '질문을 입력하세요'
            }
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none disabled:opacity-50"
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.abort()}
              title="답변 중단"
              className="h-11 w-11 shrink-0 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              ■
            </button>
          ) : (
            <button
              onClick={() => void send(input)}
              disabled={!canSend}
              title="보내기 (Enter)"
              className="h-11 w-11 shrink-0 rounded-lg bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40"
            >
              ➤
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-600">문서 전체가 아니라 드래그한 문장의 앞뒤 문단만 LLM에 보냅니다</p>
      </div>
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

  if (isPc) {
    // 버전 기록 패널과 같은 자리·같은 폭 (IA — SCR-180)
    return <aside className="flex w-96 shrink-0 flex-col border-l border-slate-800 bg-slate-950">{body}</aside>;
  }
  return (
    <>
      <div className="fixed inset-0 z-20 bg-black/50" onClick={onClose} />
      <div
        className="fixed inset-x-0 z-30 flex flex-col rounded-t-2xl border-t border-slate-700 bg-slate-950"
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
