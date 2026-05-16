/**
 * /boxes/[id]/models 전역 모델 관리 페이지 서버 로드.
 *
 * GET /api/boxes/:id/models -> models 반환.
 */

import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface ModelInfo {
  modelId: string;
  name: string;
  version?: string;
  createdAt?: number;
}

/**
 * 모델 목록 응답을 파싱한다 (순수 함수 — 테스트 가능).
 */
export function parseModelsResponse(
  body: unknown,
): { ok: true; models: ModelInfo[] } | { ok: false; error: string } {
  // 배열 직접 반환 또는 envelope { models: [...] } 둘 다 허용
  if (Array.isArray(body)) {
    return { ok: true, models: body as ModelInfo[] };
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    'models' in body &&
    Array.isArray((body as { models: unknown }).models)
  ) {
    return { ok: true, models: (body as { models: ModelInfo[] }).models };
  }
  return { ok: false, error: '모델 목록 응답 형식 오류' };
}

export const load: PageServerLoad = async ({ params, fetch: eventFetch, locals }) => {
  if (!locals.user) {
    redirect(303, '/login');
  }

  try {
    const res = await eventFetch(`/api/boxes/${params.id}/models`);
    if (res.status === 404) {
      error(404, 'Box를 찾을 수 없습니다');
    }
    if (!res.ok) {
      return {
        boxId: params.id,
        models: [],
        loadError: `모델 목록을 불러오지 못했습니다 (HTTP ${res.status})`,
      };
    }
    const body = (await res.json()) as unknown;
    const parsed = parseModelsResponse(body);
    if (!parsed.ok) {
      return { boxId: params.id, models: [], loadError: parsed.error };
    }
    return { boxId: params.id, models: parsed.models, loadError: null };
  } catch {
    return { boxId: params.id, models: [], loadError: '모델 목록 로드 중 오류가 발생했습니다' };
  }
};
