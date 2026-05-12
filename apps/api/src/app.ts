/**
 * Hono 앱 팩토리.
 * 부팅 로직(`src/index.ts`)과 분리하여 테스트 가능성을 확보한다.
 */

import type { Db } from '@cctv/db';
import { Hono } from 'hono';
import type { Logger } from './logger';
import { createCorsMiddleware } from './middleware/corsHandler';
import { healthRoute } from './routes/health';

export interface CreateAppOptions {
  db: Db;
  logger: Logger;
  mode: string;
}

export function createApp(opts: CreateAppOptions): Hono {
  const app = new Hono();

  // CORS — 개발 환경 한정. 프로덕션은 reverse proxy 의 단일 오리진 가정.
  if (opts.mode !== 'production') {
    app.use('*', createCorsMiddleware());
  }

  // 라우트 등록
  app.route('/', healthRoute());

  // 글로벌 404
  app.notFound((c) => c.json({ success: false, message: 'not found', timestamp: Date.now() }, 404));

  // 글로벌 에러 핸들러
  app.onError((err, c) => {
    opts.logger.error('unhandled error', { error: err.message, stack: err.stack });
    return c.json({ success: false, message: err.message, timestamp: Date.now() }, 500);
  });

  return app;
}
