/**
 * SPEC-AUTH-001 — requireAuth 미들웨어 테스트.
 *
 * RED 단계: requireAuth.ts 가 없으므로 모두 실패한다.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, runMigrations } from '@cctv/db';
import { signAccessToken, signRefreshToken } from '@cctv/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { createRequireAuth } from '../requireAuth';

const TMP_DB = join(import.meta.dir, '.test-requireauth.sqlite');
const JWT_SECRET = 'test-secret-key-must-be-at-least-32-bytes-long!!';

// 테스트 DB 정리 헬퍼
function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// 테스트용 최소 Hono 앱 생성 헬퍼
function buildTestApp(jwtSecret = JWT_SECRET) {
  const db = createDb(TMP_DB);
  const requireAuth = createRequireAuth({ db, jwtSecret });
  const app = new Hono();
  app.use('*', requireAuth);
  app.get('/test', (c) => c.json({ ok: true, userId: c.var.userId, tokenJti: c.var.tokenJti }));
  return app;
}

// 테스트용 사용자 삽입 헬퍼
function insertTestUser(db: ReturnType<typeof createDb>, userId: string) {
  const { $client: sqlite } = db;
  sqlite
    .prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(userId, `user-${userId}`, `${userId}@test.com`, '$2b$04$dummy');
}

beforeEach(async () => {
  cleanup();
  await runMigrations({ databasePath: TMP_DB });
});
afterEach(cleanup);

describe('requireAuth 미들웨어', () => {
  test('쿠키가 없으면 401 UNAUTHENTICATED 반환', async () => {
    const app = buildTestApp();
    const res = await app.request('/test');
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success: boolean;
      error: string;
      code: string;
    };
    expect(body.success).toBe(false);
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  test('유효한 액세스 토큰 — next 호출, userId/tokenJti 설정', async () => {
    const userId = ulid();
    const db = createDb(TMP_DB);
    insertTestUser(db, userId);
    const jti = ulid();
    const token = await signAccessToken({ sub: userId, jti }, JWT_SECRET);

    const requireAuth = createRequireAuth({ db, jwtSecret: JWT_SECRET });
    const app = new Hono();
    app.use('*', requireAuth);
    app.get('/test', (c) => c.json({ ok: true, userId: c.var.userId, tokenJti: c.var.tokenJti }));

    const res = await app.request('/test', {
      headers: { Cookie: `access_token=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      userId: string;
      tokenJti: string;
    };
    expect(body.ok).toBe(true);
    expect(body.userId).toBe(userId);
    expect(body.tokenJti).toBe(jti);
  });

  test('만료된 토큰 — 401 TOKEN_EXPIRED', async () => {
    // 이미 만료된 토큰 생성
    const { SignJWT } = await import('jose');
    const secretKey = new TextEncoder().encode(JWT_SECRET);
    const expiredToken = await new SignJWT({ jti: 'jti-expired' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-001')
      .setIssuer('simple_cctv')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secretKey);

    const app = buildTestApp();
    const res = await app.request('/test', {
      headers: { Cookie: `access_token=${expiredToken}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; code: string };
    expect(body.code).toBe('TOKEN_EXPIRED');
  });

  test('잘못된 서명 토큰 — 401 TOKEN_INVALID', async () => {
    const token = await signAccessToken(
      { sub: 'user-001', jti: 'jti-invalid' },
      'wrong-secret-key-must-be-at-least-32-bytes-long!',
    );
    const app = buildTestApp(); // JWT_SECRET 으로 검증
    const res = await app.request('/test', {
      headers: { Cookie: `access_token=${token}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('TOKEN_INVALID');
  });

  test('블랙리스트에 등록된 jti — 401 TOKEN_REVOKED', async () => {
    const userId = ulid();
    const db = createDb(TMP_DB);
    insertTestUser(db, userId);
    const jti = ulid();
    const token = await signAccessToken({ sub: userId, jti }, JWT_SECRET);

    // JTI 블랙리스트에 등록
    const { $client: sqlite } = db;
    sqlite
      .prepare(
        'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(ulid(), jti, userId, Date.now() + 900_000, Date.now());

    const requireAuth = createRequireAuth({ db, jwtSecret: JWT_SECRET });
    const app = new Hono();
    app.use('*', requireAuth);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { Cookie: `access_token=${token}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('TOKEN_REVOKED');
  });

  test('리프레시 토큰을 액세스 보호 라우트에 사용 시 401 TOKEN_INVALID', async () => {
    const userId = ulid();
    const db = createDb(TMP_DB);
    insertTestUser(db, userId);
    const refreshToken = await signRefreshToken({ sub: userId, jti: ulid() }, JWT_SECRET);

    const requireAuth = createRequireAuth({ db, jwtSecret: JWT_SECRET });
    const app = new Hono();
    app.use('*', requireAuth);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { Cookie: `access_token=${refreshToken}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('TOKEN_INVALID');
  });
});
