// TAG: BOX-CHANNELS-001
/**
 * SPEC-BOX-CHANNELS-001 — channelSyncService 단위 테스트.
 *
 * 테스트 대상:
 *   - mapChannelStatus: ChannelStatus → CameraStatus 변환 (모든 케이스)
 *   - sanitizeErrorMessage: 자격증명 누출 방지
 *   - syncChannelsForBox: upsert 정상 동작, offline 처리, 타임아웃, 뮤텍스
 *   - 뮤텍스 API: acquireSyncLock, releaseSyncLock, isSyncInProgress
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, runMigrations } from '@cctv/db';
import type { BoxClient } from '@cctv/shared';
import { encryptWithVault } from '@cctv/shared/crypto/vault';
import type { BoxServiceDeps } from '../boxService';
import {
  acquireSyncLock,
  isSyncInProgress,
  mapChannelStatus,
  releaseSyncLock,
  sanitizeErrorMessage,
  syncChannelsForBox,
} from '../channelSyncService';

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-channel-sync-service.sqlite');
const TEST_VAULT_KEY = '0'.repeat(64);

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// ---------------------------------------------------------------------------
// 테스트용 Box / Camera 헬퍼
// ---------------------------------------------------------------------------

function insertBox(
  db: ReturnType<typeof createDb>,
  id: string,
  baseUrl = 'https://box.test:8443/api',
) {
  db.$client
    .prepare(
      `INSERT INTO boxes (id, name, base_url, username, password_enc, jwt_cached_enc, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      id,
      `Box-${id}`,
      baseUrl,
      'admin',
      new Uint8Array(32),
      new Uint8Array(32),
      Date.now(),
      Date.now(),
    );
}

function insertCamera(
  db: ReturnType<typeof createDb>,
  id: string,
  boxId: string,
  channelId: string,
  status = 'online',
) {
  db.$client
    .prepare(
      `INSERT INTO cameras (id, box_id, channel_id, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, boxId, channelId, `Camera-${channelId}`, status, Date.now(), Date.now());
}

function getCameraByChannelId(db: ReturnType<typeof createDb>, boxId: string, channelId: string) {
  return db.$client
    .query('SELECT * FROM cameras WHERE box_id = ? AND channel_id = ?')
    .get(boxId, channelId) as Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// BoxClient mock 유틸
// ---------------------------------------------------------------------------

function createMockBoxClient(channelListResult: unknown[] | Error): BoxClient {
  return {
    baseUrl: 'https://box.test:8443/api',
    channels: {
      list: mock(async () => {
        if (channelListResult instanceof Error) throw channelListResult;
        return channelListResult;
      }),
      start: mock(async () => ({ success: true })),
      stop: mock(async () => ({ success: true })),
    },
  } as unknown as BoxClient;
}

// ---------------------------------------------------------------------------
// mapChannelStatus 테스트
// ---------------------------------------------------------------------------

describe('mapChannelStatus', () => {
  test('RUNNING → online', () => {
    expect(mapChannelStatus('RUNNING')).toBe('online');
  });

  test('ERROR → error', () => {
    expect(mapChannelStatus('ERROR')).toBe('error');
  });

  test('CONNECTING → offline', () => {
    expect(mapChannelStatus('CONNECTING')).toBe('offline');
  });

  test('RETRYING → offline', () => {
    expect(mapChannelStatus('RETRYING')).toBe('offline');
  });

  test('STOPPED → offline', () => {
    expect(mapChannelStatus('STOPPED')).toBe('offline');
  });

  test('PAUSED → offline', () => {
    expect(mapChannelStatus('PAUSED')).toBe('offline');
  });
});

// ---------------------------------------------------------------------------
// sanitizeErrorMessage 테스트
// ---------------------------------------------------------------------------

describe('sanitizeErrorMessage', () => {
  test('민감 문자열을 REDACTED로 치환한다', () => {
    const msg = 'Auth failed: Bearer my-secret-jwt-token-here';
    const result = sanitizeErrorMessage(msg, ['my-secret-jwt-token-here']);
    expect(result).toBe('Auth failed: Bearer [REDACTED]');
    expect(result).not.toContain('my-secret-jwt-token-here');
  });

  test('여러 민감 문자열을 모두 치환한다', () => {
    const msg = 'jwt=abc123 apikey=xyz789 error';
    const result = sanitizeErrorMessage(msg, ['abc123', 'xyz789']);
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('xyz789');
  });

  test('4자 이하 문자열은 치환하지 않는다 (오탐 방지)', () => {
    const msg = 'Error: key=abc failed';
    const result = sanitizeErrorMessage(msg, ['abc']);
    // 3자 'abc'는 스킵
    expect(result).toBe('Error: key=abc failed');
  });

  test('빈 문자열은 치환하지 않는다', () => {
    const msg = 'some error';
    const result = sanitizeErrorMessage(msg, ['']);
    expect(result).toBe('some error');
  });
});

// ---------------------------------------------------------------------------
// 뮤텍스 테스트
// ---------------------------------------------------------------------------

describe('mutex (acquireSyncLock / releaseSyncLock / isSyncInProgress)', () => {
  afterEach(() => {
    // 테스트 후 락 정리
    releaseSyncLock('test-box-mutex');
  });

  test('초기 상태: isSyncInProgress = false', () => {
    expect(isSyncInProgress('test-box-mutex')).toBe(false);
  });

  test('acquireSyncLock 후 isSyncInProgress = true', () => {
    const acquired = acquireSyncLock('test-box-mutex');
    expect(acquired).toBe(true);
    expect(isSyncInProgress('test-box-mutex')).toBe(true);
  });

  test('이미 락이 걸린 경우 acquireSyncLock = false', () => {
    acquireSyncLock('test-box-mutex');
    const second = acquireSyncLock('test-box-mutex');
    expect(second).toBe(false);
  });

  test('releaseSyncLock 후 isSyncInProgress = false', () => {
    acquireSyncLock('test-box-mutex');
    releaseSyncLock('test-box-mutex');
    expect(isSyncInProgress('test-box-mutex')).toBe(false);
  });

  test('다른 Box ID는 독립적으로 관리된다', () => {
    acquireSyncLock('box-A');
    expect(isSyncInProgress('box-A')).toBe(true);
    expect(isSyncInProgress('box-B')).toBe(false);
    releaseSyncLock('box-A');
  });
});

// ---------------------------------------------------------------------------
// syncChannelsForBox 테스트
// ---------------------------------------------------------------------------

describe('syncChannelsForBox', () => {
  let db: ReturnType<typeof createDb>;
  let deps: BoxServiceDeps;

  beforeEach(async () => {
    cleanup();
    db = createDb(TMP_DB);
    await runMigrations({ databasePath: TMP_DB });
    insertBox(db, 'box-001');
  });

  afterEach(() => {
    db.$client.close();
    cleanup();
  });

  test('신규 채널 INSERT — 정상 동기화', async () => {
    const mockClient = createMockBoxClient([
      { id: 'ch-1', name: '채널 1', status: 'RUNNING' },
      { id: 'ch-2', name: '채널 2', status: 'STOPPED' },
    ]);

    deps = {
      db,
      vaultKey: TEST_VAULT_KEY,
      createBoxClient: mock(() => mockClient),
    };

    const result = await syncChannelsForBox('box-001', deps);
    expect(result.success).toBe(true);
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);

    const cam1 = getCameraByChannelId(db, 'box-001', 'ch-1');
    expect(cam1).not.toBeNull();
    expect(cam1?.status).toBe('online');
    expect(cam1?.last_synced_at).toBeGreaterThan(0);
    expect(cam1?.sync_error).toBeNull();

    const cam2 = getCameraByChannelId(db, 'box-001', 'ch-2');
    expect(cam2?.status).toBe('offline');
  });

  test('기존 채널 UPDATE — 이름/상태 갱신', async () => {
    insertCamera(db, 'cam-existing', 'box-001', 'ch-1', 'offline');

    const mockClient = createMockBoxClient([
      { id: 'ch-1', name: '갱신된 채널', status: 'RUNNING' },
    ]);

    deps = {
      db,
      vaultKey: TEST_VAULT_KEY,
      createBoxClient: mock(() => mockClient),
    };

    await syncChannelsForBox('box-001', deps);

    const cam = getCameraByChannelId(db, 'box-001', 'ch-1');
    expect(cam?.name).toBe('갱신된 채널');
    expect(cam?.status).toBe('online');
    expect(cam?.last_synced_at).toBeGreaterThan(0);
    expect(cam?.sync_error).toBeNull();
  });

  test('Box API에 없는 채널 → status=offline (하드 삭제 없음)', async () => {
    insertCamera(db, 'cam-A', 'box-001', 'ch-A', 'online');
    insertCamera(db, 'cam-B', 'box-001', 'ch-B', 'online');
    insertCamera(db, 'cam-C', 'box-001', 'ch-C', 'online');

    // API는 ch-A, ch-B만 반환 (ch-C 삭제됨)
    const mockClient = createMockBoxClient([
      { id: 'ch-A', name: '채널 A', status: 'RUNNING' },
      { id: 'ch-B', name: '채널 B', status: 'RUNNING' },
    ]);

    deps = {
      db,
      vaultKey: TEST_VAULT_KEY,
      createBoxClient: mock(() => mockClient),
    };

    await syncChannelsForBox('box-001', deps);

    const camC = getCameraByChannelId(db, 'box-001', 'ch-C');
    expect(camC).not.toBeNull(); // 삭제되지 않음
    expect(camC?.status).toBe('offline');
  });

  test('채널 동기화 타임아웃 → sync_error 기록, last_synced_at 유지', async () => {
    // 기존 채널에 last_synced_at 설정
    const prevSyncAt = Date.now() - 60_000;
    insertCamera(db, 'cam-1', 'box-001', 'ch-1', 'online');
    db.$client
      .prepare('UPDATE cameras SET last_synced_at = ? WHERE id = ?')
      .run(prevSyncAt, 'cam-1');

    const timeoutError = new Error('Connection timeout after 10000ms');
    const mockClient = createMockBoxClient(timeoutError);

    deps = {
      db,
      vaultKey: TEST_VAULT_KEY,
      createBoxClient: mock(() => mockClient),
    };

    const result = await syncChannelsForBox('box-001', deps);
    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);

    const cam = getCameraByChannelId(db, 'box-001', 'ch-1');
    expect(cam?.sync_error).toContain('timeout');
    // last_synced_at은 변경되지 않아야 함 (이전 성공 값 유지)
    expect(cam?.last_synced_at).toBe(prevSyncAt);
  });

  test('sync_error에 자격증명 누출 없음 — sanitize 검증', async () => {
    // 실제 암호화된 JWT를 DB에 저장
    const fakeJwt = 'super-secret-jwt-token-value-123456';
    const jwtEnc = await encryptWithVault(fakeJwt, TEST_VAULT_KEY);

    db.$client.prepare('UPDATE boxes SET jwt_cached_enc = ? WHERE id = ?').run(jwtEnc, 'box-001');

    // 오류 메시지에 JWT가 포함된 경우 시뮬레이션
    const errorWithCredential = new Error(`Auth error: Bearer ${fakeJwt}`);
    const mockClient = createMockBoxClient(errorWithCredential);

    deps = {
      db,
      vaultKey: TEST_VAULT_KEY,
      createBoxClient: mock(() => mockClient),
    };

    await syncChannelsForBox('box-001', deps);

    // DB에서 sync_error 확인 (모든 카메라에 기록됨)
    // 카메라가 없어도 sync_error가 credentials를 포함하지 않아야 함
    // 여기서는 sync_error가 없는 경우를 확인 (카메라가 없으면 UPDATE 해당 없음)
    // 실제 확인: 카메라를 삽입 후 테스트
    insertCamera(db, 'cam-sec', 'box-001', 'ch-sec', 'online');

    await syncChannelsForBox('box-001', deps);

    const cam = getCameraByChannelId(db, 'box-001', 'ch-sec');
    if (cam?.sync_error) {
      expect(String(cam.sync_error)).not.toContain(fakeJwt);
    }
  });

  test('Box 미발견 시 BoxNotFoundError 전파', async () => {
    deps = {
      db,
      vaultKey: TEST_VAULT_KEY,
      createBoxClient: mock(() => createMockBoxClient([])),
    };

    await expect(syncChannelsForBox('nonexistent-box', deps)).rejects.toThrow(
      'Box 를 찾을 수 없습니다',
    );
  });

  test('빈 채널 목록 동기화 — 기존 채널 offline 처리', async () => {
    insertCamera(db, 'cam-old', 'box-001', 'ch-old', 'online');

    const mockClient = createMockBoxClient([]); // 빈 목록

    deps = {
      db,
      vaultKey: TEST_VAULT_KEY,
      createBoxClient: mock(() => mockClient),
    };

    const result = await syncChannelsForBox('box-001', deps);
    expect(result.success).toBe(true);
    expect(result.synced).toBe(0);

    const cam = getCameraByChannelId(db, 'box-001', 'ch-old');
    expect(cam?.status).toBe('offline');
  });
});
