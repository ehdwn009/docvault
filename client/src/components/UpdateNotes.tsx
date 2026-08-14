import { Suspense } from 'react';
import { MarkdownRenderer } from '../renderers';

type Props = { content: string; onClose: () => void };

// 패치노트 모달 — 새 버전 첫 로그인 시 자동 표시 + 설정 → 정보에서 수동 열람 (SCR-144)
export default function UpdateNotes({ content, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-3">
          <h3 className="font-medium text-slate-100">✨ 업데이트 내역</h3>
          <span className="text-xs text-slate-500">v{__APP_VERSION__}</span>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <Suspense fallback={<p className="text-sm text-slate-500">불러오는 중…</p>}>
            <MarkdownRenderer content={content} />
          </Suspense>
        </div>
        <div className="border-t border-slate-800 px-5 py-3">
          <button
            onClick={onClose}
            className="w-full rounded-md bg-slate-100 py-2 text-sm font-medium text-slate-900 hover:bg-white"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
