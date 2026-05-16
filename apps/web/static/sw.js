/**
 * CCTV Dashboard Service Worker
 *
 * WebPush 알림 수신 및 클릭 처리.
 * - push: 수신 payload -> showNotification
 * - notificationclick: 클릭 시 /alerts 또는 data.url 열기
 */

self.addEventListener('push', (event) => {
  let title = 'CCTV 알림';
  let body = '새로운 감지 이벤트가 있습니다.';
  let data = {};

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title ?? title;
      body = payload.body ?? body;
      data = payload.data ?? {};
    } catch {
      body = event.data.text();
    }
  }

  const options = {
    body,
    data,
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: 'cctv-alert',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url ?? '/alerts';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    }),
  );
});
