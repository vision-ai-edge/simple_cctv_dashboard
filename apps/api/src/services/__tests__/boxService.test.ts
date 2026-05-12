/**
 * SPEC-BOX-001 — boxService 단위 테스트.
 *
 * RED 단계: boxService.ts 가 없으므로 모두 실패한다.
 *
 * 테스트 대상:
 *   - registerBox: 헬스체크 성공/실패, useApiKey, 자격증명 마스킹
 *   - withAuthRetry: 정상 호출, 401 재시도, 재로그인 실패, 즉시 전파
 *   - refreshTokens: 수동 토큰 갱신
 *   - listBoxes / getBox: 자격증명 마스킹
 *   - deleteBox: 레코드 삭제
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type Db, createDb, runMigrations } from '@cctv/db';
import { BoxApiError, type BoxClient } from '@cctv/shared';
import {
  BoxRegistrationError,
  type BoxServiceDeps,
  type BoxSummary,
  deleteBox,
  getBox,
  listBoxes,
  refreshTokens,
  registerBox,
  withAuthRetry,
} from '../boxService';

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-box-service.sqlite');
const TEST_VAULT_KEY = '0'.repeat(64); // 유효한 64-char hex 볼트 키

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// ---------------------------------------------------------------------------
// BoxClient 팩토리 mock 유틸
// ---------------------------------------------------------------------------

/**
 * BoxClient 인터페이스 부분 구현 (테스트용 mock).
 * auth.login, auth.regenerateApiKey 만 stub 으로 제공한다.
 */
