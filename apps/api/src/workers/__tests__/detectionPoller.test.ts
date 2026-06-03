// TAG: ALERTS-001
/**
 * SPEC-ALERTS-001 M2-1 — detectionPoller 단위 테스트 (TDD RED→GREEN)
 *
 * 테스트 대상 (REQ-ALERT-001, REQ-ALERT-002, REQ-ALERT-003):
 *   - active Box 의 cameras(channelId) 를 순회하며 visionAi.getDetections 호출
 *   - detection_cursor 기반 신규 이벤트만 필터링 (중복 방지)
 *   - 신규 이벤트 → detection_alerts 테이블 INSERT
 *   - cursor 갱신 (last_seen_timestamp = max new timestamp)
 *   - 히스토리 1000건 트리밍
 *   - Box / 채널 단위 오류 격리
 *   - 싱글톤 보장
 *   - stop() cleanup
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type Db, createDb, runMigrations } from '@cctv/db';
import type { BoxClient } from '@cctv/shared';
import { startDetectionPoller } from '../detectionPoller';

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-detection-poller.sqlite');
const TEST_VAULT_KEY = '0'.repeat(64);

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// ---------------------------------------------------------------------------
// DB 헬퍼
// ---------------------------------------------------------------------------

function insertActiveBox(db: Db, id: string, baseUrl = 'https://box.test:8443/api') {
  db.$client
    .prepare(
      `INSERT INTO boxes (id, name, base_url, username, password_enc, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(id, `Box-${id}`, baseUrl, 'admin', new Uint8Array(32), Date.now(), Date.now());
}

function insertInactiveBox(db: Db, id: string) {
  db.$client
    .prepare(
      `INSERT INTO boxes (id, name, base_url, username, password_enc, status, created_at, updated_at)
       VALUES (?, ?, 'https://inactive.test:8443/api', 'admin', ?, 'inactive', ?, ?)`,
    )
    .run(id, `Box-${id}`, new Uint8Array(32), Date.now(), Date.now());
}

function insertCamera(
  db: Db,
  id: string,
  boxId: string,
  channelId: string,
  status: 'online' | 'offline' | 'error' = 'online',
) {
  db.$client
    .prepare(
      `INSERT INTO cameras (id, box_id, channel_id, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, boxId, channelId, `Camera-${id}`, status, Date.now(), Date.now());
}

function getCursor(db: Db, boxId: string, channelId: string): number | null {
  const row = db.$client
    .query('SELECT last_seen_timestamp FROM detection_cursor WHERE box_id = ? AND channel_id = ?')
    .get(boxId, channelId) as { last_seen_timestamp: number } | null;
  return row?.last_seen_timestamp ?? null;
}

function getDetectionAlerts(db: Db, boxId: string, channelId: string) {
  return db.$client
    .query(
      'SELECT * FROM detection_alerts WHERE box_id = ? AND channel_id = ? ORDER BY fired_at ASC',
    )
    .all(boxId, channelId) as Array<{
    id: string;
    box_id: string;
    channel_id: string;
    type: string;
    payload_json: string;
    fired_at: number;
    status: string;
  }>;
}

function countDetectionAlerts(db: Db, boxId: string, channelId: string): number {
  const row = db.$client
    .query(
      'SELECT COUNT(*) as cnt FROM detection_alerts WHERE box_id = ? AND channel_id = ?',
    )
    .get(boxId, channelId) as { cnt: number };
  return row.cnt;
}

// ---------------------------------------------------------------------------
// BoxClient mock 유틸
// ---------------------------------------------------------------------------

type DetectionItem = { timestamp: number; type?: string; [key: string]: unknown };

function makeDetectionsResponse(detections: DetectionItem[]) {
  return {
    success: true,
    channelId: 'ch-1',
    detections,
    timestamp: Date.now(),
  };
}

function createMockBoxClient(
  detectionsFactory: (channelId: string) => ReturnType<typeof makeDetectionsResponse> | Error,
): (baseUrl: string, token?: string) => BoxClient {
  return mock((baseUrl: string, _token?: string): BoxClient => {
    return {
      baseUrl,
      system: { health: mock(async () => ({ status: 'ok', uptime: 0, version: '0', timestamp: 0 })) },
      auth: {
        login: mock(async () => ({ token: 't', expiresAt: null })),
        me: mock(async () => ({ username: 'admin', hasApiKey: false })),
        regenerateApiKey: mock(async () => ({ apiKey: 'k' })),
        changePassword: mock(async () => {}),
      },
      visionAi: {
        getDetections: mock(async (channelId: string) => {
          const result = detectionsFactory(channelId);
          if (result instanceof Error) throw result;
          return result;
        }),
        getTrackings: mock(async () => ({ trackings: [] })),
        getVisionConfig: mock(async () => ({})),
        setVisionConfig: mock(async () => ({})),
        listChannelModels: mock(async () => ({ models: [] })),
        addChannelModel: mock(async () => ({})),
        removeChannelModel: mock(async () => ({})),
        getRoiConfig: mock(async () => ({})),
        setRoiConfig: mock(async () => ({})),
      },
      models: {
        list: mock(async () => []),
        upload: mock(async () => ({})),
        delete: mock(async () => ({})),
      },
      setCredentials: mock(() => {}),
    } as unknown as BoxClient;
  });
}

// ---------------------------------------------------------------------------
// Fake Timer
// ---------------------------------------------------------------------------

type TimerCallback = () => void | Promise<void>;

interface FakeTimer {
  tick: (times?: number) => Promise<void>;
  intervalMs: number;
  cleared: boolean;
}

function installFakeTimers(): { timers: FakeTimer[]; restoreTimers: () => void } {
  const timers: FakeTimer[] = [];
  const origSetInterval = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;

  // @ts-ignore
  globalThis.setInterval = (cb: TimerCallback, ms: number) => {
    const timer: FakeTimer = {
      tick: async (times = 1) => {
        for (let i = 0; i < times; i++) {
          await cb();
        }
      },
      intervalMs: ms,
      cleared: false,
    };
    timers.push(timer);
    return timers.length as unknown as ReturnType<typeof setInterval>;
  };

  // @ts-ignore
  globalThis.clearInterval = () => {
    const last = timers[timers.length - 1];
    if (last) last.cleared = true;
  };

  return {
    timers,
    restoreTimers: () => {
      globalThis.setInterval = origSetInterval;
      globalThis.clearInterval = origClearInterval;
    },
  };
}

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

let db: Db;

beforeEach(async () => {
  cleanup();
  await runMigrations({ databasePath: TMP_DB });
  db = createDb(TMP_DB);
});

afterEach(cleanup);

// ===========================================================================
// TC-DP-1: active Box 의 online 채널에 대해 getDetections 호출
// ===========================================================================

describe('detectionPoller — 기본 폴링', () => {
  test('TC-DP-1: active Box + online 채널 → getDetections 호출', async () => {
    insertActiveBox(db, 'box-1');
    insertCamera(db, 'cam-1', 'box-1', 'ch-001', 'online');

    const getDetectionsMock = mock(async (_channelId: string) =>
      makeDetectionsResponse([]),
    );

    const createBoxClient = mock((_baseUrl: string, _token?: string): BoxClient => ({
      baseUrl: _baseUrl,
      system: { health: mock(async () => ({ status: 'ok', uptime: 0, version: '0', timestamp: 0 })) },
      auth: {
        login: mock(async () => ({ token: 't', expiresAt: null })),
        me: mock(async () => ({ username: 'admin', hasApiKey: false })),
        regenerateApiKey: mock(async () => ({ apiKey: 'k' })),
        changePassword: mock(async () => {}),
      },
      visionAi: {
        getDetections: getDetectionsMock,
        getTrackings: mock(async () => ({ trackings: [] })),
        getVisionConfig: mock(async () => ({})),
        setVisionConfig: mock(async () => ({})),
        listChannelModels: mock(async () => ({ models: [] })),
        addChannelModel: mock(async () => ({})),
        removeChannelModel: mock(async () => ({})),
        getRoiConfig: mock(async () => ({})),
        setRoiConfig: mock(async () => ({})),
      },
      models: {
        list: mock(async () => []),
        upload: mock(async () => ({})),
        delete: mock(async () => ({})),
      },
      setCredentials: mock(() => {}),
    } as unknown as BoxClient));

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startDetectionPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 3000 },
    );

    await timers[0]?.tick(1);
    expect(getDetectionsMock).toHaveBeenCalledWith('ch-001');

    stop();
    restoreTimers();
  });

  test('TC-DP-2: inactive Box 는 폴링하지 않는다', async () => {
    insertInactiveBox(db, 'box-inactive');
    insertCamera(db, 'cam-inactive', 'box-inactive', 'ch-x', 'online');

    const getDetectionsMock = mock(async (_channelId: string) =>
      makeDetectionsResponse([]),
    );

    const createBoxClient = createMockBoxClient(() => makeDetectionsResponse([]));
    // override getDetections
    const clientWithSpy = mock((_baseUrl: string, _token?: string): BoxClient => ({
      baseUrl: _baseUrl,
      system: { health: mock(async () => ({ status: 'ok', uptime: 0, version: '0', timestamp: 0 })) },
      auth: {
        login: mock(async () => ({ token: 't', expiresAt: null })),
        me: mock(async () => ({ username: 'admin', hasApiKey: false })),
        regenerateApiKey: mock(async () => ({ apiKey: 'k' })),
        changePassword: mock(async () => {}),
      },
      visionAi: {
        getDetections: getDetectionsMock,
        getTrackings: mock(async () => ({ trackings: [] })),
        getVisionConfig: mock(async () => ({})),
        setVisionConfig: mock(async () => ({})),
        listChannelModels: mock(async () => ({ models: [] })),
        addChannelModel: mock(async () => ({})),
        removeChannelModel: mock(async () => ({})),
        getRoiConfig: mock(async () => ({})),
        setRoiConfig: mock(async () => ({})),
      },
      models: {
        list: mock(async () => []),
        upload: mock(async () => ({})),
        delete: mock(async () => ({})),
      },
      setCredentials: mock(() => {}),
    } as unknown as BoxClient));

    const { timers, restoreTimers } = installFakeTimers();
    const stop = startDetectionPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient: clientWithSpy },
      { intervalMs: 3000 },
    );

    await timers[0]?.tick(1);
    expect(getDetectionsMock).not.toHaveBeenCalled();

    stop();
    restoreTimers();
  });
});

// ===========================================================================
// TC-DP-3: 신규 이벤트 → detection_alerts INSERT + cursor 갱신
// ===========================================================================

describe('detectionPoller — 신규 이벤트 처리', () => {
  test('TC-DP-3: 신규 detection 이벤트 → DB INSERT + cursor 갱신', async () => {
    insertActiveBox(db, 'box-new');
    insertCamera(db, 'cam-new', 'box-new', 'ch-new', 'online');

    const ts = Date.now();
    const createBoxClient = createMockBoxClient(() =>
      makeDetectionsResponse([{ timestamp: ts, type: 'intrusion', confidence: 0.95 }]),
    );

    const { timers, restoreTimers } = installFakeTimers();
    const stop = startDetectionPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 3000 },
    );

    await timers[0]?.tick(1);

    // detection_alerts 에 1건 INSERT 됐는지 확인
    const alerts = getDetectionAlerts(db, 'box-new', 'ch-new');
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.type).toBe('intrusion');
    expect(alerts[0]?.status).toBe('new');
    expect(alerts[0]?.fired_at).toBe(ts);

    // cursor 갱신 확인
    const cursor = getCursor(db, 'box-new', 'ch-new');
    expect(cursor).toBe(ts);

    stop();
    restoreTimers();
  });

  test('TC-DP-4: cursor 이후 timestamp 만 신규 처리 (중복 방지)', async () => {
    insertActiveBox(db, 'box-dup');
    insertCamera(db, 'cam-dup', 'box-dup', 'ch-dup', 'online');

    const oldTs = 1000;
    const newTs = 2000;

    // cursor를 oldTs 로 미리 설정 (이미 처리한 이벤트)
    db.$client
      .prepare(
        'INSERT INTO detection_cursor (box_id, channel_id, last_seen_timestamp, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run('box-dup', 'ch-dup', oldTs, Date.now());

    const createBoxClient = createMockBoxClient(() =>
      makeDetectionsResponse([
        { timestamp: oldTs, type: 'old-event' }, // cursor 와 동일 → 스킵
        { timestamp: newTs, type: 'new-event' }, // cursor 이후 → 처리
      ]),
    );

    const { timers, restoreTimers } = installFakeTimers();
    const stop = startDetectionPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 3000 },
    );

    await timers[0]?.tick(1);

    const alerts = getDetectionAlerts(db, 'box-dup', 'ch-dup');
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.type).toBe('new-event');
    expect(alerts[0]?.fired_at).toBe(newTs);

    const cursor = getCursor(db, 'box-dup', 'ch-dup');
    expect(cursor).toBe(newTs);

    stop();
    restoreTimers();
  });

  test('TC-DP-5: 0건 detection → DB 변화 없음, cursor 변화 없음', async () => {
    insertActiveBox(db, 'box-empty');
    insertCamera(db, 'cam-empty', 'box-empty', 'ch-empty', 'online');

    const createBoxClient = createMockBoxClient(() => makeDetectionsResponse([]));

    const { timers, restoreTimers } = installFakeTimers();
    const stop = startDetectionPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 3000 },
    );

    await timers[0]?.tick(1);

    const alerts = getDetectionAlerts(db, 'box-empty', 'ch-empty');
    expect(alerts.length).toBe(0);

    const cursor = getCursor(db, 'box-empty', 'ch-empty');
    expect(cursor).toBeNull(); // cursor 생성 안 됨

    stop();
    restoreTimers();
  });

  test('TC-DP-6: cursor 가 없으면 모든 이벤트를 신규로 처리', async () => {
    insertActiveBox(db, 'box-nocursor');
    insertCamera(db, 'cam-nocursor', 'box-nocursor', 'ch-nocursor', 'online');

    const ts1 = 1000;
    const ts2 = 2000;

    const createBoxClient = createMockBoxClient(() =>
      makeDetectionsResponse([
        { timestamp: ts1, type: 'event-1' },
        { timestamp: ts2, type: 'event-2' },
      ]),
    );

    const { timers, restoreTimers } = installFakeTimers();
    const stop = startDetectionPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 3000 },
    );

    await timers[0]?.tick(1);

    const alerts = getDetectionAlerts(db, 'box-nocursor', 'ch-nocursor');
    expect(alerts.length).toBe(2);

    const cursor = getCursor(db, 'box-nocursor', 'ch-nocursor');
    expect(cursor).toBe(ts2); // 최신 timestamp

    stop();
    restoreTimers();
  });
});

// ===========================================================================
// TC-DP-7: 오류 격리 (채널/박스 단위)
// ===========================================================================

describe('detectionPoller — 오류 격리', () => {
  test('TC-DP-7: 한 채널 실패해도 다른 채널은 처리됨', async () => {
    insertActiveBox(db, 'box-iso');
    insertCamera(db, 'cam-iso-1', 'box-iso', 'ch-fail', 'online');
    insertCamera(db, 'cam-iso-2', 'box-iso', 'ch-ok', 'online');

    const ts = Date.now();
    const createBoxClient = createMockBoxClient((channelId: string) => {
      if (channelId === 'ch-fail') return new Error('채널 폴링 실패');
      return makeDetectionsResponse([{ timestamp: ts, type: 'ok-event' }]);
    });

    const { timers, restoreTimers } = installFakeTimers();
    const stop = startDetectionPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 3000 },
    );

    await timers[0]?.tick(1);

    // ch-ok 는 처리됨
    const okAlerts = getDetectionAlerts(db, 'box-iso', 'ch-ok');
    expect(okAlerts.length).toBe(1);
    expect(okAlerts[0]?.type).toBe('ok-event');

    // ch-fail 은 0건
    const failAlerts = getDetectionAlerts(db, 'box-iso', 'ch-fail');
    expect(failAlerts.length).toBe(0);

    stop();
    restoreTimers();
  });
});

// ===========================================================================
// TC-DP-8: 히스토리 트리밍 (1000건 초과 시 삭제)
// ===========================================================================

describe('detectionPoller — 히스토리 트리밍', () => {
  test('TC-DP-8: 1001건 이상 시 오래된 항목 삭제', async () => {
    insertActiveBox(db, 'box-trim');
    insertCamera(db, 'cam-trim', 'box-trim', 'ch-trim', 'online');

    // 미리 1000건 INSERT
    const baseTs = 1000;
    for (let i = 0; i < 1000; i++) {
      const alertId = `alert-pre-${String(i).padStart(4, '0')}`;
      db.$client
        .prepare(
          `INSERT INTO detection_alerts (id, box_id, channel_id, type, payload_json, fired_at, status, created_at)
           VALUES (?, 'box-trim', 'ch-trim', 'evt', '{}', ?, 'new', ?)`,
        )
        .run(alertId, baseTs + i, Date.now());
    }

    // cursor 를 pre-1000 건 중 최신으로 설정
    db.$client
      .prepare(
        'INSERT INTO detection_cursor (box_id, channel_id, last_seen_timestamp, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run('box-trim', 'ch-trim', baseTs + 999, Date.now());

    // 신규 이벤트 1건 추가 → 총 1001건 → 가장 오래된 1건 삭제
    const newTs = baseTs + 1000;
    const createBoxClient = createMockBoxClient(() =>
      makeDetectionsResponse([{ timestamp: newTs, type: 'trim-trigger' }]),
    );

    const { timers, restoreTimers } = installFakeTimers();
    const stop = startDetectionPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 3000 },
    );

    await timers[0]?.tick(1);

    const count = countDetectionAlerts(db, 'box-trim', 'ch-trim');
    expect(count).toBe(1000);

    stop();
    restoreTimers();
  });
});

// ===========================================================================
// TC-DP-9: 싱글톤 보장
// ===========================================================================

describe('detectionPoller — 싱글톤', () => {
  test('TC-DP-9: 2회 호출 시 경고 + 기존 인스턴스 유지', async () => {
    const warnSpy = mock((..._args: unknown[]) => {});
    const originalWarn = console.warn;
    console.warn = warnSpy as typeof console.warn;

    const createBoxClient = createMockBoxClient(() => makeDetectionsResponse([]));
    const { timers, restoreTimers } = installFakeTimers();

    const stop1 = startDetectionPoller({ db, vaultKey: TEST_VAULT_KEY, createBoxClient }, { intervalMs: 3000 });
    const stop2 = startDetectionPoller({ db, vaultKey: TEST_VAULT_KEY, createBoxClient }, { intervalMs: 3000 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(timers.length).toBe(1);

    stop1();
    stop2();
    console.warn = originalWarn;
    restoreTimers();
  });
});

// ===========================================================================
// TC-DP-10: stop() cleanup
// ===========================================================================

describe('detectionPoller — cleanup', () => {
  test('TC-DP-10: stop() 후 인터벌 해제 및 재시작 가능', async () => {
    const createBoxClient = createMockBoxClient(() => makeDetectionsResponse([]));
    const { timers, restoreTimers } = installFakeTimers();

    const stop = startDetectionPoller({ db, vaultKey: TEST_VAULT_KEY, createBoxClient }, { intervalMs: 3000 });
    stop();

    expect(timers[0]?.cleared).toBe(true);

    // 싱글톤 해제 후 재시작 가능
    const warnSpy = mock((..._args: unknown[]) => {});
    const originalWarn = console.warn;
    console.warn = warnSpy as typeof console.warn;

    const stop2 = startDetectionPoller({ db, vaultKey: TEST_VAULT_KEY, createBoxClient }, { intervalMs: 3000 });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(timers.length).toBe(2);

    stop2();
    console.warn = originalWarn;
    restoreTimers();
  });
});

// ===========================================================================
// TC-DP-11: intervalMs 환경변수 기본값 (3000ms)
// ===========================================================================

describe('detectionPoller — 인터벌', () => {
  test('TC-DP-11: 기본 인터벌은 3000ms', async () => {
    const createBoxClient = createMockBoxClient(() => makeDetectionsResponse([]));
    const { timers, restoreTimers } = installFakeTimers();

    const stop = startDetectionPoller({ db, vaultKey: TEST_VAULT_KEY, createBoxClient });
    expect(timers[0]?.intervalMs).toBe(3000);

    stop();
    restoreTimers();
  });
});
