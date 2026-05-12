# SPEC-BOX-001 인수 기준 (acceptance.md)

## HISTORY

| 날짜 | 버전 | 변경 사항 | 작성자 |
|------|------|---------|--------|
| 2026-05-13 | 0.2.0 | 구현 완료 — AC-BOX-001~007, EC-BOX-001~007 전원 (PASS) | imgughyeon |
| 2026-05-13 | 0.1.0 | 초안 작성 | imgughyeon |

---

```
TAG: SPEC-BOX-001
DOMAIN: box, crypto, worker
PHASE: feature
```

---

## 1. 개요

본 문서는 SPEC-BOX-001에서 정의한 EdgeAI Box 등록 및 자격증명 볼트 시스템의 인수 기준을 정의한다. 각 시나리오는 Given-When-Then 형식으로 작성되며, 자동화 가능한 항목은 Vitest 단위/통합 테스트로, 자동화가 어려운 항목은 수동 검증 절차로 구분한다.

**AC ID 체계**: `AC-BOX-XXX` (3자리 숫자 고유 식별자)

---

## 2. 인수 시나리오 (Given-When-Then)

### AC-BOX-001: 정상 등록 — 201 응답 + 암호화 저장 + 자격증명 비노출

**관련 요구사항**: REQ-MOD-2-001, REQ-MOD-2-002, REQ-MOD-1-002

**Given**
- 관리자 인증된 세션 (`access_token` 쿠키 유효)
- 올바른 EdgeAI Box `host`, `port`, `username`, `password` 입력값
- 올바른 `BOX_VAULT_KEY` (64자 hex)
- BoxClient mock: `auth.login()` → `{ token: "test-jwt-xxxxx" }` 반환

**When** `POST /api/boxes` 요청에 다음 본문을 전송한다
```json
{
  "name": "테스트 박스",
  "host": "192.168.1.100",
  "port": 8443,
  "username": "admin",
  "password": "secret123"
}
```

**Then**
- 응답 상태 코드가 `201 Created`이다
- 응답 본문에 `id`, `name`, `baseUrl`, `username`, `status`, `createdAt`이 포함된다
- 응답 본문에 `password`, `jwt`, `apiKey` 평문이 포함되지 않는다
- DB `boxes` 테이블에 새 레코드가 INSERT되어 있다
- DB `password_enc` 컬럼이 NULL이 아닌 BLOB 값을 가진다
- DB `jwt_cached_enc` 컬럼이 NULL이 아닌 BLOB 값을 가진다
- DB `status` 컬럼이 `'active'`이다
- DB `jwt_obtained_at` 컬럼이 NULL이 아닌 타임스탬프이다
- `base_url`이 `https://192.168.1.100:8443/api` 형식으로 저장되어 있다

**검증 방법**: Vitest 통합 테스트 — `apps/api/__tests__/routes/boxes.test.ts`

---

### AC-BOX-002: 헬스체크 실패 — 400 응답 + DB 레코드 미생성

**관련 요구사항**: REQ-MOD-2-003

**Given**
- 관리자 인증된 세션
- BoxClient mock: `auth.login()` → `BoxApiError(statusCode: 401, message: "Unauthorized")` 던짐

**When** `POST /api/boxes` 요청에 잘못된 password를 포함한 본문을 전송한다
```json
{
  "name": "실패 박스",
  "host": "192.168.1.100",
  "port": 8443,
  "username": "admin",
  "password": "wrong-password"
}
```

**Then**
- 응답 상태 코드가 `400 Bad Request`이다
- 응답 본문이 `{ success: false, error: string, code: string }` 형식이다
- DB `boxes` 테이블에 신규 레코드가 존재하지 않는다 (DB rollback 또는 미INSERT 확인)

**추가 검증 (네트워크 실패)**:
- BoxClient mock이 `fetch failed` 네트워크 에러를 던지는 경우 → `502 Bad Gateway` 반환

