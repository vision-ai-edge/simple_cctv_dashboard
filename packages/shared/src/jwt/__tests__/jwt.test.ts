/**
 * SPEC-AUTH-001 — JWT 유틸리티 모듈 테스트.
 *
 * RED 단계: 아직 jwt/index.ts 가 없으므로 모두 실패한다.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import {
  assertJwtSecret,
  parseTokenClaims,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from '../index';

// 테스트용 시크릿 (32바이트 이상)
const TEST_SECRET = 'test-secret-key-must-be-at-least-32-bytes-long!!';

describe('signAccessToken', () => {
  test('액세스 토큰을 서명하고 반환한다', async () => {
    const token = await signAccessToken({ sub: 'user-001', jti: 'jti-001' }, TEST_SECRET);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // JWT 형식 확인
  });

  test('액세스 토큰 exp 는 now + 900초 (±5초 허용)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signAccessToken({ sub: 'user-001', jti: 'jti-002' }, TEST_SECRET);
    const after = Math.floor(Date.now() / 1000);

    const claims = parseTokenClaims(token);
    expect(claims).not.toBeNull();
    // exp 는 before + 900 ~ after + 900 범위 내여야 한다
    expect(claims?.exp).toBeGreaterThanOrEqual(before + 900);
    expect(claims?.exp).toBeLessThanOrEqual(after + 900 + 5);
  });

  test('액세스 토큰 iss 는 "simple_cctv" 이다', async () => {
    const token = await signAccessToken({ sub: 'user-001', jti: 'jti-003' }, TEST_SECRET);
    const claims = parseTokenClaims(token);
    expect(claims?.iss).toBe('simple_cctv');
  });

  test('sub 와 jti 클레임이 포함된다', async () => {
    const token = await signAccessToken({ sub: 'user-abc', jti: 'jti-xyz' }, TEST_SECRET);
    const claims = parseTokenClaims(token);
    expect(claims?.sub).toBe('user-abc');
    expect(claims?.jti).toBe('jti-xyz');
  });
});

describe('signRefreshToken', () => {
  test('리프레시 토큰을 서명하고 반환한다', async () => {
    const token = await signRefreshToken({ sub: 'user-001', jti: 'jti-r001' }, TEST_SECRET);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  test('리프레시 토큰 exp 는 now + 604800초 (7일, ±10초 허용)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signRefreshToken({ sub: 'user-001', jti: 'jti-r002' }, TEST_SECRET);
    const after = Math.floor(Date.now() / 1000);

    const claims = parseTokenClaims(token);
    expect(claims?.exp).toBeGreaterThanOrEqual(before + 604800);
    expect(claims?.exp).toBeLessThanOrEqual(after + 604800 + 10);
  });

  test('리프레시 토큰 type 은 "refresh" 이다', async () => {
    const token = await signRefreshToken({ sub: 'user-001', jti: 'jti-r003' }, TEST_SECRET);
    const claims = parseTokenClaims(token);
    expect(claims?.type).toBe('refresh');
  });

  test('리프레시 토큰 iss 는 "simple_cctv" 이다', async () => {
    const token = await signRefreshToken({ sub: 'user-001', jti: 'jti-r004' }, TEST_SECRET);
    const claims = parseTokenClaims(token);
    expect(claims?.iss).toBe('simple_cctv');
  });
});

describe('verifyToken', () => {
  test('유효한 액세스 토큰 검증 성공', async () => {
    const token = await signAccessToken({ sub: 'user-001', jti: 'jti-v001' }, TEST_SECRET);
    const claims = await verifyToken(token, TEST_SECRET);
    expect(claims.sub).toBe('user-001');
    expect(claims.jti).toBe('jti-v001');
    expect(claims.iss).toBe('simple_cctv');
  });

  test('유효한 리프레시 토큰 검증 성공 — type: "refresh"', async () => {
    const token = await signRefreshToken({ sub: 'user-001', jti: 'jti-v002' }, TEST_SECRET);
    const claims = await verifyToken(token, TEST_SECRET);
    expect(claims.type).toBe('refresh');
  });

  test('만료된 토큰 검증 시 오류 발생', async () => {
    // 이미 만료된 토큰 직접 생성 (jose API 사용)
    const secretKey = new TextEncoder().encode(TEST_SECRET);
    const expiredToken = await new SignJWT({ jti: 'jti-expired', type: undefined })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-001')
      .setIssuer('simple_cctv')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2시간 전 발급
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // 1시간 전 만료
      .sign(secretKey);

    await expect(verifyToken(expiredToken, TEST_SECRET)).rejects.toThrow();
  });

  test('잘못된 서명 토큰 검증 시 오류 발생', async () => {
    const token = await signAccessToken({ sub: 'user-001', jti: 'jti-v003' }, TEST_SECRET);
    const wrongSecret = 'wrong-secret-key-must-be-at-least-32-bytes-long!';
    await expect(verifyToken(token, wrongSecret)).rejects.toThrow();
  });

  test('잘못된 issuer 토큰 검증 시 오류 발생', async () => {
    const secretKey = new TextEncoder().encode(TEST_SECRET);
    const wrongIssuerToken = await new SignJWT({ jti: 'jti-wrong-iss' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-001')
      .setIssuer('wrong-issuer') // 올바르지 않은 발급자
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secretKey);

    await expect(verifyToken(wrongIssuerToken, TEST_SECRET)).rejects.toThrow();
  });
});

describe('parseTokenClaims', () => {
  test('검증 없이 클레임을 디코딩한다', async () => {
    const token = await signAccessToken({ sub: 'user-001', jti: 'jti-p001' }, TEST_SECRET);
    const claims = parseTokenClaims(token);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('user-001');
  });

  test('잘못된 토큰 형식 시 null 반환', () => {
    const claims = parseTokenClaims('invalid.token.here');
    // jose decodeJwt 는 유효하지 않은 base64 시 오류를 던지므로 null 반환 처리
    expect(claims).toBeNull();
  });
});

describe('assertJwtSecret', () => {
  test('undefined 이면 오류를 던진다', () => {
    expect(() => assertJwtSecret(undefined)).toThrow();
  });

  test('빈 문자열이면 오류를 던진다', () => {
    expect(() => assertJwtSecret('')).toThrow();
  });

  test('32바이트 미만 문자열이면 오류를 던진다', () => {
    expect(() => assertJwtSecret('short-secret')).toThrow();
  });

  test('32바이트 이상 문자열은 통과한다', () => {
    // 32자 정확히
    expect(() => assertJwtSecret('a'.repeat(32))).not.toThrow();
    // 32자 초과
    expect(() => assertJwtSecret('a'.repeat(64))).not.toThrow();
  });
});
