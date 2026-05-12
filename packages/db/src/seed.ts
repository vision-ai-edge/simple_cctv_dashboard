#!/usr/bin/env bun
/**
 * 기본 관리자 시드.
 *
 * 환경 변수:
 *   ADMIN_USERNAME (필수)
 *   ADMIN_PASSWORD (필수)
 *   DATABASE_PATH  (필수)
 *
 * 동작:
 *  - bcrypt 로 비밀번호 해시
 *  - `INSERT OR IGNORE` 로 이미 존재하면 중복 삽입하지 않음
 */

import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import { createDb, getRawSqlite } from './client';

export interface SeedAdminOptions {
  databasePath: string;
  username: string;
  password: string;
  email?: string;
  /** bcrypt 비용 인자 (테스트에서는 4 권장) */
  bcryptRounds?: number;
}

export interface SeedAdminResult {
  inserted: boolean;
  userId: string | null;
}

export async function seedAdmin(opts: SeedAdminOptions): Promise<SeedAdminResult> {
  const db = createDb(opts.databasePath);
  const sqlite = getRawSqlite(db);

  const existing = sqlite.query('SELECT id FROM users WHERE username = ?').get(opts.username) as
    | { id: string }
    | undefined;

  if (existing) {
    sqlite.close();
    return { inserted: false, userId: existing.id };
  }

  const id = ulid();
  const passwordHash = await bcrypt.hash(opts.password, opts.bcryptRounds ?? 10);
  const email = opts.email ?? `${opts.username}@localhost`;
  const now = Date.now();

  sqlite
    .prepare(
      'INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, opts.username, email, passwordHash, now, now);

  sqlite.close();
  return { inserted: true, userId: id };
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const { ADMIN_USERNAME, ADMIN_PASSWORD, DATABASE_PATH } = process.env;
  const missing: string[] = [];
  if (!ADMIN_USERNAME) missing.push('ADMIN_USERNAME');
  if (!ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
  if (!DATABASE_PATH) missing.push('DATABASE_PATH');
  if (missing.length > 0) {
    console.error(`[error] 환경 변수 누락: ${missing.join(', ')}`);
    process.exit(1);
  }

  try {
    const result = await seedAdmin({
      databasePath: DATABASE_PATH as string,
      username: ADMIN_USERNAME as string,
      password: ADMIN_PASSWORD as string,
    });
    if (result.inserted) {
      console.log(`[ok] 관리자 생성 — id=${result.userId}, username=${ADMIN_USERNAME}`);
    } else {
      console.log(`[skip] 관리자가 이미 존재합니다 — id=${result.userId}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('[error]', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
