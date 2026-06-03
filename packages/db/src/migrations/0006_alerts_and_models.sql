-- =============================================================================
-- SPEC-ALERTS-001 M1-3: 알림·구독·탐지 커서 테이블 추가
-- TAG: ALERTS-001
--
-- 신규 테이블:
--   webpush_subscriptions — 웹 푸시 구독 (user 별 endpoint)
--   alert_destinations    — 알림 수신처 설정 (toast / webpush / telegram)
--   alerts                — AI 탐지 이벤트 기록
--   detection_cursor      — 박스·채널별 마지막 탐지 조회 커서
--
-- 규칙:
--   - PK: TEXT (ULID 또는 uuid)
--   - 타임스탬프: Unix epoch milliseconds (INTEGER)
--   - 불리언: INTEGER (0/1)
--   - 외래키: ON DELETE CASCADE
--   - IF NOT EXISTS 로 멱등성 보장
-- =============================================================================

-- 1. 웹 푸시 구독 테이블
CREATE TABLE IF NOT EXISTS webpush_subscriptions (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT    NOT NULL,
  p256dh      TEXT    NOT NULL,
  auth        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  UNIQUE(user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS webpush_subscriptions_user_idx
  ON webpush_subscriptions(user_id);

-- 2. 알림 수신처 설정 테이블
CREATE TABLE IF NOT EXISTS alert_destinations (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT    NOT NULL CHECK (channel IN ('toast','webpush','telegram')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  UNIQUE(user_id, channel)
);

-- 3. 탐지 알림(탐지 이벤트) 기록 테이블
--    주의: 기존 `alerts` 테이블(0001_init.sql, camera_id 기반)과 구분하여
--    `detection_alerts` 로 명명. box_id + channel_id 기반 신규 설계.
CREATE TABLE IF NOT EXISTS detection_alerts (
  id            TEXT    PRIMARY KEY,
  box_id        TEXT    NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  channel_id    TEXT    NOT NULL,
  type          TEXT    NOT NULL,
  payload_json  TEXT    NOT NULL,
  fired_at      INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new','delivered')),
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS detection_alerts_box_channel_fired_idx
  ON detection_alerts(box_id, channel_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS detection_alerts_status_idx
  ON detection_alerts(status);

-- 4. 탐지 조회 커서 테이블
CREATE TABLE IF NOT EXISTS detection_cursor (
  box_id              TEXT    NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  channel_id          TEXT    NOT NULL,
  last_seen_timestamp INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  PRIMARY KEY(box_id, channel_id)
);
