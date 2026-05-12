/**
 * SPEC-AUTH-001 — requireAuth Hono 미들웨어.
 *
 * access_token 쿠키를 검증하고, 유효하면 c.var 에 userId 와 tokenJti 를 설정한다.
 *
 * 응답 에러 코드:
 * - UNAUTHENTICATED: 쿠키 없음
 * - TOKEN_EXPIRED: 토큰 만료
 * - TOKEN_INVALID: 서명 오류, 잘못된 issuer, 리프레시 토큰 사용
 * - TOKEN_REVOKED: 블랙리스트에 등록된 JTI
 */

import type { Db } from '@cctv/db';
import { verifyToken } from '@cctv/shared';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

// ---------------------------------------------------------------------------
// Hono ContextVariableMap 모듈 보강
// ---------------------------------------------------------------------------
declare module 'hono' {
  interface ContextVariableMap {
    /** 인증된 사용자 ID (users.id) */
    userId: string;
    /** 현재 액세스 토큰 JTI */
    tokenJti: string;
  }
}

export interface RequireAuthOptions {
  db: Db;
  jwtSecret: string;
}

/**
 * requireAuth 미들웨어 팩토리.
 *
 * @param opts - DB 인스턴스와 JWT 시크릿
 * @returns Hono 미들웨어 핸들러
 */
export function createRequireAuth(opts: RequireAuthOptions): MiddlewareHandler {
  const { db, jwtSecret } = opts;
  const sqlite = db.$client;

  return async (c, next) => {
    // 1. access_token 쿠키 추출
    const token = getCookie(c, 'access_token');
    if (!token) {
      return c.json({ success: false, error: '인증이 필요합니다', code: 'UNAUTHENTICATED' }, 401);
    }

    // 2. 토큰 검증
    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(token, jwtSecret);
    } catch (err) {
      // jose 오류 타입 분류 — 만료 vs 기타
      const errName = err instanceof Error ? err.constructor.name : '';
      if (errName === 'JWTExpired') {
        return c.json(
          { success: false, error: '토큰이 만료되었습니다', code: 'TOKEN_EXPIRED' },
          401,
        );
      }
      return c.json(
        { success: false, error: '유효하지 않은 토큰입니다', code: 'TOKEN_INVALID' },
        401,
      );
    }

    // 3. 리프레시 토큰을 액세스 보호 라우트에 사용 금지
    if (claims.type === 'refresh') {
      return c.json(
        { success: false, error: '유효하지 않은 토큰 유형입니다', code: 'TOKEN_INVALID' },
        401,
      );
    }

    // 4. JTI 블랙리스트 확인
    const blacklisted = sqlite
      .query('SELECT 1 FROM auth_token_blacklist WHERE jti = ?')
      .get(claims.jti);
    if (blacklisted !== null) {
      return c.json({ success: false, error: '취소된 토큰입니다', code: 'TOKEN_REVOKED' }, 401);
    }

    // 5. 인증 성공 — 컨텍스트에 정보 저장
    c.set('userId', claims.sub);
    c.set('tokenJti', claims.jti);

    await next();
  };
}
