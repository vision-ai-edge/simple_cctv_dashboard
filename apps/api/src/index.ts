#!/usr/bin/env bun
/**
 * apps/api 엔트리포인트.
 * - 환경 변수 검증
 * - DB 초기화
 * - Hono 앱 구성
 * - Bun.serve 로 HTTP 서버 시작
 */

import './types/env';
import { assertBoxVaultKey, createBoxClient } from '@cctv/shared';
import { createApp } from './app';
import { loadConfig } from './config';
import { initDb } from './db/client';
import { createLogger } from './logger';
import { startBoxStatusPoller } from './workers/boxStatusPoller';

const config = loadConfig();

// SPEC-BOX-001 REQ-MOD-1: BOX_VAULT_KEY 형식 검증 (Zod 이후 이중 방어)
assertBoxVaultKey(config.BOX_VAULT_KEY);

const logger = createLogger({ mode: config.NODE_ENV });
const db = initDb({ databasePath: config.DATABASE_PATH, logger });

// SPEC-AUTH-001: jwtSecret 주입
// SPEC-BOX-001: boxVaultKey + createBoxClient 팩토리 주입
const app = createApp({
  db,
  logger,
  mode: config.NODE_ENV,
  jwtSecret: config.JWT_SECRET,
  boxVaultKey: config.BOX_VAULT_KEY,
  createBoxClient: (baseUrl, token) => createBoxClient({ baseUrl, jwt: token }),
});

// SPEC-BOX-001 REQ-MOD-4: Box 상태 폴링 워커 시작 (서버 listen 직전)
const stopPoller = startBoxStatusPoller(
  {
    db,
    vaultKey: config.BOX_VAULT_KEY,
    createBoxClient: (baseUrl, token) => createBoxClient({ baseUrl, jwt: token }),
  },
  { intervalMs: config.BOX_STATUS_POLL_INTERVAL_MS },
);

logger.info('CCTV API 서버 시작', { port: config.API_PORT, mode: config.NODE_ENV });

const server = Bun.serve({
  port: config.API_PORT,
  fetch: app.fetch,
});

// 종료 시그널 처리 — 개발 환경 hot reload 호환성
function shutdown(signal: string) {
  logger.info('shutdown signal 수신', { signal });
  stopPoller();
  server.stop();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
