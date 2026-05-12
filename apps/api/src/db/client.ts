/**
 * apps/api 의 DB 연결 부트스트랩.
 * `@cctv/db` 의 createDb 를 감싸 실패 시 명확한 종료 코드를 보장한다.
 */

import { type Db, createDb } from '@cctv/db';
import type { Logger } from '../logger';

export interface InitDbOptions {
  databasePath: string;
  logger: Logger;
}

export function initDb({ databasePath, logger }: InitDbOptions): Db {
  try {
    const db = createDb(databasePath);
    logger.info('DB 연결 성공', { path: databasePath });
    return db;
  } catch (err) {
    logger.error('DB 연결 실패 — 프로세스 종료', {
      path: databasePath,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}
