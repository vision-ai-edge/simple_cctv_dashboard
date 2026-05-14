// TAG: DASHBOARD-001
/**
 * /dashboard/grid 서버 로드 함수.
 *
 * GET /api/cameras 를 호출하여 카메라 목록을 페이지에 전달한다.
 * /dashboard/+page.server.ts 와 동일한 패턴 (REQ-DASH-007).
 *
 * 실패 시 빈 배열 반환 + 콘솔 경고.
 * 인증 가드: (app)/+layout.server.ts 에서 처리.
 */

import { fetchCameras } from '$lib/api/cameras';
import type { CameraWithBox } from '$lib/types/dashboard';
import type { PageServerLoad } from './$types';

/**
 * fetchCameras 결과를 기반으로 load 반환값을 결정하는 순수 함수.
 * SvelteKit redirect throw 를 피하기 위해 추출 (테스트 용이성).
 */
export function _loadLogic(
  fetchResult:
    | { ok: true; cameras: CameraWithBox[] }
    | { ok: false; error: { message: string; status: number } },
): { cameras: CameraWithBox[] } {
  if (!fetchResult.ok) {
    return { cameras: [] };
  }
  return { cameras: fetchResult.cameras };
}

export const load: PageServerLoad = async ({ fetch: eventFetch }) => {
  const fetchResult = await fetchCameras(eventFetch);

  if (!fetchResult.ok) {
    console.warn('[dashboard/grid] GET /api/cameras 실패:', fetchResult.error.message);
  }

  return _loadLogic(fetchResult);
};
