#!/usr/bin/env bun
/**
 * 마이그레이션 러너.
 *
 * `src/migrations/*.sql` 파일을 사전순으로 적용한다.
 * 각 파일은 단일 트랜잭션 내에서 실행되어 부분 적용을 방지한다.
 *
 * 적용된 마이그레이션은 `__migrations` 메타 테이블에 기록되어 재실행 시 멱등성을 보장한다.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, getRawSqlite } from './client';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('./migrations', import.meta.url).href).replace(/^file:\/\//, ''),
);

export interface MigrationRunOptions {
  databasePath: string;
  migrationsDir?: string;
  /** 디버그 로깅 활성화 */
  verbose?: boolean;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(opts: MigrationRunOptions): Promise<MigrationResult> {
  const dir = opts.migrationsDir ?? MIGRATIONS_DIR;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const db = createDb(opts.databasePath);
  const sqlite = getRawSqlite(db);

  // 메타 테이블 보장
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      filename   TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
  `);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const filename = basename(file);
    const existing = sqlite
      .query('SELECT filename FROM __migrations WHERE filename = ?')
      .get(filename);
    if (existing) {
      skipped.push(filename);
      if (opts.verbose) console.log(`[skip] ${filename} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(dir, file), 'utf-8');
    try {
      sqlite.transaction(() => {
        sqlite.exec(sql);
        sqlite.prepare('INSERT INTO __migrations (filename) VALUES (?)').run(filename);
      })();
      applied.push(filename);
      if (opts.verbose) console.log(`[apply] ${filename}`);
    } catch (err) {
      throw new Error(
        `마이그레이션 실패: ${filename} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  sqlite.close();
  return { applied, skipped };
}

// ---------------------------------------------------------------------------
// CLI 진입점 (bun run src/migrate.ts)
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const databasePath = process.env.DATABASE_PATH;
  if (!databasePath) {
    console.error('[error] 환경 변수 DATABASE_PATH 가 설정되지 않았습니다.');
    process.exit(1);
  }
  try {
    const result = await runMigrations({ databasePath, verbose: true });
    console.log(
      `[ok] 마이그레이션 완료 — 적용 ${result.applied.length}, 스킵 ${result.skipped.length}`,
    );
    process.exit(0);
  } catch (err) {
    console.error('[error]', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
