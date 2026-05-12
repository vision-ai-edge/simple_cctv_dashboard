---
id: SPEC-BOX-001
version: 0.1.0
status: Draft
created: 2026-05-13
updated: 2026-05-13
author: imgughyeon
priority: High
---

# SPEC-BOX-001: EdgeAI Box 등록 및 자격증명 볼트 — AES-GCM 암호화·헬스체크·상태 폴링

## HISTORY

| 날짜 | 버전 | 변경 사항 | 작성자 |
|------|------|---------|--------|
| 2026-05-13 | 0.1.0 | 초안 작성 | imgughyeon |

---

## 메타데이터

| 항목 | 내용 |
|------|------|
| **SPEC ID** | SPEC-BOX-001 |
| **제목** | EdgeAI Box 등록 및 자격증명 볼트 — AES-GCM 암호화·헬스체크·상태 폴링 |
| **상태** | Draft |
| **우선순위** | High |
| **담당 에이전트** | expert-backend |
| **연관 SPEC** | SPEC-CORE-001 (foundation, 완료), SPEC-AUTH-001 (auth middleware, main 머지 대기), SPEC-BOX-UI-001 (프론트엔드 등록 UI, 이후 SPEC) |
| **작성일** | 2026-05-13 |
| **개발 방법론** | TDD — Hybrid 모드 신규 코드 (RED-GREEN-REFACTOR) |

> **blocked-by**: SPEC-AUTH-001 main 머지 완료. `requireAuth` 미들웨어가 `apps/api`에 존재해야 Box API 라우트 보호가 가능함.

---

## 환경 (Environment)

### 프로젝트 컨텍스트

- **프로젝트**: simple_cctv_dashboard — EdgeAI Box 기반 CCTV 통합 관제 대시보드
- **아키텍처**: Bun Workspace 모노레포 (SPEC-CORE-001에서 완성된 기반 구조 사용)
- **범위**: 백엔드 단독 (apps/api + packages/shared + packages/db). 프론트엔드 등록 UI는 SPEC-BOX-UI-001로 분리

### 워크스페이스 구성 (변경/추가 대상)

```
simple_cctv_dashboard/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── routes/
│       │   │   └── boxes.ts                  # 신규: /api/boxes/* 라우트 5종
│       │   ├── services/
│       │   │   └── boxService.ts             # 신규: 비즈니스 로직 (등록, 목록, 헬스체크 등)
│       │   ├── workers/
│       │   │   └── boxStatusPoller.ts        # 신규: 60초 주기 상태 폴링 워커
│       │   ├── types/
│       │   │   └── env.ts                    # 수정: BOX_VAULT_KEY, BOX_STATUS_POLL_INTERVAL_MS 추가
│       │   └── index.ts                      # 수정: vault key 검증 + poller 부팅
│       └── __tests__/
│           ├── services/
│           │   └── boxService.test.ts        # 신규: 서비스 단위 테스트
│           ├── routes/
│           │   └── boxes.test.ts             # 신규: 라우트 통합 테스트
│           └── workers/
│               └── boxStatusPoller.test.ts   # 신규: 폴러 단위 테스트
├── packages/
│   ├── shared/
│   │   └── src/
│   │       └── crypto/
│   │           └── vault.ts                  # 신규: AES-GCM 암호화/복호화 유틸
│   └── db/
│       └── src/
│           ├── schema/
│           │   └── index.ts                  # 수정: jwt_cached_enc, api_key_cached_enc 컬럼 추가
│           └── migrations/
│               └── 0003_box_vault.sql        # 신규: 암호화 컬럼 마이그레이션
└── .env.example                              # 수정: BOX_STATUS_POLL_INTERVAL_MS 문서화
```

### 런타임 및 표준

- **런타임**: Bun 1.2+, TypeScript 5.9+
- **API 프레임워크**: Hono 4.5+ (기존 사용)
- **DB**: SQLite + Drizzle ORM (bun-sqlite 어댑터, 기존 사용)
- **암호화**: Web Crypto API (`crypto.subtle`, Bun 내장) — AES-256-GCM
- **BoxClient**: `packages/shared`의 `BoxClient` (SPEC-CORE-001 산출물)
- **인증 미들웨어**: `requireAuth` (SPEC-AUTH-001 산출물)
- **보안 표준**: OWASP A02 (Cryptographic Failures) 대응, 자격증명 절대 평문 노출 금지

