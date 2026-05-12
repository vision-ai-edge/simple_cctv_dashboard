---
id: SPEC-AUTH-001
version: 0.1.0
status: Draft
created: 2026-05-12
updated: 2026-05-12
author: imgughyeon
priority: High
---

# SPEC-AUTH-001: 대시보드 사용자 인증 (JWT 쿠키 기반)

## HISTORY

| 날짜 | 버전 | 변경 사항 | 작성자 |
|------|------|---------|--------|
| 2026-05-12 | 0.1.0 | 초안 작성 | imgughyeon |

---

## 메타데이터

| 항목 | 내용 |
|------|------|
| **SPEC ID** | SPEC-AUTH-001 |
| **제목** | 대시보드 사용자 인증 — JWT HttpOnly 쿠키 기반 Access/Refresh 토큰 플로우 |
| **상태** | Draft |
| **우선순위** | High |
| **담당 에이전트** | manager-strategy → expert-backend + expert-frontend (Hybrid 모드, 신규 코드는 TDD) |
| **연관 SPEC** | SPEC-CORE-001 (foundation, 완료), SPEC-BOX-* (소비자) |
| **작성일** | 2026-05-12 |
| **개발 방법론** | TDD — Hybrid 모드 신규 코드 (RED-GREEN-REFACTOR) |

---

## 환경 (Environment)

### 프로젝트 컨텍스트

- **프로젝트**: simple_cctv_dashboard — 단일 관리자 사용자 MVP, 향후 다중 사용자로 확장 가능한 스키마 설계
- **아키텍처**: Bun Workspace 모노레포 (SPEC-CORE-001에서 완성된 기반 구조 사용)
- **인증 방식**: 대시보드 자체 JWT (EdgeAI Box 인증과 별개). 브라우저 쿠키 기반, JS에서 토큰값 미접근

### 워크스페이스 구성 (변경/추가 대상)

```
simple_cctv_dashboard/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── middleware/
│   │       │   └── requireAuth.ts        # 신규: Hono 인증 미들웨어
│   │       └── routes/
│   │           └── auth.ts               # 신규: /api/auth/* 라우트
│   └── web/
│       └── src/
│           ├── routes/
│           │   ├── login/
│           │   │   ├── +page.svelte      # 신규: 로그인 폼 UI
│           │   │   └── +page.server.ts   # 신규: 서버 액션 (API 호출)
│           │   └── (app)/
│           │       └── +layout.server.ts # 신규: 보호 라우트 세션 검증
│           ├── hooks.server.ts           # 신규: 전역 쿠키 검증
│           └── lib/
│               └── stores/
│                   └── auth.ts           # 신규: 클라이언트 auth 스토어
└── packages/
    ├── db/
    │   └── src/
    │       ├── schema/
    │       │   └── auth.ts               # 신규: auth_token_blacklist 스키마
    │       └── migrations/
    │           └── 0002_auth_blacklist.sql # 신규: 마이그레이션
    └── shared/
        └── src/
            └── jwt/
                └── index.ts              # 신규: JWT 유틸 (sign, verify, claims)
```

### 런타임 및 표준

- **런타임**: Bun 1.2+, TypeScript 5.9+
- **인증 라이브러리**: jose ^5.8 (HS256 서명)
- **비밀번호 검증**: bcryptjs ^2.4 (기존 seed 스크립트와 동일)
- **보안 표준**: HttpOnly + SameSite=Lax 쿠키, JWT_SECRET 시작 시 검증, 레이트 리미팅

---

## 가정 (Assumptions)

| 번호 | 가정 | 신뢰도 | 검증 방법 |
|------|------|--------|---------|
| A1 | jose ^5.8가 `packages/shared`에 설치되어 있으며 HS256 알고리즘이 사용 가능하다 | 높음 | `bun add jose` 후 `jose/key/local` 임포트 검증 |
| A2 | `NODE_ENV=production`에서만 쿠키에 `Secure` 플래그가 활성화되며, 개발 환경에서는 localhost HTTP에서 동작한다 | 높음 | Hono 쿠키 설정 코드 + localhost 브라우저 수동 확인 |
| A3 | `JWT_SECRET` 환경 변수는 최소 32바이트 무작위 문자열이며, API 서버 시작 시 이를 검증하여 미충족 시 `process.exit(1)`로 종료한다 | 높음 | 시작 시 유효성 검사 코드 + 단위 테스트 |
| A4 | `auth_token_blacklist` 테이블은 Drizzle 스키마 정의 후 마이그레이션 SQL(`0002_auth_blacklist.sql`)로 적용된다 | 높음 | `bun run db:migrate` 실행 후 테이블 존재 확인 |
| A5 | SvelteKit의 `hooks.server.ts` 및 `(app)/+layout.server.ts`에서 서버 사이드 쿠키 검증이 이루어지며, 클라이언트 JavaScript는 토큰값에 접근하지 않는다 | 높음 | DevTools Network 패널 + Cookies 탭 수동 확인 |
| A6 | Refresh 토큰 재사용 감지는 `jti` 블랙리스트에서 동일 `jti` 2회 검증 시도를 감지하는 방식으로 구현된다 | 높음 | 통합 테스트 — 동일 refresh 토큰 2회 요청 시나리오 |

