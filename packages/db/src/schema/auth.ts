/**
 * SPEC-AUTH-001 — 인증 관련 Drizzle 스키마.
 *
 * auth_token_blacklist: 무효화된 JWT JTI 를 추적한다.
 * - REQ-AUTH-011: 로그아웃 시 JTI 블랙리스트 등록
 * - REQ-AUTH-016: 리프레시 토큰 재사용 탐지
 */

import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from '../schema';

// ---------------------------------------------------------------------------
// auth_token_blacklist
// ---------------------------------------------------------------------------
export const authTokenBlacklist = sqliteTable(
  'auth_token_blacklist',
  {
    id: text('id').primaryKey(),
    /** JWT ID 클레임 (고유 식별자) */
    jti: text('jti').notNull(),
    /** 토큰 소유 사용자 ID (users.id 참조) */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 토큰 만료 시각 (Unix ms) — 정리 쿼리 기준 */
    expiresAt: integer('expires_at').notNull(),
    /** 블랙리스트 등록 시각 (Unix ms) */
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    jtiIdx: uniqueIndex('idx_auth_token_blacklist_jti').on(t.jti),
  }),
);

// ---------------------------------------------------------------------------
// 타입 추출
// ---------------------------------------------------------------------------
export type AuthTokenBlacklist = typeof authTokenBlacklist.$inferSelect;
export type NewAuthTokenBlacklist = typeof authTokenBlacklist.$inferInsert;
