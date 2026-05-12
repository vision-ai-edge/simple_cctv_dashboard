/**
 * SPEC-BOX-001 — boxStatusPoller 단위 테스트.
 *
 * RED 단계: boxStatusPoller.ts 가 없으므로 모두 실패한다.
 *
 * 테스트 대상 (REQ-MOD-4):
 *   - active Box 를 60초 주기로 /system/health 폴링
 *   - inactive/error Box 는 폴링 제외
 *   - 200 응답 시 last_sync_at 갱신, status='active' 유지
 *   - 실패 시 연속 실패 카운터 증가
 *   - 3회 연속 실패 시 status='error' 전이 및 폴링 중단
 *   - 성공 시 카운터 초기화
 *   - 싱글톤 보장
 *   - cleanup 함수 동작
 *   - 여러 Box 동시 폴링
 *   - 인터벌 파라미터 커스터마이징
 *
 * 시간 조작: Bun 의 fake timer (vi 유사 API 없음) → setInterval/clearInterval mock 으로 대체
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type Db, createDb, runMigrations } from '@cctv/db';
import type { BoxClient } from '@cctv/shared';
import { BoxApiError } from '@cctv/shared';
import { startBoxStatusPoller } from '../boxStatusPoller';

// ---------------------------------------------------------------------------
// 테스트 DB 설정
// ---------------------------------------------------------------------------

const TMP_DB = join(import.meta.dir, '.test-box-status-poller.sqlite');
const TEST_VAULT_KEY = '0'.repeat(64);

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

// ---------------------------------------------------------------------------
// DB 헬퍼: 테스트용 Box 삽입
// ---------------------------------------------------------------------------

function insertActiveBox(db: Db, id: string, baseUrl = 'https://box1.test:8443/api') {
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
       VALUES (?, ?, 'https://box-inactive.test:8443/api', 'admin', ?, 'inactive', ?, ?)`,
    )
    .run(id, `Box-${id}`, new Uint8Array(32), Date.now(), Date.now());
}

function insertErrorBox(db: Db, id: string) {
  db.$client
    .prepare(
      `INSERT INTO boxes (id, name, base_url, username, password_enc, status, created_at, updated_at)
       VALUES (?, ?, 'https://box-error.test:8443/api', 'admin', ?, 'error', ?, ?)`,
    )
    .run(id, `Box-${id}`, new Uint8Array(32), Date.now(), Date.now());
}

function getBoxStatus(db: Db, id: string): string | null {
  const row = db.$client.query('SELECT status FROM boxes WHERE id = ?').get(id) as {
    status: string;
  } | null;
  return row?.status ?? null;
}

function getBoxLastSyncAt(db: Db, id: string): number | null {
  const row = db.$client.query('SELECT last_sync_at FROM boxes WHERE id = ?').get(id) as {
    last_sync_at: number | null;
  } | null;
  return row?.last_sync_at ?? null;
}

// ---------------------------------------------------------------------------
// BoxClient mock 유틸
// ---------------------------------------------------------------------------

function createHealthMock(result: 'success' | Error) {
  return mock(async () => {
    if (result instanceof Error) throw result;
    return { status: 'ok', uptime: 1234, version: '1.0.0', timestamp: Date.now() };
  });
}

function createMockBoxClientFactory(healthMock: ReturnType<typeof createHealthMock>) {
  return mock((_baseUrl: string, _token?: string): BoxClient => {
    return {
      baseUrl: _baseUrl,
      system: {
        health: healthMock,
        info: mock(async () => ({ version: '1.0.0' })),
      },
      auth: {
        login: mock(async () => ({ token: 'mock-jwt', expiresAt: null })),
        me: mock(async () => ({ username: 'admin', hasApiKey: false })),
        regenerateApiKey: mock(async () => ({ apiKey: 'mock-key' })),
        changePassword: mock(async () => {}),
      },
      setCredentials: mock(() => {}),
    } as unknown as BoxClient;
  });
}

// ---------------------------------------------------------------------------
// setInterval / clearInterval fake timer 구현
// ---------------------------------------------------------------------------

type TimerCallback = () => void | Promise<void>;

interface FakeTimer {
  /** 등록된 콜백을 n 회 직접 실행 (await 포함) */
  tick: (times?: number) => Promise<void>;
  /** 등록된 intervalMs 반환 */
  intervalMs: number;
  /** clearInterval 호출 여부 */
  cleared: boolean;
}