---

## 범위 (Scope)

### 포함 범위 (본 SPEC 산출물)

1. **`packages/db` — `auth_token_blacklist` 테이블 스키마 + 마이그레이션 SQL** — 블랙리스트된 JWT `jti` 저장
2. **`packages/shared` — JWT 유틸리티 모듈** — Access/Refresh 토큰 서명·검증·클레임 파싱
3. **`apps/api` — `requireAuth` Hono 미들웨어** — 쿠키에서 Access 토큰 추출 및 검증
4. **`apps/api` — Auth API 라우트 4종** — `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/refresh`
5. **`apps/api` — 통합 테스트** — Auth 라우트 전체 시나리오 커버
6. **`apps/web` — `/login` 페이지** — `+page.svelte` (폼 UI) + `+page.server.ts` (서버 액션)
7. **`apps/web` — `(app)/+layout.server.ts`** — 보호 라우트 그룹 세션 검증 + 미인증 리다이렉트
8. **`apps/web` — `hooks.server.ts`** — 전역 쿠키 파싱 및 event.locals 주입
9. **`apps/web` — 클라이언트 auth 스토어** — `lib/stores/auth.ts` (UI 상태 관리)
10. **레이트 리미팅** — `POST /api/auth/login` 동일 IP 15분 5회 초과 시 429 응답 (in-memory 구현)

### 제외 범위 (이후 SPEC에서 다룸)

| 기능 | 대상 SPEC | 사유 |
|------|----------|------|
| EdgeAI Box 자격증명 관리 (JWT, API Key 캐싱) | SPEC-BOX-* | Box별 인증은 별도 도메인 |
| 비밀번호 재설정 이메일 플로우 | 차후 SPEC | MVP 범위 초과 |
| 2단계 인증 (2FA, TOTP) | 차후 SPEC | MVP 범위 초과 |
| OAuth / SSO 연동 | 차후 SPEC | MVP 범위 초과 |
| 역할 기반 접근 제어 (RBAC) | 차후 SPEC | 현재 admin 단일 역할만 존재 |
| 회원가입 UI | 차후 SPEC | 현재 seed 스크립트를 통한 관리자 생성만 지원 |

---

## 요구사항 (Requirements)

### 1. 공통 응답 및 토큰 정책

**REQ-AUTH-001** (Ubiquitous)
시스템은 모든 인증 API 오류 응답에 대해 항상 다음 형태의 균일한 오류 봉투를 반환해야 한다:
`{ success: false, error: string, code: string }`

**REQ-AUTH-002** (Ubiquitous)
시스템이 발급하는 Access 토큰은 항상 다음 클레임을 포함해야 한다:
`sub` (사용자 ID), `jti` (ULID, 고유 토큰 식별자), `exp` (발급 시점 + 15분), `iss` ("simple_cctv"), `iat` (발급 시각 Unix timestamp)

**REQ-AUTH-003** (Ubiquitous)
시스템이 발급하는 Refresh 토큰은 항상 다음 클레임을 포함해야 한다:
`sub` (사용자 ID), `jti` (ULID), `exp` (발급 시점 + 7일), `type` ("refresh"), `iss` ("simple_cctv"), `iat` (발급 시각 Unix timestamp)

**REQ-AUTH-004** (Ubiquitous)
시스템이 설정하는 인증 쿠키는 항상 다음 속성을 포함해야 한다:
`HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` (토큰 만료 시간과 일치), `Secure` 플래그 (`NODE_ENV=production` 조건)

**REQ-AUTH-005** (Ubiquitous)
시스템은 로그인 비밀번호 검증 시 항상 bcryptjs의 타이밍 안전(timing-safe) 비교 함수를 사용해야 한다.

