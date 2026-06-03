/**
 * CCTV Dashboard 영속 스키마 (Drizzle ORM, SQLite).
 *
 * 12개 테이블:
 *   users / boxes / cameras / camera_groups /
 *   alerts / alert_rules / web_push_subs / telegram_subs /
 *   webpush_subscriptions / alert_destinations /
 *   detection_alerts / detection_cursor
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
    // 하위 호환용 평문 캐시 컬럼 (신규 코드에서는 enc 컬럼 사용)
    jwtCached: text('jwt_cached'),
    jwtObtainedAt: integer('jwt_obtained_at'),
    apiKeyCached: text('api_key_cached'),
    /** SPEC-BOX-001 REQ-MOD-1: AES-GCM 암호화된 JWT (12B IV + 암호문 + 16B tag) */
    jwtCachedEnc: blob('jwt_cached_enc'),
    /** SPEC-BOX-001 REQ-MOD-1: AES-GCM 암호화된 API Key (동일 형식) */
    apiKeyCachedEnc: blob('api_key_cached_enc'),
    lastSyncAt: integer('last_sync_at'),
    status: text('status', { enum: boxStatusValues }).notNull().default('inactive'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => ({
    /** SPEC-BOX-001 EC-BOX-003: base_url UNIQUE — 동일 host:port 중복 등록 방지 */
    baseUrlIdx: uniqueIndex('idx_boxes_base_url_unique').on(t.baseUrl),
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
    /** 주변에서 감지된 BLE 비컨 신호 개수 */
    bleBeaconCount: integer('ble_beacon_count').notNull().default(0),
    resolution: text('resolution'),
    streamUrl: text('stream_url'),
    status: text('status', { enum: cameraStatusValues }).notNull().default('offline'),
    /** SPEC-BOX-CHANNELS-001: 마지막 채널 동기화 성공 시각 (Unix ms, nullable) */
    lastSyncedAt: integer('last_synced_at'),
    /** SPEC-BOX-CHANNELS-001: 마지막 동기화 실패 메시지 (nullable, 성공 시 NULL) */
    syncError: text('sync_error'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => ({
    boxIdIdx: index('cameras_box_id_idx').on(t.boxId),
    statusIdx: index('cameras_status_idx').on(t.status),
    /** SPEC-BOX-CHANNELS-001: (box_id, channel_id) 복합 유니크 인덱스 */
    boxChannelUniq: uniqueIndex('cameras_box_channel_unique').on(t.boxId, t.channelId),
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
// webpush_subscriptions — SPEC-ALERTS-001: 웹 푸시 구독 (user 별 endpoint)
// ---------------------------------------------------------------------------
export const webpushSubscriptions = sqliteTable(
  'webpush_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => ({
    userIdx: index('webpush_subscriptions_user_idx').on(t.userId),
    userEndpointUniq: uniqueIndex('webpush_subscriptions_user_endpoint_unique').on(
      t.userId,
      t.endpoint,
    ),
  }),
);

// ---------------------------------------------------------------------------
// alert_destinations — SPEC-ALERTS-001: 알림 수신처 설정
// ---------------------------------------------------------------------------
export const alertChannelValues = ['toast', 'webpush', 'telegram'] as const;
export type AlertChannel = (typeof alertChannelValues)[number];

export const alertDestinations = sqliteTable(
  'alert_destinations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 알림 채널 ('toast' | 'webpush' | 'telegram') — CHECK 제약은 마이그레이션에서 추가 */
    channel: text('channel', { enum: alertChannelValues }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** 채널별 추가 설정 (예: telegram chat_id) — JSON 문자열 */
    configJson: text('config_json'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (t) => ({
    userChannelUniq: uniqueIndex('alert_destinations_user_channel_unique').on(t.userId, t.channel),
  }),
);

// ---------------------------------------------------------------------------
// detection_alerts — SPEC-ALERTS-001: AI 탐지 이벤트 기록
// (기존 `alerts` 테이블은 camera 기반 구형 스키마 유지 — 0001_init.sql)
// ---------------------------------------------------------------------------
export const detectionAlertStatusValues = ['new', 'delivered'] as const;
export type DetectionAlertStatus = (typeof detectionAlertStatusValues)[number];

export const detectionAlerts = sqliteTable(
  'detection_alerts',
  {
    id: text('id').primaryKey(),
    boxId: text('box_id')
      .notNull()
      .references(() => boxes.id, { onDelete: 'cascade' }),
    /** 박스 내부 채널 ID (cameras 테이블 FK 없음 — 채널이 없는 경우 허용) */
    channelId: text('channel_id').notNull(),
    /** 탐지 이벤트 유형 (intrusion, fall 등 — 유연한 문자열) */
    type: text('type').notNull(),
    /** 박스에서 수신한 원본 탐지 이벤트 JSON */
    payloadJson: text('payload_json').notNull(),
    /** 박스 측 탐지 발생 시각 (Unix ms) */
    firedAt: integer('fired_at').notNull(),
    /** 처리 상태 ('new' | 'delivered') — CHECK 제약은 마이그레이션에서 추가 */
    status: text('status', { enum: detectionAlertStatusValues }).notNull().default('new'),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (t) => ({
    boxChannelFiredIdx: index('detection_alerts_box_channel_fired_idx').on(
      t.boxId,
      t.channelId,
      t.firedAt,
    ),
    statusIdx: index('detection_alerts_status_idx').on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// detection_cursor — SPEC-ALERTS-001: 박스·채널별 탐지 조회 커서
// ---------------------------------------------------------------------------
export const detectionCursor = sqliteTable('detection_cursor', {
  boxId: text('box_id')
    .notNull()
    .references(() => boxes.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  /** 마지막으로 처리한 탐지 이벤트의 타임스탬프 (Unix ms) */
  lastSeenTimestamp: integer('last_seen_timestamp').notNull(),
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
  webpushSubscriptions: many(webpushSubscriptions),
  alertDestinations: many(alertDestinations),
}));

export const detectionAlertsRelations = relations(detectionAlerts, ({ one }) => ({
  box: one(boxes, { fields: [detectionAlerts.boxId], references: [boxes.id] }),
}));

export const webpushSubscriptionsRelations = relations(webpushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [webpushSubscriptions.userId], references: [users.id] }),
}));

export const alertDestinationsRelations = relations(alertDestinations, ({ one }) => ({
  user: one(users, { fields: [alertDestinations.userId], references: [users.id] }),
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

// SPEC-ALERTS-001 신규 타입
export type WebpushSubscription = typeof webpushSubscriptions.$inferSelect;
export type NewWebpushSubscription = typeof webpushSubscriptions.$inferInsert;
export type AlertDestination = typeof alertDestinations.$inferSelect;
export type NewAlertDestination = typeof alertDestinations.$inferInsert;
export type DetectionAlert = typeof detectionAlerts.$inferSelect;
export type NewDetectionAlert = typeof detectionAlerts.$inferInsert;
export type DetectionCursor = typeof detectionCursor.$inferSelect;
export type NewDetectionCursor = typeof detectionCursor.$inferInsert;
