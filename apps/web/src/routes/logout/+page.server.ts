/**
 * /logout 서버 액션 및 로드 함수.
 *
 * POST (폼 액션): API 로그아웃 호출 → 로컬 쿠키 삭제 → /login으로 리다이렉트
 * GET (load): 같은 동작 — /logout URL을 직접 방문해도 로그아웃 처리가 된다
 */

import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * GET /logout — 직접 URL 방문 시 로그아웃 처리 후 /login으로 이동한다.
 */
export const load: PageServerLoad = async ({ fetch: eventFetch, cookies }) => {
  await performLogout(eventFetch, cookies);
  redirect(303, '/login');
};

export const actions: Actions = {
  /**
   * POST /logout (폼 제출) — 로그아웃 처리 후 /login으로 리다이렉트한다.
   */
  default: async ({ fetch: eventFetch, cookies }) => {
    await performLogout(eventFetch, cookies);
    redirect(303, '/login');
  },
};

/**
 * 실제 로그아웃 처리 로직.
 *
 * 1. /api/auth/logout 호출 (서버에서 토큰 jti 블랙리스트 처리)
 * 2. 로컬 쿠키 삭제
 *
 * API 호출이 실패해도 로컬 쿠키는 삭제하여 클라이언트 세션을 종료한다.
 */
async function performLogout(
  eventFetch: typeof fetch,
  cookies: { delete: (name: string, opts: { path: string }) => void },
): Promise<void> {
  try {
    // API 서버에서 토큰 블랙리스트 처리 (쿠키를 포워딩하여 토큰을 전달)
    await eventFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // API 호출 실패 시에도 로컬 쿠키를 삭제하여 강제 로그아웃 처리
  }

  // 로컬 쿠키 삭제
  cookies.delete('access_token', { path: '/' });
  cookies.delete('refresh_token', { path: '/' });
}
