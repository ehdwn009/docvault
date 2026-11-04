import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNotifications, markNotificationsRead, type Notification } from './api';
import { NOTIFICATION_POLL_MS } from './constants';

// 알림함 상태 한 곳 — 종 배지(unread)와 목록이 같은 응답을 쓴다 (API-160).
// 1단계는 푸시 없이 주기적으로 묻는다: 탭이 보일 때만, 다시 보이게 되면 바로 한 번.
export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await fetchNotifications();
      setItems(r.notifications);
      setUnread(r.unread);
    } catch {
      // 네트워크 잠깐 끊김은 다음 주기에 다시 — 알림은 틀려도 되는 정보
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(tick, NOTIFICATION_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    // 서비스 워커가 푸시를 받으면 쪽지를 보낸다 — 1분을 기다리지 않고 배지를 올린다 (알림 2단계)
    const onMessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object' && (e.data as { type?: string }).type === 'dv:push') void refresh();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [enabled, refresh]);

  /** 읽음 — 화면은 먼저 바꾸고 서버에 알린다 (눌렀는데 점이 그대로면 안 눌린 줄 안다) */
  const markRead = useCallback(async (ids?: number[]) => {
    const now = Date.now();
    setItems((list) => list.map((n) => (n.readAt === null && (!ids || ids.includes(n.id)) ? { ...n, readAt: now } : n)));
    setUnread((u) => (ids ? Math.max(0, u - ids.length) : 0));
    try {
      const r = await markNotificationsRead(ids);
      setUnread(r.unread);
    } catch {
      void refresh();
    }
  }, [refresh]);

  return { items, unread, refresh, markRead };
}
