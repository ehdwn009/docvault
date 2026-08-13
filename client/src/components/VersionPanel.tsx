import { useEffect, useState } from 'react';
import { api, ApiError, type ViewerTheme } from '../lib/api';
import { renderers } from '../renderers';

type VersionMeta = { id: number; savedBy: number; sizeBytes: number; createdAt: number };
type VersionContent = { id: number; content: string; sizeBytes: number; createdAt: number };

type Props = {
  fileId: number;
  fileType: string;
  theme: ViewerTheme;
  readonly: boolean;
  onRestored: () => void;
  onClose: () => void;
};

// SCR-152: 버전 기록 패널 — 목록 → 미리보기 → 복원
export default function VersionPanel({ fileId, fileType, theme, readonly, onRestored, onClose }: Props) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [preview, setPreview] = useState<VersionContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    void api<{ versions: VersionMeta[] }>(`/files/${fileId}/versions`)
      .then(({ versions }) => setVersions(versions))
      .catch(() => setVersions([]));
  }, [fileId]);

  async function openPreview(vid: number) {
    setError(null);
    try {
      setPreview(await api<VersionContent>(`/files/${fileId}/versions/${vid}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '버전을 불러오지 못했습니다');
    }
  }

  async function restore(vid: number) {
    if (!window.confirm('이 버전으로 복원할까요? 현재 본문은 새 버전으로 저장됩니다.')) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/files/${fileId}/versions/${vid}/restore`, { method: 'POST' });
      onRestored();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '복원에 실패했습니다');
    } finally {
      setBusy(false);
    }
  }

  const Renderer = renderers[fileType];

  return (
    <div className="flex w-96 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-full">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <h3 className="text-sm font-medium text-zinc-200">버전 기록</h3>
        <span className="text-xs text-zinc-600">{versions.length}개</span>
        <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-300">
          ✕
        </button>
      </div>

      {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}

      {preview ? (
        <>
          <div className="flex items-center gap-2 border-b border-zinc-800/70 px-3 py-2">
            <button onClick={() => setPreview(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
              ← 목록
            </button>
            <span className="text-xs text-zinc-400">
              {new Date(preview.createdAt).toLocaleString()}
            </span>
            {!readonly && (
              <button
                onClick={() => void restore(preview.id)}
                disabled={busy}
                className="ml-auto rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
              >
                이 버전으로 복원
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 text-sm">
            {Renderer ? <Renderer content={preview.content} theme={theme} /> : <pre>{preview.content}</pre>}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {versions.length === 0 && (
            <p className="px-3 py-3 text-sm text-zinc-600">저장된 버전이 없습니다. 편집·저장하면 이전 본문이 버전으로 남습니다.</p>
          )}
          {versions.map((v, i) => (
            <button
              key={v.id}
              onClick={() => void openPreview(v.id)}
              className="flex w-full items-baseline gap-2 px-3 py-2 text-left transition hover:bg-zinc-900"
            >
              <span className="text-sm text-zinc-200">
                {i === 0 ? '최신 스냅샷' : `버전 ${versions.length - i}`}
              </span>
              <span className="ml-auto text-xs text-zinc-500">
                {new Date(v.createdAt).toLocaleString()}
              </span>
              <span className="text-[10px] text-zinc-600">{(v.sizeBytes / 1024).toFixed(1)}KB</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
