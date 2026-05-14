// TAG: BOX-CHANNELS-001
/**
 * 채널 API 클라이언트 헬퍼.
 *
 * 채널 관련 서버 API를 호출하는 순수 함수 모음.
 * FetchLike를 주입받아 서버/클라이언트 양쪽에서 사용 가능하다.
 * 보안: 모든 채널 요청은 자체 도메인(/api/boxes/...) 경유. 자격증명 미포함.
 */

import type { ChannelDto, ChannelSyncResult } from '$lib/types/channel';
import type { FetchLike } from './boxes';

/** 채널 API 에러 타입 */
export interface ChannelError {
  message: string;
  status: number;
}

/**
 * 채널 목록 조회.
 * GET /api/boxes/:boxId/channels
 */
export async function fetchChannels(
  boxId: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; channels: ChannelDto[] } | { ok: false; error: ChannelError }> {
  try {
    const res = await fetchImpl(`/api/boxes/${boxId}/channels`);
    if (res.ok) {
      const data = (await res.json()) as { channels: ChannelDto[] };
      return { ok: true, channels: data.channels };
    }
    return {
      ok: false,
      error: { message: `채널 목록 조회 실패 (${res.status})`, status: res.status },
    };
  } catch {
    return { ok: false, error: { message: '네트워크 오류가 발생했습니다', status: 0 } };
  }
}

/**
 * 채널 동기화 트리거.
 * POST /api/boxes/:boxId/channels/sync
 */
export async function syncChannels(
  boxId: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; result: ChannelSyncResult } | { ok: false; error: ChannelError }> {
  try {
    const res = await fetchImpl(`/api/boxes/${boxId}/channels/sync`, { method: 'POST' });
    if (res.ok) {
      const result = (await res.json()) as ChannelSyncResult;
      return { ok: true, result };
    }
    return {
      ok: false,
      error: { message: `채널 동기화 실패 (${res.status})`, status: res.status },
    };
  } catch {
    return { ok: false, error: { message: '네트워크 오류가 발생했습니다', status: 0 } };
  }
}

/**
 * 채널 활성화.
 * POST /api/boxes/:boxId/channels/:channelId/start
 */
export async function startChannel(
  boxId: string,
  channelId: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true } | { ok: false; error: ChannelError }> {
  try {
    const res = await fetchImpl(`/api/boxes/${boxId}/channels/${channelId}/start`, {
      method: 'POST',
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      error: { message: `채널 활성화 실패 (${res.status})`, status: res.status },
    };
  } catch {
    return { ok: false, error: { message: '네트워크 오류가 발생했습니다', status: 0 } };
  }
}

/**
 * 채널 비활성화.
 * POST /api/boxes/:boxId/channels/:channelId/stop
 */
export async function stopChannel(
  boxId: string,
  channelId: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true } | { ok: false; error: ChannelError }> {
  try {
    const res = await fetchImpl(`/api/boxes/${boxId}/channels/${channelId}/stop`, {
      method: 'POST',
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      error: { message: `채널 비활성화 실패 (${res.status})`, status: res.status },
    };
  } catch {
    return { ok: false, error: { message: '네트워크 오류가 발생했습니다', status: 0 } };
  }
}
