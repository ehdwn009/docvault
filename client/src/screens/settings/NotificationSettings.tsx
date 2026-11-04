import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/date';
import { currentSubscription, disablePush, enablePush, pushSupport, type PushDevice, type PushSupport } from '../../lib/push';
import { rowId } from './catalog';
import SettingRow, { btnClass, Switch } from './SettingRow';

// SCR-406: 알림 — 이 기기의 푸시 켜고 끄기, 푸시 받는 기기 목록, 시험 알림 (알림 2단계 2026-11-04).
// 알림 종류별 켜고 끄기·조용한 시간은 3단계에서.

const SUPPORT_DESC: Record<PushSupport, string> = {
  ok: '앱을 닫아도 이 기기에 알림이 떠요. 처음 켤 때 브라우저가 허용을 물어요',
  'ios-not-installed': '아이폰은 홈 화면에 추가한 앱에서만 푸시를 허용해요. 사파리 공유 → "홈 화면에 추가"로 설치한 뒤 거기서 켜 주세요',
  unsupported: '이 브라우저는 푸시를 지원하지 않아요. 크롬·엣지·사파리(홈 화면 앱)에서 켤 수 있어요',
  denied: '이 브라우저에서 알림이 차단되어 있어요. 브라우저의 사이트 설정에서 알림을 허용한 뒤 다시 켜 주세요',
};

export default function NotificationSettings() {
  const [support] = useState<PushSupport>(() => pushSupport());
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, sub] = await Promise.all([api<{ devices: PushDevice[] }>('/notifications/push/devices'), currentSubscription().catch(() => null)]);
      setDevices(r.devices);
      setThisEndpoint(sub?.endpoint ?? null);
    } catch {
      setError('기기 목록을 불러오지 못했어요');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // "이 기기 켜짐" = 브라우저가 구독을 들고 있고, 서버 목록에도 같은 주소가 있을 때
  const thisOn = thisEndpoint !== null && (devices?.some((d) => d.endpoint === thisEndpoint) ?? false);

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
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : '켜지 못했어요');
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
      setError(e instanceof ApiError ? e.message : '보내지 못했어요');
      await load();
    }
  }

  async function remove(id: number) {
    setError(null);
    try {
      const d = devices?.find((x) => x.id === id);
      // 이 기기면 브라우저 쪽 구독도 함께 푼다 — 서버만 지우면 브라우저는 계속 구독 중이라 다시 켤 때 헷갈린다
      if (d && d.endpoint === thisEndpoint) await disablePush();
      else await api(`/notifications/push/devices/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '끊지 못했어요');
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

      <SettingRow
        id={rowId('notifications', 'kinds')}
        title="어떤 알림이 오나요"
        desc="브리핑이 도착했을 때, 브리핑을 만들지 못했을 때. 종류별로 끄기와 조용한 시간은 다음 단계에서 생겨요"
      />

      {(note || error) && (
        <p role="status" className={`pt-2 text-xs ${error ? 'text-danger-400' : 'text-good-400'}`}>
          {error ?? note}
        </p>
      )}
    </>
  );
}
