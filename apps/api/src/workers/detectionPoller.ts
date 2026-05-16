// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M2-1 — AI Detection 폴링 워커.
 *
 * 책임:
 *   - REQ-ALERT-001: active Box 의 online 채널을 주기적으로 visionAi.getDetections 폴링
 *   - REQ-ALERT-002: detection_cursor 기반 신규 이벤트만 처리 (중복 방지)
 *   - REQ-ALERT-003: detection_alerts INSERT + 히스토리 1000건 트리밍
 *   - 오류 격리: 채널 단위 try/catch — 한 채널 실패가 다른 채널에 영향 없음
 *
 * 보안 원칙:
 *   - 자격증명 로그 미포함
 *   - BOX_VAULT_KEY DI deps 주입
 *
 * 싱글톤 패턴:
 *   - boxStatusPoller / channelSyncPoller 와 동일한 패턴
 */

import type { Db } from '@cctv/db';
import type { BoxClient } from '@cctv/shared';
import { decryptWithVault } from '@cctv/shared/crypto/vault';
import { ulid } from 'ulid';
import type { AlertDispatcher } from '../services/alertDispatcher';

// ---------------------------------------------------------------------------
// 공개 타입
// ---------------------------------------------------------------------------

/** detectionPoller 의존성 주입 컨테이너 */
export type DetectionPollerDeps = {
  /** Drizzle DB 인스턴스 */
  db: Db;
  /** BOX_VAULT_KEY — 64자 hex 볼트 키 */
  vaultKey: string;
  /** BoxClient 팩토리 */
  createBoxClient: (baseUrl: string, token?: string) => BoxClient;
  /** 알림 디스패처 — 신규 이벤트 발생 시 dispatch 호출 */
  alertDispatcher?: AlertDispatcher;
};

/** detectionPoller 옵션 */
export type DetectionPollerOptions = {
  /** 폴링 주기 (ms). 기본값: DETECTION_POLL_INTERVAL_MS 환경변수 또는 3000 */
  intervalMs?: number;
};

// ---------------------------------------------------------------------------
// 내부 타입
// ---------------------------------------------------------------------------

type ActiveBoxRow = {
  id: string;
  baseUrl: string;
  jwtCachedEnc: Uint8Array | null;
};

type ChannelRow = {
  channelId: string;
};

