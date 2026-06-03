/**
 * WebPush 구독 유틸리티.
 *
 * 브라우저에서만 사용 가능 (ServiceWorker API 의존).
 * SSR 환경에서 import는 가능하나 런타임 호출은 브라우저에서만 해야 한다.
 */

/**
 * Base64URL 문자열을 Uint8Array로 변환한다.
 * VAPID public key 변환에 사용하는 순수 함수.
 *
 * @param base64String - Base64URL 인코딩된 문자열
 * @returns Uint8Array
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Service Worker를 등록하고 WebPush 구독을 생성한다.
 *
 * 1. Service Worker 등록 (/sw.js)
 * 2. VAPID public key 취득 (GET /api/alerts/webpush/vapid-public-key)
 * 3. pushManager.subscribe()
 * 4. 구독 정보 서버에 전송 (POST /api/alerts/webpush/subscribe)
 *
 * @param fetchFn - event.fetch 또는 window.fetch
 * @returns PushSubscription
 */
export async function subscribeWebPush(fetchFn: typeof fetch): Promise<PushSubscription> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('Service Worker를 지원하지 않는 환경입니다');
  }

  // 1. Service Worker 등록
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  // 2. VAPID public key 취득
  const keyRes = await fetchFn('/api/alerts/webpush/vapid-public-key');
  if (!keyRes.ok) {
    throw new Error(`VAPID public key 취득 실패: HTTP ${keyRes.status}`);
  }
  const keyData = (await keyRes.json()) as { vapidPublicKey?: string; publicKey?: string };
  const vapidPublicKey = keyData.vapidPublicKey ?? keyData.publicKey;
  if (!vapidPublicKey) {
    throw new Error('VAPID public key 응답 형식 오류');
  }
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer;

  // 3. pushManager.subscribe
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  // 4. 구독 정보 서버 전송
  const subRes = await fetchFn('/api/alerts/webpush/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!subRes.ok) {
    throw new Error(`WebPush 구독 등록 실패: HTTP ${subRes.status}`);
  }

  return subscription;
}

/**
 * 현재 WebPush 구독을 해제하고 서버에 삭제 요청을 보낸다.
 *
 * @param fetchFn - event.fetch 또는 window.fetch
 */
export async function unsubscribeWebPush(fetchFn: typeof fetch): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!registration) return;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;

  await subscription.unsubscribe();

  // 서버에 구독 삭제 요청
  await fetchFn('/api/alerts/webpush/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {
    // 서버 삭제 실패는 무시 (이미 브라우저 측 해제 완료)
  });
}

/**
 * 현재 WebPush 구독 상태를 반환한다.
 *
 * @returns PushSubscription | null
 */
export async function getWebPushSubscription(): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!registration) return null;

  return registration.pushManager.getSubscription();
}
