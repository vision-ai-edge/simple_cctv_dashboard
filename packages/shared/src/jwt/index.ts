/**
 * SPEC-AUTH-001 — JWT 유틸리티 모듈.
 *
 * - HS256 알고리즘 사용
 * - 발급자(iss): "simple_cctv"
 * - 액세스 토큰 만료: 15분 (900초)
 * - 리프레시 토큰 만료: 7일 (604800초)
 */

import { SignJWT, decodeJwt, jwtVerify } from 'jose';

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

/** 액세스 토큰 클레임 */
export interface AccessTokenClaims {
  sub: string;
  jti: string;
  exp: number;
  iss: string;
  iat: number;
  type?: undefined;
}

/** 리프레시 토큰 클레임 — type 필드로 구별 */
export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  exp: number;
  iss: string;
  iat: number;
  type: 'refresh';
}

/** 토큰 클레임 판별 유니온 */
export type TokenClaims = AccessTokenClaims | RefreshTokenClaims;

// ---------------------------------------------------------------------------
// 내부 상수
// ---------------------------------------------------------------------------

const ISSUER = 'simple_cctv';
const ACCESS_TOKEN_EXPIRY_SECONDS = 900; // 15분
const REFRESH_TOKEN_EXPIRY_SECONDS = 604800; // 7일

/** 시크릿 문자열을 Uint8Array 로 변환 */
function toSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// 토큰 서명
// ---------------------------------------------------------------------------

/**
 * 액세스 토큰을 서명한다.
 * - exp: now + 900초
 * - iss: "simple_cctv"
 */
export async function signAccessToken(
  payload: { sub: string; jti: string },
  secret: string,
): Promise<string> {
  return new SignJWT({ jti: payload.jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_EXPIRY_SECONDS}s`)
    .sign(toSecretKey(secret));
}

/**
 * 리프레시 토큰을 서명한다.
 * - exp: now + 604800초 (7일)
 * - iss: "simple_cctv"
 * - type: "refresh" (커스텀 클레임)
 */
export async function signRefreshToken(
  payload: { sub: string; jti: string },
  secret: string,
): Promise<string> {
  return new SignJWT({ jti: payload.jti, type: 'refresh' as const })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_EXPIRY_SECONDS}s`)
    .sign(toSecretKey(secret));
}

// ---------------------------------------------------------------------------
// 토큰 검증
// ---------------------------------------------------------------------------

/**
 * 토큰을 검증하고 클레임을 반환한다.
 *
 * - iss 검증 포함
 * - 만료 검증 포함
 * - 서명 검증 포함
 *
 * @throws JWTExpired, JWTInvalid, JWSSignatureVerificationFailed 등 jose 오류
 */
export async function verifyToken(token: string, secret: string): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, toSecretKey(secret), {
    issuer: ISSUER,
    algorithms: ['HS256'],
  });

  // 리프레시 토큰 타입 가드
  if ((payload as Record<string, unknown>).type === 'refresh') {
    return {
      sub: payload.sub as string,
      jti: payload.jti as string,
      exp: payload.exp as number,
      iss: payload.iss as string,
      iat: payload.iat as number,
      type: 'refresh',
    };
  }

  return {
    sub: payload.sub as string,
    jti: payload.jti as string,
    exp: payload.exp as number,
    iss: payload.iss as string,
    iat: payload.iat as number,
  };
}

// ---------------------------------------------------------------------------
// 클레임 디코딩 (검증 없음 — 로깅/디버그 용도)
// ---------------------------------------------------------------------------

/**
 * 서명 검증 없이 토큰 클레임을 디코딩한다.
 * 신뢰할 수 없는 데이터에 사용하지 말 것.
 *
 * @returns TokenClaims | null (파싱 실패 시)
 */
export function parseTokenClaims(token: string): TokenClaims | null {
  try {
    const payload = decodeJwt(token);
    if ((payload as Record<string, unknown>).type === 'refresh') {
      return {
        sub: payload.sub as string,
        jti: payload.jti as string,
        exp: payload.exp as number,
        iss: payload.iss as string,
        iat: payload.iat as number,
        type: 'refresh',
      };
    }
    return {
      sub: payload.sub as string,
      jti: payload.jti as string,
      exp: payload.exp as number,
      iss: payload.iss as string,
      iat: payload.iat as number,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 시크릿 검증
// ---------------------------------------------------------------------------

/**
 * JWT_SECRET 환경 변수를 검증한다.
 * undefined, 빈 문자열, 32바이트 미만이면 오류를 던진다.
 *
 * @throws Error — 시크릿이 없거나 너무 짧을 때
 */
export function assertJwtSecret(secret: string | undefined): asserts secret is string {
  if (secret === undefined || secret === null) {
    throw new Error('[SPEC-AUTH-001] JWT_SECRET 환경 변수가 설정되지 않았습니다.');
  }
  const byteLength = new TextEncoder().encode(secret).length;
  if (byteLength < 32) {
    throw new Error(
      `[SPEC-AUTH-001] JWT_SECRET 는 최소 32바이트이어야 합니다. 현재: ${byteLength}바이트`,
    );
  }
}