type DetectionItem = {
  timestamp?: number;
  type?: string;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[detectionPoller]';
const DEFAULT_INTERVAL_MS = 3000;
const MIN_INTERVAL_MS = 1000;
const MAX_HISTORY_COUNT = 1000;

// ---------------------------------------------------------------------------
// 싱글톤 상태
// ---------------------------------------------------------------------------

let activeInstance: { stop: () => void } | null = null;

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/** status='active' Box 목록 조회 (자격증명 포함) */
function listActiveBoxes(db: Db): ActiveBoxRow[] {
  return db.$client
    .query(
      `SELECT id, base_url as baseUrl, jwt_cached_enc as jwtCachedEnc
       FROM boxes WHERE status = 'active'`,
    )
    .all() as ActiveBoxRow[];
}

/** 특정 Box 의 online cameras (channel_id 목록) 조회 */
function listOnlineChannels(db: Db, boxId: string): ChannelRow[] {
  return db.$client
    .query(
      `SELECT channel_id as channelId FROM cameras
       WHERE box_id = ? AND status = 'online'`,
    )
    .all(boxId) as ChannelRow[];
}

/** detection_cursor 에서 last_seen_timestamp 조회 */
function getCursorTimestamp(db: Db, boxId: string, channelId: string): number {
  const row = db.$client
    .query('SELECT last_seen_timestamp FROM detection_cursor WHERE box_id = ? AND channel_id = ?')
    .get(boxId, channelId) as { last_seen_timestamp: number } | null;
  return row?.last_seen_timestamp ?? 0;
}

/** cursor 갱신 (UPSERT) */
function upsertCursor(db: Db, boxId: string, channelId: string, timestamp: number): void {
  db.$client
    .prepare(
      `INSERT INTO detection_cursor (box_id, channel_id, last_seen_timestamp, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(box_id, channel_id)
       DO UPDATE SET last_seen_timestamp = excluded.last_seen_timestamp,
                     updated_at = excluded.updated_at`,
    )
    .run(boxId, channelId, timestamp, Date.now());
}

/** detection_alerts INSERT */
function insertDetectionAlert(
  db: Db,
  boxId: string,
  channelId: string,
  type: string,
  payloadJson: string,
  firedAt: number,
): string {
  const id = ulid();
  db.$client
    .prepare(
      `INSERT INTO detection_alerts (id, box_id, channel_id, type, payload_json, fired_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .run(id, boxId, channelId, type, payloadJson, firedAt, Date.now());
  return id;
}

/** 히스토리 트리밍: (box_id, channel_id) 기준 최근 1000건 초과 시 오래된 것 삭제 */
function trimHistory(db: Db, boxId: string, channelId: string): void {
  const count = (
    db.$client
      .query('SELECT COUNT(*) as cnt FROM detection_alerts WHERE box_id = ? AND channel_id = ?')
      .get(boxId, channelId) as { cnt: number }
  ).cnt;

  if (count > MAX_HISTORY_COUNT) {
    const toDelete = count - MAX_HISTORY_COUNT;
    db.$client
      .prepare(
        `DELETE FROM detection_alerts WHERE id IN (
           SELECT id FROM detection_alerts
           WHERE box_id = ? AND channel_id = ?
           ORDER BY fired_at ASC
           LIMIT ?
         )`,
      )
      .run(boxId, channelId, toDelete);
  }
}

/**
 * 환경변수 DETECTION_POLL_INTERVAL_MS 를 읽어 클램핑된 값 반환
 */
export function resolveIntervalMs(envValue?: string): number {
  const raw = envValue !== undefined ? Number.parseInt(envValue, 10) : DEFAULT_INTERVAL_MS;
  const value = Number.isNaN(raw) ? DEFAULT_INTERVAL_MS : raw;
  return Math.max(value, MIN_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * Detection 폴링 워커를 시작한다.
 *
 * 처리 순서 (매 tick):
 *  1. status='active' Box 목록 조회
 *  2. 각 Box 의 online cameras(channel_id) 조회
 *  3. 각 (box, channel) 에 대해 visionAi.getDetections(channelId) 호출
 *  4. detection_cursor.last_seen_timestamp 이후 이벤트만 신규로 처리
 *  5. 신규 이벤트 → detection_alerts INSERT
 *  6. cursor 갱신
 *  7. 히스토리 1000건 트리밍
 *  8. 신규 이벤트 → alertDispatcher.dispatch (있는 경우)
 *
 * 오류 격리:
 *  - 채널 단위 try/catch — 한 채널 실패가 다른 채널에 영향 없음
 *  - tick 전체 실패 격리 — 서버 프로세스 종료 방지
 *
 * 싱글톤:
 *  - 이미 실행 중인 인스턴스가 있으면 경고 후 기존 stop 반환
 *
 * @param deps 의존성 주입
 * @param options 폴러 옵션
 * @returns stop 함수 — clearInterval 및 싱글톤 상태 초기화
 */
export function startDetectionPoller(
  deps: DetectionPollerDeps,
  options: DetectionPollerOptions = {},
): () => void {
  // 싱글톤: 이미 실행 중이면 경고 후 기존 stop 반환
  if (activeInstance) {
    console.warn(`${LOG_PREFIX} 이미 실행 중인 인스턴스가 있습니다. 기존 인스턴스를 유지합니다.`);
    return activeInstance.stop;
  }

  const intervalMs =
    options.intervalMs ?? resolveIntervalMs(process.env.DETECTION_POLL_INTERVAL_MS);

  console.info(`${LOG_PREFIX} 시작 — 주기: ${intervalMs}ms`);

  /** 매 tick 실행 로직 */
  const tick = async (): Promise<void> => {
    const activeBoxes = listActiveBoxes(deps.db);

    for (const box of activeBoxes) {
      // JWT 복호화
      let jwt: string | undefined;
      if (box.jwtCachedEnc) {
        try {
          jwt = await decryptWithVault(box.jwtCachedEnc, deps.vaultKey);
        } catch {
          jwt = undefined;
        }
      }

      const client = deps.createBoxClient(box.baseUrl, jwt);
      const channels = listOnlineChannels(deps.db, box.id);

      for (const ch of channels) {
        try {
          const response = await client.visionAi.getDetections(ch.channelId);

          const rawDetections = (response.detections as DetectionItem[] | undefined) ?? [];
          const cursorTs = getCursorTimestamp(deps.db, box.id, ch.channelId);

          // 신규 이벤트 필터링 (timestamp > cursor)
          const newEvents = rawDetections.filter(
            (d) => typeof d.timestamp === 'number' && d.timestamp > cursorTs,
          );

          if (newEvents.length === 0) continue;

          // 최대 timestamp 계산
          let maxTs = cursorTs;
          const insertedIds: Array<{ alertId: string; alert: DetectionItem }> = [];

          for (const evt of newEvents) {
            const ts = evt.timestamp as number;
            const type = typeof evt.type === 'string' ? evt.type : 'unknown';
            const payloadJson = JSON.stringify(evt);

            const alertId = insertDetectionAlert(
              deps.db,
              box.id,
              ch.channelId,
              type,
              payloadJson,
              ts,
            );

            if (ts > maxTs) maxTs = ts;
            insertedIds.push({ alertId, alert: evt });
          }

          // cursor 갱신
          upsertCursor(deps.db, box.id, ch.channelId, maxTs);

          // 히스토리 트리밍
          trimHistory(deps.db, box.id, ch.channelId);

          // alertDispatcher 로 이벤트 전달
          if (deps.alertDispatcher) {
            for (const { alertId, alert } of insertedIds) {
              const newDetectionAlert = {
                id: alertId,
                boxId: box.id,
                channelId: ch.channelId,
                type: typeof alert.type === 'string' ? alert.type : 'unknown',
                payloadJson: JSON.stringify(alert),
                firedAt: alert.timestamp as number,
                status: 'new' as const,
                createdAt: Date.now(),
              };

              // 전체 사용자 대상 브로드캐스트 (현재 단일 사용자 MVP)
              deps.alertDispatcher.broadcastAll(newDetectionAlert).catch((err: unknown) => {
                console.warn(`${LOG_PREFIX} dispatch 실패 (alertId=${alertId})`, {
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            }
          }
        } catch (err) {
          // 채널 단위 오류 격리
          console.warn(`${LOG_PREFIX} Box ${box.id} ch ${ch.channelId} 폴링 실패`, {
            error: err instanceof Error ? err.message : String(err),
            boxId: box.id,
            channelId: ch.channelId,
          });
        }
      }
    }
  };

  const handle = setInterval(() => {
    tick().catch((err) => {
      // tick 전체 실패 격리 — 서버 프로세스 종료 방지
      console.error(`${LOG_PREFIX} tick 오류 (서버 영향 없음)`, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);

  const stop = (): void => {
    clearInterval(handle);
    activeInstance = null;
    console.info(`${LOG_PREFIX} 중지됨`);
  };

  activeInstance = { stop };
  return stop;
}
