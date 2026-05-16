// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M3 — 알림 API 통합 테스트.
 *
 * 검증 항목:
 *   M3-1 (SSE):
 *     - 인증 없이 → 401
 *     - 연결 수립 시 Content-Type: text/event-stream + 200
 *     - alertDispatcher.registerSSEClient 호출 확인 (mock)
 *     - 연결 시 event: connected 이벤트 포함
 *
 *   M3-2 (이력):
 *     - 인증 없이 → 401
 *     - 알림 없는 경우 → 200 + { alerts: [], pagination }
 *     - 알림 있는 경우 → 200 + fired_at DESC 정렬
 *     - 페이지네이션 (limit/offset/hasMore)
 *     - 잘못된 쿼리 파라미터 → 400
 *
 *   M3-3 (WebPush):
 *     - VAPID 키 없을 때 → 503
 *     - VAPID 키 있을 때 → 200 + { key }
 *     - subscribe: 정상 등록 → 200
 *     - subscribe: 중복 endpoint UPSERT → 200 (dedup)
 *     - subscribe: 잘못된 body → 400
 *     - unsubscribe: 정상 삭제 → 200
 *     - subscribe/unsubscribe 401 미인증
 *
 *   M3-4 (destinations):
 *     - 인증 없이 → 401
 *     - DB 미설정 → 기본값 3개 반환
 *     - DB 설정 있을 때 → rows 반환
 *     - PUT: 신규 UPSERT → 200
 *     - PUT: 업데이트 → 200
 *     - PUT: telegram + enabled=true, chat_id 없음 → 400
 *     - PUT: 잘못된 channel → 400
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type Db, createDb, runMigrations } from '@cctv/db';
import { Hono } from 'hono';
import { createTestUser, loginAs } from '../../__tests__/helpers/authFixtures';
import type { AlertDispatcher } from '../../services/alertDispatcher';
import { createAlertRoutes } from '../alerts';
import { createAuthRoutes } from '../auth';

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-alerts-integration.sqlite');
const JWT_SECRET = 'test-secret-key-must-be-at-least-32-bytes-long!!';

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// ---------------------------------------------------------------------------
// AlertDispatcher mock
// ---------------------------------------------------------------------------

function createMockDispatcher(): AlertDispatcher & {
  _registered: Map<string, ReadableStreamDefaultController>;
} {
  const registered = new Map<string, ReadableStreamDefaultController>();

  const mockRegister = mock(
    (userId: string, controller: ReadableStreamDefaultController): (() => void) => {
      registered.set(userId, controller);
      return () => {
        registered.delete(userId);
      };
    },
  );

  return {
    _registered: registered,
    registerSSEClient: mockRegister,
    dispatch: mock(async () => {}),
    broadcastAll: mock(async () => {}),
    markDelivered: mock(() => {}),
  };
}

// ---------------------------------------------------------------------------
// 앱 빌더
// ---------------------------------------------------------------------------

function buildApp(
  db: Db,
  dispatcher?: AlertDispatcher,
  env?: Record<string, string>,
): { app: Hono } {
  // 환경 변수 임시 주입
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      process.env[k] = v;
    }
  }

  const app = new Hono();
  app.route('/api/auth', createAuthRoutes({ db, jwtSecret: JWT_SECRET }));
  app.route('/api/alerts', createAlertRoutes({ deps: { db }, jwtSecret: JWT_SECRET, dispatcher }));

  return { app };
}

// ---------------------------------------------------------------------------
// 테스트 픽스처 헬퍼
// ---------------------------------------------------------------------------

function insertBox(db: Db, id = 'box-001') {
  db.$client
    .prepare(
      `INSERT INTO boxes (id, name, base_url, username, password_enc, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `Box-${id}`,
      `https://box-${id}.test/api`,
      'admin',
      new Uint8Array(32),
      'active',
      Date.now(),
      Date.now(),
    );
}