---

## 가정 (Assumptions)

| 번호 | 가정 | 신뢰도 | 검증 방법 |
|------|------|--------|---------|
| A1 | `packages/shared`의 `BoxClient`가 `auth.login(username, password)`를 지원하며 `{ token }` 응답을 반환한다 | 높음 | SPEC-CORE-001 산출물 타입 확인 |
| A2 | Bun 1.2+의 `crypto.subtle`이 AES-GCM 256비트 암호화를 지원한다 | 높음 | Bun 공식 문서 + 단위 테스트 round-trip 검증 |
| A3 | `BOX_VAULT_KEY`는 32바이트(64자 hex 문자열)이며, API 서버 시작 시 `assertBoxVaultKey`로 검증하여 미충족 시 `process.exit(1)`로 종료한다 | 높음 | 시작 시 유효성 검사 코드 + 단위 테스트 |
| A4 | `boxes` 테이블의 `password_enc` 컬럼(blob)이 이미 존재한다 (SPEC-CORE-001 스키마). `jwt_cached_enc`/`api_key_cached_enc`는 신규 컬럼으로 `0003_box_vault.sql`로 추가된다 | 높음 | 기존 스키마 + `bun run db:migrate` 실행 후 확인 |
| A5 | MVP 단계에서는 boxes 데이터가 없으므로 기존 평문 컬럼(`jwt_cached`, `api_key_cached`)에서 신규 암호화 컬럼으로의 데이터 마이그레이션이 불필요하다 | 높음 | 프로젝트 현황 확인 |
| A6 | `base_url`에 UNIQUE 제약을 적용하여 동일 Box의 중복 등록을 방지한다 | 높음 | DB 스키마 설계 결정 |
| A7 | 상태 폴링 워커는 `setInterval` 기반 단일 인스턴스로 구현하며, 서버 재시작 시 기존 인스턴스를 종료 후 재시작한다 | 높음 | 구현 설계 결정 |
| A8 | `withAuthRetry`의 401 재시도는 1회로 제한하며, 재로그인 실패 시 무한 루프 없이 `status='error'` 전이 후 오류를 전파한다 | 높음 | SPEC-AUTH-001의 무한 재귀 방지 패턴 참조 |

---

## 범위 (Scope)

### 포함 범위 (본 SPEC 산출물)

1. **`packages/shared/src/crypto/vault.ts`** — AES-GCM 자격증명 암호화/복호화 유틸리티
2. **`packages/db/src/migrations/0003_box_vault.sql`** — `jwt_cached_enc`, `api_key_cached_enc` 컬럼 추가 마이그레이션
3. **`packages/db/src/schema/index.ts` 수정** — boxes 테이블에 신규 blob 컬럼 추가
4. **`apps/api/src/services/boxService.ts`** — Box 등록, 조회, 목록, 헬스체크, 토큰 갱신, `withAuthRetry` 401 가드
5. **`apps/api/src/routes/boxes.ts`** — REST API 라우트 5종 (등록/목록/상세/수동갱신/삭제)
6. **`apps/api/src/workers/boxStatusPoller.ts`** — 60초 주기 상태 폴링 워커
7. **`apps/api/src/types/env.ts` 수정** — `BOX_VAULT_KEY`, `BOX_STATUS_POLL_INTERVAL_MS` 환경 변수 추가
8. **`apps/api/src/index.ts` 수정** — 서버 시작 시 `assertBoxVaultKey` 호출, boxStatusPoller 워커 부팅
9. **`.env.example` 수정** — `BOX_STATUS_POLL_INTERVAL_MS` 문서화
10. **단위 + 통합 테스트** — boxService, boxes 라우트, boxStatusPoller, vault 테스트

### 제외 범위 (이후 SPEC에서 다룸)

