/**
 * /(app)/boxes/[id] 상세 페이지 서버 로드 및 액션.
 *
 * load: GET /api/boxes/:id → BoxSummary 반환. 404 시 SvelteKit error().
 * actions.delete: DELETE /api/boxes/:id → 성공 시 목록 페이지로 303 리다이렉트.
 * actions.refresh: POST /api/boxes/:id/refresh → 인라인 알림으로 결과 표시.
 *
 * REQ-UI-3 [Unwanted]: hasApiKey 불리언만 노출. 실제 JWT/API Key/password 미노출.
 */

import { deleteBoxById, fetchBox, refreshBoxTokens } from '$lib/api/boxes';
import type { BoxError, BoxSummary } from '$lib/api/boxes';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// ---------------------------------------------------------------------------
// 순수 헬퍼 함수 (테스트 가능)
// ---------------------------------------------------------------------------

/**
 * fetchBox 결과를 기반으로 load 반환값 종류를 결정한다.
 */
export function loadDetailLogic(
  fetchResult: { ok: true; box: BoxSummary } | { ok: false; error: BoxError },
):
  | { type: 'ok'; box: BoxSummary }
  | { type: 'notFound' }
  | { type: 'unauthorized' }
  | { type: 'error'; message: string } {
  if (fetchResult.ok) {
    return { type: 'ok', box: fetchResult.box };
  }
  if (fetchResult.error.kind === 'notFound') {
    return { type: 'notFound' };
  }
  if (fetchResult.error.kind === 'unauthorized') {
    return { type: 'unauthorized' };
  }
  return { type: 'error', message: fetchResult.error.message };
}

/**
 * deleteBoxById 결과를 기반으로 액션 결과를 결정한다.
 */
export function decideDeleteOutcome(
  deleteResult: { ok: true } | { ok: false; error: BoxError },
): { type: 'redirect' } | { type: 'error'; message: string; status: number } {
  if (deleteResult.ok) {
    return { type: 'redirect' };
  }
  return {
    type: 'error',
    message: deleteResult.error.message,
    status: deleteResult.error.status,
  };
}

/**
 * refreshBoxTokens 결과를 기반으로 액션 결과를 결정한다.
 */
export function decideRefreshOutcome(
  refreshResult: { ok: true; box: BoxSummary } | { ok: false; error: BoxError },
): { type: 'ok'; box: BoxSummary } | { type: 'error'; message: string; status: number } {
  if (refreshResult.ok) {
    return { type: 'ok', box: refreshResult.box };
  }
  return {
    type: 'error',
    message: refreshResult.error.message,
    status: refreshResult.error.status,
  };
}

// ---------------------------------------------------------------------------
// SvelteKit load / actions
// ---------------------------------------------------------------------------

export const load: PageServerLoad = async ({ params, fetch: eventFetch, locals }) => {
  // REQ-UI-5: 미인증 접근 차단
  if (!locals.user) {
    redirect(303, '/login');
  }

  const fetchResult = await fetchBox(params.id, eventFetch);
  const outcome = loadDetailLogic(fetchResult);

  if (outcome.type === 'notFound') {
    error(404, 'Box를 찾을 수 없습니다');
  }
  if (outcome.type === 'unauthorized') {
    redirect(303, '/login');
  }
  if (outcome.type === 'error') {
    // 그 외 에러 — 에러 메시지와 함께 렌더링
    return { box: null, loadError: outcome.message };
  }

  return { box: outcome.box, loadError: null };
};

export const actions: Actions = {
  /** Box 삭제 액션 */
  delete: async ({ params, fetch: eventFetch, locals }) => {
    if (!locals.user) {
      redirect(303, '/login');
    }

    const deleteResult = await deleteBoxById(params.id, eventFetch);
    const outcome = decideDeleteOutcome(deleteResult);

    if (outcome.type === 'redirect') {
      redirect(303, '/boxes');
    }

    return fail(outcome.status || 400, { error: outcome.message });
  },

  /** 토큰 수동 갱신 액션 */
  refresh: async ({ params, fetch: eventFetch, locals }) => {
    if (!locals.user) {
      redirect(303, '/login');
    }

    const refreshResult = await refreshBoxTokens(params.id, eventFetch);
    const outcome = decideRefreshOutcome(refreshResult);

    if (outcome.type === 'ok') {
      return { success: true, box: outcome.box };
    }

    return fail(outcome.status || 500, { error: outcome.message });
  },
};
