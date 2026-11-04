import { api } from './api';

// 웹 푸시 — 이 기기를 서버에 등록하고 푸는 쪽 (알림 2단계 2026-11-04).
// 권한 요청과 구독은 반드시 사용자가 단추를 누른 그 호출 안에서 한다 — 밖에서 부르면 브라우저가 조용히 거절한다.

export type PushDevice = { id: number; endpoint: string; label: string; createdAt: number; lastSentAt: number | null };

export type PushSupport =
  | 'ok'
  /** 브라우저가 푸시를 모른다 (옛 사파리·인앱 브라우저) */
  | 'unsupported'
  /** 아이폰·아이패드인데 홈 화면 앱이 아니다 — iOS는 홈 화면에 추가한 앱에서만 푸시를 허용한다 (16.4+) */
  | 'ios-not-installed'
  /** 사용자가 이미 거부했다 — 브라우저 설정에서 풀어야 한다 */
  | 'denied';

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS() && !isStandalone() ? 'ios-not-installed' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

/** 홈 화면·설정 어디서든 한 번만 등록 — 두 번 불러도 같은 등록을 돌려준다 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> | null {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js').catch((e: unknown) => {
    console.warn('[push] service worker 등록 실패', e);
    throw e;
  });
}

/** 이 브라우저가 지금 들고 있는 구독 (서버 등록 여부와 별개) */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** 설정 화면의 기기 이름 — UA를 사람이 읽게 ("iPhone · Safari") */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux PC' : '기기';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? '삼성 브라우저' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '브라우저';
  return `${device} · ${browser}${isStandalone() ? ' (홈 화면 앱)' : ''}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

/** 켜기 — 권한 → 구독 → 서버 등록. 사용자 클릭 안에서만 부른다 */
export async function enablePush(): Promise<{ id: number }> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('알림 권한을 허용해야 켤 수 있어요');
  const reg = await (registerServiceWorker() ?? Promise.reject(new Error('이 브라우저는 푸시를 지원하지 않아요')));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/notifications/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) as BufferSource });
    } catch {
      // 시크릿 창, 푸시 서비스에 못 닿는 브라우저, 회사 정책으로 막힌 경우 — 브라우저 오류 문구는 사람이 읽을 글이 아니다
      throw new Error('브라우저가 구독을 거절했어요. 시크릿 창이거나 푸시가 막힌 브라우저예요');
    }
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('브라우저가 구독 정보를 주지 않았어요');
  const r = await api<{ device: { id: number } }>('/notifications/push/devices', {
    method: 'POST',
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, label: deviceLabel() }),
  });
  return r.device;
}

/** 끄기 — 브라우저 구독을 풀고 서버에서도 지운다 */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api('/notifications/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
}
