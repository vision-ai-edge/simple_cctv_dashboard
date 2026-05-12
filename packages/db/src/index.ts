/**
 * @cctv/db — Drizzle ORM 기반 영속 계층.
 */

export * as schema from './schema';
export {
  alertRules,
  alerts,
  boxes,
  cameraGroups,
  cameras,
  telegramSubs,
  users,
  webPushSubs,
  type Alert,
  type AlertRule,
  type Box,
  type BoxStatus,
  type Camera,
  type CameraStatus,
  type NewAlert,
  type NewAlertRule,
  type NewBox,
  type NewCamera,
  type NewUser,
  type User,
} from './schema';
// SPEC-AUTH-001: auth_token_blacklist 스키마 및 타입 노출
export {
  authTokenBlacklist,
  type AuthTokenBlacklist,
  type NewAuthTokenBlacklist,
} from './schema/auth';
export { createDb, getRawSqlite, type Db } from './client';
export { runMigrations, type MigrationResult, type MigrationRunOptions } from './migrate';
export { seedAdmin, type SeedAdminOptions, type SeedAdminResult } from './seed';
// SPEC-AUTH-001: 인증 헬퍼 함수 노출
export {
  blacklistJti,
  isJtiBlacklisted,
  type BlacklistJtiOptions,
  type BlacklistJtiResult,
} from './helpers/auth';
