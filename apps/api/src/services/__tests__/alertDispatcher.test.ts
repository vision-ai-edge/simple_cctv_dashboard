// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M2-2 — alertDispatcher 단위 테스트 (TDD RED→GREEN)
 *
 * 테스트 대상 (REQ-ALERT-004, REQ-ALERT-006, REQ-ALERT-007):
 *   - SSE 클라이언트 레지스트리 등록/해제
 *   - dispatch: SSE 푸시 (toast 채널)
 *   - dispatch: WebPush 발송 (webpush 채널)
 *   - dispatch: Telegram sendMessage (telegram 채널)
 *   - 각 채널 독립: 하나 실패해도 다른 채널 계속 진행
 *   - markDelivered: status = 'delivered'
 *   - ENV 미설정 시 해당 채널 graceful skip
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type Db, type NewDetectionAlert, createDb, runMigrations } from '@cctv/db';
import { ulid } from 'ulid';

// alertDispatcher 를 의존성 주입으로 테스트하기 위해 factory 함수 형태로 가져온다
import {
  createAlertDispatcher,
  type AlertDispatcherDeps,
} from '../../services/alertDispatcher';

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-alert-dispatcher.sqlite');

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// ---------------------------------------------------------------------------
// DB 헬퍼
// ---------------------------------------------------------------------------

function insertUser(db: Db, id: string) {
  db.$client
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, `user-${id}`, `${id}@test.com`, 'hash', Date.now(), Date.now());
}

