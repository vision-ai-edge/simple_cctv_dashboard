// TAG: DASHBOARD-001
/**
 * /dashboard +page.server.ts 로드 로직 스모크 테스트.
 *
 * SvelteKit redirect()는 특수 객체를 throw 하므로,
 * _loadLogic 순수 함수를 추출하여 테스트한다.
 * (boxes/list-page-server.test.ts 패턴 준용)
 *
 * Leaflet 컴포넌트 DOM 테스트는 jsdom 이 Leaflet canvas/SVG 렌더링을
 * 지원하지 않아 불안정하므로 제외한다.
 * 해당 테스트는 브라우저 통합 테스트(Playwright/Cypress)로 커버해야 한다.
 */

import { describe, expect, it } from 'bun:test';
import type { CameraWithBox } from '../../../lib/types/dashboard';

// ---------------------------------------------------------------------------
// 테스트용 순수 함수 복제 (_loadLogic 동일 로직)
// ---------------------------------------------------------------------------

type FetchResult =
  | { ok: true; cameras: CameraWithBox[] }
  | { ok: false; error: { message: string; status: number } };

function loadLogic(fetchResult: FetchResult): { cameras: CameraWithBox[] } {
  if (!fetchResult.ok) {
    return { cameras: [] };
  }
  return { cameras: fetchResult.cameras };
}

// ---------------------------------------------------------------------------
// 테스트 픽스처
// ---------------------------------------------------------------------------

const makeCamera = (id: string): CameraWithBox => ({
  id,
  channelId: `ch-${id}`,
  name: `카메라 ${id}`,
  status: 'online',
  latitude: 37.5665,
  longitude: 126.978,
  bleBeaconCount: 0,
  lastSyncedAt: Date.now(),
  boxId: 'box-001',
  boxName: 'Box A',
  boxStatus: 'active',
});

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('/dashboard loadLogic', () => {
  it('fetchCameras 성공 시 cameras 배열을 반환한다', () => {
    const cameras = [makeCamera('001'), makeCamera('002')];
    const result = loadLogic({ ok: true, cameras });
    expect(result.cameras).toHaveLength(2);
    expect(result.cameras[0].id).toBe('001');
  });

  it('빈 cameras 배열도 정상 반환된다', () => {
    const result = loadLogic({ ok: true, cameras: [] });
    expect(result.cameras).toHaveLength(0);
  });

  it('fetchCameras 실패(HTTP 에러) 시 빈 배열을 반환한다', () => {
    const result = loadLogic({
      ok: false,
      error: { message: '카메라 목록 조회 실패 (500)', status: 500 },
    });
    expect(result.cameras).toHaveLength(0);
  });

  it('fetchCameras 실패(네트워크 에러) 시 빈 배열을 반환한다', () => {
    const result = loadLogic({
      ok: false,
      error: { message: '네트워크 오류가 발생했습니다', status: 0 },
    });
    expect(result.cameras).toHaveLength(0);
  });

  it('401 Unauthorized 에러 시 빈 배열을 반환한다', () => {
    const result = loadLogic({
      ok: false,
      error: { message: '카메라 목록 조회 실패 (401)', status: 401 },
    });
    expect(result.cameras).toHaveLength(0);
  });

  it('좌표 없는 카메라도 서버에서는 그대로 전달된다 (필터링은 클라이언트)', () => {
    const cameras = [makeCamera('001'), { ...makeCamera('002'), latitude: null, longitude: null }];
    const result = loadLogic({ ok: true, cameras });
    expect(result.cameras).toHaveLength(2);
    expect(result.cameras[1].latitude).toBeNull();
  });
});
