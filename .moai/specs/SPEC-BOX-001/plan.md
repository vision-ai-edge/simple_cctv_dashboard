# SPEC-BOX-001 구현 계획 (plan.md)

```
TAG: SPEC-BOX-001
DOMAIN: box, crypto, worker
PHASE: feature
```

---

## 1. 구현 개요

본 계획은 SPEC-BOX-001에서 정의한 EdgeAI Box 등록 및 자격증명 볼트 시스템을 구현하기 위한 태스크 분해와 기술 방향을 제시한다. 구현 범위는 `packages/shared` vault 암호화 유틸, `packages/db` 스키마 보강, `apps/api` boxService + 라우트 5종 + 상태 폴링 워커로 구성되며, 모든 신규 코드는 Hybrid 모드 하의 TDD(RED-GREEN-REFACTOR) 사이클을 따른다.

> **전제 조건**: SPEC-AUTH-001이 main 브랜치에 머지되어 `requireAuth` 미들웨어가 사용 가능한 상태여야 한다.

---

## 2. 의존성 그래프

```
T1 (vault.ts)
  └── T2 (DB 스키마 보강)
        └── T3 (boxService.ts)
              ├── T4 (boxes.ts 라우트)
              └── T5 (boxStatusPoller.ts)
                    └── T6 (index.ts 통합 + env.ts)
                          └── T7 (통합 테스트 보완)
```

---

## 3. 태스크 분해

### T1 — packages/shared: vault.ts AES-GCM 유틸

- **담당 에이전트**: expert-backend
- **의존성**: 없음 (독립 실행 가능)
- **대상 파일**:
  - 생성: `packages/shared/src/crypto/vault.ts`
  - 생성: `packages/shared/__tests__/crypto/vault.test.ts`
  - 수정: `packages/shared/src/index.ts` (crypto/vault re-export 추가)
- **TDD 순서**:
  - RED: `encryptWithVault` → `decryptWithVault` round-trip 검증 테스트 작성 (평문 복원, auth tag 조작 시 에러)
  - RED: `assertBoxVaultKey` — 64자 hex 유효 케이스, 63자/65자/비hex 거부 케이스 테스트 작성
  - GREEN: Web Crypto API (`crypto.subtle.importKey`, `crypto.subtle.encrypt`, `crypto.subtle.decrypt`) 구현
  - REFACTOR: IV 생성 로직 추출, 에러 메시지 구체화
- **예상 산출물**:
  - `assertBoxVaultKey(key: string): void`
  - `encryptWithVault(plaintext: string, keyHex: string): Promise<Uint8Array>`
  - `decryptWithVault(blob: Uint8Array, keyHex: string): Promise<string>`
- **구현 참고**:
  ```typescript
  // blob 포맷: [12B IV | ciphertext | 16B GCM auth tag]
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', hexToBuffer(keyHex), 'AES-GCM', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(plaintext));
  // encrypted는 [ciphertext + 16B auth tag] — IV를 앞에 prepend
  return concat(iv, new Uint8Array(encrypted));
  ```

---

### T2 — packages/db: 스키마 보강 + 마이그레이션

- **담당 에이전트**: expert-backend
- **의존성**: 없음 (T1과 병렬 실행 가능)
- **대상 파일**:
  - 생성: `packages/db/src/migrations/0003_box_vault.sql`
  - 수정: `packages/db/src/schema/index.ts` (boxes 테이블에 `jwt_cached_enc`, `api_key_cached_enc` blob 컬럼 추가)
- **TDD 순서**:
  - RED: 마이그레이션 적용 후 `jwt_cached_enc`, `api_key_cached_enc` 컬럼 존재 확인 테스트 작성
  - GREEN: SQL 마이그레이션 파일 작성, Drizzle 스키마 컬럼 추가
  - REFACTOR: 기존 `jwt_cached text`, `api_key_cached text` 컬럼은 코드에서 신규 컬럼 우선 사용 (backward compat)
- **마이그레이션 SQL**:
  ```sql
  -- 0003_box_vault.sql
  ALTER TABLE boxes ADD COLUMN jwt_cached_enc BLOB;
  ALTER TABLE boxes ADD COLUMN api_key_cached_enc BLOB;
  ```
- **롤백 SQL**:
  ```sql
  -- 0003_box_vault_down.sql (필요 시)
  -- SQLite는 DROP COLUMN을 지원하지 않으므로 테이블 재생성 필요
  ```

---

### T3 — apps/api: boxService.ts 비즈니스 로직

- **담당 에이전트**: expert-backend
- **의존성**: T1 완료, T2 완료
- **대상 파일**:
  - 생성: `apps/api/src/services/boxService.ts`
  - 생성: `apps/api/__tests__/services/boxService.test.ts`
