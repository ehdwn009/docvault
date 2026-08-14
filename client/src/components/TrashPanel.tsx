import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { confirmDialog } from '../lib/dialog';
import { toast } from '../lib/toast';

type TrashedFile = {
  id: number;
  name: string;
  fileType: string;
  sizeBytes: number;
  deletedAt: number;
};

// 휴지통 모달 — 복원·영구 삭제·비우기. 30일 뒤 서버가 자동 영구 삭제한다 (IA — 휴지통)
export default function TrashPanel({
  onChanged,
  onClose,
}: {
  onChanged: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TrashedFile[] | null>(null);

  const load = useCallback(() => {
    void api<{ files: TrashedFile[] }>('/files/trash')
      .then((r) => setItems(r.files))
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const run = (fn: () => Promise<unknown>) => {
    void (async () => {
      try {
        await fn();
        load();
        onChanged();
      } catch (e) {
        toast(e instanceof ApiError ? e.message : '작업에 실패했습니다', 'error');
      }
    })();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[70vh] w-96 flex-col rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-slate-100">🗑 휴지통</h3>
          <span className="text-[11px] text-slate-600">30일 뒤 자동으로 비워집니다</span>
          {items && items.length > 0 && (
            <button
              onClick={() => {
                void confirmDialog('휴지통을 비울까요?', {
                  message: '모든 파일이 영구 삭제되며 되돌릴 수 없습니다.',
                  danger: true,
                }).then((ok) => ok && run(() => api('/files/trash', { method: 'DELETE' })));
              }}
              className="ml-auto rounded border border-red-900 px-2 py-0.5 text-xs text-red-400 hover:bg-red-950"
            >
              비우기
            </button>
          )}
        </div>

        <div className="mt-3 flex-1 overflow-y-auto">
          {items === null ? (
            <p className="px-1 py-4 text-sm text-slate-600">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="px-1 py-4 text-sm text-slate-600">휴지통이 비어 있습니다.</p>
          ) : (
            items.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{f.name}</span>
                  <span className="text-[10px] text-slate-600">
                    {new Date(f.deletedAt).toLocaleDateString('ko-KR')} 삭제됨
                  </span>
                </span>
                <button
                  onClick={() => run(() => api(`/files/${f.id}/restore`, { method: 'POST' }))}
                  className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  복원
                </button>
                <button
                  onClick={() => {
                    void confirmDialog(`"${f.name}"을(를) 영구 삭제할까요?`, {
                      message: '되돌릴 수 없습니다.',
                      danger: true,
                    }).then((ok) => ok && run(() => api(`/files/${f.id}/purge`, { method: 'DELETE' })));
                  }}
                  className="shrink-0 rounded border border-red-900 px-2 py-0.5 text-xs text-red-400 hover:bg-red-950"
                >
                  삭제
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
