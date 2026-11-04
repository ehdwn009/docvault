// 서비스 워커 — 웹 푸시 전용 (알림 2단계 2026-11-04).
// 일부러 아무것도 캐시하지 않는다: 오프라인 앱이 아니라 "앱이 닫혀 있어도 푸시를 받는 귀" 하나만 맡는다.
// 캐시를 들이면 배포 뒤 옛 화면이 남는 문제가 따라오는데, 그 값을 치를 이유가 아직 없다.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Loft', body: '', url: '/', tag: undefined };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // 본문이 JSON이 아니면 제목만
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title, {
        body: data.body || undefined,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag,
        data: { url: data.url },
      });
      // 앱이 열려 있으면 알림함도 바로 새로고침하라고 알린다
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) w.postMessage({ type: 'dv:push' });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // 이미 열린 창이 있으면 그 창을 앞으로 가져와 그 자리로 — 창을 또 열지 않는다
      for (const w of wins) {
        if ('focus' in w) {
          await w.focus();
          if ('navigate' in w) {
            try {
              await w.navigate(url);
              return;
            } catch {
              // iOS 등 navigate를 못 쓰는 곳 — 앱에게 열어 달라고 쪽지
            }
          }
          w.postMessage({ type: 'dv:open', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
