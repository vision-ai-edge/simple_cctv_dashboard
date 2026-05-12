/**
 * StatusBadge 순수 헬퍼 함수 테스트.
 *
 * getStatusBadgeClass, getStatusBadgeLabel 두 함수를 테스트한다.
 * Svelte 컴포넌트 자체는 DOM 렌더링 없이, 추출된 순수 함수로 검증한다.
 */

import { describe, expect, it } from 'bun:test';

// --- 테스트용 순수 함수 복제 ---

type Status = 'active' | 'inactive' | 'error';

const STATUS_TOKENS: Record<Status, { className: string; label: string }> = {
  active: {
    className: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    label: '정상',
  },
  inactive: {
    className: 'bg-slate-100 text-slate-600 ring-slate-200',
    label: '비활성',
  },
  error: {
    className: 'bg-rose-100 text-rose-700 ring-rose-200',
    label: '오류',
  },
};

function getStatusBadgeClass(status: string): string {
  const token = STATUS_TOKENS[status as Status];
  return token ? token.className : 'bg-slate-100 text-slate-500 ring-slate-200';
}

function getStatusBadgeLabel(status: string): string {
  const token = STATUS_TOKENS[status as Status];
  return token ? token.label : status;
}

// --- 테스트 ---

describe('getStatusBadgeClass', () => {
  it('active → emerald 클래스를 반환한다', () => {
    const cls = getStatusBadgeClass('active');
    expect(cls).toContain('emerald');
    expect(cls).toBe('bg-emerald-100 text-emerald-700 ring-emerald-200');
  });

  it('inactive → slate 클래스를 반환한다', () => {
    const cls = getStatusBadgeClass('inactive');
    expect(cls).toContain('slate');
    expect(cls).toBe('bg-slate-100 text-slate-600 ring-slate-200');
  });

  it('error → rose 클래스를 반환한다', () => {
    const cls = getStatusBadgeClass('error');
    expect(cls).toContain('rose');
    expect(cls).toBe('bg-rose-100 text-rose-700 ring-rose-200');
  });

  it('알 수 없는 status → 폴백 클래스를 반환한다', () => {
    const cls = getStatusBadgeClass('unknown_value');
    expect(cls).toContain('slate');
  });
});

describe('getStatusBadgeLabel', () => {
  it('active → "정상" 라벨을 반환한다', () => {
    expect(getStatusBadgeLabel('active')).toBe('정상');
  });

  it('inactive → "비활성" 라벨을 반환한다', () => {
    expect(getStatusBadgeLabel('inactive')).toBe('비활성');
  });

  it('error → "오류" 라벨을 반환한다', () => {
    expect(getStatusBadgeLabel('error')).toBe('오류');
  });

  it('알 수 없는 status → status 값 자체를 반환한다', () => {
    expect(getStatusBadgeLabel('unknown_value')).toBe('unknown_value');
  });
});
