import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { ApiError, fetchOutlook, setOutlookEditionShown, startOutlookRun, type OutlookEditionView, type OutlookPending, type OutlookView, type User } from '../lib/api';
import { formatDateTime } from '../lib/date';
import { IS_TOUCH } from '../lib/device';
import { toast } from '../lib/toast';

type Props = {
  user: User;
  onOpenFileById: (id: number) => void;
  /** 읽는 칸에 열려 있는 파일 — 그 판을 표시한다 */
  activeFileId?: number | null;
  /** 넓은 화면에서 읽는 칸이 비어 있으면 가장 최근 판을 알아서 연다 */
  autoOpen?: boolean;
};

/** 'YYYY-MM-DD' → '11월 1일' */
function monthDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** 읽은 기관 발표의 기간 — 해를 넘기면(1월 작은 판) 연도를 붙인다 */
function periodText(since: string, until: string): string {
  const sy = since.slice(0, 4);
  const uy = until.slice(0, 4);
  return sy === uy ? `${monthDay(since)} ~ ${monthDay(until)}` : `${sy}년 ${monthDay(since)} ~ ${uy}년 ${monthDay(until)}`;
}

/** 받침에 맞춘 을/를 — 판 이름은 서버가 정하므로("…판", "…전망", 같은 날 두 번이면 " (2)") 마지막 한글 글자로 고른다 */
function withObject(word: string): string {
  const ch = [...word].reverse().find((c) => c >= '가' && c <= '힣');
  if (!ch) return `${word}을(를)`;
  return word + ((ch.charCodeAt(0) - 0xac00) % 28 === 0 ? '를' : '을');
}

/** 위 상태 띠 — 만드는 중 / 못 만듦(관리자에게만 온다) / 없으면 다음 판 예정 */
function StatusBand({ pending, next }: { pending: OutlookPending | null; next: OutlookView['next'] }) {
  if (pending?.state === 'failed') {
    return (
      <div className="rounded-xl border border-amber-700/50 bg-amber-900/20 px-3.5 py-3 text-sm">
        <p className="font-semibold text-amber-200">{withObject(pending.label)} 만들지 못했어요</p>
        <p className="mt-0.5 text-xs text-slate-400">{pending.message ?? '이유를 알 수 없어요'}</p>
      </div>
    );
  }
  if (pending?.state === 'running') {
    return (
      <div className="rounded-xl border border-sky-800 bg-sky-950/40 px-3.5 py-3 text-sm">
        <p className="font-semibold text-sky-200">{withObject(pending.label)} 만드는 중 — 2시간쯤 걸려요</p>
        <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(pending.startedAt)}에 시작했어요. 기관들의 리포트를 찾아 읽고 원문과 맞춰 보고 있어요. 끝나면 알림이 와요.</p>
      </div>
    );
  }
  if (!next) return null;
  return (
    <p className="rounded-xl border border-slate-800 px-3.5 py-2.5 text-xs text-slate-400">
      다음 판: <span className="font-medium text-slate-300">{next.label}</span> · {formatDateTime(next.at)}
    </p>
  );
}

type RowProps = {
  e: OutlookEditionView;
  active: boolean;
  admin: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
};

/** 판 한 줄 — 이름 · 기간 · 첫 문장. 내린 판(관리자에게만 보인다)은 흐리게 + 「내림」 */
function EditionRow({ e, active, admin, busy, onOpen, onToggle }: RowProps) {
  const hidden = e.status === 'hidden';
  return (
    <div className="flex items-center gap-2 px-3 py-2.5" aria-current={active ? 'true' : undefined}>
      <button type="button" onClick={onOpen} disabled={e.fileId === null} className={`group flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default ${hidden ? 'opacity-50' : ''}`}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {!e.read && (
              <>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                <span className="sr-only">안 읽음</span>
              </>
            )}
            <span className={`min-w-0 truncate text-sm pc:group-hover:text-accent-300 ${active ? 'font-semibold text-accent-300' : 'font-medium text-slate-200'}`}>{e.label}</span>
            {hidden && <span className="shrink-0 rounded-full border border-slate-600 px-1.5 text-[11px] text-slate-400">내림</span>}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {periodText(e.since, e.until)}
            {active ? ' · 보는 중' : e.fileId === null ? ' · 파일이 없어요' : ''}
          </span>
          {e.lead && <span className="mt-0.5 block truncate text-xs text-slate-400">{e.lead}</span>}
        </span>
        {IS_TOUCH && e.fileId !== null && <Icon name="chevron" size={16} className="shrink-0 text-slate-600" />}
      </button>
      {!IS_TOUCH && !active && e.fileId !== null && (
        <button type="button" onClick={onOpen} className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
          읽기
        </button>
      )}
      {admin && (
        <button type="button" onClick={onToggle} disabled={busy} className="min-h-8 shrink-0 rounded-md border border-slate-700 px-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50 touch:min-h-11">
          {hidden ? '다시 올리기' : '내리기'}
        </button>
      )}
    </div>
  );
}

