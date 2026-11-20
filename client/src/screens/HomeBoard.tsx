import { Fragment, useEffect, useState, type ReactNode } from 'react';
import FileName from '../components/FileName';
import Icon, { FILE_TYPE_ICON } from '../components/Icon';
import MiniBars from '../components/MiniBars';
import { api, type EditionHeadline, type TradeView, type TreeFile } from '../lib/api';
import { BRIEFING_READ_EVENT, kstToday, shortDate, slotName, type EditionSummary } from '../lib/briefing';
import { formatDate } from '../lib/date';
import { useMinWidth } from '../lib/device';

/** 세 칸으로 나누는 창 너비(px) — 그보다 좁으면(펼친 폰을 세로로 쥔 화면) 두 칸 */
const THREE_COLUMNS_MIN_W = 900;
/** 「이어 읽기」에 첫 줄까지 보여 주는 문서 수 · 「안 읽은 지난 브리핑」 줄 수 · 「즐겨찾기」 줄 수 */
const RECENT_WITH_EXCERPT = 4;
const MISSED_EDITIONS = 3;
const FAVORITES = 5;

type Props = {
  /** 브리핑을 볼 수 있는 계정인가(관리자·열람 계정) */
  hasBriefing: boolean;
  /** 최근에 연 문서(최신순) */
  recent: TreeFile[];
  favorites: TreeFile[];
  onOpenFile: (file: TreeFile) => void;
  onOpenFileById: (id: number) => void;
  onOpenFeed: () => void;
  onOpenTrade: () => void;
  /** 홈이 이미 그리고 있는 칸들 — 넓은 화면에서도 같은 것을 쓴다 */
  review: ReactNode;
  chats: ReactNode;
  /** 연 문서가 하나도 없을 때의 시작 단추들 */
  start: ReactNode;
};

const card = 'rounded-2xl bg-panel p-4 pc:border pc:border-slate-800 pc:bg-slate-900/50';
const cardTitle = 'text-xs font-medium tracking-wide text-slate-500';
const row = 'flex w-full min-w-0 items-start gap-2.5 rounded-lg px-1 py-2 text-left transition active:bg-slate-800/40 pc:hover:bg-slate-800/30';

/** 회차의 읽음 상태 — 브리핑 탭의 큰 카드와 같은 말 */
function editionState(e: EditionSummary): { text: string; cls: string } {
  if (e.state === 'unread') return { text: '안 읽음', cls: 'text-red-400' };
  if (e.state === 'done') return { text: '다 읽음', cls: 'text-slate-500' };
  return { text: `핵심 ${Math.max(0, e.leadCount - e.leadRead)} 남음`, cls: 'text-slate-400' };
}

