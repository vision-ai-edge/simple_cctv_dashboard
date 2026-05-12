/**
 * (app) 보호 라우트 그룹 레이아웃 로드 함수.
 *
 * event.locals.user가 null이면 /login으로 리다이렉트하여 미인증 접근을 차단한다.
 * 인증된 경우 사용자 정보를 반환하여 하위 페이지에서 $page.data.user로 접근 가능하게 한다.
 */

import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  if (!locals.user) {
    // 미인증 — 로그인 페이지로 리다이렉트
    redirect(303, '/login');
  }

  // 인증된 사용자 정보를 하위 레이아웃 및 페이지에 전달
  return {
    user: locals.user,
  };
};
