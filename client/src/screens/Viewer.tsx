import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AskPanel, { type AskSeed } from '../components/AskPanel';
import CardView from '../components/CardView';
import VersionPanel from '../components/VersionPanel';
import ViewerMenu, { type ViewerAction } from '../components/ViewerMenu';
import { api, ApiError, isTextFileType, type FileContent, type TreeFile, type UserSettings } from '../lib/api';
import { CHROME_HEIGHT, reportChromeScroll, showChrome, useChromeTarget } from '../lib/chromeCollapse';
import { ASK_CONTEXT_MAX_CHARS, ASK_QUOTE_MAX_CHARS, FONT_SCALE_DEFAULT } from '../lib/constants';
import { cardTitle } from '../lib/frontmatter';
import { useSheetDrag } from '../lib/sheetDrag';
import { toast } from '../lib/toast';
import { finishBoot, timed } from '../lib/bootTiming';
import { CodeRenderer, PdfRenderer, renderers, type RendererSelection } from '../renderers';
import Editor from './Editor';

type Props = {
  file: TreeFile;
  settings: UserSettings;
  immersive: boolean;
  onToggleImmersive: () => void;
  onContentSaved: () => void;
  /** 파일별 열람 상태(화면 맞춤 등)를 바꿨을 때 — 트리가 들고 있는 state를 다시 받아 오게 한다 */
  onStateChanged: () => void;
  onToggleFavorite: (file: TreeFile) => void;
  onDirtyChange: (dirty: boolean) => void;
  /** 분할 중일 때만 옴 — 이 칸을 화면에서 닫는다 (문서는 탭에 남음) */
  onClosePane?: () => void;
  /** 활성 칸 여부 — E(편집) 단축키는 활성 칸의 뷰어만 받는다 */
  isActive?: boolean;
  /** 문서 속 상대 경로 링크로 다른 파일 열기 — (경로, 분할로 열지) (IA — 문서 내부 링크) */
  onOpenLink?: (path: string, split: boolean) => void;
  /** 줄 번호 앵커(#L16-L26)로 열렸을 때 하이라이트·이동할 줄 범위 */
  jumpLines?: { start: number; end: number };
  /** ⋯ 메뉴 "분할 보기" — 이미 열린 다른 탭과 분할. 대기 탭이 없으면 안 옴 (IA — 분할 컨트롤러) */
  onSplitView?: () => void;
  /** 터치 전용: 파일명 탭 → 문서 스위처 시트 (IA — 모바일 재편) */
  onOpenSwitcher?: () => void;
  /** 다른 파일 열기 — 카드를 저장하면 그 카드를 연다 (SCR-182) */
  onOpenFile?: (file: TreeFile) => void;
  /** 카드 출처로 열렸을 때 문서에서 찾아 형광펜 칠할 문장 (배움 카드 — 출처 클릭) */
  jumpQuote?: string;
  /** 카드 뷰의 출처 클릭 — 그 대화의 문서를 열고 문장으로 간다 */
  onOpenSource?: (threadId: number) => void;
  /** 카드 뷰의 연결 클릭 — 그 이름의 카드를 연다 */
  onOpenCard?: (title: string) => void;
  /** 문서 속에 점선 밑줄을 그을 내 카드 용어 (활용 ②). 설정이 꺼져 있으면 빈 배열 */
  terms?: { id: number; title: string; aliases: string[]; oneLine: string; kind: string }[];
  /** 터치 전용: 헤더 좌우 스와이프 → 이전/다음 문서 */
  onSwipeTab?: (dir: 1 | -1) => void;
};

/** 오버레이 헤더가 iframe 문서의 상단 UI(자체 목차 버튼·sticky 메뉴)를 덮지 않게 밀어 두는 거리.
    헤더 높이 그 자체 — 같은 것을 막는 같은 크기여야 한다 */
const CHROME_FRAME_INSET = CHROME_HEIGHT;
/** 용어 팝오버 너비(px) — 화면 밖으로 안 나가게 자리를 보정할 때 쓴다 */
const TERM_POP_WIDTH = 260;
/** 헤더 스와이프 판정 — 가로로 이만큼, 세로 이탈은 이 이하 */
const SWIPE_MIN_X = 60;
const SWIPE_MAX_Y = 40;

// 앱 테마와 독립인 본문 배경 — 앱 테마 변수의 영향을 받지 않게 고정 색으로 지정한다
const THEME_BG: Record<UserSettings['viewerTheme'], string> = {
  light: 'bg-white',
  sepia: 'bg-[#f4ecd8]',
  green: 'bg-[#e9f0e3]',
  gray: 'bg-[#e2e4e8]',
  dark: 'bg-[#020617]',
  night: 'bg-[#1f2430]',
};
const WIDTH: Record<UserSettings['contentWidth'], string> = {
  narrow: 'max-w-xl',
  normal: 'max-w-3xl',
  wide: 'max-w-none',
};

// 목차 한 줄 — md는 바깥 DOM의 헤딩에서, html은 iframe 심의 보고에서 만들어진다
type Heading = { text: string; level: number; jump: () => void };

/** 선택이 든 블록과 앞뒤 블록의 글 — LLM에 보낼 문맥. "문서 전체를 보내지 않는다"는 설계 원칙의 구현 지점
    (HTML iframe 심의 selectionShim과 같은 규칙이어야 한다 — 형식에 따라 문맥 크기가 달라지면 안 된다) */
function blockContext(node: Node, root: HTMLElement): string {
  let el: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (el && el !== root && getComputedStyle(el).display === 'inline') el = el.parentElement;
  if (!el || el === root) return '';
  const txt = (e: Element | null) => (e ? (e.textContent ?? '').replace(/\s+/g, ' ').trim() : '');
  return [txt(el.previousElementSibling), txt(el), txt(el.nextElementSibling)]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, ASK_CONTEXT_MAX_CHARS);
}

/** 선택 바(물어보기)의 크기·간격 — 선택과 겹치지 않게 띄우는 거리 */
const ASK_BAR_WIDTH = 120;
const ASK_BAR_GAP = 40;

