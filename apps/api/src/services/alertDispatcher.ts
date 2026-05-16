// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M2-2 — Alert Dispatcher 서비스.
 *
 * 책임:
 *   - REQ-ALERT-004: SSE 클라이언트 레지스트리 관리 + 토스트 알림 푸시
 *   - REQ-ALERT-006: WebPush 발송 (web-push VAPID)
 *   - REQ-ALERT-007: Telegram sendMessage HTTP 호출
 *
 * 설계 원칙:
 *   - 각 채널은 독립적 — 하나 실패해도 다른 채널 계속 진행
 *   - ENV 미설정 시 해당 채널 graceful skip (서버 오류 없음)
 *   - SSE: Map<userId, Set<controller>> — 다중 탭 지원
 *   - 팩토리 함수 패턴 (createAlertDispatcher) — 테스트 용이성
 */

import type { Db, NewDetectionAlert } from '@cctv/db';

// ---------------------------------------------------------------------------
// 공개 타입
// ---------------------------------------------------------------------------

/** alertDispatcher 의존성 주입 컨테이너 */
export type AlertDispatcherDeps = {
  /** Drizzle DB 인스턴스 */
  db: Db;
  /** web-push 라이브러리 인스턴스 (null 이면 WebPush 비활성) */
  webPush: typeof import('web-push') | null;
  /** Telegram Bot 토큰 (null 이면 Telegram 비활성) */
  telegramToken: string | null;
  /** 테스트 용도 — fetch 구현 주입 */
  fetch?: typeof globalThis.fetch;
};

/** AlertDispatcher 공개 인터페이스 */
export type AlertDispatcher = {
  /**
   * SSE 클라이언트 등록.
   * @returns unregister 함수 — 연결 종료 시 호출
   */
  registerSSEClient(userId: string, controller: ReadableStreamDefaultController): () => void;

  /**
   * 특정 사용자에게 알림 발송.
   * 사용자의 alert_destinations 설정에 따라 SSE / WebPush / Telegram 채널 활성화.
   */
  dispatch(userId: string, alert: NewDetectionAlert): Promise<void>;

  /**
   * 모든 등록된 SSE 클라이언트에 브로드캐스트 (userId 무관).
   * detectionPoller 에서 호출.
   */
  broadcastAll(alert: NewDetectionAlert): Promise<void>;

  /**
   * 알림 상태를 'delivered' 로 갱신.
   */
  markDelivered(alertId: string): void;
};

// ---------------------------------------------------------------------------
// 내부 타입
// ---------------------------------------------------------------------------

type AlertDestinationRow = {
  userId: string;
  channel: 'toast' | 'webpush' | 'telegram';
  enabled: number;
  configJson: string | null;
};

type WebpushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

// ---------------------------------------------------------------------------
// SSE 유틸
// ---------------------------------------------------------------------------

/**
 * SSE 형식 데이터 문자열 생성.
 * 형식: `data: {json}\n\n`
 */
