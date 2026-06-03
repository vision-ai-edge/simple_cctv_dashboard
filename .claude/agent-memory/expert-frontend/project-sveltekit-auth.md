---
name: SvelteKit Auth Implementation Patterns
description: SPEC-AUTH-001 T6/T7 SvelteKit 인증 구현 시 적용된 핵심 패턴과 결정 사항
type: project
---

# SPEC-AUTH-001 SvelteKit 프론트엔드 인증 구현

## 구현 완료 (2026-05-13)

**Why:** JWT HttpOnly 쿠키 기반 인증을 SvelteKit 2.8 + Svelte 5 + Tailwind 4 스택으로 구현

**How to apply:** 향후 유사한 SvelteKit 인증 기능 구현 시 참조

## 핵심 패턴

### 쿠키 수동 포워딩
`event.fetch`로 다른 포트의 API(dev: 3000)를 호출하면 Set-Cookie 응답이 브라우저에 자동 전달되지 않는다.
해결책: `response.headers.getSetCookie()` 파싱 후 `event.cookies.set()`으로 수동 설정.

### redirect() 위치
SvelteKit 2.x에서 `redirect()`는 try/catch 블록 바깥에서 throw해야 한다.
load 함수 내에서도 동일하게 `redirect(303, '/path')` 형태로 직접 호출.

### 라우트 그룹 구조
- `(app)` 그룹: URL 경로에 영향 없이 보호 라우트 묶음. (app)/+page.svelte가 `/` 핸들
- 기존 루트 +page.svelte는 제거하여 충돌 방지

### tsconfig에 bun 타입 추가
`"types": ["bun"]` — apps/web에서 bun:test 모듈을 인식하기 위해 필요

### Svelte 5 $state 선언
`let submitting = $state(false)` — Svelte 5에서 $state는 반드시 `let`으로 선언.
Biome `useConst` lint 충돌 시 `// biome-ignore lint/style/useConst: Svelte 5 $state rune requires let declaration` 주석 사용.
