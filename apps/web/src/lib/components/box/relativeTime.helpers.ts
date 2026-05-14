/**
 * RelativeTime 컴포넌트 순수 헬퍼 함수.
 *
 * Date | number | null 값을 한국어 상대시간 문자열로 변환한다.
 * 결정론적 테스트를 위해 now 파라미터를 주입받는 설계를 채택한다.
 */

/**
 * value를 한국어 상대시간 문자열로 변환한다.
 *
 * 경과 시간별 규칙:
 * - null              → "동기화 이력 없음"
 * - 60초 미만         → "방금 전"
 * - 60분 미만         → "n분 전"
 * - 24시간 미만       → "n시간 전"
 * - 24시간 이상       → "yyyy-MM-dd HH:mm" (Asia/Seoul 기준)
 *
 * @param value - Date 객체, 밀리초 타임스탬프, 또는 null
 * @param now   - 기준 시각 (밀리초), 기본값은 Date.now()
 */
export function formatRelativeTime(
  value: Date | number | string | null | undefined,
  now: number = Date.now(),
): string {
  if (value === null || value === undefined) {
    return '동기화 이력 없음';
  }

  const ts = _toEpochMs(value);
  if (ts === null) {
    return '동기화 이력 없음';
  }
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

  // 24시간 이상 — 절대 시각 (yyyy-MM-dd HH:mm) 형식 (Asia/Seoul 기준)
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
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * value를 ISO 8601 문자열로 변환한다.
 * RelativeTime 컴포넌트의 datetime/title 속성에 사용된다.
 *
 * @param value - Date 객체, 밀리초 타임스탬프, 또는 null
 */
export function toIsoString(value: Date | number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const ts = _toEpochMs(value);
  if (ts === null) return '';
  return new Date(ts).toISOString();
}

/**
 * Date | number | string 값을 안전하게 Unix epoch ms 로 변환한다.
 * 변환 불가(NaN, 빈 문자열, 잘못된 형식)이면 null 반환.
 */
function _toEpochMs(value: Date | number | string): number | null {
  let ts: number;
  if (value instanceof Date) {
    ts = value.getTime();
  } else if (typeof value === 'number') {
    ts = value;
  } else if (typeof value === 'string') {
    if (value.trim() === '') return null;
    ts = Date.parse(value);
  } else {
    return null;
  }
  return Number.isFinite(ts) ? ts : null;
}