| 기능 | 대상 SPEC | 사유 |
|------|----------|------|
| Box 등록 프론트엔드 UI (폼 컴포넌트, SvelteKit 라우트) | SPEC-BOX-UI-001 | 백엔드/프론트엔드 역할 분리 |
| Box별 채널 목록 조회 및 스트림 URL 제공 | SPEC-BOX-CHANNELS-001 | 카메라 관련 기능은 별도 SPEC |
| Redis 기반 영속 폴링 상태 관리 | SPEC-OPS-001 | MVP는 in-memory setInterval로 충분 |
| API Key 기반 HLS/WebRTC URL 헬퍼 노출 | SPEC-BOX-CHANNELS-001 | 스트림 URL은 채널 SPEC 범위 |

---

## 요구사항 (Requirements)

### REQ-MOD-1: 자격증명 볼트

**REQ-MOD-1-001** (Ubiquitous)
시스템은 `BOX_VAULT_KEY`(32바이트 hex, 64자)로 모든 Box 자격증명(password, jwt, api key)을 AES-256-GCM 알고리즘으로 암호화하여 boxes 테이블에 저장해야 한다.
- 블롭 포맷: `[12B IV ‖ ciphertext ‖ 16B GCM auth tag]` 단일 `Uint8Array`

**REQ-MOD-1-002** (Unwanted)
시스템은 API 응답 본문, 로그, 에러 메시지 어디에도 복호화된 password/jwt/api_key 원본을 포함하지 않아야 한다.
- 비밀번호 마스킹: API 응답에서 password 필드 완전 생략
- jwt/api_key 마스킹: 응답에 포함 시 마지막 4글자만 노출 (예: `****abcd`) 또는 완전 생략

**REQ-MOD-1-003** (Event-Driven)
API 서버가 시작될 때 `BOX_VAULT_KEY`가 누락되었거나 64자 hex 형식이 아닌 경우, 시스템은 오류 로그를 출력하고 `process.exit(1)`로 즉시 종료해야 한다.

**REQ-MOD-1-004** (Unwanted)
시스템은 `BOX_VAULT_KEY` 값을 로그, 에러 메시지, API 응답에 절대 출력하지 않아야 한다.

---

### REQ-MOD-2: Box 등록 헬스체크

**REQ-MOD-2-001** (Event-Driven)
관리자가 `POST /api/boxes`로 신규 Box 등록을 요청할 때, 시스템은 입력받은 `host`, `port`, `username`, `password`로 EdgeAI Box `/auth/login`을 호출하여 연결성을 검증해야 한다.
- `base_url`은 `https://{host}:{port}/api` 포맷으로 조합한다.

**REQ-MOD-2-002** (Event-Driven)
헬스체크에서 200 응답을 수신할 때, 시스템은 다음을 수행해야 한다:
- 발급된 JWT를 AES-GCM으로 암호화하여 `jwt_cached_enc`에 저장
- `password`를 AES-GCM으로 암호화하여 `password_enc`에 저장
- `status='active'`, `jwt_obtained_at=now()`로 boxes 레코드를 INSERT
- HTTP 201 Created와 함께 마스킹된 Box 정보를 반환

**REQ-MOD-2-003** (Event-Driven)
헬스체크에서 4xx/5xx 응답 또는 네트워크 실패를 수신할 때, 시스템은 boxes 레코드를 생성하지 않고 다음을 반환해야 한다:
- EdgeAI Box 인증 실패(401/403): HTTP 400 Bad Request
- 네트워크 실패 또는 서버 오류(5xx): HTTP 502 Bad Gateway

**REQ-MOD-2-004** (Unwanted)
`base_url`이 이미 존재하는 Box와 동일한 경우, 시스템은 중복 등록을 허용하지 않아야 한다 (UNIQUE 제약 위반 → HTTP 409 Conflict).

---

### REQ-MOD-3: 401 자동 재인증 가드

**REQ-MOD-3-001** (Event-Driven)
`BoxClient`를 통한 EdgeAI Box API 호출이 401 응답을 수신할 때, `boxService.withAuthRetry`는 저장된 `password_enc`를 복호화하여 `/auth/login`으로 1회 자동 재로그인을 수행해야 한다.

