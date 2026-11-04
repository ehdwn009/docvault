import { useEffect, useState } from 'react';
import Icon, { FILE_TYPE_ICON } from '../components/Icon';
import Group from '../components/ui/Group';
import GroupRow from '../components/ui/GroupRow';
import { cleanTitle } from '../components/AskPanel';
import ReviewDialog from '../components/ReviewDialog';
import FileName from '../components/FileName';
import { api, type AskThread, type ReviewList, type TreeFile, type User, type UserSettings } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/date';
import { IS_PC, IS_TOUCH } from '../lib/device';
import { kstToday, longDate } from '../lib/briefing';
import { btnClass } from './settings/SettingRow';
import BriefingPanel from './panels/BriefingPanel';

/** 이어 읽기에 보여 주는 최근 열람 수 · 최근 대화 수 */
const RECENT_FILES = 5;
const RECENT_THREADS = 3;

type Props = {
  user: User;
  settings: UserSettings;
  files: TreeFile[];
  onOpenFile: (file: TreeFile) => void;
  onOpenFileById: (id: number) => void;
  onOpenThread: (id: number | null) => void;
  /** AI 화면의 배움 카드 탭으로 */
  onOpenCards: () => void;
  onOpenPanel: (p: 'files' | 'shared') => void;
  onSearch: () => void;
  /** 알림함(SCR-103) — 폰 머리의 종. PC는 레일의 종이 맡는다 */
  unread: number;
  onOpenNotifications: () => void;
  onNewDoc: () => void;
  onOpenBriefingSettings: () => void;
  onOpenBriefingSources: () => void;
};

