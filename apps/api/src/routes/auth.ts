/**
 * SPEC-AUTH-001 — 인증 API 라우트.
 *
 * 엔드포인트:
 * - POST /login   — 로그인 (쿠키 발급)
 * - POST /logout  — 로그아웃 (쿠키 무효화, JTI 블랙리스트)
 * - GET  /me      — 현재 사용자 정보
 * - POST /refresh — 액세스 토큰 갱신 (리프레시 토큰 로테이션)
 *
 * 응답 형식 (SPEC-AUTH-001 정의):
 *   성공: { success: true, ... }
 *   실패: { success: false, error: string, code: string }
 */

import type { Db } from '@cctv/db';
import { parseTokenClaims, signAccessToken, signRefreshToken, verifyToken } from '@cctv/shared';
import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { ulid } from 'ulid';
import { z } from 'zod';
import { createRateLimit } from '../middleware/rateLimit';
import { createRequireAuth } from '../middleware/requireAuth';

// ---------------------------------------------------------------------------
// 입력 스키마
// ---------------------------------------------------------------------------

/** 로그인 요청 스키마 */
const LoginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

// ---------------------------------------------------------------------------
// 쿠키 옵션 헬퍼
// ---------------------------------------------------------------------------

/**
 * 쿠키 공통 옵션 생성.
 * 프로덕션 환경에서만 Secure 플래그를 활성화한다.
 */
function buildCookieOptions(maxAgeSeconds: number, nodeEnv: string) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
    secure: nodeEnv === 'production',
  };
}

// ---------------------------------------------------------------------------
// 더미 해시 — 타이밍 공격 방어 (REQ-AUTH-014)
// ---------------------------------------------------------------------------
// bcrypt.compare 를 항상 실행해 응답 시간을 균일하게 유지한다.
const DUMMY_HASH = '$2b$04$dummyhashforsafetytimingdontuseinprod0000000000000000000';

// ---------------------------------------------------------------------------
// 라우트 팩토리
// ---------------------------------------------------------------------------

export interface CreateAuthRoutesOptions {
  db: Db;
  jwtSecret: string;
  /** NODE_ENV 주입 (기본값: process.env.NODE_ENV || 'development') */
  nodeEnv?: string;
}

/**
 * 인증 라우트 팩토리.
 * apps/api/src/app.ts 에서 `app.route('/api/auth', createAuthRoutes({ db, jwtSecret }))` 형태로 마운트된다.
 */
