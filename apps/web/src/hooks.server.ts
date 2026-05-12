/**
 * SvelteKit 서버 훅.
 *
 * 모든 서버 사이드 요청에서 실행되며 access_token 쿠키를 검증하여
 * event.locals.user에 사용자 정보를 주입한다.
 *
 * 흐름:
 *   1. access_token 쿠키 확인
 *   2. 없으면 event.locals.user = null 설정 후 다음으로 통과
 *   3. 있으면 /api/auth/me 호출하여 검증
 *   4. 검증 성공: event.locals.user = 사용자 정보
 *   5. 검증 실패(401 등): 만료된 쿠키 삭제 후 event.locals.user = null
 */

import { getCurrentUser } from '$lib/server/auth';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('access_token');

  if (!token) {
    // 토큰이 없으면 미인증 상태로 요청을 그대로 통과시킨다
    event.locals.user = null;
    return resolve(event);
  }

  // 토큰이 있으면 /api/auth/me로 검증
  const user = await getCurrentUser(event);

  if (user) {
    event.locals.user = user;
  } else {
    // 검증 실패 — 만료되었거나 블랙리스트된 토큰. 쿠키를 삭제하여 재시도를 방지한다.
    event.locals.user = null;
    event.cookies.delete('access_token', { path: '/' });
  }

  return resolve(event);
};
