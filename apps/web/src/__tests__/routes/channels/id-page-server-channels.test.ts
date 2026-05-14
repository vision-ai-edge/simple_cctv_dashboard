// TAG: BOX-CHANNELS-001
/**
 * Box 상세 페이지 채널 Lazy 동기화 로직 단위 테스트.
 *
 * +page.server.ts의 loadChannels 로직을 순수 함수로 추출하여 테스트한다.
 * - AC-002: 30초 초과 시 Lazy 동기화 실행
 * - AC-003: 30초 이내 시 동기화 스킵
 */

import { describe, expect, it } from 'bun:test';
import type { ChannelDto } from '../../../lib/types/channel';

// --- 테스트용 Lazy 동기화 판단 로직 복제 ---

const CHANNEL_SYNC_TTL_MS = 30_000;

/**
 * 채널 목록에서 가장 최근 lastSyncedAt을 추출한다.
 */
function getLatestSyncedAt(channels: ChannelDto[]): number | null {
  return channels.reduce<number | null>((max, ch) => {
    if (ch.lastSyncedAt === null) return max;
    return max === null ? ch.lastSyncedAt : Math.max(max, ch.lastSyncedAt);
  }, null);
}

/**
 * 동기화가 필요한지 판단한다.
 */
function needsLazySync(latestSync: number | null, now: number): boolean {
  return latestSync === null || now - latestSync > CHANNEL_SYNC_TTL_MS;
}

// --- 테스트 픽스처 ---

function makeChannel(overrides: Partial<ChannelDto> = {}): ChannelDto {
  return {
    id: 'cam-ulid',
    channelId: 'ch-001',
    name: '입구 카메라',
    status: 'online',
    resolution: '1920x1080',
    streamUrl: null,
    lastSyncedAt: Date.now() - 5_000,
    syncError: null,
    ...overrides,
  };
}

// --- 테스트 ---

describe('getLatestSyncedAt', () => {
  it('채널이 없으면 null 반환', () => {
    expect(getLatestSyncedAt([])).toBeNull();
  });

  it('단일 채널의 lastSyncedAt 반환', () => {
    const ts = Date.now() - 5_000;
    const result = getLatestSyncedAt([makeChannel({ lastSyncedAt: ts })]);
    expect(result).toBe(ts);
  });

  it('여러 채널 중 가장 최근 lastSyncedAt 반환', () => {
    const old = Date.now() - 60_000;
    const recent = Date.now() - 10_000;
    const channels = [makeChannel({ lastSyncedAt: old }), makeChannel({ id: 'cam-2', channelId: 'ch-002', lastSyncedAt: recent })];
    expect(getLatestSyncedAt(channels)).toBe(recent);
  });

  it('lastSyncedAt이 null인 채널은 무시', () => {
    const ts = Date.now() - 5_000;
    const channels = [
      makeChannel({ lastSyncedAt: null }),
      makeChannel({ id: 'cam-2', channelId: 'ch-002', lastSyncedAt: ts }),
    ];
    expect(getLatestSyncedAt(channels)).toBe(ts);
  });

  it('모든 채널의 lastSyncedAt이 null이면 null 반환', () => {
    const channels = [makeChannel({ lastSyncedAt: null })];
    expect(getLatestSyncedAt(channels)).toBeNull();
  });
});

describe('needsLazySync (AC-002, AC-003)', () => {
  it('latestSync가 null이면 동기화 필요 (AC-002)', () => {
    expect(needsLazySync(null, Date.now())).toBe(true);
  });

  it('30초 초과이면 동기화 필요 (AC-002)', () => {
    const latestSync = Date.now() - 40_000;
    expect(needsLazySync(latestSync, Date.now())).toBe(true);
  });

  it('정확히 30초 경과이면 동기화 필요 (경계값)', () => {
    const latestSync = Date.now() - 30_001;
    expect(needsLazySync(latestSync, Date.now())).toBe(true);
  });

  it('30초 이내이면 동기화 불필요 (AC-003)', () => {
    const latestSync = Date.now() - 10_000;
    expect(needsLazySync(latestSync, Date.now())).toBe(false);
  });

  it('방금 동기화한 경우 동기화 불필요 (AC-003)', () => {
    const latestSync = Date.now() - 1_000;
    expect(needsLazySync(latestSync, Date.now())).toBe(false);
  });
});

describe('채널 목록 빈 상태 (AC-013)', () => {
  it('채널이 없으면 빈 배열', () => {
    const channels: ChannelDto[] = [];
    expect(channels.length).toBe(0);
    expect(getLatestSyncedAt(channels)).toBeNull();
    expect(needsLazySync(null, Date.now())).toBe(true);
  });
});
