# SPEC-CORE-001: 프로젝트 기반 구조 (Foundation)

## 메타데이터

| 항목 | 내용 |
|------|------|
| **SPEC ID** | SPEC-CORE-001 |
| **제목** | Bun 모노레포 스캐폴딩 및 핵심 패키지 기반 구조 |
| **상태** | Planned |
| **우선순위** | High (Primary Goal) |
| **담당 에이전트** | manager-ddd → expert-backend |
| **연관 SPEC** | SPEC-AUTH-*, SPEC-BOX-*, SPEC-MAP-*, SPEC-LIVE-*, SPEC-MEDIA-*, SPEC-ALERT-*, SPEC-OPS-* |
| **작성일** | 2026-05-12 |

---

## 환경 (Environment)

### 프로젝트 컨텍스트

- **프로젝트**: simple_cctv_dashboard — EdgeAI Box API 기반 CCTV 통합 관제 대시보드
- **아키텍처 패턴**: Bun Workspace 모노레포 (apps/\* + packages/\*)
- **런타임**: Bun 1.2+ (백엔드, 스크립트), Vite 6.0+ (프론트엔드 번들러)
- **언어**: TypeScript 5.9+ (전체 통일)
- **외부 의존**: EdgeAI Box REST API v1.3.6 (OpenAPI 3.0.3 명세 기준)

### 워크스페이스 구성

```
simple_cctv_dashboard/
├── apps/
│   ├── api/          # Bun + Hono 백엔드
│   └── web/          # SvelteKit 프론트엔드
├── packages/
│   ├── shared/       # EdgeAI Box 타입 클라이언트
│   └── db/           # Drizzle ORM + bun:sqlite + 마이그레이션
├── package.json      # 루트 workspaces 설정
├── tsconfig.json     # TypeScript 프로젝트 참조 루트
├── biome.json        # 린트 + 포맷 통합 설정
├── bunfig.toml       # Bun 설정
├── .env.example      # 환경 변수 문서화
└── .gitignore
```

### 외부 API 기준 정보

- **Base URL**: `https://{box-host}:{port}/api`
- **OpenAPI 버전**: 3.0.3 (`/tmp/edgeai_box_openapi.json` 기준)
- **인증 방식** (OR 관계):
  1. JWT Bearer: `POST /auth/login` 발급 → `Authorization: Bearer {token}`
  2. API Key: `POST /auth/apikey/regenerate` 발급 → `X-API-Key: {key}`
  3. JWT Query: `?token={jwt}` (img/video 태그 등 헤더 불가 상황)
  4. API Key Query: `?apikey={key}` (HLS playlist, WebRTC player)
- **에러 봉투**: `{ success: false, message: string, timestamp: number }`

---

## 가정 (Assumptions)

| 번호 | 가정 | 신뢰도 | 검증 방법 |
|------|------|--------|---------|
| A1 | Bun 1.2+ LTS가 개발 머신에 설치되어 있다 | 높음 | `bun --version` 실행 |
| A2 | EdgeAI Box JWT는 만료 시간이 없다 (`expiresAt: null`) | 높음 | OpenAPI 명세 + 실측 |
| A3 | `bun:sqlite`는 Drizzle ORM의 `drizzle-orm/bun-sqlite` 어댑터로 사용 가능하다 | 높음 | Drizzle 공식 문서 |
| A4 | Biome는 ESLint + Prettier를 대체할 수 있으며 Bun 환경과 호환된다 | 높음 | Biome 공식 문서 |
| A5 | shadcn-svelte는 SvelteKit 2.8+ 환경에서 CLI 초기화가 가능하다 | 높음 | shadcn-svelte 문서 |
| A6 | 스캐폴딩 단계에서 실제 Box 서버 연결이 없어도 단위 테스트는 mock으로 가능하다 | 높음 | Vitest mock 전략 |
| A7 | `packages/shared`의 BoxClient는 Node/Bun 표준 `fetch` API를 사용한다 | 높음 | Bun 기본 지원 |
| A8 | 기본 관리자 계정 시드는 환경 변수(`ADMIN_USERNAME`, `ADMIN_PASSWORD`)로 주입된다 | 높음 | 보안 요구사항 |