- **TDD 순서**:
  - RED: `registerBox` — BoxClient.auth.login mock 성공 시 DB INSERT + 암호화 저장 검증 테스트 작성
  - RED: `registerBox` — BoxClient.auth.login mock 실패(401) 시 400 에러 전파 테스트 작성
  - RED: `withAuthRetry` — 첫 호출 401 → 재로그인 → 재시도 성공/실패 플로우 테스트 작성
  - GREEN: boxService 전체 구현
  - REFACTOR: `createBoxClient` 인스턴스 생성 로직 분리 (`getBoxClient(boxId)` 헬퍼)
- **주요 함수**:
  - `registerBox(input)`: BoxClient 생성 → `/auth/login` 호출 → 결과 암호화 → DB INSERT → `BoxSummary` 반환
  - `withAuthRetry<T>(boxId, fn)`: fn 호출 → BoxApiError.statusCode === 401 시 재로그인 → fn 재호출 (1회 한정)
  - `refreshTokens(id)`: 저장된 password 복호화 → `/auth/login` 재호출 → jwt_cached_enc 갱신

---

### T4 — apps/api: boxes.ts 라우트 5종

- **담당 에이전트**: expert-backend
- **의존성**: T3 완료
- **대상 파일**:
  - 생성: `apps/api/src/routes/boxes.ts`
  - 생성: `apps/api/__tests__/routes/boxes.test.ts`
  - 수정: `apps/api/src/app.ts` (boxes 라우터 마운트 `/api`)
- **TDD 순서**:
  - RED: POST /api/boxes — 201 응답, DB 레코드 존재, 응답에 password 미포함 테스트 작성
  - RED: POST /api/boxes — BoxClient 401 → 400 응답, DB 레코드 미생성 테스트 작성
  - RED: GET /api/boxes/:id — 자격증명 마스킹 확인 테스트 작성
  - RED: POST /api/boxes/:id/refresh — 토큰 갱신 성공/실패 테스트 작성
  - RED: DELETE /api/boxes/:id — 삭제 확인 테스트 작성
  - GREEN: 라우트 5종 구현 (Zod 검증 포함)
  - REFACTOR: 공통 응답 헬퍼 추출, 에러 봉투 일관성 확인
- **라우트 목록**:
  - `POST /api/boxes` — `requireAuth` + `RegisterBoxSchema` 검증 → `registerBox()` 호출 → 201
  - `GET /api/boxes` — `requireAuth` → `listBoxes()` → 자격증명 완전 생략
  - `GET /api/boxes/:id` — `requireAuth` → `getBox(id)` → 자격증명 완전 생략
  - `POST /api/boxes/:id/refresh` — `requireAuth` → `refreshTokens(id)` → 200
  - `DELETE /api/boxes/:id` — `requireAuth` → `deleteBox(id)` → 204

---

### T5 — apps/api: boxStatusPoller.ts 워커

- **담당 에이전트**: expert-backend
- **의존성**: T3 완료
- **대상 파일**:
  - 생성: `apps/api/src/workers/boxStatusPoller.ts`
  - 생성: `apps/api/__tests__/workers/boxStatusPoller.test.ts`
- **TDD 순서**:
  - RED: 폴러 시작 → active Box에 대해 `/system/health` 호출 확인 테스트 작성
  - RED: 200 응답 → `last_sync_at` 갱신, status='active' 유지 테스트 작성
  - RED: 3회 연속 실패 → status='error' 전이, 폴링 중단 테스트 작성
  - RED: inactive/error Box는 폴링 대상 제외 테스트 작성
  - GREEN: setInterval 기반 폴러 구현 (연속 실패 카운터 Map<boxId, number> 관리)
  - REFACTOR: 폴러 cleanup 함수 분리 (`stopBoxStatusPoller(): void`)
- **예상 산출물**:
  - `startBoxStatusPoller(intervalMs?: number): () => void` (cleanup 함수 반환)
  - 연속 실패 카운터: `Map<string, number>` — 성공 시 초기화, 실패 시 증가, 3 도달 시 error 전이

---

### T6 — apps/api: index.ts + env.ts 통합

- **담당 에이전트**: expert-backend
- **의존성**: T1, T5 완료
- **대상 파일**:
  - 수정: `apps/api/src/types/env.ts`
  - 수정: `apps/api/src/index.ts`
  - 수정: `.env.example`
- **변경 내용**:
  - `env.ts`: `BOX_VAULT_KEY` (string, 필수), `BOX_STATUS_POLL_INTERVAL_MS` (number, 기본 60000) 추가
  - `index.ts`: 서버 시작 시 `assertBoxVaultKey(env.BOX_VAULT_KEY)` 호출 → 실패 시 exit(1)
  - `index.ts`: 서버 시작 성공 후 `startBoxStatusPoller(env.BOX_STATUS_POLL_INTERVAL_MS)` 호출
  - `.env.example`: `BOX_VAULT_KEY`, `BOX_STATUS_POLL_INTERVAL_MS` 항목 추가