function installFakeTimers(): {
  timers: FakeTimer[];
  restoreTimers: () => void;
} {
  const timers: FakeTimer[] = [];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  // @ts-ignore — override for test
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
    // 실제 setInterval 은 호출하지 않고 인덱스(handle)만 반환
    return timers.length as unknown as ReturnType<typeof setInterval>;
  };

  // @ts-ignore — override for test
  globalThis.clearInterval = (_handle: unknown) => {
    // 마지막 등록된 타이머를 cleared 처리 (단순 구현)
    const last = timers[timers.length - 1]!;
    last.cleared = true;
  };

  return {
    timers,
    restoreTimers: () => {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };
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

// ===========================================================================
// TC-1: active Box 에 대해 /system/health 호출
// ===========================================================================

describe('boxStatusPoller — 기본 폴링', () => {
  test('TC-1: active Box 를 폴링 시 system.health 가 1회 호출된다', async () => {
    const healthMock = createHealthMock('success');
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertActiveBox(db, 'box-001');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    expect(timers.length).toBe(1);
    expect(timers[0]!.intervalMs).toBe(60_000);

    await timers[0]!.tick(1);
    expect(healthMock).toHaveBeenCalledTimes(1);

    stop();
    restoreTimers();
  });

  // TC-2: inactive/error Box 는 폴링 제외
  test('TC-2: inactive Box 는 system.health 를 호출하지 않는다', async () => {
    const healthMock = createHealthMock('success');
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertInactiveBox(db, 'box-inactive');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    await timers[0]!.tick(1);
    expect(healthMock).not.toHaveBeenCalled();

    stop();
    restoreTimers();
  });

  test('TC-2b: error Box 는 system.health 를 호출하지 않는다', async () => {
    const healthMock = createHealthMock('success');
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertErrorBox(db, 'box-error');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    await timers[0]!.tick(1);
    expect(healthMock).not.toHaveBeenCalled();

    stop();
    restoreTimers();
  });
});

// ===========================================================================
// TC-3: 200 응답 → last_sync_at 갱신
// ===========================================================================

describe('boxStatusPoller — 성공 처리', () => {
  test('TC-3: 헬스체크 성공 시 last_sync_at 갱신, status=active 유지', async () => {
    const healthMock = createHealthMock('success');
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertActiveBox(db, 'box-sync');

    const beforeSyncAt = getBoxLastSyncAt(db, 'box-sync');
    expect(beforeSyncAt).toBeNull();

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    await timers[0]!.tick(1);

    const afterSyncAt = getBoxLastSyncAt(db, 'box-sync');
    expect(afterSyncAt).not.toBeNull();
    expect(typeof afterSyncAt).toBe('number');
    expect(afterSyncAt!).toBeGreaterThan(0);

    expect(getBoxStatus(db, 'box-sync')).toBe('active');

    stop();
    restoreTimers();
  });

  // TC-6: 성공 시 카운터 초기화
  test('TC-6: 실패 2회 후 성공 시 연속 실패 카운터가 초기화된다', async () => {
    let callCount = 0;
    const flappingHealth = mock(async () => {
      callCount++;
      if (callCount <= 2) {
        throw new BoxApiError('서비스 불가', 503, Date.now());
      }
      return { status: 'ok', uptime: 1000, version: '1.0.0', timestamp: Date.now() };
    });

    const createBoxClient = mock(
      (_baseUrl: string, _token?: string): BoxClient =>
        ({
          baseUrl: _baseUrl,
          system: { health: flappingHealth, info: mock(async () => ({ version: '1.0.0' })) },
          auth: {
            login: mock(async () => ({ token: 'jwt', expiresAt: null })),
            me: mock(async () => ({ username: 'admin', hasApiKey: false })),
            regenerateApiKey: mock(async () => ({ apiKey: 'k' })),
            changePassword: mock(async () => {}),
          },
          setCredentials: mock(() => {}),
        }) as unknown as BoxClient,
    );

    insertActiveBox(db, 'box-flap');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    // 실패 2회
    await timers[0]!.tick(2);
    // status 는 아직 active (3회 미달)
    expect(getBoxStatus(db, 'box-flap')).toBe('active');

    // 성공 1회 → 카운터 초기화
    await timers[0]!.tick(1);
    expect(getBoxStatus(db, 'box-flap')).toBe('active');
    const syncAt = getBoxLastSyncAt(db, 'box-flap');
    expect(syncAt).not.toBeNull();

    // 이후 2회 더 실패해도 error 전이 안 됨 (카운터가 0 으로 리셋됐으므로)
    callCount = 1; // 다시 실패 2회 시뮬레이션
    await timers[0]!.tick(2);
    expect(getBoxStatus(db, 'box-flap')).toBe('active');

    stop();
    restoreTimers();
  });
});

// ===========================================================================
// TC-4/5: 연속 실패 카운터 및 status='error' 전이
// ===========================================================================

describe('boxStatusPoller — 실패 처리', () => {
  test('TC-4: 실패 시 카운터 증가, status 는 active 유지 (3회 미달)', async () => {
    const healthMock = createHealthMock(new BoxApiError('서비스 불가', 503, Date.now()));
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertActiveBox(db, 'box-fail');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000, maxConsecutiveFailures: 3 },
    );

    // 2회 실패 → status 유지
    await timers[0]!.tick(2);
    expect(getBoxStatus(db, 'box-fail')).toBe('active');
    expect(healthMock).toHaveBeenCalledTimes(2);

    stop();
    restoreTimers();
  });

  test('TC-5: 3회 연속 실패 시 status=error 전이, 이후 폴링 제외', async () => {
    const healthMock = createHealthMock(new BoxApiError('timeout', 408, Date.now()));
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertActiveBox(db, 'box-err');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000, maxConsecutiveFailures: 3 },
    );

    // 3회 실패 → error 전이
    await timers[0]!.tick(3);
    expect(getBoxStatus(db, 'box-err')).toBe('error');

    // 4회째 tick: error 상태이므로 더 이상 health 호출 안 함
    await timers[0]!.tick(1);
    expect(healthMock).toHaveBeenCalledTimes(3); // 4회 호출 없음

    stop();
    restoreTimers();
  });

  test('TC-4b: 네트워크 에러도 카운터 증가 처리', async () => {
    const networkError = new TypeError('fetch failed');
    const healthMock = createHealthMock(networkError);
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertActiveBox(db, 'box-net');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    await timers[0]!.tick(2);
    expect(getBoxStatus(db, 'box-net')).toBe('active');

    stop();
    restoreTimers();
  });
});

