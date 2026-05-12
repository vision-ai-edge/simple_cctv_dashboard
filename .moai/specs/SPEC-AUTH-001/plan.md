# SPEC-AUTH-001 구현 계획 (plan.md)

```
TAG: SPEC-AUTH-001
DOMAIN: auth
PHASE: feature
```

---

## 1. 구현 개요

본 계획은 SPEC-AUTH-001에서 정의한 JWT HttpOnly 쿠키 기반 인증 시스템을 구현하기 위한 태스크 분해와 기술 방향을 제시한다. 구현 범위는 `packages/db` 블랙리스트 스키마, `packages/shared` JWT 유틸, `apps/api` 인증 미들웨어 및 4개 라우트, `apps/web` 로그인 페이지 및 보호 라우트 가드로 구성되며, 모든 신규 코드는 Hybrid 모드 하의 TDD(RED-GREEN-REFACTOR) 사이클을 따른다.

---

## 2. 태스크 분해

### T1 — auth_token_blacklist DB 스키마 + 마이그레이션

- **담당 에이전트**: expert-backend
- **의존성**: SPEC-CORE-001 완료 (`packages/db` 존재)
- **대상 파일**:
  - 생성: `packages/db/src/schema/auth.ts`
  - 생성: `packages/db/src/migrations/0002_auth_blacklist.sql`
  - 수정: `packages/db/src/index.ts` (스키마 re-export 추가)
- **TDD 순서**:
  - RED: `auth_token_blacklist` 테이블 INSERT/SELECT/DELETE 동작 검증 테스트 작성
  - GREEN: Drizzle 스키마 정의 및 마이그레이션 SQL 작성, `bun run db:migrate` 실행
  - REFACTOR: `jti UNIQUE` 인덱스 및 `expires_at` 인덱스 최적화 확인
- **예상 산출물**: `auth_token_blacklist` 테이블 (id, jti UNIQUE, user_id, expires_at, created_at)

---

### T2 — packages/shared JWT 유틸리티 모듈

- **담당 에이전트**: expert-backend
- **의존성**: T1 완료 (jti 타입 확인)
- **대상 파일**:
  - 생성: `packages/shared/src/jwt/index.ts`
  - 생성: `packages/shared/src/jwt/__tests__/jwt.test.ts`
  - 수정: `packages/shared/src/index.ts` (jwt re-export)
- **TDD 순서**:
  - RED: `signAccessToken`, `signRefreshToken`, `verifyToken`, `parseTokenClaims` 동작 테스트 작성 (클레임 내용, 만료 검증, 잘못된 서명 거부)
  - GREEN: jose를 사용한 HS256 서명/검증 구현
  - REFACTOR: 토큰 클레임 타입 안전성 강화 (type narrowing for `RefreshTokenClaims`)
- **예상 산출물**:
  - `signAccessToken(payload: { sub, jti }, secret: string): Promise<string>`
  - `signRefreshToken(payload: { sub, jti }, secret: string): Promise<string>`
  - `verifyToken(token: string, secret: string): Promise<AccessTokenClaims | RefreshTokenClaims>`
  - `parseTokenClaims(token: string): AccessTokenClaims | RefreshTokenClaims` (검증 없이 파싱)

---

### T3 — requireAuth Hono 미들웨어

- **담당 에이전트**: expert-backend
- **의존성**: T2 완료
- **대상 파일**:
  - 생성: `apps/api/src/middleware/requireAuth.ts`
  - 생성: `apps/api/src/middleware/__tests__/requireAuth.test.ts`
- **TDD 순서**:
  - RED: 유효 토큰 통과, 만료 토큰 401, 블랙리스트 jti 401, 쿠키 누락 401 케이스 테스트 작성
  - GREEN: 쿠키 추출 → `verifyToken` → 블랙리스트 조회 → `context.set('userId', ...)` 주입 구현
  - REFACTOR: 블랙리스트 조회 쿼리 최적화 (준비된 쿼리 캐싱)
- **예상 산출물**: `requireAuth: MiddlewareHandler` — context에 `userId`, `tokenJti` 주입

---

### T4 — Auth API 라우트 4종 + 통합 테스트

- **담당 에이전트**: expert-backend
- **의존성**: T2, T3 완료
- **대상 파일**:
  - 생성: `apps/api/src/routes/auth.ts`
  - 생성: `apps/api/src/routes/__tests__/auth.integration.test.ts`
  - 수정: `apps/api/src/app.ts` (auth 라우터 마운트 `/api/auth`)
- **TDD 순서**:
  - RED: 로그인 성공/실패, 로그아웃 쿠키 만료, `/me` 응답 구조, `/refresh` rotation 동작 테스트 작성
  - GREEN: 라우트 4종 구현 (`login`, `logout`, `me`, `refresh`)
  - REFACTOR: 공통 쿠키 헬퍼 함수 추출, 오류 응답 봉투 일관성 확인
