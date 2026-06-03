/**
 * /(app)/settings/alerts 알림 설정 페이지 서버 로직 테스트.
 *
 * parseDestinationsResponse 순수 함수를 로직 복제하여 검증한다.
 * (+page.server.ts는 @sveltejs/kit 의존으로 직접 import 불가)
 */

import { describe, expect, it } from 'bun:test';

// --- 타입 복제 ---

interface DestinationConfig {
  channel: string;
  enabled: boolean;
  config?: Record<string, string>;
}

// --- 순수 함수 복제 ---

function parseDestinationsResponse(
  body: unknown,
): { ok: true; destinations: DestinationConfig[] } | { ok: false; error: string } {
  if (
    typeof body === 'object' &&
    body !== null &&
    'destinations' in body &&
    Array.isArray((body as { destinations: unknown }).destinations)
  ) {
    return {
      ok: true,
      destinations: (body as { destinations: DestinationConfig[] }).destinations,
    };
  }
  // destinations 필드가 없으면 빈 배열 반환
  return { ok: true, destinations: [] };
}

// --- 테스트 픽스처 ---

const mockToastDestination: DestinationConfig = {
  channel: 'toast',
  enabled: true,
  config: {},
};

const mockTelegramDestination: DestinationConfig = {
  channel: 'telegram',
  enabled: false,
  config: { chat_id: '-1001234567890' },
};

const mockWebpushDestination: DestinationConfig = {
  channel: 'webpush',
  enabled: true,
  config: {},
};

// --- 테스트 ---

describe('parseDestinationsResponse', () => {
  it('destinations 배열이 있는 응답을 파싱한다', () => {
    const body = {
      destinations: [mockToastDestination, mockTelegramDestination, mockWebpushDestination],
    };
    const result = parseDestinationsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.destinations).toHaveLength(3);
    }
  });

  it('각 채널의 enabled 상태가 정확히 파싱된다', () => {
    const body = { destinations: [mockToastDestination, mockTelegramDestination] };
    const result = parseDestinationsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const toast = result.destinations.find((d) => d.channel === 'toast');
      const telegram = result.destinations.find((d) => d.channel === 'telegram');
      expect(toast?.enabled).toBe(true);
      expect(telegram?.enabled).toBe(false);
    }
  });

  it('Telegram config에 chat_id가 포함된다', () => {
    const body = { destinations: [mockTelegramDestination] };
    const result = parseDestinationsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const telegram = result.destinations.find((d) => d.channel === 'telegram');
      expect(telegram?.config?.['chat_id']).toBe('-1001234567890');
    }
  });

  it('빈 destinations 배열도 정상 파싱한다', () => {
    const body = { destinations: [] };
    const result = parseDestinationsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.destinations).toHaveLength(0);
    }
  });

  it('destinations 필드가 없으면 빈 배열을 반환한다', () => {
    const body = {};
    const result = parseDestinationsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.destinations).toHaveLength(0);
    }
  });

  it('null 바디에 대해 빈 배열을 반환한다', () => {
    const result = parseDestinationsResponse(null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.destinations).toHaveLength(0);
    }
  });

  it('destinations가 배열이 아닌 경우 빈 배열을 반환한다', () => {
    const body = { destinations: 'not-an-array' };
    const result = parseDestinationsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.destinations).toHaveLength(0);
    }
  });

  it('세 채널 모두 있는 경우 각각 파싱된다', () => {
    const body = {
      destinations: [mockToastDestination, mockWebpushDestination, mockTelegramDestination],
    };
    const result = parseDestinationsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const channels = result.destinations.map((d) => d.channel);
      expect(channels).toContain('toast');
      expect(channels).toContain('webpush');
      expect(channels).toContain('telegram');
    }
  });
});
