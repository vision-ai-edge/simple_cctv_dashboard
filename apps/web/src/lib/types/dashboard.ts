// TAG: DASHBOARD-001
/**
 * 대시보드 도메인 타입 정의.
 *
 * apps/api/src/routes/cameras.ts 의 CameraWithBox 응답 스키마와 일치해야 한다.
 * REQ-DASH-002 응답 필드 기준.
 */

/**
 * cameras JOIN boxes 집계 응답 항목 (프론트엔드 타입).
 *
 * 절대 포함하지 않는 컬럼 (REQ-DASH-013):
 *   password_enc, jwt_cached_enc, api_key_cached_enc
 */
export interface CameraWithBox {
  /** cameras.id (PK) */
  id: string;
  /** cameras.channel_id */
  channelId: string;
  /** cameras.name */
  name: string;
  /** 카메라 상태 */
  status: 'online' | 'offline' | 'error';
  /** 위도 — null이면 사이드바로 분류 */
  latitude: number | null;
  /** 경도 — null이면 사이드바로 분류 */
  longitude: number | null;
  /** 주변에서 감지된 BLE 비컨 신호 개수 */
  bleBeaconCount: number;
  /** 마지막 동기화 시각 (Unix ms) */
  lastSyncedAt: number | null;
  /** cameras.box_id */
  boxId: string;
  /** boxes.name */
  boxName: string;
  /** boxes.status */
  boxStatus: 'active' | 'inactive' | 'error';
}
