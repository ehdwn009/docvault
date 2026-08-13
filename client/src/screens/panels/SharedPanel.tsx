import { useEffect, useState } from 'react';
import { api, type SharedFile, type SharedFolder } from '../../lib/api';

type Props = { selectedId: number | null; onSelect: (file: SharedFile) => void };

// SCR-130: 공유 파일 패널 — 열람 전용 트리
export default function SharedPanel({ selectedId, onSelect }: Props) {
  const [folders, setFolders] = useState<SharedFolder[]>([]);
  const [files, setFiles] = useState<SharedFile[]>([]);

  useEffect(() => {
    void api<{ folders: SharedFolder[]; files: SharedFile[] }>('/shared/tree')
      .then((t) => {
        setFolders(t.folders);
        setFiles(t.files);
      })
      .catch(() => {});
  }, []);

  const renderLevel = (parentId: number | null, depth: number) => (
    <>
      {folders
        .filter((f) => f.parentId === parentId)
        .map((folder) => (
          <div key={`d${folder.id}`}>
            <div
              className="flex items-center gap-1.5 px-2 py-1 text-sm text-zinc-400"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              <span>📁</span> {folder.name}
              <span className="ml-auto text-[10px] text-zinc-600">{folder.ownerName}</span>
            </div>
            {renderLevel(folder.id, depth + 1)}
          </div>
        ))}
      {files
        .filter((f) => f.folderId === parentId)
        .map((file) => (
          <button
            key={file.id}
            onClick={() => onSelect(file)}
            className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition ${
              file.id === selectedId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <span className="truncate">{file.name}</span>
            <span className="ml-auto text-[10px] text-zinc-600">{file.ownerName}</span>
          </button>
        ))}
    </>
  );

  if (folders.length === 0 && files.length === 0) {
    return <p className="px-4 py-4 text-sm text-zinc-600">공유된 파일이 없습니다.</p>;
  }
  return <div className="space-y-0.5 px-2">{renderLevel(null, 0)}</div>;
}
