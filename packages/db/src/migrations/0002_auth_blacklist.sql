-- =============================================================================
-- SPEC-AUTH-001 — auth_token_blacklist 마이그레이션
-- JWT 토큰 블랙리스트 테이블: 로그아웃 및 만료 토큰 추적
-- =============================================================================

PRAGMA foreign_keys = ON;

-- auth_token_blacklist ---------------------------------------------------------
-- REQ-AUTH-011: JTI 블랙리스트 — 로그아웃/토큰 무효화 시 기록
CREATE TABLE IF NOT EXISTS auth_token_blacklist (
  id         TEXT    PRIMARY KEY,
  jti        TEXT    NOT NULL,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  UNIQUE (jti)
);

-- jti 조회 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_auth_token_blacklist_jti ON auth_token_blacklist (jti);
-- 만료 정리용 인덱스 (REQ-AUTH-011 cleanup)
CREATE INDEX IF NOT EXISTS idx_auth_token_blacklist_expires_at ON auth_token_blacklist (expires_at);