function insertBox(db: Db, id: string) {
  db.$client
    .prepare(
      `INSERT INTO boxes (id, name, base_url, username, password_enc, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(id, `Box-${id}`, 'https://box.test:8443/api', 'admin', new Uint8Array(32), Date.now(), Date.now());
}

function insertAlertDestination(
  db: Db,
  userId: string,
  channel: 'toast' | 'webpush' | 'telegram',
  enabled: boolean,
  configJson?: string | null,
) {
  db.$client
    .prepare(
      `INSERT INTO alert_destinations (id, user_id, channel, enabled, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ulid(), userId, channel, enabled ? 1 : 0, configJson ?? null, Date.now(), Date.now());
}

function insertWebpushSubscription(db: Db, userId: string) {
  db.$client
    .prepare(
      `INSERT INTO webpush_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ulid(), userId, 'https://push.test/sub', 'p256dh-key', 'auth-key', Date.now());
}

function insertDetectionAlert(db: Db, id: string, boxId: string): void {
  db.$client
    .prepare(
      `INSERT INTO detection_alerts (id, box_id, channel_id, type, payload_json, fired_at, status, created_at)
       VALUES (?, ?, 'ch-1', 'intrusion', '{}', ?, 'new', ?)`,
    )
    .run(id, boxId, Date.now(), Date.now());
}

function getAlertStatus(db: Db, alertId: string): string | null {
  const row = db.$client
    .query('SELECT status FROM detection_alerts WHERE id = ?')
    .get(alertId) as { status: string } | null;
  return row?.status ?? null;
}

// ---------------------------------------------------------------------------
// 테스트 픽스처
// ---------------------------------------------------------------------------

let db: Db;

beforeEach(async () => {
  cleanup();
  await runMigrations({ databasePath: TMP_DB });
  db = createDb(TMP_DB);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// 테스트용 alert 데이터
// ---------------------------------------------------------------------------

function makeAlert(overrides: Partial<NewDetectionAlert> = {}): NewDetectionAlert {
  return {
    id: ulid(),
    boxId: 'box-1',
    channelId: 'ch-1',
    type: 'intrusion',
    payloadJson: '{"confidence":0.9}',
    firedAt: Date.now(),
    status: 'new',
    ...overrides,
  };
}

// ===========================================================================
// TC-AD-1: SSE 클라이언트 등록 및 dispatch
// ===========================================================================

describe('alertDispatcher — SSE (toast 채널)', () => {
  test('TC-AD-1: SSE 클라이언트 등록 후 dispatch 시 enqueue 호출됨', async () => {
    insertUser(db, 'user-1');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-1', 'toast', true);

    const enqueueSpy = mock(() => {});
    const mockController = { enqueue: enqueueSpy } as unknown as ReadableStreamDefaultController;

    const deps: AlertDispatcherDeps = {
      db,
      webPush: null, // WebPush 비활성
      telegramToken: null, // Telegram 비활성
    };

    const dispatcher = createAlertDispatcher(deps);
    const unregister = dispatcher.registerSSEClient('user-1', mockController);

    const alert = makeAlert({ boxId: 'box-1' });
    await dispatcher.dispatch('user-1', alert);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    // enqueue 에 SSE 형식 문자열이 전달됐는지 확인
    const calls = enqueueSpy.mock.calls as unknown[][];
    const callArg = calls[0]?.[0] as string;
    expect(typeof callArg).toBe('string');
    expect(callArg).toContain('data:');
    expect(callArg).toContain(alert.id);

    unregister();
  });

  test('TC-AD-2: SSE 클라이언트 unregister 후 dispatch 시 enqueue 호출 안 됨', async () => {
    insertUser(db, 'user-2');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-2', 'toast', true);

    const enqueueSpy = mock(() => {});
    const mockController = { enqueue: enqueueSpy } as unknown as ReadableStreamDefaultController;

    const deps: AlertDispatcherDeps = { db, webPush: null, telegramToken: null };
    const dispatcher = createAlertDispatcher(deps);

    const unregister = dispatcher.registerSSEClient('user-2', mockController);
    unregister(); // 즉시 해제

    const alert = makeAlert({ boxId: 'box-1' });
    await dispatcher.dispatch('user-2', alert);

    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test('TC-AD-3: toast 채널 비활성 시 SSE 미전송', async () => {
    insertUser(db, 'user-3');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-3', 'toast', false); // disabled

    const enqueueSpy = mock(() => {});
    const mockController = { enqueue: enqueueSpy } as unknown as ReadableStreamDefaultController;

    const deps: AlertDispatcherDeps = { db, webPush: null, telegramToken: null };
    const dispatcher = createAlertDispatcher(deps);

    dispatcher.registerSSEClient('user-3', mockController);

    const alert = makeAlert({ boxId: 'box-1' });
    await dispatcher.dispatch('user-3', alert);

    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-AD-4: WebPush 채널
// ===========================================================================

describe('alertDispatcher — WebPush 채널', () => {
  test('TC-AD-4: WebPush 활성 시 sendNotification 호출됨', async () => {
    insertUser(db, 'user-wp');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-wp', 'webpush', true);
    insertWebpushSubscription(db, 'user-wp');

    const sendNotificationSpy = mock(async () => ({ statusCode: 201 } as unknown as Response));

    const mockWebPush = {
      sendNotification: sendNotificationSpy,
      setVapidDetails: mock(() => {}),
    };

    const deps: AlertDispatcherDeps = {
      db,
      webPush: mockWebPush as unknown as typeof import('web-push'),
      telegramToken: null,
    };

    const dispatcher = createAlertDispatcher(deps);
    const alert = makeAlert({ boxId: 'box-1' });
    await dispatcher.dispatch('user-wp', alert);

    expect(sendNotificationSpy).toHaveBeenCalledTimes(1);
  });

  test('TC-AD-5: webPush=null 이면 sendNotification 호출 안 됨 (graceful skip)', async () => {
    insertUser(db, 'user-wp-null');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-wp-null', 'webpush', true);
    insertWebpushSubscription(db, 'user-wp-null');

    const deps: AlertDispatcherDeps = { db, webPush: null, telegramToken: null };
    const dispatcher = createAlertDispatcher(deps);

    const alert = makeAlert({ boxId: 'box-1' });
    // 에러 없이 실행 완료되어야 함
    await expect(dispatcher.dispatch('user-wp-null', alert)).resolves.toBeUndefined();
  });

  test('TC-AD-6: WebPush 구독 만료(410) 시 구독 삭제', async () => {
    insertUser(db, 'user-410');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-410', 'webpush', true);

    // endpoint 로 구독 삽입
    const endpoint = 'https://push.test/expired-sub';
    db.$client
      .prepare(
        `INSERT INTO webpush_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(ulid(), 'user-410', endpoint, 'p256dh', 'auth', Date.now());

    const goneError = Object.assign(new Error('Gone'), { statusCode: 410 });
    const sendNotificationSpy = mock(async () => { throw goneError; });

    const mockWebPush = {
      sendNotification: sendNotificationSpy,
      setVapidDetails: mock(() => {}),
    };

    const deps: AlertDispatcherDeps = {
      db,
      webPush: mockWebPush as unknown as typeof import('web-push'),
      telegramToken: null,
    };

    const dispatcher = createAlertDispatcher(deps);
    const alert = makeAlert({ boxId: 'box-1' });
    await dispatcher.dispatch('user-410', alert);

    // 구독이 삭제됐는지 확인
    const remaining = db.$client
      .query('SELECT COUNT(*) as cnt FROM webpush_subscriptions WHERE user_id = ?')
      .get('user-410') as { cnt: number };
    expect(remaining.cnt).toBe(0);
  });
});

// ===========================================================================
// TC-AD-7: Telegram 채널
// ===========================================================================

