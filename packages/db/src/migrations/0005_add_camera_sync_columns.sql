-- =============================================================================
-- SPEC-BOX-CHANNELS-001: cameras 테이블에 채널 동기화 컬럼 추가
-- TAG: BOX-CHANNELS-001
--
-- 목적:
--   - last_synced_at: 마지막 채널 동기화 성공 시각 (Unix ms, nullable)
--   - sync_error: 마지막 동기화 실패 메시지 (nullable, 성공 시 NULL로 초기화)
--
-- 규칙:
--   - 기존 레코드는 두 컬럼 모두 NULL로 유지됨 (데이터 손실 없음)
--   - NOT NULL / DROP / ALTER 데이터 손실 금지
--   - (box_id, channel_id) 복합 유니크 인덱스 추가 — 채널 ID 충돌 방지
--   - IF NOT EXISTS 로 멱등성 보장 (마이그레이션 재실행 안전)
-- =============================================================================

-- 1. last_synced_at 컬럼 추가 (nullable, 기본값 NULL)
ALTER TABLE cameras ADD COLUMN last_synced_at INTEGER;

-- 2. sync_error 컬럼 추가 (nullable, 기본값 NULL)
ALTER TABLE cameras ADD COLUMN sync_error TEXT;

-- 3. (box_id, channel_id) 복합 유니크 인덱스 추가
--    동일 Box 내 채널 ID 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS cameras_box_channel_unique
  ON cameras(box_id, channel_id);