function formatSSEData(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// 팩토리 함수
// ---------------------------------------------------------------------------

/**
 * AlertDispatcher 인스턴스를 생성한다.
 *
 * @param deps 의존성 주입 (db, webPush, telegramToken, fetch)
 * @returns AlertDispatcher 인터페이스 구현
 */
export function createAlertDispatcher(deps: AlertDispatcherDeps): AlertDispatcher {
  /** SSE 레지스트리: Map<userId, Set<controller>> */
  const sseRegistry = new Map<string, Set<ReadableStreamDefaultController>>();

  const _fetch = deps.fetch ?? globalThis.fetch;

  // --------------------------------------------------------------------------
  // 내부 헬퍼
  // --------------------------------------------------------------------------

  /** 특정 사용자의 alert_destinations 조회 */
  function getDestinations(userId: string): AlertDestinationRow[] {
    return deps.db.$client
      .query(
        `SELECT user_id as userId, channel, enabled, config_json as configJson
         FROM alert_destinations
         WHERE user_id = ?`,
      )
      .all(userId) as AlertDestinationRow[];
  }

  /** 특정 사용자의 webpush_subscriptions 조회 */
  function getWebpushSubscriptions(userId: string): WebpushSubscriptionRow[] {
    return deps.db.$client
      .query('SELECT endpoint, p256dh, auth FROM webpush_subscriptions WHERE user_id = ?')
      .all(userId) as WebpushSubscriptionRow[];
  }

  /** webpush_subscriptions 에서 endpoint 로 구독 삭제 */
  function deleteWebpushSubscription(userId: string, endpoint: string): void {
    deps.db.$client
      .prepare('DELETE FROM webpush_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(userId, endpoint);
  }

  // --------------------------------------------------------------------------
  // SSE 채널
  // --------------------------------------------------------------------------

  /**
   * 특정 사용자의 SSE 클라이언트들에 알림 전송.
   * controller.enqueue 예외는 개별 catch (클라이언트 연결 끊김 대응).
   */
  function pushSSE(userId: string, alert: NewDetectionAlert): void {
    const clients = sseRegistry.get(userId);
    if (!clients || clients.size === 0) return;

    const payload = formatSSEData({
      id: alert.id,
      type: alert.type,
      channelId: alert.channelId,
      boxId: alert.boxId,
      firedAt: alert.firedAt,
      payload: alert.payloadJson,
    });

    for (const controller of clients) {
      try {
        controller.enqueue(payload);
      } catch {
        // 클라이언트 연결 끊김 — 레지스트리에서 제거
        clients.delete(controller);
      }
    }
  }

  // --------------------------------------------------------------------------
  // WebPush 채널
  // --------------------------------------------------------------------------

  async function sendWebPush(userId: string, alert: NewDetectionAlert): Promise<void> {
    if (!deps.webPush) return; // graceful skip

    const subscriptions = getWebpushSubscriptions(userId);
    if (subscriptions.length === 0) return;

    const notificationPayload = JSON.stringify({
      title: `[AI Alert] ${alert.type} 감지`,
      body: `채널 ${alert.channelId} 에서 ${alert.type} 이벤트가 감지됐습니다.`,
      icon: '/icon-192.png',
      data: {
        alertId: alert.id,
        type: alert.type,
        channelId: alert.channelId,
      },
    });

    for (const sub of subscriptions) {
      try {
        await deps.webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notificationPayload,
        );
      } catch (err: unknown) {
        // 410 Gone → 구독 만료 → 삭제
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? (err as { statusCode: number }).statusCode
            : 0;

        if (statusCode === 410) {
          deleteWebpushSubscription(userId, sub.endpoint);
        } else {
          console.warn('[alertDispatcher] WebPush 발송 실패', {
            endpoint: sub.endpoint,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Telegram 채널
  // --------------------------------------------------------------------------

  async function sendTelegram(
    userId: string,
    alert: NewDetectionAlert,
    destinations: AlertDestinationRow[],
  ): Promise<void> {
    if (!deps.telegramToken) return; // graceful skip

    const tgDest = destinations.find((d) => d.channel === 'telegram' && d.enabled === 1);
    if (!tgDest) return;

    let chatId: string | null = null;
    try {
      const config = tgDest.configJson
        ? (JSON.parse(tgDest.configJson) as Record<string, unknown>)
        : null;
      chatId = typeof config?.chat_id === 'string' ? config.chat_id : null;
    } catch {
      chatId = null;
    }

    if (!chatId) return;

    const firedAtDate = new Date(alert.firedAt).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
    });
    const text = `[채널 ${alert.channelId}] ${alert.type} 이벤트 감지 — ${firedAtDate}`;

    try {
      const url = `https://api.telegram.org/bot${deps.telegramToken}/sendMessage`;
      await _fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (err) {
      console.warn('[alertDispatcher] Telegram 발송 실패', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --------------------------------------------------------------------------
  // 공개 메서드
  // --------------------------------------------------------------------------

  function registerSSEClient(
    userId: string,
    controller: ReadableStreamDefaultController,
  ): () => void {
    if (!sseRegistry.has(userId)) {
      sseRegistry.set(userId, new Set());
    }
    sseRegistry.get(userId)?.add(controller);

    return () => {
      const clients = sseRegistry.get(userId);
      if (clients) {
        clients.delete(controller);
        if (clients.size === 0) {
          sseRegistry.delete(userId);
        }
      }
    };
  }

  async function dispatch(userId: string, alert: NewDetectionAlert): Promise<void> {
    const destinations = getDestinations(userId);

    const toastDest = destinations.find((d) => d.channel === 'toast' && d.enabled === 1);
    const webpushDest = destinations.find((d) => d.channel === 'webpush' && d.enabled === 1);

    // 각 채널 독립 실행 — 실패해도 다른 채널 계속
    const tasks: Promise<void>[] = [];

    if (toastDest) {
      tasks.push(Promise.resolve().then(() => pushSSE(userId, alert)));
    }

    if (webpushDest) {
      tasks.push(
        sendWebPush(userId, alert).catch((err) => {
          console.warn('[alertDispatcher] WebPush 채널 오류', {
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      );
    }

    // Telegram 은 destinations 배열 전달 (enabled 체크 내부에서)
    tasks.push(
      sendTelegram(userId, alert, destinations).catch((err) => {
        console.warn('[alertDispatcher] Telegram 채널 오류', {
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    );

    await Promise.allSettled(tasks);
  }

  async function broadcastAll(alert: NewDetectionAlert): Promise<void> {
    // 현재 등록된 모든 사용자 SSE 에 브로드캐스트
    for (const userId of sseRegistry.keys()) {
      const destinations = getDestinations(userId);
      const toastDest = destinations.find((d) => d.channel === 'toast' && d.enabled === 1);
      if (toastDest) {
        pushSSE(userId, alert);
      }
    }
  }

  function markDelivered(alertId: string): void {
    deps.db.$client
      .prepare("UPDATE detection_alerts SET status = 'delivered' WHERE id = ?")
      .run(alertId);
  }

  return {
    registerSSEClient,
    dispatch,
    broadcastAll,
    markDelivered,
  };
}