**검증 방법**: Vitest 통합 테스트

---

### AC-BOX-003: 401 자동 재인증 — 토큰 갱신 후 원본 요청 재시도

**관련 요구사항**: REQ-MOD-3-001, REQ-MOD-3-002

**Given**
- DB에 이미 등록된 Box (`status='active'`, `password_enc` 존재, `jwt_cached_enc` 존재)
- Box의 캐시된 JWT가 EdgeAI Box 측에서 무효화된 상태
- BoxClient mock 설정:
  1. 첫 번째 `channels.listChannels()` 호출 → `BoxApiError(statusCode: 401)` 던짐
  2. `auth.login()` 재로그인 → `{ token: "new-jwt-yyyyy" }` 반환
  3. 두 번째 `channels.listChannels()` 호출 → 정상 응답 반환

**When** `boxService.withAuthRetry(boxId, client => client.channels.listChannels())`를 호출한다

**Then**
- 정상 채널 목록이 반환된다 (두 번째 시도 성공)
- DB `jwt_cached_enc` 컬럼이 새 JWT로 갱신되어 있다 (복호화하면 `"new-jwt-yyyyy"`)
- DB `jwt_obtained_at` 타임스탬프가 갱신되어 있다
- `auth.login()` mock이 정확히 1회 호출되었다
- `channels.listChannels()` mock이 정확히 2회 호출되었다

**검증 방법**: Vitest 단위 테스트 — `apps/api/__tests__/services/boxService.test.ts`

---

### AC-BOX-004: 401 재인증 실패 — status='error' 전이 + 오류 전파

**관련 요구사항**: REQ-MOD-3-003

**Given**
- DB에 이미 등록된 Box (`status='active'`)
- BoxClient mock 설정:
  1. 첫 번째 호출 → `BoxApiError(statusCode: 401)` 던짐
  2. `auth.login()` 재로그인 → `BoxApiError(statusCode: 401)` 던짐 (재인증 실패)

**When** `boxService.withAuthRetry(boxId, fn)`을 호출한다

**Then**
- 오류가 호출자에게 전파된다 (401 관련 에러)
- DB `boxes.status`가 `'error'`로 갱신되어 있다
- `auth.login()` mock이 정확히 1회만 호출되었다 (무한 루프 없음)
- `fn()` mock이 정확히 1회만 호출되었다 (재시도 없음)

**검증 방법**: Vitest 단위 테스트

---

### AC-BOX-005: 상태 폴링 워커 — 200 응답 시 last_sync_at 갱신

**관련 요구사항**: REQ-MOD-4-001, REQ-MOD-4-002

**Given**
- DB에 `status='active'` Box 1개
- `BOX_STATUS_POLL_INTERVAL_MS=100` (테스트용 단축 주기)
- BoxClient mock: `system.health()` → `{ status: "ok" }` 반환

**When** `startBoxStatusPoller(100)`을 호출하고 100ms 이상 경과한다

**Then**
- `system.health()` mock이 1회 이상 호출되었다
- DB `boxes.last_sync_at`이 폴러 실행 전보다 최신 타임스탬프로 갱신되어 있다
- DB `boxes.status`가 `'active'`로 유지된다

**검증 방법**: Vitest 단위 테스트 (`vi.useFakeTimers()` 활용) — `apps/api/__tests__/workers/boxStatusPoller.test.ts`

---

### AC-BOX-006: 상태 폴링 워커 — 3회 연속 실패 시 status='error' 전이

**관련 요구사항**: REQ-MOD-4-003, REQ-MOD-4-004

**Given**
- DB에 `status='active'` Box 1개
- BoxClient mock: `system.health()` → 연속으로 에러 던짐 (3회)

**When** 폴러가 3회 실패를 누적한다

