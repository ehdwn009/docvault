import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import MiniBars, { periodName } from '../components/MiniBars';
import Group from '../components/ui/Group';
import GroupRow from '../components/ui/GroupRow';
import { api, ApiError, type TradePending, type TradeRelease, type TradeView, type User } from '../lib/api';
import { IS_TOUCH } from '../lib/device';
import { HomeButton, MeButton } from '../lib/topNav';
import { getTrendMode, setTrendMode, TREND_MODE_EVENT, type TrendMode } from '../lib/trendMode';
import OutlookPane from './OutlookPane';

type Props = {
  user: User;
  onOpenFileById: (id: number) => void;
  /** 읽는 칸에 열려 있는 파일 — 그 줄을 표시한다 */
  activeFileId?: number | null;
  /** 넓은 화면에서 읽는 칸이 비어 있으면 최신 호를 알아서 연다 */
  autoOpen?: boolean;
  /** 넓은 화면(읽는 칸이 목록 옆에 있다) — 수출입 ↔ 세계 전망을 바꾸면 그쪽의 기본 문서를 옆에 연다 */
  wide?: boolean;
  /** 내 문서로 복사(API-037) — 사본은 문서 탭의 보통 문서가 된다 */
  onCopy: (id: number) => void;
};

/** 'YYYY-MM-DD' → '11월 1일' */
function monthDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** 기다리는 일 띠 — 곧 올라와요 / 정리하는 중 / 정리본을 못 만듦(관리자에게만 온다) */
function PendingBanner({ p }: { p: TradePending }) {
  const month = p.label.split(' ')[1];
  if (p.state === 'failed') {
    return (
      <div className="rounded-xl border border-amber-700/50 bg-amber-900/20 px-3.5 py-3 text-sm">
        <p className="font-semibold text-amber-200">{month}호 정리본을 만들지 못했어요</p>
        <p className="mt-0.5 text-xs text-slate-400">{p.message ?? '이유를 알 수 없어요'} · 원문 PDF는 아래에서 볼 수 있어요</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-sky-800 bg-sky-950/40 px-3.5 py-3 text-sm">
      <p className="font-semibold text-sky-200">{p.state === 'waiting' ? `${month}호 · 곧 올라와요` : `${month}호 도착 · 정리하는 중`}</p>
      <p className="mt-0.5 text-xs text-slate-400">
        {p.state === 'waiting'
          ? `산업통상부가 매달 1일 11시에 발표해요. 1일 ${p.checks.join(' · ')}, 그 뒤로는 매일 ${p.laterCheck}에 게시판을 확인하고, 올라오면 알림이 와요.`
          : '원문을 끝까지 읽고 있어요. 끝나면 알림이 와요.'}
      </p>
    </div>
  );
}

const MODES: [TrendMode, string][] = [
  ['trade', '수출입'],
  ['outlook', '세계 전망'],
];

// SCR-195: 동향 탭 — 수출입 동향의 최신 호 큰 카드와 지난 호. 원문 PDF와 정리본은 문서 탭에 나오지 않고 여기서만 보인다 (수출입 동향 설계 3·4단계)
// 맨 위의 「수출입 | 세계 전망」 전환으로 세계 전망(OutlookPane)과 자리를 나눠 쓴다 (세계전망 설계 출시 2단계 — 새 탭 대신 동향 탭 안의 전환)
export default function TradePage({ user, onOpenFileById, activeFileId = null, autoOpen = false, wide = false, onCopy }: Props) {
  const [mode, setMode] = useState<TrendMode>(getTrendMode);
  // 사람이 전환을 눌렀으면 넓은 화면에서는 그쪽의 기본 문서(최신 호 / 최근 판)를 옆에 연다 — 목록과 읽는 칸이 어긋나지 않게
  const [switched, setSwitched] = useState(false);
  // 전환 단추가 바꾼 것인지 — setTrendMode가 이벤트를 곧바로 보내므로 그 사이에만 켜 둔다
  const byButtonRef = useRef(false);
  // 알림·읽는 칸에서 세계 전망 판을 열면 Workspace가 전환을 바꾼다 — 여기서 따라간다.
  // 바깥에서 바뀐 전환은 이미 열 문서가 정해져 있으니 기본 문서를 열지 않는다(알림이 연 판을 최신 판으로 덮지 않게)
  useEffect(() => {
    const sync = () => {
      if (!byButtonRef.current) setSwitched(false);
      setMode(getTrendMode());
    };
    window.addEventListener(TREND_MODE_EVENT, sync);
    return () => window.removeEventListener(TREND_MODE_EVENT, sync);
  }, []);
  const pickMode = (m: TrendMode) => {
    if (m === mode) return;
    setSwitched(true);
    byButtonRef.current = true;
    setTrendMode(m);
    byButtonRef.current = false;
  };
  const pickDefault = autoOpen || (wide && switched);
  const [view, setView] = useState<TradeView | null>(null);
  const [failed, setFailed] = useState(false);
  const [rerun, setRerun] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });

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

  /** 관리자: 이 호의 정리본을 다시 만들게 시킨다(API-172) — 예약 작업을 켜는 일이라 끝나면 알림으로 온다 */
  const remake = (period: string) => {
    setRerun({ busy: true, note: null });
    void api('/trade/' + period + '/analysis', { method: 'POST' })
      .then(() => {
        setRerun({ busy: false, note: '다시 만들기 시작했어요. 끝나면 알림이 와요(길면 세 시간). 그동안은 지금 것이 그대로 보여요' });
        return api<TradeView>('/trade').then(setView);
      })
      .catch((e: unknown) => setRerun({ busy: false, note: e instanceof ApiError ? e.message : '시작하지 못했어요' }));
  };

  const latest = view?.latest ?? null;
  const trend = latest?.card?.trend ?? null;
  // 지난 호 목록 — 추이 표(달마다)에 이미 나오는 달은 뺀다. 그보다 오래된 호만 따로 남는다
  const past = (view?.releases ?? []).slice(1).filter((r) => !trend?.periods.includes(r.period));
  // 넓은 화면 — 탭에 들어오면 최신 호(정리본이 있으면 정리본, 없으면 원문)가 읽는 칸에 열려 있다
  const autoPick = pickDefault && mode === 'trade' && latest ? (latest.analysisFileId ?? latest.pdfFileId) : null;
  const openRef = useRef(onOpenFileById);
  openRef.current = onOpenFileById;
  useEffect(() => {
    if (autoPick !== null) openRef.current(autoPick);
  }, [autoPick]);
  /** 옆 읽는 칸에 이 호(정리본이든 원문이든)가 열려 있나 */
  const isOpen = (r: TradeRelease) => activeFileId !== null && (r.analysisFileId === activeFileId || r.pdfFileId === activeFileId);
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
          <span className="truncate rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">{mode === 'trade' ? '수출입 동향 · 산업통상부' : '세계 전망 · 기관 리포트'}</span>
        </div>
      )}
      {/* 수출입 | 세계 전망 — 폰은 분절 컨트롤(옅은 바탕 칸 안에 흰 알약), PC는 AI 화면의 탭과 같은 단추 */}
      <div role="tablist" aria-label="동향 종류" className={IS_TOUCH ? 'mx-4 mb-1 grid grid-cols-2 rounded-lg bg-fill p-0.5' : 'flex gap-1 px-3 pb-2'}>
        {MODES.map(([m, label]) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => pickMode(m)}
            className={
              IS_TOUCH
                ? `min-h-9 rounded-md text-sm transition ${mode === m ? 'bg-panel font-semibold text-slate-100 shadow-sm' : 'text-slate-400'}`
                : `min-h-9 rounded-md px-3 text-sm transition ${mode === m ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`
            }
          >
            {label}
          </button>
        ))}
      </div>
      {/* key — 전환하면 스크롤을 맨 위에서 다시 시작한다 */}
      <div key={mode} className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-4 pb-10 pc:px-6 touch:pt-2">
        {mode === 'outlook' ? (
          <OutlookPane user={user} onOpenFileById={onOpenFileById} activeFileId={activeFileId} autoOpen={pickDefault} />
        ) : (
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
                            {k.lines.map((line) => (
                              // 좁은 목록 열(펼친 폰의 세로 레일 옆)에서 "+365.0억 달러"가 잘리지 않게 줄을 바꾼다
                              <p key={line} className="text-xs leading-snug text-slate-400">{line}</p>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {latest.card.points.length > 0 && (
                      <ol className="mt-3 space-y-1.5">
                        {latest.card.points.map((point, i) => (
                          <li key={point} className="flex gap-2 text-sm">
                            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-fill text-[11px] font-semibold text-slate-300 pc:bg-slate-800">{i + 1}</span>
                            <span className="min-w-0 font-medium text-slate-200">{point}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {latest.card.format === 1 && user.role === 'admin' && (
                      <p className="mt-2 text-xs text-slate-500">예전 형식(해부)으로 만든 호예요. 아래 「정리본 다시 만들기」를 누르면 새 정리본으로 바뀝니다.</p>
                    )}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">이 호는 정리본이 아직 없어요. 원문 PDF로 볼 수 있어요.</p>
                )}
                {latest.card?.trend && (
                  // 최근 달들의 수출액 — 막대는 값만 보여 준다. 그 달의 호를 여는 것과 같은 숫자의 표는 아래 「달마다」
                  <div className="mt-3 rounded-xl bg-fill px-3 py-2.5 pc:bg-slate-800/70">
                    <p className="mb-1 text-[11.5px] text-slate-500">수출액 · 최근 {latest.card.trend.exp.length}개월</p>
                    <MiniBars values={latest.card.trend.exp} periods={latest.card.trend.periods} unit="억 달러" name="수출액" />
                  </div>
                )}
                <div className="mt-3 flex flex-col gap-2">
                  {latest.analysisFileId !== null &&
                    (latest.analysisFileId === activeFileId ? (
                      // 옆 읽는 칸에 열려 있다 — 단추 대신 표시만 (넓은 화면)
                      <p aria-current="true" className="grid h-12 w-full place-items-center rounded-xl border border-accent-500/60 text-[15px] font-semibold text-accent-300">
                        정리 보는 중
                      </p>
                    ) : (
                      <button onClick={() => onOpenFileById(latest.analysisFileId!)} className="h-12 w-full rounded-xl bg-sky-600 text-[15px] font-semibold text-white transition hover:bg-sky-500 active:opacity-80">
                        정리 보기
                      </button>
                    ))}
                  {latest.pdfFileId !== null && (
                    <button
                      onClick={() => onOpenFileById(latest.pdfFileId!)}
                      aria-current={latest.pdfFileId === activeFileId ? 'true' : undefined}
                      className={
                        latest.pdfFileId === activeFileId
                          ? 'h-11 w-full rounded-xl border border-accent-500/60 text-sm font-semibold text-accent-300'
                          : latest.analysisFileId !== null
                            ? 'h-11 w-full rounded-xl border border-slate-700 text-sm text-slate-200 transition hover:bg-slate-800'
                            : 'h-12 w-full rounded-xl bg-sky-600 text-[15px] font-semibold text-white transition hover:bg-sky-500 active:opacity-80'
                      }
                    >
                      {latest.pdfFileId === activeFileId ? '원문 PDF 보는 중' : '원문 PDF 보기'}
                    </button>
                  )}
                </div>
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>내 문서로 복사:</span>
                  {latest.analysisFileId !== null && (
                    <button onClick={() => onCopy(latest.analysisFileId!)} className="underline underline-offset-2 hover:text-slate-300">정리본</button>
                  )}
                  {latest.pdfFileId !== null && (
                    <button onClick={() => onCopy(latest.pdfFileId!)} className="underline underline-offset-2 hover:text-slate-300">원문 PDF</button>
                  )}
                </p>
                {/* 다시 만들기 — 예약 작업(구독 사용량)을 쓰는 일이라 관리자에게만. 도는 중에는 위의 띠가 대신 보인다 */}
                {user.role === 'admin' && latest.pdfFileId !== null && view?.pending?.state !== 'analyzing' && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <button onClick={() => remake(latest.period)} disabled={rerun.busy} className="underline underline-offset-2 hover:text-slate-300 disabled:opacity-50">
                      정리본 다시 만들기
                    </button>
                    {rerun.note && <span role="status" className="text-accent-400">{rerun.note}</span>}
                  </p>
                )}
              </section>
            )}
            {view && !latest && !view.pending && <p className="text-sm text-slate-500">아직 받은 수출입 동향이 없어요. 매달 1일에 알아서 가져와요.</p>}

            {trend && (
              // 달마다 — 그래프와 같은 숫자의 표. 받은 호가 있는 달은 누르면 옆(폰은 위)에 열린다
              <section>
                <h3 className={sectionTitle}>달마다 · 억 달러</h3>
                <div className="overflow-hidden rounded-xl bg-panel pc:border pc:border-slate-800 pc:bg-transparent">
                  <table className="w-full text-[13px] tabular-nums">
                    <thead>
                      <tr className="text-[11.5px] text-slate-500">
                        <th scope="col" className="py-2 pl-3 text-left font-medium">달</th>
                        <th scope="col" className="px-2 py-2 text-right font-medium">수출</th>
                        <th scope="col" className="px-2 py-2 text-right font-medium">수입</th>
                        <th scope="col" className="py-2 pl-2 pr-3 text-right font-medium">무역수지</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trend.periods
                        .map((period, i) => ({ period, i, r: view?.releases.find((x) => x.period === period) }))
                        .reverse()
                        .map(({ period, i, r }) => {
                          const open = r ? isOpen(r) : false;
                          const cell = `border-t border-slate-800 py-2 ${open ? 'font-semibold text-accent-300' : r ? 'text-slate-200' : 'text-slate-500'}`;
                          return (
                            <tr key={period} onClick={r ? () => openBest(r) : undefined} className={r ? 'cursor-pointer active:bg-slate-800/40 pc:hover:bg-slate-800/30' : ''} aria-current={open ? 'true' : undefined}>
                              <th scope="row" className={`${cell} pl-3 text-left font-normal`}>
                                {r ? (
                                  // 키보드로도 고를 수 있게 달 이름이 단추다 — 줄 전체를 눌러도 같다
                                  <button type="button" onClick={(e) => (e.stopPropagation(), openBest(r))} className="text-left">
                                    {periodName(period)}
                                  </button>
                                ) : (
                                  periodName(period)
                                )}
                              </th>
                              <td className={`${cell} px-2 text-right`}>{trend.exp[i]!.toLocaleString('ko-KR')}</td>
                              <td className={`${cell} px-2 text-right`}>{trend.imp[i]!.toLocaleString('ko-KR')}</td>
                              <td className={`${cell} pl-2 pr-3 text-right`}>{`${trend.bal[i]! > 0 ? '+' : ''}${trend.bal[i]!.toLocaleString('ko-KR')}`}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 touch:px-4">밝은 줄은 받아 둔 호예요. 누르면 열려요. 숫자는 {latest ? `${latest.label}호` : ''}에 실린 값이고 억 달러 아래는 반올림했습니다.</p>
              </section>
            )}
            {past.length > 0 && (
              <section>
                <h3 className={sectionTitle}>{trend ? '그 밖의 지난 호' : '지난 호'}</h3>
                {IS_TOUCH ? (
                  <Group>
                    {past.map((r) => (
                      <GroupRow
                        key={r.period}
                        icon={<Icon name="chart" size={21} />}
                        tint={r.analysisFileId !== null ? 'accent' : undefined}
                        title={r.label}
                        subtitle={`${monthDay(r.publishedDate)} 발표 · ${isOpen(r) ? '보는 중' : r.analysisFileId !== null ? '정리본 · 원문' : '원문'}`}
                        chevron
                        onClick={() => openBest(r)}
                      />
                    ))}
                  </Group>
                ) : (
                  <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                    {past.map((r) => (
                      <div key={r.period} className="flex min-h-12 items-center gap-3 px-3 py-2">
                        <button onClick={() => openBest(r)} className={`min-w-0 flex-1 truncate text-left text-sm hover:text-accent-300 ${isOpen(r) ? 'font-semibold text-accent-300' : 'text-slate-200'}`}>
                          {r.label}
                        </button>
                        <span className="shrink-0 text-xs text-slate-500">{monthDay(r.publishedDate)} 발표</span>
                        {r.analysisFileId !== null && (
                          <button onClick={() => onOpenFileById(r.analysisFileId!)} className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                            정리본
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
                여기 있는 원문과 정리본은 문서 탭에 나오지 않아요. 문서처럼 다루고 싶으면 위의 「내 문서로 복사」로 사본을 만들 수 있어요.
                {user.role === 'admin' ? ' 새 호는 매달 1일에 알아서 가져오고, 정리본은 브리핑 구독의 예약 작업이 만들어요.' : ''}
                <br />출처: 산업통상부 보도자료 (공공누리 제1유형)
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