---

## 범위 (Scope)

### 포함 범위

1. **Bun Workspace 모노레포 스캐폴딩** — 루트 설정 파일 및 4개 서브패키지 골격
2. **`packages/shared` — EdgeAI Box 타입 클라이언트 (`BoxClient`)** — Zod 스키마 + 완전한 타입 메서드
3. **`packages/db` — Drizzle ORM 스키마 및 마이그레이션** — 8개 테이블 정의 + 마이그레이션 러너
4. **`apps/api` 스켈레톤** — Hono + `/health` 엔드포인트 + SQLite 부트스트랩 + 로거
5. **`apps/web` 스켈레톤** — SvelteKit + Tailwind + shadcn-svelte init + hello 라우트
6. **개발 도구 설정** — TypeScript 프로젝트 참조, Biome, `.env.example`, `.gitignore`

### 제외 범위 (이후 SPEC에서 다룸)

| 기능 | 대상 SPEC |
|------|----------|
| 사용자 로그인 UI / 비밀번호 플로우 | SPEC-AUTH-* |
| Box 등록 CRUD UI | SPEC-BOX-* |
| 지도 / 카메라 마커 렌더링 | SPEC-MAP-* |
| HLS/WebRTC 라이브 뷰어 | SPEC-LIVE-* |
| 녹화·스냅샷·타임랩스 브라우저 | SPEC-MEDIA-* |
| AI 검출 알림 폴러 | SPEC-ALERT-* |
| Docker / CI 파이프라인 | SPEC-OPS-* |

---

## 요구사항 (Requirements)

### 1. Bun Workspace 모노레포

**REQ-CORE-001** (Ubiquitous)
시스템은 루트 `package.json`에 `"workspaces": ["apps/*", "packages/*"]`를 항상 포함해야 한다.

**REQ-CORE-002** (Ubiquitous)
시스템은 TypeScript 프로젝트 참조(`references`) 설정을 루트 `tsconfig.json`에 항상 포함해야 한다.

**REQ-CORE-003** (Event-Driven)
`bun install`을 실행하면, 시스템은 4개 서브패키지(`apps/api`, `apps/web`, `packages/shared`, `packages/db`)를 단일 `node_modules` 심볼릭 링크로 연결해야 한다.

**REQ-CORE-004** (Ubiquitous)
시스템은 `biome.json`을 루트에 항상 포함해야 하며, 린트(lint)와 포맷(format)을 단일 설정으로 관리해야 한다.

---

### 2. `packages/shared` — EdgeAI Box 타입 클라이언트

**REQ-BOX-CLIENT-001** (Ubiquitous)
`createBoxClient({ baseUrl, jwt?, apiKey? })` 팩토리 함수는 항상 `BoxClient` 인스턴스를 반환해야 한다.

**REQ-BOX-CLIENT-002** (Ubiquitous)
`BoxClient`는 다음 인증 헤더 전략을 항상 지원해야 한다:
- `jwt` 제공 시 → `Authorization: Bearer {jwt}` 헤더 첨부
- `apiKey` 제공 시 → `X-API-Key: {apiKey}` 헤더 첨부
- 둘 다 없으면 → 인증 없이 요청 (공개 엔드포인트용)

**REQ-BOX-CLIENT-003** (Event-Driven)
API 응답의 `success` 필드가 `false`이면, 클라이언트는 `BoxApiError` 예외를 항상 던져야 한다.
- `BoxApiError`는 `{ message, statusCode, timestamp }` 속성을 포함해야 한다.

**REQ-BOX-CLIENT-004** (Ubiquitous)
다음 엔드포인트 그룹 각각에 대해 Zod 스키마 및 타입 메서드를 항상 제공해야 한다:

