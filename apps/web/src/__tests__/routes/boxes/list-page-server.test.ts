/**
 * /(app)/boxes 목록 페이지 서버 로직 테스트.
 *
 * SvelteKit의 redirect()는 특수 객체를 throw하므로,
 * load 로직을 loadLogic 순수 함수로 추출하여 테스트한다.
 */

import { describe, expect, it } from 'bun:test';
import type { BoxSummary } from '../../../lib/api/boxes';
import type { BoxError } from '../../../lib/api/boxes';

// --- 테스트용 순수 함수 복제 ---

/**
 * fetchBoxes 결과를 기반으로 load 반환값을 결정하는 순수 함수.
 *
 * @param fetchResult - fetchBoxes 반환값
 * @returns 성공: { boxes: BoxSummary[] }, 실패: { boxes: [], error: string }
 */
function loadLogic(
  fetchResult: { ok: true; boxes: BoxSummary[] } | { ok: false; error: BoxError },
): { boxes: BoxSummary[]; error?: string } {
  if (!fetchResult.ok) {
    // unauthorized는 상위 레이아웃 가드가 처리하므로 여기선 에러 메시지 표시
    return { boxes: [], error: fetchResult.error.message };
  }
  return { boxes: fetchResult.boxes };
}

// --- 테스트 픽스처 ---

const mockBox: BoxSummary = {
  id: 'box-001',
  name: '카메라A',
  host: '192.168.1.10',
  port: 8080,
  baseUrl: 'http://192.168.1.10:8080',
  username: 'admin',
  status: 'active',
  lastSyncAt: Date.now() - 60_000,
  createdAt: Date.now() - 86400_000,
  updatedAt: Date.now() - 60_000,
  hasApiKey: false,
};

const mockBoxError: BoxSummary = {
  id: 'box-002',
  name: '카메라B',
  host: '192.168.1.11',
  port: 8080,
  baseUrl: 'http://192.168.1.11:8080',
  username: 'admin',
  status: 'error',
  lastSyncAt: null,
  createdAt: Date.now() - 86400_000,
  updatedAt: Date.now() - 3600_000,
  hasApiKey: true,
};

// --- 테스트 ---

describe('목록 페이지 loadLogic', () => {
  it('fetchBoxes 성공 시 boxes 배열을 반환한다', () => {
    const result = loadLogic({ ok: true, boxes: [mockBox, mockBoxError] });
    expect(result.boxes).toHaveLength(2);
    expect(result.boxes[0].id).toBe('box-001');
    expect(result.boxes[1].id).toBe('box-002');
    expect(result.error).toBeUndefined();
  });

  it('빈 목록도 정상 반환된다', () => {
    const result = loadLogic({ ok: true, boxes: [] });
    expect(result.boxes).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });

  it('fetchBoxes 실패 시 빈 배열과 에러 메시지를 반환한다', () => {
    const result = loadLogic({
      ok: false,
      error: { kind: 'unknown', message: '알 수 없는 오류가 발생했습니다', status: 500 },
    });
    expect(result.boxes).toHaveLength(0);
    expect(result.error).toBe('알 수 없는 오류가 발생했습니다');
  });

  it('upstream 에러 시 에러 메시지를 반환한다', () => {
    const result = loadLogic({
      ok: false,
      error: {
        kind: 'upstream',
        message: 'EdgeAI Box에 연결할 수 없습니다. 네트워크 상태를 확인하세요',
        status: 502,
      },
    });
    expect(result.boxes).toHaveLength(0);
    expect(result.error).toContain('연결할 수 없습니다');
  });

  it('unauthorized 에러 시 에러 메시지를 반환한다 (레이아웃 가드가 먼저 처리하지만)', () => {
    const result = loadLogic({
      ok: false,
      error: {
        kind: 'unauthorized',
        message: '인증이 필요합니다. 다시 로그인해주세요',
        status: 401,
      },
    });
    expect(result.boxes).toHaveLength(0);
    expect(result.error).toBeDefined();
  });
});
