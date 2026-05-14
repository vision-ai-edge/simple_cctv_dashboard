// TAG: BOX-CHANNELS-001
/**
 * SPEC-BOX-CHANNELS-001 — channels 라우트 통합 테스트.
 *
 * 검증 항목:
 *   - POST  /:id/channels/sync           — 동기화 트리거 (정상, 401, 404, 502)
 *   - GET   /:id/channels                — 채널 목록 조회 (정상, 401, 404)
 *   - POST  /:id/channels/:cid/start     — 채널 활성화 (정상, 401, 502)
 *   - POST  /:id/channels/:cid/stop      — 채널 비활성화 (정상, 401, 502)
 *   - GET   /:id/channels/:cid/snapshot  — 스냅샷 프록시 (정상, 401, 502, apikey 미포함)
 *   - GET   /:id/channels/:cid/hls/playlist.m3u8 — m3u8 프록시 (세그먼트 URL 재작성, apikey 미포함)
 *   - GET   /:id/channels/:cid/hls/segment/:name — 세그먼트 프록시
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

const TMP_DB = join(import.meta.dir, '.test-channels-integration.sqlite');
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

type MockChannelListResult = Array<{ id: string; name: string; status?: string }> | Error;

interface MockBoxClientOptions {
  channelListResult?: MockChannelListResult;
  startResult?: { success: boolean } | Error;
  stopResult?: { success: boolean } | Error;
  snapshotResult?: Response | Error;
  fetchImpl?: typeof globalThis.fetch;
}

function createMockBoxClient(opts: MockBoxClientOptions = {}): BoxClient {
  const channelListResult = opts.channelListResult ?? [];
  const startResult = opts.startResult ?? { success: true };
  const stopResult = opts.stopResult ?? { success: true };

  return {
    baseUrl: 'https://box.test:8443/api',
    channels: {
      list: mock(async () => {
        if (channelListResult instanceof Error) throw channelListResult;
        return channelListResult;
      }),
      start: mock(async (_id: string) => {
        if (startResult instanceof Error) throw startResult;
        return startResult;
      }),
      stop: mock(async (_id: string) => {
        if (stopResult instanceof Error) throw stopResult;
        return stopResult;
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
  fetchImpl?: typeof globalThis.fetch,
): { app: Hono; deps: BoxServiceDeps } {
  const createBoxClientFn = mock((_baseUrl: string, _token?: string) => {
    return mockClient ?? createMockBoxClient();
  });

  const deps: BoxServiceDeps = {
    db,
    vaultKey: TEST_VAULT_KEY,
    createBoxClient: createBoxClientFn,
  };

  // fetch를 mock으로 교체 (스냅샷/HLS 프록시 테스트용)
  if (fetchImpl) {
    // biome-ignore lint/suspicious/noExplicitAny: 테스트용 fetch mock 주입
    (globalThis as any).fetch = fetchImpl;
  }

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

function insertCamera(db: Db, id: string, boxId: string, channelId: string) {
  db.$client
    .prepare(
      `INSERT INTO cameras (id, box_id, channel_id, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'online', ?, ?)`,
    )
    .run(id, boxId, channelId, `Camera-${channelId}`, Date.now(), Date.now());
}

// ---------------------------------------------------------------------------
// setup / teardown
// ---------------------------------------------------------------------------

let db: Db;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  cleanup();
  await runMigrations({ databasePath: TMP_DB });
  db = createDb(TMP_DB);
});

afterEach(() => {
  db.$client.close();
  // biome-ignore lint/suspicious/noExplicitAny: fetch 복원
  (globalThis as any).fetch = originalFetch;
  cleanup();
});

// ===========================================================================
// POST /api/boxes/:id/channels/sync
// ===========================================================================

describe('POST /api/boxes/:id/channels/sync', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels/sync', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('존재하지 않는 Box → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u1', password: 'pass123' });

    const res = await app.request('/api/boxes/no-such-box/channels/sync', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(404);
  });

  test('정상 동기화 → 200 + { success, synced, failed, timestamp }', async () => {
    insertBox(db);
    const mockClient = createMockBoxClient({
      channelListResult: [
        { id: 'ch-1', name: '채널 1', status: 'RUNNING' },
        { id: 'ch-2', name: '채널 2', status: 'STOPPED' },
      ],
    });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u2', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/sync', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      synced: number;
      failed: number;
      timestamp: number;
    };
    expect(body.success).toBe(true);
    expect(body.synced).toBe(2);
    expect(body.failed).toBe(0);
    expect(typeof body.timestamp).toBe('number');
  });

  test('Box API 오류 → 502', async () => {
    insertBox(db);
    const mockClient = createMockBoxClient({
      channelListResult: new Error('Box 연결 실패'),
    });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u3', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u3', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/sync', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// GET /api/boxes/:id/channels
// ===========================================================================

describe('GET /api/boxes/:id/channels', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels');
    expect(res.status).toBe(401);
  });

  test('존재하지 않는 Box → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u4', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u4', password: 'pass123' });

    const res = await app.request('/api/boxes/no-such-box/channels', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(404);
  });

  test('채널 목록 반환 — 정상', async () => {
    insertBox(db);
    insertCamera(db, 'cam-001', 'box-001', 'ch-A');
    insertCamera(db, 'cam-002', 'box-001', 'ch-B');
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u5', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u5', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { channels: Array<{ channelId: string }> };
    expect(body.channels).toHaveLength(2);
    const ids = body.channels.map((ch) => ch.channelId);
    expect(ids).toContain('ch-A');
    expect(ids).toContain('ch-B');
  });

  test('빈 채널 목록 — 빈 배열 반환', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u6', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u6', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { channels: unknown[] };
    expect(body.channels).toHaveLength(0);
  });
});

// ===========================================================================
// POST /api/boxes/:id/channels/:channelId/start
// ===========================================================================

describe('POST /:id/channels/:channelId/start', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels/ch-1/start', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('정상 활성화 → { success: true }', async () => {
    insertBox(db);
    const mockClient = createMockBoxClient({ startResult: { success: true } });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u7', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u7', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/start', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('Box API 오류 → 502', async () => {
    insertBox(db);
    const mockClient = createMockBoxClient({ startResult: new Error('Box 연결 실패') });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u8', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u8', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/start', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });

  test('존재하지 않는 Box → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u9', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u9', password: 'pass123' });

    const res = await app.request('/api/boxes/no-box/channels/ch-1/start', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// POST /api/boxes/:id/channels/:channelId/stop
// ===========================================================================

describe('POST /:id/channels/:channelId/stop', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels/ch-1/stop', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('정상 비활성화 → { success: true }', async () => {
    insertBox(db);
    const mockClient = createMockBoxClient({ stopResult: { success: true } });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u10', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u10', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/stop', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('Box API 오류 → 502', async () => {
    insertBox(db);
    const mockClient = createMockBoxClient({ stopResult: new Error('오류') });
    const { app } = buildApp(db, mockClient);
    await createTestUser(db, { username: 'u11', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u11', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/stop', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// GET /api/boxes/:id/channels/:channelId/snapshot
// ===========================================================================

describe('GET /:id/channels/:channelId/snapshot', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels/ch-1/snapshot');
    expect(res.status).toBe(401);
  });

  test('정상 스냅샷 프록시 — 이미지 반환, 응답에 apikey 없음', async () => {
    insertBox(db);
    const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
    const mockFetch = mock(async (url: string) => {
      // apikey가 클라이언트 측에서 노출되지 않아야 함 (서버-Box 구간)
      // URL에서 apikey 검증은 여기서 하지 않음 (서버-Box 간 통신)
      return new Response(imageData, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    });
    // biome-ignore lint/suspicious/noExplicitAny: fetch mock 주입
    (globalThis as any).fetch = mockFetch;

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u12', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u12', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/snapshot', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/jpeg');

    // 응답 헤더에 자격증명 없음 확인
    const authHeader = res.headers.get('Authorization');
    const apiKeyHeader = res.headers.get('X-API-Key');
    expect(authHeader).toBeNull();
    expect(apiKeyHeader).toBeNull();
  });

  test('Box 미발견 → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u13', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u13', password: 'pass123' });

    const res = await app.request('/api/boxes/no-box/channels/ch-1/snapshot', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(404);
  });

  test('Box API 오류 → 502', async () => {
    insertBox(db);
    const mockFetch = mock(async () => {
      return new Response('Box 오류', { status: 500 });
    });
    // biome-ignore lint/suspicious/noExplicitAny: fetch mock 주입
    (globalThis as any).fetch = mockFetch;

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u14', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u14', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/snapshot', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// GET /api/boxes/:id/channels/:channelId/hls/playlist.m3u8
// ===========================================================================

describe('GET /:id/channels/:channelId/hls/playlist.m3u8', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels/ch-1/hls/playlist.m3u8');
    expect(res.status).toBe(401);
  });

  const sampleM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
https://box.test:8443/hls/ch-1/seg-001.ts?apikey=SECRET_API_KEY
#EXTINF:4.0,
https://box.test:8443/hls/ch-1/seg-002.ts?apikey=SECRET_API_KEY
#EXT-X-ENDLIST`;

  test('m3u8 세그먼트 URL 재작성 — apikey 없음', async () => {
    insertBox(db);
    const mockFetch = mock(async (_url: string) => {
      return new Response(sampleM3u8, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      });
    });
    // biome-ignore lint/suspicious/noExplicitAny: fetch mock 주입
    (globalThis as any).fetch = mockFetch;

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u15', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u15', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/hls/playlist.m3u8', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/vnd.apple.mpegurl');

    const body = await res.text();
    // 세그먼트 URL이 자체 도메인으로 재작성되어야 함
    expect(body).toContain('/api/boxes/box-001/channels/ch-1/hls/segment/seg-001.ts');
    expect(body).toContain('/api/boxes/box-001/channels/ch-1/hls/segment/seg-002.ts');
    // 원본 Box 도메인 직접 접근 없어야 함
    expect(body).not.toContain('box.test');
    // apikey가 재작성된 URL에 포함되지 않아야 함
    expect(body).not.toContain('SECRET_API_KEY');
    expect(body).not.toContain('apikey=');
  });

  test('Box API 오류 → 502', async () => {
    insertBox(db);
    const mockFetch = mock(async () => {
      return new Response('오류', { status: 503 });
    });
    // biome-ignore lint/suspicious/noExplicitAny: fetch mock 주입
    (globalThis as any).fetch = mockFetch;

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u16', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u16', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/hls/playlist.m3u8', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });

  test('Box 미발견 → 404', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u17', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u17', password: 'pass123' });

    const res = await app.request('/api/boxes/no-box/channels/ch-1/hls/playlist.m3u8', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// GET /api/boxes/:id/channels/:channelId/hls/segment/:name
// ===========================================================================

describe('GET /:id/channels/:channelId/hls/segment/:name', () => {
  test('인증 없이 요청 시 401', async () => {
    insertBox(db);
    const { app } = buildApp(db);
    const res = await app.request('/api/boxes/box-001/channels/ch-1/hls/segment/seg-001.ts');
    expect(res.status).toBe(401);
  });

  test('세그먼트 스트리밍 — video/mp2t, Cache-Control: no-store', async () => {
    insertBox(db);
    const segData = new Uint8Array([0x47, 0x40, 0x00, 0x10]); // MPEG-TS sync byte
    const mockFetch = mock(async () => {
      return new Response(segData, {
        status: 200,
        headers: { 'Content-Type': 'video/mp2t' },
      });
    });
    // biome-ignore lint/suspicious/noExplicitAny: fetch mock 주입
    (globalThis as any).fetch = mockFetch;

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u18', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u18', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/hls/segment/seg-001.ts', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('video/mp2t');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('Box API 오류 → 502', async () => {
    insertBox(db);
    const mockFetch = mock(async () => {
      return new Response('오류', { status: 500 });
    });
    // biome-ignore lint/suspicious/noExplicitAny: fetch mock 주입
    (globalThis as any).fetch = mockFetch;

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'u19', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'u19', password: 'pass123' });

    const res = await app.request('/api/boxes/box-001/channels/ch-1/hls/segment/seg-001.ts', {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(502);
  });
});
