/**
 * SPEC-AUTH-001 — 인증 통합 테스트 헬퍼.
 *
 * 공통 픽스처와 유틸리티 함수를 제공한다.
 */

import type { Db } from '@cctv/db';
import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';

// ---------------------------------------------------------------------------
// 사용자 생성 픽스처
// ---------------------------------------------------------------------------

export interface CreateTestUserOptions {
  username: string;
  password: string;
  email?: string;
}

export interface TestUser {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
}

/**
 * 테스트용 사용자를 DB 에 삽입한다.
 * bcrypt 비용 인자를 4로 낮춰 테스트 속도를 높인다.
 */
export async function createTestUser(db: Db, opts: CreateTestUserOptions): Promise<TestUser> {
  const id = ulid();
  const email = opts.email ?? `${opts.username}@test.com`;
  const passwordHash = await bcrypt.hash(opts.password, 4);
  const now = Date.now();

  db.$client
    .prepare(
      'INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, opts.username, email, passwordHash, now, now);

  return { id, username: opts.username, email, passwordHash };
}

// ---------------------------------------------------------------------------
// Set-Cookie 파싱 유틸리티
// ---------------------------------------------------------------------------

export interface CookieInfo {
  value: string;
  attrs: Record<string, string | true>;
}

/**
 * Set-Cookie 헤더 문자열을 파싱하여 쿠키 이름별 정보를 반환한다.
 *
 * 예: "access_token=xxx; HttpOnly; Path=/; SameSite=Lax; Max-Age=900"
 */
export function parseSetCookies(res: Response): Map<string, CookieInfo> {
  const map = new Map<string, CookieInfo>();
  // Hono 는 여러 Set-Cookie 헤더를 각각 내보낸다
  const cookieHeaders: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      // 단일 헤더 값으로 묶여 올 수도 있음
      cookieHeaders.push(value);
    }
  });

  for (const header of cookieHeaders) {
    // 하나의 Set-Cookie 헤더 파싱
    const parts = header.split(';').map((p) => p.trim());
    const [nameValue, ...attrParts] = parts;
    if (!nameValue) continue;

    const eqIdx = nameValue.indexOf('=');
    if (eqIdx === -1) continue;
    const name = nameValue.slice(0, eqIdx).trim();
    const value = nameValue.slice(eqIdx + 1).trim();

    const attrs: Record<string, string | true> = {};
    for (const attr of attrParts) {
      const attrEqIdx = attr.indexOf('=');
      if (attrEqIdx === -1) {
        attrs[attr.toLowerCase()] = true;
      } else {
        const attrName = attr.slice(0, attrEqIdx).trim().toLowerCase();
        const attrValue = attr.slice(attrEqIdx + 1).trim();
        attrs[attrName] = attrValue;
      }
    }

    map.set(name, { value, attrs });
  }

  return map;
}

/**
 * Set-Cookie 맵에서 Cookie 요청 헤더 문자열을 생성한다.
 */
export function buildCookieHeader(cookies: Map<string, string>): string {
  const parts: string[] = [];
  cookies.forEach((value, name) => {
    parts.push(`${name}=${value}`);
  });
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// 로그인 헬퍼
// ---------------------------------------------------------------------------

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  cookieHeader: string;
}

/**
 * /api/auth/login 요청을 보내고 쿠키 정보를 반환한다.
 */
export async function loginAs(
  app: { request: (url: string, init?: RequestInit) => Response | Promise<Response> },
  opts: { username: string; password: string },
): Promise<LoginResult> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: opts.username, password: opts.password }),
  });

  if (res.status !== 200) {
    throw new Error(`loginAs 실패: status=${res.status}`);
  }

  const cookies = parseSetCookies(res);
  const accessInfo = cookies.get('access_token');
  const refreshInfo = cookies.get('refresh_token');

  if (!accessInfo || !refreshInfo) {
    throw new Error('loginAs: Set-Cookie 헤더에서 토큰을 찾을 수 없습니다');
  }

  const cookieMap = new Map<string, string>([
    ['access_token', accessInfo.value],
    ['refresh_token', refreshInfo.value],
  ]);

  return {
    accessToken: accessInfo.value,
    refreshToken: refreshInfo.value,
    cookieHeader: buildCookieHeader(cookieMap),
  };
}
