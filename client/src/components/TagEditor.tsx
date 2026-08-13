import { useState } from 'react';
import { api, ApiError, type Tag, type TreeFile } from '../lib/api';

const PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#8b5cf6', '#ec4899'];

type Props = {
  file: TreeFile;
  tags: Tag[];
  onChanged: () => void; // 태그 목록·파일 태그가 바뀌면 부모가 재조회
  onClose: () => void;
};

// 파일 태그 편집 모달 — 체크로 부착/해제, 새 태그 생성, 태그 삭제
export default function TagEditor({ file, tags, onChanged, onClose }: Props) {
  const [attached, setAttached] = useState<Set<number>>(new Set(file.tags));
  const [newName, setNewName] = useState('');
  const [color, setColor] = useState(PALETTE[4]!);
  const [error, setError] = useState<string | null>(null);

  async function save(next: Set<number>) {
    setAttached(new Set(next));
    try {
      await api(`/files/${file.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tagIds: [...next] }),
      });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장에 실패했습니다');
    }
  }

  function toggle(tagId: number) {
    const next = new Set(attached);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    void save(next);
  }

  async function createTag() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const { tag } = await api<{ tag: Tag }>('/tags', {
        method: 'POST',
        body: JSON.stringify({ name, color }),
      });
      setNewName('');
      await save(new Set([...attached, tag.id]));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '태그 생성에 실패했습니다');
    }
  }

  async function deleteTag(tagId: number) {
    if (!window.confirm('태그를 삭제할까요? 모든 파일에서 제거됩니다.')) return;
    try {
      await api(`/tags/${tagId}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '태그 삭제에 실패했습니다');
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <h3 className="truncate text-sm font-medium text-zinc-200">태그: {file.name}</h3>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <div className="mt-3 max-h-52 space-y-1 overflow-auto">
          {tags.length === 0 && <p className="text-xs text-zinc-600">태그가 없습니다. 아래에서 만들어 보세요.</p>}
          {tags.map((tag) => (
            <div key={tag.id} className="group flex items-center gap-2">
              <label className="flex flex-1 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-zinc-200 hover:bg-zinc-800">
                <input
                  type="checkbox"
                  checked={attached.has(tag.id)}
                  onChange={() => toggle(tag.id)}
                  className="accent-zinc-300"
                />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
                {tag.name}
              </label>
              <button
                onClick={() => void deleteTag(tag.id)}
                title="태그 삭제"
                className="hidden text-xs text-zinc-600 hover:text-red-400 group-hover:block"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 border-t border-zinc-800 pt-3">
          <div className="flex gap-1.5">
            {PALETTE.map((p) => (
              <button
                key={p}
                onClick={() => setColor(p)}
                className={`h-5 w-5 rounded-full ${color === p ? 'ring-2 ring-zinc-300 ring-offset-1 ring-offset-zinc-900' : ''}`}
                style={{ background: p }}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createTag()}
              placeholder="새 태그 이름"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-400"
            />
            <button
              onClick={() => void createTag()}
              disabled={!newName.trim()}
              className="rounded-md bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
            >
              추가
            </button>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-md border border-zinc-700 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
