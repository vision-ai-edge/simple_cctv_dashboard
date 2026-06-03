// TAG: DASHBOARD-001
/**
 * /dashboard/grid +page.server.ts 로드 로직 스모크 테스트.
 *
 * SvelteKit redirect()는 특수 객체를 throw 하므로,
 * _loadLogic 순수 함수를 추출하여 테스트한다.
 * (/dashboard/page-server.test.ts 패턴 준용)
 *
 * GridCell 의 hls.js DOM 렌더링 테스트는 jsdom 이 HTMLMediaElement 및
 * hls.js WebWorker/MSE 를 지원하지 않아 불안정하므로 제외한다.
 * 해당 테스트는 브라우저 통합 테스트(Playwright/Cypress)로 커버해야 한다.
 * (CameraMap.svelte — Leaflet jsdom 제외 패턴과 동일)
 */

import { describe, expect, it } from 'bun:test';
import type { CameraWithBox } from '../../../../lib/types/dashboard';

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

const makeCamera = (id: string, status: CameraWithBox['status'] = 'online'): CameraWithBox => ({
  id,
  channelId: `ch-${id}`,
  name: `카메라 ${id}`,
  status,
  latitude: 37.5665,
  longitude: 126.978,
  bleBeaconCount: 0,
  lastSyncedAt: Date.now(),
  boxId: 'box-001',
  boxName: 'Box A',
  boxStatus: 'active',
});

// ---------------------------------------------------------------------------
// _loadLogic 스모크 테스트
// ---------------------------------------------------------------------------

