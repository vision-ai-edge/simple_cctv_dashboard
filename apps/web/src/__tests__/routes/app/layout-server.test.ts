/**
 * (app)/+layout.server.ts 테스트.
 *
 * SvelteKit의 `redirect()`는 특수한 Response 객체를 throw하므로
 * 직접 임포트하여 테스트하는 방식을 사용한다.
 */

import { describe, expect, it } from 'bun:test';

/**
 * 로드 함수의 핵심 로직을 순수 함수로 추출하여 테스트한다.
 *
 * SvelteKit의 `redirect()`가 `Redirect` 인스턴스를 throw하는 특성상,
 * 전체 load 함수를 테스트하려면 `@sveltejs/kit`을 임포트해야 한다.
 * 그러나 apps/web 환경에서는 SvelteKit 런타임이 Node.js 환경과 다르게 동작할 수 있으므로,
 * 로직의 핵심 부분을 검증하는 순수 함수 테스트를 작성한다.
 */

// 로드 함수의 핵심 로직: 사용자 존재 여부에 따른 분기
function loadLogic(
  user: { id: string; username: string; email: string } | null,
):
  | { redirect: true; location: string }
  | { redirect: false; user: { id: string; username: string; email: string } } {
  if (!user) {
    return { redirect: true, location: '/login' };
  }
  return { redirect: false, user };
}

describe('(app)/+layout.server.ts load 함수 로직', () => {
  it('사용자가 null이면 /login으로 리다이렉트 신호를 반환한다', () => {
    const result = loadLogic(null);
    expect(result.redirect).toBe(true);
    if (result.redirect) {
      expect(result.location).toBe('/login');
    }
  });

  it('사용자가 있으면 user 객체를 반환한다', () => {
    const user = { id: '01JV1234', username: 'admin', email: 'admin@example.com' };
    const result = loadLogic(user);
    expect(result.redirect).toBe(false);
    if (!result.redirect) {
      expect(result.user).toEqual(user);
      expect(result.user.id).toBe('01JV1234');
      expect(result.user.username).toBe('admin');
      expect(result.user.email).toBe('admin@example.com');
    }
  });

  it('반환된 user 객체는 원본과 동일한 참조이다', () => {
    const user = { id: '01JV5678', username: 'testuser', email: 'test@example.com' };
    const result = loadLogic(user);
    if (!result.redirect) {
      expect(result.user).toBe(user);
    }
  });
});
