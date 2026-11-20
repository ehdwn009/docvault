import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import Group from '../components/ui/Group';
import GroupRow from '../components/ui/GroupRow';
import { api, type TradePending, type TradeRelease, type TradeTone, type TradeView, type User } from '../lib/api';
import { IS_TOUCH } from '../lib/device';
import { HomeButton, MeButton } from '../lib/topNav';

type Props = {
  user: User;
  onOpenFileById: (id: number) => void;
  /** 내 문서로 복사(API-037) — 사본은 문서 탭의 보통 문서가 된다 */
  onCopy: (id: number) => void;
};

const TONE: Record<TradeTone, string> = { up: 'text-accent-400', down: 'text-warn-400', muted: 'text-slate-500' };

/** 'YYYY-MM-DD' → '11월 1일' */
function monthDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** 기다리는 일 띠 — 오늘 발표 예정 / 해부하는 중 / 해부를 못 만듦(관리자에게만 온다) */
function PendingBanner({ p }: { p: TradePending }) {
  const month = p.label.split(' ')[1];
  if (p.state === 'failed') {
    return (
      <div className="rounded-xl border border-amber-700/50 bg-amber-900/20 px-3.5 py-3 text-sm">
        <p className="font-semibold text-amber-200">{month}호 해부를 만들지 못했어요</p>
        <p className="mt-0.5 text-xs text-slate-400">{p.message ?? '이유를 알 수 없어요'} · 원문 PDF는 아래에서 볼 수 있어요</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-sky-800 bg-sky-950/40 px-3.5 py-3 text-sm">
      <p className="font-semibold text-sky-200">{p.state === 'waiting' ? `${month}호 · 곧 올라와요` : `${month}호 도착 · 해부하는 중`}</p>
      <p className="mt-0.5 text-xs text-slate-400">
        {p.state === 'waiting'
          ? `산업통상부가 매달 1일 11시에 발표해요. 1일 ${p.checks.join(' · ')}, 그 뒤로는 매일 ${p.laterCheck}에 게시판을 확인하고, 올라오면 알림이 와요.`
          : '원문을 끝까지 읽고 있어요. 끝나면 알림이 와요.'}
      </p>
    </div>
  );
}

// SCR-195: 동향 탭 — 수출입 동향의 최신 호 큰 카드와 지난 호. 원문 PDF와 해부는 문서 탭에 나오지 않고 여기서만 보인다 (수출입 동향 설계 3단계)
export default function TradePage({ user, onOpenFileById, onCopy }: Props) {
  const [view, setView] = useState<TradeView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void api<TradeView>('/trade')
        .then((v) => alive && (setView(v), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    // 다른 탭·알림에서 돌아왔을 때 읽음 표시와 새 호가 맞도록
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const latest = view?.latest ?? null;
  const past = (view?.releases ?? []).slice(1);
  const openBest = (r: TradeRelease) => {
    const id = r.analysisFileId ?? r.pdfFileId;
    if (id !== null) onOpenFileById(id);
  };
  const sectionTitle = IS_TOUCH ? 'mb-1.5 px-4 text-xs font-medium tracking-wide text-slate-500' : 'mb-2 text-sm font-bold text-slate-200';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {IS_TOUCH ? (
        <div className="flex items-end gap-2 px-4 pb-2 pt-1">
          <HomeButton />
          <h2 className="min-w-0 flex-1 truncate text-[30px] font-bold leading-tight tracking-tight">동향</h2>
          <MeButton />
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-6 py-3">
          <h2 className="text-base font-bold">동향</h2>
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">수출입 동향 · 산업통상부</span>
        </div>
      )}
      <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-4 pb-10 pc:px-6 touch:pt-2">
        <div className="max-w-2xl space-y-6">
          {failed && <p className="text-sm text-slate-500">불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>}
          {!view && !failed && <p className="text-sm text-slate-600">불러오는 중…</p>}
          {view?.pending && <PendingBanner p={view.pending} />}

          {latest && (
            <section className="rounded-2xl border border-sky-800 bg-panel p-4 pc:bg-slate-900/60">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-sky-950/60 px-2 py-1 text-xs font-bold text-sky-300">{latest.label.split(' ')[1]}호</span>
                <h3 className="min-w-0 flex-1 truncate text-[17px] font-bold">{latest.label} 수출입 동향</h3>
                <span className={`shrink-0 text-xs font-semibold ${latest.read ? 'text-slate-500' : 'text-red-400'}`}>{latest.read ? '읽음' : '안 읽음'}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">산업통상부 · {monthDay(latest.publishedDate)} 발표 · 증감률은 작년 같은 달 대비</p>
              {latest.card ? (
                <>
                  {latest.card.kpis.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      {latest.card.kpis.map((k) => (
                        <div key={k.label} className="min-w-0 rounded-xl bg-fill px-3 py-2 pc:bg-slate-800/70">
                          <p className="text-[11.5px] text-slate-500">{k.label}</p>
                          <p className="truncate text-[15px] font-bold tabular-nums">{k.value}</p>
                          <p className="truncate text-xs">
                            {k.sub.map(([text, tone], i) => (
                              <span key={i} className={TONE[tone]}>{text}</span>
                            ))}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {latest.card.headline && <p className="mt-3 text-sm font-semibold">“{latest.card.headline}”</p>}
                  {latest.card.pair && (
                    <div className="mt-2 border-t border-dashed border-slate-700 pt-2">
                      <p className="text-[11.5px] font-semibold text-warn-400">같이 봐야 할 신호</p>
                      <p className="text-[13.5px] text-slate-300">{latest.card.pair}</p>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    1쪽 문장 {latest.card.counts.claims}개 해부 · 쪽 넘는 연결 {latest.card.counts.links} · 지난달과 달라진 것 {latest.card.counts.changes} · 헤드라인이 말하지 않는 것 {latest.card.counts.nih}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-400">이 호는 해부가 아직 없어요. 원문 PDF로 볼 수 있어요.</p>
              )}
              <div className="mt-3 flex flex-col gap-2">
                {latest.analysisFileId !== null && (
                  <button onClick={() => onOpenFileById(latest.analysisFileId!)} className="h-12 w-full rounded-xl bg-sky-600 text-[15px] font-semibold text-white transition hover:bg-sky-500 active:opacity-80">
                    해부 보기
                  </button>
                )}
                {latest.pdfFileId !== null && (
                  <button
                    onClick={() => onOpenFileById(latest.pdfFileId!)}
                    className={latest.analysisFileId !== null ? 'h-11 w-full rounded-xl border border-slate-700 text-sm text-slate-200 transition hover:bg-slate-800' : 'h-12 w-full rounded-xl bg-sky-600 text-[15px] font-semibold text-white transition hover:bg-sky-500 active:opacity-80'}
                  >
                    원문 PDF 보기
                  </button>
                )}
              </div>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>내 문서로 복사:</span>
                {latest.analysisFileId !== null && (
                  <button onClick={() => onCopy(latest.analysisFileId!)} className="underline underline-offset-2 hover:text-slate-300">해부</button>
                )}
                {latest.pdfFileId !== null && (
                  <button onClick={() => onCopy(latest.pdfFileId!)} className="underline underline-offset-2 hover:text-slate-300">원문 PDF</button>
                )}
              </p>
            </section>
          )}
          {view && !latest && !view.pending && <p className="text-sm text-slate-500">아직 받은 수출입 동향이 없어요. 매달 1일에 알아서 가져와요.</p>}

          {past.length > 0 && (
            <section>
              <h3 className={sectionTitle}>지난 호</h3>
              {IS_TOUCH ? (
                <Group>
                  {past.map((r) => (
                    <GroupRow
                      key={r.period}
                      icon={<Icon name="chart" size={21} />}
                      tint={r.analysisFileId !== null ? 'accent' : undefined}
                      title={r.label}
                      subtitle={`${monthDay(r.publishedDate)} 발표 · ${r.analysisFileId !== null ? '해부 · 원문' : '원문'}`}
                      chevron
                      onClick={() => openBest(r)}
                    />
                  ))}
                </Group>
              ) : (
                <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                  {past.map((r) => (
                    <div key={r.period} className="flex min-h-12 items-center gap-3 px-3 py-2">
                      <button onClick={() => openBest(r)} className="min-w-0 flex-1 truncate text-left text-sm text-slate-200 hover:text-accent-300">
                        {r.label}
                      </button>
                      <span className="shrink-0 text-xs text-slate-500">{monthDay(r.publishedDate)} 발표</span>
                      {r.analysisFileId !== null && (
                        <button onClick={() => onOpenFileById(r.analysisFileId!)} className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                          해부
                        </button>
                      )}
                      {r.pdfFileId !== null && (
                        <button onClick={() => onOpenFileById(r.pdfFileId!)} className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                          원문
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {view && (
            <p className="text-xs text-slate-500 touch:px-4">
              여기 있는 원문과 해부는 문서 탭에 나오지 않아요. 문서처럼 다루고 싶으면 위의 「내 문서로 복사」로 사본을 만들 수 있어요.
              {user.role === 'admin' ? ' 새 호는 매달 1일에 알아서 가져오고, 해부는 브리핑 구독의 예약 작업이 만들어요.' : ''}
              <br />출처: 산업통상부 보도자료 (공공누리 제1유형)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
