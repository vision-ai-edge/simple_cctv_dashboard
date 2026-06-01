/**
 * /alerts 알림 히스토리 페이지 서버 로드.
 *
 * GET /api/alerts?limit=50&offset=0
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface AlertRecord {
  id: string;
  type: string;
  channelId: string;
  boxId: string;
  boxName?: string;
  firedAt: number;
  payload?: unknown;
}

export interface AlertPagination {
  total: number;
  limit: number;
  offset: number;
}

/**
 * 알림 히스토리 응답을 파싱한다 (순수 함수 — 테스트 가능).
 */
function parseAlertsResponse(body: unknown):
  | {
      ok: true;
      alerts: AlertRecord[];
      pagination: AlertPagination;
    }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: '응답 파싱 오류' };
  }
  const obj = body as Record<string, unknown>;
  const alerts = Array.isArray(obj.alerts) ? (obj.alerts as AlertRecord[]) : [];
  const rawPagination =
    typeof obj.pagination === 'object' && obj.pagination !== null
      ? (obj.pagination as Record<string, unknown>)
      : obj;
  const pagination: AlertPagination = {
    total: typeof rawPagination.total === 'number' ? rawPagination.total : 0,
    limit: typeof rawPagination.limit === 'number' ? rawPagination.limit : 50,
    offset: typeof rawPagination.offset === 'number' ? rawPagination.offset : 0,
  };
  return { ok: true, alerts, pagination };
}

export const load: PageServerLoad = async ({ fetch: eventFetch, locals, url }) => {
  if (!locals.user) {
    redirect(303, '/login');
  }

  const offset = Number(url.searchParams.get('offset') ?? '0');
  const limit = 50;

  try {
    const res = await eventFetch(`/api/alerts?limit=${limit}&offset=${offset}`);
    if (!res.ok) {
      return {
        alerts: [],
        pagination: { total: 0, limit, offset },
        loadError: `알림 목록을 불러오지 못했습니다 (HTTP ${res.status})`,
      };
    }
    const body = (await res.json()) as unknown;
    const parsed = parseAlertsResponse(body);
    if (!parsed.ok) {
      return {
        alerts: [],
        pagination: { total: 0, limit, offset },
        loadError: parsed.error,
      };
    }
    return {
      alerts: parsed.alerts,
      pagination: parsed.pagination,
      loadError: null,
    };
  } catch {
    return {
      alerts: [],
      pagination: { total: 0, limit, offset },
      loadError: '알림 목록 로드 중 오류가 발생했습니다',
    };
  }
};
