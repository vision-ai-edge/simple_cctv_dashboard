// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M4-2 — 채널별 vision-ai 모델 슬롯 라우트 통합 테스트.
 *
 * 검증 항목:
 *   GET /api/boxes/:id/channels/:channelId/vision-ai/models
 *     - 인증 없이 → 401
 *     - 정상 → 200 + { models: [...] }
 *
 *   POST /api/boxes/:id/channels/:channelId/vision-ai/models
 *     - 인증 없이 → 401
 *     - 잘못된 body (modelId 누락) → 400
 *     - 정상 → 200 + 슬롯 설정
 *
 *   DELETE /api/boxes/:id/channels/:channelId/vision-ai/models/:modelId
 *     - 인증 없이 → 401
 *     - 정상 → 200 + { success: true }
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

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-channels-vision-ai-integration.sqlite');
const JWT_SECRET = 'test-secret-key-must-be-at-least-32-bytes-long!!';
const TEST_VAULT_KEY = '0'.repeat(64);

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// ---------------------------------------------------------------------------
// BoxClient mock 유틸
// ---------------------------------------------------------------------------

interface MockSlotConfig {
  modelId: string;
  enabled: boolean;
  slot?: number;
}

interface MockBoxClientOptions {
  listChannelModelsResult?: MockSlotConfig[] | Error;
  addChannelModelResult?: MockSlotConfig | Error;
  removeChannelModelResult?: void | Error;
}

function createMockBoxClient(opts: MockBoxClientOptions = {}): BoxClient {
  const listResult = opts.listChannelModelsResult ?? [];
  const addResult = opts.addChannelModelResult ?? { modelId: 'model-001', enabled: true };

  return {
    baseUrl: 'https://box.test:8443/api',
    channels: {
      list: mock(async () => []),
    },
    models: {
      list: mock(async () => []),
      upload: mock(async () => ({ id: 'model-x', name: 'x' })),
      delete: mock(async () => {}),
    },
    visionAi: {
      listChannelModels: mock(async (_channelId: string) => {
        if (listResult instanceof Error) throw listResult;
        return listResult;
      }),
      addChannelModel: mock(async (_channelId: string, _slot: { modelId: string; enabled?: boolean }) => {
        if (opts.addChannelModelResult instanceof Error) throw opts.addChannelModelResult;
        return addResult;
      }),
      removeChannelModel: mock(async (_channelId: string, _modelId: string) => {
        if (opts.removeChannelModelResult instanceof Error) throw opts.removeChannelModelResult;
      }),
    },
  } as unknown as BoxClient;
}

// ---------------------------------------------------------------------------
// 앱 빌더
// ---------------------------------------------------------------------------

function buildApp(
  db: Db,
  mockClient?: BoxClient,
): { app: Hono; deps: BoxServiceDeps } {
  const createBoxClientFn = mock((_baseUrl: string, _token?: string) => {
    return mockClient ?? createMockBoxClient();
  });

  const deps: BoxServiceDeps = {
    db,
    vaultKey: TEST_VAULT_KEY,
    createBoxClient: createBoxClientFn,
  };

  const app = new Hono();
  app.route('/api/auth', createAuthRoutes({ db, jwtSecret: JWT_SECRET }));
  app.route('/api/boxes', createBoxRoutes({ deps, jwtSecret: JWT_SECRET }));

  return { app, deps };
}

// ---------------------------------------------------------------------------
// 테스트용 Box 삽입 헬퍼
// ---------------------------------------------------------------------------

function insertBox(db: Db, id = 'box-001', baseUrl = 'https://box.test:8443/api') {
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
// GET /api/boxes/:id/channels/:channelId/vision-ai/models
// ===========================================================================

describe('GET /api/boxes/:id/channels/:channelId/vision-ai/models', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels/ch-001/vision-ai/models');
    expect(res.status).toBe(401);
  });

  test('정상 조회 → 200 + { models: [...] }', async () => {
    const slotList: MockSlotConfig[] = [
      { modelId: 'model-001', enabled: true, slot: 0 },
      { modelId: 'model-002', enabled: false, slot: 1 },
    ];
    const mockClient = createMockBoxClient({ listChannelModelsResult: slotList });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-001/vision-ai/models', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('models');
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models).toHaveLength(2);
    expect(body.models[0].modelId).toBe('model-001');
  });

  test('박스 클라이언트 오류 → 502', async () => {
    const mockClient = createMockBoxClient({ listChannelModelsResult: new Error('upstream') });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-001/vision-ai/models', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// POST /api/boxes/:id/channels/:channelId/vision-ai/models
// ===========================================================================

describe('POST /api/boxes/:id/channels/:channelId/vision-ai/models', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels/ch-001/vision-ai/models', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  test('modelId 누락 → 400', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-001/vision-ai/models', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }), // modelId 누락
    });
    expect(res.status).toBe(400);
  });

  test('빈 body → 400', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-001/vision-ai/models', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
      body: 'invalid-json',
    });
    expect(res.status).toBe(400);
  });

  test('정상 추가 → 200 + 슬롯 설정', async () => {
    const newSlot: MockSlotConfig = { modelId: 'model-001', enabled: true, slot: 0 };
    const mockClient = createMockBoxClient({ addChannelModelResult: newSlot });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-001/vision-ai/models', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ modelId: 'model-001', enabled: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modelId).toBe('model-001');
    expect(body.enabled).toBe(true);
  });

  test('enabled 필드 없이도 정상 처리 → 200', async () => {
    const mockClient = createMockBoxClient({
      addChannelModelResult: { modelId: 'model-002', enabled: false },
    });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-001/vision-ai/models', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ modelId: 'model-002' }), // enabled 생략
    });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// DELETE /api/boxes/:id/channels/:channelId/vision-ai/models/:modelId
// ===========================================================================

describe('DELETE /api/boxes/:id/channels/:channelId/vision-ai/models/:modelId', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request(
      '/api/boxes/box-001/channels/ch-001/vision-ai/models/model-001',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(401);
  });

  test('정상 제거 → 200 + { success: true }', async () => {
    const mockClient = createMockBoxClient();
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request(
      '/api/boxes/box-001/channels/ch-001/vision-ai/models/model-001',
      {
        method: 'DELETE',
        headers: { Cookie: cookieHeader },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('박스 클라이언트 오류 → 502', async () => {
    const mockClient = createMockBoxClient({
      removeChannelModelResult: new Error('remove failed'),
    });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request(
      '/api/boxes/box-001/channels/ch-001/vision-ai/models/model-001',
      {
        method: 'DELETE',
        headers: { Cookie: cookieHeader },
      },
    );
    expect(res.status).toBe(502);
  });
});
