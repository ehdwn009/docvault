import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import VersionPanel from '../components/VersionPanel';
import ViewerMenu, { type ViewerAction } from '../components/ViewerMenu';
import { api, ApiError, isTextFileType, type FileContent, type TreeFile, type UserSettings } from '../lib/api';
import { FONT_SCALE_DEFAULT } from '../lib/constants';
import { CodeRenderer, PdfRenderer, renderers } from '../renderers';
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
  /** 터치 전용: 헤더 좌우 스와이프 → 이전/다음 문서 */
  onSwipeTab?: (dir: 1 | -1) => void;
  /** 크롬 자동 숨김 상태 — 스크롤 방향은 이 뷰어가 보고하고(onChromeHint), 판정은 부모가 든다 */
  chromeHidden?: boolean;
  onChromeHint?: (hide: boolean) => void;
};

/** 크롬 자동 숨김 판정값 — 문서 상단 근처면 무조건 보이고, 이만큼 움직여야 방향으로 친다 */
const CHROME_SHOW_NEAR_TOP = 48;
const CHROME_SCROLL_DELTA = 8;
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

/** CSS의 pc 변형과 같은 판정 — 터치 기기에서만 다른 동작이 필요할 때 사용 */
const isPcDevice = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// SCR-150: 뷰어 — 렌더러 표시 + 즐겨찾기 + 읽던 위치 저장·복원 + 목차(SCR-151) + 버전(SCR-152)
export default function Viewer({ file, settings, immersive, onToggleImmersive, onContentSaved, onStateChanged, onToggleFavorite, onDirtyChange, onClosePane, isActive, onOpenLink, jumpLines, onSplitView, onOpenSwitcher, onSwipeTab, chromeHidden, onChromeHint }: Props) {
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
  const lastScrollYRef = useRef(0); // 크롬 자동 숨김의 방향 판정 기준
  // 스와이프 추적 — 브라우저가 제스처를 가로채면 touchend 대신 touchcancel이 와서 last를 대신 쓴다
  const swipeRef = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);
  // 읽기 진행률(%) — 터치에서 크롬이 숨어도 위치 감을 주는 2px 줄. null이면 표시 안 함
  const [progress, setProgress] = useState<number | null>(null);
  // PDF는 페이지 자리가 잡힌 뒤에야 스크롤 길이가 생긴다 — 그 전에 읽던 위치를 복원하면 0으로 뭉개진다
  const [pdfReady, setPdfReady] = useState(false);

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
    if (isBinary) {
      setData({ id: file.id, fileType: file.fileType, content: '', updatedAt: file.updatedAt, readonly: true });
    } else {
      api<FileContent>(`/files/${file.id}/content`)
        .then(setData)
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
    setFit(file.state.viewerFit !== 0);
    setFontScale(file.state.fontScale);
    setShowMenu(false);
    setCodeView(!!jumpLines && canCodeView);
    setPdfReady(false);
    // 문서를 바꾸면 크롬은 일단 보이고 진행률은 새로 잰다
    setProgress(null);
    lastScrollYRef.current = 0;
    onChromeHint?.(false);
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 편집기로 들어가면 크롬을 되살린다 — 도구가 숨은 채 편집을 시작하면 당황스럽다
  useEffect(() => {
    if (mode === 'edit') onChromeHint?.(false);
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

  // 본문이 준비되면 읽던 위치로 복원한다 — 기기 간 이어 읽기의 핵심
  // (html은 스크롤이 iframe 안에서 일어나므로 렌더러의 심이 직접 복원한다)
  useEffect(() => {
    if (!data || mode !== 'view' || data.fileType === 'html') return;
    if (data.fileType === 'pdf' && !pdfReady) return; // 페이지 자리가 잡히면 pdfReady가 다시 불러 준다
    if (jumpLines) return; // 줄 앵커로 열렸으면 렌더러가 그 줄로 데려간다 — 읽던 위치 복원과 겹치지 않게
    const offset = file.state.readingPosition?.offset;
    if (offset && scrollRef.current) {
      // 복원 스크롤은 사용자 스크롤이 아니다 — 기준값을 먼저 맞춰 크롬이 숨지 않게 한다
      lastScrollYRef.current = offset;
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = offset;
      });
    }
    // 복원은 본문 로드 완료 시 1회 (PDF만 준비 신호를 한 번 더 기다린다)
  }, [data, mode, pdfReady]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // 읽던 위치 저장 — 바깥 div 스크롤(md 등)과 iframe 내부 스크롤 보고(html)가 공유한다
  const saveOffset = useCallback(
    (offset: number) => {
      // 코드 보기는 검사용 임시 모드 — 렌더링 보기의 읽던 위치를 덮어쓰지 않는다 (IA — 코드로 보기)
      if (codeViewRef.current) return;
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void api(`/me/files/${file.id}/state`, {
          method: 'PUT',
          body: JSON.stringify({ readingPosition: { offset } }),
        }).catch(() => {});
      }, 2000);
    },
    [file.id],
  );

  /** 스크롤 위치 하나에서 세 가지를 뽑는다: 읽던 위치 저장 + 크롬 숨김 힌트 + 진행률 */
  const reportScroll = useCallback(
    (y: number, denom: number | null) => {
      if (onChromeHint) {
        const last = lastScrollYRef.current;
        if (y < CHROME_SHOW_NEAR_TOP) onChromeHint(false);
        else if (y - last > CHROME_SCROLL_DELTA) onChromeHint(true);
        else if (last - y > CHROME_SCROLL_DELTA) onChromeHint(false);
        lastScrollYRef.current = y;
      }
      if (denom !== null) {
        // 짧은 문서는 줄이 의미 없다 — 화면 반 이상 스크롤될 때만 표시
        const next = denom > 300 ? Math.min(100, Math.round((y / denom) * 100)) : null;
        setProgress((prev) => (prev === next ? prev : next));
      }
      saveOffset(y);
    },
    [onChromeHint, saveOffset],
  );

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    reportScroll(el.scrollTop, el.scrollHeight - el.clientHeight);
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

  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-slate-500">불러오는 중…</p>;

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

  return (
    <div className="flex h-full flex-col">
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
      // 터치에서는 스크롤 방향에 따라 헤더가 접힌다 (IA — 크롬 자동 숨김).
      // 접힘용 overflow-hidden·max-h는 터치에만 건다 — PC에 걸면 헤더 아래로 펼쳐지는
      // ⋯ 팝오버 메뉴가 이 상자에 잘려서 안 보인다
      <div
        className={
          isPc
            ? ''
            : `overflow-hidden transition-all duration-200 ${
                chromeHidden && mode === 'view' ? 'max-h-0 opacity-0' : 'max-h-14'
              }`
        }
      >
      <div
        // touch-none: 헤더에서 시작한 터치를 브라우저 제스처(스크롤·내비게이션)가 가로채지 않게 —
        // 가로채면 touchend 대신 touchcancel이 와서 스와이프가 끊긴다
        className="touch-none flex items-center gap-3 border-b border-slate-800 px-4 py-2 touch:pl-14"
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
            <nav className="w-56 shrink-0 overflow-auto overscroll-contain border-r border-slate-800 py-3 touch:fixed touch:inset-x-0 touch:bottom-0 touch:top-auto touch:z-30 touch:max-h-[70vh] touch:w-auto touch:rounded-t-2xl touch:border-r-0 touch:border-t touch:border-slate-700 touch:bg-slate-900 touch:pb-[calc(env(safe-area-inset-bottom)+12px)]">
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
          ref={scrollRef}
          onScroll={handleScroll}
          // 본문은 세로로만 스크롤: 가로 오버플로 차단 + 터치는 세로 팬만 + 스크롤 관성이 밖으로 새지 않게
          className={`min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden touch-pan-y overscroll-contain ${THEME_BG[settings.viewerTheme]}`}
        >
          {file.fileType === 'pdf' ? (
            // iframe(브라우저 내장 뷰어) 대신 직접 그린다 — iOS는 iframe 속 PDF의 1페이지만 그림처럼 보여줬다.
            // key=파일 id: 파일을 바꾸면 문서·페이지 상태를 통째로 새로 만든다
            <Suspense fallback={<p className="p-6 text-sm text-slate-500">PDF 뷰어 준비 중…</p>}>
              <PdfRenderer
                key={file.id}
                fileId={file.id}
                scale={effectiveScale}
                onReady={() => setPdfReady(true)}
              />
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
              initialOffset={file.state.readingPosition?.offset ?? 0}
              onScrollOffset={(o) => reportScroll(o, null)}
              onToc={setHeadings}
              onInteract={closeMenu}
              fit={fit}
              fontScale={effectiveScale}
            />
          ) : (
            <div
              className={`mx-auto p-6 ${WIDTH[settings.contentWidth]}`}
              // 설정의 글자 크기(px)를 100% 기준으로 두고 파일별 배율을 곱한다 —
              // 안쪽 요소들이 em/rem으로 짜여 있어 제목·본문의 위계가 그대로 따라 커진다
              style={{ fontSize: (settings.fontSize * effectiveScale) / 100 }}
            >
              {BodyRenderer ? (
                <Suspense fallback={<p className="text-sm text-slate-500">뷰어 준비 중…</p>}>
                  <BodyRenderer
                    content={data.content}
                    theme={settings.viewerTheme}
                    fileName={file.name}
                    onFileLink={onOpenLink}
                    highlightLines={jumpLines}
                  />
                </Suspense>
              ) : (
                <p className="text-sm text-slate-500">이 형식({data.fileType})의 뷰어는 아직 없습니다</p>
              )}
            </div>
          )}
        </div>
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
        <div
          className={`overflow-hidden transition-all duration-200 ${
            chromeHidden && mode === 'view' ? 'max-h-0 opacity-0' : 'max-h-16'
          }`}
        >
          <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
            {actions}
          </div>
        </div>
      )}
    </div>
  );
}
