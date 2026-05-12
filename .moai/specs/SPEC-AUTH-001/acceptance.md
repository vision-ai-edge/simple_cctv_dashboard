# SPEC-AUTH-001 인수 기준 (acceptance.md)

```
TAG: SPEC-AUTH-001
DOMAIN: auth
PHASE: feature
```

---

## 1. 개요

본 문서는 SPEC-AUTH-001에서 정의한 JWT HttpOnly 쿠키 기반 인증 시스템의 인수 기준을 정의한다.
각 시나리오는 Given-When-Then 형식으로 작성되며, 자동화 가능한 항목은 Vitest 통합 테스트로, 자동화가 어려운 항목은 수동 검증 절차로 구분한다.

**AC ID 체계**: `AC-AUTH-XXX` (3자리 영문+숫자 고유 식별자)

---

## 2. 인수 시나리오 (Given-When-Then)

### AC-AUTH-001: 로그인 성공 — 쿠키 2종 + 사용자 정보 반환

**관련 요구사항**: REQ-AUTH-007, REQ-AUTH-002, REQ-AUTH-003, REQ-AUTH-004

**Given** 데이터베이스에 `username="admin"`, 올바른 bcrypt 해시 비밀번호를 가진 사용자가 존재한다  
**When** `POST /api/auth/login` 요청에 `{ username: "admin", password: "correct-password" }`를 전송한다  
**Then**
- 응답 상태 코드가 `200`이다
- 응답 본문이 `{ success: true, user: { id: string, username: "admin" } }` 형식이다
- 응답 헤더에 `Set-Cookie: access_token=...`이 포함되며 `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=900`을 포함한다
- 응답 헤더에 `Set-Cookie: refresh_token=...`이 포함되며 `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=604800`을 포함한다
- `access_token`을 디코딩하면 `iss="simple_cctv"`, `exp` = 현재 시각 + 900초(±5초), `jti`가 ULID 형식이다
- `refresh_token`을 디코딩하면 `type="refresh"`, `exp` = 현재 시각 + 604800초(±5초)이다

**검증 방법**: Vitest 통합 테스트 — `apps/api/src/routes/__tests__/auth.integration.test.ts`

---

### AC-AUTH-002: 잘못된 비밀번호 — 균일 오류 메시지

**관련 요구사항**: REQ-AUTH-014, REQ-AUTH-005, REQ-AUTH-001

**Given** 데이터베이스에 `username="admin"` 사용자가 존재한다  
**When** `POST /api/auth/login` 요청에 `{ username: "admin", password: "wrong-password" }`를 전송한다  
**Then**
- 응답 상태 코드가 `401`이다
- 응답 본문이 `{ success: false, error: string, code: string }` 형식이다
- 응답 본문의 `error` 필드가 `"아이디 또는 비밀번호가 올바르지 않습니다"` 이다
- `Set-Cookie` 헤더가 설정되지 않는다

**추가 검증 (존재하지 않는 username)**: `{ username: "nonexistent", password: "any" }` 요청 시에도 동일한 오류 메시지와 `401`을 반환하며, 응답 시간이 비밀번호 불일치 케이스와 통계적으로 구분되지 않아야 한다 (bcryptjs dummy compare 실행 여부 확인)

**검증 방법**: Vitest 통합 테스트

---

### AC-AUTH-003: 필수 필드 누락 — Zod 검증 오류

**관련 요구사항**: REQ-AUTH-001

**Given** 로그인 엔드포인트가 활성화되어 있다  
**When** `POST /api/auth/login` 요청에 `{ username: "" }` (password 누락)를 전송한다  
**Then**
- 응답 상태 코드가 `422` (또는 `400`)이다
- 응답 본문이 `{ success: false, error: string, code: string }` 형식을 따른다
- 응답 본문에 누락된 필드 정보가 포함된다

**추가 검증**: `{}` (모든 필드 누락), `{ username: "a" * 200 }` (길이 초과) 케이스도 동일하게 검증 오류를 반환한다

**검증 방법**: Vitest 통합 테스트

---

### AC-AUTH-004: Refresh 토큰 Rotation — 새 토큰 발급 및 이전 jti 블랙리스트

**관련 요구사항**: REQ-AUTH-010

**Given** 사용자가 로그인하여 유효한 `refresh_token` 쿠키를 보유하고 있다  
**When** `POST /api/auth/refresh` 요청을 `refresh_token` 쿠키와 함께 전송한다  
**Then**
- 응답 상태 코드가 `200`이다
- 응답 본문이 `{ success: true }` 이다
- 응답 헤더에 새로운 `Set-Cookie: access_token=...`이 설정된다
- 응답 헤더에 새로운 `Set-Cookie: refresh_token=...`이 설정된다
- 새 `access_token`의 `jti`가 이전 `access_token`의 `jti`와 다르다
- `auth_token_blacklist` 테이블에 이전 `refresh_token`의 `jti`가 삽입되어 있다

