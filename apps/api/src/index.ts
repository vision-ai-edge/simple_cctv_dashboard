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
import webPush from 'web-push';
import { createApp } from './app';
import { loadConfig } from './config';
import { initDb } from './db/client';
import { createLogger } from './logger';
import { createAlertDispatcher } from './services/alertDispatcher';
import { startBoxStatusPoller } from './workers/boxStatusPoller';
import { startChannelSyncPoller } from './workers/channelSyncPoller';
import { startDetectionPoller } from './workers/detectionPoller';

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
const stopBoxStatusPoller = startBoxStatusPoller(
  {
    db,
    vaultKey: config.BOX_VAULT_KEY,
    createBoxClient: (baseUrl, token) => createBoxClient({ baseUrl, jwt: token }),
  },
  { intervalMs: config.BOX_STATUS_POLL_INTERVAL_MS },
);

// SPEC-BOX-CHANNELS-001 REQ-CHAN-002: 채널 동기화 폴링 워커 시작
const stopChannelSyncPoller = startChannelSyncPoller({
  db,
  vaultKey: config.BOX_VAULT_KEY,
  createBoxClient: (baseUrl, token) => createBoxClient({ baseUrl, jwt: token }),
});

// SPEC-ALERTS-001 M2-4: WebPush VAPID 설정 (ENV 미설정 시 비활성)
let webPushInstance: typeof webPush | null = null;
if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_CONTACT) {
  try {
    webPush.setVapidDetails(
      config.VAPID_CONTACT,
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY,
    );
    webPushInstance = webPush;
    logger.info('WebPush VAPID 설정 완료');
  } catch (err) {
    logger.warn('WebPush VAPID 설정 실패 — WebPush 비활성', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
} else {
  logger.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_CONTACT 미설정 — WebPush 채널 비활성');
}

if (!config.TELEGRAM_BOT_TOKEN) {
  logger.warn('TELEGRAM_BOT_TOKEN 미설정 — Telegram 채널 비활성');
}

// SPEC-ALERTS-001 M2-2: AlertDispatcher 생성
const alertDispatcher = createAlertDispatcher({
  db,
  webPush: webPushInstance,
  telegramToken: config.TELEGRAM_BOT_TOKEN ?? null,
});

// SPEC-ALERTS-001 M2-1: Detection 폴링 워커 시작
const stopDetectionPoller = startDetectionPoller(
  {
    db,
    vaultKey: config.BOX_VAULT_KEY,
    createBoxClient: (baseUrl, token) => createBoxClient({ baseUrl, jwt: token }),
    alertDispatcher,
  },
  { intervalMs: config.DETECTION_POLL_INTERVAL_MS },
);

logger.info('CCTV API 서버 시작', { port: config.API_PORT, mode: config.NODE_ENV });

const server = Bun.serve({
  port: config.API_PORT,
  fetch: app.fetch,
});

// 종료 시그널 처리 — 개발 환경 hot reload 호환성
function shutdown(signal: string) {
  logger.info('shutdown signal 수신', { signal });
  stopBoxStatusPoller();
  stopChannelSyncPoller();
  stopDetectionPoller();
  server.stop();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
