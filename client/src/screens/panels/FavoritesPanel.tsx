import type { TreeFile } from '../../lib/api';

type Props = { files: TreeFile[]; selectedId: number | null; onSelect: (file: TreeFile) => void };

// SCR-120: 즐겨찾기 패널
export default function FavoritesPanel({ files, selectedId, onSelect }: Props) {
  const favorites = files.filter((f) => f.state.isFavorite === 1);

  if (favorites.length === 0) {
    return (
      <p className="px-4 py-4 text-sm text-zinc-600">
        즐겨찾기가 없습니다. 뷰어 상단의 ★를 눌러 추가하세요.
      </p>
    );
  }
  return (
    <div className="space-y-0.5 px-2">
      {favorites.map((file) => (
        <button
          key={file.id}
          onClick={() => onSelect(file)}
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition ${
            file.id === selectedId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'
          }`}
        >
          <span className="text-amber-400">★</span>
          <span className="truncate">{file.name}</span>
        </button>
      ))}
    </div>
  );
}
