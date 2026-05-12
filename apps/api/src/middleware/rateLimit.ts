/**
 * SPEC-AUTH-001 — 인메모리 레이트 리미터.
 *
 * IP 별로 요청 횟수를 추적하고, windowMs 내 maxRequests 초과 시 429 반환.
 * 프로덕션에서는 Redis 기반 분산 레이트 리미터로 교체할 것을 권장한다.
 */

import type { MiddlewareHandler } from 'hono';

interface BucketEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** 윈도우 기간 (ms) */
  windowMs: number;
  /** 윈도우 내 최대 요청 수 */
  maxRequests: number;
  /** 현재 시각 함수 (테스트 시 주입 가능) */
  now?: () => number;
}

/**
 * 인메모리 레이트 리미터 미들웨어 팩토리.
 *
 * @param opts - 레이트 리미팅 옵션
 * @returns Hono 미들웨어 핸들러
 */
export function createRateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const { windowMs, maxRequests } = opts;
  const getNow = opts.now ?? (() => Date.now());

  // IP 별 버킷 맵
  const buckets = new Map<string, BucketEntry>();

  return async (c, next) => {
    // IP 추출: x-forwarded-for 첫 번째 값 또는 "unknown"
    const forwardedFor = c.req.header('x-forwarded-for');
    const ip = forwardedFor ? (forwardedFor.split(',')[0] ?? 'unknown').trim() : 'unknown';

    const now = getNow();

    // 버킷 조회 또는 생성
    let bucket = buckets.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      // 새 윈도우 시작
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }

    // bucket 은 위에서 반드시 할당됨
    const currentBucket = bucket;
    currentBucket.count += 1;

    if (currentBucket.count > maxRequests) {
      // Retry-After: 초 단위 (남은 윈도우 시간)
      const retryAfterSeconds = Math.ceil((currentBucket.resetAt - now) / 1000);

      c.res = c.json(
        {
          success: false,
          error: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.',
          code: 'RATE_LIMITED',
        },
        429,
        {
          'Retry-After': String(retryAfterSeconds),
        },
      );
      return;
    }

    await next();
  };
}