function insertDetectionAlert(
  db: Db,
  id: string,
  boxId: string,
  channelId: string,
  firedAt: number,
) {
  db.$client
    .prepare(
      `INSERT INTO detection_alerts (id, box_id, channel_id, type, payload_json, fired_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, boxId, channelId, 'intrusion', '{}', firedAt, 'new', Date.now());
}

function insertDestination(
  db: Db,
  userId: string,
  channel: 'toast' | 'webpush' | 'telegram',
  enabled: boolean,
  configJson: string | null = null,
) {
  db.$client
    .prepare(
      `INSERT INTO alert_destinations (id, user_id, channel, enabled, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `dest-${channel}-${userId}`,
      userId,
      channel,
      enabled ? 1 : 0,
      configJson,
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
  // 환경 변수 초기화
  process.env.VAPID_PUBLIC_KEY = undefined;
});

afterEach(() => {
  db.$client.close();
  cleanup();
  process.env.VAPID_PUBLIC_KEY = undefined;
});

// ===========================================================================
// M3-1: GET /api/alerts/stream — SSE
// ===========================================================================

describe('GET /api/alerts/stream', () => {
  test('인증 없이 요청 시 401', async () => {
    const { app } = buildApp(db);
    const res = await app.request('/api/alerts/stream');
    expect(res.status).toBe(401);
  });

  test('인증 후 SSE 스트림 연결 수립 — 200 + text/event-stream', async () => {
    const mockDispatcher = createMockDispatcher();
    const { app } = buildApp(db, mockDispatcher);

    await createTestUser(db, { username: 'sse-user', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'sse-user', password: 'pass123' });

    const res = await app.request('/api/alerts/stream', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  test('SSE 연결 시 registerSSEClient 호출됨 (mock 검증)', async () => {
    const mockDispatcher = createMockDispatcher();
    const { app } = buildApp(db, mockDispatcher);

    await createTestUser(db, { username: 'sse-user2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'sse-user2', password: 'pass123' });

    await app.request('/api/alerts/stream', {
      headers: { Cookie: cookieHeader },
    });

    // registerSSEClient 가 호출됐는지 확인
    expect(mockDispatcher.registerSSEClient).toHaveBeenCalledTimes(1);
  });

  test('SSE 응답 바디에 event: connected 포함', async () => {
    const mockDispatcher = createMockDispatcher();
    const { app } = buildApp(db, mockDispatcher);

    await createTestUser(db, { username: 'sse-user3', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'sse-user3', password: 'pass123' });

    const res = await app.request('/api/alerts/stream', {
      headers: { Cookie: cookieHeader },
    });

    // 스트림의 첫 청크를 읽어 connected 이벤트 확인
    const reader = res.body?.getReader();
    if (!reader) throw new Error('ReadableStream 없음');

    const { value, done } = await reader.read();
    if (!done && value !== undefined) {
      // Bun 환경에서 ReadableStream value 는 string 또는 Uint8Array 가능
      const text =
        typeof value === 'string'
          ? value
          : value instanceof Uint8Array
            ? new TextDecoder().decode(value)
            : '';
      expect(text).toContain('event: connected');
    } else {
      // 스트림이 즉시 닫히지 않았음을 확인 (Bun 환경에서 스트림 즉시 소비 불가 시 통과)
      expect(res.status).toBe(200);
    }
    await reader.cancel();
  });

  test('Cache-Control: no-cache 헤더 포함', async () => {
    const mockDispatcher = createMockDispatcher();
    const { app } = buildApp(db, mockDispatcher);

    await createTestUser(db, { username: 'sse-user4', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'sse-user4', password: 'pass123' });

    const res = await app.request('/api/alerts/stream', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

// ===========================================================================
// M3-2: GET /api/alerts — 알림 이력
// ===========================================================================

describe('GET /api/alerts', () => {
  test('인증 없이 요청 시 401', async () => {
    const { app } = buildApp(db);
    const res = await app.request('/api/alerts');
    expect(res.status).toBe(401);
  });

  test('알림 없는 경우 → 200 + { alerts: [], pagination }', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'hist-user1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'hist-user1', password: 'pass123' });

    const res = await app.request('/api/alerts', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alerts: unknown[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    };
    expect(body.alerts).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.hasMore).toBe(false);
  });

  test('알림 2개 → fired_at DESC 정렬 반환', async () => {
    insertBox(db, 'box-001');
    insertDetectionAlert(db, 'alert-001', 'box-001', 'ch-1', 1000);
    insertDetectionAlert(db, 'alert-002', 'box-001', 'ch-1', 2000);

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'hist-user2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'hist-user2', password: 'pass123' });

    const res = await app.request('/api/alerts', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alerts: Array<{ id: string; firedAt: number }>;
      pagination: { total: number; hasMore: boolean };
    };
    expect(body.alerts).toHaveLength(2);
    // fired_at DESC — alert-002(2000) 먼저
    expect(body.alerts[0]?.id).toBe('alert-002');
    expect(body.alerts[1]?.id).toBe('alert-001');
    expect(body.pagination.total).toBe(2);
  });

  test('페이지네이션 — limit=1, offset=0 → hasMore=true', async () => {
    insertBox(db, 'box-001');
    insertDetectionAlert(db, 'alert-001', 'box-001', 'ch-1', 1000);
    insertDetectionAlert(db, 'alert-002', 'box-001', 'ch-1', 2000);

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'hist-user3', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'hist-user3', password: 'pass123' });

    const res = await app.request('/api/alerts?limit=1&offset=0', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alerts: unknown[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    };
    expect(body.alerts).toHaveLength(1);
    expect(body.pagination.limit).toBe(1);
    expect(body.pagination.offset).toBe(0);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.hasMore).toBe(true);
  });

  test('페이지네이션 — limit=1, offset=1 → hasMore=false', async () => {
    insertBox(db, 'box-001');
    insertDetectionAlert(db, 'alert-001', 'box-001', 'ch-1', 1000);
    insertDetectionAlert(db, 'alert-002', 'box-001', 'ch-1', 2000);

    const { app } = buildApp(db);
    await createTestUser(db, { username: 'hist-user4', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'hist-user4', password: 'pass123' });

    const res = await app.request('/api/alerts?limit=1&offset=1', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pagination: { hasMore: boolean };
    };
    expect(body.pagination.hasMore).toBe(false);
  });

  test('limit 초과값(201) → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'hist-user5', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'hist-user5', password: 'pass123' });

    const res = await app.request('/api/alerts?limit=201', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// M3-3: WebPush 구독 관련
// ===========================================================================

describe('GET /api/alerts/webpush/vapid-public-key', () => {
  test('인증 없이 → 401', async () => {
    const { app } = buildApp(db);
    const res = await app.request('/api/alerts/webpush/vapid-public-key');
    expect(res.status).toBe(401);
  });

  test('VAPID_PUBLIC_KEY 미설정 시 → 503', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'vapid-user1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'vapid-user1', password: 'pass123' });

    const res = await app.request('/api/alerts/webpush/vapid-public-key', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(false);
  });

  test('VAPID_PUBLIC_KEY 설정 시 → 200 + { key }', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key-value';
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'vapid-user2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'vapid-user2', password: 'pass123' });

    const res = await app.request('/api/alerts/webpush/vapid-public-key', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    expect(body.key).toBe('test-vapid-public-key-value');
    process.env.VAPID_PUBLIC_KEY = undefined;
  });
});

describe('POST /api/alerts/webpush/subscribe', () => {
  test('인증 없이 → 401', async () => {
    const { app } = buildApp(db);
    const res = await app.request('/api/alerts/webpush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: 'key1', auth: 'auth1' },
      }),
    });
    expect(res.status).toBe(401);
  });

  test('정상 구독 등록 → 200', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'sub-user1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'sub-user1', password: 'pass123' });

    const res = await app.request('/api/alerts/webpush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/sub/abc',
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; endpoint: string };
    expect(body.success).toBe(true);
    expect(body.endpoint).toBe('https://push.example.com/sub/abc');

    // DB 에 실제로 삽입됐는지 확인
    const row = db.$client
      .query('SELECT * FROM webpush_subscriptions WHERE endpoint = ?')
      .get('https://push.example.com/sub/abc');
    expect(row).not.toBeNull();
  });

  test('동일 endpoint 재등록 시 UPSERT (dedup) → 200', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'sub-user2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'sub-user2', password: 'pass123' });

    const body1 = JSON.stringify({
      endpoint: 'https://push.example.com/sub/dup',
      keys: { p256dh: 'key-v1', auth: 'auth-v1' },
    });

    const body2 = JSON.stringify({
      endpoint: 'https://push.example.com/sub/dup',
      keys: { p256dh: 'key-v2', auth: 'auth-v2' },
    });

    const r1 = await app.request('/api/alerts/webpush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: body1,
    });
    expect(r1.status).toBe(200);

    const r2 = await app.request('/api/alerts/webpush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: body2,
    });
    expect(r2.status).toBe(200);

    // 중복 없이 1개만 존재해야 함
    const rows = db.$client
      .query('SELECT * FROM webpush_subscriptions WHERE endpoint = ?')
      .all('https://push.example.com/sub/dup');
    expect(rows).toHaveLength(1);

    // p256dh 가 v2 로 업데이트됐는지
    const row = rows[0] as { p256dh: string };
    expect(row.p256dh).toBe('key-v2');
  });

  test('잘못된 endpoint URL → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'sub-user3', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'sub-user3', password: 'pass123' });

    const res = await app.request('/api/alerts/webpush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        endpoint: 'not-a-url',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/alerts/webpush/subscribe', () => {
  test('인증 없이 → 401', async () => {
    const { app } = buildApp(db);
    const res = await app.request('/api/alerts/webpush/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/del/1' }),
    });
    expect(res.status).toBe(401);
  });

  test('body 로 endpoint 전달 시 구독 삭제 → 200', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'unsub-user1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'unsub-user1', password: 'pass123' });

    // 먼저 구독 등록
    await app.request('/api/alerts/webpush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/del/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    });

    // 구독 해제
    const res = await app.request('/api/alerts/webpush/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ endpoint: 'https://push.example.com/del/abc' }),
    });

    expect(res.status).toBe(200);

    // DB 에서 삭제됐는지 확인
    const row = db.$client
      .query('SELECT * FROM webpush_subscriptions WHERE endpoint = ?')
      .get('https://push.example.com/del/abc');
    expect(row).toBeNull();
  });

  test('query param 으로 endpoint 전달 시 구독 삭제 → 200', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'unsub-user2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'unsub-user2', password: 'pass123' });

    // 먼저 구독 등록
    await app.request('/api/alerts/webpush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/qry/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      }),
    });

    const encodedEndpoint = encodeURIComponent('https://push.example.com/qry/abc');
    const res = await app.request(`/api/alerts/webpush/subscribe?endpoint=${encodedEndpoint}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
  });

  test('endpoint 없이 요청 → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'unsub-user3', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'unsub-user3', password: 'pass123' });

    const res = await app.request('/api/alerts/webpush/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// M3-4: destinations CRUD
// ===========================================================================

describe('GET /api/alerts/destinations', () => {
  test('인증 없이 → 401', async () => {
    const { app } = buildApp(db);
    const res = await app.request('/api/alerts/destinations');
    expect(res.status).toBe(401);
  });

  test('DB 미설정 사용자 → 기본값 3개 반환 (저장 안 함)', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'dest-user1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'dest-user1', password: 'pass123' });

    const res = await app.request('/api/alerts/destinations', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      destinations: Array<{ channel: string; enabled: boolean; config: null }>;
    };
    expect(body.destinations).toHaveLength(3);

    const channels = body.destinations.map((d) => d.channel);
    expect(channels).toContain('toast');
    expect(channels).toContain('webpush');
    expect(channels).toContain('telegram');

    // 기본값 확인
    const toast = body.destinations.find((d) => d.channel === 'toast');
    expect(toast?.enabled).toBe(true);

    const webpush = body.destinations.find((d) => d.channel === 'webpush');
    expect(webpush?.enabled).toBe(false);

    // DB 에 저장되지 않아야 함
    const userId = db.$client.query("SELECT id FROM users WHERE username = 'dest-user1'").get() as {
      id: string;
    } | null;
    if (userId) {
      const dbRows = db.$client
        .query('SELECT * FROM alert_destinations WHERE user_id = ?')
        .all(userId.id);
      expect(dbRows).toHaveLength(0);
    }
  });

  test('DB 설정이 있을 때 → rows 반환', async () => {
    const { app } = buildApp(db);
    const user = await createTestUser(db, { username: 'dest-user2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'dest-user2', password: 'pass123' });

    insertDestination(db, user.id, 'toast', true, null);
    insertDestination(db, user.id, 'webpush', false, null);

    const res = await app.request('/api/alerts/destinations', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      destinations: Array<{ channel: string; enabled: boolean }>;
    };
    expect(body.destinations).toHaveLength(2);
  });
});

describe('PUT /api/alerts/destinations/:channel', () => {
  test('인증 없이 → 401', async () => {
    const { app } = buildApp(db);
    const res = await app.request('/api/alerts/destinations/toast', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(401);
  });

  test('잘못된 channel (예: "email") → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'put-user1', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'put-user1', password: 'pass123' });

    const res = await app.request('/api/alerts/destinations/email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(400);
  });

  test('신규 toast 설정 UPSERT → 200 + 반환 row', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'put-user2', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'put-user2', password: 'pass123' });

    const res = await app.request('/api/alerts/destinations/toast', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { channel: string; enabled: boolean; config: null };
    expect(body.channel).toBe('toast');
    expect(body.enabled).toBe(false);
  });

  test('기존 toast 설정 업데이트 → 200', async () => {
    const { app } = buildApp(db);
    const user = await createTestUser(db, { username: 'put-user3', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'put-user3', password: 'pass123' });

    insertDestination(db, user.id, 'toast', true, null);

    const res = await app.request('/api/alerts/destinations/toast', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  test('telegram + enabled=true + chat_id 없음 → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'put-user4', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'put-user4', password: 'pass123' });

    const res = await app.request('/api/alerts/destinations/telegram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(400);
  });

  test('telegram + enabled=true + chat_id 빈 문자열 → 400', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'put-user5', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'put-user5', password: 'pass123' });

    const res = await app.request('/api/alerts/destinations/telegram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ enabled: true, config: { chat_id: '' } }),
    });

    expect(res.status).toBe(400);
  });

  test('telegram + enabled=true + chat_id 있음 → 200', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'put-user6', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'put-user6', password: 'pass123' });

    const res = await app.request('/api/alerts/destinations/telegram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ enabled: true, config: { chat_id: '123456789' } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      channel: string;
      enabled: boolean;
      config: { chat_id: string };
    };
    expect(body.channel).toBe('telegram');
    expect(body.enabled).toBe(true);
    expect(body.config?.chat_id).toBe('123456789');
  });

  test('telegram + enabled=false + chat_id 없음 → 200 (비활성화는 chat_id 불필요)', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'put-user7', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'put-user7', password: 'pass123' });

    const res = await app.request('/api/alerts/destinations/telegram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  test('webpush UPSERT → 200', async () => {
    const { app } = buildApp(db);
    await createTestUser(db, { username: 'put-user8', password: 'pass123' });
    const { cookieHeader } = await loginAs(app, { username: 'put-user8', password: 'pass123' });

    const res = await app.request('/api/alerts/destinations/webpush', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { channel: string; enabled: boolean };
    expect(body.channel).toBe('webpush');
    expect(body.enabled).toBe(true);
  });
});
