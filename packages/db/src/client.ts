/**
 * SQLite 연결 팩토리.
 *
 * - `bun:sqlite` 네이티브 드라이버를 사용한다.
 * - `drizzle-orm/bun-sqlite` 어댑터로 Drizzle 인스턴스를 노출한다.
 * - 외래키 제약은 connection-level pragma 로 활성화된다.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

/**
 * 지정된 경로의 SQLite 파일을 열어 Drizzle 인스턴스를 반환한다.
 * 부모 디렉토리가 없으면 생성한다.
 */
export function createDb(path: string): Db {
  const dir = dirname(path);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(path);
  // WAL 모드 + 외래키 활성화 (모든 connection 에서 동일하게 적용)
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  return drizzle(sqlite, { schema }) as Db;
}

/** Drizzle 인스턴스에서 내부 bun:sqlite Database 핸들을 추출 */
export function getRawSqlite(db: Db): Database {
  return db.$client;
}
