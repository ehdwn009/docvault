import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, NOTIFICATION_KINDS, type NotificationKind, type NotifyPrefs, type QuietHours, type TelegramStatus, type User, type UserSettings } from '../../lib/api';
import { formatDateTime } from '../../lib/date';
import { currentSubscription, disablePush, enablePush, pushSupport, type PushDevice, type PushSupport } from '../../lib/push';
import { rowId } from './catalog';
import SettingRow, { btnClass, Switch } from './SettingRow';

// SCR-406: 알림 — 이 기기의 푸시(2단계), 받을 알림 종류·조용한 시간·텔레그램(3단계 2026-11-05).
// 종류를 끄면 알림함에도 안 쌓이고, 조용한 시간은 푸시·텔레그램만 보류한다(알림함엔 그대로).

type Props = {
  user: User;
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
};

const SUPPORT_DESC: Record<PushSupport, string> = {
  ok: '앱을 닫아도 이 기기에 알림이 떠요. 처음 켤 때 브라우저가 허용을 물어요',
  'ios-not-installed': '아이폰은 홈 화면에 추가한 앱에서만 푸시를 허용해요. 사파리 공유 → "홈 화면에 추가"로 설치한 뒤 거기서 켜 주세요',
  unsupported: '이 브라우저는 푸시를 지원하지 않아요. 크롬·엣지·사파리(홈 화면 앱)에서 켤 수 있어요',
  denied: '이 브라우저에서 알림이 차단되어 있어요. 브라우저의 사이트 설정에서 알림을 허용한 뒤 다시 켜 주세요',
};

const KIND_LABEL: Record<NotificationKind, { title: string; desc: string }> = {
  briefing_ready: { title: '브리핑이 나왔을 때', desc: '자동·구독 회차가 만들어지면' },
  briefing_missing: { title: '브리핑을 만들지 못했을 때', desc: '마감까지 완성본이 안 오거나 자동 실행이 실패하면 (관리자)' },
  upload_done: { title: '오래 걸린 올리기가 끝났을 때', desc: '10초 넘게 걸린 올리기만' },
  export_done: { title: '내보내기가 끝났을 때', desc: 'ZIP이 만들어져 받을 수 있게 되면' },
};

const QUIET_DEFAULT: QuietHours = { enabled: 1, start: '23:00', end: '06:30' };

