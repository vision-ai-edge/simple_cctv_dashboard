// TAG: DASHBOARD-001
/**
 * SPEC-DASHBOARD-001 — cameras 라우트 통합 테스트.
 *
 * 검증 항목 (AC-DASH-002):
 *   - AC-DASH-002-A: 인증 없는 요청 → 401
 *   - AC-DASH-002-C: 카메라 없는 경우 → 200 + { cameras: [] }
 *   - AC-DASH-002-B: 카메라 2개(같은 Box) → 200 + JOIN 결과 검증
 *   - AC-DASH-002-D: 카메라 2개(다른 Box 2개) → 200 + 두 Box 모두 포함
 *   - AC-DASH-013-A: 응답에 자격증명 필드 없음 (password_enc 등)
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type Db, createDb, runMigrations } from '@cctv/db';
import type { BoxClient } from '@cctv/shared';
import { Hono } from 'hono';
import { createTestUser, loginAs } from '../../__tests__/helpers/authFixtures';
import type { BoxServiceDeps } from '../../services/boxService';
import { createAuthRoutes } from '../auth';
import { createBoxRoutes } from '../boxes';
import { createCameraRoutes } from '../cameras';

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-cameras-integration.sqlite');
const JWT_SECRET = 'test-secret-key-must-be-at-least-32-bytes-long!!';
const TEST_VAULT_KEY = '0'.repeat(64);

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// ---------------------------------------------------------------------------
// 앱 빌더
// ---------------------------------------------------------------------------

function buildApp(db: Db): { app: Hono } {
  const createBoxClientFn = mock((_baseUrl: string, _token?: string): BoxClient => {
    return {
      baseUrl: 'https://box.test:8443/api',
      channels: {
        list: mock(async () => []),
        start: mock(async () => ({ success: true })),
        stop: mock(async () => ({ success: true })),
      },
    } as unknown as BoxClient;
  });

  const deps: BoxServiceDeps = {
    db,
    vaultKey: TEST_VAULT_KEY,
    createBoxClient: createBoxClientFn,
  };

  const app = new Hono();
  app.route('/api/auth', createAuthRoutes({ db, jwtSecret: JWT_SECRET }));
  app.route('/api/boxes', createBoxRoutes({ deps, jwtSecret: JWT_SECRET }));
  app.route('/api/cameras', createCameraRoutes({ db, jwtSecret: JWT_SECRET }));

  return { app };
}

// ---------------------------------------------------------------------------
// 테스트용 픽스처 헬퍼
// ---------------------------------------------------------------------------

/**
 * boxes 테이블에 테스트용 Box를 삽입한다.
 * channels.integration.test.ts 의 insertBox 와 동일한 패턴.
 */
function insertBox(
  db: Db,
  id = 'box-001',
  name = `Box-${id}`,
  status: 'active' | 'inactive' | 'error' = 'active',
) {
  db.$client
    .prepare(
      `INSERT INTO boxes (id, name, base_url, username, password_enc, jwt_cached_enc, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      `https://box-${id}.test:8443/api`,
      'admin',
      new Uint8Array(32),
      new Uint8Array(32),
      status,
      Date.now(),
      Date.now(),
    );
}

/**
 * cameras 테이블에 테스트용 카메라를 삽입한다.
 * channels.integration.test.ts 의 insertCamera 와 동일한 패턴.
 */