// SCR-101: 홈 — 로그인 직후·`/`의 첫 화면. 매일 들어오는 것(브리핑·복습)과 이어 갈 것(문서·대화)이 한 화면에 (IA — 안 B 홈)
export default function Home({ user, settings, files, onOpenFile, onOpenFileById, onOpenThread, onOpenCards, onOpenPanel, onSearch, unread, onOpenNotifications, onNewDoc, onOpenBriefingSettings, onOpenBriefingSources }: Props) {
  const isAdmin = user.role === 'admin';
  // 열람 계정(일반 사용자)은 관리자가 설정에서 골라 준 경우에만 브리핑이 있다 (v0.49)
  const briefingOwner = isAdmin ? null : (settings.briefingOwnerId ?? null);
  const hasBriefing = isAdmin || briefingOwner !== null;
  const [threads, setThreads] = useState<AskThread[] | null>(null);
  const [review, setReview] = useState<ReviewList | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);

  const loadReview = () => void api<ReviewList>('/cards/review').then(setReview).catch(() => setReview(null));
  useEffect(() => {
    void api<{ threads: AskThread[] }>('/ask/threads').then((r) => setThreads(r.threads)).catch(() => setThreads([]));
    loadReview();
    window.addEventListener('dv:cards-changed', loadReview);
    return () => window.removeEventListener('dv:cards-changed', loadReview);
  }, []);
  // 열람 계정: 누구의 브리핑인지 — 회차 목록 첫 쪽이 ownerName을 들고 온다 (API-135)
  useEffect(() => {
    if (!briefingOwner) return;
    void api<{ ownerName?: string | null }>('/briefing/editions').then((r) => setOwnerName(r.ownerName ?? null)).catch(() => {});
  }, [briefingOwner]);

  const recent = files
    .filter((f) => f.state.lastOpenedAt !== null)
    .sort((a, b) => (b.state.lastOpenedAt ?? 0) - (a.state.lastOpenedAt ?? 0))
    .slice(0, RECENT_FILES);

  // 아래 "오늘의 브리핑"과 같은 기준(한국 시각) — 자정 전후에 둘이 다른 날짜가 되지 않게
  const dateChip = longDate(kstToday());
  // 폰 A안: 섹션 이름은 묶음 카드 위 작은 이름, 목록은 카드 한 장 (PC는 그대로)
  const sectionTitle = IS_TOUCH ? 'mb-1.5 px-4 text-xs font-medium tracking-wide text-slate-500' : 'mb-2 text-sm font-bold text-slate-200';

  const startButtons = (
    <div className="grid max-w-sm grid-cols-2 gap-2">
      {[
        { label: '내 파일 보기', icon: 'files' as const, on: () => onOpenPanel('files') },
        { label: '함께 보는 파일', icon: 'users' as const, on: () => onOpenPanel('shared') },
        { label: '검색', icon: 'search' as const, on: onSearch },
        { label: '새 문서', icon: 'plus' as const, on: onNewDoc },
      ].map((b) => (
        <button key={b.label} onClick={b.on} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800 active:bg-slate-800 touch:border-0 touch:bg-panel">
          <Icon name={b.icon} size={18} />
          {b.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {IS_TOUCH ? (
        // 폰 A안: 큰 제목 + 날짜, 오른쪽 원형 돋보기
        <div className="flex items-end gap-3 px-4 pb-2 pt-1">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[30px] font-bold leading-tight tracking-tight">홈</h2>
          </div>
          <span className="mb-2 text-xs text-slate-500">{dateChip}</span>
          <button onClick={onOpenNotifications} className="relative mb-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fill text-slate-200 active:opacity-70" aria-label={unread > 0 ? `알림 ${unread}개` : '알림'}>
            <Icon name="bell" size={19} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent-400 px-1 text-center text-[10px] font-bold leading-4 text-ground" aria-hidden="true">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
          <button onClick={onSearch} className="mb-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fill text-accent-400 active:opacity-70" aria-label="검색">
            <Icon name="search" size={19} />
          </button>
        </div>
      ) : (
      <div className="flex min-w-0 items-center gap-2 px-4 py-3 pc:px-6">
        <h2 className="text-base font-bold">홈</h2>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">{dateChip}</span>
        <span className="ml-auto" />
        <button onClick={onSearch} className="flex min-h-9 items-center gap-1.5 rounded-md border border-slate-700 px-2.5 text-xs text-slate-300 hover:bg-slate-800 touch:min-h-11">
          <Icon name="search" size={14} />
          검색{IS_PC ? ' · Ctrl+K' : ''}
        </button>
      </div>
      )}
      {/* overflow-x-hidden·min-w-0: 긴 파일 이름이나 한 줄 글이 칸을 밀어 폰에서 가로 스크롤이 생기지 않게 (사용자 보고 2026-10-31) */}
      <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-4 pb-10 pc:px-6 touch:pt-2">
        <div className="grid max-w-5xl grid-cols-1 gap-8 pc:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] wide:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] touch:gap-6">
          <div className="min-w-0 space-y-8 touch:space-y-6">
            {hasBriefing && (
              <section>
                <h3 className={sectionTitle}>{briefingOwner ? `${ownerName ?? '관리자'}님의 브리핑` : '오늘의 브리핑'}</h3>
                {/* 패널 SCR-190에 있던 진행 카드·알림 띠·[지금 만들기]·오늘 카드가 그대로 이 섹션으로 — 바닥 한 줄에 다음 예약·비용·지난 브리핑 › */}
                {/* 폰 A안: 브리핑 섹션도 묶음 카드 한 장 — 안의 회차 카드는 한 단 더 채운 타일(bg-fill) */}
                <div className="touch:rounded-xl touch:bg-panel touch:px-4 touch:py-3">
                  <BriefingPanel home readOnly={!isAdmin} onOpenFile={onOpenFileById} onOpenSettings={onOpenBriefingSettings} onOpenSources={onOpenBriefingSources} />
                </div>
              </section>
            )}
            <section>
              <h3 className={sectionTitle}>이어 읽기</h3>
              {recent.length === 0 ? (
                <>
                  <p className="mb-3 text-xs text-slate-500 touch:px-4">아직 연 문서가 없어요. 어디서 시작할까요?</p>
                  {startButtons}
                </>
              ) : IS_TOUCH ? (
                <Group>
                  {recent.map((f) => (
                    <GroupRow key={f.id} icon={<Icon name={FILE_TYPE_ICON[f.fileType] ?? 'doc'} size={21} />} title={<FileName name={f.name} wrap />} subtitle={formatDateTime(f.state.lastOpenedAt!)} wrap onClick={() => onOpenFile(f)} />
                  ))}
                </Group>
              ) : (
                <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                  {recent.map((f) => (
                    // 이름 두 줄 규칙 — 잘리는 쪽은 늘 아랫줄 (2026-10-19)
                    <button key={f.id} onClick={() => onOpenFile(f)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-slate-900">
                      <span className="min-w-0 flex-1 text-sm text-slate-200"><FileName name={f.name} wrap /></span>
                      <span className="shrink-0 text-xs text-slate-500">{formatDateTime(f.state.lastOpenedAt!)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
          <div className="min-w-0 space-y-8 touch:space-y-6">
            {review && review.total > 0 && (
              // SCR-186 복습 띠 — 0장이어도 카드 입구로 남긴다 (폰 감사 2026-10-31)
              <section className="flex items-center gap-2 rounded-xl border border-card-900 bg-card-950/40 px-3 py-2.5 text-sm touch:min-h-12 touch:border-0 touch:bg-panel touch:px-4">
                {review.due.length > 0 ? (
                  <span className="text-slate-200">오늘 복습 <b className="text-card-300">{review.due.length}장</b>{review.tomorrow > 0 ? ` · 내일 ${review.tomorrow}장` : ''}</span>
                ) : (
                  <button onClick={onOpenCards} className="text-left text-slate-400 hover:text-slate-200">오늘 복습 없음 · 카드 {review.total}장 ›</button>
                )}
                {review.due.length > 0 && (
                  <button onClick={() => setReviewOpen(true)} className="ml-auto min-h-9 rounded-md bg-card-600 px-3 font-medium text-white hover:bg-card-500 touch:min-h-11">
                    시작
                  </button>
                )}
              </section>
            )}
            <section>
              <div className={`flex items-center ${IS_TOUCH ? 'mb-1.5 px-4' : 'mb-2'}`}>
                <h3 className={`flex-1 ${IS_TOUCH ? 'text-xs font-medium tracking-wide text-slate-500' : 'text-sm font-bold text-slate-200'}`}>최근 대화</h3>
                <button onClick={() => onOpenThread(null)} className={IS_TOUCH ? 'text-xs text-accent-400' : `${btnClass} min-h-8 text-xs`}>+ 새 대화</button>
              </div>
              {threads && threads.length === 0 && <p className="text-xs text-slate-500 touch:px-4">아직 대화가 없어요. 무엇이든 물어보세요.</p>}
              {threads && threads.length > 0 && IS_TOUCH && (
                <Group>
                  {threads.slice(0, RECENT_THREADS).map((t) => (
                    <GroupRow
                      key={t.id}
                      icon={<Icon name={t.fileId !== null || t.fileName ? 'doc' : 'chat'} size={21} />}
                      title={cleanTitle(t.title)}
                      subtitle={`${formatDate(t.updatedAt)} · ${t.fileId !== null || t.fileName ? (t.fileName ?? '문서') : '자유 대화'}`}
                      onClick={() => onOpenThread(t.id)}
                    />
                  ))}
                </Group>
              )}
              {threads && threads.length > 0 && !IS_TOUCH && (
                <div className="divide-y divide-slate-800 rounded-xl border border-slate-800">
                  {threads.slice(0, RECENT_THREADS).map((t) => (
                    <button key={t.id} onClick={() => onOpenThread(t.id)} className="block w-full px-3 py-2 text-left transition hover:bg-slate-900">
                      <span className="block truncate text-sm text-slate-200">{cleanTitle(t.title)}</span>
                      <span className="flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
                        <span className="shrink-0">{formatDate(t.updatedAt)} ·</span>
                        <Icon name={t.fileId !== null || t.fileName ? 'doc' : 'chat'} size={11} className="shrink-0" />
                        <span className="truncate">{t.fileId !== null || t.fileName ? (t.fileName ?? '문서') : '자유 대화'}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
      {reviewOpen && review && (
        <ReviewDialog
          due={review.due}
          tomorrow={review.tomorrow}
          isPc={IS_PC}
          onClose={() => setReviewOpen(false)}
          onGraded={loadReview}
          onOpenCard={(f) => {
            setReviewOpen(false);
            onOpenFile(f);
          }}
        />
      )}
    </div>
  );
}