- **라우트 목록**:
  - `POST /api/auth/login` — Zod 검증 → bcryptjs 비교 → 토큰 발급 → 쿠키 설정
  - `POST /api/auth/logout` — requireAuth → jti 블랙리스트 삽입 → 쿠키 만료
  - `GET /api/auth/me` — requireAuth → 사용자 조회 → 응답
  - `POST /api/auth/refresh` — Refresh 토큰 검증 → rotation → 새 쿠키 발급
- **예상 산출물**: 통합 테스트 커버리지 85% 이상 (auth 도메인 기준)

---

### T5 — expert-testing 보완 테스트 (엣지 케이스)

- **담당 에이전트**: expert-testing
- **의존성**: T4 완료
- **대상 파일**:
  - 수정: `apps/api/src/routes/__tests__/auth.integration.test.ts`
  - 생성: `apps/api/src/middleware/__tests__/rateLimit.test.ts`
- **TDD 순서**:
  - RED: 레이트 리미팅(15분 5회 초과), Refresh 재사용 감지, 쿠키 속성 검증(Max-Age, Path) 테스트 작성
  - GREEN: 기존 구현이 커버하지 않는 케이스 보완
  - REFACTOR: 테스트 픽스처 공통화 (`testUser`, `loginAndGetCookies` 헬퍼)
- **예상 산출물**: 엣지 케이스 + 레이트 리미팅 테스트 추가, 전체 커버리지 85% 달성 확인

---

### T6 — SvelteKit /login 페이지 + 서버 액션

- **담당 에이전트**: expert-frontend
- **의존성**: T4 완료 (API 엔드포인트 동작 확인)
- **대상 파일**:
  - 생성: `apps/web/src/routes/login/+page.svelte`
  - 생성: `apps/web/src/routes/login/+page.server.ts`
  - 생성: `apps/web/src/lib/stores/auth.ts`
- **TDD 순서**:
  - RED: 로그인 성공 후 리다이렉트, 실패 시 에러 메시지 표시 시나리오 서버 액션 테스트 작성
  - GREEN: 폼 제출 → `fetch('/api/auth/login')` → 쿠키 전달 → `redirect(303, '/')` 구현
  - REFACTOR: 에러 처리 일관성 (Zod 파싱 실패 vs API 오류 구분)
- **예상 산출물**: 로그인 폼 UI 컴포넌트, 서버 액션, auth 스토어 (사용자 정보 읽기 전용)

---

### T7 — SvelteKit (app) 보호 라우트 그룹 + hooks.server.ts

- **담당 에이전트**: expert-frontend
- **의존성**: T6 완료
- **대상 파일**:
  - 생성: `apps/web/src/routes/(app)/+layout.server.ts`
  - 생성: `apps/web/src/hooks.server.ts`
- **TDD 순서**:
  - RED: 쿠키 없을 때 `/login` 리다이렉트, 유효 쿠키일 때 `locals.user` 주입 검증 테스트 작성
  - GREEN: `hooks.server.ts`에서 `access_token` 쿠키 파싱 → `event.locals.user` 설정, `(app)/+layout.server.ts`에서 `locals.user` 없으면 redirect
  - REFACTOR: 쿠키 파싱 로직을 `src/lib/server/auth.ts` 헬퍼로 분리
- **예상 산출물**: 보호 라우트 가드 (`/(app)/*` 전체에 세션 검증 적용)

---

## 3. 기술 스택 및 의존성

| 패키지 | 버전 | 용도 | 비고 |
|--------|------|------|------|
| jose | ^5.8 | JWT 서명/검증 (HS256) | `packages/shared`에 추가 |
| bcryptjs | ^2.4 | 비밀번호 타이밍 안전 비교 | 기존 사용 (seed 스크립트) — 신규 추가 없음 |
| @types/bcryptjs | 최신 | bcryptjs 타입 선언 | 기존 사용 — 신규 추가 없음 |
| hono | ^4.5 | API 프레임워크 + 쿠키 미들웨어 | 기존 사용 — 신규 추가 없음 |
| zod | ^4.0 | 입력 검증 스키마 | 기존 사용 — 신규 추가 없음 |
| ulid | 기존 | jti 고유 식별자 생성 | 기존 사용 — 신규 추가 없음 |

신규 추가 패키지: **jose ^5.8** (`packages/shared` 의존성으로 추가)

---

## 4. 위험 및 완화