**REQ-MOD-3-002** (Event-Driven)
재로그인에 성공할 때, 시스템은 다음을 수행해야 한다:
- 새 JWT를 AES-GCM으로 암호화하여 `jwt_cached_enc` 갱신
- `jwt_obtained_at` 타임스탬프 갱신
- 원본 요청을 1회 재시도

**REQ-MOD-3-003** (Event-Driven)
재로그인에 실패할 때, 시스템은 다음을 수행해야 한다:
- `boxes.status`를 `'error'`로 갱신
- 원본 호출자에게 401 오류를 전파
- 재시도 루프 없이 즉시 종료 (무한 재귀 방지)

---

### REQ-MOD-4: 상태 폴링 워커

**REQ-MOD-4-001** (State-Driven)
`boxes.status`가 `'active'`인 Box가 존재하는 동안, 시스템은 `BOX_STATUS_POLL_INTERVAL_MS`(기본값 60000ms) 간격으로 해당 Box의 `GET /system/health`를 호출해야 한다.

**REQ-MOD-4-002** (Event-Driven)
폴링에서 200 응답을 수신할 때, 시스템은 `boxes.last_sync_at`을 현재 시각으로 갱신하고 `status`를 `'active'`로 유지해야 한다.

**REQ-MOD-4-003** (Event-Driven)
폴링에서 3회 연속 실패할 때, 시스템은 `boxes.status`를 `'error'`로 전이하고 해당 Box에 대한 폴링을 중단해야 한다.

**REQ-MOD-4-004** (Unwanted)
시스템은 `status`가 `'inactive'` 또는 `'error'`인 Box에 대한 폴링을 수행하지 않아야 한다.

---

### REQ-MOD-5: API Key 옵션

**REQ-MOD-5-001** (Optional)
가능하면 등록 요청에 `useApiKey=true`가 포함된 경우, 시스템은 JWT 발급 후 즉시 `POST /auth/apikey/regenerate`를 호출하여 X-API-Key를 발급하고 AES-GCM으로 암호화하여 `api_key_cached_enc`에 저장해야 한다.

**REQ-MOD-5-002** (Optional)
가능하면 HLS playlist/WebRTC player 호출 시, 시스템은 `api_key_cached_enc`가 존재하면 X-API-Key를 JWT보다 우선 사용해야 한다.

---

## 명세 (Specifications)

### vault.ts 인터페이스

```typescript
// packages/shared/src/crypto/vault.ts

/**
 * BOX_VAULT_KEY 유효성 검증
 * 64자 hex 문자열이 아닌 경우 Error를 던진다
 */
export function assertBoxVaultKey(key: string): void;

/**
 * AES-256-GCM으로 평문을 암호화하여 Uint8Array blob 반환
 * blob 포맷: [12B IV | ciphertext | 16B GCM auth tag]
 */
export async function encryptWithVault(
  plaintext: string,
  keyHex: string,
): Promise<Uint8Array>;

/**
 * AES-256-GCM blob을 복호화하여 평문 반환
 * GCM auth tag 검증 실패 시 Error를 던진다
 */
export async function decryptWithVault(
  blob: Uint8Array,
  keyHex: string,
): Promise<string>;
```

### boxService.ts 인터페이스

```typescript
// apps/api/src/services/boxService.ts

export interface RegisterBoxInput {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  useApiKey?: boolean;
}

export interface BoxSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  baseUrl: string;
  username: string;
  status: 'active' | 'inactive' | 'error';
  lastSyncAt: number | null;
  createdAt: number;
  updatedAt: number;
  hasApiKey: boolean;
}

export async function registerBox(input: RegisterBoxInput): Promise<BoxSummary>;
export async function getBox(id: string): Promise<BoxSummary | null>;
export async function listBoxes(): Promise<BoxSummary[]>;
export async function deleteBox(id: string): Promise<void>;
export async function refreshTokens(id: string): Promise<void>;

/**
 * BoxClient 호출을 래핑하여 401 시 자동 재인증 수행
 * 재로그인 실패 시 status='error'로 전이 후 오류 전파
 */
export async function withAuthRetry<T>(
  boxId: string,
  fn: (client: BoxClient) => Promise<T>,
): Promise<T>;
```

