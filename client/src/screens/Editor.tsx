import { Suspense, useState, useEffect, useCallback } from 'react';
import { api, ApiError, type FileContent } from '../lib/api';
import { confirmDialog } from '../lib/dialog';
import { toast } from '../lib/toast';
import { MarkdownRenderer } from '../renderers';

type Props = {
  file: FileContent;
  onSaved: (content: string, updatedAt: number) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

// SCR-160: 편집기 — 분할 화면(에디터 + 실시간 미리보기, md만). Ctrl+S 저장
export default function Editor({ file, onSaved, onCancel, onDirtyChange }: Props) {
  const [draft, setDraft] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // md 미만에서 분할 화면은 탭 전환으로 대체 (IA — 반응형 기준)
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit');

  const dirty = draft !== file.content;

  // 부모(Workspace)가 파일 전환을 막을 수 있도록 dirty 상태를 올려보낸다
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  // 새로고침·창 닫기로 작성 내용이 날아가는 것을 경고
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ updatedAt: number }>(`/files/${file.id}/content`, {
        method: 'PUT',
        body: JSON.stringify({ content: draft, baseUpdatedAt: file.updatedAt }),
      });
      toast('저장되었습니다', 'success');
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

  async function cancel() {
    if (
      dirty &&
      !(await confirmDialog('저장하지 않은 변경이 있습니다', {
        message: '편집을 취소하면 작성한 내용이 사라집니다.',
        danger: true,
      }))
    ) {
      return;
    }
    onCancel();
  }

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
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2 touch:pl-14">
        <span className="text-sm text-slate-400 touch:hidden">
          편집 중{dirty && <span className="ml-1 text-amber-400">●</span>}
        </span>
        <div className="flex gap-1 pc:hidden">
          {(['edit', 'preview'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setMobilePane(p)}
              className={`rounded px-2 py-0.5 text-xs ${
                mobilePane === p ? 'bg-slate-800 text-slate-100' : 'text-slate-500'
              }`}
            >
              {p === 'edit' ? '에디터' : '미리보기'}
            </button>
          ))}
        </div>
        {error && <span className="text-sm text-red-400">{error}</span>}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => void cancel()}
            className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-900"
          >
            취소
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded bg-slate-100 px-3 py-1 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-40"
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
          className={`h-full w-full resize-none border-slate-800 bg-slate-950 p-4 font-mono text-sm leading-relaxed text-slate-200 outline-none pc:block pc:w-1/2 pc:border-r ${
            mobilePane === 'edit' ? 'block' : 'hidden'
          }`}
        />
        <div
          className={`h-full w-full overflow-auto p-4 pc:block pc:w-1/2 ${
            mobilePane === 'preview' ? 'block' : 'hidden'
          }`}
        >
          {file.fileType === 'md' ? (
            <Suspense fallback={<p className="text-sm text-slate-500">미리보기 준비 중…</p>}>
              <MarkdownRenderer content={draft} />
            </Suspense>
          ) : (
            <p className="text-sm text-slate-500">md 파일만 실시간 미리보기를 지원합니다</p>
          )}
        </div>
      </div>
    </div>
  );
}