function insertCamera(
  db: Db,
  id: string,
  boxId: string,
  channelId: string,
  opts?: {
    name?: string;
    status?: 'online' | 'offline' | 'error';
    latitude?: number | null;
    longitude?: number | null;
    bleBeaconCount?: number;
    lastSyncedAt?: number | null;
  },
) {
  const name = opts?.name ?? `Camera-${channelId}`;
  const status = opts?.status ?? 'online';
  const latitude = opts?.latitude ?? null;
  const longitude = opts?.longitude ?? null;
  const bleBeaconCount = opts?.bleBeaconCount ?? 0;
  const lastSyncedAt = opts?.lastSyncedAt ?? null;

  db.$client
    .prepare(
      `INSERT INTO cameras (id, box_id, channel_id, name, status, latitude, longitude, ble_beacon_count, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      boxId,
      channelId,
      name,
      status,
      latitude,
      longitude,
      bleBeaconCount,
      lastSyncedAt,
      Date.now(),
      Date.now(),
    );
}

// ---------------------------------------------------------------------------
// setup / teardown
// ---------------------------------------------------------------------------

let db: Db;

beforeEach(async () => {
  cleanup();
  await runMigrations({ databasePath: TMP_DB });
  db = createDb(TMP_DB);
});

afterEach(() => {
  db.$client.close();
  cleanup();
});

// ===========================================================================
// GET /api/cameras
// ===========================================================================

describe('GET /api/cameras', () => {
  // -------------------------------------------------------------------------
  // AC-DASH-002-A: 인증 없는 요청 → 401
  // -------------------------------------------------------------------------
  test('인증 없이 요청 시 401', async () => {
    const { app } = buildApp(db);
    const res = await app.request('/api/cameras');
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AC-DASH-002-C: 카메라 없는 경우 → 200 + { cameras: [] }
  // -------------------------------------------------------------------------
  test('카메라 없는 경우 빈 배열 반환', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/cameras', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cameras: unknown[] };
    expect(body.cameras).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // AC-DASH-002-B: 카메라 2개 (같은 Box 소속) → 200 + JOIN 결과 검증
  // -------------------------------------------------------------------------
  test('카메라 2개(같은 Box 소속) → 정상 응답 및 JOIN 결과 검증', async () => {
    insertBox(db, 'box-001', '북문 박스');
    insertCamera(db, 'cam-001', 'box-001', 'ch-A', {
      name: 'Camera-A',
      status: 'online',
      latitude: 37.5665,
      longitude: 126.978,
      bleBeaconCount: 3,
      lastSyncedAt: 1700000000000,
    });
    insertCamera(db, 'cam-002', 'box-001', 'ch-B', {
      name: 'Camera-B',
      status: 'offline',
    });

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u2', password: 'pass123' });

    const res = await app.request('/api/cameras', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      cameras: Array<{
        id: string;
        channelId: string;
        name: string;
        status: string;
        latitude: number | null;
        longitude: number | null;
        bleBeaconCount: number;
        lastSyncedAt: number | null;
        boxId: string;
        boxName: string;
        boxStatus: string;
      }>;
    };
    expect(body.cameras).toHaveLength(2);

    // JOIN 필드 검증
    const camA = body.cameras.find((c) => c.id === 'cam-001');
    expect(camA).toBeDefined();
    expect(camA?.channelId).toBe('ch-A');
    expect(camA?.name).toBe('Camera-A');
    expect(camA?.status).toBe('online');
    expect(camA?.latitude).toBe(37.5665);
    expect(camA?.longitude).toBe(126.978);
    expect(camA?.bleBeaconCount).toBe(3);
    expect(camA?.lastSyncedAt).toBe(1700000000000);
    expect(camA?.boxId).toBe('box-001');
    // AC-DASH-002-D 검증 요소 — boxName JOIN
    expect(camA?.boxName).toBe('북문 박스');
    expect(camA?.boxStatus).toBe('active');
  });

  // -------------------------------------------------------------------------
  // AC-DASH-002-D: 카메라 2개 (다른 Box 2개 소속) → 두 Box 모두 포함
  // -------------------------------------------------------------------------
  test('카메라 2개(다른 Box 2개 소속) → 두 Box 모두 응답에 포함', async () => {
    insertBox(db, 'box-001', '북문 박스', 'active');
    insertBox(db, 'box-002', '남문 박스', 'inactive');
    insertCamera(db, 'cam-001', 'box-001', 'ch-A');
    insertCamera(db, 'cam-002', 'box-002', 'ch-B');

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u3', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u3', password: 'pass123' });

    const res = await app.request('/api/cameras', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { cameras: Array<{ boxId: string; boxName: string }> };
    expect(body.cameras).toHaveLength(2);

    const boxIds = body.cameras.map((c) => c.boxId);
    expect(boxIds).toContain('box-001');
    expect(boxIds).toContain('box-002');

    const boxNames = body.cameras.map((c) => c.boxName);
    expect(boxNames).toContain('북문 박스');
    expect(boxNames).toContain('남문 박스');
  });

  // -------------------------------------------------------------------------
  // AC-DASH-013-A: 응답에 자격증명 필드 없음 (REQ-DASH-013)
  // -------------------------------------------------------------------------
  test('응답에 자격증명 필드가 포함되지 않아야 한다', async () => {
    insertBox(db, 'box-001', '테스트 박스');
    insertCamera(db, 'cam-001', 'box-001', 'ch-A');

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u4', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u4', password: 'pass123' });

    const res = await app.request('/api/cameras', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { cameras: Array<Record<string, unknown>> };
    expect(body.cameras).toHaveLength(1);

    const cam = body.cameras[0];
    // 자격증명 필드가 응답에 포함되면 안 됨 (REQ-DASH-013)
    expect(cam).not.toHaveProperty('password_enc');
    expect(cam).not.toHaveProperty('passwordEnc');
    expect(cam).not.toHaveProperty('jwt_cached_enc');
    expect(cam).not.toHaveProperty('jwtCachedEnc');
    expect(cam).not.toHaveProperty('api_key_cached_enc');
    expect(cam).not.toHaveProperty('apiKeyCachedEnc');
    expect(cam).not.toHaveProperty('jwt_cached');
    expect(cam).not.toHaveProperty('jwtCached');
    expect(cam).not.toHaveProperty('api_key_cached');
    expect(cam).not.toHaveProperty('apiKeyCached');
    expect(cam).not.toHaveProperty('password');
    expect(cam).not.toHaveProperty('username');
  });
});
