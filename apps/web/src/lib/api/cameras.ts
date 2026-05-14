// TAG: DASHBOARD-001
/**
 * 카메라 집계 API 클라이언트 헬퍼.
 *
 * GET /api/cameras 를 호출하여 CameraWithBox 목록을 반환한다.
 * FetchLike를 주입받아 서버(event.fetch) / 클라이언트(window.fetch) 양쪽에서 사용 가능하다.
 *
 * 보안 원칙: 응답에 Box 자격증명 미포함 (REQ-DASH-013 준수 — 서버 측에서 보장).
 */

import type { FetchLike } from './boxes';
import type { CameraWithBox } from '$lib/types/dashboard';

/** 카메라 API 에러 */
export interface CameraApiError {
  message: string;
  status: number;
}

/**
 * 카메라 목록 조회.
 * GET /api/cameras
 *
 * 실패 시 { ok: false, error } 를 반환하며 throw 하지 않는다.
 */
export async function fetchCameras(
  fetchImpl: FetchLike,
): Promise<{ ok: true; cameras: CameraWithBox[] } | { ok: false; error: CameraApiError }> {
  try {
    const res = await fetchImpl('/api/cameras');
    if (res.ok) {
      const data = (await res.json()) as { cameras: CameraWithBox[] };
      return { ok: true, cameras: data.cameras };
    }
    return {
      ok: false,
      error: { message: `카메라 목록 조회 실패 (${res.status})`, status: res.status },
    };
  } catch {
    return { ok: false, error: { message: '네트워크 오류가 발생했습니다', status: 0 } };
  }
}

/**
 * 카메라 배열을 좌표 보유(geocoded) / 좌표 없음(noCoord) 으로 분리하는 순수 함수.
 *
 * REQ-DASH-003 / REQ-DASH-004 / REQ-DASH-006 분기 로직.
 */
export function partitionCameras(cameras: CameraWithBox[]): {
  geocoded: CameraWithBox[];
  noCoord: CameraWithBox[];
} {
  const geocoded: CameraWithBox[] = [];
  const noCoord: CameraWithBox[] = [];
  for (const cam of cameras) {
    if (cam.latitude != null && cam.longitude != null) {
      geocoded.push(cam);
    } else {
      noCoord.push(cam);
    }
  }
  return { geocoded, noCoord };
}

/**
 * 카메라 상태에 따른 Leaflet 마커 색상 코드를 반환하는 순수 함수.
 *
 * REQ-DASH-004 마커 색상 기준:
 *   online  → 초록 #16a34a
 *   offline → 회색 #6b7280
 *   error   → 빨강 #dc2626
 */
export function getMarkerColor(status: CameraWithBox['status']): string {
  const colorMap: Record<CameraWithBox['status'], string> = {
    online: '#16a34a',
    offline: '#6b7280',
    error: '#dc2626',
  };
  return colorMap[status] ?? '#6b7280';
}