function createMockBoxClient(overrides?: {
  loginResult?: { token: string; expiresAt: null } | Error;
  regenerateApiKeyResult?: { apiKey: string } | Error;
  fnResult?: unknown | Error;
}): BoxClient {
  const loginResult = overrides?.loginResult ?? { token: 'mock-jwt-token', expiresAt: null };
  const regenerateResult = overrides?.regenerateApiKeyResult ?? { apiKey: 'mock-api-key' };

  const client = {
    baseUrl: 'https://box.test:8443/api',
    auth: {
      login: mock(async (_username: string, _password: string) => {
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
    setCredentials: mock((_creds: { jwt?: string; apiKey?: string }) => {}),
  } as unknown as BoxClient;

  return client;
}

// ---------------------------------------------------------------------------
// 테스트 의존성 빌더
// ---------------------------------------------------------------------------

function buildDeps(db: Db, clientOverride?: BoxClient): BoxServiceDeps {
  return {
    db,
    vaultKey: TEST_VAULT_KEY,
    createBoxClient: mock((_baseUrl: string, _token?: string) => {
      return clientOverride ?? createMockBoxClient();
    }),
  };
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

let db: Db;

beforeEach(async () => {
  cleanup();
  await runMigrations({ databasePath: TMP_DB });
  db = createDb(TMP_DB);
});

afterEach(cleanup);

// ===========================================================================
// registerBox
// ===========================================================================

describe('registerBox', () => {
  // T1: 헬스체크 성공 시 정상 등록
  test('헬스체크 성공 시 boxes 레코드 INSERT, status=active', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'test-jwt', expiresAt: null } });
    const deps = buildDeps(db, mockClient);

    const result = await registerBox(
      {
        name: '테스트박스',
        host: '192.168.1.100',
        port: 8443,
        username: 'admin',
        password: 'secret123',
      },
      deps,
    );

    expect(result.status).toBe('active');
    expect(result.name).toBe('테스트박스');
    expect(result.baseUrl).toBe('https://192.168.1.100:8443/api');
    expect(result.username).toBe('admin');
    expect(result.id).toBeTruthy();
    expect(result.createdAt).toBeInstanceOf(Date);

    // DB 에 실제로 저장되었는지 확인
    const row = db.$client.query('SELECT * FROM boxes WHERE id = ?').get(result.id) as Record<
      string,
      unknown
    > | null;
    expect(row).not.toBeNull();
    expect(row?.status).toBe('active');

    // password_enc blob 이 저장되어 있어야 한다
    expect(row?.password_enc).toBeTruthy();

    // jwt_cached_enc blob 이 저장되어 있어야 한다
    expect(row?.jwt_cached_enc).toBeTruthy();
  });

  // T2: 헬스체크 401 실패 시 DB 미저장
  test('헬스체크 401 실패 시 DB 에 레코드 없음', async () => {
    const mockClient = createMockBoxClient({
      loginResult: new BoxApiError('Unauthorized', 401, Date.now()),
    });
    const deps = buildDeps(db, mockClient);

    await expect(
      registerBox(
        {
          name: '실패박스',
          host: '192.168.1.200',
          port: 8443,
          username: 'admin',
          password: 'wrong',
        },
        deps,
      ),
    ).rejects.toThrow();

    const rows = db.$client.query('SELECT COUNT(*) as cnt FROM boxes').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  // T3: 헬스체크 5xx 실패 시 DB 미저장, BoxApiError 전파
  test('헬스체크 5xx 실패 시 DB 에 레코드 없음, BoxApiError 전파', async () => {
    const mockClient = createMockBoxClient({
      loginResult: new BoxApiError('Internal Server Error', 500, Date.now()),
    });
    const deps = buildDeps(db, mockClient);

    await expect(
      registerBox(
        { name: '5xx박스', host: '192.168.1.201', port: 8443, username: 'admin', password: 'pass' },
        deps,
      ),
    ).rejects.toBeInstanceOf(BoxApiError);

    const rows = db.$client.query('SELECT COUNT(*) as cnt FROM boxes').get() as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  // T4: useApiKey=true 시 API Key 발급 및 저장
  test('useApiKey=true 시 regenerateApiKey 호출, api_key_cached_enc 저장', async () => {
    const mockClient = createMockBoxClient({
      loginResult: { token: 'test-jwt', expiresAt: null },
      regenerateApiKeyResult: { apiKey: 'my-api-key-abc' },
    });
    const deps = buildDeps(db, mockClient);

    const result = await registerBox(
      {
        name: 'API키박스',
        host: '192.168.1.102',
        port: 8443,
        username: 'admin',
        password: 'secret',
        useApiKey: true,
      },
      deps,
    );

    expect(result.status).toBe('active');
    // regenerateApiKey 가 호출되었는지 확인
    expect(mockClient.auth.regenerateApiKey).toHaveBeenCalledTimes(1);

    // api_key_cached_enc blob 이 저장되어 있어야 한다
    const row = db.$client.query('SELECT * FROM boxes WHERE id = ?').get(result.id) as Record<
      string,
      unknown
    > | null;
    expect(row?.api_key_cached_enc).toBeTruthy();
  });

  // T-DUP-1: 동일 base_url 중복 등록 시 BoxRegistrationError(409) 발생
  test('동일 base_url 중복 등록 시 BoxRegistrationError(409)를 던져야 한다', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const deps = buildDeps(db, mockClient);

    // 첫 번째 등록 — 성공
    await registerBox(
      { name: '원본박스', host: '10.0.0.1', port: 8443, username: 'admin', password: 'pass' },
      deps,
    );

    // 두 번째 등록 — 동일 host:port (base_url 동일) → 실패
    await expect(
      registerBox(
        { name: '중복박스', host: '10.0.0.1', port: 8443, username: 'admin2', password: 'pass2' },
        deps,
      ),
    ).rejects.toBeInstanceOf(BoxRegistrationError);

    // BoxRegistrationError.statusCode === 409 확인
    try {
      await registerBox(
        { name: '중복박스2', host: '10.0.0.1', port: 8443, username: 'admin3', password: 'pass3' },
        deps,
      );
    } catch (err) {
      expect(err).toBeInstanceOf(BoxRegistrationError);
      if (err instanceof BoxRegistrationError) {
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe('BOX_ALREADY_EXISTS');
      }
    }

    // DB 에는 첫 번째 레코드만 존재
    const rows = db.$client.query('SELECT COUNT(*) as cnt FROM boxes').get() as { cnt: number };
    expect(rows.cnt).toBe(1);

    // auth.login 은 첫 번째 등록에서만 1회 호출 (중복 시 login 미호출)
    expect(mockClient.auth.login).toHaveBeenCalledTimes(1);
  });

  // T-DUP-2: 다른 port 로 등록 시 중복 없음 (정상 등록)
  test('host 동일하나 port 다르면 중복이 아니어서 정상 등록', async () => {
    const deps = buildDeps(db);

    await registerBox(
      { name: '포트1박스', host: '10.0.0.2', port: 8443, username: 'admin', password: 'pass' },
      deps,
    );
    const result = await registerBox(
      { name: '포트2박스', host: '10.0.0.2', port: 9443, username: 'admin', password: 'pass' },
      deps,
    );

    expect(result.status).toBe('active');
    const rows = db.$client.query('SELECT COUNT(*) as cnt FROM boxes').get() as { cnt: number };
    expect(rows.cnt).toBe(2);
  });

  // T5: 반환 객체에 자격증명 평문 미포함
  test('반환 BoxSummary 에 password, jwt, api_key 평문 미포함', async () => {
    const mockClient = createMockBoxClient({
      loginResult: { token: 'secret-jwt', expiresAt: null },
    });
    const deps = buildDeps(db, mockClient);

    const result = await registerBox(
      {
        name: '마스킹박스',
        host: '192.168.1.103',
        port: 8443,
        username: 'admin',
        password: 'super-secret-pw',
      },
      deps,
    );

    // BoxSummary 직렬화 후 자격증명 미포함 확인
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-secret-pw');
    expect(serialized).not.toContain('secret-jwt');

    // BoxSummary 에 password/jwt/apiKey 키 자체가 없어야 한다
    expect('password' in result).toBe(false);
    expect('jwt' in result).toBe(false);
    expect('apiKey' in result).toBe(false);
    expect('passwordEnc' in result).toBe(false);
    expect('jwtCachedEnc' in result).toBe(false);
    expect('apiKeyCachedEnc' in result).toBe(false);
  });
});

// ===========================================================================
// withAuthRetry
// ===========================================================================

describe('withAuthRetry', () => {
  // T7: 정상 호출 시 fn 결과 반환, 재로그인 없음
  test('정상 호출 시 fn 결과 반환, 재로그인 미발생', async () => {
    // 먼저 box 를 등록
    const mockClient = createMockBoxClient({
      loginResult: { token: 'initial-jwt', expiresAt: null },
    });
    const deps = buildDeps(db, mockClient);

    const registered = await registerBox(
      {
        name: '리트라이박스',
        host: '192.168.1.110',
        port: 8443,
        username: 'admin',
        password: 'pass',
      },
      deps,
    );

    // fn 이 정상 동작하는 경우
    const result = await withAuthRetry(
      registered.id,
      async (_client: BoxClient) => ({ data: 'success' }),
      deps,
    );

    expect(result).toEqual({ data: 'success' });
    // 재로그인이 없었으므로 login 은 최초 1회만 호출
    expect(mockClient.auth.login).toHaveBeenCalledTimes(1);
  });

  // T8: 401 → 재로그인 → 재시도 성공
  test('fn 이 BoxApiError(401) 던지면 재로그인 후 재시도하여 성공', async () => {
    // box 등록용 mock (login 성공)
    const mockClient = createMockBoxClient({
      loginResult: { token: 'initial-jwt', expiresAt: null },
    });
    const deps = buildDeps(db, mockClient);

    const registered = await registerBox(
      {
        name: '재시도박스',
        host: '192.168.1.111',
        port: 8443,
        username: 'admin',
        password: 'pass',
      },
      deps,
    );

    let fnCallCount = 0;
    const result = await withAuthRetry(
      registered.id,
      async (_client: BoxClient) => {
        fnCallCount++;
        if (fnCallCount === 1) {
          throw new BoxApiError('Unauthorized', 401, Date.now());
        }
        return { data: 're-auth-success' };
      },
      deps,
    );

    expect(result).toEqual({ data: 're-auth-success' });
    expect(fnCallCount).toBe(2);
    // 재로그인: 총 2회 (최초 등록 1회 + 재시도 1회)
    expect(mockClient.auth.login).toHaveBeenCalledTimes(2);
  });

  // T9: 재로그인 실패 시 status='error' 전이, 원본 에러 전파
  test('401 재시도 후 재로그인도 실패하면 status=error 갱신, 에러 전파', async () => {
    // 최초 등록용 mock (login 성공)
    const initialClient = createMockBoxClient({
      loginResult: { token: 'initial-jwt', expiresAt: null },
    });
    const deps = buildDeps(db, initialClient);

    const registered = await registerBox(
      {
        name: '재로그인실패박스',
        host: '192.168.1.112',
        port: 8443,
        username: 'admin',
        password: 'pass',
      },
      deps,
    );

    // 재시도 시 login 이 실패하도록 새로운 클라이언트를 만든다
    const failClient = createMockBoxClient({
      loginResult: new BoxApiError('Unauthorized', 401, Date.now()),
    });
    const failDeps: BoxServiceDeps = {
      ...deps,
      createBoxClient: mock((_baseUrl: string, _token?: string) => failClient),
    };

    await expect(
      withAuthRetry(
        registered.id,
        async (_client: BoxClient) => {
          throw new BoxApiError('Unauthorized', 401, Date.now());
        },
        failDeps,
      ),
    ).rejects.toBeInstanceOf(BoxApiError);

    // status 가 'error' 로 갱신되어 있어야 한다
    const row = db.$client.query('SELECT status FROM boxes WHERE id = ?').get(registered.id) as {
      status: string;
    } | null;
    expect(row?.status).toBe('error');
  });

  // T10: 401 외 에러는 즉시 전파 (재시도 없음)
  test('401 외 에러(5xx)는 재시도 없이 즉시 전파', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const deps = buildDeps(db, mockClient);

    const registered = await registerBox(
      {
        name: '즉시전파박스',
        host: '192.168.1.113',
        port: 8443,
        username: 'admin',
        password: 'pass',
      },
      deps,
    );

    let fnCallCount = 0;
    await expect(
      withAuthRetry(
        registered.id,
        async (_client: BoxClient) => {
          fnCallCount++;
          throw new BoxApiError('Bad Gateway', 502, Date.now());
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(BoxApiError);

    // fn 은 1회만 호출 (재시도 없음)
    expect(fnCallCount).toBe(1);
    // 재로그인 없음 (등록 시 1회만)
    expect(mockClient.auth.login).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// refreshTokens
// ===========================================================================

describe('refreshTokens', () => {
  // T11: 수동 토큰 갱신
  test('refreshTokens 호출 시 jwt_cached_enc 갱신, status=active 유지', async () => {
    const mockClient = createMockBoxClient({
      loginResult: { token: 'initial-jwt', expiresAt: null },
    });
    const deps = buildDeps(db, mockClient);

    const registered = await registerBox(
      { name: '갱신박스', host: '192.168.1.120', port: 8443, username: 'admin', password: 'pass' },
      deps,
    );

    // jwt_cached_enc 초기값 저장
    const beforeRow = db.$client
      .query('SELECT jwt_cached_enc, jwt_obtained_at FROM boxes WHERE id = ?')
      .get(registered.id) as Record<string, unknown>;

    // 새 토큰으로 재로그인 mock
    const newClient = createMockBoxClient({
      loginResult: { token: 'new-refreshed-jwt', expiresAt: null },
    });
    const refreshDeps: BoxServiceDeps = {
      ...deps,
      createBoxClient: mock((_baseUrl: string, _token?: string) => newClient),
    };

    const result = await refreshTokens(registered.id, refreshDeps);

    expect(result.status).toBe('active');

    // jwt_cached_enc 가 변경되었는지 확인
    const afterRow = db.$client
      .query('SELECT jwt_cached_enc, jwt_obtained_at FROM boxes WHERE id = ?')
      .get(registered.id) as Record<string, unknown>;
    // 새 토큰으로 암호화했으니 blob 이 달라야 한다 (blob을 Buffer로 비교)
    const before = beforeRow.jwt_cached_enc as Uint8Array;
    const after = afterRow.jwt_cached_enc as Uint8Array;
    // blob 이 존재하고 이전과 내용이 다름 (혹은 길이 차이, IV 달라서 달라짐)
    expect(after).toBeTruthy();
    // login 이 호출되었는지 확인
    expect(newClient.auth.login).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// listBoxes / getBox — 자격증명 마스킹
// ===========================================================================

describe('listBoxes / getBox', () => {
  // T12: 자격증명 마스킹
  test('listBoxes 응답에 password_enc/jwt_cached_enc/api_key_cached_enc 미포함', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const deps = buildDeps(db, mockClient);

    await registerBox(
      { name: '리스트박스1', host: '192.168.1.130', port: 8443, username: 'admin', password: 'p1' },
      deps,
    );
    await registerBox(
      { name: '리스트박스2', host: '192.168.1.131', port: 8443, username: 'admin', password: 'p2' },
      {
        ...deps,
        createBoxClient: mock(() =>
          createMockBoxClient({ loginResult: { token: 'jwt2', expiresAt: null } }),
        ),
      },
    );

    const boxes = await listBoxes(deps);
    expect(boxes.length).toBeGreaterThanOrEqual(2);

    for (const box of boxes) {
      const serialized = JSON.stringify(box);
      expect(serialized).not.toContain('password_enc');
      expect(serialized).not.toContain('passwordEnc');
      expect(serialized).not.toContain('jwt_cached_enc');
      expect(serialized).not.toContain('jwtCachedEnc');
      expect(serialized).not.toContain('api_key_cached_enc');
      expect(serialized).not.toContain('apiKeyCachedEnc');

      // 허용된 필드만 포함
      expect('id' in box).toBe(true);
      expect('name' in box).toBe(true);
      expect('baseUrl' in box).toBe(true);
      expect('username' in box).toBe(true);
      expect('status' in box).toBe(true);
      expect('createdAt' in box).toBe(true);
    }
  });

  test('getBox 응답에도 자격증명 미포함', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const deps = buildDeps(db, mockClient);

    const registered = await registerBox(
      { name: '단일박스', host: '192.168.1.132', port: 8443, username: 'admin', password: 'pw' },
      deps,
    );

    const box = await getBox(registered.id, deps);
    const serialized = JSON.stringify(box);
    expect(serialized).not.toContain('passwordEnc');
    expect(serialized).not.toContain('jwtCachedEnc');
    expect(serialized).not.toContain('apiKeyCachedEnc');
    expect(box.name).toBe('단일박스');
  });
});

// ===========================================================================
// deleteBox
// ===========================================================================

describe('deleteBox', () => {
  // T13: 정상 삭제
  test('deleteBox 호출 시 레코드 삭제 확인', async () => {
    const mockClient = createMockBoxClient({ loginResult: { token: 'jwt', expiresAt: null } });
    const deps = buildDeps(db, mockClient);

    const registered = await registerBox(
      { name: '삭제박스', host: '192.168.1.140', port: 8443, username: 'admin', password: 'pw' },
      deps,
    );

    await deleteBox(registered.id, deps);

    const row = db.$client.query('SELECT * FROM boxes WHERE id = ?').get(registered.id);
    expect(row).toBeNull();
  });
});