- **TDD**: `assertBoxVaultKey` 단위 테스트는 T1에서 커버. `index.ts` 통합은 기존 서버 시작 테스트에 vault key 검증 케이스 추가.

---

### T7 — 보완 테스트 및 보안 검증

- **담당 에이전트**: expert-testing
- **의존성**: T4, T5, T6 완료
- **대상 파일**:
  - 수정: `apps/api/__tests__/routes/boxes.test.ts` (보안 케이스 추가)
  - 수정: `packages/shared/__tests__/crypto/vault.test.ts` (auth tag 조작 케이스)
- **추가 테스트 항목**:
  - AES-GCM auth tag 1비트 변조 시 복호화 에러 발생 확인
  - 동일 Base URL 중복 등록 시 409 응답 확인
  - API 응답 전체 필드에 `password`, `jwt`, `api_key` 평문 미포함 자동 검증
  - 폴러 다중 실행 방지 (startBoxStatusPoller 2회 호출 시 경고 로그 + 기존 인스턴스 유지)
- **예상 산출물**: 전체 커버리지 85% 달성 확인 (`bun test --coverage`)

---

## 4. 기술 스택 및 의존성

| 패키지/모듈 | 버전 | 용도 | 비고 |
|------------|------|------|------|
| Web Crypto API (`crypto.subtle`) | Bun 내장 | AES-256-GCM 암호화 | 신규 의존성 없음 |
| Hono | ^4.5 | API 라우팅 | 기존 사용 |
| Drizzle ORM | 기존 | DB 쿼리 | 기존 사용 |
| Zod | ^4.0 | 입력 검증 | 기존 사용 |
| BoxClient | packages/shared | EdgeAI Box API 호출 | SPEC-CORE-001 산출물 |
| requireAuth | apps/api middleware | 라우트 보호 | SPEC-AUTH-001 산출물 |
| Vitest | 기존 | 단위/통합 테스트 | 기존 사용 |

**신규 추가 외부 패키지: 없음** (Web Crypto API는 Bun 내장)

---

## 5. 마이그레이션 전략

### DB 마이그레이션

- **파일**: `0003_box_vault.sql` — `ALTER TABLE boxes ADD COLUMN` 2건
- **적용 명령**: `bun run db:migrate` (기존 마이그레이션 러너 재사용)
- **롤백**: SQLite `DROP COLUMN` 미지원으로 테이블 재생성 방식 사용. MVP 단계에서 boxes 데이터 없으므로 롤백 시 `DROP TABLE boxes` + `CREATE TABLE boxes` 재실행 가능
- **기존 데이터**: `jwt_cached (text)`, `api_key_cached (text)` 컬럼 보존 (코드에서 신규 enc 컬럼 우선 참조)

### 코드 이관

- `encryptWithVault` / `decryptWithVault`를 boxService에서 직접 사용
- 기존 `boxes.jwt_cached` 평문 컬럼은 읽기 코드에서 제거 (enc 컬럼 전용)
- `boxes.api_key_cached` 평문 컬럼도 동일하게 enc 컬럼 전용

---

## 6. 위험 및 완화

| ID | 위험 | 영향 | 완화 방안 |
|----|------|------|---------|
| R1 | BOX_VAULT_KEY 유출 시 모든 Box 자격증명 복호화 가능 | 높음 | 환경 변수로만 관리, 로깅 절대 금지, `.env` gitignore, 시작 시 형식 검증 |
| R2 | GCM auth tag 검증 실패 (키 불일치 또는 blob 손상) | 중간 | 복호화 실패 시 status='error' 전이 + 에러 로그 (평문 미노출) |
| R3 | withAuthRetry 재시도 중 무한 루프 | 높음 | 재시도 1회 고정 + 실패 시 즉시 status='error' 전이 (SPEC-AUTH-001 패턴 참조) |
| R4 | 폴링 워커 다중 인스턴스 (서버 재시작 시) | 중간 | 싱글톤 패턴으로 workerInstance 변수 관리, 2회 시작 시 경고 + 기존 인스턴스 유지 |
| R5 | SQLite UNIQUE 제약 경쟁 조건 (동시 등록) | 낮음 | Drizzle INSERT + UNIQUE 제약 → 409 응답. SQLite 단일 쓰기 잠금으로 실질 위험 낮음 |

---

## 7. TDD 사이클 적용 예시

### T1 vault.ts — RED 단계 예시

