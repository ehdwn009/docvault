import { useState, useEffect, useCallback } from 'react';
import { api, ApiError, type FileContent } from '../lib/api';
import MarkdownRenderer from '../renderers/MarkdownRenderer';

type Props = {
  file: FileContent;
  onSaved: (content: string, updatedAt: number) => void;
  onCancel: () => void;
};

// SCR-160: 편집기 — 분할 화면(에디터 + 실시간 미리보기, md만). Ctrl+S 저장
export default function Editor({ file, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // md 미만에서 분할 화면은 탭 전환으로 대체 (IA — 반응형 기준)
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit');

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ updatedAt: number }>(`/files/${file.id}/content`, {
        method: 'PUT',
        body: JSON.stringify({ content: draft, baseUpdatedAt: file.updatedAt }),
      });
      onSaved(draft, r.updatedAt);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EDIT_CONFLICT') {
        setError('다른 곳에서 먼저 수정되었습니다. 편집을 취소하고 최신 내용을 확인하세요.');
      } else {
        setError(e instanceof Error ? e.message : '저장에 실패했습니다');
      }
    } finally {
      setSaving(false);
    }
  }, [draft, file.id, file.updatedAt, onSaved]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 max-md:pl-14">
        <span className="text-sm text-zinc-400 max-md:hidden">편집 중</span>
        <div className="flex gap-1 md:hidden">
          {(['edit', 'preview'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setMobilePane(p)}
              className={`rounded px-2 py-0.5 text-xs ${
                mobilePane === p ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'
              }`}
            >
              {p === 'edit' ? '에디터' : '미리보기'}
            </button>
          ))}
        </div>
        {error && <span className="text-sm text-red-400">{error}</span>}
        <div className="ml-auto flex gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            취소
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
          >
            {saving ? '저장 중…' : '저장 (Ctrl+S)'}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className={`h-full w-full resize-none border-zinc-800 bg-zinc-950 p-4 font-mono text-sm leading-relaxed text-zinc-200 outline-none md:block md:w-1/2 md:border-r ${
            mobilePane === 'edit' ? 'block' : 'hidden'
          }`}
        />
        <div
          className={`h-full w-full overflow-auto p-4 md:block md:w-1/2 ${
            mobilePane === 'preview' ? 'block' : 'hidden'
          }`}
        >
          {file.fileType === 'md' ? (
            <MarkdownRenderer content={draft} />
          ) : (
            <p className="text-sm text-zinc-500">md 파일만 실시간 미리보기를 지원합니다</p>
          )}
        </div>
      </div>
    </div>
  );
}