### boxes.ts REST API 라우트

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| `POST` | `/api/boxes` | requireAuth | Box 등록 + 헬스체크 |
| `GET` | `/api/boxes` | requireAuth | Box 목록 (자격증명 마스킹) |
| `GET` | `/api/boxes/:id` | requireAuth | Box 상세 (자격증명 마스킹) |
| `POST` | `/api/boxes/:id/refresh` | requireAuth | 수동 토큰 재발급 |
| `DELETE` | `/api/boxes/:id` | requireAuth | Box 삭제 |

### Zod 입력 스키마

```typescript
// apps/api/src/routes/boxes.ts

export const RegisterBoxSchema = z.object({
  name: z.string().min(1).max(64),
  host: z.string().min(1).max(253), // hostname or IP
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
  useApiKey: z.boolean().optional().default(false),
});
```

### DB 스키마 보강 (0003_box_vault.sql)

```sql
-- 0003_box_vault.sql
ALTER TABLE boxes ADD COLUMN jwt_cached_enc BLOB;
ALTER TABLE boxes ADD COLUMN api_key_cached_enc BLOB;
```

### 환경 변수

```bash
# apps/api/.env.example 추가 항목
# Box 자격증명 암호화 키 (32바이트 = 64자 hex 문자열, 필수)
BOX_VAULT_KEY=0000000000000000000000000000000000000000000000000000000000000000

# Box 상태 폴링 주기 (밀리초, 기본값: 60000)
BOX_STATUS_POLL_INTERVAL_MS=60000
```

---

## 용어 사전 (Glossary)

| 용어 | 정의 |
|------|------|
| **볼트(Vault)** | AES-256-GCM으로 암호화된 자격증명 저장소. 본 SPEC에서는 boxes 테이블의 blob 컬럼들을 가리킴 |
| **BOX_VAULT_KEY** | 32바이트(64자 hex) 대칭 암호화 키. 모든 Box 자격증명 암호화/복호화에 사용 |
| **GCM Auth Tag** | AES-GCM의 16바이트 인증 태그. 복호화 시 데이터 무결성을 검증 |
| **IV (Initialization Vector)** | AES-GCM의 12바이트 난수. 암호화마다 새로 생성하여 blob 앞에 저장 |
| **withAuthRetry** | BoxClient 호출을 래핑하는 401 자동 재인증 가드 함수 |
| **boxStatusPoller** | 60초 주기로 active Box의 헬스를 확인하는 백그라운드 워커 |
| **assertBoxVaultKey** | 서버 시작 시 BOX_VAULT_KEY 형식을 검증하는 가드 함수 |
| **EdgeAI Box** | 외부 AI 영상 분석 장비. 본 SPEC에서는 REST API를 통해 자격증명 검증 및 상태 폴링 대상 |
| **BoxClient** | packages/shared의 EdgeAI Box REST API 타입 안전 클라이언트 (SPEC-CORE-001 산출물) |
| **Base URL** | `https://{host}:{port}/api` 형태의 EdgeAI Box API 기준 URL |

---

## 추적성 태그 (Traceability Tags)

```
TAG: SPEC-BOX-001
DOMAIN: box, crypto, worker
PHASE: feature
PACKAGES: shared (vault), db (schema migration), api (routes, service, worker)
EXTERNAL: EdgeAI Box REST API v1.3.6 (/auth/login, /auth/apikey/regenerate, /system/health)
RELATED: SPEC-CORE-001, SPEC-AUTH-001, SPEC-BOX-UI-001, SPEC-BOX-CHANNELS-001
STATUS: Draft (2026-05-13)
DEPENDS_ON: SPEC-CORE-001 (완료), SPEC-AUTH-001 (main 머지 대기)
SECURITY: OWASP A02 Cryptographic Failures
```
