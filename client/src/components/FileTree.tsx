import type { TreeFile, TreeFolder } from '../lib/api';

const TYPE_BADGE: Record<string, string> = {
  md: 'text-sky-400',
  html: 'text-orange-400',
  text: 'text-zinc-400',
  code: 'text-emerald-400',
  image: 'text-purple-400',
  pdf: 'text-red-400',
};

type Props = {
  folders: TreeFolder[];
  files: TreeFile[];
  selectedId: number | null;
  onSelect: (file: TreeFile) => void;
};

// SCR-110의 최소 버전 — 폴더 중첩 렌더링. 드래그앤드롭·컨텍스트 메뉴는 4단계
export default function FileTree({ folders, files, selectedId, onSelect }: Props) {
  const renderLevel = (parentId: number | null, depth: number) => {
    const childFolders = folders.filter((f) => f.parentId === parentId);
    const childFiles = files.filter((f) => f.folderId === parentId);

    return (
      <>
        {childFolders.map((folder) => (
          <div key={`d${folder.id}`}>
            <div
              className="flex items-center gap-1.5 px-2 py-1 text-sm text-zinc-400"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              <span>📁</span> {folder.name}
            </div>
            {renderLevel(folder.id, depth + 1)}
          </div>
        ))}
        {childFiles.map((file) => (
          <button
            key={file.id}
            onClick={() => onSelect(file)}
            className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition ${
              file.id === selectedId
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-300 hover:bg-zinc-900'
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <span className={`font-mono text-[10px] uppercase ${TYPE_BADGE[file.fileType] ?? ''}`}>
              {file.fileType}
            </span>
            <span className="truncate">{file.name}</span>
          </button>
        ))}
      </>
    );
  };

  if (folders.length === 0 && files.length === 0) {
    return <p className="px-2 py-4 text-sm text-zinc-600">파일이 없습니다. 업로드해 보세요.</p>;
  }
  return <div className="space-y-0.5">{renderLevel(null, 0)}</div>;
}
