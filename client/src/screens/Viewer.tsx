import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import VersionPanel from '../components/VersionPanel';
import ViewOptions from '../components/ViewOptions';
import { api, ApiError, type FileContent, type TreeFile, type UserSettings } from '../lib/api';
import { renderers } from '../renderers';
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
};

const THEME_BG: Record<UserSettings['viewerTheme'], string> = {
  light: 'bg-white',
  dark: 'bg-slate-950',
  sepia: 'bg-[#f4ecd8]',
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
export default function Viewer({ file, settings, immersive, onToggleImmersive, onContentSaved, onStateChanged, onToggleFavorite, onDirtyChange }: Props) {
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [showVersions, setShowVersions] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [fit, setFit] = useState(file.state.viewerFit !== 0);
  const [showViewOptions, setShowViewOptions] = useState(false);
  // null = 이 파일만의 배율 없음(설정의 전역 기본값을 따름)
  const [fontScale, setFontScale] = useState<number | null>(file.state.fontScale);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const scaleSaveRef = useRef<number | undefined>(undefined);

  // 이미지·PDF는 본문(JSON)이 없다 — /raw를 렌더러에 직접 물린다 (아키텍처 — 저장 전략)
  const isBinary = file.fileType === 'image' || file.fileType === 'pdf';

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
    setShowViewOptions(false);
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 본문이 준비되면 읽던 위치로 복원한다 — 기기 간 이어 읽기의 핵심
  // (html은 스크롤이 iframe 안에서 일어나므로 렌더러의 심이 직접 복원한다)
  useEffect(() => {
    if (!data || mode !== 'view' || data.fileType === 'html') return;
    const offset = file.state.readingPosition?.offset;
    if (offset && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = offset;
      });
    }
    // 복원은 본문 로드 완료 시 1회
  }, [data, mode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleScroll() {
    saveOffset(scrollRef.current?.scrollTop ?? 0);
  }

  // 격리된 문서 안의 클릭은 부모에 닿지 않는다 — 렌더러가 알려 주면 팝오버를 닫는다
  const closeViewOptions = useCallback(() => setShowViewOptions(false), []);

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
  const isFavorite = file.state.isFavorite === 1;
  // 파일별 값이 있으면 그것을, 없으면 설정의 전역 기본값을 쓴다 (대체이지 곱하기가 아니다)
  const effectiveScale = fontScale ?? settings.htmlFontScale;
  const headerButton = (active: boolean) =>
    // whitespace-nowrap이 없으면 폭이 좁을 때 "보 기"처럼 글자가 세로로 접힌다
    `whitespace-nowrap rounded border px-3 py-1 text-sm ${
      active
        ? 'border-slate-500 bg-slate-800 text-slate-100'
        : 'border-slate-700 text-slate-300 hover:bg-slate-900'
    }`;

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
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-2 touch:pl-14">
        <button
          onClick={() => onToggleFavorite(file)}
          title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
          className={`text-lg leading-none ${isFavorite ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
        >
          ★
        </button>
        <h2 className="truncate font-medium text-slate-100">{file.name}</h2>
        <span className="text-xs text-slate-500 touch:hidden">
          {new Date(data.updatedAt).toLocaleString()} 수정
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={onToggleImmersive} className={headerButton(false)} title="몰입 모드 — 본문만 전체 화면으로">
            ⛶
          </button>
          {(data.fileType === 'md' || data.fileType === 'html') && (
            <button onClick={() => setShowToc((v) => !v)} className={headerButton(showToc)}>
              목차
            </button>
          )}
          {data.fileType === 'html' && (
            <ViewOptions
              open={showViewOptions}
              fit={fit}
              scale={effectiveScale}
              isOverride={fontScale !== null}
              buttonClass={headerButton}
              onToggle={() => setShowViewOptions((v) => !v)}
              onClose={() => setShowViewOptions(false)}
              onFitChange={changeFit}
              onScaleChange={changeScale}
              onResetScale={resetScale}
            />
          )}
          {!isBinary && (
            <button onClick={() => setShowVersions((v) => !v)} className={headerButton(showVersions)}>
              버전
            </button>
          )}
          {/* 텍스트든 바이너리든 원본 그대로 받는다 (텍스트 본문은 서버가 DB에서 꺼내 준다) */}
          <a href={`/api/v1/files/${file.id}/raw`} download={file.name} className={headerButton(false)}>
            다운로드
          </a>
          {!data.readonly && (
            <button onClick={() => setMode('edit')} className={headerButton(false)}>
              편집 (E)
            </button>
          )}
        </div>
      </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* SCR-151: 목차 — 데스크톱은 인라인 사이드 패널, 터치 기기는 오버레이 드로어 */}
        {showToc && (
          <>
            <div className="fixed inset-0 z-20 bg-black/50 pc:hidden" onClick={() => setShowToc(false)} />
            <nav className="w-56 shrink-0 overflow-auto overscroll-contain border-r border-slate-800 py-3 touch:fixed touch:inset-y-0 touch:left-0 touch:z-30 touch:w-64 touch:bg-slate-950">
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
            <iframe src={`/api/v1/files/${file.id}/raw`} title={file.name} className="h-full w-full" />
          ) : file.fileType === 'image' ? (
            <div className="flex min-h-full items-center justify-center p-6">
              <img src={`/api/v1/files/${file.id}/raw`} alt={file.name} className="max-w-full" />
            </div>
          ) : file.fileType === 'html' && Renderer ? (
            // 앱형 HTML은 여백·폭 제한 없이 화면을 꽉 채워 렌더링한다
            // key=파일 id: 파일을 바꿔 열면 iframe을 새로 만들어 읽던 위치를 그 파일 기준으로 심는다
            <Renderer
              key={file.id}
              content={data.content}
              theme={settings.viewerTheme}
              initialOffset={file.state.readingPosition?.offset ?? 0}
              onScrollOffset={saveOffset}
              onToc={setHeadings}
              onInteract={closeViewOptions}
              fit={fit}
              fontScale={effectiveScale}
            />
          ) : (
            <div
              className={`mx-auto p-6 ${WIDTH[settings.contentWidth]}`}
              style={{ fontSize: settings.fontSize }}
            >
              {Renderer ? (
                <Suspense fallback={<p className="text-sm text-slate-500">뷰어 준비 중…</p>}>
                  <Renderer content={data.content} theme={settings.viewerTheme} />
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
    </div>
  );
}
