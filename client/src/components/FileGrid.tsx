import type { TreeFile, TreeFolder } from '../lib/api';

const TYPE_ICON: Record<string, string> = {
  md: '📝',
  html: '🌐',
  text: '📄',
  code: '💻',
  pdf: '📕',
  audio: '🎵',
  video: '🎬',
  binary: '📦',
};

// SCR-110 격자 보기 — 이미지 썸네일 중심의 대안 뷰. 정리 작업(다중 선택·이동)은 목록 보기가 담당
export default function FileGrid({
  files,
  folders,
  selectedId,
  onSelect,
}: {
  files: TreeFile[];
  folders: TreeFolder[];
  selectedId: number | null;
  onSelect: (file: TreeFile) => void;
}) {
  const folderName = new Map(folders.map((f) => [f.id, f.name]));

  if (files.length === 0) {
    return <p className="px-2 py-4 text-sm text-slate-600">파일이 없습니다. 업로드해 보세요.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-2 px-1 pb-4">
      {files.map((file) => (
        <button
          key={file.id}
          onClick={() => onSelect(file)}
          title={file.name}
          className={`rounded-lg border p-1.5 text-left transition ${
            file.id === selectedId
              ? 'border-sky-700 bg-slate-800'
              : 'border-slate-800 hover:border-slate-600 hover:bg-slate-900'
          }`}
        >
          <div className="flex h-20 items-center justify-center overflow-hidden rounded bg-slate-900">
            {file.fileType === 'image' ? (
              // 썸네일 = 원본 스트리밍(raw)을 그대로 축소 표시. 지연 로드로 스크롤 시에만 받는다
              <img
                src={`/api/v1/files/${file.id}/raw`}
                alt={file.name}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-3xl">{TYPE_ICON[file.fileType] ?? '📄'}</span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-slate-300">{file.name}</p>
          {file.folderId !== null && (
            <p className="truncate text-[10px] text-slate-600">📁 {folderName.get(file.folderId)}</p>
          )}
        </button>
      ))}
    </div>
  );
}
