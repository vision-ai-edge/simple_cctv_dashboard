// TAG: BOX-CHANNELS-001
/**
 * SPEC-BOX-CHANNELS-001 — 채널 동기화 서비스.
 *
 * 책임:
 *   - REQ-CHAN-004: (box_id, channel_id) 기준 Upsert
 *   - REQ-CHAN-002: Box에 없는 채널 → status='offline' (하드 삭제 금지)
 *   - ChannelStatus → CameraStatus 변환
 *   - 동기화 성공/실패 시 last_synced_at / sync_error 갱신
 *   - 동일 Box 중복 동기화 방지 뮤텍스 (Set 기반)
 *
 * 보안 원칙:
 *   - sync_error에 자격증명 원문 절대 미포함
 *   - 자격증명 복호화는 boxService.withAuthRetry 경유
 */

import type { BoxClient, ChannelListResponse, ChannelStatus } from '@cctv/shared';
import { decryptWithVault } from '@cctv/shared';
import { ulid } from 'ulid';
import type { BoxServiceDeps } from './boxService';
import { BoxNotFoundError, queryCredentialRow } from './boxService';

// ---------------------------------------------------------------------------
// 공개 타입
// ---------------------------------------------------------------------------

/** 채널 동기화 결과 */
export type SyncResult = {
  success: boolean;
  synced: number;
  failed: number;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// 내부 타입
// ---------------------------------------------------------------------------

/** DB cameras 행 (내부용) */
type CameraRow = {
  id: string;
  channelId: string;
  status: string;
  lastSyncedAt: number | null;
};

type GpsCoordinates = {
  latitude: number;
  longitude: number;
};

// ---------------------------------------------------------------------------
// 뮤텍스 (Box 단위 중복 동기화 방지)
// ---------------------------------------------------------------------------

/** 현재 동기화 진행 중인 Box ID Set */
const syncInProgress = new Set<string>();

/**
 * 해당 Box의 동기화가 진행 중인지 확인한다.
 */
export function isSyncInProgress(boxId: string): boolean {
  return syncInProgress.has(boxId);
}

/**
 * 해당 Box의 동기화 락을 획득한다.
 * 이미 진행 중이면 false를 반환한다.
 */
export function acquireSyncLock(boxId: string): boolean {
  if (syncInProgress.has(boxId)) return false;
  syncInProgress.add(boxId);
  return true;
}

/**
 * 해당 Box의 동기화 락을 해제한다.
 */
export function releaseSyncLock(boxId: string): void {
  syncInProgress.delete(boxId);
}

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/**
 * ChannelStatus → CameraStatus 변환 (SPEC-BOX-CHANNELS-001 도메인 정의).
 *
 * RUNNING           → 'online'
 * CONNECTING/RETRYING → 'offline'
 * STOPPED/PAUSED    → 'offline'
 * ERROR             → 'error'
 */
export function mapChannelStatus(channelStatus: ChannelStatus): 'online' | 'offline' | 'error' {
  switch (channelStatus) {
    case 'RUNNING':
      return 'online';
    case 'ERROR':
      return 'error';
    case 'CONNECTING':
    case 'RETRYING':
    case 'STOPPED':
    case 'PAUSED':
      return 'offline';
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = channelStatus;
      return 'offline';
    }
  }
}

/**
 * 오류 메시지에서 자격증명 원문을 제거하여 sanitize한다.
 * sync_error 컬럼에 API Key / JWT가 노출되지 않도록 방어한다.
 *
 * @param message 원본 오류 메시지
 * @param sensitiveStrings 제거할 민감 문자열 목록
 */