**검증 방법**: Vitest 통합 테스트 (DB 상태 직접 조회 포함)

---

### AC-AUTH-005: Refresh 토큰 재사용 감지 — 전체 세션 무효화

**관련 요구사항**: REQ-AUTH-016

**Given** 사용자가 로그인하여 유효한 `refresh_token`을 보유하고 있으며, 해당 토큰을 1회 사용하여 rotation이 발생했다  
**When** 이미 블랙리스트에 등록된 `refresh_token`의 `jti`로 다시 `POST /api/auth/refresh` 요청을 전송한다  
**Then**
- 응답 상태 코드가 `401`이다
- 응답 본문이 `{ success: false, ... }` 형식이다
- 해당 사용자(`sub`)의 모든 `jti`가 `auth_token_blacklist`에 삽입된다 (전체 세션 무효화)
- 이후 해당 사용자의 기존 Access 토큰으로 `/api/auth/me` 요청 시 `401`을 반환한다

**검증 방법**: Vitest 통합 테스트 (시나리오 시퀀스 테스트)

---

### AC-AUTH-006: 로그아웃 후 세션 완전 무효화

**관련 요구사항**: REQ-AUTH-008, REQ-AUTH-009

**Given** 사용자가 로그인하여 유효한 `access_token` 및 `refresh_token` 쿠키를 보유하고 있다  
**When** `POST /api/auth/logout` 요청을 두 쿠키와 함께 전송한다  
**Then**
- 응답 상태 코드가 `200`이다
- 응답 본문이 `{ success: true }` 이다
- 응답 헤더의 `Set-Cookie`에서 `access_token`과 `refresh_token`의 `Max-Age=0`이 설정된다
- `auth_token_blacklist` 테이블에 `access_token`의 `jti`와 `refresh_token`의 `jti` 모두 삽입된다
- 로그아웃 이후 기존 `access_token` 쿠키로 `GET /api/auth/me` 요청 시 `401`을 반환한다

**검증 방법**: Vitest 통합 테스트 (순차 요청 시나리오)

---

### AC-AUTH-007: requireAuth 미들웨어 — 보호 라우트 차단

**관련 요구사항**: REQ-AUTH-006

**Given** `GET /api/auth/me` 라우트가 `requireAuth` 미들웨어로 보호되어 있다  
**When** `access_token` 쿠키 없이 `GET /api/auth/me` 요청을 전송한다  
**Then**
- 응답 상태 코드가 `401`이다
- 응답 본문이 `{ success: false, error: string, code: string }` 형식이다

**추가 검증**: 만료된 토큰, 서명이 잘못된 토큰, 블랙리스트에 등록된 jti를 가진 토큰 각각에 대해서도 동일하게 `401`을 반환한다

**검증 방법**: Vitest 통합 테스트

---

### AC-AUTH-008: 웹 보호 라우트 리다이렉트

**관련 요구사항**: REQ-AUTH-013

**Given** `/(app)` 경로 그룹이 `+layout.server.ts`로 보호되어 있으며, 브라우저에 유효한 `access_token` 쿠키가 없다  
**When** 인증되지 않은 상태로 `/(app)` 하위 경로(예: `/`)에 접근한다  
**Then**
- HTTP 응답 상태가 `303`(SvelteKit redirect) 이다
- 리다이렉트 대상이 `/login` 이다

**검증 방법**: SvelteKit `+layout.server.ts` 단위 테스트 (load 함수 직접 호출) 또는 Playwright E2E 테스트

---

## 3. 엣지 케이스 시나리오

### EC-AUTH-001: 만료된 Access 토큰으로 /me 호출

**시나리오**: 만료된 `access_token` 쿠키와 함께 `GET /api/auth/me` 요청 시  
**기대 결과**: HTTP `401`, `{ success: false, error: "토큰이 만료되었습니다", code: "TOKEN_EXPIRED" }`  
**검증 방법**: Vitest (토큰 생성 시 `exp`를 과거로 설정)

---

### EC-AUTH-002: 잘못된 서명의 토큰

**시나리오**: 다른 `JWT_SECRET`으로 서명된 `access_token` 쿠키와 함께 요청 시  
**기대 결과**: HTTP `401`, `{ success: false, error: ..., code: "TOKEN_INVALID" }`  
**검증 방법**: Vitest

---

### EC-AUTH-003: 쿠키 누락

