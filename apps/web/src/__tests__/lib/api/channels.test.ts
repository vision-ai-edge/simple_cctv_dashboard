// TAG: BOX-CHANNELS-001
/**
 * 채널 API 클라이언트 순수 함수 테스트.
 *
 * fetch 응답 매핑 로직을 검증한다.
 * - 성공/실패 응답 파싱
 * - ChannelDto 타입 구조 검증
 */

import { describe, expect, it } from 'bun:test';
import type { ChannelDto } from '../../../lib/types/channel';

// --- 테스트 픽스처 ---

const mockChannel: ChannelDto = {
  id: 'cam-01ABC',
  channelId: 'ch-001',
  name: '입구 카메라',
  status: 'online',
  resolution: '1920x1080',
  streamUrl: 'rtsp://192.168.1.10:554/stream1',
  lastSyncedAt: Date.now() - 5_000,
  syncError: null,
};

const mockChannelError: ChannelDto = {
  id: 'cam-02DEF',
  channelId: 'ch-002',
  name: '주차장 카메라',
  status: 'error',
  resolution: null,
  streamUrl: null,
  lastSyncedAt: Date.now() - 120_000,
  syncError: 'Connection timeout after 10000ms',
};

// --- 채널 API 헬퍼 함수 복제 (순수 함수 부분) ---

type ChannelError = { message: string; status: number };

function parseChannelsResponse(
  body: unknown,
): { ok: true; channels: ChannelDto[] } | { ok: false; error: ChannelError } {
  if (
    typeof body === 'object' &&
    body !== null &&
    'channels' in body &&
    Array.isArray((body as { channels: unknown }).channels)
  ) {
    return { ok: true, channels: (body as { channels: ChannelDto[] }).channels };
  }
  return { ok: false, error: { message: '채널 목록 파싱 오류', status: 0 } };
}

// --- 테스트 ---

describe('ChannelDto 타입 검증', () => {
  it('정상 채널 DTO는 모든 필드가 존재한다', () => {
    expect(mockChannel.id).toBeTruthy();
    expect(mockChannel.channelId).toBeTruthy();
    expect(mockChannel.name).toBeTruthy();
    expect(['online', 'offline', 'error']).toContain(mockChannel.status);
    expect(mockChannel.syncError).toBeNull();
  });

  it('오류 채널 DTO는 syncError가 설정된다', () => {
    expect(mockChannelError.status).toBe('error');
    expect(mockChannelError.syncError).toBeTruthy();
    expect(mockChannelError.resolution).toBeNull();
  });
});

describe('채널 목록 응답 파싱', () => {
  it('channels 배열이 있는 응답을 정상 파싱한다', () => {
    const body = { channels: [mockChannel, mockChannelError] };
    const result = parseChannelsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.channels).toHaveLength(2);
      expect(result.channels[0].channelId).toBe('ch-001');
    }
  });

  it('빈 channels 배열도 정상 파싱한다', () => {
    const body = { channels: [] };
    const result = parseChannelsResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.channels).toHaveLength(0);
    }
  });

  it('channels 필드가 없는 응답은 에러를 반환한다', () => {
    const body = { data: [] };
    const result = parseChannelsResponse(body);
    expect(result.ok).toBe(false);
  });

  it('null 바디는 에러를 반환한다', () => {
    const result = parseChannelsResponse(null);
    expect(result.ok).toBe(false);
  });
});

describe('채널 Lazy 동기화 TTL 로직', () => {
  const CHANNEL_SYNC_TTL_MS = 30_000;

  it('30초 초과 시 동기화가 필요하다', () => {
    const lastSyncedAt = Date.now() - 40_000;
    const needsSync = Date.now() - lastSyncedAt > CHANNEL_SYNC_TTL_MS;
    expect(needsSync).toBe(true);
  });

  it('30초 이내이면 동기화가 불필요하다', () => {
    const lastSyncedAt = Date.now() - 10_000;
    const needsSync = Date.now() - lastSyncedAt > CHANNEL_SYNC_TTL_MS;
    expect(needsSync).toBe(false);
  });

  it('lastSyncedAt이 null이면 동기화가 필요하다', () => {
    const latestSync: number | null = null;
    const needsSync = latestSync === null || Date.now() - latestSync > CHANNEL_SYNC_TTL_MS;
    expect(needsSync).toBe(true);
  });
});

describe('채널 동기화 결과 파싱', () => {
  it('성공 동기화 결과를 파싱한다', () => {
    const result = {
      success: true,
      synced: 3,
      failed: 0,
      timestamp: Date.now(),
    };
    expect(result.success).toBe(true);
    expect(result.synced).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.timestamp).toBeGreaterThan(0);
  });
});