// ===========================================================================
// TC-7: 싱글톤 보장
// ===========================================================================

describe('boxStatusPoller — 싱글톤', () => {
  test('TC-7: 2회 호출 시 경고를 출력하고 기존 인스턴스를 유지한다', async () => {
    const warnSpy = mock((..._args: unknown[]) => {});
    const originalWarn = console.warn;
    console.warn = warnSpy as typeof console.warn;

    const healthMock = createHealthMock('success');
    const createBoxClient = createMockBoxClientFactory(healthMock);

    const { timers, restoreTimers } = installFakeTimers();

    const stop1 = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    const stop2 = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    // 두 번째 호출은 경고 발생
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // 인터벌은 하나만 등록됨
    expect(timers.length).toBe(1);

    stop1();
    stop2(); // 동일 인스턴스이므로 문제없이 호출 가능

    console.warn = originalWarn;
    restoreTimers();
  });
});

// ===========================================================================
// TC-8: cleanup 함수
// ===========================================================================

describe('boxStatusPoller — cleanup', () => {
  test('TC-8: stop() 호출 시 인터벌 해제 및 다음 startBoxStatusPoller 호출 허용', async () => {
    const healthMock = createHealthMock('success');
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertActiveBox(db, 'box-clean');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    await timers[0]!.tick(1);
    expect(healthMock).toHaveBeenCalledTimes(1);

    // cleanup 호출
    stop();
    expect(timers[0]!.cleared).toBe(true);

    // 싱글톤 해제됐으므로 새 인스턴스 시작 가능
    const warnSpy = mock((..._args: unknown[]) => {});
    const originalWarn = console.warn;
    console.warn = warnSpy as typeof console.warn;

    const stop2 = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    expect(warnSpy).not.toHaveBeenCalled(); // 경고 없음
    expect(timers.length).toBe(2); // 새 인터벌 등록됨

    stop2();
    console.warn = originalWarn;
    restoreTimers();
  });
});