export function createAuthRoutes(opts: CreateAuthRoutesOptions): Hono {
  const { db, jwtSecret } = opts;
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const sqlite = db.$client;
  const requireAuth = createRequireAuth({ db, jwtSecret });

  // POST /login 에만 레이트 리미팅 적용 (REQ-AUTH-015)
  const loginRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 5 });

  const router = new Hono();

  // -------------------------------------------------------------------------
  // POST /login — 로그인 (레이트 리미팅 적용)
  // -------------------------------------------------------------------------
  router.post('/login', loginRateLimit, async (c) => {
    // 입력 유효성 검사
    let body: z.infer<typeof LoginRequestSchema>;
    try {
      const raw = await c.req.json();
      const parsed = LoginRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: '입력 값이 유효하지 않습니다',
            code: 'VALIDATION_ERROR',
          },
          422,
        );
      }
      body = parsed.data;
    } catch {
      return c.json(
        { success: false, error: '요청 본문을 파싱할 수 없습니다', code: 'VALIDATION_ERROR' },
        400,
      );
    }

    // 사용자 조회
    const user = sqlite
      .query('SELECT id, username, email, password_hash FROM users WHERE username = ?')
      .get(body.username) as {
      id: string;
      username: string;
      email: string;
      password_hash: string;
    } | null;

    // 타이밍 안전: 사용자 없어도 bcrypt.compare 실행 (REQ-AUTH-014)
    const hashToCompare = user ? user.password_hash : DUMMY_HASH;
    const passwordMatch = await bcrypt.compare(body.password, hashToCompare);

    if (!user || !passwordMatch) {
      return c.json(
        {
          success: false,
          error: '아이디 또는 비밀번호가 올바르지 않습니다',
          code: 'INVALID_CREDENTIALS',
        },
        401,
      );
    }

    // 토큰 생성 (ULID JTI)
    const accessJti = ulid();
    const refreshJti = ulid();
    const now = Date.now();

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({ sub: user.id, jti: accessJti }, jwtSecret),
      signRefreshToken({ sub: user.id, jti: refreshJti }, jwtSecret),
    ]);

    // 리프레시 토큰 JTI 를 블랙리스트에 예비 등록하지 않음
    // (로테이션 시 기존 JTI 등록)

    // 쿠키 설정
    setCookie(c, 'access_token', accessToken, buildCookieOptions(900, nodeEnv));
    setCookie(c, 'refresh_token', refreshToken, buildCookieOptions(604800, nodeEnv));

    return c.json({
      success: true,
      user: { id: user.id, username: user.username },
    });
  });

  // -------------------------------------------------------------------------
  // POST /logout — 로그아웃 (requireAuth 보호)
  // -------------------------------------------------------------------------
  router.post('/logout', requireAuth, async (c) => {
    const accessToken = getCookie(c, 'access_token');
    const refreshToken = getCookie(c, 'refresh_token');
    const userId = c.var.userId;
    const now = Date.now();

    // 두 JTI 블랙리스트 등록 (단일 트랜잭션)
    sqlite.transaction(() => {
      // 만료된 항목 정리
      sqlite.prepare('DELETE FROM auth_token_blacklist WHERE expires_at < ?').run(now);

      // 액세스 토큰 JTI 등록
      if (accessToken) {
        const accessClaims = parseTokenClaims(accessToken);
        if (accessClaims?.jti) {
          sqlite
            .prepare(
              'INSERT OR IGNORE INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
            )
            .run(ulid(), accessClaims.jti, userId, now + 900_000, now);
        }
      }

      // 리프레시 토큰 JTI 등록
      if (refreshToken) {
        const refreshClaims = parseTokenClaims(refreshToken);
        if (refreshClaims?.jti) {
          sqlite
            .prepare(
              'INSERT OR IGNORE INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
            )
            .run(ulid(), refreshClaims.jti, userId, now + 604800_000, now);
        }
      }
    })();

    // 쿠키 만료 (Max-Age=0)
    setCookie(c, 'access_token', '', { ...buildCookieOptions(0, nodeEnv) });
    setCookie(c, 'refresh_token', '', { ...buildCookieOptions(0, nodeEnv) });

    return c.json({ success: true });
  });

  // -------------------------------------------------------------------------
  // GET /me — 현재 사용자 정보 (requireAuth 보호)
  // -------------------------------------------------------------------------
  router.get('/me', requireAuth, (c) => {
    const userId = c.var.userId;

    const user = sqlite.query('SELECT id, username, email FROM users WHERE id = ?').get(userId) as {
      id: string;
      username: string;
      email: string;
    } | null;

    if (!user) {
      return c.json(
        { success: false, error: '사용자를 찾을 수 없습니다', code: 'USER_NOT_FOUND' },
        401,
      );
    }

    return c.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email },
    });
  });

  // -------------------------------------------------------------------------
  // POST /refresh — 토큰 갱신 (리프레시 토큰 로테이션)
  // -------------------------------------------------------------------------
  router.post('/refresh', async (c) => {
    const refreshToken = getCookie(c, 'refresh_token');
    if (!refreshToken) {
      return c.json(
        { success: false, error: '리프레시 토큰이 없습니다', code: 'UNAUTHENTICATED' },
        401,
      );
    }

    // 리프레시 토큰 검증
    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(refreshToken, jwtSecret);
    } catch (err) {
      const errName = err instanceof Error ? err.constructor.name : '';
      if (errName === 'JWTExpired') {
        return c.json(
          { success: false, error: '리프레시 토큰이 만료되었습니다', code: 'TOKEN_EXPIRED' },
          401,
        );
      }
      return c.json(
        { success: false, error: '유효하지 않은 리프레시 토큰입니다', code: 'TOKEN_INVALID' },
        401,
      );
    }

    // 타입 확인 (액세스 토큰을 리프레시로 사용하는 경우 거부)
    if (claims.type !== 'refresh') {
      return c.json(
        { success: false, error: '유효하지 않은 토큰 유형입니다', code: 'TOKEN_INVALID' },
        401,
      );
    }

    // REQ-AUTH-016: JTI 블랙리스트 확인 — 재사용 탐지
    const blacklisted = sqlite
      .query('SELECT 1 FROM auth_token_blacklist WHERE jti = ?')
      .get(claims.jti);
    if (blacklisted !== null) {
      // 이미 사용된 리프레시 토큰 재사용 감지 — 401 반환
      return c.json(
        { success: false, error: '토큰이 이미 사용되었습니다', code: 'TOKEN_REVOKED' },
        401,
      );
    }

    // 새 토큰 발급
    const newAccessJti = ulid();
    const newRefreshJti = ulid();
    const now = Date.now();

    const [newAccessToken, newRefreshToken] = await Promise.all([
      signAccessToken({ sub: claims.sub, jti: newAccessJti }, jwtSecret),
      signRefreshToken({ sub: claims.sub, jti: newRefreshJti }, jwtSecret),
    ]);

    // 기존 리프레시 JTI 블랙리스트 등록 (토큰 로테이션)
    sqlite.transaction(() => {
      // 만료된 항목 정리
      sqlite.prepare('DELETE FROM auth_token_blacklist WHERE expires_at < ?').run(now);

      // 기존 리프레시 JTI 블랙리스트 등록
      sqlite
        .prepare(
          'INSERT OR IGNORE INTO auth_token_blacklist (id, jti, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(ulid(), claims.jti, claims.sub, claims.exp * 1000, now);
    })();

    // 새 쿠키 설정
    setCookie(c, 'access_token', newAccessToken, buildCookieOptions(900, nodeEnv));
    setCookie(c, 'refresh_token', newRefreshToken, buildCookieOptions(604800, nodeEnv));

    return c.json({ success: true });
  });

  return router;
}
