/**
 * GET /health — 헬스 체크.
 * 응답: { ok: true, version: <apps/api package.json version> }
 */

import { Hono } from 'hono';
import pkg from '../../package.json' with { type: 'json' };

export function healthRoute(): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true, version: pkg.version }));
  return app;
}