// SCR-101(넓은 화면): 홈 미리보기 — 가는 길 대신 내용을 미리 보여 주는 칸들 (IA — 홈 미리보기 v0.74, 사용자 결정 2026-11-20).
// 오늘 브리핑의 핵심 제목, 수출입 동향의 숫자·추이·결론, 이어 읽던 문서의 첫 줄. 좁은 화면(접은 폰)의 홈은 전과 같다
export default function HomeBoard({ hasBriefing, recent, favorites, onOpenFile, onOpenFileById, onOpenFeed, onOpenTrade, review, chats, start }: Props) {
  const three = useMinWidth(THREE_COLUMNS_MIN_W);
  const [editions, setEditions] = useState<EditionSummary[] | null>(null);
  const [trade, setTrade] = useState<TradeView | null>(null);
  const [headlines, setHeadlines] = useState<{ fileId: number; items: EditionHeadline[] } | null>(null);
  const [excerpts, setExcerpts] = useState<Record<number, string>>({});

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (hasBriefing) void api<{ editions: EditionSummary[] }>('/briefing/editions').then((r) => alive && setEditions(r.editions)).catch(() => alive && setEditions([]));
      void api<TradeView>('/trade').then((v) => alive && setTrade(v)).catch(() => {});
    };
    load();
    // 회차를 읽고 돌아오면 읽음 상태가 바로 맞게
    window.addEventListener(BRIEFING_READ_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(BRIEFING_READ_EVENT, load);
    };
  }, [hasBriefing]);

  const today = kstToday();
  const todays = (editions ?? []).filter((e) => e.editionDate === today);
  // 오늘 볼 회차 — 브리핑 탭이 알아서 여는 것과 같은 규칙(아직 다 읽지 않은 것 먼저)
  const pick = todays.find((e) => e.state !== 'done') ?? todays[0] ?? null;
  const missed = (editions ?? []).filter((e) => e.editionDate !== today && e.state !== 'done').slice(0, MISSED_EDITIONS);
  const pickId = pick?.fileId ?? null;
  useEffect(() => {
    if (pickId === null) return;
    let alive = true;
    void api<{ items: EditionHeadline[] }>(`/briefing/editions/${pickId}/headlines`)
      .then((r) => alive && setHeadlines({ fileId: pickId, items: r.items }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pickId]);

  const shown = recent.slice(0, RECENT_WITH_EXCERPT);
  const idsKey = shown.map((f) => f.id).join(',');
  useEffect(() => {
    if (idsKey === '') return;
    let alive = true;
    void api<{ excerpts: { id: number; text: string }[] }>(`/files/excerpts?ids=${idsKey}`)
      .then((r) => alive && setExcerpts(Object.fromEntries(r.excerpts.map((x) => [x.id, x.text]))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [idsKey]);

  const briefing = hasBriefing && editions !== null && (
    <section className={card} key="briefing">
      <div className="flex items-center gap-2">
        <h3 className={`min-w-0 flex-1 truncate ${cardTitle}`}>오늘 브리핑{pick ? ` · ${slotName(pick.slot, pick.label)}` : ''}</h3>
        {pick && <span className={`shrink-0 text-xs font-semibold ${editionState(pick).cls}`}>{editionState(pick).text}</span>}
      </div>
      {pick ? (
        <>
          <ol className="mt-2 divide-y divide-slate-800">
            {(headlines?.fileId === pick.fileId ? headlines.items : []).map((h) => (
              <li key={h.id} className="py-2">
                <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-slate-100">{h.title}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-slate-500">
                  {h.section} · {h.category}
                </p>
              </li>
            ))}
          </ol>
          <button onClick={() => onOpenFileById(pick.fileId)} className="mt-2 h-11 w-full rounded-xl bg-sky-600 text-sm font-semibold text-white transition hover:bg-sky-500 active:opacity-80">
            {pick.state === 'unread' ? '읽기' : pick.state === 'done' ? '다시 보기' : '이어서 읽기'}
          </button>
          {todays.length > 1 && (
            <button onClick={onOpenFeed} className="mt-2 w-full text-center text-xs text-slate-500 hover:text-slate-300">
              오늘 회차 {todays.length}개 모두 보기 ›
            </button>
          )}
        </>
      ) : (
        <button onClick={onOpenFeed} className="mt-2 block text-left text-sm text-slate-400 hover:text-slate-200">
          오늘 브리핑이 아직 없어요. 브리핑 탭에서 예정과 지난 회차를 봐요 ›
        </button>
      )}
    </section>
  );

  const missedCard = missed.length > 0 && (
    <section className={card} key="missed">
      <h3 className={cardTitle}>안 읽은 지난 브리핑</h3>
      <div className="mt-1">
        {missed.map((e) => (
          <button key={e.fileId} onClick={() => onOpenFileById(e.fileId)} className={row}>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
              {shortDate(e.editionDate)} {slotName(e.slot, e.label)}
            </span>
            <span className={`shrink-0 text-xs ${editionState(e).cls}`}>{editionState(e).text}</span>
          </button>
        ))}
      </div>
    </section>
  );

  const l = trade?.latest ?? null;
  const p = trade?.pending ?? null;
  const month = (label: string) => label.split(' ')[1];
  const k = l?.card?.kpis[0];
  const tradeCard = trade !== null && (
    <section className={card} key="trade">
      <div className="flex items-center gap-2">
        <h3 className={`min-w-0 flex-1 truncate ${cardTitle}`}>{l ? `${month(l.label)} 수출입 동향` : '수출입 동향'}</h3>
        {l && <span className={`shrink-0 text-xs font-semibold ${l.read ? 'text-slate-500' : 'text-red-400'}`}>{l.read ? '읽음' : '안 읽음'}</span>}
      </div>
      {p && p.state !== 'failed' && (
        <p className="mt-1.5 text-xs text-slate-400">{p.state === 'waiting' ? `${month(p.label)}호가 곧 올라와요 · 올라오면 알림이 와요` : `${month(p.label)}호 도착 · 정리하는 중`}</p>
      )}
      {l ? (
        <>
          {k && (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-slate-500">{k.label}</span>
              <span className="text-[19px] font-bold tabular-nums text-slate-100">{k.value}</span>
              {k.lines[0] && <span className="text-xs text-slate-400">{k.lines[0]}</span>}
            </p>
          )}
          {l.card?.trend && (
            <div className="mt-2">
              <MiniBars values={l.card.trend.exp} periods={l.card.trend.periods} unit="억 달러" name="수출액" height={56} />
            </div>
          )}
          {l.card && l.card.points.length > 0 && (
            <ol className="mt-2 space-y-1">
              {l.card.points.slice(0, 3).map((t, i) => (
                <li key={t} className="flex gap-2 text-[13.5px] leading-snug text-slate-200">
                  <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-fill text-[11px] font-bold text-slate-300 pc:bg-slate-800">{i + 1}</span>
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ol>
          )}
          <button
            onClick={() => (l.analysisFileId !== null ? onOpenFileById(l.analysisFileId) : l.pdfFileId !== null ? onOpenFileById(l.pdfFileId) : onOpenTrade())}
            className="mt-3 h-11 w-full rounded-xl border border-slate-700 text-sm font-semibold text-slate-100 transition hover:bg-slate-800 active:opacity-80"
          >
            {l.analysisFileId !== null ? '정리 보기' : '원문 PDF 보기'}
          </button>
        </>
      ) : (
        !p && <p className="mt-2 text-sm text-slate-500">아직 받은 호가 없어요. 매달 1일에 알아서 가져와요.</p>
      )}
    </section>
  );

  const movers = l?.card?.movers ?? [];
  const moversCard = l && movers.length > 0 && (
    <section className={card} key="movers">
      <h3 className={cardTitle}>{month(l.label)}에 크게 움직인 품목 · 작년 같은 달 대비</h3>
      <div className="mt-1 divide-y divide-slate-800">
        {movers.map((m) => (
          <button key={m.name} onClick={onOpenTrade} className="flex w-full items-baseline gap-2 py-2 text-left text-sm">
            <span className="min-w-0 flex-1 truncate text-slate-200">{m.name}</span>
            <span className="shrink-0 tabular-nums text-slate-400">{m.amt.toLocaleString('ko-KR')}억 달러</span>
            <span className="w-[4.6rem] shrink-0 text-right font-semibold tabular-nums text-slate-100">
              {m.yoy >= 0 ? '▲' : '▼'}
              {Math.abs(m.yoy).toLocaleString('ko-KR')}%
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const reading = (
    <section className={card} key="reading">
      <h3 className={cardTitle}>이어 읽기</h3>
      {recent.length === 0 ? (
        <div className="mt-2">
          <p className="mb-3 text-xs text-slate-500">아직 연 문서가 없어요. 어디서 시작할까요?</p>
          {start}
        </div>
      ) : (
        <div className="mt-1">
          {shown.map((f) => (
            <button key={f.id} onClick={() => onOpenFile(f)} className={row}>
              <Icon name={FILE_TYPE_ICON[f.fileType] ?? 'doc'} size={18} className="mt-0.5 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-100">
                  <FileName name={f.name} wrap />
                </span>
                {excerpts[f.id] && <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-slate-400">{excerpts[f.id]}</span>}
                <span className="mt-0.5 block text-[11px] text-slate-500">{formatDate(f.state.lastOpenedAt!)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  const favCard = favorites.length > 0 && (
    <section className={card} key="fav">
      <h3 className={cardTitle}>즐겨찾기</h3>
      <div className="mt-1">
        {favorites.slice(0, FAVORITES).map((f) => (
          <button key={f.id} onClick={() => onOpenFile(f)} className={row}>
            <Icon name="star" size={16} className="mt-0.5 shrink-0 text-warn-400" />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
              <FileName name={f.name} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  // 칸 나누기 — 세 칸: 브리핑 쪽 / 수출입 동향 쪽 / 내 문서·대화. 두 칸이면 문서·대화가 양쪽 아래로 나뉜다.
  // 브리핑을 볼 수 없는 계정은 첫 칸이 비지 않게 이어 읽기가 맨 앞으로 온다
  const columns: ReactNode[][] = three
    ? hasBriefing
      ? [[briefing, review, missedCard], [tradeCard, moversCard], [reading, chats, favCard]]
      : [[reading, favCard], [tradeCard, moversCard], [review, chats]]
    : hasBriefing
      ? [[briefing, missedCard, reading, favCard], [tradeCard, moversCard, review, chats]]
      : [[reading, favCard, review], [tradeCard, moversCard, chats]];

  return (
    <div className={`grid max-w-6xl items-start gap-4 ${three ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {columns.map((col, i) => (
        <div key={i} className="min-w-0 space-y-4">
          {col.map((c, j) => (
            <Fragment key={j}>{c}</Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
