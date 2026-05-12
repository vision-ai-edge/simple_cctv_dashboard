import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 설정 — Drizzle Studio / schema introspection 용.
 * 마이그레이션 생성은 본 프로젝트에서 수동 SQL 로 관리한다 (drizzle-kit generate 미사용).
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './src/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? './data/cctv.sqlite',
  },
});
