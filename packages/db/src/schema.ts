/**
 * CCTV Dashboard 영속 스키마 (Drizzle ORM, SQLite).
 *
 * 8개 테이블:
 *   users / boxes / cameras / camera_groups /
 *   alerts / alert_rules / web_push_subs / telegram_subs
 *
 * 규약:
 *  - PK: ULID 문자열 (`ulid` 패키지로 생성)
 *  - 타임스탬프: Unix epoch milliseconds (INTEGER)
 *  - 열거값: TEXT + Drizzle `enum` 옵션 (CHECK 제약은 마이그레이션에서 추가)
 *  - 외래키: CASCADE on delete
 */

import { relations, sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Unix ms (now) 기본값 — sqlite 의 `strftime('%s','now') * 1000` 사용 */
const nowMs = sql<number>`(strftime('%s','now') * 1000)`;

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => ({
    usernameIdx: uniqueIndex('users_username_idx').on(t.username),
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
  }),
);

// ---------------------------------------------------------------------------
// boxes — EdgeAI Box 등록 정보
// ---------------------------------------------------------------------------
export const boxStatusValues = ['active', 'inactive', 'error'] as const;
export type BoxStatus = (typeof boxStatusValues)[number];

export const boxes = sqliteTable(
  'boxes',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    username: text('username').notNull(),
    /** AES-GCM 암호화된 비밀번호 (master key: BOX_VAULT_KEY) */
    passwordEnc: blob('password_enc').notNull(),
    jwtCached: text('jwt_cached'),
    jwtObtainedAt: integer('jwt_obtained_at'),
    apiKeyCached: text('api_key_cached'),
    lastSyncAt: integer('last_sync_at'),
    status: text('status', { enum: boxStatusValues }).notNull().default('inactive'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => ({
    statusIdx: index('boxes_status_idx').on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// cameras
// ---------------------------------------------------------------------------
export const cameraStatusValues = ['online', 'offline', 'error'] as const;
export type CameraStatus = (typeof cameraStatusValues)[number];

export const cameras = sqliteTable(
  'cameras',
  {
    id: text('id').primaryKey(),
    boxId: text('box_id')
      .notNull()
      .references(() => boxes.id, { onDelete: 'cascade' }),
    /** EdgeAI Box 내부 채널 ID — `boxes.id + channelId` 로 채널을 식별 */
    channelId: text('channel_id').notNull(),
    name: text('name').notNull(),
    latitude: real('latitude'),
    longitude: real('longitude'),
    resolution: text('resolution'),
    streamUrl: text('stream_url'),
    status: text('status', { enum: cameraStatusValues }).notNull().default('offline'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => ({
    boxIdIdx: index('cameras_box_id_idx').on(t.boxId),
    statusIdx: index('cameras_status_idx').on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// camera_groups
// ---------------------------------------------------------------------------
export const cameraGroups = sqliteTable('camera_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  boxId: text('box_id')
    .notNull()
    .references(() => boxes.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull().default(nowMs),
  updatedAt: integer('updated_at').notNull().default(nowMs),
});

// ---------------------------------------------------------------------------
// alerts
// ---------------------------------------------------------------------------
export const alerts = sqliteTable(
  'alerts',
  {
    id: text('id').primaryKey(),
    cameraId: text('camera_id')
      .notNull()
      .references(() => cameras.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    confidence: real('confidence'),
    timestamp: integer('timestamp').notNull(),
    imageUrl: text('image_url'),
    processed: integer('processed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => ({
    cameraIdIdx: index('alerts_camera_id_idx').on(t.cameraId),
    processedIdx: index('alerts_processed_idx').on(t.processed),
  }),
);

// ---------------------------------------------------------------------------
// alert_rules
// ---------------------------------------------------------------------------
export const alertRules = sqliteTable(
  'alert_rules',
  {
    id: text('id').primaryKey(),
    cameraId: text('camera_id')
      .notNull()
      .references(() => cameras.id, { onDelete: 'cascade' }),
    alertType: text('alert_type').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    notifyToast: integer('notify_toast', { mode: 'boolean' }).notNull().default(true),
    notifyWebPush: integer('notify_web_push', { mode: 'boolean' }).notNull().default(false),
    notifyTelegram: integer('notify_telegram', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => ({
    cameraIdIdx: index('alert_rules_camera_id_idx').on(t.cameraId),
  }),
);

// ---------------------------------------------------------------------------
// web_push_subs
// ---------------------------------------------------------------------------
export const webPushSubs = sqliteTable('web_push_subs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  /** RFC 8291 P256 키 (현재는 평문, SPEC-ALERT 에서 암호화 예정) */
  auth: text('auth').notNull(),
  p256dh: text('p256dh').notNull(),
  createdAt: integer('created_at').notNull().default(nowMs),
  updatedAt: integer('updated_at').notNull().default(nowMs),
});

// ---------------------------------------------------------------------------
// telegram_subs
// ---------------------------------------------------------------------------
export const telegramSubs = sqliteTable('telegram_subs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull(),
  createdAt: integer('created_at').notNull().default(nowMs),
  updatedAt: integer('updated_at').notNull().default(nowMs),
});

// ---------------------------------------------------------------------------
// 관계 정의 (선택적 — Drizzle relational query 용)
// ---------------------------------------------------------------------------
export const boxesRelations = relations(boxes, ({ many }) => ({
  cameras: many(cameras),
  cameraGroups: many(cameraGroups),
}));

export const camerasRelations = relations(cameras, ({ one, many }) => ({
  box: one(boxes, { fields: [cameras.boxId], references: [boxes.id] }),
  alerts: many(alerts),
  alertRules: many(alertRules),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  camera: one(cameras, { fields: [alerts.cameraId], references: [cameras.id] }),
}));

export const alertRulesRelations = relations(alertRules, ({ one }) => ({
  camera: one(cameras, { fields: [alertRules.cameraId], references: [cameras.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  webPushSubs: many(webPushSubs),
  telegramSubs: many(telegramSubs),
}));

// ---------------------------------------------------------------------------
// 타입 추출 (외부 사용용)
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Box = typeof boxes.$inferSelect;
export type NewBox = typeof boxes.$inferInsert;
export type Camera = typeof cameras.$inferSelect;
export type NewCamera = typeof cameras.$inferInsert;
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
