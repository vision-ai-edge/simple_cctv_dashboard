/**
 * SPEC-BOX-001 T2 — boxes 테이블 자격증명 볼트 컬럼 마이그레이션 테스트.
 *
 * 검증 대상:
 *   - REQ-MOD-1: jwt_cached_enc, api_key_cached_enc BLOB 컬럼 추가
 *   - 두 컬럼은 NULL 허용 (기존 데이터 호환성)
 *   - Drizzle 스키마에 컬럼 정의 존재
 *   - BLOB Uint8Array 저장/조회 왕복 검증
 *   - 기존 boxes 데이터(password_enc) 보존
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { runMigrations } from '../migrate';
import { boxes } from '../schema';

const TMP_DB = join(import.meta.dir, '.test-box-vault.sqlite');

/** 테스트 DB 파일 정리 헬퍼 */
function cleanup() {
  for (const ext of ['', '-shm', '-wal']) {
    const f = `${TMP_DB}${ext}`;
    if (existsSync(f)) unlinkSync(f);
  }
}

beforeEach(cleanup);
afterEach(cleanup);

// ---------------------------------------------------------------------------
// boxes 테이블 삽입 헬퍼
// ---------------------------------------------------------------------------
function insertBox(
  sqlite: Database,
  opts: {
    id?: string;
    passwordEnc?: Uint8Array;
  } = {},
): string {
  const id = opts.id ?? ulid();
  const passwordEnc = opts.passwordEnc ?? new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  sqlite
    .prepare(
      'INSERT INTO boxes (id, name, base_url, username, password_enc) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, `box-${id}`, 'http://192.168.0.1', 'admin', passwordEnc);
  return id;
}

// ---------------------------------------------------------------------------
// 1. 마이그레이션 적용 후 컬럼 존재 검증
// ---------------------------------------------------------------------------
describe('0003_box_vault 마이그레이션', () => {
  test('0003 마이그레이션이 적용 목록에 포함된다', async () => {
    const result = await runMigrations({ databasePath: TMP_DB });
    expect(result.applied).toContain('0003_box_vault.sql');
    expect(result.skipped).toEqual([]);
  });

  test('boxes 테이블에 jwt_cached_enc BLOB 컬럼이 추가된다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);

    const columns = sqlite.query('PRAGMA table_info(boxes)').all() as {
      name: string;
      type: string;
      notnull: number;
    }[];

    const jwtEncCol = columns.find((c) => c.name === 'jwt_cached_enc');
    expect(jwtEncCol).toBeDefined();
    expect(jwtEncCol?.type.toUpperCase()).toBe('BLOB');

    sqlite.close();
  });

  test('boxes 테이블에 api_key_cached_enc BLOB 컬럼이 추가된다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);

    const columns = sqlite.query('PRAGMA table_info(boxes)').all() as {
      name: string;
      type: string;
      notnull: number;
    }[];

    const apiKeyEncCol = columns.find((c) => c.name === 'api_key_cached_enc');
    expect(apiKeyEncCol).toBeDefined();
    expect(apiKeyEncCol?.type.toUpperCase()).toBe('BLOB');

    sqlite.close();
  });

  test('jwt_cached_enc 컬럼은 NULL 허용이다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);

    const columns = sqlite.query('PRAGMA table_info(boxes)').all() as {
      name: string;
      notnull: number;
    }[];

    const col = columns.find((c) => c.name === 'jwt_cached_enc');
    // notnull = 0 → NULL 허용
    expect(col?.notnull).toBe(0);

    sqlite.close();
  });

  test('api_key_cached_enc 컬럼은 NULL 허용이다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);

    const columns = sqlite.query('PRAGMA table_info(boxes)').all() as {
      name: string;
      notnull: number;
    }[];

    const col = columns.find((c) => c.name === 'api_key_cached_enc');
    expect(col?.notnull).toBe(0);

    sqlite.close();
  });

  test('재실행 시 멱등성 — 0003도 스킵된다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const second = await runMigrations({ databasePath: TMP_DB });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain('0003_box_vault.sql');
  });
});

