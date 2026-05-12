/**
 * StatusBadge 컴포넌트 순수 헬퍼 함수.
 *
 * status 값에 따른 Tailwind 클래스와 한국어 라벨을 반환한다.
 * 컴포넌트 밖으로 추출하여 단위 테스트 용이성을 확보한다.
 */

/** Box 상태 타입 */
export type Status = 'active' | 'inactive' | 'error';

/** 상태별 색상 토큰과 라벨 정의 */
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

/**
 * status 값에 해당하는 Tailwind 클래스 문자열을 반환한다.
 * 알 수 없는 status는 폴백 클래스를 반환한다.
 */
export function getStatusBadgeClass(status: string): string {
  const token = STATUS_TOKENS[status as Status];
  return token ? token.className : 'bg-slate-100 text-slate-500 ring-slate-200';
}

/**
 * status 값에 해당하는 한국어 라벨을 반환한다.
 * 알 수 없는 status는 status 값 자체를 반환한다.
 */
export function getStatusBadgeLabel(status: string): string {
  const token = STATUS_TOKENS[status as Status];
  return token ? token.label : status;
}