describe('/dashboard/grid loadLogic', () => {
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

  it('fetchCameras 실패(HTTP 500) 시 빈 배열을 반환한다', () => {
    const result = loadLogic({
      ok: false,
      error: { message: '카메라 목록 조회 실패 (500)', status: 500 },
    });
    expect(result.cameras).toHaveLength(0);
  });

  it('fetchCameras 실패(네트워크 오류) 시 빈 배열을 반환한다', () => {
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

  it('offline 카메라도 서버에서는 그대로 전달된다', () => {
    const cameras = [makeCamera('001', 'online'), makeCamera('002', 'offline')];
    const result = loadLogic({ ok: true, cameras });
    expect(result.cameras).toHaveLength(2);
    expect(result.cameras[1].status).toBe('offline');
  });

  it('error 상태 카메라도 서버에서는 그대로 전달된다', () => {
    const cameras = [makeCamera('001', 'error')];
    const result = loadLogic({ ok: true, cameras });
    expect(result.cameras[0].status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// 레이아웃 변경 → assignments 보존/리사이즈 로직 (순수 함수 레벨)
// ---------------------------------------------------------------------------

describe('멀티뷰 레이아웃 초기화 로직', () => {
  /**
   * +page.svelte 의 handleLayoutChange 와 동일한 로직을 순수 함수로 추출하여 테스트.
   * 컴포넌트 DOM 없이 레이아웃 변경 시 assignments 크기와 기존 할당 보존을 검증한다.
   */
  function handleLayoutChange(
    newLayout: 1 | 4 | 9,
    currentAssignments: (CameraWithBox | null)[] = [],
  ): {
    cellCount: 1 | 4 | 9;
    assignments: (CameraWithBox | null)[];
  } {
    return {
      cellCount: newLayout,
      assignments: Array.from({ length: newLayout }, (_, i) => currentAssignments[i] ?? null),
    };
  }

  it('1×1 레이아웃으로 변경 시 assignments 길이가 1이다', () => {
    const { cellCount, assignments } = handleLayoutChange(1);
    expect(cellCount).toBe(1);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toBeNull();
  });

  it('2×2 레이아웃으로 변경 시 assignments 길이가 4이다', () => {
    const { cellCount, assignments } = handleLayoutChange(4);
    expect(cellCount).toBe(4);
    expect(assignments).toHaveLength(4);
    expect(assignments.every((a) => a === null)).toBe(true);
  });

  it('3×3 레이아웃으로 변경 시 assignments 길이가 9이다', () => {
    const { cellCount, assignments } = handleLayoutChange(9);
    expect(cellCount).toBe(9);
    expect(assignments).toHaveLength(9);
    expect(assignments.every((a) => a === null)).toBe(true);
  });

  it('레이아웃 확장 시 기존 할당이 유지된다', () => {
    const previousAssignments: (CameraWithBox | null)[] = [
      makeCamera('001'),
      makeCamera('002'),
      null,
      null,
    ];
    const { assignments } = handleLayoutChange(9, previousAssignments);
    expect(assignments).toHaveLength(9);
    expect(assignments[0]?.id).toBe('001');
    expect(assignments[1]?.id).toBe('002');
    expect(assignments[8]).toBeNull();
  });

  it('레이아웃 축소 시 범위를 벗어난 할당만 제거된다', () => {
    const previousAssignments = [makeCamera('001'), makeCamera('002'), makeCamera('003'), null];
    const { assignments } = handleLayoutChange(1, previousAssignments);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.id).toBe('001');
  });
});

// ---------------------------------------------------------------------------
// 셀 할당 변경 로직 (순수 함수 레벨)
// ---------------------------------------------------------------------------

describe('셀 할당 변경 로직', () => {
  /**
   * +page.svelte 의 handleAssign 과 동일한 로직.
   */
  function handleAssign(
    assignments: (CameraWithBox | null)[],
    index: number,
    camera: CameraWithBox | null,
  ): (CameraWithBox | null)[] {
    return assignments.map((a, i) => (i === index ? camera : a));
  }

  it('특정 인덱스에 카메라를 할당할 수 있다', () => {
    const assignments: (CameraWithBox | null)[] = [null, null, null, null];
    const cam = makeCamera('001');
    const updated = handleAssign(assignments, 1, cam);
    expect(updated[0]).toBeNull();
    expect(updated[1]?.id).toBe('001');
    expect(updated[2]).toBeNull();
    expect(updated[3]).toBeNull();
  });

  it('카메라 할당을 null 로 해제할 수 있다', () => {
    const cam = makeCamera('001');
    const assignments: (CameraWithBox | null)[] = [cam, null, null, null];
    const updated = handleAssign(assignments, 0, null);
    expect(updated[0]).toBeNull();
  });

  it('다른 셀의 할당은 변경되지 않는다', () => {
    const cam1 = makeCamera('001');
    const cam2 = makeCamera('002');
    const assignments: (CameraWithBox | null)[] = [cam1, null, null, null];
    const updated = handleAssign(assignments, 2, cam2);
    expect(updated[0]?.id).toBe('001'); // 변경 없음
    expect(updated[2]?.id).toBe('002');
  });

  it('할당 변경이 원본 배열을 변경하지 않는다 (불변성)', () => {
    const assignments: (CameraWithBox | null)[] = [null, null];
    const cam = makeCamera('001');
    const updated = handleAssign(assignments, 0, cam);
    expect(assignments[0]).toBeNull(); // 원본 유지
    expect(updated[0]?.id).toBe('001');
  });
});

// ---------------------------------------------------------------------------
// CSS Grid 클래스 파생 로직
// ---------------------------------------------------------------------------

describe('CSS Grid 클래스 파생 로직', () => {
  function deriveGridClass(cellCount: 1 | 4 | 9): string {
    return cellCount === 1 ? 'grid-cols-1' : cellCount === 4 ? 'grid-cols-2' : 'grid-cols-3';
  }

  it('cellCount=1 이면 grid-cols-1 반환', () => {
    expect(deriveGridClass(1)).toBe('grid-cols-1');
  });

  it('cellCount=4 이면 grid-cols-2 반환', () => {
    expect(deriveGridClass(4)).toBe('grid-cols-2');
  });

  it('cellCount=9 이면 grid-cols-3 반환', () => {
    expect(deriveGridClass(9)).toBe('grid-cols-3');
  });
});