**Then**
- DB `boxes.status`가 `'error'`로 갱신된다
- 이후 폴링에서 해당 Box의 `system.health()`가 더 이상 호출되지 않는다
- `status='inactive'` 또는 `status='error'` Box는 폴링 대상에서 제외된다

**검증 방법**: Vitest 단위 테스트 (`vi.useFakeTimers()` 활용)

---

### AC-BOX-007: 자격증명 비노출 — GET 응답 보안 검증

**관련 요구사항**: REQ-MOD-1-002

**Given**
- DB에 등록 완료된 Box (password, jwt, api_key 모두 암호화 저장)

**When** 다음 두 요청을 각각 전송한다
- `GET /api/boxes` (목록 조회)
- `GET /api/boxes/:id` (상세 조회)

**Then** 각 응답에서 다음을 확인한다
- `password` 필드가 응답 JSON에 존재하지 않는다
- `jwt`, `jwtCached`, `jwt_cached` 필드가 응답 JSON에 존재하지 않는다
- `apiKey`, `api_key`, `apiKeyCached`, `api_key_cached` 필드가 응답 JSON에 존재하지 않는다
- `username`, `host`, `port`, `status`, `lastSyncAt`, `hasApiKey`는 포함되어 있다

**검증 방법**: Vitest 통합 테스트 (응답 JSON 키 목록 명시적 검증)

---

## 3. 엣지 케이스 시나리오

### EC-BOX-001: BOX_VAULT_KEY 누락 시 서버 시작 거부

**시나리오**: `BOX_VAULT_KEY` 환경 변수 미설정 또는 63자 hex로 설정 후 서버 시작 시도  
**기대 결과**: `assertBoxVaultKey` 에러 → `process.exit(1)` 호출, 서버 미시작  
**검증 방법**: Vitest (process.exit mock: `vi.spyOn(process, 'exit')`)

---

### EC-BOX-002: AES-GCM auth tag 검증 실패

**시나리오**: DB의 `password_enc` blob을 직접 수정하여 auth tag를 손상시킨 후 Box 조회 또는 폴링 시도  
**기대 결과**: 복호화 에러 발생 → `boxes.status='error'` 전이, 에러 로그 출력 (평문 미노출)  
**검증 방법**: Vitest (vault.test.ts에서 auth tag 변조 케이스 직접 테스트)

---

### EC-BOX-003: 동일 base_url 중복 등록

**시나리오**: 이미 등록된 Box와 동일한 `host:port` 조합으로 `POST /api/boxes` 요청  
**기대 결과**: HTTP `409 Conflict`, `{ success: false, error: "이미 등록된 Box입니다", code: "BOX_ALREADY_EXISTS" }`  
**검증 방법**: Vitest 통합 테스트 (UNIQUE 제약 위반 케이스)

---

### EC-BOX-004: 필수 필드 누락 — Zod 검증 오류

**시나리오**: `POST /api/boxes` 요청에서 `host` 또는 `port` 누락  
**기대 결과**: HTTP `422` (또는 `400`), `{ success: false, error: ..., code: "VALIDATION_ERROR" }` + 누락 필드 명시  
**검증 방법**: Vitest 통합 테스트

---

### EC-BOX-005: API Key 옵션 등록

**시나리오**: `useApiKey: true`를 포함한 `POST /api/boxes` 요청  
**기대 결과**:
- BoxClient mock: `auth.login()` → token 반환, `auth.regenerateApiKey()` → `{ apiKey: "test-apikey" }` 반환
- DB `api_key_cached_enc` 컬럼이 NULL이 아닌 BLOB 값을 가진다
- 응답 본문에 `hasApiKey: true`가 포함된다  
**검증 방법**: Vitest 통합 테스트

---

### EC-BOX-006: BOX_VAULT_KEY 변경 후 기존 자격증명 복호화 실패

