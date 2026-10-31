import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import type { TreeFile, User, UserSettings } from '../../lib/api';
import { IS_TOUCH } from '../../lib/device';
import AdminPanel from '../panels/AdminPanel';
import AboutSettings from './AboutSettings';
import AccountSettings from './AccountSettings';
import BriefingSettings from './BriefingSettings';
import CardsSettings from './CardsSettings';
import { CATEGORY_BY_ID, isAdminCategory, rowId, SETTINGS_INDEX, SETTINGS_SECTIONS, type SettingsCategoryId, type SettingsTarget } from './catalog';
import DisplaySettings from './DisplaySettings';
import FirstConnect from './FirstConnect';
import ReadersSettings from './ReadersSettings';
import SubscriptionSettings from './SubscriptionSettings';

type Props = {
  user: User;
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  /** 다른 화면에서 "그 항목으로" 들어왔다 — 바뀔 때마다 그 카테고리를 열고 항목으로 내린다 */
  target: SettingsTarget | null;
  onShowChangelog: () => void;
  onShowShortcuts: () => void;
  onOpenBriefingSources: () => void;
  onSelectFile: (file: TreeFile) => void;
  onLogout: () => void;
  onClose: () => void;
};

// SCR-140 (개정): "나" — 본문 전체를 쓰는 설정 페이지. 왼쪽 카테고리(내 취향 / 앱 운영 / 정보), 오른쪽 항목들.
// 머리에 설정 검색(SCR-405). 폰은 목록 → 상세 2단 푸시 (IA — 안 B "나")
export default function SettingsPage({ user, settings, onChange, target, onShowChangelog, onShowShortcuts, onOpenBriefingSources, onSelectFile, onLogout, onClose }: Props) {
  const isAdmin = user.role === 'admin';
  // 폰은 처음에 목록만(null), PC는 첫 카테고리를 바로 연다
  const [category, setCategory] = useState<SettingsCategoryId | null>(() => target?.category ?? (IS_TOUCH ? null : 'display'));
  const [query, setQuery] = useState('');
  const [firstConnectOpen, setFirstConnectOpen] = useState(false);
  /** 바로 가기로 들어온 항목 — 잠깐 테두리를 밝혀 눈이 가게 */
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setCategory(target.category);
    setFirstConnectOpen(false);
    setQuery('');
    if (target.item) goToItem(target.category, target.item);
  }, [target]);

  function goToItem(cat: SettingsCategoryId, item: string) {
    setCategory(cat);
    setQuery('');
    const domId = rowId(cat, item);
    // 카테고리 본문이 그려진(그리고 데이터가 온) 뒤에 내린다
    window.setTimeout(() => {
      document.getElementById(domId)?.scrollIntoView({ block: 'center' });
      setFlash(domId);
      window.setTimeout(() => setFlash((f) => (f === domId ? null : f)), 1600);
    }, 150);
  }

  useEffect(() => {
    if (!flash) return;
    const el = document.getElementById(flash);
    el?.classList.add('ring-1', 'ring-accent-500', 'rounded-md');
    return () => el?.classList.remove('ring-1', 'ring-accent-500', 'rounded-md');
  }, [flash]);

  const q = query.trim().toLowerCase();
  const results = q ? SETTINGS_INDEX.filter((e) => (!e.admin || isAdmin) && `${e.title} ${e.desc} ${CATEGORY_BY_ID[e.category].name}`.toLowerCase().includes(q)) : [];

  const roleChip = <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">{isAdmin ? 'Administrator' : '일반'}</span>;

  const searchBox = (
    <label className="relative block">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"><Icon name="search" size={16} /></span>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="설정 검색"
        aria-label="설정 검색"
        className="min-h-11 w-full rounded-md border border-slate-700 bg-slate-900 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-slate-400"
      />
    </label>
  );

  const categoryList = (
    <nav className="flex flex-col gap-4">
      {SETTINGS_SECTIONS.filter((s) => !s.admin || isAdmin).map((s) => (
        <div key={s.title}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.title}</p>
          {s.items.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCategory(c.id);
                setFirstConnectOpen(false);
              }}
              aria-current={category === c.id ? 'page' : undefined}
              className={`flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm transition ${
                category === c.id && !IS_TOUCH ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
              }`}
            >
              {c.name}
              {IS_TOUCH && <span className="ml-auto text-slate-600"><Icon name="chevron" size={16} /></span>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );

  const resultList = (
    <div className="flex flex-col gap-1">
      {results.length === 0 && <p className="px-3 py-6 text-sm text-slate-500">"{query}"에 맞는 설정이 없어요</p>}
      {results.map((e) => (
        <button key={`${e.category}.${e.item}`} onClick={() => goToItem(e.category, e.item)} className="rounded-md px-3 py-2 text-left transition hover:bg-slate-900">
          <p className="text-sm text-slate-200">
            {e.title} <span className="text-xs text-slate-500">· {CATEGORY_BY_ID[e.category].name}</span>
          </p>
          <p className="text-xs text-slate-500">{e.desc}</p>
        </button>
      ))}
    </div>
  );

  function content(cat: SettingsCategoryId) {
    if (isAdminCategory(cat) && !isAdmin) return null;
    switch (cat) {
      case 'display': return <DisplaySettings settings={settings} onChange={onChange} onShowShortcuts={onShowShortcuts} />;
      case 'cards': return <CardsSettings settings={settings} onChange={onChange} />;
      case 'account': return <AccountSettings user={user} openPassword={target?.category === 'account' && target.item === 'password'} onLogout={onLogout} />;
      case 'briefing': return <BriefingSettings onOpenSources={onOpenBriefingSources} onOpenSubscription={() => setCategory('subscription')} />;
      case 'subscription': return <SubscriptionSettings onOpenFirstConnect={() => setFirstConnectOpen(true)} />;
      case 'readers': return <ReadersSettings onOpenUsers={() => setCategory('users')} />;
      case 'users': case 'stats': case 'tree': case 'ai': case 'perf':
        return <AdminPanel tab={cat} meId={user.id} onSelectFile={onSelectFile} />;
      case 'about': return <AboutSettings onShowChangelog={onShowChangelog} />;
    }
  }

  const closeBtn = (
    <button onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="설정 닫기">
      <Icon name="close" size={18} />
    </button>
  );

  // ── 폰: 목록 → 상세 2단 푸시 ──
  if (IS_TOUCH) {
    if (category !== null && firstConnectOpen) return <FirstConnect onClose={() => setFirstConnectOpen(false)} />;
    if (category === null || q) {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* pl-14: 떠 있는 ☰ 자리 */}
          <div className="flex items-center gap-2 py-2 pl-14 pr-2">
            <h2 className="text-base font-bold">나</h2>
            {roleChip}
            <span className="ml-auto" />
            {closeBtn}
          </div>
          <div className="px-4 pb-2">{searchBox}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">{q ? resultList : categoryList}</div>
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 py-2 pl-14 pr-2">
          <button onClick={() => setCategory(null)} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-slate-300 hover:bg-slate-800" aria-label="나로 돌아가기">‹ 나</button>
          <h2 className="truncate text-base font-bold">{CATEGORY_BY_ID[category].name}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">{content(category)}</div>
      </div>
    );
  }

  // ── PC: 왼쪽 카테고리 + 오른쪽 본문 ──
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-60 shrink-0 flex-col border-r border-slate-800">
        <div className="flex items-center gap-2 px-4 py-3">
          <h2 className="text-base font-bold">나</h2>
          {roleChip}
        </div>
        <div className="px-3 pb-3">{searchBox}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{q ? resultList : categoryList}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {firstConnectOpen && category === 'subscription' ? (
          <FirstConnect onClose={() => setFirstConnectOpen(false)} />
        ) : (
          <>
            <div className="flex items-center gap-2 px-6 py-3">
              <h2 className="text-base font-semibold text-slate-100">{category ? CATEGORY_BY_ID[category].name : ''}</h2>
              <span className="ml-auto" />
              {closeBtn}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
              <div className="max-w-3xl">{category && content(category)}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