| ID | 위험 | 영향 | 완화 방안 |
|----|------|------|---------|
| R1 | JWT_SECRET 유출 시 전체 토큰 위조 가능 | 높음 | 환경 변수로만 관리, 시작 시 32바이트 미만이면 즉시 종료, `.env` gitignore |
| R2 | 개발 환경 `Secure` 쿠키 비활성화로 인한 HTTPS 의존성 착각 | 중간 | A2 가정에 명시, `NODE_ENV` 분기 코드 단위 테스트 포함 |
| R3 | 블랙리스트 테이블 무한 증가 | 중간 | REQ-AUTH-011: 삽입 시 만료 항목 자동 cleanup (트리거 패턴) |
| R4 | Refresh 토큰 재사용 공격 (탈취 후 사용) | 높음 | REQ-AUTH-016: 재사용 감지 시 해당 사용자 전체 세션 무효화 |
| R5 | in-memory 레이트 리미팅의 프로세스 재시작 시 상태 초기화 | 낮음 | MVP 단계에서 허용. SPEC-OPS에서 Redis 기반 영속 레이트 리미터로 교체 예정 |

---

## 5. TDD 사이클 적용 예시

### T2 JWT 유틸 — RED 단계 예시

```typescript
// packages/shared/src/jwt/__tests__/jwt.test.ts
import { describe, it, expect } from "vitest";
import { signAccessToken, verifyToken } from "../index";

describe("signAccessToken", () => {
  it("iss 클레임이 'simple_cctv'이어야 한다", async () => {
    const token = await signAccessToken(
      { sub: "01H...", jti: "01H..." },
      "a".repeat(32)
    );
    const claims = await verifyToken(token, "a".repeat(32));
    expect(claims.iss).toBe("simple_cctv");
  });

  it("exp가 발급 시점 + 15분이어야 한다", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signAccessToken(
      { sub: "01H...", jti: "01H..." },
      "a".repeat(32)
    );
    const claims = await verifyToken(token, "a".repeat(32));
    expect(claims.exp).toBeGreaterThanOrEqual(before + 14 * 60);
    expect(claims.exp).toBeLessThanOrEqual(before + 16 * 60);
  });
});
```

### T3 requireAuth — RED 단계 예시

```typescript
// apps/api/src/middleware/__tests__/requireAuth.test.ts
import { describe, it, expect } from "vitest";

describe("requireAuth 미들웨어", () => {
  it("쿠키 누락 시 401을 반환해야 한다", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
```

---

## 6. 품질 게이트

TRUST 5 프레임워크를 auth 도메인에 다음과 같이 적용한다:

| 차원 | 적용 방식 |
|------|---------|
| **Tested** | auth 도메인 단위+통합 테스트 커버리지 85% 이상. `bun test --coverage` 통과 |
| **Readable** | Biome 린트 0 오류. 함수명은 동사+명사 패턴 (`signAccessToken`, `requireAuth`) |
| **Unified** | `bun run format` 실행 후 변경 없음. 기존 코드베이스 스타일 일관성 유지 |
| **Secured** | HttpOnly 쿠키 강제, JWT_SECRET 검증, bcryptjs 타이밍 안전 비교, 레이트 리미팅 |
| **Trackable** | 커밋 메시지 Conventional Commits 형식 (`feat(auth): ...`), SPEC-AUTH-001 참조 |

---

## 7. 마이그레이션 영향도

- **SPEC-CORE-001 산출물 영향**: 없음. 기존 `users` 테이블 스키마 변경 없음
- **`packages/db`**: 마이그레이션 1건 추가 (`0002_auth_blacklist.sql`), 스키마 파일 1건 추가
- **`packages/shared`**: `src/jwt/index.ts` 신규 모듈 추가, `src/index.ts` re-export 추가, `jose` 의존성 추가
- **`apps/api`**: `src/routes/auth.ts` 신규, `src/middleware/requireAuth.ts` 신규, `src/app.ts` 라우터 마운트 수정
- **`apps/web`**: 3개 신규 파일 (login 페이지, layout.server.ts, hooks.server.ts), 1개 신규 스토어

기존 통과 중인 44개 테스트(SPEC-CORE-001 산출물)는 영향받지 않아야 한다.

---

## 8. 롤백 전략

- **DB 마이그레이션 롤백**: `0002_auth_blacklist.sql`에 대응하는 다운 마이그레이션 작성
  ```sql
  -- down: 0002_auth_blacklist_down.sql
  DROP TABLE IF EXISTS auth_token_blacklist;
  ```
- **브랜치 단위 롤백**: `feature/SPEC-AUTH-001` 브랜치를 `main`에 머지하지 않으면 전체 변경 격리. 필요 시 `git revert` 또는 브랜치 삭제로 롤백

---

## 9. 다음 단계

구현 시작 명령:

```
/moai run SPEC-AUTH-001
```

구현 완료 후 동기화:

```
/moai sync SPEC-AUTH-001
```

구현 완료 조건 (Definition of Done):
- `bun test --coverage` 통과 (커버리지 85% 이상)
- `bun run lint` Biome 오류 0건
- `bun run typecheck` 타입 오류 0건
- 기존 SPEC-CORE-001 테스트 44개 전원 유지 통과
- 브라우저 수동 검증 (acceptance.md 수동 검증 항목 확인)