| 그룹 | 메서드 | API 경로 (기준: OpenAPI 명세) |
|------|--------|------------------------------|
| **auth** | `login(username, password)` | `POST /auth/login` |
| **auth** | `me()` | `GET /auth/me` |
| **auth** | `regenerateApiKey()` | `POST /auth/apikey/regenerate` |
| **auth** | `changePassword(current, next)` | `POST /auth/change-password` |
| **system** | `health()` | `GET /system/health` |
| **system** | `info()` | `GET /system/info` |
| **channels** | `listChannels(filter?)` | `GET /channels` |
| **channels** | `getChannel(id)` | `GET /channels/{id}` |
| **channels** | `createChannel(data)` | `POST /channels` |
| **channels** | `updateChannel(id, data)` | `PUT /channels/{id}` |
| **channels** | `deleteChannel(id)` | `DELETE /channels/{id}` |
| **channels** | `startChannel(id)` | `GET /channels/{id}/start` |
| **channels** | `stopChannel(id)` | `GET /channels/{id}/stop` |
| **channels** | `getChannelStatus(id)` | `GET /channels/{id}/status` |
| **channels** | `snapshot(id, type?)` | `GET /channels/{id}/snapshot` |
| **models** | `listModels()` | `GET /models` |
| **models** | `getModel(id)` | `GET /models/{id}` |
| **models** | `uploadModel(modelFile, metadataFile)` | `POST /models` (multipart) |
| **models** | `deleteModel(id)` | `DELETE /models/{id}` |
| **visionAi** | `getDetections(channelId)` | `GET /channels/{id}/vision-ai/detections` |
| **visionAi** | `getTrackings(channelId)` | `GET /channels/{id}/vision-ai/trackings` |
| **visionAi** | `getVisionConfig(channelId)` | `GET /channels/{id}/vision-ai/config` |
| **visionAi** | `setVisionConfig(channelId, config)` | `PUT /channels/{id}/vision-ai/config` |
| **visionAi** | `listChannelModels(channelId)` | `GET /channels/{id}/vision-ai/models` |
| **visionAi** | `addChannelModel(channelId, slot)` | `POST /channels/{id}/vision-ai/models` |
| **visionAi** | `removeChannelModel(channelId, modelId)` | `DELETE /channels/{id}/vision-ai/models/{modelId}` |
| **visionAi** | `getRois(channelId, modelId)` | `GET /channels/{id}/vision-ai/models/{modelId}/roi` |
| **visionAi** | `upsertRoi(channelId, modelId, roi)` | `POST /channels/{id}/vision-ai/models/{modelId}/roi` |
| **visionAi** | `clearRois(channelId, modelId)` | `DELETE /channels/{id}/vision-ai/models/{modelId}/roi` |
| **media** | `getRecordingDates(channelId)` | `GET /channels/{id}/recordings/dates` |
| **media** | `listRecordings(channelId, date, page?)` | `GET /channels/{id}/recordings` |
| **media** | `getImageDates(channelId)` | `GET /channels/{id}/images/dates` |
| **media** | `listImages(channelId, date, page?)` | `GET /channels/{id}/images` |
| **media** | `getTimelapseDates(channelId)` | `GET /channels/{id}/timelapse/dates` |
| **hls** | `buildHlsUrl(channelId, auth)` | (URL 헬퍼, 요청 없음) |
| **webrtc** | `buildWebRtcPlayerUrl(channelId, auth)` | (URL 헬퍼, 요청 없음) |
| **webrtc** | `buildSignalingWsUrl(channelId)` | (URL 헬퍼, 요청 없음) |

**REQ-BOX-CLIENT-005** (Event-Driven)
`waitForChannelStatus(channelId, targetStatus, { timeoutMs, intervalMs })` 를 호출하면, 시스템은 `targetStatus`에 도달하거나 `timeoutMs`가 경과할 때까지 `getChannelStatus`를 폴링해야 한다.
- 채널 상태 열거값: `STOPPED | CONNECTING | RUNNING | PAUSED | ERROR | RETRYING`
- 타임아웃 시 `BoxApiError` 던짐

