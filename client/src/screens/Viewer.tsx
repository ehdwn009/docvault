import { useEffect, useState } from 'react';
import { api, ApiError, type FileContent, type TreeFile } from '../lib/api';
import { renderers } from '../renderers';
import Editor from './Editor';

type Props = {
  file: TreeFile;
  onContentSaved: () => void;
};

// SCR-150: 뷰어 — fileType에 맞는 렌더러로 표시. TOC·버전 패널은 이후 단계
export default function Viewer({ file, onContentSaved }: Props) {
  const [data, setData] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  useEffect(() => {
    setData(null);
    setError(null);
    setMode('view');
    api<FileContent>(`/files/${file.id}/content`)
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : '본문을 불러오지 못했습니다'),
      );
  }, [file.id]);

  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-zinc-500">불러오는 중…</p>;

  if (mode === 'edit') {
    return (
      <Editor
        file={data}
        onCancel={() => setMode('view')}
        onSaved={(content, updatedAt) => {
          setData({ ...data, content, updatedAt });
          setMode('view');
          onContentSaved();
        }}
      />
    );
  }

  const Renderer = renderers[data.fileType];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        <h2 className="truncate font-medium text-zinc-100">{file.name}</h2>
        <span className="text-xs text-zinc-500">
          {new Date(data.updatedAt).toLocaleString()} 수정
        </span>
        {!data.readonly && (
          <button
            onClick={() => setMode('edit')}
            className="ml-auto rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            편집 (E)
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {Renderer ? (
          <Renderer content={data.content} />
        ) : (
          <p className="text-sm text-zinc-500">이 형식({data.fileType})의 뷰어는 아직 없습니다</p>
        )}
      </div>
    </div>
  );
}