export default function NotificationSettings({ user, settings, onChange }: Props) {
  const [support] = useState<PushSupport>(() => pushSupport());
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [botToken, setBotToken] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, sub, tg] = await Promise.all([
        api<{ devices: PushDevice[] }>('/notifications/push/devices'),
        currentSubscription().catch(() => null),
        api<TelegramStatus>('/notifications/telegram'),
      ]);
      setDevices(r.devices);
      setThisEndpoint(sub?.endpoint ?? null);
      setTelegram(tg);
    } catch {
      setError('알림 설정을 불러오지 못했어요');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // 연결 링크를 띄워 둔 동안 5초마다 연결됐는지 본다 — 봇이 /start를 받으면 linked가 true로
  useEffect(() => {
    if (!link || telegram?.linked) return;
    const t = window.setInterval(() => void api<TelegramStatus>('/notifications/telegram').then(setTelegram).catch(() => {}), 5000);
    return () => window.clearInterval(t);
  }, [link, telegram?.linked]);
  useEffect(() => {
    if (telegram?.linked) setLink(null);
  }, [telegram?.linked]);

  const thisOn = thisEndpoint !== null && (devices?.some((d) => d.endpoint === thisEndpoint) ?? false);

  const report = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback);

  async function toggleThis(on: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (on) {
        await enablePush();
        setNote('켰어요. 아래 [시험 알림]으로 확인해 보세요');
      } else {
        await disablePush();
      }
      await load();
    } catch (e) {
      report(e, '켜지 못했어요');
    } finally {
      setBusy(false);
    }
  }

  async function test(id: number) {
    setError(null);
    setNote(null);
    try {
      await api(`/notifications/push/devices/${id}/test`, { method: 'POST' });
      setNote('보냈어요. 잠시 뒤 알림이 뜨면 성공');
    } catch (e) {
      report(e, '보내지 못했어요');
      await load();
    }
  }

  async function remove(id: number) {
    setError(null);
    try {
      const d = devices?.find((x) => x.id === id);
      if (d && d.endpoint === thisEndpoint) await disablePush();
      else await api(`/notifications/push/devices/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      report(e, '끊지 못했어요');
    }
  }

  const prefs: NotifyPrefs = settings.notifyPrefs ?? {};
  const setKind = (kind: NotificationKind, on: boolean) => onChange({ notifyPrefs: { ...prefs, [kind]: on ? 1 : 0 } });

  const quiet = settings.quietHours;
  const setQuiet = (patch: Partial<QuietHours>) => onChange({ quietHours: { ...(quiet ?? QUIET_DEFAULT), ...patch } });

  async function tgLink() {
    setError(null);
    try {
      const r = await api<{ url: string; expiresAt: number }>('/notifications/telegram/link', { method: 'POST' });
      setLink(r);
    } catch (e) {
      report(e, '연결 링크를 만들지 못했어요');
    }
  }
  async function tgUnlink() {
    setError(null);
    try {
      await api('/notifications/telegram/unlink', { method: 'POST' });
      setLink(null);
      await load();
    } catch (e) {
      report(e, '끊지 못했어요');
    }
  }
  async function tgTest() {
    setError(null);
    setNote(null);
    try {
      await api('/notifications/telegram/test', { method: 'POST' });
      setNote('텔레그램으로 보냈어요');
    } catch (e) {
      report(e, '보내지 못했어요');
    }
  }
  async function saveBot() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api('/notifications/telegram/bot', { method: 'PUT', body: JSON.stringify({ token: botToken }) });
      setBotToken('');
      setNote('봇을 연결했어요. 이제 아래 [연결]로 각자 자기 텔레그램을 이을 수 있어요');
      await load();
    } catch (e) {
      report(e, '봇을 연결하지 못했어요');
    } finally {
      setBusy(false);
    }
  }
  async function clearBot() {
    setError(null);
    try {
      await api('/notifications/telegram/bot', { method: 'DELETE' });
      await load();
    } catch (e) {
      report(e, '끊지 못했어요');
    }
  }

  return (
    <>
      <SettingRow id={rowId('notifications', 'thisDevice')} title="이 기기에서 푸시 받기" desc={SUPPORT_DESC[support]}>
        <Switch checked={thisOn} onChange={(v) => void toggleThis(v)} disabled={busy || support !== 'ok' || devices === null} label="이 기기에서 푸시 받기" />
      </SettingRow>

      <SettingRow
        id={rowId('notifications', 'devices')}
        title="푸시 받는 기기"
        desc="켜 둔 기기마다 한 줄. 안 쓰는 기기는 끊어 두세요 — 푸시 서버가 더는 못 찾는 기기는 알아서 빠져요"
        below={
          devices === null ? (
            <p className="text-xs text-slate-500">불러오는 중…</p>
          ) : devices.length === 0 ? (
            <p className="text-xs text-slate-500">아직 없어요. 위 스위치를 켜면 이 기기가 들어와요</p>
          ) : (
            <ul className="divide-y divide-slate-800/70 rounded-lg border border-slate-800">
              {devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm text-slate-200">
                      {d.label}
                      {d.endpoint === thisEndpoint && <span className="ml-1.5 rounded bg-accent-500/15 px-1.5 py-0.5 text-[11px] text-accent-400">이 기기</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(d.createdAt)} 연결{d.lastSentAt ? ` · 마지막 전송 ${formatDateTime(d.lastSentAt)}` : ''}
                    </p>
                  </div>
                  <button onClick={() => void test(d.id)} className={btnClass}>
                    시험 알림
                  </button>
                  <button onClick={() => void remove(d.id)} className={`${btnClass} text-danger-400 hover:bg-danger-950/40`}>
                    끊기
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      />

      {/* 받을 알림 — 끄면 알림함에도 안 쌓인다 */}
      {NOTIFICATION_KINDS.filter((k) => k !== 'briefing_missing' || user.role === 'admin').map((kind) => (
        <SettingRow key={kind} id={rowId('notifications', kind)} title={KIND_LABEL[kind].title} desc={KIND_LABEL[kind].desc}>
          <Switch checked={prefs[kind] !== 0} onChange={(v) => setKind(kind, v)} label={KIND_LABEL[kind].title} />
        </SettingRow>
      ))}

      <SettingRow
        id={rowId('notifications', 'quiet')}
        title="조용한 시간"
        desc="이 사이엔 푸시와 텔레그램을 보내지 않아요. 알림함엔 그대로 쌓이고, 끝나면 한 통으로 묶어서 와요"
        below={
          quiet?.enabled ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <label className="flex items-center gap-2">
                시작
                <input id="set-notifications-quiet-start" type="time" value={quiet.start} onChange={(e) => setQuiet({ start: e.target.value })} className="rounded-md border border-slate-700 bg-ground px-2 py-1 text-sm text-slate-100" />
              </label>
              <label className="flex items-center gap-2">
                끝
                <input id="set-notifications-quiet-end" type="time" value={quiet.end} onChange={(e) => setQuiet({ end: e.target.value })} className="rounded-md border border-slate-700 bg-ground px-2 py-1 text-sm text-slate-100" />
              </label>
              <span className="text-xs text-slate-500">한국 시간 기준</span>
            </div>
          ) : undefined
        }
      >
        <Switch checked={!!quiet?.enabled} onChange={(v) => setQuiet({ enabled: v ? 1 : 0 })} label="조용한 시간" />
      </SettingRow>

      {/* 텔레그램 — 봇은 앱에 하나(관리자), 연결은 각자 */}
      <SettingRow
        id={rowId('notifications', 'telegram')}
        title="텔레그램으로도 받기"
        desc={
          telegram === null
            ? '불러오는 중…'
            : !telegram.bot.configured
              ? user.role === 'admin'
                ? '텔레그램 BotFather에서 봇을 만들고 받은 토큰을 아래에 넣으면 켜져요. 제목·한 줄만 보내고 문서 내용은 보내지 않아요'
                : '관리자가 아직 봇을 연결하지 않았어요'
              : telegram.linked
                ? `@${telegram.bot.username} 봇과 연결되어 있어요. 제목·한 줄만 보내고 문서 내용은 보내지 않아요`
                : `[연결]을 누르면 @${telegram.bot.username} 봇 링크가 떠요. 링크를 열고 "시작"을 누르면 끝`
        }
        below={
          <div className="space-y-3">
            {user.role === 'admin' && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="set-notifications-bot-token"
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder={telegram?.bot.configured ? `@${telegram.bot.username} 연결됨 — 바꾸려면 새 토큰` : '123456789:AAxxxxxxxx… (BotFather 토큰)'}
                  autoComplete="off"
                  className="min-h-11 min-w-0 flex-1 basis-64 rounded-md border border-slate-700 bg-ground px-3 text-sm text-slate-100 placeholder:text-slate-600"
                />
                <button onClick={() => void saveBot()} disabled={busy || botToken.trim().length < 20} className={btnClass}>
                  봇 저장
                </button>
                {telegram?.bot.configured && (
                  <button onClick={() => void clearBot()} className={`${btnClass} text-danger-400 hover:bg-danger-950/40`}>
                    봇 끊기
                  </button>
                )}
              </div>
            )}
            {link && !telegram?.linked && (
              <div className="rounded-lg border border-accent-800 bg-accent-950/30 px-3 py-2 text-sm">
                <a href={link.url} target="_blank" rel="noreferrer" className="font-semibold text-accent-400 underline underline-offset-2">
                  텔레그램에서 봇 열기
                </a>
                <p className="mt-1 text-xs text-slate-400">열리면 "시작"을 누르세요. 10분 안에 누르면 이 화면이 저절로 "연결됨"으로 바뀌어요</p>
              </div>
            )}
          </div>
        }
      >
        {telegram?.bot.configured &&
          (telegram.linked ? (
            <>
              <button onClick={() => void tgTest()} className={btnClass}>
                시험 메시지
              </button>
              <button onClick={() => void tgUnlink()} className={`${btnClass} text-danger-400 hover:bg-danger-950/40`}>
                끊기
              </button>
            </>
          ) : (
            <button onClick={() => void tgLink()} className={btnClass}>
              {link ? '링크 다시 만들기' : '연결'}
            </button>
          ))}
      </SettingRow>

      {(note || error) && (
        <p role="status" className={`pt-2 text-xs ${error ? 'text-danger-400' : 'text-good-400'}`}>
          {error ?? note}
        </p>
      )}
    </>
  );
}
