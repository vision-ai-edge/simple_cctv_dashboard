/**
 * SPEC-AUTH-001 — 인증 API 통합 테스트.
 *
 * AC-AUTH-001 ~ AC-AUTH-007 + T5 엣지 케이스 검증.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, runMigrations } from '@cctv/db';
import { Hono } from 'hono';
import {
  buildCookieHeader,
  createTestUser,
  loginAs,
  parseSetCookies,
} from '../../__tests__/helpers/authFixtures';
import { createAuthRoutes } from '../auth';

const TMP_DB = join(import.meta.dir, '.test-auth-integration.sqlite');
const JWT_SECRET = 'test-secret-key-must-be-at-least-32-bytes-long!!';

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// 테스트용 Hono 앱 생성
function buildApp() {
  const db = createDb(TMP_DB);
  const app = new Hono();
  app.route('/api/auth', createAuthRoutes({ db, jwtSecret: JWT_SECRET }));
  return { app, db };
}

beforeEach(async () => {
  cleanup();
  await runMigrations({ databasePath: TMP_DB });
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
// AC-AUTH-001: 로그인 성공
// ---------------------------------------------------------------------------
describe('POST /api/auth/login — 성공 (AC-AUTH-001)', () => {
  test('200 응답, user 객체 반환', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser', password: 'password123' });

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password123' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      user: { id: string; username: string };
    };
    expect(body.success).toBe(true);
    expect(body.user.username).toBe('testuser');
    expect(body.user.id).toBeTruthy();
  });

  test('access_token 쿠키: HttpOnly, SameSite=Lax, Path=/, Max-Age=900', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser2', password: 'password123' });

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser2', password: 'password123' }),
    });

    const cookies = parseSetCookies(res);
    const accessCookie = cookies.get('access_token');

    expect(accessCookie).toBeDefined();
    expect(accessCookie?.value).toBeTruthy();
    expect(accessCookie?.attrs.httponly).toBe(true);
    expect(accessCookie?.attrs.samesite).toBe('Lax');
    expect(accessCookie?.attrs.path).toBe('/');
    expect(accessCookie?.attrs['max-age']).toBe('900');
  });

  test('refresh_token 쿠키: HttpOnly, SameSite=Lax, Path=/, Max-Age=604800', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser3', password: 'password123' });

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser3', password: 'password123' }),
    });

    const cookies = parseSetCookies(res);
    const refreshCookie = cookies.get('refresh_token');

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.attrs.httponly).toBe(true);
    expect(refreshCookie?.attrs.samesite).toBe('Lax');
    expect(refreshCookie?.attrs['max-age']).toBe('604800');
  });
});

// ---------------------------------------------------------------------------
// AC-AUTH-002: 로그인 실패 — 잘못된 비밀번호
// ---------------------------------------------------------------------------
describe('POST /api/auth/login — 실패 (AC-AUTH-002)', () => {
  test('잘못된 비밀번호: 401, 통일된 오류 메시지', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser4', password: 'correct-password' });

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser4', password: 'wrong-password' }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success: boolean;
      error: string;
      code: string;
    };
    expect(body.success).toBe(false);
    expect(body.code).toBe('INVALID_CREDENTIALS');
    expect(body.error).toBe('아이디 또는 비밀번호가 올바르지 않습니다');
    // Set-Cookie 헤더가 없어야 한다
    const cookies = parseSetCookies(res);
    expect(cookies.size).toBe(0);
  });

  test('존재하지 않는 사용자: 401, 동일한 오류 메시지 (타이밍 안전)', async () => {
    const { app } = buildApp();

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nonexistent', password: 'any-password' }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('INVALID_CREDENTIALS');
    expect(body.error).toBe('아이디 또는 비밀번호가 올바르지 않습니다');
  });
});

// ---------------------------------------------------------------------------
// 로그인 입력 유효성 검사
// ---------------------------------------------------------------------------
describe('POST /api/auth/login — 유효성 검사', () => {
  test('username 누락: 422 또는 400', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    });
    expect([400, 422]).toContain(res.status);
  });

  test('password 누락: 422 또는 400', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser' }),
    });
    expect([400, 422]).toContain(res.status);
  });

  test('username 65자 초과: 422 또는 400', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'a'.repeat(65), password: 'password123' }),
    });
    expect([400, 422]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// AC-AUTH-003: 로그아웃
// ---------------------------------------------------------------------------
describe('POST /api/auth/logout (AC-AUTH-003)', () => {
  test('200 응답, 두 쿠키 Max-Age=0, JTI 블랙리스트 등록', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser5', password: 'password123' });

    // 로그인
    const loginResult = await loginAs(app, {
      username: 'testuser5',
      password: 'password123',
    });

    // 로그아웃
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: loginResult.cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    // 쿠키 Max-Age=0 확인
    const cookies = parseSetCookies(res);
    const accessCookie = cookies.get('access_token');
    const refreshCookie = cookies.get('refresh_token');
    expect(accessCookie?.attrs['max-age']).toBe('0');
    expect(refreshCookie?.attrs['max-age']).toBe('0');
  });

  test('로그아웃 후 이전 액세스 토큰으로 접근 불가 (TOKEN_REVOKED)', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser6', password: 'password123' });

    const loginResult = await loginAs(app, {
      username: 'testuser6',
      password: 'password123',
    });

    // 로그아웃
    await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: loginResult.cookieHeader },
    });

    // 로그아웃 후 /me 접근 시도
    const meRes = await app.request('/api/auth/me', {
      headers: { Cookie: `access_token=${loginResult.accessToken}` },
    });

    expect(meRes.status).toBe(401);
    const body = (await meRes.json()) as { code: string };
    expect(body.code).toBe('TOKEN_REVOKED');
  });
});

// ---------------------------------------------------------------------------
// AC-AUTH-004: /me
// ---------------------------------------------------------------------------
describe('GET /api/auth/me (AC-AUTH-004)', () => {
  test('유효한 토큰: 200, user 객체 반환', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, {
      username: 'testuser7',
      password: 'password123',
      email: 'testuser7@example.com',
    });

    const loginResult = await loginAs(app, {
      username: 'testuser7',
      password: 'password123',
    });

    const res = await app.request('/api/auth/me', {
      headers: { Cookie: `access_token=${loginResult.accessToken}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      user: { id: string; username: string; email: string };
    };
    expect(body.success).toBe(true);
    expect(body.user.username).toBe('testuser7');
    expect(body.user.email).toBe('testuser7@example.com');
  });

  test('쿠키 없음: 401', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// AC-AUTH-005: 토큰 갱신
// ---------------------------------------------------------------------------
describe('POST /api/auth/refresh (AC-AUTH-005)', () => {
  test('유효한 리프레시 토큰: 200, 새 토큰 발급, 기존 리프레시 JTI 블랙리스트 등록', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser8', password: 'password123' });

    const loginResult = await loginAs(app, {
      username: 'testuser8',
      password: 'password123',
    });

    // 토큰 갱신
    const refreshRes = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${loginResult.refreshToken}` },
    });

    expect(refreshRes.status).toBe(200);
    const body = (await refreshRes.json()) as { success: boolean };
    expect(body.success).toBe(true);

    // 새 쿠키가 발급되어야 한다
    const newCookies = parseSetCookies(refreshRes);
    const newAccessCookie = newCookies.get('access_token');
    const newRefreshCookie = newCookies.get('refresh_token');
    expect(newAccessCookie?.value).toBeTruthy();
    expect(newRefreshCookie?.value).toBeTruthy();
    // 새 토큰은 기존과 달라야 한다
    expect(newAccessCookie?.value).not.toBe(loginResult.accessToken);
    expect(newRefreshCookie?.value).not.toBe(loginResult.refreshToken);

    // 기존 리프레시 JTI 가 블랙리스트에 등록되어야 한다
    const { parseTokenClaims } = await import('@cctv/shared');
    const oldRefreshClaims = parseTokenClaims(loginResult.refreshToken);
    const oldRefreshJti = oldRefreshClaims?.jti ?? '';
    const blacklisted = db.$client
      .query('SELECT 1 FROM auth_token_blacklist WHERE jti = ?')
      .get(oldRefreshJti);
    expect(blacklisted).not.toBeNull();
  });

  test('블랙리스트에 등록된 리프레시 토큰: 401', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser9', password: 'password123' });

    const loginResult = await loginAs(app, {
      username: 'testuser9',
      password: 'password123',
    });

    // 첫 갱신 (정상) — 기존 토큰이 블랙리스트에 등록됨
    await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${loginResult.refreshToken}` },
    });

    // 기존 토큰으로 재갱신 시도 (REQ-AUTH-016: 재사용 탐지)
    const reuseRes = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${loginResult.refreshToken}` },
    });

    expect(reuseRes.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// REQ-AUTH-016: 리프레시 토큰 재사용 탐지 (시나리오)
// ---------------------------------------------------------------------------
describe('REQ-AUTH-016: 리프레시 토큰 재사용 탐지', () => {
  test('rotate 후 이전 리프레시 토큰 사용 시 401, JTI 블랙리스트 등록', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser10', password: 'password123' });

    const loginResult = await loginAs(app, {
      username: 'testuser10',
      password: 'password123',
    });

    // 1차 갱신 (정상)
    const firstRefreshRes = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${loginResult.refreshToken}` },
    });
    expect(firstRefreshRes.status).toBe(200);

    // 기존 리프레시 토큰(이제 블랙리스트)으로 재갱신 시도
    const reuseRes = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh_token=${loginResult.refreshToken}` },
    });

    expect(reuseRes.status).toBe(401);

    // 공격자가 사용한 JTI 가 블랙리스트에 있어야 한다
    const { parseTokenClaims } = await import('@cctv/shared');
    const oldRefreshClaims = parseTokenClaims(loginResult.refreshToken);
    const attackerJti = oldRefreshClaims?.jti ?? '';
    const blacklisted = db.$client
      .query('SELECT 1 FROM auth_token_blacklist WHERE jti = ?')
      .get(attackerJti);
    expect(blacklisted).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 쿠키 속성 검증 (NODE_ENV 별)
// ---------------------------------------------------------------------------
describe('쿠키 속성: NODE_ENV 별 Secure 플래그', () => {
  test('개발 환경(test): Secure 플래그 없음', async () => {
    const db = createDb(TMP_DB);
    const app = new Hono();
    // NODE_ENV=test 가 기본값 — buildCookieOptions 에서 secure: false
    app.route('/api/auth', createAuthRoutes({ db, jwtSecret: JWT_SECRET, nodeEnv: 'test' }));
    await createTestUser(db, { username: 'testuser11', password: 'password123' });

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser11', password: 'password123' }),
    });

    const cookies = parseSetCookies(res);
    const accessCookie = cookies.get('access_token');
    // 비프로덕션: secure 플래그 없어야 한다
    expect(accessCookie?.attrs.secure).toBeUndefined();
  });

  test('프로덕션 환경: Secure 플래그 포함', async () => {
    // 새 DB 파일 사용 (기존 파일과 충돌 방지)
    const PROD_DB = TMP_DB.replace('.test-auth-integration', '.test-auth-prod');
    for (const ext of ['', '-shm', '-wal']) {
      if (existsSync(`${PROD_DB}${ext}`)) unlinkSync(`${PROD_DB}${ext}`);
    }
    await runMigrations({ databasePath: PROD_DB });

    const prodDb = createDb(PROD_DB);
    const prodApp = new Hono();
    prodApp.route(
      '/api/auth',
      createAuthRoutes({ db: prodDb, jwtSecret: JWT_SECRET, nodeEnv: 'production' }),
    );
    await createTestUser(prodDb, { username: 'produser', password: 'password123' });

    const res = await prodApp.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'produser', password: 'password123' }),
    });

    const cookies = parseSetCookies(res);
    const accessCookie = cookies.get('access_token');
    expect(accessCookie?.attrs.secure).toBe(true);

    // 정리
    for (const ext of ['', '-shm', '-wal']) {
      if (existsSync(`${PROD_DB}${ext}`)) unlinkSync(`${PROD_DB}${ext}`);
    }
  });
});

// ---------------------------------------------------------------------------
// T5: 레이트 리미팅 — POST /login 에만 적용 검증
// ---------------------------------------------------------------------------
describe('레이트 리미팅 — POST /login', () => {
  test('5회 실패 로그인 후 6번째는 429 RATE_LIMITED', async () => {
    const { app } = buildApp();

    // 5번 시도 (실패여도 카운터 증가)
    for (let i = 0; i < 5; i++) {
      await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.1',
        },
        body: JSON.stringify({ username: 'nonexistent', password: 'wrong' }),
      });
    }

    // 6번째 요청: 레이트 리미팅
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.1',
      },
      body: JSON.stringify({ username: 'nonexistent', password: 'wrong' }),
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('RATE_LIMITED');
    expect(res.headers.get('Retry-After')).not.toBeNull();
  });

  test('/me 는 레이트 리미팅 없음 — 반복 접근 가능', async () => {
    const { app, db } = buildApp();
    await createTestUser(db, { username: 'testuser12', password: 'password123' });
    const loginResult = await loginAs(app, {
      username: 'testuser12',
      password: 'password123',
    });

    // /me 를 10번 호출해도 통과
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/api/auth/me', {
        headers: { Cookie: `access_token=${loginResult.accessToken}` },
      });
      expect(res.status).toBe(200);
    }
  });
});
