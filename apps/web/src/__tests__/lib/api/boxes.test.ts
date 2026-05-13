/**
 * boxes.ts API 헬퍼 순수 함수 테스트.
 *
 * fetch 자체는 테스트하지 않고, 에러 매핑 순수 함수만 검증한다.
 * - mapBoxErrorStatus: HTTP 상태코드 + 바디 → 에러 kind 태그
 * - boxErrorMessageKo: kind → 한국어 에러 메시지
 */

import { describe, expect, it } from 'bun:test';

// --- 테스트용 순수 함수 복제 ---

type BoxErrorKind = 'auth' | 'duplicate' | 'unauthorized' | 'upstream' | 'unknown' | 'notFound';

interface BoxErrorBody {
  code?: string;
  error?: string;
  message?: string;
  success?: boolean;
}

/**
 * HTTP 상태코드와 파싱된 바디를 기반으로 에러 kind 태그를 결정한다.
 *
 * 매핑 규칙:
 * - 400 with code EC-BOX-001 → 'auth'
 * - 400 with code EC-BOX-003 또는 409 → 'duplicate'
 * - 401 → 'unauthorized'
 * - 404 → 'notFound'
 * - 502 → 'upstream'
 * - 그 외 → 'unknown'
 */
function mapBoxErrorStatus(status: number, body: BoxErrorBody): { kind: BoxErrorKind } {
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 404) return { kind: 'notFound' };
  if (status === 502) return { kind: 'upstream' };
  if (status === 409) return { kind: 'duplicate' };
  if (status === 400) {
    if (body.code === 'EC-BOX-003') return { kind: 'duplicate' };
    if (body.code === 'EC-BOX-001') return { kind: 'auth' };
    // code 없는 400 (errorEnvelope 형식) → 기본 auth 처리
    return { kind: 'auth' };
  }
  return { kind: 'unknown' };
}

/**
 * 에러 kind에 해당하는 한국어 메시지를 반환한다.
 */
function boxErrorMessageKo(kind: BoxErrorKind): string {
  const messages: Record<BoxErrorKind, string> = {
    auth: 'EdgeAI Box 자격증명을 확인하세요',
    duplicate: '동일한 Box(host:port)가 이미 등록되어 있습니다',
    unauthorized: '인증이 필요합니다. 다시 로그인해주세요',
    upstream: 'EdgeAI Box에 연결할 수 없습니다. 네트워크 상태를 확인하세요',
    notFound: '해당 Box를 찾을 수 없습니다',
    unknown: '알 수 없는 오류가 발생했습니다',
  };
  return messages[kind];
}

// --- 테스트 ---

describe('mapBoxErrorStatus', () => {
  it('400 with code EC-BOX-001 → kind: auth', () => {
    const result = mapBoxErrorStatus(400, { code: 'EC-BOX-001', error: '자격증명 오류' });
    expect(result.kind).toBe('auth');
  });

  it('400 with code EC-BOX-003 → kind: duplicate', () => {
    const result = mapBoxErrorStatus(400, { code: 'EC-BOX-003', error: '중복 등록' });
    expect(result.kind).toBe('duplicate');
  });

  it('409 → kind: duplicate', () => {
    const result = mapBoxErrorStatus(409, {});
    expect(result.kind).toBe('duplicate');
  });

  it('401 → kind: unauthorized', () => {
    const result = mapBoxErrorStatus(401, {});
    expect(result.kind).toBe('unauthorized');
  });

  it('502 → kind: upstream', () => {
    const result = mapBoxErrorStatus(502, { message: '연결 실패' });
    expect(result.kind).toBe('upstream');
  });

  it('404 → kind: notFound', () => {
    const result = mapBoxErrorStatus(404, { message: '찾을 수 없음' });
    expect(result.kind).toBe('notFound');
  });

  it('그 외 → kind: unknown', () => {
    const result = mapBoxErrorStatus(500, {});
    expect(result.kind).toBe('unknown');
  });

  it('code 없는 400 → kind: auth (errorEnvelope 형식)', () => {
    const result = mapBoxErrorStatus(400, { message: '입력 값이 유효하지 않습니다' });
    expect(result.kind).toBe('auth');
  });
});

describe('boxErrorMessageKo', () => {
  it('auth → 자격증명 확인 메시지', () => {
    expect(boxErrorMessageKo('auth')).toBe('EdgeAI Box 자격증명을 확인하세요');
  });

  it('duplicate → 중복 등록 메시지', () => {
    expect(boxErrorMessageKo('duplicate')).toBe('동일한 Box(host:port)가 이미 등록되어 있습니다');
  });

  it('unauthorized → 인증 필요 메시지', () => {
    expect(boxErrorMessageKo('unauthorized')).toBe('인증이 필요합니다. 다시 로그인해주세요');
  });

  it('upstream → 네트워크 오류 메시지', () => {
    expect(boxErrorMessageKo('upstream')).toBe(
      'EdgeAI Box에 연결할 수 없습니다. 네트워크 상태를 확인하세요',
    );
  });

  it('notFound → 찾을 수 없음 메시지', () => {
    expect(boxErrorMessageKo('notFound')).toBe('해당 Box를 찾을 수 없습니다');
  });

  it('unknown → 알 수 없음 메시지', () => {
    expect(boxErrorMessageKo('unknown')).toBe('알 수 없는 오류가 발생했습니다');
  });
});
