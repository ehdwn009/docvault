import { useEffect, useMemo, useRef, useState } from 'react';
import { api, toTreeFile, type TreeFile } from '../lib/api';

type SearchResult = {
  id: number;
  name: string;
  fileType: TreeFile['fileType'];
  folderId: number | null;
  isShared: number;
  snippet: string;
};

type Props = {
  files: TreeFile[];
  onPick: (file: TreeFile) => void;
  onClose: () => void;
};

// SCR-170: 커맨드 팔레트 (Ctrl+K) — 이름은 즉시, 본문은 서버 FTS로 검색
export default function CommandPalette({ files, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [serverResults, setServerResults] = useState<SearchResult[]>([]);
  const [cursor, setCursor] = useState(0);
  const debounceRef = useRef<number | undefined>(undefined);
  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);

  // 이름 매칭은 로컬에서 즉시
  const nameMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return files.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, files]);

  // 본문 매칭은 서버 FTS (200ms 디바운스)
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setServerResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void api<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}`)
        .then(({ results }) => setServerResults(results))
        .catch(() => setServerResults([]));
    }, 200);
    return () => window.clearTimeout(debounceRef.current);
  }, [query]);

  // 이름 매칭 우선, 본문 매칭은 뒤에 (중복 제거)
  const items = useMemo(() => {
    const seen = new Set(nameMatches.map((f) => f.id));
    const bodyMatches = serverResults
      .filter((r) => !seen.has(r.id))
      .map((r) => ({
        // 내 트리에 없는 파일(공유 문서)도 열 수 있게 부분 데이터로 채운다 — 서버 검색은 공유도 찾아 준다
        file:
          fileById.get(r.id) ??
          toTreeFile({
            id: r.id,
            name: r.name,
            fileType: r.fileType,
            folderId: r.folderId,
            isShared: r.isShared,
          }),
        snippet: r.snippet,
      }));
    return [
      ...nameMatches.map((f) => ({ file: f, snippet: null as string | null })),
      ...bodyMatches,
    ];
  }, [nameMatches, serverResults, fileById]);

  useEffect(() => setCursor(0), [query]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      const item = items[cursor];
      if (item) {
        onPick(item.file);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[15vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="파일 이름 또는 본문 검색…"
          className="w-full border-b border-slate-800 bg-transparent px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600"
        />
        <div className="max-h-80 overflow-auto py-1">
          {query.trim() && items.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-500">결과가 없습니다</p>
          )}
          {items.map((item, i) => (
            <button
              key={item.file.id}
              onClick={() => {
                onPick(item.file);
                onClose();
              }}
              onMouseEnter={() => setCursor(i)}
              className={`block w-full px-4 py-2 text-left ${
                i === cursor ? 'bg-slate-800' : ''
              }`}
            >
              <span className="text-sm text-slate-100">{item.file.name}</span>
              {item.snippet && (
                <span className="mt-0.5 block truncate text-xs text-slate-500">{item.snippet}</span>
              )}
            </button>
          ))}
        </div>
        <div className="border-t border-slate-800 px-4 py-1.5 text-[10px] text-slate-600">
          ↑↓ 이동 · Enter 열기 · Esc 닫기
        </div>
      </div>
    </div>
  );
}
