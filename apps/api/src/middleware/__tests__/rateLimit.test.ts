/**
 * SPEC-AUTH-001 — 인메모리 레이트 리미터 테스트.
 *
 * RED 단계: rateLimit.ts 가 없으므로 모두 실패한다.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createRateLimit } from '../rateLimit';

describe('createRateLimit', () => {
  test('maxRequests 이내 요청은 통과한다', async () => {
    const app = new Hono();
    app.use('*', createRateLimit({ windowMs: 60_000, maxRequests: 5 }));
    app.get('/test', (c) => c.json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': '192.168.1.1' },
      });
      expect(res.status).toBe(200);
    }
  });

  test('6번째 요청은 429 와 Retry-After 헤더를 반환한다', async () => {
    const app = new Hono();
    app.use('*', createRateLimit({ windowMs: 60_000, maxRequests: 5 }));
    app.get('/test', (c) => c.json({ ok: true }));

    // 5번 소진
    for (let i = 0; i < 5; i++) {
      await app.request('/test', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      });
    }

    // 6번째 요청
    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });

    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: not.toBeNull() 로 검증 완료
    expect(Number.parseInt(retryAfter!)).toBeGreaterThan(0);

    const body = (await res.json()) as {
      success: boolean;
      error: string;
      code: string;
    };
    expect(body.success).toBe(false);
    expect(body.code).toBe('RATE_LIMITED');
  });

  test('windowMs 경과 후 카운터가 초기화된다 (주입된 now() 사용)', async () => {
    let mockNow = Date.now();
    const app = new Hono();
    // now() 주입으로 시간 제어
    app.use('*', createRateLimit({ windowMs: 60_000, maxRequests: 2, now: () => mockNow }));
    app.get('/test', (c) => c.json({ ok: true }));

    const ip = '172.16.0.1';

    // 2번 소진
    for (let i = 0; i < 2; i++) {
      await app.request('/test', { headers: { 'x-forwarded-for': ip } });
    }

    // 3번째: 제한 초과
    const blockedRes = await app.request('/test', {
      headers: { 'x-forwarded-for': ip },
    });
    expect(blockedRes.status).toBe(429);

    // 윈도우 경과 시뮬레이션
    mockNow += 61_000;

    // 리셋 후 통과
    const afterResetRes = await app.request('/test', {
      headers: { 'x-forwarded-for': ip },
    });
    expect(afterResetRes.status).toBe(200);
  });

  test('다른 IP 는 독립적으로 추적된다', async () => {
    const app = new Hono();
    app.use('*', createRateLimit({ windowMs: 60_000, maxRequests: 1 }));
    app.get('/test', (c) => c.json({ ok: true }));

    // IP A: 1번 소진
    await app.request('/test', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const blockedA = await app.request('/test', {
      headers: { 'x-forwarded-for': '1.1.1.1' },
    });
    expect(blockedA.status).toBe(429);

    // IP B: 아직 통과
    const passB = await app.request('/test', {
      headers: { 'x-forwarded-for': '2.2.2.2' },
    });
    expect(passB.status).toBe(200);
  });

  test('x-forwarded-for 가 없으면 "unknown" IP 로 처리한다', async () => {
    const app = new Hono();
    app.use('*', createRateLimit({ windowMs: 60_000, maxRequests: 1 }));
    app.get('/test', (c) => c.json({ ok: true }));

    // IP 헤더 없이 첫 번째 요청 통과
    const first = await app.request('/test');
    expect(first.status).toBe(200);

    // 두 번째 요청 차단
    const second = await app.request('/test');
    expect(second.status).toBe(429);
  });
});
