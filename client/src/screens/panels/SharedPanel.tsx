import { useEffect, useState } from 'react';
import { api, type SharedFile, type SharedFolder } from '../../lib/api';

type Props = { selectedId: number | null; onSelect: (file: SharedFile) => void };

// SCR-130: 공유 파일 패널 — 열람 전용 트리
export default function SharedPanel({ selectedId, onSelect }: Props) {
  const [folders, setFolders] = useState<SharedFolder[]>([]);
  const [files, setFiles] = useState<SharedFile[]>([]);
  // "접힌 목록"이 아니라 "펼친 목록"으로 들고 있는다 — 빈 집합이 곧 전부 접힘(기본값)이다
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    void api<{ folders: SharedFolder[]; files: SharedFile[] }>('/shared/tree')
      .then((t) => {
        setFolders(t.folders);
        setFiles(t.files);
      })
      .catch(() => {});
  }, []);

  // 트리는 기본이 접힘이라, 밖에서 고른 파일(검색·커맨드 팔레트)은
  // 조상 폴더를 열어 주지 않으면 트리에서 보이지 않는다
  useEffect(() => {
    if (selectedId == null) return;
    const file = files.find((f) => f.id === selectedId);
    if (!file) return;
    const byId = new Map(folders.map((f) => [f.id, f]));
    const chain: number[] = [];
    let parent = file.folderId;
    // 자기참조가 꼬여도 멈추도록 방문한 폴더는 다시 따라가지 않는다
    while (parent != null && !chain.includes(parent)) {
      chain.push(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    if (chain.length === 0) return;
    setExpanded((prev) => {
      if (chain.every((id) => prev.has(id))) return prev; // 이미 열려 있으면 그대로 (불필요한 리렌더 방지)
      const next = new Set(prev);
      for (const id of chain) next.add(id);
      return next;
    });
  }, [selectedId, files, folders]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const renderLevel = (parentId: number | null, depth: number) => (
    <>
      {folders
        .filter((f) => f.parentId === parentId)
        .map((folder) => (
          <div key={`d${folder.id}`}>
            <button
              onClick={() => toggleExpand(folder.id)}
              className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-slate-400 transition hover:bg-slate-900"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              <span className="text-[10px]">{expanded.has(folder.id) ? '▾' : '▸'}</span>
              <span>📁</span>
              <span className="truncate">{folder.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-slate-600">{folder.ownerName}</span>
            </button>
            {expanded.has(folder.id) && renderLevel(folder.id, depth + 1)}
          </div>
        ))}
      {files
        .filter((f) => f.folderId === parentId)
        .map((file) => (
          <button
            key={file.id}
            onClick={() => onSelect(file)}
            className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition ${
              file.id === selectedId ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-900'
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <span className="truncate">{file.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-slate-600">{file.ownerName}</span>
          </button>
        ))}
    </>
  );

  if (folders.length === 0 && files.length === 0) {
    return <p className="px-4 py-4 text-sm text-slate-600">공유된 파일이 없습니다.</p>;
  }
  return <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">{renderLevel(null, 0)}</div>;
}
