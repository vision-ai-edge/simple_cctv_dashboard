-- =============================================================================
-- SPEC-BOX-001 EC-BOX-003: boxes.base_url UNIQUE 제약 추가
--
-- 목적: 동일한 host:port 조합의 Box 중복 등록 방지.
--       동일 base_url 이 존재하면 HTTP 409 Conflict 를 반환한다.
--
-- REQ-MOD-2-004: base_url 이 이미 존재하는 Box 와 동일한 경우
--               중복 등록 불허 (UNIQUE 제약 위반 → HTTP 409 Conflict)
--
-- 주의:
--   - SQLite 는 ALTER TABLE ... ADD UNIQUE 를 지원하지 않으므로
--     CREATE UNIQUE INDEX 를 사용한다.
--   - IF NOT EXISTS 로 멱등성 보장 (마이그레이션 재실행 안전)
-- =============================================================================

-- boxes.base_url UNIQUE 인덱스 추가
CREATE UNIQUE INDEX IF NOT EXISTS idx_boxes_base_url_unique ON boxes(base_url);
