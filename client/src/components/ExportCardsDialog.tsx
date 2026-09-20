import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, toTreeFile, type CardSummary, type TreeFile } from '../lib/api';
import { NO_TOPIC_MARK } from '../lib/constants';
import { startDownload } from '../lib/download';
import { toast } from '../lib/toast';

type Props = {
  cards: CardSummary[];
  isPc: boolean;
  onClose: () => void;
  /** 용어집을 내 파일에 넣으면 그 파일을 연다 */
  onOpenFile: (file: TreeFile) => void;
};

type Format = 'md' | 'csv';

// SCR-185: 카드 내보내기 — 용어집 md(내 파일에 넣기 / 다운로드) 또는 Anki CSV(다운로드).
// 미리보기가 먼저다: 무엇이 나오는지 보고 누른다 (API-118)
export default function ExportCardsDialog({ cards, isPc, onClose, onOpenFile }: Props) {
  const [format, setFormat] = useState<Format>('md');
  const [topics, setTopics] = useState<Set<string>>(new Set()); // 비어 있으면 전체
  const [toFile, setToFile] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 주제별 장수 — 범위 칩. 주제 없는 카드는 '-'로 센다 (서버와 같은 표식)
  const topicCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) m.set(c.topic || NO_TOPIC_MARK, (m.get(c.topic || NO_TOPIC_MARK) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] === NO_TOPIC_MARK ? 1 : b[0] === NO_TOPIC_MARK ? -1 : a[0].localeCompare(b[0], 'ko')));
  }, [cards]);
  const scoped = topics.size === 0 ? cards.length : cards.filter((c) => topics.has(c.topic || NO_TOPIC_MARK)).length;
  const query = `format=${format}${topics.size ? `&topics=${encodeURIComponent([...topics].join(','))}` : ''}`;

  useEffect(() => {
    let alive = true;
    setPreview(null);
    // api()는 JSON을 기대한다 — 내보내기는 텍스트라 직접 받는다
    void fetch(`/api/v1/cards/export?${query}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('미리보기를 받지 못했습니다'))))
      .then((t) => alive && setPreview(t))
      .catch(() => alive && setPreview(''));
    return () => {
      alive = false;
    };
  }, [query]);

  async function run() {
    if (format === 'csv' || !toFile) {
      startDownload(`/api/v1/cards/export?${query}`);
      onClose();
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ file: { id: number; name: string; fileType: 'md'; updatedAt: number }; updated: boolean; count: number }>('/cards/export', {
        method: 'POST',
        body: JSON.stringify({ topics: [...topics] }),
      });
      toast(r.updated ? `용어집.md를 새로 썼습니다 (${r.count}장)` : `용어집.md를 만들었습니다 (${r.count}장)`, 'success');
      onOpenFile(toTreeFile({ id: r.file.id, name: r.file.name, fileType: 'md', updatedAt: r.file.updatedAt }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '내보내지 못했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  const seg = (on: boolean) => `rounded-md py-1.5 text-xs transition ${on ? 'bg-slate-800 font-medium text-slate-100' : 'text-slate-400 hover:text-slate-200'}`;
  const label = 'text-[11px] font-semibold text-slate-500';
  const cta = format === 'csv' ? `Anki CSV ${scoped}장 다운로드` : toFile ? `용어집 ${scoped}장 → 내 파일에 넣기` : `용어집 ${scoped}장 다운로드`;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={busy ? undefined : onClose} />
      <div
        className={`fixed z-50 flex flex-col overflow-hidden bg-slate-950 text-slate-100 ${
          isPc ? 'left-1/2 top-1/2 h-[min(680px,92vh)] w-[min(640px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-700 shadow-2xl' : 'inset-0'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <span className="text-teal-300">📚</span>
          <h3 className="text-sm font-semibold">내보내기</h3>
          <span className="truncate text-xs text-slate-500">배움 카드 {cards.length}장 · 주제 {topicCounts.filter(([t]) => t !== NO_TOPIC_MARK).length}개</span>
          <button onClick={onClose} disabled={busy} className="ml-auto px-1 text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 text-sm">
          <div>
            <div className={label}>형식</div>
            <div className="mt-1 grid grid-cols-2 rounded-lg bg-slate-900 p-0.5">
              <button onClick={() => setFormat('md')} className={seg(format === 'md')}>용어집 (md)</button>
              <button onClick={() => setFormat('csv')} className={seg(format === 'csv')}>Anki (CSV)</button>
            </div>
          </div>
          <div>
            <div className={label}>범위</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button
                onClick={() => setTopics(new Set())}
                className={`rounded-md border px-2 py-0.5 text-xs ${topics.size === 0 ? 'border-teal-600 bg-teal-950/50 text-teal-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
              >
                전체 {cards.length}장
              </button>
              {topicCounts.map(([t, n]) => (
                <button
                  key={t}
                  onClick={() =>
                    setTopics((prev) => {
                      const next = new Set(prev);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      return next;
                    })
                  }
                  className={`rounded-md border px-2 py-0.5 text-xs ${topics.has(t) ? 'border-teal-600 bg-teal-950/50 text-teal-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
                >
                  {t === NO_TOPIC_MARK ? '주제 없음' : t} {n}
                </button>
              ))}
            </div>
          </div>
          {format === 'md' && (
            <div>
              <div className={label}>어디로</div>
              <div className="mt-1 grid grid-cols-2 rounded-lg bg-slate-900 p-0.5">
                <button onClick={() => setToFile(true)} className={seg(toFile)}>내 파일에 넣기</button>
                <button onClick={() => setToFile(false)} className={seg(!toFile)}>다운로드</button>
              </div>
              {toFile && <p className="mt-1 text-[11px] text-slate-500">최상위의 "용어집.md" 하나를 만들고, 다시 내보내면 그 파일을 새로 씁니다 (이전 판은 버전 기록에)</p>}
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={label}>미리보기</div>
            <pre className="mt-1 min-h-[160px] flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900 p-3 font-mono text-[12px] leading-relaxed text-slate-300">
              {preview === null ? '만드는 중…' : preview || '(비어 있음)'}
            </pre>
            {format === 'csv' && <p className="mt-1 text-[11px] text-slate-500">Anki에서 파일 → 가져오기. 구분자(;)와 HTML 허용은 파일 머리에 적혀 있어 자동으로 잡힙니다</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pc:pb-3">
          <button onClick={onClose} disabled={busy} className="ml-auto rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40">취소</button>
          <button onClick={() => void run()} disabled={busy || scoped === 0} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-40">
            {busy ? '만드는 중…' : cta}
          </button>
        </div>
      </div>
    </>
  );
}
