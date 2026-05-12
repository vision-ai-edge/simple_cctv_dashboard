/**
 * SPEC-AUTH-001 — 인증 관련 DB 헬퍼 함수.
 *
 * REQ-AUTH-011: JTI 블랙리스트 삽입 + 만료 항목 동시 정리.
 * 두 작업을 단일 트랜잭션에서 처리하여 원자성을 보장한다.
 */

import { ulid } from 'ulid';
import { createDb, getRawSqlite } from '../client';

export interface BlacklistJtiOptions {
  /** JWT ID (jti 클레임) */
  jti: string;
  /** 토큰 소유 사용자 ID */
  userId: string;
  /** 토큰 만료 시각 (Unix ms) */
  expiresAt: number;
}

export interface BlacklistJtiResult {
  id: string;
  jti: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

/**
 * JTI 를 블랙리스트에 등록하고, 이미 만료된 항목을 동시에 정리한다.
 *
 * REQ-AUTH-011: INSERT + 만료 항목 DELETE 를 동일 트랜잭션에서 실행.
 *
 * @param databasePath - SQLite 파일 경로
 * @param opts - 블랙리스트 등록 옵션
 * @returns 삽입된 행 정보
 */
export async function blacklistJti(
  databasePath: string,
  opts: BlacklistJtiOptions,
): Promise<BlacklistJtiResult> {
  const db = createDb(databasePath);
  const sqlite = getRawSqlite(db);

  const id = ulid();
  const now = Date.now();

  // 단일 트랜잭션: 만료 항목 정리 + 새 JTI 삽입
  sqlite.transaction(() => {
    // 만료된 항목 정리 (expires_at < 현재 시각)
    sqlite.prepare('DELETE FROM auth_token_blacklist WHERE expires_at < ?').run(now);

    // 새 JTI 삽입
    sqlite
      .prepare(
        'INSERT INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, opts.jti, opts.userId, opts.expiresAt, now);
  })();

  sqlite.close();

  return {
    id,
    jti: opts.jti,
    userId: opts.userId,
    expiresAt: opts.expiresAt,
    createdAt: now,
  };
}

/**
 * DB 인스턴스를 받아 JTI 블랙리스트 조회를 수행한다.
 * (requireAuth 미들웨어용 — DB 인스턴스 재사용)
 */
export function isJtiBlacklisted(sqlite: import('bun:sqlite').Database, jti: string): boolean {
  const row = sqlite.query('SELECT 1 FROM auth_token_blacklist WHERE jti = ?').get(jti);
  return row !== null;
}
