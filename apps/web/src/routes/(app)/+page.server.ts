// TAG: DASHBOARD-001
/**
 * /(app) 루트 페이지 서버 로드 — /dashboard 리다이렉트.
 *
 * REQ-DASH-001 [Event-Driven]: 사용자가 루트 경로(/)에 접근하면 /dashboard 로 리다이렉트한다.
 * D2: 기존 +page.svelte placeholder 를 제거하지 않고 서버에서 303 리다이렉트를 처리한다.
 *
 * 인증 가드는 (app)/+layout.server.ts 에서 처리하므로,
 * 이 파일에서는 인증 여부를 확인하지 않는다.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  // REQ-DASH-001: / → /dashboard 리다이렉트
  redirect(303, '/dashboard');
};
