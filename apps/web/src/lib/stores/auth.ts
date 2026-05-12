/**
 * 클라이언트 사이드 인증 상태 스토어.
 *
 * 중요: HttpOnly 쿠키이므로 클라이언트 JS에서 토큰 값에 직접 접근할 수 없다.
 * 인증 상태의 주된 출처는 $page.data.user (서버에서 렌더링된 페이지 데이터)이다.
 *
 * 이 스토어는 로그아웃 등 클라이언트 측 낙관적 업데이트가 필요한 경우에 활용한다.
 * 페이지 이동 시 $page.data.user로 서버 데이터가 우선 반영된다.
 */

import { writable } from 'svelte/store';

/** 인증된 사용자 정보 타입 */
export interface AuthUser {
  id: string;
  username: string;
  email?: string;
}

/** 인증 스토어 — null이면 미인증 상태 */
export const auth = writable<AuthUser | null>(null);

/** 사용자 정보를 스토어에 설정한다 */
export function setAuth(user: AuthUser): void {
  auth.set(user);
}

/** 스토어를 초기화하여 미인증 상태로 만든다 */
export function clearAuth(): void {
  auth.set(null);
}