**REQ-BOX-CLIENT-006** (Ubiquitous)
`buildHlsUrl` 헬퍼는 항상 다음 형태의 URL을 반환해야 한다:
`{baseUrl}/hls/{channelId}/playlist.m3u8?{token=jwt|apikey=key}`

**REQ-BOX-CLIENT-007** (Ubiquitous)
`buildWebRtcPlayerUrl` 헬퍼는 항상 다음 형태의 URL을 반환해야 한다:
`{baseUrl}/webrtc/player?channel={channelId}&apikey={key}`

**REQ-BOX-CLIENT-008** (Ubiquitous)
`buildSignalingWsUrl` 헬퍼는 항상 다음 형태의 URL을 반환해야 한다:
`ws://{boxHost}/ws/channels/{channelId}/webrtc`

---

### 3. `packages/db` — Drizzle ORM 스키마 및 마이그레이션

**REQ-DB-001** (Ubiquitous)
Drizzle 스키마는 다음 8개 테이블을 항상 포함해야 한다:

| 테이블 | 주요 컬럼 |
|--------|----------|
| `users` | `id` (PK, ULID), `username` (UNIQUE), `email` (UNIQUE), `password_hash`, `created_at`, `updated_at` |
| `boxes` | `id` (PK, ULID), `name`, `base_url`, `username`, `password_enc` (AES-GCM blob), `jwt_cached` (nullable), `jwt_obtained_at` (nullable), `api_key_cached` (nullable), `last_sync_at` (nullable), `status` (enum: active\|inactive\|error), `created_at`, `updated_at` |
| `cameras` | `id` (PK, ULID), `box_id` (FK→boxes), `channel_id`, `name`, `latitude` (real), `longitude` (real), `resolution`, `stream_url`, `status` (enum), `created_at`, `updated_at` |
| `camera_groups` | `id` (PK, ULID), `name`, `box_id` (FK→boxes), `created_at`, `updated_at` |
| `alerts` | `id` (PK, ULID), `camera_id` (FK→cameras), `type`, `confidence` (real), `timestamp`, `image_url`, `processed` (bool), `created_at` |
| `alert_rules` | `id` (PK, ULID), `camera_id` (FK→cameras), `alert_type`, `enabled` (bool), `notify_toast`, `notify_web_push`, `notify_telegram`, `created_at`, `updated_at` |
| `web_push_subs` | `id` (PK, ULID), `user_id` (FK→users), `endpoint`, `auth` (encrypted), `p256dh` (encrypted), `created_at`, `updated_at` |
| `telegram_subs` | `id` (PK, ULID), `user_id` (FK→users), `chat_id`, `created_at`, `updated_at` |

**REQ-DB-002** (Event-Driven)
`bun run db:migrate`를 실행하면, 시스템은 `packages/db/src/migrations/` 디렉토리의 SQL 파일을 순서대로 적용해야 한다.

**REQ-DB-003** (Event-Driven)
`bun run db:seed`를 실행하면, 시스템은 `ADMIN_USERNAME`/`ADMIN_PASSWORD` 환경 변수를 읽어 기본 관리자 사용자를 `users` 테이블에 삽입해야 한다.
- 비밀번호는 bcrypt로 해시하여 저장해야 한다.
- 이미 존재하는 경우 중복 삽입하지 않아야 한다 (`INSERT OR IGNORE`).

**REQ-DB-004** (Unwanted)
마이그레이션 실행 중 오류가 발생하면, 시스템은 부분 적용 상태로 남아있어서는 안 된다 (트랜잭션 롤백).

---

### 4. `apps/api` 스켈레톤

**REQ-API-001** (Ubiquitous)
`apps/api`는 항상 Hono 앱 인스턴스를 엔트리포인트(`src/index.ts`)에서 내보내야 한다.

**REQ-API-002** (Event-Driven)
`GET /health`를 요청하면, 시스템은 `{ ok: true, version: string }`을 200 상태코드로 반환해야 한다.
- `version`은 `apps/api/package.json`의 `"version"` 필드에서 읽어야 한다.

