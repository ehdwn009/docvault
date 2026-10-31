import type { TreeFile } from '../lib/api';
import FileName from './FileName';
import SwipeRow, { type SwipeConfig } from './SwipeRow';
import ListRow from './ui/ListRow';

type Props = {
  files: TreeFile[];
  onSelect: (file: TreeFile) => void;
  /** 행을 옆으로 밀었을 때 나올 버튼들 — 트리와 같은 구성을 받는다 */
  swipe: (file: TreeFile) => SwipeConfig;
};

// SCR-112: 최근 열람 섹션 — 파일 패널 상단에 최근 5개
export default function RecentList({ files, onSelect, swipe }: Props) {
  const recent = files
    .filter((f) => f.state.lastOpenedAt !== null)
    .sort((a, b) => (b.state.lastOpenedAt ?? 0) - (a.state.lastOpenedAt ?? 0))
    .slice(0, 5);

  if (recent.length === 0) return null;
  return (
    <div className="mb-3">
      <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
        최근 열람
      </h3>
      {recent.map((file) => (
        <SwipeRow key={file.id} {...swipe(file)}>
          <ListRow onClick={() => onSelect(file)} muted dense>
            <FileName name={file.name} wrap />
          </ListRow>
        </SwipeRow>
      ))}
      <div className="mx-2 mt-2 border-b border-slate-800/70" />
    </div>
  );
}
