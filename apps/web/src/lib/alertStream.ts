/**
 * SSE (Server-Sent Events) 알림 스트림 클라이언트.
 *
 * - GET /api/alerts/stream 연결
 * - message 이벤트 파싱 후 onAlert 콜백 호출
 * - 지수 백오프 재연결: 1s → 2s → 5s → 10s → 30s (상한)
 * - close() 호출 시 연결 종료
 */

/** 서버에서 수신하는 알림 데이터 구조 */
export interface AlertEvent {
  id: string;
  type: string;
  channelId: string;
  boxId: string;
  firedAt: number;
  payload?: unknown;
}

/** connectAlertStream 핸들러 */
export interface AlertStreamHandlers {
  onAlert: (alert: AlertEvent) => void;
  onConnect?: () => void;
  onError?: (err: Event) => void;
}

/** 재연결 백오프 스케줄 (초 단위) */
export const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * 다음 재연결 대기 시간을 계산한다 (순수 함수 — 테스트 가능).
 *
 * @param attempt - 0부터 시작하는 재시도 횟수
 * @returns 대기 시간 (ms)
 */
export function getBackoffDelay(attempt: number): number {
  const idx = Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx];
}

/**
 * SSE 메시지 data 문자열을 AlertEvent로 파싱한다 (순수 함수 — 테스트 가능).
 *
 * @param data - SSE 메시지의 data 필드
 * @returns AlertEvent | null (파싱 실패 시 null)
 */
export function parseAlertMessage(data: string): AlertEvent | null {
  try {
    const parsed = JSON.parse(data) as Partial<AlertEvent>;
    if (
      typeof parsed.id === 'string' &&
      typeof parsed.type === 'string' &&
      typeof parsed.channelId === 'string' &&
      typeof parsed.boxId === 'string' &&
      typeof parsed.firedAt === 'number'
    ) {
      return parsed as AlertEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/** connectAlertStream 반환 타입 */
export interface AlertStreamConnection {
  close(): void;
}

/**
 * SSE 알림 스트림에 연결한다.
 *
 * @param handlers - onAlert, onConnect, onError 콜백
 * @returns { close() } — 연결 종료 함수
 */
export function connectAlertStream(handlers: AlertStreamHandlers): AlertStreamConnection {
  let source: EventSource | null = null;
  let attempt = 0;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;

    source = new EventSource('/api/alerts/stream');

    source.addEventListener('open', () => {
      attempt = 0;
      handlers.onConnect?.();
    });

    source.addEventListener('message', (event: MessageEvent<string>) => {
      const alert = parseAlertMessage(event.data);
      if (alert) {
        handlers.onAlert(alert);
      }
    });

    // 서버가 명명된 이벤트(alert)로 보내는 경우도 처리
    source.addEventListener('alert', (event: MessageEvent<string>) => {
      const alert = parseAlertMessage(event.data);
      if (alert) {
        handlers.onAlert(alert);
      }
    });

    source.addEventListener('error', (event: Event) => {
      handlers.onError?.(event);

      // 연결 끊김 시 재연결
      source?.close();
      source = null;

      if (!closed) {
        const delay = getBackoffDelay(attempt);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      }
    });
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      source?.close();
      source = null;
    },
  };
}