**REQ-API-003** (Ubiquitous)
API 서버는 시작 시 SQLite 데이터베이스 연결을 항상 초기화해야 한다.
- 연결 실패 시 프로세스를 즉시 종료해야 한다 (exit code 1).

**REQ-API-004** (Ubiquitous)
API 서버는 구조화된 로그를 항상 출력해야 한다:
- 개발 환경: `console` 래퍼 (JSON 비활성화)
- 프로덕션 환경: JSON 형식 로그

**REQ-API-005** (Ubiquitous)
환경 변수는 `.env` 파일에서 로드되어야 하며, 다음 변수는 항상 필수로 검증해야 한다:
- `DATABASE_PATH` — SQLite 파일 경로
- `API_PORT` — 서버 포트 (기본값: `3000`)
- `NODE_ENV` — 실행 환경

---

### 5. `apps/web` 스켈레톤

**REQ-WEB-001** (Ubiquitous)
`apps/web`은 SvelteKit 2.8+ 프로젝트 구조를 항상 따라야 한다.

**REQ-WEB-002** (Event-Driven)
브라우저에서 루트 경로(`/`)를 방문하면, 시스템은 `"CCTV Dashboard"` 텍스트와 API 헬스 상태 배지를 표시해야 한다.
- 헬스 배지: `GET {API_URL}/health` 호출 결과 표시 (ok: true → 녹색, 실패 → 빨간색)

**REQ-WEB-003** (Ubiquitous)
TailwindCSS 4.0+와 shadcn-svelte 1.0+가 항상 초기화된 상태여야 한다.

**REQ-WEB-004** (While 조건)
`NODE_ENV=development` 상태이면, 시스템은 Vite 핫 리로드를 항상 지원해야 한다.

---

### 6. 개발 도구

**REQ-TOOL-001** (Ubiquitous)
`.env.example`은 다음 모든 환경 변수를 문서화 주석과 함께 항상 포함해야 한다:
```
# 데이터베이스
DATABASE_PATH=./data/cctv.sqlite

# API 서버
API_PORT=3000
NODE_ENV=development

# 인증
JWT_SECRET=change-me-in-production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me

# WebPush (SPEC-ALERT에서 사용)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com

# Telegram (SPEC-ALERT에서 사용)
TELEGRAM_BOT_TOKEN=
```

**REQ-TOOL-002** (Ubiquitous)
`.gitignore`는 항상 다음 패턴을 포함해야 한다:
`node_modules/`, `.svelte-kit/`, `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal`, `.env`, `dist/`, `.turbo/`

**REQ-TOOL-003** (Ubiquitous)
루트 `package.json`은 다음 스크립트를 항상 정의해야 한다:
- `dev` — 모든 앱 동시 개발 서버 실행
- `build` — 전체 빌드
- `lint` — Biome 린트
- `format` — Biome 포맷
- `typecheck` — TypeScript 전체 타입 검사

---

## 명세 (Specifications)

### BoxClient 인터페이스 시그니처 (타입 수준)

```typescript
// packages/shared/src/edgeai-box-client/index.ts

export interface BoxClientConfig {
  baseUrl: string;    // https://host:port/api
  jwt?: string;       // JWT Bearer 토큰
  apiKey?: string;    // X-API-Key 헤더 값
}

export class BoxApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public timestamp: number,
  ) { super(message); }
}

export type ChannelStatus = 'STOPPED' | 'CONNECTING' | 'RUNNING' | 'PAUSED' | 'ERROR' | 'RETRYING';

export interface BoxClient {
  // auth
  auth: {
    login(username: string, password: string): Promise<{ token: string; expiresAt: null }>;
    me(): Promise<{ username: string; hasApiKey: boolean }>;
    regenerateApiKey(): Promise<{ apiKey: string }>;
    changePassword(current: string, next: string): Promise<void>;
  };
  // system
  system: {
    health(): Promise<{ status: string }>;
    info(): Promise<Record<string, unknown>>;
  };
  // channels (일부 시그니처 생략, 전체는 REQ-BOX-CLIENT-004 참조)
  channels: { /* ... */ };
  models: { /* ... */ };
  visionAi: { /* ... */ };
  media: { /* ... */ };
  hls: {
    buildPlaylistUrl(channelId: string, auth: { jwt?: string; apiKey?: string }): string;
  };
  webrtc: {
    buildPlayerUrl(channelId: string, apiKey: string): string;
    buildSignalingWsUrl(channelId: string): string;
  };
  // 폴링 유틸
  waitForChannelStatus(
    channelId: string,
    target: ChannelStatus,
    opts?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<void>;
}

export function createBoxClient(config: BoxClientConfig): BoxClient;
```

