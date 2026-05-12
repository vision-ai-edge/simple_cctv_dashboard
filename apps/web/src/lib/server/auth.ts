/**
 * 서버 사이드 인증 헬퍼 모듈.
 *
 * hooks.server.ts 및 load 함수에서 재사용하는 공통 로직.
 * 이 모듈은 서버 전용($lib/server)이므로 클라이언트 번들에 포함되지 않는다.
 *
 * 중요: API 호출 시 절대 URL 의 일반 fetch 를 사용한다.
 * SvelteKit 의 event.fetch 는 동일 오리진 경로에 대해 라우터를 거치므로,
 * hooks 에서 사용하면 무한 재귀가 발생한다.
 */

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
 * API 서버 내부 URL. 환경 변수로 오버라이드 가능.
 * 프로덕션에서는 동일 reverse proxy 뒤의 내부 호스트를 가리키도록 설정한다.
 */
const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

/**
 * access_token 을 사용하여 API 서버의 /api/auth/me 를 호출, 사용자 정보를 조회한다.
 *
 * - token 이 비어 있으면 null 반환
 * - 200 응답이면 사용자 정보 반환
 * - 401 등 실패이면 null 반환 (만료/블랙리스트)
 * - 네트워크 오류 등 예외 발생 시 null 반환
 *
 * 성능 참고: 매 요청당 1회의 API 왕복이 발생한다. MVP 에서는 허용 가능한 수준이며,
 * 향후 로컬 JWT 디코딩(블랙리스트는 별도 캐시)으로 최적화할 수 있다.
 */
export async function getCurrentUser(token: string): Promise<AuthUser | null> {
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${INTERNAL_API_URL}/api/auth/me`, {
      method: 'GET',
      headers: {
        Cookie: `access_token=${token}`,
        Accept: 'application/json',
      },
    });

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
    return null;
  }
}