**시나리오**: 쿠키 없이 `requireAuth`로 보호된 모든 라우트 요청 시  
**기대 결과**: HTTP `401`, REQ-AUTH-001 오류 봉투 반환  
**검증 방법**: Vitest (AC-AUTH-007에서 이미 커버)

---

### EC-AUTH-004: 중복 로그인 시 이전 토큰 처리

**시나리오**: 이미 로그인된 상태에서 다시 `POST /api/auth/login` 호출 시  
**기대 결과**: 새로운 토큰이 발급되며, 이전 토큰은 현재 SPEC 범위에서 명시적으로 무효화하지 않음 (만료 시간까지 유효). 이 동작은 향후 SPEC에서 명시적 이전 세션 무효화 여부를 결정함  
**검증 방법**: 문서화 (자동 테스트 없음, 향후 SPEC 결정 사항으로 명기)

---

### EC-AUTH-005: 데이터베이스 연결 실패 시 오류 응답

**시나리오**: 블랙리스트 조회 중 DB 오류 발생 시  
**기대 결과**: HTTP `500`, `{ success: false, error: "내부 서버 오류", code: "INTERNAL_ERROR" }` (스택 트레이스 미노출)  
**검증 방법**: Vitest (DB 모킹 — `vi.spyOn`)

---

## 4. 성능 및 품질 게이트

| 항목 | 기준 | 측정 방법 |
|------|------|---------|
| 단위 + 통합 테스트 커버리지 (auth 도메인) | **85% 이상** | `bun test --coverage` |
| `POST /api/auth/login` P95 응답 시간 | **200ms 이내** (bcryptjs 해시 검증 포함) | Vitest benchmark 또는 수동 측정 |
| `GET /api/auth/me` P95 응답 시간 | **50ms 이내** (토큰 검증 + DB 조회) | Vitest benchmark 또는 수동 측정 |
| LSP 에러 수 (run phase) | **0** | `bun run typecheck` |
| 타입 에러 수 | **0** | `bun run typecheck` |
| Biome 린트 오류 수 | **0** | `bun run lint` |
| Biome 포맷 이상 | **없음** | `bun run format --check` |
| bcryptjs cost factor | **10** (기본값 유지) | 코드 리뷰 |
| 기존 SPEC-CORE-001 테스트 (44개) | **전원 유지 통과** | `bun test` |

---

## 5. 보안 검증 체크리스트

아래 항목은 구현 완료 후 의무적으로 검증해야 한다.

| 항목 | 검증 방법 | 합격 기준 |
|------|---------|---------|
| HttpOnly 쿠키만 사용 — 브라우저 JS에서 `document.cookie`로 토큰값 접근 불가 | 브라우저 DevTools Console 수동 확인 | `document.cookie`에 `access_token` 및 `refresh_token` 값 미노출 |
| SameSite=Lax 설정 확인 | DevTools Application → Cookies 탭 수동 확인 | `SameSite: Lax` 표시 |
| production 환경에서 Secure 플래그 설정 | `NODE_ENV=production` 설정 후 응답 헤더 확인 | `Set-Cookie` 헤더에 `Secure` 포함 |
| JWT_SECRET 32바이트 미만 시 서버 시작 거부 | 짧은 secret으로 `bun run dev` 시도 | `process.exit(1)` 및 오류 로그 출력 |
| 로그인 실패 메시지 비구분 | AC-AUTH-002 테스트 통과 확인 | username 없음/비밀번호 틀림 모두 동일 메시지 |
| 레이트 리미팅 동작 확인 | 동일 IP로 6회 연속 로그인 요청 | 6번째 요청에서 `429` + `Retry-After` 헤더 반환 |

---

## 6. 수동 검증 항목

자동화 테스트로 커버하기 어려운 시각적·브라우저 수준의 항목이다. 구현 완료 후 담당자가 직접 확인한다.

| 항목 | 절차 | 합격 기준 |
|------|------|---------|
| 브라우저에서 `/login` 페이지 시각적 확인 | `bun run dev` 후 `http://localhost:5173/login` 접속 | 로그인 폼이 올바르게 렌더링됨 |
| DevTools에서 쿠키 HttpOnly 플래그 확인 | 로그인 성공 후 DevTools → Application → Cookies → localhost 확인 | `access_token`, `refresh_token` 쿠키에 `HttpOnly` 체크박스 활성화 |
| 새로고침 후 세션 유지 확인 | 로그인 후 보호 라우트에서 새로고침(F5) | 로그인 페이지로 리다이렉트되지 않고 현재 페이지 유지 |
| 로그아웃 후 뒤로 가기로 보호 페이지 접근 시도 | 로그아웃 후 브라우저 뒤로 가기 버튼 클릭 | `/login` 으로 리다이렉트되며 이전 보호 페이지 내용이 표시되지 않음 |
