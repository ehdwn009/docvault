import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type FileContent, type TreeFile, type UserSettings } from '../lib/api';
import { renderers } from '../renderers';
import Editor from './Editor';

type Props = {
  file: TreeFile;
  settings: UserSettings;
  onContentSaved: () => void;
  onToggleFavorite: (file: TreeFile) => void;
};

const THEME_BG: Record<UserSettings['viewerTheme'], string> = {
  light: 'bg-white',
  dark: 'bg-zinc-950',
  sepia: 'bg-[#f4ecd8]',
};
const WIDTH: Record<UserSettings['contentWidth'], string> = {
  narrow: 'max-w-xl',
  normal: 'max-w-3xl',
  wide: 'max-w-none',
};

// SCR-150: 뷰어 — 렌더러 표시 + 즐겨찾기 + 읽던 위치 저장(2초 디바운스)·복원
export default function Viewer({ file, settings, onContentSaved, onToggleFavorite }: Props) {
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setData(null);
    setError(null);
    setMode('view');
    api<FileContent>(`/files/${file.id}/content`)
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : '본문을 불러오지 못했습니다'),
      );
    // 열람 기록 (최근 열람 목록·이어 읽기의 기준 시각)
    void api(`/me/files/${file.id}/state`, {
      method: 'PUT',
      body: JSON.stringify({ touch: true }),
    }).catch(() => {});
  }, [file.id]);

  // 본문이 준비되면 읽던 위치로 복원한다 — 기기 간 이어 읽기의 핵심
  useEffect(() => {
    if (!data || mode !== 'view') return;
    const offset = file.state.readingPosition?.offset;
    if (offset && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = offset;
      });
    }
    // eslint 없이도 의도를 명확히: 복원은 본문 로드 완료 시 1회
  }, [data, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleScroll() {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const offset = scrollRef.current?.scrollTop ?? 0;
      void api(`/me/files/${file.id}/state`, {
        method: 'PUT',
        body: JSON.stringify({ readingPosition: { offset } }),
      }).catch(() => {});
    }, 2000);
  }

  useEffect(() => () => window.clearTimeout(debounceRef.current), []);

  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-zinc-500">불러오는 중…</p>;

  if (mode === 'edit') {
    return (
      <Editor
        file={data}
        onCancel={() => setMode('view')}
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <button
          onClick={() => onToggleFavorite(file)}
          title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
          className={`text-lg leading-none ${isFavorite ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-400'}`}
        >
          ★
        </button>
        <h2 className="truncate font-medium text-zinc-100">{file.name}</h2>
        <span className="text-xs text-zinc-500">
          {new Date(data.updatedAt).toLocaleString()} 수정
        </span>
        {!data.readonly && (
          <button
            onClick={() => setMode('edit')}
            className="ml-auto rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            편집 (E)
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`min-h-0 flex-1 overflow-auto ${THEME_BG[settings.viewerTheme]}`}
      >
        <div
          className={`mx-auto p-6 ${WIDTH[settings.contentWidth]}`}
          style={{ fontSize: settings.fontSize }}
        >
          {Renderer ? (
            <Renderer content={data.content} theme={settings.viewerTheme} />
          ) : (
            <p className="text-sm text-zinc-500">이 형식({data.fileType})의 뷰어는 아직 없습니다</p>
          )}
        </div>
      </div>
    </div>
  );
}