```typescript
// packages/shared/__tests__/crypto/vault.test.ts
import { describe, it, expect } from "vitest";
import { encryptWithVault, decryptWithVault, assertBoxVaultKey } from "../../src/crypto/vault";

const TEST_KEY = "a".repeat(64); // 64자 hex (실제 hex 아님이지만 형식 검증 통과)

describe("assertBoxVaultKey", () => {
  it("64자 hex 문자열은 통과해야 한다", () => {
    expect(() => assertBoxVaultKey("0".repeat(64))).not.toThrow();
  });

  it("63자 문자열은 에러를 던져야 한다", () => {
    expect(() => assertBoxVaultKey("0".repeat(63))).toThrow();
  });
});

describe("encryptWithVault / decryptWithVault round-trip", () => {
  it("암호화 후 복호화하면 원본 평문이 복원되어야 한다", async () => {
    const plaintext = "my-secret-password";
    const blob = await encryptWithVault(plaintext, TEST_KEY);
    const result = await decryptWithVault(blob, TEST_KEY);
    expect(result).toBe(plaintext);
  });

  it("auth tag 조작 시 복호화 에러가 발생해야 한다", async () => {
    const blob = await encryptWithVault("secret", TEST_KEY);
    blob[blob.length - 1] ^= 0xff; // auth tag 마지막 바이트 변조
    await expect(decryptWithVault(blob, TEST_KEY)).rejects.toThrow();
  });
});
```

### T3 boxService.ts — RED 단계 예시

```typescript
// apps/api/__tests__/services/boxService.test.ts
import { describe, it, expect, vi } from "vitest";
import { registerBox } from "../../src/services/boxService";

vi.mock("../../src/services/boxService", async (importOriginal) => {
  // BoxClient mock
});

describe("registerBox", () => {
  it("헬스체크 성공 시 boxes 레코드가 INSERT되어야 한다", async () => {
    // Given: BoxClient.auth.login mock → { token: "test-jwt" }
    // When: registerBox 호출
    // Then: DB에 boxes 레코드 존재, password_enc/jwt_cached_enc blob 저장
  });

  it("헬스체크 401 실패 시 400 에러를 던지고 DB 레코드가 없어야 한다", async () => {
    // Given: BoxClient.auth.login mock → BoxApiError(401)
    // When: registerBox 호출
    // Then: 400 에러 전파, DB boxes 레코드 없음
  });
});
```

---

## 8. 품질 게이트

TRUST 5 프레임워크를 box 도메인에 다음과 같이 적용한다:

| 차원 | 적용 방식 |
|------|---------|
| **Tested** | 단위+통합 테스트 커버리지 85% 이상. AES-GCM round-trip 검증, 401 가드 mock 테스트 포함. `bun test --coverage` 통과 |
| **Readable** | Biome 린트 0 오류. 한국어 주석. 함수명은 동사+명사 패턴 (`registerBox`, `withAuthRetry`, `encryptWithVault`) |
| **Unified** | `bun run format` 실행 후 변경 없음. BoxClient/BoxApiError 기존 패턴 재사용 |
| **Secured** | 자격증명 절대 평문 노출 금지. BOX_VAULT_KEY 로깅 금지. OWASP A02 대응. API 응답 자동 마스킹 검증 |
| **Trackable** | 커밋 메시지 Conventional Commits (`feat(box): ...`), SPEC-BOX-001 참조 |

---

## 9. 마일스톤

### Primary Goal (핵심 기능)

- T1: vault.ts AES-GCM 유틸 + 단위 테스트
- T2: DB 스키마 보강 마이그레이션
- T3: boxService.ts (registerBox, withAuthRetry)
- T4: boxes.ts 라우트 5종 + 통합 테스트

### Secondary Goal (상태 폴링)

- T5: boxStatusPoller.ts 워커
- T6: index.ts 통합 + env.ts 환경 변수

### Final Goal (품질 완성)

- T7: 보완 테스트 + 전체 커버리지 85% 달성
- 보안 검증 체크리스트 완료

### Optional Goal (향후 SPEC)

- SPEC-BOX-UI-001: 프론트엔드 등록 UI
- SPEC-BOX-CHANNELS-001: 채널 목록 및 스트림 URL

---

## 10. 다음 단계

구현 시작 명령:

```
/moai run SPEC-BOX-001
```

구현 완료 후 동기화:

```
/moai sync SPEC-BOX-001
```

구현 완료 조건 (Definition of Done):
- `bun test --coverage` 통과 (커버리지 85% 이상)
- `bun run lint` Biome 오류 0건
- `bun run typecheck` 타입 오류 0건
- AES-GCM round-trip 단위 테스트 통과
- 401 가드 시나리오 통합 테스트 통과
- API 응답에 password/jwt/api_key 평문 미포함 자동 검증 통과
- 기존 SPEC-CORE-001 + SPEC-AUTH-001 테스트 전원 유지 통과
