/**
 * /(app)/boxes/new 등록 폼 서버 액션 테스트.
 *
 * 순수 헬퍼 함수를 추출하여 테스트한다:
 * - validateRegisterInput: 폼 입력 유효성 검사
 * - mapRegisterFailureToMessage: 에러 kind → 한국어 메시지
 * - stripPassword: password 필드 제거
 */

import { describe, expect, it } from 'bun:test';
import type { BoxErrorKind } from '../../../lib/api/boxes';

// --- 테스트용 순수 함수 복제 ---

interface RegisterFields {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  useApiKey?: string;
}

interface ValidationOk {
  ok: true;
  data: {
    name: string;
    host: string;
    port: number;
    username: string;
    password: string;
    useApiKey: boolean;
  };
}

interface ValidationFail {
  ok: false;
  error: string;
  fields: Partial<RegisterFields>;
}

/**
 * 폼 데이터 유효성 검사.
 *
 * 검사 항목:
 * - name, host, username, password 필수
 * - port: 정수, 1-65535 범위
 */
function validateRegisterInput(fields: RegisterFields): ValidationOk | ValidationFail {
  const { name, host, port, username, password } = fields;

  if (!name || name.trim().length === 0) {
    return { ok: false, error: 'Box 이름을 입력해주세요', fields };
  }
  if (!host || host.trim().length === 0) {
    return { ok: false, error: '호스트를 입력해주세요', fields };
  }
  if (!port || port.trim().length === 0) {
    return { ok: false, error: '포트를 입력해주세요', fields };
  }
  const portNum = Number.parseInt(port, 10);
  if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return { ok: false, error: '포트는 1~65535 사이의 정수여야 합니다', fields };
  }
  if (!username || username.trim().length === 0) {
    return { ok: false, error: '사용자 이름을 입력해주세요', fields };
  }
  if (!password || password.length === 0) {
    return { ok: false, error: '비밀번호를 입력해주세요', fields };
  }

  return {
    ok: true,
    data: {
      name: name.trim(),
      host: host.trim(),
      port: portNum,
      username: username.trim(),
      password,
      useApiKey: fields.useApiKey === 'on',
    },
  };
}

/**
 * 에러 kind에 해당하는 한국어 등록 실패 메시지를 반환한다.
 */
function mapRegisterFailureToMessage(kind: BoxErrorKind): string {
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

/**
 * password 필드를 제거한 객체를 반환한다.
 * REQ-UI-2 [Unwanted]: 실패 응답에 password 평문 미포함.
 */
function stripPassword<T extends Record<string, unknown>>(data: T): Omit<T, 'password'> {
  const { password: _drop, ...safe } = data;
  return safe as Omit<T, 'password'>;
}

// --- 테스트 ---

describe('validateRegisterInput', () => {
  const validFields: RegisterFields = {
    name: '카메라A',
    host: '192.168.1.10',
    port: '8080',
    username: 'admin',
    password: 'secret',
  };

  it('유효한 입력 → ok: true와 파싱된 데이터 반환', () => {
    const result = validateRegisterInput(validFields);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe('카메라A');
      expect(result.data.port).toBe(8080);
      expect(result.data.useApiKey).toBe(false);
    }
  });

  it('useApiKey = "on" → true로 파싱', () => {
    const result = validateRegisterInput({ ...validFields, useApiKey: 'on' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.useApiKey).toBe(true);
    }
  });

  it('빈 name → 오류 반환', () => {
    const result = validateRegisterInput({ ...validFields, name: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('이름');
    }
  });

  it('빈 host → 오류 반환', () => {
    const result = validateRegisterInput({ ...validFields, host: '' });
    expect(result.ok).toBe(false);
  });

  it('빈 port → 오류 반환', () => {
    const result = validateRegisterInput({ ...validFields, port: '' });
    expect(result.ok).toBe(false);
  });

  it('비정수 port → 오류 반환', () => {
    const result = validateRegisterInput({ ...validFields, port: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('포트');
    }
  });

  it('port 0 → 범위 오류 반환', () => {
    const result = validateRegisterInput({ ...validFields, port: '0' });
    expect(result.ok).toBe(false);
  });

  it('port 65536 → 범위 오류 반환', () => {
    const result = validateRegisterInput({ ...validFields, port: '65536' });
    expect(result.ok).toBe(false);
  });

  it('port 65535 → 유효 (경계값)', () => {
    const result = validateRegisterInput({ ...validFields, port: '65535' });
    expect(result.ok).toBe(true);
  });

  it('빈 username → 오류 반환', () => {
    const result = validateRegisterInput({ ...validFields, username: '' });
    expect(result.ok).toBe(false);
  });

  it('빈 password → 오류 반환', () => {
    const result = validateRegisterInput({ ...validFields, password: '' });
    expect(result.ok).toBe(false);
  });
});

describe('mapRegisterFailureToMessage', () => {
  it('auth → 자격증명 확인 메시지', () => {
    expect(mapRegisterFailureToMessage('auth')).toBe('EdgeAI Box 자격증명을 확인하세요');
  });

  it('duplicate → 중복 등록 메시지', () => {
    expect(mapRegisterFailureToMessage('duplicate')).toBe(
      '동일한 Box(host:port)가 이미 등록되어 있습니다',
    );
  });

  it('upstream → 연결 실패 메시지', () => {
    expect(mapRegisterFailureToMessage('upstream')).toBe(
      'EdgeAI Box에 연결할 수 없습니다. 네트워크 상태를 확인하세요',
    );
  });
});

describe('stripPassword', () => {
  it('password 필드가 반환값에 포함되지 않는다', () => {
    const data = { name: '카메라A', host: '192.168.1.10', port: '8080', password: 'secret' };
    const result = stripPassword(data);
    expect(result).not.toHaveProperty('password');
    expect(result.name).toBe('카메라A');
  });

  it('password 없는 객체도 정상 처리된다', () => {
    const data = { name: '카메라A', host: '192.168.1.10' };
    const result = stripPassword(data);
    expect(result.name).toBe('카메라A');
  });
});
