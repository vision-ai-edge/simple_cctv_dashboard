/**
 * /(app)/boxes 목록 페이지 서버 로드 함수.
 *
 * 서버 사이드에서 GET /api/boxes를 호출하여 Box 목록을 반환한다.
 * event.fetch를 사용하여 SvelteKit Vite 프록시를 통해 API를 호출한다.
 *
 * 인증 가드는 (app)/+layout.server.ts에서 처리하므로,
 * 이 파일은 event.locals.user가 반드시 존재한다고 가정한다.
 */

import { type BoxError, type BoxSummary, fetchBoxes } from '$lib/api/boxes';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * fetchBoxes 결과를 기반으로 load 반환값을 결정하는 순수 함수.
 * 테스트 용이성을 위해 export한다.
 */
export function loadLogic(
  fetchResult: { ok: true; boxes: BoxSummary[] } | { ok: false; error: BoxError },
): { boxes: BoxSummary[]; error?: string } {
  if (!fetchResult.ok) {
    return { boxes: [], error: fetchResult.error.message };
  }
  return { boxes: fetchResult.boxes };
}

export const load: PageServerLoad = async ({ fetch: eventFetch, locals }) => {
  // REQ-UI-5: locals.user 없으면 조기 리턴 (레이아웃 가드가 먼저 처리하지만 방어적 체크)
  if (!locals.user) {
    redirect(303, '/login');
  }

  const fetchResult = await fetchBoxes(eventFetch);

  // unauthorized → 로그인 페이지로 리다이렉트
  if (!fetchResult.ok && fetchResult.error.kind === 'unauthorized') {
    redirect(303, '/login');
  }

  return loadLogic(fetchResult);
};
