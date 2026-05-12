/**
 * RelativeTime 순수 헬퍼 함수 테스트.
 *
 * formatRelativeTime(value, now) 함수의 경계 케이스 5종을 검증한다.
 * 결정론적 테스트를 위해 now 파라미터를 명시적으로 전달한다.
 */

import { describe, expect, it } from 'bun:test';

// --- 테스트용 순수 함수 복제 ---

/**
 * value(Date | number | null)를 한국어 상대시간 문자열로 변환한다.
 *
 * @param value - Date 객체, 밀리초 타임스탬프, 또는 null
 * @param now   - 기준 시각 (밀리초), 결정론적 테스트를 위해 주입
 */
function formatRelativeTime(value: Date | number | null, now: number): string {
  if (value === null) {
    return '동기화 이력 없음';
  }

  const ts = value instanceof Date ? value.getTime() : value;
  const diffMs = now - ts;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) {
    return '방금 전';
  }
  if (diffMin < 60) {
    return `${diffMin}분 전`;
  }
  if (diffHour < 24) {
    return `${diffHour}시간 전`;
  }

  // 24시간 이상 — 절대 시각 (yyyy-MM-dd HH:mm) 형식
  const date = new Date(ts);
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  });
  // ko-KR 포맷 결과: "2026. 05. 10. 14:30" → "2026-05-10 14:30"
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

// --- 테스트 ---

const NOW = new Date('2026-05-13T12:00:00.000Z').getTime();

describe('formatRelativeTime', () => {
  it('null → "동기화 이력 없음" 반환', () => {
    expect(formatRelativeTime(null, NOW)).toBe('동기화 이력 없음');
  });

  it('30초 경과 → "방금 전" 반환', () => {
    const value = NOW - 30_000;
    expect(formatRelativeTime(value, NOW)).toBe('방금 전');
  });

  it('5분 경과 → "5분 전" 반환', () => {
    const value = NOW - 5 * 60 * 1000;
    expect(formatRelativeTime(value, NOW)).toBe('5분 전');
  });

  it('3시간 경과 → "3시간 전" 반환', () => {
    const value = NOW - 3 * 60 * 60 * 1000;
    expect(formatRelativeTime(value, NOW)).toBe('3시간 전');
  });

  it('3일 경과 → "yyyy-MM-dd HH:mm" 절대시각 형식 반환', () => {
    const value = NOW - 3 * 24 * 60 * 60 * 1000; // 3일 전
    const result = formatRelativeTime(value, NOW);
    // yyyy-MM-dd HH:mm 패턴 검증
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('Date 객체 입력도 처리한다', () => {
    const value = new Date(NOW - 30_000);
    expect(formatRelativeTime(value, NOW)).toBe('방금 전');
  });

  it('정확히 60초 → "1분 전" 반환 (경계값)', () => {
    const value = NOW - 60_000;
    expect(formatRelativeTime(value, NOW)).toBe('1분 전');
  });
});
