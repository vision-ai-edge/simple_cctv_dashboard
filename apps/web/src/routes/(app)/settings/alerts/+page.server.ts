/**
 * /settings/alerts 알림 설정 페이지 서버 로드.
 *
 * GET /api/alerts/destinations -> destinations 반환.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface DestinationConfig {
  channel: string;
  enabled: boolean;
  config?: Record<string, string>;
}

/**
 * destinations 응답을 파싱한다 (순수 함수 — 테스트 가능).
 */
function parseDestinationsResponse(
  body: unknown,
): { ok: true; destinations: DestinationConfig[] } | { ok: false; error: string } {
  if (
    typeof body === 'object' &&
    body !== null &&
    'destinations' in body &&
    Array.isArray((body as { destinations: unknown }).destinations)
  ) {
    return {
      ok: true,
      destinations: (body as { destinations: DestinationConfig[] }).destinations,
    };
  }
  // destinations 필드가 없으면 빈 배열 반환
  return { ok: true, destinations: [] };
}

export const load: PageServerLoad = async ({ fetch: eventFetch, locals }) => {
  if (!locals.user) {
    redirect(303, '/login');
  }

  try {
    const res = await eventFetch('/api/alerts/destinations');
    if (!res.ok) {
      return {
        destinations: [],
        loadError: `알림 설정을 불러오지 못했습니다 (HTTP ${res.status})`,
      };
    }
    const body = (await res.json()) as unknown;
    const parsed = parseDestinationsResponse(body);
    if (!parsed.ok) {
      return { destinations: [], loadError: parsed.error };
    }
    return { destinations: parsed.destinations, loadError: null };
  } catch {
    return { destinations: [], loadError: '알림 설정 로드 중 오류가 발생했습니다' };
  }
};
