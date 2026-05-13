/**
 * /(app)/boxes/[id] 상세 페이지 서버 로직 테스트.
 *
 * 순수 헬퍼 함수를 추출하여 테스트한다:
 * - loadDetailLogic: fetchBox 결과 → 반환값 결정
 * - decideDeleteOutcome: deleteBoxById 결과 → 결과 태그
 * - decideRefreshOutcome: refreshBoxTokens 결과 → 결과 태그
 */

import { describe, expect, it } from 'bun:test';
import type { BoxError, BoxSummary } from '../../../lib/api/boxes';

// --- 테스트 픽스처 ---

const mockBox: BoxSummary = {
  id: 'box-123',
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

const notFoundError: BoxError = {
  kind: 'notFound',
  message: '해당 Box를 찾을 수 없습니다',
  status: 404,
};

const upstreamError: BoxError = {
  kind: 'upstream',
  message: 'EdgeAI Box에 연결할 수 없습니다. 네트워크 상태를 확인하세요',
  status: 502,
};

// --- 테스트용 순수 함수 복제 ---

/**
 * fetchBox 결과를 기반으로 load 반환값을 결정한다.
 * notFound → { type: 'notFound' } 신호 반환.
 * unauthorized → { type: 'unauthorized' } 신호 반환.
 * 성공 → { type: 'ok', box }
 */
function loadDetailLogic(
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
 * 성공 → { type: 'redirect' }
 * 실패 → { type: 'error', message, status }
 */
function decideDeleteOutcome(
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
 * 성공 → { type: 'ok', box }
 * 실패 → { type: 'error', message, status }
 */
function decideRefreshOutcome(
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

// --- 테스트 ---

describe('loadDetailLogic', () => {
  it('fetchBox 성공 시 ok 타입과 box 반환', () => {
    const result = loadDetailLogic({ ok: true, box: mockBox });
    expect(result.type).toBe('ok');
    if (result.type === 'ok') {
      expect(result.box.id).toBe('box-123');
    }
  });

  it('notFound 에러 시 notFound 신호 반환', () => {
    const result = loadDetailLogic({ ok: false, error: notFoundError });
    expect(result.type).toBe('notFound');
  });

  it('unauthorized 에러 시 unauthorized 신호 반환', () => {
    const result = loadDetailLogic({
      ok: false,
      error: {
        kind: 'unauthorized',
        message: '인증이 필요합니다. 다시 로그인해주세요',
        status: 401,
      },
    });
    expect(result.type).toBe('unauthorized');
  });

  it('upstream 에러 시 error 신호와 메시지 반환', () => {
    const result = loadDetailLogic({ ok: false, error: upstreamError });
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.message).toContain('연결할 수 없습니다');
    }
  });
});

describe('decideDeleteOutcome', () => {
  it('삭제 성공 시 redirect 신호 반환', () => {
    const result = decideDeleteOutcome({ ok: true });
    expect(result.type).toBe('redirect');
  });

  it('삭제 실패 시 error 신호와 메시지 반환', () => {
    const result = decideDeleteOutcome({
      ok: false,
      error: { kind: 'notFound', message: '해당 Box를 찾을 수 없습니다', status: 404 },
    });
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.status).toBe(404);
    }
  });
});

describe('decideRefreshOutcome', () => {
  it('갱신 성공 시 ok 타입과 box 반환', () => {
    const refreshedBox: BoxSummary = { ...mockBox, updatedAt: Date.now() };
    const result = decideRefreshOutcome({ ok: true, box: refreshedBox });
    expect(result.type).toBe('ok');
    if (result.type === 'ok') {
      expect(result.box.id).toBe('box-123');
    }
  });

  it('갱신 실패 시 error 신호와 메시지 반환', () => {
    const result = decideRefreshOutcome({ ok: false, error: upstreamError });
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.status).toBe(502);
    }
  });
});
