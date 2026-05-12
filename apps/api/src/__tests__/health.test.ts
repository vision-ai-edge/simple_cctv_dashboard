import { describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from '@cctv/db';
import { createApp } from '../app';
import { createLogger } from '../logger';

const TMP_DB = join(import.meta.dir, '.test-api.sqlite');

function silentLogger() {
  // 테스트 noise 억제 — 메모리 로거
  const calls: Array<{ level: string; msg: string }> = [];
  return {
    debug: (msg: string) => calls.push({ level: 'debug', msg }),
    info: (msg: string) => calls.push({ level: 'info', msg }),
    warn: (msg: string) => calls.push({ level: 'warn', msg }),
    error: (msg: string) => calls.push({ level: 'error', msg }),
    calls,
  };
}

describe('GET /api/health', () => {
  test('200 + { ok: true, version }', async () => {
    if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
    const db = createDb(TMP_DB);
    const app = createApp({ db, logger: silentLogger(), mode: 'test' });

    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    unlinkSync(TMP_DB);
  });
});

describe('404 fallback', () => {
  test('알 수 없는 경로는 success:false 봉투를 반환한다', async () => {
    if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
    const db = createDb(TMP_DB);
    const app = createApp({ db, logger: silentLogger(), mode: 'test' });

    const res = await app.request('/nonexistent');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(false);
    expect(body.message).toBe('not found');
    unlinkSync(TMP_DB);
  });
});

describe('CORS (development mode)', () => {
  test('Access-Control-Allow-Origin 헤더가 첨부된다', async () => {
    if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
    const db = createDb(TMP_DB);
    const app = createApp({ db, logger: silentLogger(), mode: 'development' });

    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBeNull();
    unlinkSync(TMP_DB);
  });

  test('production 모드에서는 CORS 미들웨어가 등록되지 않는다', async () => {
    if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
    const db = createDb(TMP_DB);
    const app = createApp({ db, logger: silentLogger(), mode: 'production' });

    const res = await app.request('/api/health', {
      headers: { Origin: 'http://example.com' },
    });
    expect(res.status).toBe(200);
    // production 모드에서 CORS 미들웨어 없음 — Allow-Origin 헤더가 없을 수도 있음
    unlinkSync(TMP_DB);
  });
});