**REQ-AUTH-006** (Ubiquitous)
`requireAuth` 미들웨어는 유효한 Access 토큰 쿠키가 없는 요청에 대해 항상 REQ-AUTH-001 형식의 오류 봉투와 함께 HTTP 401 상태 코드를 반환해야 한다.

---

### 2. Auth API 엔드포인트

**REQ-AUTH-007** (Event-Driven)
`POST /api/auth/login` 요청에서 올바른 `username`과 `password`가 제공되면, 시스템은 다음을 수행해야 한다:
- Access 토큰을 담은 `access_token` 쿠키 설정 (Max-Age: 15분)
- Refresh 토큰을 담은 `refresh_token` 쿠키 설정 (Max-Age: 7일)
- 응답 본문에 `{ success: true, user: { id, username } }` 반환

**REQ-AUTH-008** (Event-Driven)
`POST /api/auth/logout` 요청이 수신되면, 시스템은 다음을 수행해야 한다:
- 현재 Access 토큰과 Refresh 토큰의 `jti`를 `auth_token_blacklist` 테이블에 삽입
- `access_token` 및 `refresh_token` 쿠키를 `Max-Age=0`으로 설정하여 만료 처리
- 응답 본문에 `{ success: true }` 반환

**REQ-AUTH-009** (Event-Driven)
유효한 Access 토큰 쿠키와 함께 `GET /api/auth/me` 요청이 수신되면, 시스템은 다음을 반환해야 한다:
`{ success: true, user: { id: string, username: string, email: string } }`

**REQ-AUTH-010** (Event-Driven)
유효한 Refresh 토큰 쿠키와 함께 `POST /api/auth/refresh` 요청이 수신되면, 시스템은 다음을 수행해야 한다:
- 이전 Refresh 토큰의 `jti`를 블랙리스트에 삽입 (rotation)
- 새로운 Access 토큰 및 Refresh 토큰을 발급하여 쿠키 갱신
- 응답 본문에 `{ success: true }` 반환

---

### 3. requireAuth 미들웨어

*(이미 REQ-AUTH-006에서 명세 — 본 절은 추가 행동 규칙을 정의)*

**REQ-AUTH-006** 참조: 미들웨어는 `jti` 블랙리스트 조회를 포함한 전체 토큰 검증을 수행하며, 블랙리스트에 등록된 `jti`는 만료되지 않았더라도 거부한다.

---

### 4. 블랙리스트

**REQ-AUTH-011** (Event-Driven)
`auth_token_blacklist` 테이블에 새 항목이 삽입될 때마다, 시스템은 해당 삽입과 동일한 트랜잭션 내에서 `expires_at` 이 현재 시각 이전인 만료된 항목들을 자동 삭제(cleanup)해야 한다.

---

### 5. SvelteKit 통합

**REQ-AUTH-012** (Event-Driven)
웹 클라이언트에서 `/login` 폼이 제출되면, 시스템은 서버 액션을 통해 `POST /api/auth/login`을 호출하고, 성공 시 쿠키를 설정한 후 `/(app)` 보호 라우트 그룹으로 리다이렉트해야 한다.

**REQ-AUTH-013** (State-Driven)
`/(app)` 보호 라우트 그룹에서 유효한 세션 쿠키가 없는 상태이면, 시스템은 항상 `/login` 경로로 리다이렉트해야 한다.

---

### 6. 보안 가드

**REQ-AUTH-014** (Unwanted)
로그인 실패 시, 시스템은 `username`이 존재하지 않는 경우와 `password`가 틀린 경우를 서로 구분할 수 있는 메시지를 반환해서는 안 된다 (균일한 오류 메시지 "아이디 또는 비밀번호가 올바르지 않습니다").

**REQ-AUTH-015** (Unwanted)
동일 IP 주소에서 15분 이내에 `POST /api/auth/login` 요청이 5회를 초과하면, 시스템은 HTTP 429 상태 코드와 `Retry-After` 헤더를 반환해야 하며, 추가 로그인 시도를 처리해서는 안 된다.

**REQ-AUTH-016** (Unwanted)
`POST /api/auth/refresh` 요청에서 이미 블랙리스트에 등록된 Refresh 토큰의 `jti`가 감지되면, 시스템은 해당 사용자(`sub`)의 모든 활성 Refresh 토큰을 무효화하고 HTTP 401을 반환해야 한다 (재사용 공격 대응).

---

## 명세 (Specifications)