// SCR-195의 「세계 전망」 — 기준선인 큰 판 카드와 작은 판(글로벌 리서치 동향) 목록. 판은 동향 탭의 읽는 칸에 열린다 (세계전망 설계 출시 2단계)
export default function OutlookPane({ user, onOpenFileById, activeFileId = null, autoOpen = false }: Props) {
  const [view, setView] = useState<OutlookView | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const [busyId, setBusyId] = useState<number | null>(null);
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    let alive = true;
    const load = () =>
      void fetchOutlook()
        .then((v) => alive && (setView(v), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    // 다른 탭·알림에서 돌아왔을 때 읽음 표시와 새 판이 맞도록
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const reload = () => void fetchOutlook().then(setView).catch(() => undefined);

  /** 관리자: 작은 판을 지금 만들게 시킨다(API-174) — 읽는 기간은 서버가 정한다(마지막 판 다음 날 ~ 오늘) */
  const runNow = () => {
    setRun({ busy: true, note: null });
    void startOutlookRun()
      .then((r) => {
        setRun({ busy: false, note: `${withObject(r.label)} 만들기 시작했어요. 끝나면 알림이 와요(2시간쯤)` });
        reload();
      })
      .catch((e: unknown) => setRun({ busy: false, note: e instanceof ApiError ? e.message : '시작하지 못했어요' }));
  };

  /** 관리자: 내리기·다시 올리기 — 지우지 않고 모든 계정의 목록에서만 감춘다(알림·링크는 그대로 열린다) */
  const toggleShown = (e: OutlookEditionView) => {
    setBusyId(e.id);
    void setOutlookEditionShown(e.id, e.status === 'hidden')
      .then(reload)
      .catch((err: unknown) => toast(err instanceof ApiError ? err.message : '바꾸지 못했어요', 'error'))
      .finally(() => setBusyId(null));
  };

  const open = (e: OutlookEditionView) => {
    if (e.fileId === null) return;
    onOpenFileById(e.fileId);
    // 읽음은 서버가 연 시각으로 정한다 — 다시 불러오기 전까지 점이 남지 않게 여기서도 지운다
    if (!e.read) setView((v) => v && { ...v, editions: v.editions.map((x) => (x.id === e.id ? { ...x, read: true } : x)) });
  };

  const editions = view?.editions ?? [];
  const baseline = editions.find((e) => e.id === view?.baselineId) ?? null;
  const smalls = editions.filter((e) => e.kind === 'small');
  // 기준선이 아닌 큰 판(지난해 것, 내린 것) — 내린 큰 판을 다시 올릴 자리가 있어야 한다
  const otherBigs = editions.filter((e) => e.kind === 'big' && e.id !== baseline?.id);

  // 넓은 화면 — 읽는 칸이 비어 있으면 가장 최근에 게시된 판을 연다. 한 번 연 뒤에는 목록이 바뀌어도(내리기 등) 옮겨 가지 않는다
  const autoPick = autoOpen ? (editions.find((e) => e.status === 'published' && e.fileId !== null)?.fileId ?? null) : null;
  const openRef = useRef(onOpenFileById);
  openRef.current = onOpenFileById;
  const pickedRef = useRef(false);
  useEffect(() => {
    if (!autoOpen) pickedRef.current = false;
  }, [autoOpen]);
  useEffect(() => {
    if (autoPick === null || pickedRef.current) return;
    pickedRef.current = true;
    openRef.current(autoPick);
  }, [autoPick]);

  const sectionTitle = IS_TOUCH ? 'mb-1.5 px-4 text-xs font-medium tracking-wide text-slate-500' : 'mb-2 text-sm font-bold text-slate-200';
  const listClass = 'divide-y divide-slate-800 overflow-hidden rounded-xl bg-panel pc:border pc:border-slate-800 pc:bg-transparent';
  const row = (e: OutlookEditionView) => (
    <EditionRow key={e.id} e={e} active={e.fileId !== null && e.fileId === activeFileId} admin={isAdmin} busy={busyId === e.id} onOpen={() => open(e)} onToggle={() => toggleShown(e)} />
  );

  return (
    <div className="max-w-2xl space-y-6">
      {failed && <p className="text-sm text-slate-500">불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>}
      {!view && !failed && <p className="text-sm text-slate-600">불러오는 중…</p>}

      {/* 지금 만들기 — 예약 작업(구독 사용량)을 쓰는 일이라 관리자에게만 */}
      {isAdmin && view && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            onClick={runNow}
            disabled={run.busy || view.pending?.state === 'running'}
            className="min-h-9 shrink-0 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-50 touch:min-h-11"
          >
            지금 만들기
          </button>
          <span className="min-w-0 flex-1 text-xs text-slate-500">작은 판 하나 — 마지막 판 다음 날부터 오늘까지 나온 리포트를 읽어요</span>
          {run.note && (
            <p role="status" className="w-full text-xs text-accent-400">
              {run.note}
            </p>
          )}
        </div>
      )}
      {view && <StatusBand pending={view.pending} next={view.next} />}

      {baseline && (
        <section className="rounded-2xl border border-sky-800 bg-panel p-4 pc:bg-slate-900/60">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-sky-950/60 px-2 py-1 text-xs font-bold text-sky-300">기준선 · 큰 판</span>
            <span className="min-w-0 flex-1" />
            <span className={`shrink-0 text-xs font-semibold ${baseline.read ? 'text-slate-500' : 'text-red-400'}`}>{baseline.read ? '읽음' : '안 읽음'}</span>
          </div>
          <h3 className="mt-2 text-[17px] font-bold leading-snug">{baseline.title}</h3>
          {baseline.subtitle && <p className="mt-0.5 text-sm text-slate-300">{baseline.subtitle}</p>}
          <p className="mt-1 text-xs text-slate-500">{periodText(baseline.since, baseline.until)}에 나온 전망을 읽었어요 · 작은 판은 이 글에서 달라진 것을 전해요</p>
          {/* 서버가 만든 판은 첫 문장이 곧 부제다 — 같은 글을 두 번 보이지 않게 */}
          {baseline.lead && baseline.lead !== baseline.subtitle && <p className="mt-3 text-sm leading-relaxed text-slate-200">{baseline.lead}</p>}
          <div className="mt-3">
            {baseline.fileId !== null && baseline.fileId === activeFileId ? (
              // 옆 읽는 칸에 열려 있다 — 단추 대신 표시만 (넓은 화면)
              <p aria-current="true" className="grid h-12 w-full place-items-center rounded-xl border border-accent-500/60 text-[15px] font-semibold text-accent-300">
                읽는 중
              </p>
            ) : (
              <button
                onClick={() => open(baseline)}
                disabled={baseline.fileId === null}
                className="h-12 w-full rounded-xl bg-sky-600 text-[15px] font-semibold text-white transition hover:bg-sky-500 active:opacity-80 disabled:opacity-50"
              >
                {baseline.fileId === null ? '파일이 없어요' : '읽기'}
              </button>
            )}
          </div>
          {isAdmin && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <button onClick={() => toggleShown(baseline)} disabled={busyId === baseline.id} className="underline underline-offset-2 hover:text-slate-300 disabled:opacity-50">
                내리기
              </button>
              <span>내리면 모든 계정의 목록에서 감춰지고, 그 앞 큰 판이 기준선이 돼요</span>
            </p>
          )}
        </section>
      )}

      {smalls.length > 0 && (
        <section>
          <h3 className={sectionTitle}>글로벌 리서치 동향 · 한 달에 두 번</h3>
          <div className={listClass}>{smalls.map(row)}</div>
        </section>
      )}
      {otherBigs.length > 0 && (
        <section>
          <h3 className={sectionTitle}>{baseline ? '그 밖의 큰 판' : '큰 판'}</h3>
          <div className={listClass}>{otherBigs.map(row)}</div>
        </section>
      )}
      {view && editions.length === 0 && !view.pending && <p className="text-sm text-slate-500">아직 올라온 세계 전망이 없어요.</p>}

      {view && (
        <p className="text-xs text-slate-500 touch:px-4">
          세계의 연구기관·금융회사·국제기구·컨설팅사가 낸 전망을 찾아 읽고, 원문과 맞춰 본 뒤 정리한 글이에요. 출처는 글 안의 각주에 있어요. 문서 탭에는 나오지 않아요.
          {isAdmin ? ' 작은 판은 매달 둘째·넷째 월요일 오전 10시에, 큰 판은 1월 둘째 월요일에 브리핑 구독의 예약 작업이 만들어요. 내린 판은 관리자에게만 흐리게 보여요.' : ''}
        </p>
      )}
    </div>
  );
}
