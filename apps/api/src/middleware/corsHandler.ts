/**
 * 개발용 CORS 미들웨어.
 * 프로덕션에서는 reverse proxy 가 동일 오리진을 보장하므로 본 미들웨어를
 * `mode === 'development'` 일 때만 등록한다.
 */

import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

export function createCorsMiddleware(allowOrigin: string | string[] = '*'): MiddlewareHandler {
  return cors({
    origin: allowOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type', 'x-api-key'],
    credentials: false,
    maxAge: 86_400,
  });
}
