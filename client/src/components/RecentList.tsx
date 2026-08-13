import type { TreeFile } from '../lib/api';

type Props = { files: TreeFile[]; onSelect: (file: TreeFile) => void };

// SCR-112: 최근 열람 섹션 — 파일 패널 상단에 최근 5개
export default function RecentList({ files, onSelect }: Props) {
  const recent = files
    .filter((f) => f.state.lastOpenedAt !== null)
    .sort((a, b) => (b.state.lastOpenedAt ?? 0) - (a.state.lastOpenedAt ?? 0))
    .slice(0, 5);

  if (recent.length === 0) return null;
  return (
    <div className="mb-3">
      <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
        최근 열람
      </h3>
      {recent.map((file) => (
        <button
          key={file.id}
          onClick={() => onSelect(file)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[13px] text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
        >
          <span className="truncate">{file.name}</span>
        </button>
      ))}
      <div className="mx-2 mt-2 border-b border-zinc-800/70" />
    </div>
  );
}
