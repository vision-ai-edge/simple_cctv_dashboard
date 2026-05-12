// SvelteKit 전역 타입 선언
// See https://svelte.dev/docs/kit/types#app
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      // 인증된 사용자 정보 — hooks.server.ts에서 주입
      user: { id: string; username: string; email: string } | null;
    }
    interface PageData {
      // 보호 라우트에서 layout.server.ts가 반환하는 사용자 정보
      user?: { id: string; username: string; email: string } | null;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
