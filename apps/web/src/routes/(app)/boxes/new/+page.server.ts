/**
 * /(app)/boxes/new 등록 폼 서버 액션.
 *
 * 폼 제출 → 유효성 검사 → POST /api/boxes 호출 → 성공 시 상세 페이지로 리다이렉트.
 *
 * REQ-UI-2 [Unwanted]: 실패 시 password 필드를 제거하여 반환한다.
 */

import { createBox } from '$lib/api/boxes';
import type { BoxErrorKind } from '$lib/api/boxes';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

interface RegisterFields {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  useApiKey?: string;
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// 순수 헬퍼 함수 (테스트 가능)
// ---------------------------------------------------------------------------

/**
 * 폼 데이터 유효성 검사.
 * 검사 항목: 필수 필드, port 범위(1-65535)
 */
export function _validateRegisterInput(fields: RegisterFields):
  | {
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
  | { ok: false; error: string; fields: RegisterFields } {
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
export function _mapRegisterFailureToMessage(kind: BoxErrorKind): string {
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
export function _stripPassword<T extends Record<string, unknown>>(data: T): Omit<T, 'password'> {
  const { password: _drop, ...safe } = data;
  return safe as Omit<T, 'password'>;
}

// ---------------------------------------------------------------------------
// SvelteKit load / actions
// ---------------------------------------------------------------------------

/** 이미 인증된 사용자가 접근하는 경우 — 레이아웃 가드가 처리하므로 빈 load */
export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) {
    redirect(303, '/login');
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, fetch: eventFetch, locals }) => {
    // REQ-UI-5: 미인증 접근 차단
    if (!locals.user) {
      redirect(303, '/login');
    }

    const formData = await request.formData();
    const fields: RegisterFields = {
      name: String(formData.get('name') ?? ''),
      host: String(formData.get('host') ?? ''),
      port: String(formData.get('port') ?? ''),
      username: String(formData.get('username') ?? ''),
      password: String(formData.get('password') ?? ''),
      useApiKey: formData.get('useApiKey') === 'on' ? 'on' : undefined,
    };

    // 입력값 유효성 검사
    const validation = _validateRegisterInput(fields);
    if (!validation.ok) {
      // password 제외 후 명시적 타입으로 반환 (REQ-UI-2)
      const safeFields = _stripPassword(fields);
      return fail(422, {
        name: safeFields.name,
        host: safeFields.host,
        port: safeFields.port,
        username: safeFields.username,
        useApiKey: safeFields.useApiKey,
        error: validation.error,
      });
    }

    // POST /api/boxes 호출
    const result = await createBox(validation.data, eventFetch);

    if (result.ok) {
      // 성공 → 상세 페이지로 303 리다이렉트
      redirect(303, `/boxes/${result.box.id}`);
    }

    // 실패 → 에러 메시지와 함께 폼 재표시 (password 제외)
    const errorMessage = _mapRegisterFailureToMessage(result.error.kind);
    const safeFields = _stripPassword(fields);
    return fail(result.error.status || 400, {
      name: safeFields.name,
      host: safeFields.host,
      port: safeFields.port,
      username: safeFields.username,
      useApiKey: safeFields.useApiKey,
      error: errorMessage,
    });
  },
};
