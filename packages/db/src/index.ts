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
export { createDb, getRawSqlite, type Db } from './client';
export { runMigrations, type MigrationResult, type MigrationRunOptions } from './migrate';
export { seedAdmin, type SeedAdminOptions, type SeedAdminResult } from './seed';