### Drizzle 스키마 타입 요약

- PK: ULID 문자열 (`uuidv7()` 또는 `crypto.randomUUID()` 사용 가능, ULID 선호)
- 타임스탬프: `INTEGER` (Unix ms) 또는 `TEXT` (ISO 8601) — 통일 필요 (INTEGER 권장)
- 암호화 필드: `boxes.password_enc`는 본 SPEC에서 AES-GCM 암호화 적용. `web_push_subs.auth`/`p256dh`는 본 SPEC 범위에서 평문 저장(향후 SPEC-ALERT에서 암호화)

### HLS URL 형식 (OpenAPI 기준)

```
GET /hls/{channelId}/playlist.m3u8?token={jwt}
GET /hls/{channelId}/playlist.m3u8?apikey={apiKey}
```
- `.ts` 세그먼트는 인증 불필요 (공개)
- `playlist.m3u8`는 쿼리 파라미터 인증 필수

### WebRTC URL 형식

```
GET /webrtc/player?channel={channelId}&apikey={apiKey}
WebSocket: ws://{boxHost}/ws/channels/{channelId}/webrtc
```

---

## 용어 사전 (Glossary)

| 용어 | 정의 |
|------|------|
| **BoxClient** | EdgeAI Box REST API를 타입 안전하게 감싼 클라이언트 |
| **BoxApiError** | `{ success: false }` 응답 또는 네트워크 오류 시 던지는 커스텀 예외 |
| **Channel** | EdgeAI Box의 단일 영상 처리 파이프라인 단위 |
| **ChannelStatus** | 채널의 실행 상태: STOPPED/CONNECTING/RUNNING/PAUSED/ERROR/RETRYING |
| **ULID** | Universally Unique Lexicographically Sortable Identifier — DB PK 형식 |
| **Workspace** | Bun의 모노레포 패키지 관리 메커니즘 |
| **Biome** | Rust 기반 통합 린터 + 포매터 (ESLint + Prettier 대체) |
| **Drizzle ORM** | 타입 안전 SQL 쿼리 빌더 및 마이그레이션 도구 |
| **bun:sqlite** | Bun 내장 SQLite 드라이버 |
| **shadcn-svelte** | SvelteKit용 Tailwind 기반 접근성 높은 UI 컴포넌트 라이브러리 |
| **HLS** | HTTP Live Streaming — 세그먼트 기반 영상 스트리밍 프로토콜 |
| **WebRTC** | Web Real-Time Communication — 저지연 P2P 영상 통신 |
| **ROI** | Region of Interest — AI 검출 적용 영역 (정규화 좌표 0.0~1.0) |
| **OSD** | On-Screen Display — 영상 위에 렌더링되는 오버레이 요소 |

---

## 추적성 태그 (Traceability Tags)

```
TAG: SPEC-CORE-001
DOMAIN: foundation
PHASE: scaffold
PACKAGES: shared, db, api-skeleton, web-skeleton
EXTERNAL: EdgeAI Box API v1.3.6
RELATED: SPEC-AUTH-*, SPEC-BOX-*, SPEC-MAP-*, SPEC-LIVE-*, SPEC-MEDIA-*, SPEC-ALERT-*, SPEC-OPS-*
```