/** CSS의 pc 변형과 같은 판정 — 터치 기기에서만 다른 동작이 필요할 때 사용 */
const isPcDevice = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// SCR-150: 뷰어 — 렌더러 표시 + 즐겨찾기 + 읽던 위치 저장·복원 + 목차(SCR-151) + 버전(SCR-152)
export default function Viewer({ file, settings, immersive, onToggleImmersive, onContentSaved, onStateChanged, onToggleFavorite, onDirtyChange, onClosePane, isActive, onOpenLink, jumpLines, onSplitView, onOpenSwitcher, onSwipeTab, onOpenFile, jumpQuote, onOpenSource, onOpenCard, terms }: Props) {
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [showVersions, setShowVersions] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [fit, setFit] = useState(file.state.viewerFit !== 0);
  const [showMenu, setShowMenu] = useState(false);
  // null = 이 파일만의 배율 없음(설정의 전역 기본값을 따름)
  const [fontScale, setFontScale] = useState<number | null>(file.state.fontScale);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const scaleSaveRef = useRef<number | undefined>(undefined);
  const lastScrollYRef = useRef(0);
  // 스와이프 추적 — 브라우저가 제스처를 가로채면 touchend 대신 touchcancel이 와서 last를 대신 쓴다
  const swipeRef = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);
  // 읽기 진행률(%) — 터치에서 크롬이 숨어도 위치 감을 주는 2px 줄. null이면 표시 안 함
  const [progress, setProgress] = useState<number | null>(null);
  // 목차도 터치에서는 바텀 시트다 — 다른 시트와 같은 손잡이·같은 제스처를 준다 (IA)
  const toc = useSheetDrag(() => setShowToc(false));
  // PDF는 페이지 자리가 잡힌 뒤에야 스크롤 길이가 생긴다 — 그 전에 읽던 위치를 복원하면 0으로 뭉개진다
  const [pdfReady, setPdfReady] = useState(false);
  // 서버의 최신 열람 상태 — 트리의 file.state는 앱 시작 시점 캐시라, 재방문·기기 간 이어 읽기의
  // 복원 기준으로 쓰면 낡은 위치로 되돌아간다. 열 때마다 서버에서 새로 받는다
  const [freshState, setFreshState] = useState<TreeFile['state'] | null>(null);
  // 아직 서버로 안 보낸 마지막 스크롤 위치 — 앱을 닫거나 문서를 바꿀 때 유실 없이 flush한다
  const pendingRef = useRef<{ fileId: number; offset: number; ratio: number | null } | null>(null);
  // 문서 속 용어 밑줄 — 카드 자신을 열었을 때 제 제목에 밑줄을 긋지 않는다
  const ownTitle = file.kind === 'card' ? cardTitle(file.name) : null;
  const docTerms = useMemo(
    () => (terms ?? []).filter((t) => t.title !== ownTitle),
    [terms, ownTitle],
  );
  const [foundTerms, setFoundTerms] = useState<string[]>([]);
  // 밑줄 친 용어를 눌렀을 때 뜨는 작은 창 — 한 줄 정의 + 카드 열기 + 질문
  const [termPop, setTermPop] = useState<{ title: string; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  const onTermsFound = useCallback((titles: string[]) => setFoundTerms(titles), []);
  const onTermClick = useCallback((title: string, rect: { x: number; y: number; w: number; h: number }) => setTermPop({ title, rect }), []);
  useEffect(() => {
    setFoundTerms([]);
    setTermPop(null);
  }, [file.id]);
  // 열린 채 다른 곳을 누르거나 스크롤하면 닫는다
  useEffect(() => {
    if (!termPop) return;
    const onOutside = (e: Event) => {
      if (e.target instanceof Node && termPopRef.current?.contains(e.target)) return;
      setTermPop(null);
    };
    window.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onOutside, true);
    return () => {
      window.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('scroll', onOutside, true);
    };
  }, [termPop]);
  const termPopRef = useRef<HTMLDivElement>(null);
  /** 용어로 질문 — 그 용어를 인용으로 붙여 질문 패널을 연다 (드래그 질문과 같은 자리로 들어간다) */
  function askAboutTerm(title: string) {
    if (askConversing) setPendingQuote(title);
    else {
      setAskSeed({ quote: title, context: '' });
      setPendingQuote(null);
    }
    setAskStarted(true);
    setAskOpen(true);
    setTermPop(null);
    showChrome();
  }

  /** 출처 문장을 못 찾으면 알린다 — 문서가 고쳐졌을 수 있다 (설계 흐름 D: 카드는 멀쩡, 위치만 잃음) */
  const onQuoteFound = useCallback((found: boolean) => {
    if (!found) toast('출처 문장을 이 문서에서 찾지 못했습니다 — 문서가 바뀌었을 수 있어요', 'info');
  }, []);
  // SCR-180 질문 패널. 한 번 시작되면 닫아도 마운트를 유지한다 — 닫았다 열어도 대화가 이어지게 (IA — SCR-180)
  const [askOpen, setAskOpen] = useState(false);
  const [askStarted, setAskStarted] = useState(false);
  // 질문을 한 번이라도 보냈나 — 안 보냈으면 새 선택이 문맥을 갈아타고, 보냈으면 인용으로 붙는다 (v0.23.2)
  const [askConversing, setAskConversing] = useState(false);
  const [askSeed, setAskSeed] = useState<AskSeed | null>(null);
  // 대화 중 문서에서 다시 드래그한 문장 — 다음 질문에 인용으로 붙는다
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  // 지금 드래그돼 있는 문장 — [물어보기] 바를 띄우는 근거. 좌표는 뷰포트 기준 (html은 iframe 심이 보고)
  const [selection, setSelection] = useState<RendererSelection | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectionTimerRef = useRef<number | undefined>(undefined);
  // 스크롤 보고(콜백)에서 읽을 선택 상태의 거울 — 문장을 골라 둔 동안은 크롬을 접지 않는다
  const selectionRef = useRef<RendererSelection | null>(null);
  selectionRef.current = selection;

  // 바이너리는 본문(JSON)이 없다 — /raw를 렌더러에 직접 물린다 (아키텍처 — 저장 전략)
  const isBinary = !isTextFileType(file.fileType);

  // 렌더링 대신 코드(강조+줄 번호)로 볼 수 있는 형식 — code 형식은 이미 코드 뷰어라 제외
  const canCodeView =
    !isBinary && (file.fileType === 'md' || file.fileType === 'html' || file.fileType === 'text');
  // 코드로 보기 — 세션 한정 임시 모드. 줄 앵커로 열리면 자동으로 켠다 (IA — 코드로 보기)
  const [codeView, setCodeView] = useState(() => canCodeView && !!jumpLines);
  // 줄을 가리키는 링크는 "코드를 보라"는 뜻으로 해석한다
  useEffect(() => {
    if (jumpLines && canCodeView) setCodeView(true);
  }, [jumpLines, canCodeView]);
  const codeViewRef = useRef(codeView);
  codeViewRef.current = codeView;

  useEffect(() => {
    setData(null);
    setError(null);
    setMode('view');
    setShowVersions(false);
    setShowToc(false);
    setHeadings([]);
    setFreshState(null);
    // 복원은 서버의 최신 상태 기준 — 실패하면 트리 캐시로라도 열리게 한다
    api<{ state: TreeFile['state'] }>(`/me/files/${file.id}/state`)
      .then((r) => setFreshState(r.state))
      .catch(() => setFreshState(file.state));
    if (isBinary) {
      setData({ id: file.id, fileType: file.fileType, content: '', updatedAt: file.updatedAt, readonly: true });
    } else {
      // 시작 측정: 첫 문서 본문까지가 "앱이 떴다"의 끝 (딥링크로 열었을 때). 이후 문서는 timed가 무시한다
      timed('문서 본문 (/files/:id/content)', () => api<FileContent>(`/files/${file.id}/content`))
        .then((d) => {
          setData(d);
          finishBoot();
        })
        .catch((e: unknown) =>
          setError(e instanceof ApiError ? e.message : '본문을 불러오지 못했습니다'),
        );
    }
    // 열람 기록 (최근 열람 목록·이어 읽기의 기준 시각)
    void api(`/me/files/${file.id}/state`, {
      method: 'PUT',
      body: JSON.stringify({ touch: true }),
    }).catch(() => {});
  }, [file.id, file.fileType, file.updatedAt, isBinary]);

  // 파일을 바꿔 열면 그 파일에 저장해 둔 보기 설정(맞춤·배율)을 따른다.
  // file.id에만 반응시키는 이유: 조작 직후 트리가 갱신돼도 방금 누른 값을 도로 덮어쓰지 않게
  useEffect(() => {
    flushPending(); // 이전 문서의 미전송 위치를 문서 전환 전에 내보낸다
    setFit(file.state.viewerFit !== 0);
    setFontScale(file.state.fontScale);
    setShowMenu(false);
    setCodeView(!!jumpLines && canCodeView);
    setPdfReady(false);
    // 문서를 바꾸면 크롬은 일단 보이고 진행률은 새로 잰다
    setProgress(null);
    lastScrollYRef.current = 0;
    showChrome();
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 서버 최신 상태가 오면 보기 설정도 그쪽을 따른다 — 다른 기기에서 바꾼 배율·맞춤 반영
  useEffect(() => {
    if (!freshState) return;
    setFit(freshState.viewerFit !== 0);
    setFontScale(freshState.fontScale);
  }, [freshState]);

  // 편집기로 들어가면 크롬을 되살린다 — 도구가 숨은 채 편집을 시작하면 당황스럽다
  useEffect(() => {
    if (mode === 'edit') showChrome();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // E = 편집 — ⋯ 메뉴의 "편집 (E)" 표기 이행. 활성 칸에서만, 입력 중·수식키 조합은 무시
  // (IA — 신규 단축키. HTML 문서 iframe 안을 클릭한 상태에서는 키가 iframe에 머물러 안 온다)
  useEffect(() => {
    if (!isActive || mode !== 'view' || !data || data.readonly) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target;
      const typing =
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'e') setMode('edit');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, mode, data]);

  /** 우리가 그리는 본문(md·텍스트·코드)의 선택을 읽는다 — HTML은 iframe 심이 같은 모양으로 보고한다 */
  const readOwnSelection = useCallback(() => {
    const container = scrollRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return; // 패널 등 본문 밖의 선택은 무관
    const quote = sel.toString().replace(/\s+/g, ' ').trim().slice(0, ASK_QUOTE_MAX_CHARS);
    if (!quote) {
      setSelection(null);
      return;
    }
    const r = range.getBoundingClientRect();
    setSelection({
      quote,
      context: blockContext(range.startContainer, container),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
    });
  }, []);

  // 선택이 풀리면 바를 치우고, 터치 손잡이 조절처럼 mouseup이 안 오는 변경은 잠시 모아 읽는다.
  // HTML은 선택이 iframe 안에 있어 부모의 selectionchange가 오지 않는다 — 심이 따로 보고한다
  useEffect(() => {
    if (file.fileType === 'html' && !(codeView && canCodeView)) return;
    const onChange = () => {
      window.clearTimeout(selectionTimerRef.current);
      const s = window.getSelection();
      if (!s || s.isCollapsed) setSelection(null);
      else selectionTimerRef.current = window.setTimeout(readOwnSelection, 300);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.clearTimeout(selectionTimerRef.current);
    };
  }, [file.fileType, codeView, canCodeView, readOwnSelection]);

  /** 질문 패널 열기. 선택이 있으면 그 문장이 문맥(첫 대화) 또는 인용(대화 중)으로 붙는다 */
  const openAsk = useCallback(
    (withSelection: boolean) => {
      const sel = withSelection ? selection : null;
      if (sel) {
        if (askConversing) setPendingQuote(sel.quote);
        else {
          setAskSeed({ quote: sel.quote, context: sel.context });
          setPendingQuote(null);
        }
      }
      setAskStarted(true);
      setAskOpen(true);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      showChrome();
    },
    [selection, askConversing],
  );

  // 터치: 문장을 고르면 크롬을 펼친다 — 도구막대의 [물어보기]가 그 자리에 있어야 하니까 (떠 있는 바는 iOS 메뉴와 겹쳐 안 쓴다)
  useEffect(() => {
    if (selection && !isPcDevice()) showChrome();
  }, [selection]);

  // Ctrl+Shift+A = 질문 (선택이 있으면 그 문장이 붙음) — 활성 칸에서만 (IA — SCR-180)
  useEffect(() => {
    if (!isActive || mode !== 'view') return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        openAsk(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, mode, openAsk]);

  // 본문이 준비되면 읽던 위치로 복원한다 — 기기 간 이어 읽기의 핵심
  // (html은 스크롤이 iframe 안에서 일어나므로 렌더러의 심이 직접 복원한다)
  useEffect(() => {
    if (!data || !freshState || mode !== 'view' || data.fileType === 'html') return;
    if (data.fileType === 'pdf' && !pdfReady) return; // 페이지 자리가 잡히면 pdfReady가 다시 불러 준다
    if (jumpLines || jumpQuote) return; // 줄 앵커·출처 문장으로 열렸으면 렌더러가 그리로 데려간다 — 읽던 위치 복원과 겹치지 않게
    const pos = freshState.readingPosition;
    const el = scrollRef.current;
    if (!pos || !el) return;
    // 비율(0~1) 우선 — px 오프셋은 화면 폭이 다른 기기에서는 엉뚱한 문단에 내려준다
    const target = (denom: number) =>
      pos.ratio != null && denom > 0 ? Math.round(pos.ratio * denom) : Math.floor(pos.offset ?? 0);
    const first = target(el.scrollHeight - el.clientHeight);
    if (first <= 0) return;
    // 복원 스크롤은 사용자 스크롤이 아니다 — 기준값을 먼저 맞춰 크롬이 숨지 않게 한다
    lastScrollYRef.current = first;
    let retry: number | undefined;
    requestAnimationFrame(() => {
      el.scrollTop = first;
      const applied = el.scrollTop; // 문서가 아직 짧으면 브라우저가 값을 깎는다
      // 지연 렌더(md 하이라이트·이미지 등)로 높이가 늦게 자라는 문서 — 사용자가 안 움직였을 때만 재보정
      retry = window.setTimeout(() => {
        if (Math.abs(el.scrollTop - applied) > 4) return;
        const t2 = target(el.scrollHeight - el.clientHeight);
        lastScrollYRef.current = t2;
        el.scrollTop = t2;
      }, 600);
    });
    return () => window.clearTimeout(retry);
    // 복원은 본문+최신 상태 도착 시 1회 (PDF만 준비 신호를 한 번 더 기다린다)
  }, [data, mode, pdfReady, freshState]); // eslint-disable-line react-hooks/exhaustive-deps

  // 목차: 렌더링된 DOM에서 헤딩을 수집한다 (지연 렌더러 대비 재시도 1회)
  // html은 격리 iframe 안이라 여기서 닿을 수 없다 — 렌더러 심이 onToc으로 대신 보고한다
  const collectHeadings = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const els = [...container.querySelectorAll<HTMLElement>('h1, h2, h3')];
    setHeadings(
      els.map((el) => ({
        text: el.textContent ?? '',
        level: Number(el.tagName[1]),
        jump: () => el.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      })),
    );
  }, []);

  useEffect(() => {
    if (!showToc || !data || data.fileType === 'html') return;
    collectHeadings();
    const retry = window.setTimeout(collectHeadings, 600);
    return () => window.clearTimeout(retry);
  }, [showToc, data, collectHeadings]);

  /** 미전송 위치 즉시 전송 — keepalive라 페이지가 닫히는 중에도 요청이 살아남는다.
      앱 종료·백그라운드 전환·문서 전환 때 불러 "마지막 2초"가 유실되지 않게 한다 */
  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    window.clearTimeout(debounceRef.current);
    void fetch(`/api/v1/me/files/${p.fileId}/state`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readingPosition: { offset: p.offset, ...(p.ratio != null ? { ratio: p.ratio } : {}) },
      }),
    }).catch(() => {});
  }, []);

  // 읽던 위치 저장 — 바깥 div 스크롤(md 등)과 iframe 내부 스크롤 보고(html)가 공유한다
  const saveOffset = useCallback(
    (offset: number, ratio: number | null) => {
      // 코드 보기는 검사용 임시 모드 — 렌더링 보기의 읽던 위치를 덮어쓰지 않는다 (IA — 코드로 보기)
      if (codeViewRef.current) return;
      pendingRef.current = { fileId: file.id, offset, ratio };
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(flushPending, 2000);
    },
    [file.id, flushPending],
  );

  // 앱을 닫거나(pagehide) 홈으로 나가면(visibility hidden) 디바운스를 기다리지 않고 바로 보낸다
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPending();
    };
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onHide);
      flushPending(); // 뷰어 자체가 사라질 때(탭 정리 등)도 유실 없이
    };
  }, [flushPending]);

  /** 스크롤 위치 하나에서 세 가지를 뽑는다: 읽던 위치 저장 + 크롬 숨김 힌트 + 진행률 */
  const reportScroll = useCallback(
    (y: number, denom: number | null, ratioOverride?: number) => {
      // 터치의 크롬은 이 델타만큼 손가락을 따라 접힌다 — 판정·그리기는 lib/chromeCollapse가 든다
      const delta = y - lastScrollYRef.current;
      lastScrollYRef.current = y;
      if (!isPcDevice() && !selectionRef.current) reportChromeScroll(y, delta);
      if (denom !== null) {
        // 짧은 문서는 줄이 의미 없다 — 화면 반 이상 스크롤될 때만 표시
        const next = denom > 300 ? Math.min(100, Math.round((y / denom) * 100)) : null;
        setProgress((prev) => (prev === next ? prev : next));
      }
      // 비율은 html이면 심이 재서 주고(ratioOverride), 아니면 여기서 계산한다
      const ratio =
        ratioOverride ?? (denom !== null && denom > 0 ? Math.min(1, Math.max(0, y / denom)) : null);
      saveOffset(y, ratio);
    },
    [saveOffset],
  );

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    reportScroll(el.scrollTop, el.scrollHeight - el.clientHeight);
    // 선택 바의 좌표는 선택 순간의 것 — 스크롤하면 새 좌표로 다시 잰다 (선택은 그대로라 바가 글을 따라간다)
    if (selection) readOwnSelection();
  }

  // 격리된 문서 안의 클릭은 부모에 닿지 않는다 — 렌더러가 알려 주면 팝오버를 닫는다
  const closeMenu = useCallback(() => setShowMenu(false), []);

  /** 파일별 보기 설정 저장 — 화면에는 즉시 반영하고 서버 저장은 뒤따르게 한다 */
  function saveState(patch: { viewerFit?: boolean; fontScale?: number | null }) {
    void api(`/me/files/${file.id}/state`, { method: 'PUT', body: JSON.stringify(patch) })
      .then(onStateChanged)
      .catch(() => {});
  }

  function changeFit(next: boolean) {
    setFit(next);
    saveState({ viewerFit: next });
  }

  function changeScale(next: number) {
    setFontScale(next);
    // +/− 연타 시 요청이 쌓이지 않게 잠깐 모았다 보낸다
    window.clearTimeout(scaleSaveRef.current);
    scaleSaveRef.current = window.setTimeout(() => saveState({ fontScale: next }), 500);
  }

  function resetScale() {
    setFontScale(null);
    window.clearTimeout(scaleSaveRef.current);
    saveState({ fontScale: null });
  }

  useEffect(
    () => () => {
      window.clearTimeout(debounceRef.current);
      window.clearTimeout(scaleSaveRef.current);
    },
    [],
  );

  // 크롬 접힘에 태울 요소들 — 진행도는 lib/chromeCollapse가 들고 transform을 DOM에 직접 쓴다 (터치 전용).
  // 훅이라 early return보다 위에 있어야 한다
  const touch = !isPcDevice();
  const headerRef = useChromeTarget(touch ? { dir: 'up' } : null);
  const toolbarRef = useChromeTarget(touch ? { dir: 'down' } : null);
  // HTML은 남의 문서를 iframe에 담는 유일한 경로다 — 우리가 그리는 본문처럼 상단 여백(touch:pt-14)을
  // 안에 넣어 줄 수가 없다. 그래서 크롬이 떠 있는 만큼 iframe 상자 자체를 내려 둔다.
  // 안 그러면 문서가 가진 목차 버튼·sticky 메뉴가 우리 헤더 밑에 깔린다 (IA — 모바일 크롬)
  const frameInset = touch && file.fileType === 'html' && !(codeView && canCodeView);
  const frameRef = useChromeTarget(
    frameInset ? { dir: 'up', distance: CHROME_FRAME_INSET, base: CHROME_FRAME_INSET } : null,
  );
  // 스크롤 상자는 scrollTop을 읽는 ref와 접힘 ref를 같이 쓴다 — 인라인 화살표로 합치면 렌더마다
  // 등록이 풀렸다 붙어 진행 중인 전환이 끊기므로 identity를 고정한다
  const setScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      frameRef(el);
    },
    [frameRef],
  );

  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  // 최신 상태(freshState)까지 기다린다 — html은 iframe에 심는 복원 위치가 마운트 시점에 고정되기 때문
  if (!data || !freshState) return <p className="p-6 text-sm text-slate-500">불러오는 중…</p>;

  if (mode === 'edit') {
    return (
      <Editor
        file={data}
        onCancel={() => setMode('view')}
        onDirtyChange={onDirtyChange}
        onSaved={(content, updatedAt) => {
          setData({ ...data, content, updatedAt });
          setMode('view');
          onContentSaved();
        }}
      />
    );
  }

  const Renderer = renderers[data.fileType];
  // 코드로 보기가 켜지면 형식별 렌더러 대신 코드 뷰어로 같은 본문을 그린다 (IA — 코드로 보기)
  const showAsCode = codeView && canCodeView;
  const BodyRenderer = showAsCode ? CodeRenderer : Renderer;
  const isFavorite = file.state.isFavorite === 1;
  // 파일별 값이 있으면 그것을, 없으면 전역 기본값을 쓴다 (대체이지 곱하기가 아니다).
  // md·텍스트의 전역 기본은 설정의 글자 크기(px) 자체라 배율 100%가 기준이고,
  // HTML만 문서마다 기준 px이 달라 전역 기본 배율(htmlFontScale)을 따로 갖는다
  const effectiveScale =
    fontScale ?? (data.fileType === 'html' ? settings.htmlFontScale : FONT_SCALE_DEFAULT);
  // 터치 기기에서는 조작을 화면 아래(엄지가 닿는 자리)로 내린다 — CSS의 pc/touch 변형과 같은 판정이고,
  // 기기 특성이라 실행 중에 바뀌지 않으므로 한 번만 재도 된다
  const isPc = isPcDevice();
  const actionButton = (active: boolean) =>
    // whitespace-nowrap이 없으면 폭이 좁을 때 "목 차"처럼 글자가 세로로 접힌다
    `whitespace-nowrap rounded border text-sm ${isPc ? 'px-3 py-1' : 'w-full px-4 py-2'} ${
      active
        ? 'border-slate-500 bg-slate-800 text-slate-100'
        : 'border-slate-700 text-slate-300 hover:bg-slate-900'
    }`;

  // 자주 쓰는 것(목차)만 남기고 나머지는 더보기로 접는다
  const menuItems: ViewerAction[] = [
    // 이미 열린 탭끼리 분할 — 트리의 "분할로 열기"(새 문서)와 역할을 나눈다 (IA)
    ...(onSplitView ? [{ label: '◫ 분할 보기', onClick: onSplitView }] : []),
    // 같은 본문을 보여주는 방식만 바꾼다 — md 설명 옆에 html "코드"를 두고 읽는 흐름용 (IA)
    ...(canCodeView
      ? [{ label: codeView ? '문서로 보기' : '코드로 보기', onClick: () => setCodeView((v) => !v), active: codeView }]
      : []),
    { label: '몰입 모드', onClick: onToggleImmersive },
    ...(isBinary
      ? []
      : [{ label: '버전 기록', onClick: () => setShowVersions((v) => !v), active: showVersions }]),
    // 텍스트든 바이너리든 원본 그대로 받는다 (텍스트 본문은 서버가 DB에서 꺼내 준다)
    { label: '다운로드', href: `/api/v1/files/${file.id}/raw`, download: file.name },
    ...(data.readonly ? [] : [{ label: '편집 (E)', onClick: () => setMode('edit') }]),
  ];

  const actions = (
    <>
      {onClosePane && (
        <button onClick={onClosePane} title="이 칸 닫기 (문서는 탭에 남음)" className={actionButton(false)}>
          ✕
        </button>
      )}
      {!isBinary &&
        (!isPc && selection ? (
          // 터치: 떠 있는 바 대신 도구막대의 이 버튼이 "고른 문장으로 묻기"가 된다 — 엄지 자리라 iOS 메뉴와 안 겹친다
          <button
            onClick={() => openAsk(true)}
            className="w-full min-w-0 truncate whitespace-nowrap rounded border border-sky-500 bg-sky-600 px-4 py-2 text-sm font-medium text-white"
          >
            💬 「{selection.quote.length > 12 ? `${selection.quote.slice(0, 12)}…` : selection.quote}」 물어보기
          </button>
        ) : (
          <button onClick={() => (askOpen ? setAskOpen(false) : openAsk(true))} className={actionButton(askOpen)} title="LLM에게 물어보기 (Ctrl+Shift+A)">
            질문
          </button>
        ))}
      {(data.fileType === 'md' || data.fileType === 'html') && !codeView && (
        <button onClick={() => setShowToc((v) => !v)} className={actionButton(showToc)}>
          목차
        </button>
      )}
      <ViewerMenu
        open={showMenu}
        placement={isPc ? 'down' : 'up'}
        buttonClass={actionButton}
        onToggle={() => setShowMenu((v) => !v)}
        onClose={closeMenu}
        items={menuItems}
        display={
          // 글자 크기는 우리가 그리는 문서(md·텍스트·코드)와 HTML 모두에 준다.
          // PDF도 우리가 canvas에 그리므로 같은 조작이 확대·축소가 된다.
          // 이미지는 브라우저가 그리는 것이라 배율을 걸 자리가 없다
          (isBinary && file.fileType !== 'pdf') || (!isBinary && !Renderer)
            ? null
            : {
                label: file.fileType === 'pdf' ? '확대/축소' : undefined,
                scale: effectiveScale,
                isOverride: fontScale !== null,
                onScaleChange: changeScale,
                onResetScale: resetScale,
                fit:
                  data.fileType === 'html' && !showAsCode
                    ? { on: fit, onChange: changeFit }
                    : undefined,
              }
        }
      />
    </>
  );

  // [물어보기] 바의 자리 — 뷰포트 좌표를 이 뷰어 상자 기준으로, 선택 위에 (PC 전용)
  const rootRect = selection ? rootRef.current?.getBoundingClientRect() : undefined;
  // 터치에서는 그리지 않는다 — iOS·안드로이드의 선택 메뉴가 위·아래 어디든 뜨는 데다 우리 바를 덮는다.
  // 폰은 도구막대의 [물어보기] 버튼이 그 역할을 한다 (v0.23.2)
  const askBar =
    selection && rootRect && mode === 'view' && isPc
      ? {
          left: Math.max(8, Math.min(rootRect.width - ASK_BAR_WIDTH - 8, selection.rect.x - rootRect.left)),
          top: Math.max(4, selection.rect.y - rootRect.top - ASK_BAR_GAP),
        }
      : null;

  const termCard = termPop ? docTerms.find((t) => t.title === termPop.title) ?? null : null;
  const popRect = termPop && termCard ? rootRef.current?.getBoundingClientRect() : undefined;
  const termPopStyle =
    termPop && popRect
      ? {
          left: Math.max(8, Math.min(popRect.width - TERM_POP_WIDTH - 8, termPop.rect.x - popRect.left)),
          top: Math.max(4, termPop.rect.y - popRect.top + termPop.rect.h + 6),
        }
      : null;

  return (
    <div ref={rootRef} className="relative flex h-full flex-col">
      {termPopStyle && termCard && (
        <div ref={termPopRef} className="absolute z-30 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 shadow-xl shadow-black/40" style={{ ...termPopStyle, width: TERM_POP_WIDTH }}>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold">{termCard.title}</span>
            <span className="rounded border border-slate-700 px-1 text-[10px] text-slate-500">{termCard.kind}</span>
            <button onClick={() => setTermPop(null)} className="ml-auto px-1 text-slate-500 hover:text-slate-300">✕</button>
          </div>
          <p className="mt-1 text-xs text-slate-300">{termCard.oneLine}</p>
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => { setTermPop(null); onOpenCard?.(termCard.title); }} className="rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-500">카드 열기</button>
            <button onClick={() => askAboutTerm(termCard.title)} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800">이 용어 질문</button>
          </div>
        </div>
      )}
      {askBar && (
        <div className="absolute z-30" style={askBar}>
          <button
            // pointerdown에서 처리한다 — 기본 동작(mousedown)이 먼저 선택을 풀어 버리면 클릭이 도착할 때 문장이 없다
            onPointerDown={(e) => {
              e.preventDefault();
              openAsk(true);
            }}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-sm font-medium text-white shadow-lg shadow-black/30 hover:bg-sky-500"
          >
            💬 물어보기
          </button>
        </div>
      )}
      {/* 몰입 모드: 헤더·레일·패널을 숨기고 본문만 — 떠 있는 종료 버튼만 남긴다 */}
      {immersive && (
        <button
          onClick={onToggleImmersive}
          title="몰입 모드 종료"
          className="fixed right-3 top-3 z-30 rounded-md border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-slate-300 backdrop-blur hover:text-white"
        >
          ✕
        </button>
      )}
      {!immersive && (
      // 터치에서는 스크롤을 따라 헤더가 접힌다 (IA — 크롬 추종). transform은 headerRef가 DOM에 직접 쓴다.
      // 본문 위에 겹쳐(absolute) transform으로만 미끄러지게 한다 — 예전처럼 max-h로 접으면
      // 나타날 때마다 본문 레이아웃이 통째로 밀려 스크롤이 뚝뚝 끊겼다. transform은 레이아웃을
      // 건드리지 않아 스크롤 관성이 살아 있다 (편집 모드는 위의 early return이라 여기 안 온다)
      <div ref={headerRef} className={isPc ? '' : 'absolute inset-x-0 top-0 z-20'}>
      <div
        // touch-none: 헤더에서 시작한 터치를 브라우저 제스처(스크롤·내비게이션)가 가로채지 않게 —
        // 가로채면 touchend 대신 touchcancel이 와서 스와이프가 끊긴다
        className="touch-none flex items-center gap-3 border-b border-slate-800 px-4 py-2 touch:bg-slate-950/90 touch:pl-14 touch:backdrop-blur"
        // 헤더 좌우 스와이프 = 이전/다음 문서 (본문 스와이프는 스크롤과 싸우므로 헤더 한정)
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) swipeRef.current = { x: t.clientX, y: t.clientY, lastX: t.clientX, lastY: t.clientY };
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          const s = swipeRef.current;
          if (t && s) {
            s.lastX = t.clientX;
            s.lastY = t.clientY;
          }
        }}
        onTouchEnd={(e) => {
          const s = swipeRef.current;
          swipeRef.current = null;
          if (!s || !onSwipeTab) return;
          const t = e.changedTouches[0];
          const endX = t?.clientX ?? s.lastX;
          const endY = t?.clientY ?? s.lastY;
          const dx = endX - s.x;
          if (Math.abs(dx) >= SWIPE_MIN_X && Math.abs(endY - s.y) <= SWIPE_MAX_Y) {
            onSwipeTab(dx < 0 ? 1 : -1);
          }
        }}
        onTouchCancel={() => {
          // 가로채임 — 그동안 추적한 last 좌표로 판정을 이어간다
          const s = swipeRef.current;
          swipeRef.current = null;
          if (!s || !onSwipeTab) return;
          const dx = s.lastX - s.x;
          if (Math.abs(dx) >= SWIPE_MIN_X && Math.abs(s.lastY - s.y) <= SWIPE_MAX_Y) {
            onSwipeTab(dx < 0 ? 1 : -1);
          }
        }}
      >
        <button
          onClick={() => onToggleFavorite(file)}
          title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
          className={`text-lg leading-none ${isFavorite ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
        >
          ★
        </button>
        {onOpenSwitcher ? (
          // 터치: 파일명이 곧 문서 스위처 버튼 — 탭 바 대신 시트로 오간다 (IA — 문서 스위처)
          <button onClick={onOpenSwitcher} className="flex min-w-0 items-center gap-1.5 text-left">
            <h2 className="truncate font-medium text-slate-100">{file.name}</h2>
            <span className="shrink-0 text-xs text-slate-500">▾</span>
          </button>
        ) : (
          <h2 className="truncate font-medium text-slate-100">{file.name}</h2>
        )}
        <span className="text-xs text-slate-500 touch:hidden">
          {new Date(data.updatedAt).toLocaleString()} 수정
        </span>
        {/* PC는 헤더 오른쪽에, 터치 기기는 아래 도구막대에 둔다 */}
        {isPc && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {/* 읽기 진행률 — 터치에서 크롬이 숨어도 위치 감을 주는 얇은 줄 (IA — 크롬 자동 숨김) */}
        {!isPc && progress !== null && mode === 'view' && (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-slate-800/60">
            <div className="h-full bg-sky-500 transition-[width] duration-150" style={{ width: `${progress}%` }} />
          </div>
        )}
        {/* SCR-151: 목차 — 데스크톱은 인라인 사이드 패널, 터치 기기는 바텀 시트 (IA — 모바일 재편) */}
        {showToc && (
          <>
            <div className="fixed inset-0 z-20 bg-black/50 pc:hidden" onClick={() => setShowToc(false)} />
            <nav
              className="w-56 shrink-0 overflow-auto overscroll-contain border-r border-slate-800 py-3 touch:fixed touch:inset-x-0 touch:bottom-0 touch:top-auto touch:z-30 touch:max-h-[70vh] touch:w-auto touch:rounded-t-2xl touch:border-r-0 touch:border-t touch:border-slate-700 touch:bg-slate-900 touch:pb-[calc(env(safe-area-inset-bottom)+12px)]"
              style={isPc ? undefined : toc.sheetStyle}
            >
              {/* 손잡이는 시트일 때만 — PC에서는 인라인 사이드 패널이라 끌 것이 없다 */}
              {!isPc && (
                <div {...toc.handleProps} className={`${toc.handleProps.className} -mt-3 px-4 pb-1 pt-3`}>
                  <div className="mx-auto h-1 w-9 rounded-full bg-slate-600" />
                </div>
              )}
              {headings.length === 0 ? (
                <p className="px-3 text-xs text-slate-600">표시할 헤딩이 없습니다</p>
              ) : (
                headings.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      h.jump();
                      if (!isPcDevice()) setShowToc(false); // 터치에선 선택 즉시 드로어를 닫아 본문을 보여준다
                    }}
                    className="block w-full truncate px-3 py-1 text-left text-[13px] text-slate-400 transition hover:bg-slate-900 hover:text-slate-200"
                    style={{ paddingLeft: `${12 + (h.level - 1) * 12}px` }}
                  >
                    {h.text}
                  </button>
                ))
              )}
            </nav>
          </>
        )}
        <div
          ref={setScrollEl}
          onScroll={handleScroll}
          onMouseUp={readOwnSelection}
          onTouchEnd={readOwnSelection}
          // 본문은 세로로만 스크롤: 가로 오버플로 차단 + 터치는 세로 팬만 + 스크롤 관성이 밖으로 새지 않게.
          // HTML일 때는 frameRef가 이 상자의 transform도 쓴다 — 위치만 옮긴다. 크기를 바꾸면 iframe 안의
          // 문서가 통째로 다시 그려져 스크롤이 끊긴다 (html은 이 상자로 스크롤하지 않아 부작용도 없다)
          className={`min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden touch-pan-y overscroll-contain ${THEME_BG[settings.viewerTheme]}`}
        >
          {file.fileType === 'pdf' ? (
            // iframe(브라우저 내장 뷰어) 대신 직접 그린다 — iOS는 iframe 속 PDF의 1페이지만 그림처럼 보여줬다.
            // key=파일 id: 파일을 바꾸면 문서·페이지 상태를 통째로 새로 만든다
            <Suspense fallback={<p className="p-6 text-sm text-slate-500">PDF 뷰어 준비 중…</p>}>
              {/* 터치의 상하 여백: 오버레이 바가 문서 첫·끝 페이지를 가리지 않게 하는 상수 공간 */}
              <div className="touch:pt-10 touch:pb-20">
                <PdfRenderer
                  key={file.id}
                  fileId={file.id}
                  scale={effectiveScale}
                  onReady={() => setPdfReady(true)}
                />
              </div>
            </Suspense>
          ) : file.fileType === 'image' ? (
            <div className="flex min-h-full items-center justify-center p-6">
              <img src={`/api/v1/files/${file.id}/raw`} alt={file.name} className="max-w-full" />
            </div>
          ) : file.fileType === 'video' ? (
            <div className="flex min-h-full items-center justify-center p-6">
              {/* key=파일 id: 파일을 바꿔 열면 재생 상태를 버리고 새로 시작한다 */}
              <video key={file.id} src={`/api/v1/files/${file.id}/raw`} controls className="max-h-full max-w-full" />
            </div>
          ) : file.fileType === 'audio' ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6">
              <span className="text-5xl">🎵</span>
              <p className="max-w-full truncate text-sm text-slate-400">{file.name}</p>
              <audio key={file.id} src={`/api/v1/files/${file.id}/raw`} controls className="w-full max-w-xl" />
            </div>
          ) : file.fileType === 'binary' ? (
            // 미리보기 없는 형식 — "보관돼 있고, 여기서 꺼내가면 된다"는 화면 (아키텍처 — 전량 수용 정책)
            <div className="flex min-h-full items-center justify-center p-6">
              <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-8 py-10 text-center">
                <span className="text-5xl">📦</span>
                <p className="w-full truncate font-medium text-slate-200" title={file.name}>{file.name}</p>
                <p className="text-xs text-slate-500">
                  {file.sizeBytes >= 1024 * 1024
                    ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB`
                    : `${Math.max(1, Math.round(file.sizeBytes / 1024))}KB`}
                  {file.updatedAt > 0 && ` · ${new Date(file.updatedAt).toLocaleDateString()}`}
                </p>
                <p className="text-xs text-slate-500">이 형식은 미리보기를 지원하지 않습니다</p>
                <a
                  href={`/api/v1/files/${file.id}/raw`}
                  download={file.name}
                  className="mt-2 rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                >
                  ⬇ 다운로드
                </a>
              </div>
            </div>
          ) : file.fileType === 'html' && Renderer && !showAsCode ? (
            // 앱형 HTML은 여백·폭 제한 없이 화면을 꽉 채워 렌더링한다
            // key=파일 id: 파일을 바꿔 열면 iframe을 새로 만들어 읽던 위치를 그 파일 기준으로 심는다
            <Renderer
              key={file.id}
              content={data.content}
              theme={settings.viewerTheme}
              initialOffset={freshState.readingPosition?.offset ?? 0}
              initialRatio={freshState.readingPosition?.ratio}
              onScrollOffset={(o, r) => reportScroll(o, null, r)}
              onToc={setHeadings}
              onInteract={closeMenu}
              onSelection={setSelection}
              fit={fit}
              fontScale={effectiveScale}
              highlightQuote={jumpQuote}
              onQuoteFound={onQuoteFound}
              terms={docTerms}
              onTermsFound={onTermsFound}
              onTermClick={onTermClick}
            />
          ) : (
            <div
              // 터치의 pt·pb: 오버레이 바가 본문 첫·끝 줄을 가리지 않게 하는 상수 공간 (크롬 자동 숨김)
              className={`mx-auto p-6 touch:pt-14 touch:pb-24 ${WIDTH[settings.contentWidth]}`}
              // 설정의 글자 크기(px)를 100% 기준으로 두고 파일별 배율을 곱한다 —
              // 안쪽 요소들이 em/rem으로 짜여 있어 제목·본문의 위계가 그대로 따라 커진다
              style={{ fontSize: (settings.fontSize * effectiveScale) / 100 }}
            >
              {foundTerms.length > 0 && file.kind !== 'card' && (
                // 이 문서에 내 카드가 몇 장 걸리는지 — 밑줄이 왜 그어져 있는지 설명하는 한 줄
                <p className="mb-4 rounded-md border border-teal-700/40 bg-teal-600/10 px-3 py-1.5 text-xs text-teal-700 dark:text-teal-300">
                  📚 이 문서에 내 카드 {foundTerms.length}장 · {foundTerms.join(', ')}
                </p>
              )}
              {BodyRenderer && file.kind === 'card' && !showAsCode ? (
                // 카드: 머리말은 표로, 본문은 md 렌더러로 (설계 — 카드 한 장 = 머리말 + 자유 본문)
                <CardView
                  title={cardTitle(file.name)}
                  content={data.content}
                  onAsk={() => openAsk(false)}
                  onOpenSource={onOpenSource}
                  onOpenLink={onOpenCard}
                  renderBody={(body) => (
                    <Suspense fallback={<p className="text-sm text-slate-500">뷰어 준비 중…</p>}>
                      <BodyRenderer content={body} theme={settings.viewerTheme} fileName={file.name} onFileLink={onOpenLink} terms={docTerms} onTermsFound={onTermsFound} onTermClick={onTermClick} />
                    </Suspense>
                  )}
                />
              ) : BodyRenderer ? (
                <Suspense fallback={<p className="text-sm text-slate-500">뷰어 준비 중…</p>}>
                  <BodyRenderer
                    content={data.content}
                    theme={settings.viewerTheme}
                    fileName={file.name}
                    onFileLink={onOpenLink}
                    highlightLines={jumpLines}
                    highlightQuote={jumpQuote}
                    onQuoteFound={onQuoteFound}
                    terms={docTerms}
                    onTermsFound={onTermsFound}
                    onTermClick={onTermClick}
                  />
                </Suspense>
              ) : (
                <p className="text-sm text-slate-500">이 형식({data.fileType})의 뷰어는 아직 없습니다</p>
              )}
            </div>
          )}
        </div>
        {askStarted && (
          // 닫아도 언마운트하지 않는다 — 대화 상태를 살려 두고 display만 끈다 (터치의 fixed 시트도 함께 숨는다)
          <div className={askOpen ? 'contents' : 'hidden'}>
            <AskPanel
              file={file}
              seed={askSeed}
              pendingQuote={pendingQuote}
              onConsumePendingQuote={() => setPendingQuote(null)}
              onConversingChange={setAskConversing}
              onOpenFile={onOpenFile}
              withCards={settings.askWithCards === 1}
              isPc={isPc}
              onClose={() => setAskOpen(false)}
            />
          </div>
        )}
        {showVersions && (
          <VersionPanel
            fileId={file.id}
            fileType={data.fileType}
            theme={settings.viewerTheme}
            readonly={data.readonly}
            onClose={() => setShowVersions(false)}
            onRestored={() => {
              // 복원 반영: 본문 재조회 + 트리 갱신
              setShowVersions(false);
              void api<FileContent>(`/files/${file.id}/content`).then(setData);
              onContentSaved();
            }}
          />
        )}
      </div>
      {/* 터치 기기의 아래쪽 도구막대 — 엄지가 닿는 자리에 조작을 모은다 (몰입 모드에서는 숨긴다).
          목차는 w-full로 남는 폭을 채우고 더보기는 오른쪽 끝에 — 목차가 없는 형식에서도 자리가 유지된다 */}
      {!isPc && !immersive && (
        // 헤더와 같은 원리: 오버레이 + transform 슬라이드 (레이아웃 불변 → 스크롤 안 끊김)
        <div ref={toolbarRef} className="absolute inset-x-0 bottom-0 z-20">
          <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/90 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)] backdrop-blur">
            {actions}
          </div>
        </div>
      )}
    </div>
  );
}
