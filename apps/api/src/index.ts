#!/usr/bin/env bun
/**
 * apps/api 엔트리포인트.
 * - 환경 변수 검증
 * - DB 초기화
 * - Hono 앱 구성
 * - Bun.serve 로 HTTP 서버 시작
 */

import './types/env';
import { createApp } from './app';
import { loadConfig } from './config';
import { initDb } from './db/client';
import { createLogger } from './logger';

const config = loadConfig();
const logger = createLogger({ mode: config.NODE_ENV });
const db = initDb({ databasePath: config.DATABASE_PATH, logger });
// SPEC-AUTH-001: jwtSecret 주입
const app = createApp({ db, logger, mode: config.NODE_ENV, jwtSecret: config.JWT_SECRET });

logger.info('CCTV API 서버 시작', { port: config.API_PORT, mode: config.NODE_ENV });

const server = Bun.serve({
  port: config.API_PORT,
  fetch: app.fetch,
});

// 종료 시그널 처리 — 개발 환경 hot reload 호환성
function shutdown(signal: string) {
  logger.info('shutdown signal 수신', { signal });
  server.stop();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
