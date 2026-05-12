-- =============================================================================
-- SPEC-CORE-001 — 초기 스키마 마이그레이션
-- 트랜잭션 내에서 실행되어 부분 적용을 방지합니다.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- users -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,
  username      TEXT    NOT NULL,
  email         TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- boxes -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boxes (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  base_url        TEXT    NOT NULL,
  username        TEXT    NOT NULL,
  password_enc    BLOB    NOT NULL,
  jwt_cached      TEXT,
  jwt_obtained_at INTEGER,
  api_key_cached  TEXT,
  last_sync_at    INTEGER,
  status          TEXT    NOT NULL DEFAULT 'inactive'
                    CHECK (status IN ('active','inactive','error')),
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS boxes_status_idx ON boxes (status);

-- cameras ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cameras (
  id          TEXT    PRIMARY KEY,
  box_id      TEXT    NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  channel_id  TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  latitude    REAL,
  longitude   REAL,
  resolution  TEXT,
  stream_url  TEXT,
  status      TEXT    NOT NULL DEFAULT 'offline'
                CHECK (status IN ('online','offline','error')),
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS cameras_box_id_idx ON cameras (box_id);
CREATE INDEX IF NOT EXISTS cameras_status_idx ON cameras (status);

-- camera_groups ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS camera_groups (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  box_id     TEXT    NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- alerts ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT    PRIMARY KEY,
  camera_id  TEXT    NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  confidence REAL,
  timestamp  INTEGER NOT NULL,
  image_url  TEXT,
  processed  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS alerts_camera_id_idx ON alerts (camera_id);
CREATE INDEX IF NOT EXISTS alerts_processed_idx ON alerts (processed);

-- alert_rules -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_rules (
  id               TEXT    PRIMARY KEY,
  camera_id        TEXT    NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  alert_type       TEXT    NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  notify_toast     INTEGER NOT NULL DEFAULT 1,
  notify_web_push  INTEGER NOT NULL DEFAULT 0,
  notify_telegram  INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS alert_rules_camera_id_idx ON alert_rules (camera_id);

-- web_push_subs ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_push_subs (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  p256dh     TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- telegram_subs ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_subs (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
