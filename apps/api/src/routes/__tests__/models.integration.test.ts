// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M4-1 — 전역 모델 라우트 통합 테스트.
 *
 * 검증 항목:
 *   GET /api/boxes/:id/models
 *     - 인증 없이 → 401
 *     - 존재하지 않는 Box → 404
 *     - 정상 → 200 + { models: [...] }
 *
 *   POST /api/boxes/:id/models
 *     - 인증 없이 → 401
 *     - modelFile 누락 → 400
 *     - 파일 크기 초과 → 413
 *     - 정상 업로드 → 200 + 모델 정보
 *     - 응답에 자격증명 미포함 확인
 *
 *   DELETE /api/boxes/:id/models/:modelId
 *     - 인증 없이 → 401
 *     - 존재하지 않는 Box → 404
 *     - 정상 → 200 + { success: true }
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
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

const TMP_DB = join(import.meta.dir, '.test-models-integration.sqlite');
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

interface MockModelInfo {
  id: string;
  name: string;
  version?: string;
}

interface MockBoxClientOptions {
  modelListResult?: MockModelInfo[] | Error;
  modelUploadResult?: MockModelInfo | Error;
  modelDeleteResult?: void | Error;
}

function createMockBoxClient(opts: MockBoxClientOptions = {}): BoxClient {
  const modelListResult = opts.modelListResult ?? [];
  const modelUploadResult = opts.modelUploadResult ?? { id: 'model-new', name: 'uploaded' };

  return {
    baseUrl: 'https://box.test:8443/api',
    models: {
      list: mock(async () => {
        if (modelListResult instanceof Error) throw modelListResult;
        return modelListResult;
      }),
      upload: mock(async (_modelFile: Blob, _metadataFile: Blob) => {
        if (opts.modelUploadResult instanceof Error) throw opts.modelUploadResult;
        return modelUploadResult;
      }),
      delete: mock(async (_id: string) => {
        if (opts.modelDeleteResult instanceof Error) throw opts.modelDeleteResult;
      }),
    },
    channels: {
      list: mock(async () => []),
    },
    visionAi: {},
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
// GET /api/boxes/:id/models
// ===========================================================================

describe('GET /api/boxes/:id/models', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/models');
    expect(res.status).toBe(401);
  });

  test('존재하지 않는 Box → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/no-such-box/models', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(404);
  });

  test('정상 조회 → 200 + { models: [...] }', async () => {
    const mockModels = [
      { id: 'model-001', name: 'Intrusion Detector', version: '1.0' },
      { id: 'model-002', name: 'Fall Detector', version: '2.1' },
    ];
    const mockClient = createMockBoxClient({ modelListResult: mockModels });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/models', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('models');
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models).toHaveLength(2);
    expect(body.models[0].id).toBe('model-001');
  });

  test('박스 클라이언트 오류 → 502', async () => {
    const mockClient = createMockBoxClient({ modelListResult: new Error('upstream error') });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/models', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// POST /api/boxes/:id/models
// ===========================================================================

describe('POST /api/boxes/:id/models', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/models', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('modelFile 누락 시 400', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const form = new FormData();
    // modelFile 누락, metadataFile만 포함
    form.append('metadataFile', new File(['{}'], 'meta.json', { type: 'application/json' }));

    const res = await app.request('/api/boxes/box-001/models', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  test('metadataFile 누락 시 400', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const form = new FormData();
    form.append('modelFile', new File(['model-bytes'], 'model.bin', { type: 'application/octet-stream' }));
    // metadataFile 누락

    const res = await app.request('/api/boxes/box-001/models', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  test('파일 크기 초과 → 413', async () => {
    insertBox(db);
    // MODEL_UPLOAD_MAX_MB를 1로 낮춰서 테스트
    const origEnv = process.env.MODEL_UPLOAD_MAX_MB;
    process.env.MODEL_UPLOAD_MAX_MB = '1';

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    // 2MB 파일 생성 (1MB 제한 초과)
    const largeBuffer = new Uint8Array(2 * 1024 * 1024);
    const form = new FormData();
    form.append('modelFile', new File([largeBuffer], 'model.bin', { type: 'application/octet-stream' }));
    form.append('metadataFile', new File(['{}'], 'meta.json', { type: 'application/json' }));

    const res = await app.request('/api/boxes/box-001/models', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: form,
    });
    expect(res.status).toBe(413);
    process.env.MODEL_UPLOAD_MAX_MB = origEnv;
  });

  test('정상 업로드 → 200 + 모델 정보', async () => {
    const uploadedModel = { id: 'model-new-001', name: 'New Model', version: '1.0' };
    const mockClient = createMockBoxClient({ modelUploadResult: uploadedModel });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const form = new FormData();
    form.append('modelFile', new File(['model-bytes'], 'model.bin', { type: 'application/octet-stream' }));
    form.append('metadataFile', new File(['{"name":"New Model"}'], 'meta.json', { type: 'application/json' }));

    const res = await app.request('/api/boxes/box-001/models', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('model-new-001');
    expect(body.name).toBe('New Model');
  });

  test('응답에 자격증명 미포함 확인', async () => {
    const uploadedModel = { id: 'model-safe', name: 'Safe Model' };
    const mockClient = createMockBoxClient({ modelUploadResult: uploadedModel });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const form = new FormData();
    form.append('modelFile', new File(['data'], 'model.bin'));
    form.append('metadataFile', new File(['{}'], 'meta.json'));

    const res = await app.request('/api/boxes/box-001/models', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 자격증명 필드가 없어야 함
    expect(body).not.toHaveProperty('jwt');
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('Authorization');
  });

  test('존재하지 않는 Box → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const form = new FormData();
    form.append('modelFile', new File(['data'], 'model.bin'));
    form.append('metadataFile', new File(['{}'], 'meta.json'));

    const res = await app.request('/api/boxes/no-such-box/models', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: form,
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// DELETE /api/boxes/:id/models/:modelId
// ===========================================================================

describe('DELETE /api/boxes/:id/models/:modelId', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/models/model-001', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  test('존재하지 않는 Box → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/no-such-box/models/model-001', {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(404);
  });

  test('정상 삭제 → 200 + { success: true }', async () => {
    const mockClient = createMockBoxClient();
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/models/model-001', {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('박스 클라이언트 오류 → 502', async () => {
    const mockClient = createMockBoxClient({ modelDeleteResult: new Error('delete failed') });
    insertBox(db);
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/models/model-001', {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });
});
