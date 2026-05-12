/**
 * 서버 사이드 인증 헬퍼 모듈.
 *
 * hooks.server.ts 및 load 함수에서 재사용하는 공통 로직.
 * 이 모듈은 서버 전용($lib/server)이므로 클라이언트 번들에 포함되지 않는다.
 */

import type { RequestEvent } from '@sveltejs/kit';

/** /api/auth/me 응답 바디 타입 */
interface MeResponseBody {
  success: boolean;
  user?: {
    id: string;
    username: string;
    email: string;
  };
  error?: string;
}

/** 인증된 사용자 정보 타입 */
export type AuthUser = {
  id: string;
  username: string;
  email: string;
};

/**
 * 현재 요청의 access_token 쿠키를 검증하여 사용자 정보를 반환한다.
 *
 * - access_token 쿠키가 없으면 null 반환
 * - /api/auth/me 호출이 200이면 사용자 정보 반환
 * - 401 등 실패이면 null 반환 (만료 또는 블랙리스트 처리된 토큰)
 *
 * 성능 참고: 요청당 /api/auth/me를 한 번 호출한다. MVP에서는 허용 가능한 수준이며,
 * 향후 로컬 JWT 디코딩(서명 검증 없이 클레임 추출)으로 최적화할 수 있다.
 * 단, 로컬 디코딩은 블랙리스트를 확인하지 않으므로 현재는 API 호출 방식을 유지한다.
 */
export async function getCurrentUser(event: RequestEvent): Promise<AuthUser | null> {
  const token = event.cookies.get('access_token');
  if (!token) {
    return null;
  }

  try {
    // event.fetch는 요청 헤더(쿠키 포함)를 자동으로 포워딩한다
    const response = await event.fetch('/api/auth/me');
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as MeResponseBody;
    if (body.success && body.user) {
      return {
        id: body.user.id,
        username: body.user.username,
        email: body.user.email,
      };
    }
    return null;
  } catch {
    // 네트워크 오류 등 예외 발생 시 미인증 상태로 처리
    return null;
  }
}
