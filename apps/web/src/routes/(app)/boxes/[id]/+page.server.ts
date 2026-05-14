// TAG: BOX-CHANNELS-001
/**
 * /(app)/boxes/[id] 상세 페이지 서버 로드 및 액션.
 *
 * load: GET /api/boxes/:id → BoxSummary 반환. 404 시 SvelteKit error().
 *       채널 목록 Lazy 동기화 (REQ-CHAN-003): lastSyncedAt이 30초 초과 시 자동 동기화.
 * actions.delete: DELETE /api/boxes/:id → 성공 시 목록 페이지로 303 리다이렉트.
 * actions.refresh: POST /api/boxes/:id/refresh → 인라인 알림으로 결과 표시.
 *
 * REQ-UI-3 [Unwanted]: hasApiKey 불리언만 노출. 실제 JWT/API Key/password 미노출.
 */

import { deleteBoxById, fetchBox, refreshBoxTokens } from '$lib/api/boxes';
import type { BoxError, BoxSummary } from '$lib/api/boxes';
import { fetchChannels, syncChannels } from '$lib/api/channels';
import type { ChannelDto } from '$lib/types/channel';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// ---------------------------------------------------------------------------
// 순수 헬퍼 함수 (테스트 가능)
// ---------------------------------------------------------------------------

/**
 * fetchBox 결과를 기반으로 load 반환값 종류를 결정한다.
 */
export function _loadDetailLogic(
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
export function _decideDeleteOutcome(
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
export function _decideRefreshOutcome(
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

/** 채널 Lazy 동기화 TTL — 30초 (REQ-CHAN-003) */
const CHANNEL_SYNC_TTL_MS = 30_000;

/**
 * 채널 목록을 로드하고, 필요 시 Lazy 동기화를 실행한다 (REQ-CHAN-003).
 * 오류 격리: 채널 조회/동기화 실패가 Box 표시를 막지 않는다.
 */
async function loadChannels(
  boxId: string,
  eventFetch: typeof fetch,
): Promise<{ channels: ChannelDto[]; lastSyncedAt: number | null; channelError: string | null }> {
  try {
    const channelResult = await fetchChannels(boxId, eventFetch);
    if (!channelResult.ok) {
      return { channels: [], lastSyncedAt: null, channelError: channelResult.error.message };
    }

    const channels = channelResult.channels;

    // Lazy 동기화 판단: 채널이 없거나 마지막 동기화가 30초 초과인 경우
    const now = Date.now();
    const latestSync = channels.reduce<number | null>((max, ch) => {
      if (ch.lastSyncedAt === null) return max;
      return max === null ? ch.lastSyncedAt : Math.max(max, ch.lastSyncedAt);
    }, null);

    const needsSync = latestSync === null || now - latestSync > CHANNEL_SYNC_TTL_MS;

    if (needsSync) {
      await syncChannels(boxId, eventFetch);
      // 동기화 후 채널 목록 재조회
      const refreshed = await fetchChannels(boxId, eventFetch);
      if (refreshed.ok) {
        const newLatest = refreshed.channels.reduce<number | null>((max, ch) => {
          if (ch.lastSyncedAt === null) return max;
          return max === null ? ch.lastSyncedAt : Math.max(max, ch.lastSyncedAt);
        }, null);
        return { channels: refreshed.channels, lastSyncedAt: newLatest, channelError: null };
      }
    }

    return { channels, lastSyncedAt: latestSync, channelError: null };
  } catch {
    return { channels: [], lastSyncedAt: null, channelError: '채널 목록을 불러올 수 없습니다' };
  }
}

export const load: PageServerLoad = async ({ params, fetch: eventFetch, locals }) => {
  // REQ-UI-5: 미인증 접근 차단
  if (!locals.user) {
    redirect(303, '/login');
  }

  const fetchResult = await fetchBox(params.id, eventFetch);
  const outcome = _loadDetailLogic(fetchResult);

  if (outcome.type === 'notFound') {
    error(404, 'Box를 찾을 수 없습니다');
  }
  if (outcome.type === 'unauthorized') {
    redirect(303, '/login');
  }
  if (outcome.type === 'error') {
    // 그 외 에러 — 에러 메시지와 함께 렌더링 (채널 섹션 없이)
    return {
      box: null,
      loadError: outcome.message,
      channels: [],
      lastSyncedAt: null,
      channelError: null,
    };
  }

  // 채널 목록 Lazy 동기화 (REQ-CHAN-003) — 오류 격리
  const { channels, lastSyncedAt, channelError } = await loadChannels(params.id, eventFetch);

  return { box: outcome.box, loadError: null, channels, lastSyncedAt, channelError };
};

export const actions: Actions = {
  /** Box 삭제 액션 */
  delete: async ({ params, fetch: eventFetch, locals }) => {
    if (!locals.user) {
      redirect(303, '/login');
    }

    const deleteResult = await deleteBoxById(params.id, eventFetch);
    const outcome = _decideDeleteOutcome(deleteResult);

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
    const outcome = _decideRefreshOutcome(refreshResult);

    if (outcome.type === 'ok') {
      return { success: true, box: outcome.box };
    }

    return fail(outcome.status || 500, { error: outcome.message });
  },
};