// ===========================================================================
// TC-9: 여러 Box 동시 폴링
// ===========================================================================

describe('boxStatusPoller — 다중 Box', () => {
  test('TC-9: active Box 3개 → 1회 tick 시 각각 1번씩 health 호출', async () => {
    const callLog: string[] = [];

    const createBoxClient = mock(
      (baseUrl: string, _token?: string): BoxClient =>
        ({
          baseUrl,
          system: {
            health: mock(async () => {
              callLog.push(baseUrl);
              return { status: 'ok', uptime: 100, version: '1.0.0', timestamp: Date.now() };
            }),
            info: mock(async () => ({ version: '1.0.0' })),
          },
          auth: {
            login: mock(async () => ({ token: 'jwt', expiresAt: null })),
            me: mock(async () => ({ username: 'admin', hasApiKey: false })),
            regenerateApiKey: mock(async () => ({ apiKey: 'k' })),
            changePassword: mock(async () => {}),
          },
          setCredentials: mock(() => {}),
        }) as unknown as BoxClient,
    );

    insertActiveBox(db, 'multi-1', 'https://box1.test:8443/api');
    insertActiveBox(db, 'multi-2', 'https://box2.test:8443/api');
    insertActiveBox(db, 'multi-3', 'https://box3.test:8443/api');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 60_000 },
    );

    await timers[0]!.tick(1);

    expect(callLog.length).toBe(3);
    expect(callLog).toContain('https://box1.test:8443/api');
    expect(callLog).toContain('https://box2.test:8443/api');
    expect(callLog).toContain('https://box3.test:8443/api');

    stop();
    restoreTimers();
  });
});

// ===========================================================================
// TC-10: 인터벌 파라미터 커스터마이징
// ===========================================================================

describe('boxStatusPoller — 인터벌 파라미터', () => {
  test('TC-10: intervalMs 옵션으로 폴링 주기를 변경할 수 있다', async () => {
    const healthMock = createHealthMock('success');
    const createBoxClient = createMockBoxClientFactory(healthMock);

    insertActiveBox(db, 'box-interval');

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller(
      { db, vaultKey: TEST_VAULT_KEY, createBoxClient },
      { intervalMs: 1_000 }, // 1초 주기
    );

    expect(timers[0]!.intervalMs).toBe(1_000);

    await timers[0]!.tick(1);
    expect(healthMock).toHaveBeenCalledTimes(1);

    stop();
    restoreTimers();
  });

  test('TC-10b: intervalMs 미지정 시 기본값 60000ms 적용', async () => {
    const healthMock = createHealthMock('success');
    const createBoxClient = createMockBoxClientFactory(healthMock);

    const { timers, restoreTimers } = installFakeTimers();

    const stop = startBoxStatusPoller({ db, vaultKey: TEST_VAULT_KEY, createBoxClient });

    expect(timers[0]!.intervalMs).toBe(60_000);

    stop();
    restoreTimers();
  });
});
