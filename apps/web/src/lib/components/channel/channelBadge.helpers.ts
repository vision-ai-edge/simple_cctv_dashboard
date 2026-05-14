// TAG: BOX-CHANNELS-001
/**
 * 채널 상태 배지 헬퍼 함수.
 *
 * CameraStatus에 따른 Tailwind 클래스와 한국어 라벨을 반환한다.
 * SPEC-BOX-UI-001 StatusBadge 디자인 토큰 준수.
 */

import type { CameraStatus } from '$lib/types/channel';

/** 상태별 색상 토큰과 라벨 정의 */
const CAMERA_STATUS_TOKENS: Record<CameraStatus, { className: string; label: string }> = {
  online: {
    className: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    label: '온라인',
  },
  offline: {
    className: 'bg-slate-100 text-slate-600 ring-slate-200',
    label: '오프라인',
  },
  error: {
    className: 'bg-rose-100 text-rose-700 ring-rose-200',
    label: '오류',
  },
};

/**
 * CameraStatus에 해당하는 Tailwind 클래스 문자열을 반환한다.
 */
export function getCameraStatusBadgeClass(status: string): string {
  const token = CAMERA_STATUS_TOKENS[status as CameraStatus];
  return token ? token.className : 'bg-slate-100 text-slate-500 ring-slate-200';
}

/**
 * CameraStatus에 해당하는 한국어 라벨을 반환한다.
 */
export function getCameraStatusLabel(status: string): string {
  const token = CAMERA_STATUS_TOKENS[status as CameraStatus];
  return token ? token.label : status;
}
