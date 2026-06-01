/**
 * SvelteKit 서버 훅.
 *
 * 모든 서버 사이드 요청에서 실행되며 access_token 쿠키를 검증하여
 * event.locals.user에 사용자 정보를 주입한다.
 *
 * 흐름:
 *   1. /api/* 경로는 SvelteKit API catch-all 이 Hono 앱에 전달하므로 hook 우회
 *   2. access_token 쿠키 확인
 *   3. 없으면 event.locals.user = null 설정 후 다음으로 통과
 *   4. 있으면 API 서버에 직접 호출하여 검증 (event.fetch 미사용 — hooks 재귀 방지)
 *   5. 검증 성공: event.locals.user = 사용자 정보
 *   6. 검증 실패(401 등): 만료된 쿠키 삭제 후 event.locals.user = null
 */

import { getCurrentUser } from '$lib/server/auth';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // API 요청은 hook 우회 — /api/* 자체 인증은 Hono requireAuth 가 처리한다.
  if (event.url.pathname.startsWith('/api/')) {
    event.locals.user = null;
    return resolve(event);
  }

  const token = event.cookies.get('access_token');

  if (!token) {
    event.locals.user = null;
    return resolve(event);
  }

  // 토큰이 있으면 API 서버를 절대 URL 로 직접 호출하여 검증한다.
  // event.fetch 를 사용하면 SvelteKit 라우터를 거쳐 hooks 가 재진입할 수 있다.
  const user = await getCurrentUser(token);

  if (user) {
    event.locals.user = user;
  } else {
    event.locals.user = null;
    event.cookies.delete('access_token', { path: '/' });
    event.cookies.delete('refresh_token', { path: '/' });
  }

  return resolve(event);
};
