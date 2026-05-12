/**
 * SPEC-AUTH-001 — auth_token_blacklist 테이블 테스트.
 *
 * RED 단계: 아직 스키마와 마이그레이션이 없으므로 모두 실패한다.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { blacklistJti } from '../helpers/auth';
import { runMigrations } from '../migrate';

const TMP_DB = join(import.meta.dir, '.test-auth.sqlite');

// 테스트 DB 파일 정리 헬퍼
function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

beforeEach(cleanup);
afterEach(cleanup);

// 테스트용 users 행 삽입 헬퍼
function insertTestUser(sqlite: Database, userId: string) {
  sqlite
    .prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
    .run(userId, `user-${userId}`, `${userId}@test.com`, '$2b$04$dummy');
}

describe('auth_token_blacklist 테이블', () => {
  test('0002 마이그레이션이 auth_token_blacklist 테이블을 생성한다', async () => {
    const result = await runMigrations({ databasePath: TMP_DB });
    // 0001 + 0002 두 파일이 적용되어야 한다
    expect(result.applied).toContain('0002_auth_blacklist.sql');

    const sqlite = new Database(TMP_DB);
    const tables = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_token_blacklist'")
      .all() as { name: string }[];
    expect(tables.length).toBe(1);
    sqlite.close();
  });

  test('jti, expires_at 인덱스가 생성된다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    const indexes = sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_auth_token_blacklist%'",
      )
      .all() as { name: string }[];
    const names = new Set(indexes.map((i) => i.name));
    expect(names.has('idx_auth_token_blacklist_jti')).toBe(true);
    expect(names.has('idx_auth_token_blacklist_expires_at')).toBe(true);
    sqlite.close();
  });

  test('중복 jti 삽입 시 UNIQUE 제약 위반 오류가 발생한다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const userId = ulid();
    insertTestUser(sqlite, userId);

    const now = Date.now();
    const jti = 'jti-duplicate-test';
    sqlite
      .prepare(
        'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(ulid(), jti, userId, now + 3600_000, now);

    // 동일한 jti 재삽입 시 UNIQUE 제약 위반
    expect(() => {
      sqlite
        .prepare(
          'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(ulid(), jti, userId, now + 3600_000, now);
    }).toThrow();

    sqlite.close();
  });

  test('jti 로 행을 조회할 수 있다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const userId = ulid();
    insertTestUser(sqlite, userId);

    const now = Date.now();
    const jti = 'jti-query-test';
    const id = ulid();
    sqlite
      .prepare(
        'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, jti, userId, now + 3600_000, now);

    const row = sqlite.query('SELECT * FROM auth_token_blacklist WHERE jti = ?').get(jti) as {
      id: string;
      jti: string;
      user_id: string;
    } | null;

    expect(row).not.toBeNull();
    expect(row?.id).toBe(id);
    expect(row?.jti).toBe(jti);
    expect(row?.user_id).toBe(userId);
    sqlite.close();
  });

  test('user_id 외래키 — 존재하지 않는 user_id 삽입 시 오류가 발생한다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const now = Date.now();

    expect(() => {
      sqlite
        .prepare(
          'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(ulid(), 'jti-fk-test', 'nonexistent-user', now + 3600_000, now);
    }).toThrow();

    sqlite.close();
  });

  test('users 삭제 시 auth_token_blacklist 가 CASCADE 삭제된다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const userId = ulid();
    insertTestUser(sqlite, userId);

    const now = Date.now();
    sqlite
      .prepare(
        'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(ulid(), 'jti-cascade-test', userId, now + 3600_000, now);

    sqlite.prepare('DELETE FROM users WHERE id = ?').run(userId);

    const remaining = sqlite.query('SELECT COUNT(*) as c FROM auth_token_blacklist').get() as {
      c: number;
    };
    expect(remaining.c).toBe(0);
    sqlite.close();
  });
});

describe('blacklistJti 헬퍼 함수', () => {
  test('jti 를 삽입하고 만료된 항목을 동시에 정리한다 (REQ-AUTH-011)', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const userId = ulid();
    insertTestUser(sqlite, userId);
    sqlite.close();

    const now = Date.now();
    const expiredJti = 'jti-expired';
    const freshJti1 = 'jti-fresh-existing';
    const newJti = 'jti-new';

    // 만료된 항목 직접 삽입 (헬퍼 우회)
    const sqlite2 = new Database(TMP_DB);
    sqlite2.exec('PRAGMA foreign_keys = ON;');
    sqlite2
      .prepare(
        'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(ulid(), expiredJti, userId, now - 1000, now - 10_000); // 이미 만료

    // 아직 살아 있는 기존 항목
    sqlite2
      .prepare(
        'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(ulid(), freshJti1, userId, now + 3600_000, now);
    sqlite2.close();

    // blacklistJti 호출 — 새 jti 삽입 + 만료된 항목 정리
    await blacklistJti(TMP_DB, {
      jti: newJti,
      userId,
      expiresAt: now + 900_000,
    });

    const sqlite3 = new Database(TMP_DB);
    const rows = sqlite3.query('SELECT jti FROM auth_token_blacklist').all() as { jti: string }[];
    const jtis = new Set(rows.map((r) => r.jti));

    // 만료된 jti 는 삭제되어야 한다
    expect(jtis.has(expiredJti)).toBe(false);
    // 살아 있는 기존 항목은 유지되어야 한다
    expect(jtis.has(freshJti1)).toBe(true);
    // 새로 삽입된 jti 가 존재해야 한다
    expect(jtis.has(newJti)).toBe(true);
    sqlite3.close();
  });

  test('blacklistJti 는 삽입된 항목을 반환한다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const userId = ulid();
    insertTestUser(sqlite, userId);
    sqlite.close();

    const now = Date.now();
    const result = await blacklistJti(TMP_DB, {
      jti: 'jti-return-test',
      userId,
      expiresAt: now + 900_000,
    });

    expect(result.jti).toBe('jti-return-test');
    expect(result.userId).toBe(userId);
    expect(result.id).toBeTruthy();
  });
});