**시나리오**: 기존 KEY로 암호화된 blob을 다른 KEY로 복호화 시도  
**기대 결과**: `decryptWithVault` 에러 발생 → HTTP 500 또는 Box status='error' 전이  
**검증 방법**: Vitest 단위 테스트 (vault.test.ts — 다른 key로 복호화 케이스)

---

### EC-BOX-007: 폴러 다중 실행 방지

**시나리오**: `startBoxStatusPoller()` 함수를 서버 재시작 없이 2회 연속 호출  
**기대 결과**: 두 번째 호출 시 경고 로그 출력 후 기존 인스턴스 유지 (중복 폴링 없음)  
**검증 방법**: Vitest 단위 테스트 (workerInstance 싱글톤 검증)

---

## 4. 성능 및 품질 게이트

| 항목 | 기준 | 측정 방법 |
|------|------|---------|
| 단위 + 통합 테스트 커버리지 (box 도메인) | **85% 이상** | `bun test --coverage` |
| `encryptWithVault` + `decryptWithVault` 성능 | **1회당 10ms 이내** | Vitest benchmark 또는 수동 측정 |
| `POST /api/boxes` P95 응답 시간 | **500ms 이내** (EdgeAI Box 로그인 포함) | Vitest benchmark 또는 수동 측정 |
| LSP 에러 수 (run phase) | **0** | `bun run typecheck` |
| 타입 에러 수 | **0** | `bun run typecheck` |
| Biome 린트 오류 수 | **0** | `bun run lint` |
| Biome 포맷 이상 | **없음** | `bun run format --check` |
| 기존 SPEC-CORE-001 + SPEC-AUTH-001 테스트 | **전원 유지 통과** | `bun test` |

---

## 5. 보안 검증 체크리스트

구현 완료 후 의무적으로 검증해야 한다.

| 항목 | 검증 방법 | 합격 기준 |
|------|---------|---------|
| API 응답에 password/jwt/api_key 평문 미포함 | Vitest 자동 검증 (AC-BOX-007) + 수동 `curl` 확인 | 응답 JSON에 해당 필드 존재하지 않음 |
| DB에 자격증명 평문 미저장 | SQLite Browser 또는 Drizzle Studio로 직접 확인 | `password_enc`, `jwt_cached_enc` 컬럼이 binary blob으로 표시 |
| BOX_VAULT_KEY 로그 미출력 | 서버 실행 로그 전체 grep으로 확인 | KEY 값이 로그에 없음 |
| AES-GCM round-trip 무결성 | Vitest 자동 (AC-BOX-001 + vault.test.ts) | 복호화 값이 원본 평문과 동일 |
| 서버 시작 시 BOX_VAULT_KEY 검증 | EC-BOX-001 Vitest 테스트 통과 | 잘못된 KEY 시 process.exit(1) 호출 |
| withAuthRetry 무한 루프 없음 | AC-BOX-004 Vitest 테스트 통과 | auth.login mock 1회만 호출 확인 |

---

## 6. 수동 검증 항목

자동화 테스트로 커버하기 어려운 항목이다. 구현 완료 후 담당자가 직접 확인한다.

| 항목 | 절차 | 합격 기준 |
|------|------|---------|
| 실제 EdgeAI Box 연결 등록 | 실제 Box 장비로 `POST /api/boxes` 요청 | 201 응답, DB 레코드 확인, Box 정상 폴링 시작 |
| DB blob 직접 확인 | Drizzle Studio 또는 `bun run db:studio`로 boxes 테이블 확인 | `password_enc`, `jwt_cached_enc`가 binary blob으로 저장 (hex 뷰어로 IV + ciphertext 구조 확인) |
| 폴러 동작 로그 확인 | 서버 실행 후 60초 경과 후 로그 확인 | `[poller] boxId: xxx health OK, last_sync_at updated` 로그 출력 |
| 서버 재시작 후 폴러 재기동 | 서버 재시작 후 60초 경과 | 폴러가 정상적으로 재기동되어 폴링 로그 출력 |
