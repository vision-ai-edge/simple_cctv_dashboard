/**
 * SPEC-BOX-001 — Box 등록 및 관리 라우트.
 *
 * 엔드포인트:
 * - POST   /api/boxes          — Box 등록 (헬스체크 포함)
 * - GET    /api/boxes          — Box 목록 조회
 * - GET    /api/boxes/:id      — 단일 Box 조회
 * - POST   /api/boxes/:id/refresh — 수동 JWT 갱신
 * - DELETE /api/boxes/:id      — Box 삭제
 *
 * 보안 원칙:
 *   - 모든 라우트 requireAuth 미들웨어 보호
 *   - 응답에 password/jwt/apiKey 평문 절대 미포함
 *   - Zod 스키마로 입력 검증
 */

import { BoxApiError } from '@cctv/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { createRequireAuth } from '../middleware/requireAuth';
import {
  BoxNotFoundError,
  BoxRegistrationError,
  type BoxServiceDeps,
  deleteBox,
  getBox,
  listBoxes,
  refreshTokens,
  registerBox,
} from '../services/boxService';

// ---------------------------------------------------------------------------
// 입력 스키마
// ---------------------------------------------------------------------------

/** Box 등록 요청 스키마 */
const RegisterBoxSchema = z.object({
  name: z.string().min(1).max(100),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().min(1),
  useApiKey: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// 에러 응답 헬퍼
// ---------------------------------------------------------------------------

/**
 * EdgeAI Box 에러 봉투 생성.
 * 응답 형식: { success: false, message: string, timestamp: number }
 */
function errorEnvelope(message: string) {
  return {
    success: false,
    message,
    timestamp: Date.now(),
  } as const;
}

// ---------------------------------------------------------------------------
// 라우트 팩토리 옵션
// ---------------------------------------------------------------------------

export interface CreateBoxRoutesOptions {
  /** boxService 의존성 주입 컨테이너 */
  deps: BoxServiceDeps;
  /**
   * JWT 시크릿 (requireAuth 생성에 사용).
   * 미제공 시 process.env.JWT_SECRET 로 폴백한다.
   */
  jwtSecret?: string;
}

// ---------------------------------------------------------------------------
// 라우트 팩토리
// ---------------------------------------------------------------------------

/**
 * Box 라우트 팩토리.
 *
 * 사용법:
 * ```ts
 * app.route('/api/boxes', createBoxRoutes({ deps }));
 * ```
 *
 * DI 패턴: 옵션 A — createBoxRoutes 에 deps 를 직접 전달.
 * 테스트 시 mock deps 를 주입하고, 프로덕션은 실제 deps 를 주입한다.
 * auth.ts 의 opts 패턴과 동일한 방식으로 일관성을 유지한다.
 */
export function createBoxRoutes(opts: CreateBoxRoutesOptions): Hono {
  const { deps } = opts;
  const { db } = deps;

  // requireAuth 미들웨어 생성 (DB 와 jwtSecret 필요)
  // jwtSecret: 명시적 주입 우선, 없으면 환경 변수 폴백
  const jwtSecret = opts.jwtSecret ?? process.env.JWT_SECRET ?? '';
  const requireAuth = createRequireAuth({ db, jwtSecret });

  const router = new Hono();

  // 모든 Box 라우트에 requireAuth 적용 (REQ-MOD-보안)
  router.use('*', requireAuth);

  // -------------------------------------------------------------------------
  // POST / — Box 등록
  // -------------------------------------------------------------------------
  router.post('/', async (c) => {
    // 입력 유효성 검사
    let input: z.infer<typeof RegisterBoxSchema>;
    try {
      const raw = await c.req.json();
      const parsed = RegisterBoxSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(errorEnvelope('입력 값이 유효하지 않습니다'), 400);
      }
      input = parsed.data;
    } catch {
      return c.json(errorEnvelope('요청 본문을 파싱할 수 없습니다'), 400);
    }

    try {
      const box = await registerBox(input, deps);
      return c.json(box, 201);
    } catch (err) {
      // EC-BOX-003: 중복 base_url → 409 Conflict
      if (err instanceof BoxRegistrationError) {
        return c.json(
          { success: false, error: err.message, code: err.code, timestamp: Date.now() },
          err.statusCode as 400 | 409,
        );
      }
      if (err instanceof BoxApiError) {
        if (err.statusCode === 401) {
          return c.json(errorEnvelope('Box 인증 실패: 자격증명을 확인하세요'), 400);
        }
        return c.json(errorEnvelope(`Box 연결 실패: ${err.message}`), 502);
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // GET / — Box 목록 조회
  // -------------------------------------------------------------------------
  router.get('/', async (c) => {
    const boxes = await listBoxes(deps);
    return c.json(boxes, 200);
  });

  // -------------------------------------------------------------------------
  // GET /:id — 단일 Box 조회
  // -------------------------------------------------------------------------
  router.get('/:id', async (c) => {
    const { id } = c.req.param();

    try {
      const box = await getBox(id, deps);
      return c.json(box, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${id}`), 404);
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // POST /:id/refresh — 수동 JWT 갱신
  // -------------------------------------------------------------------------
  router.post('/:id/refresh', async (c) => {
    const { id } = c.req.param();

    try {
      const box = await refreshTokens(id, deps);
      return c.json(box, 200);
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${id}`), 404);
      }
      if (err instanceof BoxApiError) {
        return c.json(errorEnvelope(`Box 재인증 실패: ${err.message}`), 502);
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /:id — Box 삭제
  // -------------------------------------------------------------------------
  router.delete('/:id', async (c) => {
    const { id } = c.req.param();

    try {
      await deleteBox(id, deps);
      return new Response(null, { status: 204 });
    } catch (err) {
      if (err instanceof BoxNotFoundError) {
        return c.json(errorEnvelope(`Box 를 찾을 수 없습니다: ${id}`), 404);
      }
      throw err;
    }
  });

  return router;
}
