/**
 * SPEC-ALERTS-001 M1-5: 마이그레이션 0006 통합 테스트.
 *
 * 검증 항목:
 *   - 0006 마이그레이션이 정상 적용된다
 *   - 4개 신규 테이블이 생성된다
 *   - CHECK 제약이 허용되지 않은 값을 거부한다
 *   - 외래키 CASCADE on delete 가 동작한다
 *   - 멱등성: 두 번째 실행 시 스킵된다
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '../migrate';

const TMP_DB = join(import.meta.dir, '.test-migration-0006.sqlite');

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

beforeEach(cleanup);
afterEach(cleanup);

async function applyAll() {
  return runMigrations({ databasePath: TMP_DB });
}

describe('마이그레이션 0006 — webpush_subscriptions', () => {
  test('테이블이 생성되고 컬럼이 존재한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    const info = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='webpush_subscriptions'")
      .all() as { name: string }[];
    expect(info).toHaveLength(1);

    const cols = db.query('PRAGMA table_info(webpush_subscriptions)').all() as {
      name: string;
    }[];
    const colNames = new Set(cols.map((c) => c.name));
    for (const expected of ['id', 'user_id', 'endpoint', 'p256dh', 'auth', 'created_at']) {
      expect(colNames.has(expected)).toBe(true);
    }
    db.close();
  });

  test('webpush_subscriptions_user_idx 인덱스가 생성된다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='webpush_subscriptions_user_idx'",
      )
      .all() as { name: string }[];
    expect(idx).toHaveLength(1);
    db.close();
  });

  test('(user_id, endpoint) UNIQUE 제약이 중복 삽입을 거부한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?,?,?,?)').run(
      'u1',
      'alice',
      'a@a.com',
      'hash',
    );
    db.prepare(
      'INSERT INTO webpush_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?,?,?,?,?)',
    ).run('ws1', 'u1', 'https://endpoint.example.com/sub1', 'p256dh-value', 'auth-value');

    expect(() => {
      db.prepare(
        'INSERT INTO webpush_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?,?,?,?,?)',
      ).run('ws2', 'u1', 'https://endpoint.example.com/sub1', 'other-p256dh', 'other-auth');
    }).toThrow();
    db.close();
  });

  test('users 삭제 시 webpush_subscriptions 가 CASCADE 삭제된다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?,?,?,?)').run(
      'u2',
      'bob',
      'b@b.com',
      'hash',
    );
    db.prepare(
      'INSERT INTO webpush_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?,?,?,?,?)',
    ).run('ws3', 'u2', 'https://ep.example.com/sub', 'p256', 'auth');

    db.prepare('DELETE FROM users WHERE id = ?').run('u2');
    const remaining = db
      .query('SELECT COUNT(*) as c FROM webpush_subscriptions WHERE user_id = ?')
      .get('u2') as { c: number };
    expect(remaining.c).toBe(0);
    db.close();
  });
});

describe('마이그레이션 0006 — alert_destinations', () => {
  test('테이블이 생성되고 컬럼이 존재한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    const info = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='alert_destinations'")
      .all() as { name: string }[];
    expect(info).toHaveLength(1);

    const cols = db.query('PRAGMA table_info(alert_destinations)').all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    for (const expected of [
      'id',
      'user_id',
      'channel',
      'enabled',
      'config_json',
      'created_at',
      'updated_at',
    ]) {
      expect(colNames.has(expected)).toBe(true);
    }
    db.close();
  });

  test('channel CHECK 제약은 허용되지 않은 값을 거부한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?,?,?,?)').run(
      'u3',
      'carol',
      'c@c.com',
      'hash',
    );

    expect(() => {
      db.prepare('INSERT INTO alert_destinations (id, user_id, channel) VALUES (?,?,?)').run(
        'ad1',
        'u3',
        'email',
      ); // 'email' 은 허용 값이 아님
    }).toThrow();
    db.close();
  });

  test("channel CHECK 허용 값 ('toast','webpush','telegram') 은 삽입 가능하다", async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?,?,?,?)').run(
      'u4',
      'dave',
      'd@d.com',
      'hash',
    );

    for (const [i, channel] of ['toast', 'webpush', 'telegram'].entries()) {
      expect(() => {
        db.prepare('INSERT INTO alert_destinations (id, user_id, channel) VALUES (?,?,?)').run(
          `ad-${i}`,
          'u4',
          channel,
        );
      }).not.toThrow();
    }
    db.close();
  });

  test('(user_id, channel) UNIQUE 제약이 중복 삽입을 거부한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?,?,?,?)').run(
      'u5',
      'eve',
      'e@e.com',
      'hash',
    );
    db.prepare('INSERT INTO alert_destinations (id, user_id, channel) VALUES (?,?,?)').run(
      'ad-dup1',
      'u5',
      'toast',
    );

    expect(() => {
      db.prepare('INSERT INTO alert_destinations (id, user_id, channel) VALUES (?,?,?)').run(
        'ad-dup2',
        'u5',
        'toast',
      );
    }).toThrow();
    db.close();
  });

  test('users 삭제 시 alert_destinations 가 CASCADE 삭제된다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?,?,?,?)').run(
      'u6',
      'frank',
      'f@f.com',
      'hash',
    );
    db.prepare('INSERT INTO alert_destinations (id, user_id, channel) VALUES (?,?,?)').run(
      'ad-del',
      'u6',
      'webpush',
    );

    db.prepare('DELETE FROM users WHERE id = ?').run('u6');
    const remaining = db
      .query('SELECT COUNT(*) as c FROM alert_destinations WHERE user_id = ?')
      .get('u6') as { c: number };
    expect(remaining.c).toBe(0);
    db.close();
  });
});

describe('마이그레이션 0006 — detection_alerts', () => {
  test('테이블이 생성되고 컬럼이 존재한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    const info = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='detection_alerts'")
      .all() as { name: string }[];
    expect(info).toHaveLength(1);

    const cols = db.query('PRAGMA table_info(detection_alerts)').all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    for (const expected of [
      'id',
      'box_id',
      'channel_id',
      'type',
      'payload_json',
      'fired_at',
      'status',
      'created_at',
    ]) {
      expect(colNames.has(expected)).toBe(true);
    }
    db.close();
  });

  test('detection_alerts_box_channel_fired_idx 인덱스가 생성된다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='detection_alerts_box_channel_fired_idx'",
      )
      .all() as { name: string }[];
    expect(idx).toHaveLength(1);
    db.close();
  });

  test('detection_alerts_status_idx 인덱스가 생성된다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='detection_alerts_status_idx'",
      )
      .all() as { name: string }[];
    expect(idx).toHaveLength(1);
    db.close();
  });

  test("status CHECK 허용 값 ('new','delivered') 은 삽입 가능하다", async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare(
      'INSERT INTO boxes (id, name, base_url, username, password_enc) VALUES (?,?,?,?,?)',
    ).run('bx1', 'Box1', 'http://bx1', 'u', new Uint8Array([1]));

    for (const [i, status] of ['new', 'delivered'].entries()) {
      expect(() => {
        db.prepare(
          'INSERT INTO detection_alerts (id, box_id, channel_id, type, payload_json, fired_at, status) VALUES (?,?,?,?,?,?,?)',
        ).run(`da-${i}`, 'bx1', 'ch1', 'intrusion', '{}', Date.now(), status);
      }).not.toThrow();
    }
    db.close();
  });

  test('status CHECK 제약은 허용되지 않은 값을 거부한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare(
      'INSERT INTO boxes (id, name, base_url, username, password_enc) VALUES (?,?,?,?,?)',
    ).run('bx2', 'Box2', 'http://bx2', 'u', new Uint8Array([1]));

    expect(() => {
      db.prepare(
        'INSERT INTO detection_alerts (id, box_id, channel_id, type, payload_json, fired_at, status) VALUES (?,?,?,?,?,?,?)',
      ).run('da-bad', 'bx2', 'ch1', 'fall', '{}', Date.now(), 'pending');
    }).toThrow();
    db.close();
  });

  test('boxes 삭제 시 detection_alerts 가 CASCADE 삭제된다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare(
      'INSERT INTO boxes (id, name, base_url, username, password_enc) VALUES (?,?,?,?,?)',
    ).run('bx3', 'Box3', 'http://bx3', 'u', new Uint8Array([1]));
    db.prepare(
      'INSERT INTO detection_alerts (id, box_id, channel_id, type, payload_json, fired_at) VALUES (?,?,?,?,?,?)',
    ).run('da-del', 'bx3', 'ch1', 'intrusion', '{}', Date.now());

    db.prepare('DELETE FROM boxes WHERE id = ?').run('bx3');
    const remaining = db
      .query('SELECT COUNT(*) as c FROM detection_alerts WHERE box_id = ?')
      .get('bx3') as { c: number };
    expect(remaining.c).toBe(0);
    db.close();
  });
});

describe('마이그레이션 0006 — detection_cursor', () => {
  test('테이블이 생성되고 복합 PK 컬럼이 존재한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    const info = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='detection_cursor'")
      .all() as { name: string }[];
    expect(info).toHaveLength(1);

    const cols = db.query('PRAGMA table_info(detection_cursor)').all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    for (const expected of ['box_id', 'channel_id', 'last_seen_timestamp', 'updated_at']) {
      expect(colNames.has(expected)).toBe(true);
    }
    db.close();
  });

  test('(box_id, channel_id) PRIMARY KEY 는 중복 삽입을 거부한다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare(
      'INSERT INTO boxes (id, name, base_url, username, password_enc) VALUES (?,?,?,?,?)',
    ).run('bx4', 'Box4', 'http://bx4', 'u', new Uint8Array([1]));
    db.prepare(
      'INSERT INTO detection_cursor (box_id, channel_id, last_seen_timestamp) VALUES (?,?,?)',
    ).run('bx4', 'ch-a', 1748000000000);

    expect(() => {
      db.prepare(
        'INSERT INTO detection_cursor (box_id, channel_id, last_seen_timestamp) VALUES (?,?,?)',
      ).run('bx4', 'ch-a', 1748000001000);
    }).toThrow();
    db.close();
  });

  test('boxes 삭제 시 detection_cursor 가 CASCADE 삭제된다', async () => {
    await applyAll();
    const db = new Database(TMP_DB);
    db.exec('PRAGMA foreign_keys = ON;');
    db.prepare(
      'INSERT INTO boxes (id, name, base_url, username, password_enc) VALUES (?,?,?,?,?)',
    ).run('bx5', 'Box5', 'http://bx5', 'u', new Uint8Array([1]));
    db.prepare(
      'INSERT INTO detection_cursor (box_id, channel_id, last_seen_timestamp) VALUES (?,?,?)',
    ).run('bx5', 'ch-b', 1748000000000);

    db.prepare('DELETE FROM boxes WHERE id = ?').run('bx5');
    const remaining = db
      .query('SELECT COUNT(*) as c FROM detection_cursor WHERE box_id = ?')
      .get('bx5') as { c: number };
    expect(remaining.c).toBe(0);
    db.close();
  });
});

describe('마이그레이션 0006 — 멱등성', () => {
  test('재실행 시 0006 파일은 스킵된다', async () => {
    await applyAll();
    const second = await applyAll();
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain('0006_alerts_and_models.sql');
  });

  test('0006 마이그레이션이 applied 목록에 포함된다', async () => {
    const result = await applyAll();
    expect(result.applied).toContain('0006_alerts_and_models.sql');
  });
});
