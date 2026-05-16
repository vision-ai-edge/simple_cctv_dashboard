/**
 * /(app)/alerts 알림 히스토리 페이지 서버 로직 테스트.
 *
 * parseAlertsResponse 순수 함수를 로직 복제하여 검증한다.
 * (+page.server.ts는 @sveltejs/kit 의존으로 직접 import 불가)
 */

import { describe, expect, it } from 'bun:test';

// --- 타입 복제 ---

interface AlertRecord {
  id: string;
  type: string;
  channelId: string;
  boxId: string;
  boxName?: string;
  firedAt: number;
  payload?: unknown;
}

interface AlertPagination {
  total: number;
  limit: number;
  offset: number;
}

// --- 순수 함수 복제 ---

function parseAlertsResponse(body: unknown): {
  ok: true;
  alerts: AlertRecord[];
  pagination: AlertPagination;
} | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: '응답 파싱 오류' };
  }
  const obj = body as Record<string, unknown>;
  const alerts = Array.isArray(obj.alerts) ? (obj.alerts as AlertRecord[]) : [];
  const pagination: AlertPagination = {
    total: typeof obj.total === 'number' ? obj.total : 0,
    limit: typeof obj.limit === 'number' ? obj.limit : 50,
    offset: typeof obj.offset === 'number' ? obj.offset : 0,
  };
  return { ok: true, alerts, pagination };
}

// --- 테스트 픽스처 ---

const mockAlert: AlertRecord = {
  id: 'alert-001',
  type: 'person_detected',
  channelId: 'ch-001',
  boxId: 'box-001',
  firedAt: 1700000000000,
};

// --- 테스트 ---

describe('parseAlertsResponse', () => {
  it('alerts 배열과 페이지네이션이 있는 응답을 파싱한다', () => {
    const body = {
      alerts: [mockAlert],
      total: 100,
      limit: 50,
      offset: 0,
    };
    const result = parseAlertsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].id).toBe('alert-001');
      expect(result.pagination.total).toBe(100);
      expect(result.pagination.limit).toBe(50);
      expect(result.pagination.offset).toBe(0);
    }
  });

  it('빈 alerts 배열도 파싱한다', () => {
    const body = { alerts: [], total: 0, limit: 50, offset: 0 };
    const result = parseAlertsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alerts).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    }
  });

  it('alerts 필드가 없어도 빈 배열로 처리한다', () => {
    const body = { total: 0, limit: 50, offset: 0 };
    const result = parseAlertsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alerts).toHaveLength(0);
    }
  });

  it('페이지네이션 필드가 없으면 기본값 0으로 처리한다', () => {
    const body = { alerts: [mockAlert] };
    const result = parseAlertsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.limit).toBe(50);
      expect(result.pagination.offset).toBe(0);
    }
  });

  it('null 바디는 에러를 반환한다', () => {
    const result = parseAlertsResponse(null);
    expect(result.ok).toBe(false);
  });

  it('문자열 바디는 에러를 반환한다', () => {
    const result = parseAlertsResponse('string');
    expect(result.ok).toBe(false);
  });

  it('여러 알림이 있는 경우 모두 반환한다', () => {
    const alerts: AlertRecord[] = [
      { ...mockAlert, id: 'alert-001' },
      { ...mockAlert, id: 'alert-002', type: 'vehicle_detected' },
      { ...mockAlert, id: 'alert-003', channelId: 'ch-002' },
    ];
    const body = { alerts, total: 3, limit: 50, offset: 0 };
    const result = parseAlertsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alerts).toHaveLength(3);
    }
  });

  it('페이지네이션 offset이 정확히 반환된다', () => {
    const body = { alerts: [], total: 200, limit: 50, offset: 50 };
    const result = parseAlertsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pagination.offset).toBe(50);
    }
  });
});
