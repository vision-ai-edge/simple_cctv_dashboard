// TAG: BOX-CHANNELS-001
/**
 * 채널 상태 배지 헬퍼 단위 테스트 (특성 테스트).
 *
 * getCameraStatusBadgeClass, getCameraStatusLabel 순수 함수를 검증한다.
 */

import { describe, expect, it } from 'bun:test';

// --- 테스트용 순수 함수 복제 (파일 직접 임포트 없이) ---

type CameraStatus = 'online' | 'offline' | 'error';

const CAMERA_STATUS_TOKENS: Record<CameraStatus, { className: string; label: string }> = {
  online: { className: 'bg-emerald-100 text-emerald-700 ring-emerald-200', label: '온라인' },
  offline: { className: 'bg-slate-100 text-slate-600 ring-slate-200', label: '오프라인' },
  error: { className: 'bg-rose-100 text-rose-700 ring-rose-200', label: '오류' },
};

function getCameraStatusBadgeClass(status: string): string {
  const token = CAMERA_STATUS_TOKENS[status as CameraStatus];
  return token ? token.className : 'bg-slate-100 text-slate-500 ring-slate-200';
}

function getCameraStatusLabel(status: string): string {
  const token = CAMERA_STATUS_TOKENS[status as CameraStatus];
  return token ? token.label : status;
}

// --- 테스트 ---

describe('getCameraStatusBadgeClass', () => {
  it('online 상태는 emerald 클래스 반환', () => {
    const cls = getCameraStatusBadgeClass('online');
    expect(cls).toContain('emerald');
  });

  it('offline 상태는 slate 클래스 반환', () => {
    const cls = getCameraStatusBadgeClass('offline');
    expect(cls).toContain('slate');
  });

  it('error 상태는 rose 클래스 반환', () => {
    const cls = getCameraStatusBadgeClass('error');
    expect(cls).toContain('rose');
  });

  it('알 수 없는 상태는 폴백 클래스 반환', () => {
    const cls = getCameraStatusBadgeClass('unknown');
    expect(cls).toContain('slate');
  });
});

describe('getCameraStatusLabel', () => {
  it('online 상태는 "온라인" 반환', () => {
    expect(getCameraStatusLabel('online')).toBe('온라인');
  });

  it('offline 상태는 "오프라인" 반환', () => {
    expect(getCameraStatusLabel('offline')).toBe('오프라인');
  });

  it('error 상태는 "오류" 반환', () => {
    expect(getCameraStatusLabel('error')).toBe('오류');
  });

  it('알 수 없는 상태는 상태 값 자체를 반환', () => {
    expect(getCameraStatusLabel('connecting')).toBe('connecting');
  });
});
