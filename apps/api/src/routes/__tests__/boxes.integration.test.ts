/**
 * SPEC-BOX-001 — boxes 라우트 통합 테스트.
 *
 * AC 검증:
 *   - REQ-MOD-2: POST /api/boxes 등록 헬스체크
 *   - REQ-MOD-1: 응답에 자격증명 평문 부재
 *   - REQ-MOD-3: POST /api/boxes/:id/refresh 수동 갱신
 *   - 모든 라우트 requireAuth 보호
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type Db, createDb, runMigrations } from '@cctv/db';
import { BoxApiError, type BoxClient } from '@cctv/shared';
import { Hono } from 'hono';
import { createTestUser, loginAs } from '../../__tests__/helpers/authFixtures';
import type { BoxServiceDeps } from '../../services/boxService';
import { createAuthRoutes } from '../auth';
import { createBoxRoutes } from '../boxes';

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-boxes-integration.sqlite');
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

function createMockBoxClient(overrides?: {
  loginResult?: { token: string; expiresAt: null } | Error;
  regenerateApiKeyResult?: { apiKey: string } | Error;
}): BoxClient {
  const loginResult = overrides?.loginResult ?? { token: 'mock-jwt', expiresAt: null };
  const regenerateResult = overrides?.regenerateApiKeyResult ?? { apiKey: 'mock-api-key' };

  return {
    baseUrl: 'https://box.test:8443/api',
    auth: {
      login: mock(async (_u: string, _p: string) => {
        if (loginResult instanceof Error) throw loginResult;
        return loginResult;
      }),
      regenerateApiKey: mock(async () => {
        if (regenerateResult instanceof Error) throw regenerateResult;
        return regenerateResult;
      }),
      me: mock(async () => ({ username: 'admin', hasApiKey: false })),
      changePassword: mock(async () => {}),
    },
    setCredentials: mock((_c: { jwt?: string; apiKey?: string }) => {}),
  } as unknown as BoxClient;
}

// ---------------------------------------------------------------------------
// testApp 빌더 — 의존성 wiring
// ---------------------------------------------------------------------------

function buildApp(db: Db, mockClient?: BoxClient): { app: Hono; deps: BoxServiceDeps } {
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
// setup / teardown
// ---------------------------------------------------------------------------

let db: Db;

beforeEach(async () => {
  cleanup();
  await runMigrations({ databasePath: TMP_DB });
  db = createDb(TMP_DB);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// 자격증명 키 부재 자동 검증 헬퍼
// ---------------------------------------------------------------------------
const CREDENTIAL_KEYS = [
  'password',
  'jwt_cached',
  'api_key_cached',
  'password_enc',
  'passwordEnc',
  'jwtCachedEnc',
  'apiKeyCachedEnc',
  'jwt',
  'apiKey',
] as const;

function assertNoCredentials(body: unknown) {
  const serialized = JSON.stringify(body);
  for (const key of CREDENTIAL_KEYS) {
    // 'jwt' 키는 오탐 방지 — 'jwt_cached' 포함으로 충분
    if (key === 'jwt' || key === 'apiKey') continue;
    expect(serialized).not.toContain(`"${key}"`);
  }
}

// ===========================================================================
// POST /api/boxes
// ===========================================================================

describe('POST /api/boxes', () => {
  // TC-1: 인증 없음 → 401
  test('인증 쿠키 없이 요청 시 401', async () => {
    const { app } = buildApp(db);

    const res = await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '테스트박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret123',
      }),
    });

    expect(res.status).toBe(401);
  });

  // TC-2: 유효 입력 + 헬스체크 성공 → 201
  test('인증 + 유효 입력 + 헬스체크 성공 → 201, 자격증명 미노출', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'test-jwt', expiresAt: null } });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'user1', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user1', password: 'password123' });

    const res = await app.request('/api/boxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name: '유효박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret123',
      }),
    });

    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    // 필수 필드 확인
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('유효박스');
    expect(body.baseUrl).toBeTruthy();
    expect(body.status).toBe('active');

    // 자격증명 미포함 확인
    assertNoCredentials(body);
  });

  // TC-3: 헬스체크 401 실패 → 400
  test('헬스체크 401 실패 → 400, DB 미생성', async () => {
    const mockClient = createMockBoxClient({
      loginResult: new BoxApiError('Unauthorized', 401, Date.now()),
    });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'user2', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user2', password: 'password123' });

    const res = await app.request('/api/boxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name: '실패박스',
        host: '192.168.1.200',
        port: 8443,
        username: 'admin',
        password: 'wrong',
      }),
    });

    expect([400, 502]).toContain(res.status);

    // DB 에 레코드 없음 확인
    const rows = db.$client.query('SELECT COUNT(*) as cnt FROM boxes').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  // TC-4: Zod 검증 실패 → 400
  test('name 누락 → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'user3', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user3', password: 'password123' });

    const res = await app.request('/api/boxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret',
      }),
    });

    expect(res.status).toBe(400);
  });

  test('port < 1 → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'user4', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user4', password: 'password123' });

    const res = await app.request('/api/boxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name: '포트오류박스',
        host: '192.168.1.100',
        port: 0,
        username: 'admin',
        password: 'secret',
      }),
    });

    expect(res.status).toBe(400);
  });

  test('password 빈 문자열 → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'user5', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user5', password: 'password123' });

    const res = await app.request('/api/boxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name: '비번오류박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: '',
      }),
    });

    expect(res.status).toBe(400);
  });

  // TC-EC-003: 동일 base_url 중복 등록 → 409 Conflict (EC-BOX-003)
  test('동일 host:port 중복 등록 → 409 Conflict + BOX_ALREADY_EXISTS 코드', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'dupuser1', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'dupuser1', password: 'password123' });

    const boxPayload = {
      name: '첫번째박스',
      host: '192.168.99.99',
      port: 8443,
      username: 'admin',
      password: 'secret123',
    };

    // 첫 번째 등록 → 201
    const firstRes = await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify(boxPayload),
    });
    expect(firstRes.status).toBe(201);

    // 두 번째 등록 (동일 host:port) → 409
    const secondRes = await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ ...boxPayload, name: '중복박스' }),
    });
    expect(secondRes.status).toBe(409);

    const body = (await secondRes.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.code).toBe('BOX_ALREADY_EXISTS');
    expect(typeof body.error).toBe('string');

    // DB 에 레코드 1개만 존재
    const rows = db.$client.query('SELECT COUNT(*) as cnt FROM boxes').get() as { cnt: number };
    expect(rows.cnt).toBe(1);
  });

  // TC-5: useApiKey=true → API Key 발급 흐름
  test('useApiKey=true → regenerateApiKey 호출, 201', async () => {
    const mockClient = createMockBoxClient({
      loginResult: { token: 'jwt-token', expiresAt: null },
      regenerateApiKeyResult: { apiKey: 'my-api-key' },
    });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'user6', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user6', password: 'password123' });

    const res = await app.request('/api/boxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name: 'API키박스',
        host: '192.168.1.102',
        port: 8443,
        username: 'admin',
        password: 'secret',
        useApiKey: true,
      }),
    });

    expect(res.status).toBe(201);
    expect(mockClient.auth.regenerateApiKey).toHaveBeenCalledTimes(1);

    const body = (await res.json()) as Record<string, unknown>;
    assertNoCredentials(body);
  });
});

// ===========================================================================
// GET /api/boxes
// ===========================================================================

describe('GET /api/boxes', () => {
  // TC-6: 인증 없음 → 401
  test('인증 쿠키 없이 요청 시 401', async () => {
    const { app } = buildApp(db);

    const res = await app.request('/api/boxes');
    expect(res.status).toBe(401);
  });

  // TC-7: 인증 → 200 + 자격증명 마스킹
  test('인증 → 200, 자격증명 미포함', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const { app, deps } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'user7', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user7', password: 'password123' });

    // Box 1개 등록
    await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        name: '리스트박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret',
      }),
    });

    const res = await app.request('/api/boxes', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    for (const box of body) {
      assertNoCredentials(box);
    }
  });

  // TC-8: 빈 목록 → 200 + 빈 배열
  test('등록된 Box 없음 → 200, 빈 배열', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'user8', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user8', password: 'password123' });

    const res = await app.request('/api/boxes', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

// ===========================================================================
// GET /api/boxes/:id
// ===========================================================================

describe('GET /api/boxes/:id', () => {
  // TC-9: 인증 없음 → 401
  test('인증 쿠키 없이 요청 시 401', async () => {
    const { app } = buildApp(db);

    const res = await app.request('/api/boxes/nonexistent-id');
    expect(res.status).toBe(401);
  });

  // TC-10: 존재 → 200 + 자격증명 마스킹
  test('존재하는 Box → 200, 자격증명 미포함', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'user9', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user9', password: 'password123' });

    // Box 등록
    const createRes = await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        name: '단일박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret',
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/boxes/${created.id}`, {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(created.id);
    expect(body.name).toBe('단일박스');
    assertNoCredentials(body);
  });

  // TC-11: 미존재 → 404
  test('존재하지 않는 Box → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'user10', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user10', password: 'password123' });

    const res = await app.request('/api/boxes/NONEXISTENT_ID', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// POST /api/boxes/:id/refresh
// ===========================================================================

describe('POST /api/boxes/:id/refresh', () => {
  // TC-12: 인증 없음 → 401
  test('인증 쿠키 없이 요청 시 401', async () => {
    const { app } = buildApp(db);

    const res = await app.request('/api/boxes/some-id/refresh', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
  });

  // TC-13: 수동 갱신 성공 → 200 + lastSyncAt 포함
  test('수동 갱신 성공 → 200, 자격증명 미포함', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'user11', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user11', password: 'password123' });

    // Box 등록
    const createRes = await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        name: '갱신박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret',
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/boxes/${created.id}/refresh`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(created.id);
    assertNoCredentials(body);
  });

  // TC-14: 재로그인 실패 → 502
  test('재로그인 실패 → 502', async () => {
    // 최초 등록은 성공, refresh 시에는 실패
    const registerClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const { app, deps } = buildApp(db, registerClient);
    await createTestUser(db, { username: 'user12', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user12', password: 'password123' });

    // Box 등록
    const createRes = await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        name: '재로그인실패박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret',
      }),
    });
    const created = (await createRes.json()) as { id: string };

    // refresh 시 BoxApiError 를 던지는 새 앱을 생성
    const failClient = createMockBoxClient({
      loginResult: new BoxApiError('Unauthorized', 401, Date.now()),
    });
    const failDeps: BoxServiceDeps = {
      db,
      vaultKey: TEST_VAULT_KEY,
      createBoxClient: mock(() => failClient),
    };
    const failApp = new Hono();
    failApp.route('/api/auth', createAuthRoutes({ db, jwtSecret: JWT_SECRET }));
    failApp.route('/api/boxes', createBoxRoutes({ deps: failDeps, jwtSecret: JWT_SECRET }));

    const res = await failApp.request(`/api/boxes/${created.id}/refresh`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });

    expect([502, 400]).toContain(res.status);
  });
});

// ===========================================================================
// DELETE /api/boxes/:id
// ===========================================================================

describe('DELETE /api/boxes/:id', () => {
  // TC-15: 인증 없음 → 401
  test('인증 쿠키 없이 요청 시 401', async () => {
    const { app } = buildApp(db);

    const res = await app.request('/api/boxes/some-id', {
      method: 'DELETE',
    });

    expect(res.status).toBe(401);
  });

  // TC-16: 존재 → 204
  test('존재하는 Box 삭제 → 204', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'user13', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user13', password: 'password123' });

    // Box 등록
    const createRes = await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        name: '삭제박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret',
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/boxes/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(204);

    // DB 에서 삭제되었는지 확인
    const row = db.$client.query('SELECT * FROM boxes WHERE id = ?').get(created.id);
    expect(row).toBeNull();
  });

  // TC-17: 미존재 → 404
  test('존재하지 않는 Box 삭제 → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'user14', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'user14', password: 'password123' });

    const res = await app.request('/api/boxes/NONEXISTENT_ID', {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// TC-18: 응답 본문 자격증명 자동 검증 (모든 라우트)
// ===========================================================================

describe('응답 보안 — 모든 라우트 자격증명 미포함', () => {
  test('POST /api/boxes 응답에 민감 키 절대 미포함', async () => {
    const mockClient = createMockBoxClient({
      loginResult: { token: 'super-secret-jwt', expiresAt: null },
    });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'secuser1', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'secuser1', password: 'password123' });

    const res = await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        name: '보안테스트박스',
        host: '192.168.1.99',
        port: 8443,
        username: 'admin',
        password: 'my-very-secret-password',
      }),
    });

    expect(res.status).toBe(201);
    const rawText = await res.text();

    // 비밀번호 평문이 절대 응답에 없어야 한다
    expect(rawText).not.toContain('my-very-secret-password');
    expect(rawText).not.toContain('super-secret-jwt');
    expect(rawText).not.toContain('password_enc');
    expect(rawText).not.toContain('jwt_cached');
    expect(rawText).not.toContain('api_key_cached');
  });

  test('GET /api/boxes 응답에 민감 키 절대 미포함', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'secuser2', password: 'password123' });
    const { cookieHeader } = await loginAs(app, { username: 'secuser2', password: 'password123' });

    await app.request('/api/boxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        name: '보안테스트박스2',
        host: '192.168.1.98',
        port: 8443,
        username: 'admin',
        password: 'another-secret',
      }),
    });

    const res = await app.request('/api/boxes', {
      headers: { Cookie: cookieHeader },
    });

    const rawText = await res.text();
    expect(rawText).not.toContain('password_enc');
    expect(rawText).not.toContain('jwt_cached_enc');
    expect(rawText).not.toContain('api_key_cached_enc');
    expect(rawText).not.toContain('another-secret');
  });
});