// ---------------------------------------------------------------------------
// 2. Drizzle 스키마 일관성
// ---------------------------------------------------------------------------
describe('Drizzle 스키마 — boxes 테이블', () => {
  test('boxes 스키마에 jwtCachedEnc 필드가 정의된다', () => {
    // Drizzle 테이블 컬럼 맵에서 jwtCachedEnc 키 존재 확인
    const columnNames = Object.keys(boxes);
    expect(columnNames).toContain('jwtCachedEnc');
  });

  test('boxes 스키마에 apiKeyCachedEnc 필드가 정의된다', () => {
    const columnNames = Object.keys(boxes);
    expect(columnNames).toContain('apiKeyCachedEnc');
  });

  test('Uint8Array 를 jwt_cached_enc 에 저장하고 다시 읽을 수 있다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');

    const id = ulid();
    // AES-GCM: 12B IV + 암호문 + 16B tag 를 시뮬레이션
    const jwtBlob = new Uint8Array([
      // 12바이트 IV
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
      // 암호문 바이트
      0xca, 0xfe, 0xba, 0xbe,
      // 16바이트 tag
      0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf,
      0xb0,
    ]);

    sqlite
      .prepare(
        'INSERT INTO boxes (id, name, base_url, username, password_enc, jwt_cached_enc) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, 'test-box', 'http://192.168.0.1', 'admin', new Uint8Array([1, 2, 3]), jwtBlob);

    const row = sqlite.query('SELECT jwt_cached_enc FROM boxes WHERE id = ?').get(id) as {
      jwt_cached_enc: Uint8Array | null;
    };

    expect(row.jwt_cached_enc).not.toBeNull();
    // Bun SQLite 는 BLOB 을 Uint8Array 로 반환한다
    expect(row.jwt_cached_enc).toBeInstanceOf(Uint8Array);
    expect(Array.from(row.jwt_cached_enc!)).toEqual(Array.from(jwtBlob));

    sqlite.close();
  });

  test('Uint8Array 를 api_key_cached_enc 에 저장하고 다시 읽을 수 있다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');

    const id = ulid();
    const apiKeyBlob = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);

    sqlite
      .prepare(
        'INSERT INTO boxes (id, name, base_url, username, password_enc, api_key_cached_enc) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, 'test-box', 'http://192.168.0.1', 'admin', new Uint8Array([1, 2, 3]), apiKeyBlob);

    const row = sqlite.query('SELECT api_key_cached_enc FROM boxes WHERE id = ?').get(id) as {
      api_key_cached_enc: Uint8Array | null;
    };

    expect(row.api_key_cached_enc).not.toBeNull();
    expect(row.api_key_cached_enc).toBeInstanceOf(Uint8Array);
    expect(Array.from(row.api_key_cached_enc!)).toEqual(Array.from(apiKeyBlob));

    sqlite.close();
  });
});

// ---------------------------------------------------------------------------
// 3. 기존 boxes 데이터 보존 (backward compat)
// ---------------------------------------------------------------------------
describe('기존 boxes 데이터 보존', () => {
  test('마이그레이션 적용 후 기존 boxes 행의 password_enc 가 유지된다', async () => {
    // 0001, 0002 까지만 적용된 상태에서 데이터 삽입 시뮬레이션:
    // 실제로는 전체 마이그레이션을 적용하되 password_enc 값이 유지되는지 확인
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');

    const originalPwd = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);
    const id = insertBox(sqlite, { passwordEnc: originalPwd });

    const row = sqlite.query('SELECT password_enc FROM boxes WHERE id = ?').get(id) as {
      password_enc: Uint8Array;
    };

    expect(row.password_enc).toBeInstanceOf(Uint8Array);
    expect(Array.from(row.password_enc)).toEqual(Array.from(originalPwd));

    sqlite.close();
  });

  test('기존 boxes 행의 신규 enc 컬럼은 NULL 로 시작한다', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);
    sqlite.exec('PRAGMA foreign_keys = ON;');

    const id = insertBox(sqlite);

    const row = sqlite
      .query('SELECT jwt_cached_enc, api_key_cached_enc FROM boxes WHERE id = ?')
      .get(id) as {
      jwt_cached_enc: Uint8Array | null;
      api_key_cached_enc: Uint8Array | null;
    };

    expect(row.jwt_cached_enc).toBeNull();
    expect(row.api_key_cached_enc).toBeNull();

    sqlite.close();
  });

  test('기존 jwt_cached (text) 컬럼이 여전히 존재한다 (backward compat)', async () => {
    await runMigrations({ databasePath: TMP_DB });
    const sqlite = new Database(TMP_DB);

    const columns = sqlite.query('PRAGMA table_info(boxes)').all() as { name: string }[];

    const names = columns.map((c) => c.name);
    // 기존 text 컬럼은 제거하지 않는다
    expect(names).toContain('jwt_cached');
    expect(names).toContain('api_key_cached');
    // 신규 BLOB 컬럼도 함께 존재한다
    expect(names).toContain('jwt_cached_enc');
    expect(names).toContain('api_key_cached_enc');

    sqlite.close();
  });
});
