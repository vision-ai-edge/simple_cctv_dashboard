/**
 * /login 페이지 서버 액션.
 *
 * 폼 제출 → POST /api/auth/login 호출 → 쿠키 설정 → 리다이렉트 흐름을 처리한다.
 *
 * 쿠키 처리 전략:
 *   - event.fetch로 API를 호출하면 응답의 Set-Cookie 헤더를 SvelteKit이 자동으로
 *     클라이언트에게 전달하지 않는다 (다른 포트/오리진이기 때문).
 *   - 따라서 API 응답의 Set-Cookie 헤더를 파싱하여 event.cookies.set()으로
 *     수동으로 브라우저에게 전달한다.
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/** API 로그인 성공 응답 타입 */
interface LoginSuccessBody {
  success: true;
  user: { id: string; username: string };
}

/** 입력값 유효성 검사 결과 */
interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * 입력값 서버 사이드 유효성 검사.
 * Zod 없이 수동 검사로 구현 (apps/web에 Zod 미설치).
 */
function validateInput(username: string, password: string): ValidationResult {
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

/**
 * Set-Cookie 헤더 문자열을 파싱하여 이름, 값, 옵션을 추출한다.
 *
 * 예) "access_token=xxx; Path=/; HttpOnly; SameSite=Lax; Max-Age=900"
 */
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

/**
 * load 함수: 이미 로그인된 사용자는 홈으로 리다이렉트한다.
 */
export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) {
    redirect(303, '/');
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, fetch: eventFetch, cookies }) => {
    const formData = await request.formData();
    const username = String(formData.get('username') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    // 입력값 유효성 검사
    const validation = validateInput(username, password);
    if (!validation.ok) {
      return fail(422, { error: validation.error ?? '입력값이 올바르지 않습니다', username });
    }

    let response: Response;
    try {
      response = await eventFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      return fail(500, { error: '서버 오류가 발생했습니다', username });
    }

    // API 응답에 따른 분기 처리
    if (response.status === 429) {
      return fail(429, {
        error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요',
        username,
      });
    }

    if (response.status === 401) {
      return fail(401, {
        error: '아이디 또는 비밀번호가 올바르지 않습니다',
        username,
      });
    }

    if (response.status === 422) {
      return fail(422, { error: '입력값이 올바르지 않습니다', username });
    }

    if (!response.ok) {
      return fail(500, { error: '서버 오류가 발생했습니다', username });
    }

    // 성공 처리: API 응답의 Set-Cookie 헤더를 파싱하여 브라우저에게 전달한다.
    // event.fetch는 쿠키를 자동 전달하지 않으므로 수동으로 설정한다.
    const setCookieHeaders = response.headers.getSetCookie?.() ?? [];

    // 폴백: getSetCookie가 없는 환경에서는 get('set-cookie')를 사용한다 (첫 번째만 반환)
    const cookiesToSet =
      setCookieHeaders.length > 0
        ? setCookieHeaders
        : response.headers.get('set-cookie')
          ? [response.headers.get('set-cookie') as string]
          : [];

    for (const setCookie of cookiesToSet) {
      const parsed = parseSetCookieHeader(setCookie);
      if (!parsed) continue;

      const isProduction = process.env.NODE_ENV === 'production';
      // access_token은 15분(900초), refresh_token은 7일(604800초)
      const cookieOptions = {
        httpOnly: true as const,
        sameSite: 'lax' as const,
        path: '/',
        secure: isProduction,
        ...(parsed.maxAge !== undefined && { maxAge: parsed.maxAge }),
      };

      cookies.set(parsed.name, parsed.value, cookieOptions);
    }

    // 로그인 성공 — 본문 검증 (선택적)
    try {
      await (response.json() as Promise<LoginSuccessBody>);
    } catch {
      // JSON 파싱 실패해도 쿠키가 설정되었으면 리다이렉트 진행
    }

    // redirect는 try/catch 바깥에서 throw해야 한다 (SvelteKit 2.x 패턴)
    redirect(303, '/');
  },
};