### TokenClaims 인터페이스

```typescript
// packages/shared/src/jwt/index.ts

export interface AccessTokenClaims {
  sub: string;     // 사용자 ID (ULID)
  jti: string;     // 고유 토큰 식별자 (ULID)
  exp: number;     // 만료 시각 (Unix timestamp, 발급 + 15분)
  iss: string;     // "simple_cctv"
  iat: number;     // 발급 시각 (Unix timestamp)
}

export interface RefreshTokenClaims extends AccessTokenClaims {
  type: "refresh"; // Refresh 토큰 구분자
}

export type TokenClaims = AccessTokenClaims | RefreshTokenClaims;
```

### Zod 스키마 및 응답 타입

```typescript
// apps/api/src/routes/auth.ts

import { z } from "zod";

export const LoginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export interface LoginResponse {
  success: true;
  user: { id: string; username: string };
}

export interface MeResponse {
  success: true;
  user: { id: string; username: string; email: string };
}

export interface RefreshResponse {
  success: true;
}
```

### requireAuth 미들웨어 타입 시그니처

```typescript
// apps/api/src/middleware/requireAuth.ts

import type { MiddlewareHandler } from "hono";

// Hono context.var에 주입되는 인증 정보
declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    tokenJti: string;
  }
}

export const requireAuth: MiddlewareHandler;
```

### auth_token_blacklist Drizzle 스키마 요약

```typescript
// packages/db/src/schema/auth.ts

export const authTokenBlacklist = sqliteTable("auth_token_blacklist", {
  id:         text("id").primaryKey(),        // ULID
  jti:        text("jti").notNull().unique(), // 블랙리스트된 토큰 jti
  user_id:    text("user_id").notNull(),      // 소유자 사용자 ID (FK → users)
  expires_at: integer("expires_at").notNull(),// 토큰 만료 시각 (Unix ms)
  created_at: integer("created_at").notNull(),// 삽입 시각 (Unix ms)
});
```

### Cookie 옵션 헬퍼 시그니처

```typescript
// apps/api/src/routes/auth.ts

function buildCookieOptions(maxAgeSeconds: number): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  secure: boolean; // NODE_ENV === "production"
};
```

---

## 용어 사전 (Glossary)

| 용어 | 정의 |
|------|------|
| **JWT** | JSON Web Token — 서명된 클레임 집합을 담는 컴팩트한 토큰 형식 |
| **Access Token** | 단기 유효(15분) 인증 토큰. API 요청 시 쿠키로 전송 |
| **Refresh Token** | 장기 유효(7일) 토큰. Access 토큰 갱신 전용으로만 사용 |
| **jti** | JWT ID — 개별 토큰을 고유하게 식별하는 클레임. 블랙리스트 키로 사용 |
| **Rotation** | Refresh 요청 시 이전 Refresh 토큰을 폐기하고 새 토큰을 발급하는 패턴 |
| **Reuse Detection** | 블랙리스트된 Refresh 토큰 jti의 재사용 시도를 감지하여 전체 세션을 무효화하는 보안 패턴 |
| **HttpOnly Cookie** | JavaScript에서 접근 불가한 쿠키. XSS 공격에서 토큰 탈취를 방지 |
| **SameSite** | CSRF 공격 완화를 위한 쿠키 속성. `Lax`는 최상위 내비게이션 GET 요청은 허용 |
| **requireAuth** | Hono 미들웨어. 보호된 라우트 앞에 체인되어 Access 토큰을 검증 |
| **ULID** | Universally Unique Lexicographically Sortable Identifier — jti 및 DB PK에 사용 |
| **bcrypt** | 단방향 해시 함수. 비밀번호 저장 및 타이밍 안전 비교에 사용 |
| **Token Blacklist** | 로그아웃/폐기된 토큰의 jti를 DB에 기록하여 재사용을 차단하는 메커니즘 |
| **Rate Limiting** | 단위 시간당 요청 횟수를 제한하여 브루트포스 공격을 완화하는 기법 |

---

## 추적성 태그 (Traceability Tags)

```
TAG: SPEC-AUTH-001
DOMAIN: auth
PHASE: feature
PACKAGES: db (auth schema), shared (jwt util), api (auth routes + middleware), web (login page + guards)
EXTERNAL: none (internal auth, not EdgeAI Box auth)
RELATED: SPEC-CORE-001, SPEC-BOX-*
STATUS: Draft (2026-05-12)
DEPENDS_ON: SPEC-CORE-001
```
