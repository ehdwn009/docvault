import { Suspense, useEffect, useRef, useState } from 'react';
import { api, ApiError, cardToTreeFile, type ReviewCard, type TreeFile } from '../lib/api';
import { getAppProseTheme } from '../lib/appTheme';
import { REVIEW_AGAIN_DAYS, REVIEW_FIRST_OK_DAYS, REVIEW_MAX_INTERVAL_DAYS } from '../lib/constants';
import { toast } from '../lib/toast';
import { renderers } from '../renderers';

type Props = {
  due: ReviewCard[];
  tomorrow: number;
  isPc: boolean;
  onClose: () => void;
  /** 채점을 하나라도 했으면 닫을 때 알린다 — 서랍의 "오늘 복습" 띠를 다시 센다 */
  onGraded: () => void;
  onOpenCard: (file: TreeFile) => void;
};

const MdRenderer = renderers.md;

/** 서버와 같은 규칙 — 버튼에 "N일 뒤"를 미리 적기 위해 */
function nextDays(prev: number, result: 'ok' | 'again'): number {
  if (result === 'again') return REVIEW_AGAIN_DAYS;
  return Math.min(REVIEW_MAX_INTERVAL_DAYS, Math.max(REVIEW_FIRST_OK_DAYS, prev * 2));
}

// SCR-186: 복습 — 제목만 보고 한 줄 정의를 떠올린 뒤 뒤집어 확인, [몰랐다]/[알았다]로 다음 간격을 정한다.
// 점수·연속 일수는 없다 — 끝나면 "오늘 N장 끝 · 내일 M장"만 (설계 — 활용 ③)
export default function ReviewDialog({ due: dueProp, tomorrow, isPc, onClose, onGraded, onOpenCard }: Props) {
  // 열릴 때의 목록을 그대로 쓴다 — 채점하면 부모의 목록이 줄어드는데, 그걸 따라가면 남은 카드가 사라진다
  const [due] = useState(dueProp);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [againCount, setAgainCount] = useState(0);
  const card = due[idx];
  const doneAll = idx >= due.length;
  // 닫힐 때 한 번만 알린다 — 채점마다 알리면 부모가 목록을 다시 받아 이 창이 흔들린다
  const gradedRef = useRef(0);
  const onGradedRef = useRef(onGraded);
  onGradedRef.current = onGraded;
  useEffect(() => () => { if (gradedRef.current > 0) onGradedRef.current(); }, []);

  async function grade(result: 'ok' | 'again') {
    if (!card || busy) return;
    setBusy(true);
    try {
      await api(`/cards/${card.id}/review`, { method: 'POST', body: JSON.stringify({ result }) });
      gradedRef.current += 1;
      if (result === 'again') setAgainCount((n) => n + 1);
      setIdx((i) => i + 1);
      setFlipped(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '채점을 저장하지 못했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  const proseTheme = getAppProseTheme();
  const btn = 'rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={busy ? undefined : onClose} />
      <div
        className={`fixed z-50 flex flex-col overflow-hidden bg-slate-950 text-slate-100 ${
          isPc ? 'left-1/2 top-1/2 h-[min(640px,92vh)] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-700 shadow-2xl' : 'inset-0'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <span className="text-teal-300">📚</span>
          <h3 className="text-sm font-semibold">복습</h3>
          <span className="text-xs text-slate-500">{doneAll ? `${due.length} / ${due.length}` : `${idx + 1} / ${due.length}`}</span>
          <div className="mx-3 h-1 flex-1 overflow-hidden rounded bg-slate-800">
            <div className="h-full bg-teal-600 transition-all" style={{ width: `${(Math.min(idx, due.length) / Math.max(1, due.length)) * 100}%` }} />
          </div>
          <button onClick={onClose} disabled={busy} className="px-1 text-slate-500 hover:text-slate-300">✕</button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {doneAll ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <div className="text-2xl font-bold">오늘 {due.length}장 끝</div>
              <div className="text-sm text-slate-400">
                {againCount > 0 ? `${againCount}장은 내일 다시 · ` : ''}
                {tomorrow + againCount > 0 ? `내일 ${tomorrow + againCount}장` : '내일은 쉬는 날'}
              </div>
            </div>
          ) : card ? (
            <>
              <button
                onClick={() => setFlipped(true)}
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 text-center"
              >
                <span className="text-[11px] font-semibold tracking-wide text-slate-500">{flipped ? '정답' : '이게 뭐였지?'}</span>
                <span className="text-2xl font-bold">{card.title}</span>
                {!flipped ? (
                  <span className="text-xs text-slate-500">
                    {card.aliases.length ? `힌트: ${card.aliases.join(' · ')} — ` : ''}눌러서 뒤집기
                  </span>
                ) : (
                  <>
                    <span className="text-base text-slate-200">{card.oneLine}</span>
                    {card.body.trim() && (
                      <div className="mt-2 w-full border-t border-dashed border-slate-700 pt-3 text-left text-[13px] text-slate-300">
                        {MdRenderer ? (
                          <Suspense fallback={<pre className="whitespace-pre-wrap text-xs">{card.body}</pre>}>
                            <div className="ask-md"><MdRenderer content={card.body} theme={proseTheme} /></div>
                          </Suspense>
                        ) : (
                          <pre className="whitespace-pre-wrap text-xs">{card.body}</pre>
                        )}
                      </div>
                    )}
                  </>
                )}
              </button>
              {flipped ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => void grade('again')} disabled={busy} className="rounded-lg border border-amber-700 px-3 py-2.5 text-sm font-medium text-amber-300 hover:bg-amber-950/40 disabled:opacity-40">
                    몰랐다<span className="block text-[11px] font-normal text-slate-500">내일 다시</span>
                  </button>
                  <button onClick={() => void grade('ok')} disabled={busy} className="rounded-lg border border-emerald-700 px-3 py-2.5 text-sm font-medium text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-40">
                    알았다<span className="block text-[11px] font-normal text-slate-500">{nextDays(card.intervalDays, 'ok')}일 뒤</span>
                  </button>
                </div>
              ) : (
                <p className="text-center text-[11px] text-slate-600">먼저 떠올려 보고, 카드를 눌러 확인하세요</p>
              )}
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pc:pb-3">
          {card && !doneAll && (
            <button onClick={() => onOpenCard(cardToTreeFile(card))} className={btn}>카드 열기</button>
          )}
          <button onClick={onClose} disabled={busy} className={`${btn} ml-auto`}>{doneAll ? '닫기' : '그만'}</button>
        </div>
      </div>
    </>
  );
}
