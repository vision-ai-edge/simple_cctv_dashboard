// TAG: DASHBOARD-001
/**
 * cameras.ts API 헬퍼 단위 테스트.
 *
 * TDD RED-GREEN-REFACTOR 방식으로 순수 함수와 fetchCameras 를 검증한다.
 * 테스트 대상:
 *   1. fetchCameras — mock fetch 를 주입하여 성공/실패 케이스 검증
 *   2. partitionCameras — 좌표 보유 / 좌표 없음 분리 순수 함수
 *   3. getMarkerColor — 상태별 마커 색상 반환 순수 함수
 *
 * Leaflet DOM 테스트는 jsdom 이 Leaflet canvas/SVG 렌더링을 지원하지 않아
 * 불안정하므로 제외한다. CameraMap.svelte 는 브라우저 통합 테스트로 커버해야 한다.
 */

import { describe, expect, it } from 'bun:test';
import type { FetchLike } from '../../../lib/api/boxes';
import { fetchCameras, getMarkerColor, partitionCameras } from '../../../lib/api/cameras';
import type { CameraWithBox } from '../../../lib/types/dashboard';

// ---------------------------------------------------------------------------
// 테스트 픽스처
// ---------------------------------------------------------------------------

const makeCamera = (overrides: Partial<CameraWithBox> = {}): CameraWithBox => ({
  id: 'cam-001',
  channelId: 'ch-001',
  name: '카메라 A',
  status: 'online',
  latitude: 37.5665,
  longitude: 126.978,
  lastSyncedAt: Date.now(),
  boxId: 'box-001',
  boxName: 'Box A',
  boxStatus: 'active',
  ...overrides,
});

// ---------------------------------------------------------------------------
// fetchCameras — mock fetch 주입
// ---------------------------------------------------------------------------

describe('fetchCameras', () => {
  it('API 성공 시 cameras 배열을 반환한다', async () => {
    const cameras: CameraWithBox[] = [makeCamera()];
    const mockFetch = (async () =>
      ({
        ok: true,
        json: async () => ({ cameras }),
      }) as Response) as unknown as FetchLike;

    const result = await fetchCameras(mockFetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cameras).toHaveLength(1);
      expect(result.cameras[0].id).toBe('cam-001');
    }
  });

  it('빈 cameras 배열도 정상 반환된다', async () => {
    const mockFetch = (async () =>
      ({
        ok: true,
        json: async () => ({ cameras: [] }),
      }) as Response) as unknown as FetchLike;

    const result = await fetchCameras(mockFetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cameras).toHaveLength(0);
    }
  });

  it('HTTP 에러 응답 시 ok:false 와 에러 메시지를 반환한다', async () => {
    const mockFetch = (async () =>
      ({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      }) as Response) as unknown as FetchLike;

    const result = await fetchCameras(mockFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(401);
      expect(result.error.message).toContain('401');
    }
  });

  it('네트워크 에러(throw) 시 ok:false 와 status:0 을 반환한다', async () => {
    const mockFetch = (async (): Promise<Response> => {
      throw new Error('network error');
    }) as unknown as FetchLike;

    const result = await fetchCameras(mockFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(0);
      expect(result.error.message).toContain('네트워크');
    }
  });

  it('여러 카메라가 있을 때 모두 반환된다', async () => {
    const cameras: CameraWithBox[] = [
      makeCamera({ id: 'cam-001' }),
      makeCamera({ id: 'cam-002', latitude: null, longitude: null }),
      makeCamera({ id: 'cam-003', status: 'error' }),
    ];
    const mockFetch = (async () =>
      ({
        ok: true,
        json: async () => ({ cameras }),
      }) as Response) as unknown as FetchLike;

    const result = await fetchCameras(mockFetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cameras).toHaveLength(3);
    }
  });
});

// ---------------------------------------------------------------------------
// partitionCameras — geocoded / noCoord 분리
// ---------------------------------------------------------------------------

describe('partitionCameras', () => {
  it('좌표 보유 카메라는 geocoded 에 포함된다', () => {
    const cameras = [makeCamera({ latitude: 37.5, longitude: 126.9 })];
    const { geocoded, noCoord } = partitionCameras(cameras);
    expect(geocoded).toHaveLength(1);
    expect(noCoord).toHaveLength(0);
  });

  it('latitude null 카메라는 noCoord 에 포함된다', () => {
    const cameras = [makeCamera({ latitude: null, longitude: 126.9 })];
    const { geocoded, noCoord } = partitionCameras(cameras);
    expect(geocoded).toHaveLength(0);
    expect(noCoord).toHaveLength(1);
  });

  it('longitude null 카메라는 noCoord 에 포함된다', () => {
    const cameras = [makeCamera({ latitude: 37.5, longitude: null })];
    const { geocoded, noCoord } = partitionCameras(cameras);
    expect(geocoded).toHaveLength(0);
    expect(noCoord).toHaveLength(1);
  });

  it('latitude/longitude 모두 null 카메라는 noCoord 에 포함된다', () => {
    const cameras = [makeCamera({ latitude: null, longitude: null })];
    const { geocoded, noCoord } = partitionCameras(cameras);
    expect(geocoded).toHaveLength(0);
    expect(noCoord).toHaveLength(1);
  });

  it('빈 배열 시 모두 빈 배열을 반환한다', () => {
    const { geocoded, noCoord } = partitionCameras([]);
    expect(geocoded).toHaveLength(0);
    expect(noCoord).toHaveLength(0);
  });

  it('혼합된 카메라를 올바르게 분리한다', () => {
    const cameras = [
      makeCamera({ id: 'c1', latitude: 37.5, longitude: 126.9 }),
      makeCamera({ id: 'c2', latitude: null, longitude: null }),
      makeCamera({ id: 'c3', latitude: 35.1, longitude: 129.0 }),
      makeCamera({ id: 'c4', latitude: null, longitude: 127.0 }),
    ];
    const { geocoded, noCoord } = partitionCameras(cameras);
    expect(geocoded).toHaveLength(2);
    expect(noCoord).toHaveLength(2);
    expect(geocoded.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(noCoord.map((c) => c.id)).toEqual(['c2', 'c4']);
  });
});

// ---------------------------------------------------------------------------
// getMarkerColor — 상태별 마커 색상
// ---------------------------------------------------------------------------

describe('getMarkerColor', () => {
  it('online → 초록색 #16a34a 를 반환한다', () => {
    expect(getMarkerColor('online')).toBe('#16a34a');
  });

  it('offline → 회색 #6b7280 을 반환한다', () => {
    expect(getMarkerColor('offline')).toBe('#6b7280');
  });

  it('error → 빨간색 #dc2626 을 반환한다', () => {
    expect(getMarkerColor('error')).toBe('#dc2626');
  });
});
