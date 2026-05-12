-- =============================================================================
-- SPEC-BOX-001 T2 — boxes 테이블 자격증명 볼트 컬럼 추가
--
-- 목적: EdgeAI Box 에서 발급받은 JWT / API Key를 AES-GCM 으로 암호화하여 영구 저장.
-- 암호화 형식: 12B IV || 암호문 || 16B GCM tag (BOX_VAULT_KEY 환경변수 사용)
--
-- 영향 컬럼:
--   - jwt_cached_enc    BLOB NULL — AES-GCM 암호화된 JWT
--   - api_key_cached_enc BLOB NULL — AES-GCM 암호화된 API Key
--
-- REQ-MOD-1: 자격증명 볼트 (영구 저장 매체 필드) DB 계층 구현
--
-- 주의: SQLite 는 DROP COLUMN 을 지원하지 않으므로 기존 컬럼은 보존.
--       jwt_cached (TEXT), api_key_cached (TEXT) 는 하위 호환용으로 유지.
-- =============================================================================

-- jwt_cached_enc: AES-GCM 암호화된 JWT (12B IV + 암호문 + 16B tag)
ALTER TABLE boxes ADD COLUMN jwt_cached_enc BLOB;

-- api_key_cached_enc: AES-GCM 암호화된 API Key (동일 형식)
ALTER TABLE boxes ADD COLUMN api_key_cached_enc BLOB;
