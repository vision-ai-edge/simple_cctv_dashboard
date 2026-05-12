/**
 * Hono 앱 팩토리.
 * 부팅 로직(`src/index.ts`)과 분리하여 테스트 가능성을 확보한다.
 */

import type { Db } from '@cctv/db';
import type { BoxClient } from '@cctv/shared';
import { Hono } from 'hono';
import type { Logger } from './logger';
import { createCorsMiddleware } from './middleware/corsHandler';
import { createAuthRoutes } from './routes/auth';
import { createBoxRoutes } from './routes/boxes';
import { healthRoute } from './routes/health';

export interface CreateAppOptions {
  db: Db;
  logger: Logger;
  mode: string;
  // SPEC-AUTH-001: JWT 시크릿 주입
  jwtSecret?: string;
  // SPEC-BOX-001: Box 볼트 키 주입
  boxVaultKey?: string;
  // SPEC-BOX-001: BoxClient 팩토리 (테스트 mock 용이)
  createBoxClient?: (baseUrl: string, token?: string) => BoxClient;
}

export function createApp(opts: CreateAppOptions): Hono {
  const app = new Hono();

  // CORS — 개발 환경 한정. 프로덕션은 reverse proxy 의 단일 오리진 가정.
  if (opts.mode !== 'production') {
    app.use('*', createCorsMiddleware());
  }

  // 라우트 등록 — 모든 API 라우트는 /api prefix 사용 (web 의 Vite proxy 가 /api 를 그대로 전달)
  app.route('/api', healthRoute());

  // SPEC-AUTH-001: 인증 라우트 마운트 (jwtSecret 이 제공된 경우)
  if (opts.jwtSecret) {
    app.route(
      '/api/auth',
      createAuthRoutes({ db: opts.db, jwtSecret: opts.jwtSecret, nodeEnv: opts.mode }),
    );

    // SPEC-BOX-001: Box 관리 라우트 마운트 (jwtSecret + boxVaultKey 가 제공된 경우)
    if (opts.boxVaultKey && opts.createBoxClient) {
      app.route(
        '/api/boxes',
        createBoxRoutes({
          jwtSecret: opts.jwtSecret,
          deps: {
            db: opts.db,
            vaultKey: opts.boxVaultKey,
            createBoxClient: opts.createBoxClient,
          },
        }),
      );
    }
  }

  // 글로벌 404
  app.notFound((c) => c.json({ success: false, message: 'not found', timestamp: Date.now() }, 404));

  // 글로벌 에러 핸들러
  app.onError((err, c) => {
    opts.logger.error('unhandled error', { error: err.message, stack: err.stack });
    return c.json({ success: false, message: err.message, timestamp: Date.now() }, 500);
  });

  return app;
}
