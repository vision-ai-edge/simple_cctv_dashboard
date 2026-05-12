import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '../migrate';
import { seedAdmin } from '../seed';

const TMP_DB = join(import.meta.dir, '.test-cctv.sqlite');

function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

beforeEach(cleanup);
afterEach(cleanup);

describe('runMigrations', () => {
  test('초기 마이그레이션은 8개 테이블을 생성한다', async () => {
    const result = await runMigrations({ databasePath: TMP_DB });
    expect(result.applied).toEqual(['0001_init.sql']);
    expect(result.skipped).toEqual([]);

    const sqlite = new Database(TMP_DB);
    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));
    for (const expected of [
      'users',
      'boxes',
      'cameras',
      'camera_groups',
      'alerts',
      'alert_rules',
      'web_push_subs',
      'telegram_subs',
    ]) {
      expect(names.has(expected)).toBe(true);
    }
    sqlite.close();
  });

  test('재실행 시 멱등성 — 두 번째 호출은 모두 스킵된다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const second = await runMigrations({ databasePath: TMP_DB });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001_init.sql']);
  });

  test('인덱스가 생성된다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    const indexes = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const names = new Set(indexes.map((i) => i.name));
    for (const expected of [
      'users_username_idx',
      'users_email_idx',
      'boxes_status_idx',
      'cameras_box_id_idx',
      'cameras_status_idx',
      'alerts_camera_id_idx',
      'alerts_processed_idx',
      'alert_rules_camera_id_idx',
    ]) {
      expect(names.has(expected)).toBe(true);
    }
    sqlite.close();
  });

  test('boxes.status CHECK 제약은 허용되지 않은 값을 거부한다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    expect(() => {
      sqlite
        .prepare(
          'INSERT INTO boxes (id, name, base_url, username, password_enc, status) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('b1', 'test', 'http://x', 'u', new Uint8Array([1, 2, 3]), 'invalid-status');
    }).toThrow();
    sqlite.close();
  });
});

describe('seedAdmin', () => {
  test('새 관리자를 생성하고 bcrypt 해시를 저장한다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const result = await seedAdmin({
      databasePath: TMP_DB,
      username: 'admin',
      password: 'test-password',
      bcryptRounds: 4,
    });
    expect(result.inserted).toBe(true);
    expect(result.userId).toBeTruthy();

    const sqlite = new Database(TMP_DB);
    const row = sqlite
      .query('SELECT username, password_hash FROM users WHERE username = ?')
      .get('admin') as { username: string; password_hash: string };
    expect(row.username).toBe('admin');
    expect(row.password_hash.startsWith('$2')).toBe(true);
    sqlite.close();
  });

  test('이미 존재하는 사용자에게는 중복 삽입하지 않는다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const first = await seedAdmin({
      databasePath: TMP_DB,
      username: 'admin',
      password: 'p1',
      bcryptRounds: 4,
    });
    expect(first.inserted).toBe(true);

    const second = await seedAdmin({
      databasePath: TMP_DB,
      username: 'admin',
      password: 'p2',
      bcryptRounds: 4,
    });
    expect(second.inserted).toBe(false);
    expect(second.userId).toBe(first.userId);
  });
});

describe('cascade delete', () => {
  test('boxes 삭제 시 cameras 가 함께 삭제된다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite
      .prepare('INSERT INTO boxes (id, name, base_url, username, password_enc) VALUES (?,?,?,?,?)')
      .run('b1', 'box1', 'http://x', 'u', new Uint8Array([1]));
    sqlite
      .prepare('INSERT INTO cameras (id, box_id, channel_id, name) VALUES (?,?,?,?)')
      .run('cam1', 'b1', 'ch1', 'Camera 1');

    sqlite.prepare('DELETE FROM boxes WHERE id = ?').run('b1');
    const remaining = sqlite.query('SELECT COUNT(*) as c FROM cameras').get() as { c: number };
    expect(remaining.c).toBe(0);
    sqlite.close();
  });
});