export function sanitizeErrorMessage(message: string, sensitiveStrings: string[]): string {
  let sanitized = message;
  for (const s of sensitiveStrings) {
    if (s && s.length > 4) {
      // 4자 이하 문자열은 스킵 (오탐 방지)
      sanitized = sanitized.replaceAll(s, '[REDACTED]');
    }
  }
  return sanitized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readNumberField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = parseFiniteNumber(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function validCoordinates(
  latitude: number | null,
  longitude: number | null,
): GpsCoordinates | null {
  if (latitude == null || longitude == null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/**
 * EdgeAI Box 채널 응답에서 카메라 GPS 좌표를 추출한다.
 *
 * 박스 펌웨어/설정별 필드 차이를 흡수하기 위해 최상위, gps/location 객체,
 * config.gps/config.location 객체를 순서대로 확인한다.
 */
export function extractGpsCoordinates(channel: unknown): GpsCoordinates | null {
  const root = asRecord(channel);
  if (!root) return null;

  const direct = validCoordinates(
    readNumberField(root, ['latitude', 'lat']),
    readNumberField(root, ['longitude', 'lng', 'lon']),
  );
  if (direct) return direct;

  for (const containerKey of ['gps', 'location']) {
    const container = asRecord(root[containerKey]);
    if (!container) continue;
    const nested = validCoordinates(
      readNumberField(container, ['latitude', 'lat']),
      readNumberField(container, ['longitude', 'lng', 'lon']),
    );
    if (nested) return nested;
  }

  const config = asRecord(root.config);
  if (!config) return null;

  const configDirect = validCoordinates(
    readNumberField(config, ['latitude', 'lat']),
    readNumberField(config, ['longitude', 'lng', 'lon']),
  );
  if (configDirect) return configDirect;

  for (const containerKey of ['gps', 'location']) {
    const container = asRecord(config[containerKey]);
    if (!container) continue;
    const nested = validCoordinates(
      readNumberField(container, ['latitude', 'lat']),
      readNumberField(container, ['longitude', 'lng', 'lon']),
    );
    if (nested) return nested;
  }

  return null;
}

/**
 * EdgeAI Box 채널 응답에서 주변 BLE 비컨 신호 개수를 추출한다.
 *
 * count 필드가 있으면 우선 사용하고, beacons/devices/signals 배열만 있으면
 * 배열 길이를 신호 개수로 사용한다.
 */
export function extractBleBeaconCount(channel: unknown): number | null {
  const root = asRecord(channel);
  if (!root) return null;

  for (const source of [
    root,
    asRecord(root.ble),
    asRecord(root.bluetooth),
    asRecord(root.config),
  ]) {
    if (!source) continue;
    const explicitCount = readNumberField(source, [
      'bleBeaconCount',
      'beaconCount',
      'bleCount',
      'deviceCount',
      'count',
    ]);
    if (explicitCount != null) return Math.max(0, Math.floor(explicitCount));

    for (const key of ['bleBeacons', 'beacons', 'devices', 'signals']) {
      const value = source[key];
      if (Array.isArray(value)) return value.length;
    }
  }

  return null;
}

async function withTimeout<T>(
  promise: Promise<T> | undefined,
  timeoutMs: number,
): Promise<T | null> {
  if (!promise) return null;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function readBoxGpsCoordinates(client: BoxClient): Promise<GpsCoordinates | null> {
  try {
    const connectivity = (
      client as unknown as {
        connectivity?: { getLocationPosition?: () => Promise<unknown> };
      }
    ).connectivity;
    const position = await withTimeout(connectivity?.getLocationPosition?.(), 1_000);
    return extractGpsCoordinates(position);
  } catch {
    return null;
  }
}

async function readBoxBleBeaconCount(client: BoxClient): Promise<number | null> {
  try {
    const connectivity = (
      client as unknown as {
        connectivity?: {
          getBleStatus?: () => Promise<unknown>;
          setBleScanning?: (enabled: boolean, broadcastIntervalMs?: number) => Promise<unknown>;
          getBleDevices?: () => Promise<unknown>;
        };
      }
    ).connectivity;

    const status = await withTimeout(connectivity?.getBleStatus?.(), 1_000);
    const statusRecord = asRecord(status);
    if (statusRecord?.scanning === false) {
      await withTimeout(connectivity?.setBleScanning?.(true, 5_000), 1_000);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const devices = await withTimeout(connectivity?.getBleDevices?.(), 1_000);
    const devicesCount = extractBleBeaconCount(devices);
    if (devicesCount != null && devicesCount > 0) return devicesCount;

    return extractBleBeaconCount(status) ?? devicesCount;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 특정 Box의 채널 목록을 EdgeAI Box API에서 가져와 DB에 Upsert한다.
 *
 * 처리 순서:
 *  1. DB에서 자격증명 복호화 (queryCredentialRow + decryptWithVault)
 *  2. BoxClient 생성 후 channels.list() 호출 (AbortController + 10초 타임아웃)
 *  3. (box_id, channel_id) 기준으로 기존 cameras 레코드와 비교
 *  4. INSERT / UPDATE 트랜잭션 실행
 *  5. Box API에 없는 채널 → status='offline'
 *  6. 성공: last_synced_at = Date.now(), sync_error = NULL
 *  7. 실패: last_synced_at 유지, sync_error = sanitized 오류 메시지
 *
 * @param boxId 동기화할 Box ID
 * @param deps 서비스 의존성 주입 컨테이너
 * @returns SyncResult { success, synced, failed, timestamp }
 */
export async function syncChannelsForBox(boxId: string, deps: BoxServiceDeps): Promise<SyncResult> {
  const { db, vaultKey, createBoxClient } = deps;
  const timestamp = Date.now();

  // Box 자격증명 조회
  let credRow: ReturnType<typeof queryCredentialRow>;
  try {
    credRow = queryCredentialRow(db, boxId);
  } catch (err) {
    if (err instanceof BoxNotFoundError) {
      throw err;
    }
    throw err;
  }

  // JWT 복호화 (없으면 undefined 폴백)
  let jwt: string | undefined;
  if (credRow.jwtCachedEnc) {
    try {
      jwt = await decryptWithVault(credRow.jwtCachedEnc, vaultKey);
    } catch {
      jwt = undefined;
    }
  }

  // API Key 복호화 (있으면 사용)
  let apiKey: string | undefined;
  if (credRow.apiKeyCachedEnc) {
    try {
      apiKey = await decryptWithVault(credRow.apiKeyCachedEnc, vaultKey);
    } catch {
      apiKey = undefined;
    }
  }

  // BoxClient 생성
  const client: BoxClient = createBoxClient(credRow.baseUrl, jwt);

  // channels.list() 호출 (8초 타임아웃)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  let channelList!: ChannelListResponse;
  const boxGps = await readBoxGpsCoordinates(client);
  const boxBleBeaconCount = await readBoxBleBeaconCount(client);
  try {
    channelList = (await Promise.race([
      client.channels.list(),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () =>
          reject(new Error('Connection timeout after 8000ms')),
        ),
      ),
    ])) as ChannelListResponse;
  } catch (err) {
    clearTimeout(timeoutId);
    // 실패: sync_error 기록, last_synced_at 유지
    const rawMessage = err instanceof Error ? err.message : String(err);
    const sensitiveStrings = [jwt, apiKey, credRow.passwordEnc ? '' : ''].filter(
      (s): s is string => typeof s === 'string',
    );
    const sanitizedMessage = sanitizeErrorMessage(rawMessage, sensitiveStrings);

    // 관측성: cameras row 가 없을 때도 진단 가능하도록 콘솔로 노출.
    // sanitize 된 메시지를 찍는다 — 자격증명 원문 유출 방지.
    console.warn(`[channelSync] Box ${boxId} 채널 동기화 실패`, {
      error: sanitizedMessage,
      hasJwt: typeof jwt === 'string',
      hasApiKey: typeof apiKey === 'string',
    });

    // 모든 카메라에 sync_error 기록 (last_synced_at 유지)
    db.$client
      .prepare('UPDATE cameras SET sync_error = ?, updated_at = ? WHERE box_id = ?')
      .run(sanitizedMessage, Date.now(), boxId);

    return { success: false, synced: 0, failed: 1, timestamp };
  } finally {
    clearTimeout(timeoutId);
  }

  // 트랜잭션 내에서 Upsert 수행
  let synced = 0;

  try {
    db.$client.transaction(() => {
      // 현재 DB 채널 목록 조회
      const existingRows = db.$client
        .query(
          `SELECT id, channel_id as channelId, status, last_synced_at as lastSyncedAt
           FROM cameras WHERE box_id = ?`,
        )
        .all(boxId) as CameraRow[];

      const existingMap = new Map<string, CameraRow>(
        existingRows.map((row) => [row.channelId, row]),
      );

      // Box API 채널 ID Set 구성
      const apiChannelIds = new Set<string>(channelList.map((ch) => ch.id));

      const now = Date.now();

      // INSERT or UPDATE
      for (const ch of channelList) {
        const cameraStatus = ch.status ? mapChannelStatus(ch.status) : 'offline';
        const existing = existingMap.get(ch.id);
        const gps = extractGpsCoordinates(ch) ?? boxGps;
        const bleBeaconCount = extractBleBeaconCount(ch) ?? boxBleBeaconCount;

        if (existing) {
          // UPDATE 기존 채널
          db.$client
            .prepare(
              `UPDATE cameras
               SET name = ?, status = ?, resolution = ?, stream_url = ?,
                   latitude = COALESCE(?, latitude),
                   longitude = COALESCE(?, longitude),
                   ble_beacon_count = COALESCE(?, ble_beacon_count),
                   last_synced_at = ?, sync_error = NULL, updated_at = ?
               WHERE box_id = ? AND channel_id = ?`,
            )
            .run(
              ch.name,
              cameraStatus,
              ((ch as Record<string, unknown>).resolution as string) ?? null,
              ((ch as Record<string, unknown>).rtspUrl as string) ?? null,
              gps?.latitude ?? null,
              gps?.longitude ?? null,
              bleBeaconCount,
              now,
              now,
              boxId,
              ch.id,
            );
        } else {
          // INSERT 신규 채널
          const newId = ulid();
          db.$client
            .prepare(
              `INSERT INTO cameras
                 (id, box_id, channel_id, name, status, resolution, stream_url,
                  latitude, longitude, ble_beacon_count,
                  last_synced_at, sync_error, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
            )
            .run(
              newId,
              boxId,
              ch.id,
              ch.name,
              cameraStatus,
              ((ch as Record<string, unknown>).resolution as string) ?? null,
              ((ch as Record<string, unknown>).rtspUrl as string) ?? null,
              gps?.latitude ?? null,
              gps?.longitude ?? null,
              bleBeaconCount ?? 0,
              now,
              now,
              now,
            );
        }
        synced++;
      }

      // Box API에 없는 채널 → status='offline' (하드 삭제 금지)
      for (const [channelId, _] of existingMap) {
        if (!apiChannelIds.has(channelId)) {
          db.$client
            .prepare(
              `UPDATE cameras SET status = 'offline', updated_at = ? WHERE box_id = ? AND channel_id = ?`,
            )
            .run(now, boxId, channelId);
        }
      }
    })();
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const sanitizedMessage = sanitizeErrorMessage(rawMessage, [jwt ?? '', apiKey ?? '']);

    console.warn(`[channelSync] Box ${boxId} 채널 Upsert 실패`, {
      error: sanitizedMessage,
    });

    db.$client
      .prepare('UPDATE cameras SET sync_error = ?, updated_at = ? WHERE box_id = ?')
      .run(sanitizedMessage, Date.now(), boxId);

    return { success: false, synced: 0, failed: 1, timestamp };
  }

  return { success: true, synced, failed: 0, timestamp };
}
