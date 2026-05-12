/**
 * /login 페이지 서버 액션 테스트.
 *
 * SvelteKit의 `fail()`과 `redirect()`는 특수 객체를 throw하므로,
 * 핵심 로직을 순수 함수로 추출하여 테스트한다.
 */

import { describe, expect, it } from 'bun:test';

// --- 테스트용 순수 함수 추출 ---

/** 입력값 유효성 검사 로직 (page.server.ts에서 복제) */
function validateInput(username: string, password: string): { ok: boolean; error?: string } {
  if (!username || username.trim().length === 0) {
    return { ok: false, error: '아이디를 입력해주세요' };
  }
  if (username.length > 64) {
    return { ok: false, error: '아이디는 64자 이하여야 합니다' };
  }
  if (!password || password.length === 0) {
    return { ok: false, error: '비밀번호를 입력해주세요' };
  }
  if (password.length > 128) {
    return { ok: false, error: '비밀번호는 128자 이하여야 합니다' };
  }
  return { ok: true };
}

/** Set-Cookie 헤더 파싱 로직 (page.server.ts에서 복제) */
function parseSetCookieHeader(
  setCookieValue: string,
): { name: string; value: string; maxAge?: number } | null {
  const parts = setCookieValue.split(';').map((p) => p.trim());
  const nameValue = parts[0];
  if (!nameValue) return null;

  const eqIdx = nameValue.indexOf('=');
  if (eqIdx < 0) return null;

  const name = nameValue.substring(0, eqIdx).trim();
  const value = nameValue.substring(eqIdx + 1).trim();

  let maxAge: number | undefined;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower.startsWith('max-age=')) {
      const parsed = Number.parseInt(part.substring('max-age='.length), 10);
      if (!Number.isNaN(parsed)) maxAge = parsed;
    }
  }

  return { name, value, maxAge };
}

/** API 응답 상태에 따른 에러 매핑 로직 */
function mapApiStatusToError(
  status: number,
): { type: 'fail'; status: number; message: string } | { type: 'success' } {
  if (status === 429) {
    return {
      type: 'fail',
      status: 429,
      message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요',
    };
  }
  if (status === 401) {
    return { type: 'fail', status: 401, message: '아이디 또는 비밀번호가 올바르지 않습니다' };
  }
  if (status === 422) {
    return { type: 'fail', status: 422, message: '입력값이 올바르지 않습니다' };
  }
  if (status >= 200 && status < 300) {
    return { type: 'success' };
  }
  return { type: 'fail', status: 500, message: '서버 오류가 발생했습니다' };
}

// --- 테스트 ---

describe('validateInput', () => {
  it('올바른 입력값은 ok: true를 반환한다', () => {
    const result = validateInput('admin', 'password123');
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('빈 아이디는 오류를 반환한다', () => {
    const result = validateInput('', 'password123');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('아이디를 입력해주세요');
  });

  it('공백만 있는 아이디는 오류를 반환한다', () => {
    const result = validateInput('   ', 'password123');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('아이디를 입력해주세요');
  });

  it('64자를 초과하는 아이디는 오류를 반환한다', () => {
    const result = validateInput('a'.repeat(65), 'password123');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('아이디는 64자 이하여야 합니다');
  });

  it('정확히 64자 아이디는 통과한다', () => {
    const result = validateInput('a'.repeat(64), 'password123');
    expect(result.ok).toBe(true);
  });

  it('빈 비밀번호는 오류를 반환한다', () => {
    const result = validateInput('admin', '');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('비밀번호를 입력해주세요');
  });

  it('128자를 초과하는 비밀번호는 오류를 반환한다', () => {
    const result = validateInput('admin', 'p'.repeat(129));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('비밀번호는 128자 이하여야 합니다');
  });

  it('정확히 128자 비밀번호는 통과한다', () => {
    const result = validateInput('admin', 'p'.repeat(128));
    expect(result.ok).toBe(true);
  });
});

describe('parseSetCookieHeader', () => {
  it('access_token 쿠키 헤더를 올바르게 파싱한다', () => {
    const header =
      'access_token=eyJhbGciOiJIUzI1NiJ9.test; Path=/; HttpOnly; SameSite=Lax; Max-Age=900';
    const result = parseSetCookieHeader(header);

    expect(result).not.toBeNull();
    expect(result?.name).toBe('access_token');
    expect(result?.value).toBe('eyJhbGciOiJIUzI1NiJ9.test');
    expect(result?.maxAge).toBe(900);
  });

  it('refresh_token 쿠키 헤더를 올바르게 파싱한다', () => {
    const header =
      'refresh_token=refresh_value_here; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800';
    const result = parseSetCookieHeader(header);

    expect(result).not.toBeNull();
    expect(result?.name).toBe('refresh_token');
    expect(result?.value).toBe('refresh_value_here');
    expect(result?.maxAge).toBe(604800);
  });

  it('Max-Age가 없는 헤더도 파싱한다', () => {
    const header = 'session=abc123; Path=/; HttpOnly';
    const result = parseSetCookieHeader(header);

    expect(result).not.toBeNull();
    expect(result?.name).toBe('session');
    expect(result?.value).toBe('abc123');
    expect(result?.maxAge).toBeUndefined();
  });

  it('잘못된 형식은 null을 반환한다', () => {
    const result = parseSetCookieHeader('');
    expect(result).toBeNull();
  });
});

describe('mapApiStatusToError', () => {
  it('200 응답은 success를 반환한다', () => {
    const result = mapApiStatusToError(200);
    expect(result.type).toBe('success');
  });

  it('401 응답은 한국어 오류 메시지를 반환한다', () => {
    const result = mapApiStatusToError(401);
    expect(result.type).toBe('fail');
    if (result.type === 'fail') {
      expect(result.status).toBe(401);
      expect(result.message).toBe('아이디 또는 비밀번호가 올바르지 않습니다');
    }
  });

  it('422 응답은 유효성 검사 오류 메시지를 반환한다', () => {
    const result = mapApiStatusToError(422);
    expect(result.type).toBe('fail');
    if (result.type === 'fail') {
      expect(result.status).toBe(422);
      expect(result.message).toBe('입력값이 올바르지 않습니다');
    }
  });

  it('429 응답은 레이트 리밋 메시지를 반환한다', () => {
    const result = mapApiStatusToError(429);
    expect(result.type).toBe('fail');
    if (result.type === 'fail') {
      expect(result.status).toBe(429);
      expect(result.message).toBe('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요');
    }
  });

  it('500 응답은 서버 오류 메시지를 반환한다', () => {
    const result = mapApiStatusToError(500);
    expect(result.type).toBe('fail');
    if (result.type === 'fail') {
      expect(result.status).toBe(500);
      expect(result.message).toBe('서버 오류가 발생했습니다');
    }
  });

  it('503 등 알 수 없는 오류는 서버 오류 메시지를 반환한다', () => {
    const result = mapApiStatusToError(503);
    expect(result.type).toBe('fail');
    if (result.type === 'fail') {
      expect(result.message).toBe('서버 오류가 발생했습니다');
    }
  });
});