describe('alertDispatcher — Telegram 채널', () => {
  test('TC-AD-7: Telegram 활성 + chat_id 있으면 sendMessage POST 호출됨', async () => {
    insertUser(db, 'user-tg');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-tg', 'telegram', true, JSON.stringify({ chat_id: '12345' }));

    const fetchSpy = mock(async (_url: string, _init?: RequestInit) =>
      ({ ok: true, json: async () => ({ ok: true }) }) as Response,
    );

    const deps: AlertDispatcherDeps = {
      db,
      webPush: null,
      telegramToken: 'test-bot-token',
      fetch: fetchSpy as unknown as typeof fetch,
    };

    const dispatcher = createAlertDispatcher(deps);
    const alert = makeAlert({ boxId: 'box-1', type: 'intrusion' });
    await dispatcher.dispatch('user-tg', alert);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('test-bot-token');
    expect(calledUrl).toContain('sendMessage');
  });

  test('TC-AD-8: telegramToken=null 이면 fetch 호출 안 됨 (graceful skip)', async () => {
    insertUser(db, 'user-tg-null');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-tg-null', 'telegram', true, JSON.stringify({ chat_id: '99' }));

    const fetchSpy = mock(async () => ({ ok: true }) as Response);

    const deps: AlertDispatcherDeps = {
      db,
      webPush: null,
      telegramToken: null,
      fetch: fetchSpy as unknown as typeof fetch,
    };

    const dispatcher = createAlertDispatcher(deps);
    const alert = makeAlert({ boxId: 'box-1' });
    await dispatcher.dispatch('user-tg-null', alert);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('TC-AD-9: chat_id 미설정 시 Telegram 호출 스킵', async () => {
    insertUser(db, 'user-tg-nochat');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-tg-nochat', 'telegram', true, undefined); // config_json 없음

    const fetchSpy = mock(async () => ({ ok: true }) as Response);

    const deps: AlertDispatcherDeps = {
      db,
      webPush: null,
      telegramToken: 'token',
      fetch: fetchSpy as unknown as typeof fetch,
    };

    const dispatcher = createAlertDispatcher(deps);
    const alert = makeAlert({ boxId: 'box-1' });
    await dispatcher.dispatch('user-tg-nochat', alert);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-AD-10: 채널 독립성 — 한 채널 실패해도 다른 채널 계속 진행
// ===========================================================================

describe('alertDispatcher — 채널 독립성', () => {
  test('TC-AD-10: WebPush 실패해도 SSE/Telegram 은 계속 진행', async () => {
    insertUser(db, 'user-iso');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-iso', 'toast', true);
    insertAlertDestination(db, 'user-iso', 'webpush', true);
    insertAlertDestination(db, 'user-iso', 'telegram', true, JSON.stringify({ chat_id: '777' }));
    insertWebpushSubscription(db, 'user-iso');

    const enqueueSpy = mock(() => {});
    const mockController = { enqueue: enqueueSpy } as unknown as ReadableStreamDefaultController;

    // WebPush 실패
    const failingWebPush = {
      sendNotification: mock(async () => { throw new Error('WebPush 실패'); }),
      setVapidDetails: mock(() => {}),
    };

    const fetchSpy = mock(async () => ({ ok: true, json: async () => ({ ok: true }) }) as Response);

    const deps: AlertDispatcherDeps = {
      db,
      webPush: failingWebPush as unknown as typeof import('web-push'),
      telegramToken: 'token',
      fetch: fetchSpy as unknown as typeof fetch,
    };

    const dispatcher = createAlertDispatcher(deps);
    dispatcher.registerSSEClient('user-iso', mockController);

    const alert = makeAlert({ boxId: 'box-1' });
    // 예외 없이 완료되어야 함
    await expect(dispatcher.dispatch('user-iso', alert)).resolves.toBeUndefined();

    // SSE 는 전송됨
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    // Telegram 은 전송됨
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// TC-AD-11: markDelivered
// ===========================================================================

describe('alertDispatcher — markDelivered', () => {
  test('TC-AD-11: markDelivered 호출 시 detection_alerts.status = delivered', async () => {
    insertBox(db, 'box-1');
    const alertId = ulid();
    insertDetectionAlert(db, alertId, 'box-1');

    expect(getAlertStatus(db, alertId)).toBe('new');

    const deps: AlertDispatcherDeps = { db, webPush: null, telegramToken: null };
    const dispatcher = createAlertDispatcher(deps);

    dispatcher.markDelivered(alertId);

    expect(getAlertStatus(db, alertId)).toBe('delivered');
  });
});

// ===========================================================================
// TC-AD-12: 다중 SSE 연결 (같은 사용자 여러 탭)
// ===========================================================================

describe('alertDispatcher — 다중 SSE 연결', () => {
  test('TC-AD-12: 동일 사용자 2개 탭 → 양쪽 모두 enqueue', async () => {
    insertUser(db, 'user-multi');
    insertBox(db, 'box-1');
    insertAlertDestination(db, 'user-multi', 'toast', true);

    const spy1 = mock(() => {});
    const spy2 = mock(() => {});
    const ctrl1 = { enqueue: spy1 } as unknown as ReadableStreamDefaultController;
    const ctrl2 = { enqueue: spy2 } as unknown as ReadableStreamDefaultController;

    const deps: AlertDispatcherDeps = { db, webPush: null, telegramToken: null };
    const dispatcher = createAlertDispatcher(deps);

    const unregister1 = dispatcher.registerSSEClient('user-multi', ctrl1);
    const unregister2 = dispatcher.registerSSEClient('user-multi', ctrl2);

    const alert = makeAlert({ boxId: 'box-1' });
    await dispatcher.dispatch('user-multi', alert);

    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);

    unregister1();
    unregister2();
  });
});
