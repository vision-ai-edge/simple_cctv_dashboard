---
name: SvelteKit Test File Location Outside Routes
description: SvelteKit routes/ 디렉토리 내 __tests__ 폴더에 + 접두사 파일 배치 불가
type: feedback
---

# SvelteKit 테스트 파일 위치

**Rule:** SvelteKit 프로젝트에서 테스트 파일은 `src/routes/` 바깥에 배치한다. `src/__tests__/` 권장.

**Why:** SvelteKit은 `routes/` 내부의 모든 `+`로 시작하는 파일을 라우트 파일로 예약한다. `routes/(app)/__tests__/+layout.server.test.ts` 같은 파일은 svelte-kit sync 시 "Files prefixed with + are reserved" 오류 발생.

**How to apply:**
- 테스트 파일 위치: `apps/web/src/__tests__/routes/`
- 파일명: `layout-server.test.ts`, `page-server.test.ts` (+ 접두사 없이)
- package.json test 스크립트: 명시적 파일 경로 사용 (glob은 --filter 모드에서 해석 차이 있음)
