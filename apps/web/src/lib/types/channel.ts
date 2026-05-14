// TAG: BOX-CHANNELS-001
/**
 * 채널 관련 타입 정의.
 *
 * 백엔드 GET /api/boxes/:id/channels 응답의 channels 배열 원소 타입.
 * CameraStatus는 SPEC 도메인 정의의 ChannelStatus → CameraStatus 변환 결과.
 */

/** 카메라 상태 타입 (DB의 CameraStatus ENUM) */
export type CameraStatus = 'online' | 'offline' | 'error';

/** 채널 DTO — 백엔드 응답과 1:1 매핑 */
export interface ChannelDto {
  /** DB의 cameras.id (ULID) */
  id: string;
  /** EdgeAI Box의 채널 식별자 */
  channelId: string;
  /** 채널 이름 */
  name: string;
  /** 카메라 상태 (CameraStatus 기준) */
  status: CameraStatus;
  /** 해상도 (nullable) */
  resolution: string | null;
  /** RTSP 스트림 URL (nullable) */
  streamUrl: string | null;
  /** 마지막 동기화 성공 시각 (Unix ms, nullable) */
  lastSyncedAt: number | null;
  /** 마지막 동기화 오류 메시지 (nullable) */
  syncError: string | null;
}

/** 채널 동기화 응답 타입 */
export interface ChannelSyncResult {
  success: boolean;
  synced: number;
  failed: number;
  timestamp: number;
}
