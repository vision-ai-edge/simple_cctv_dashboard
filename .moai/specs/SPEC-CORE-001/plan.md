# SPEC-CORE-001: 구현 계획 (Plan)

```
TAG: SPEC-CORE-001
DOMAIN: foundation
PHASE: scaffold
```

---

## 개요

이 계획서는 SPEC-CORE-001의 구현 순서, 파일 수준 체크리스트, 병렬 실행 가능 영역을 정의합니다.
코드 생성은 `/moai run SPEC-CORE-001` 단계에서 수행됩니다.

---

## 마일스톤 (우선순위 기반)

### Primary Goal — 모노레포 골격 + 핵심 설정

모노레포가 `bun install` 한 번으로 동작하고 TypeScript 타입 검사가 통과해야 합니다.

- 루트 `package.json` (workspaces 설정)
- 루트 `tsconfig.json` (프로젝트 참조)
- `biome.json` (린트 + 포맷)
- `bunfig.toml`
- `.env.example`
- `.gitignore`
- 4개 서브패키지 `package.json` 골격 (scripts, dependencies 선언)
- 4개 서브패키지 `tsconfig.json` (composite, extends 루트)

### Secondary Goal — `packages/shared` BoxClient + `packages/db` 스키마

핵심 라이브러리 두 개가 독립적으로 빌드 및 테스트 가능해야 합니다.

**[shared와 db는 상호 의존성이 없으므로 병렬 구현 가능]**

#### `packages/shared` 작업 목록

- `src/edgeai-box-client/types.ts` — Zod 스키마 + 추론 타입 정의
  - `LoginResponseSchema` (token: string, expiresAt: null)
  - `UserInfoResponseSchema` (username, hasApiKey)
  - `ApiKeyResponseSchema` (apiKey)
  - `ChannelResponseSchema` (id, name, isEnabled, autoStart, status, config, state, outputs)
  - `ChannelStatusResponseSchema` (channelId, status: ChannelStatus enum, isActive, lastErrorMessage)
  - `ChannelCreateRequestSchema` (id?, name, inputType, rtspUrl?, enableHLS, enableRecording, enableAIProcessing, ...)
  - `ModelInfoSchema` (id, name, type, task, fileSize, isBuiltIn, ...)
  - `ModelSlotConfigSchema` (modelId, enabled, frameSkip, confidenceThreshold, maxDetections, detectClasses, roiRegions)
  - `RoiRegionSchema` (id, mode: 'include'|'exclude', points: number[])
  - `ErrorResponseSchema` (success: false, message, timestamp)
  - `PaginationInfoSchema` (total, limit, offset, hasMore)
  - `FileInfoSchema` (filename, date, size, createdAt, lastModified)
  - `FilesListResponseSchema` (files, pagination, totalSize)
  - `DateListResponseSchema` (dates: string[], totalDays)
  - `VisionAIConfigSchema` (showDetections, showTrackings, showConfidence, showLabels, ...)
  - `SimpleResponseSchema` (success, timestamp, message)
- `src/edgeai-box-client/error.ts` — `BoxApiError` 클래스
- `src/edgeai-box-client/client.ts` — `BoxClient` 클래스 구현
  - 생성자: `config: BoxClientConfig` 저장
  - 내부 `#fetch(path, init?)` 메서드: 인증 헤더 주입 + 에러 봉투 처리
  - `auth` 그룹 메서드 4개
  - `system` 그룹 메서드 2개
  - `channels` 그룹 메서드 9개 (list, get, create, update, delete, start, stop, status, snapshot)
  - `models` 그룹 메서드 4개 (list, get, upload, delete)
  - `visionAi` 그룹 메서드 10개 (detections, trackings, getConfig, setConfig, listModels, addModel, removeModel, getRois, upsertRoi, clearRois)
  - `media` 그룹 메서드 6개 (recordingDates, recordings, imageDates, images, timelapseDates, timelapse)
  - `hls.buildPlaylistUrl` 헬퍼
  - `webrtc.buildPlayerUrl`, `webrtc.buildSignalingWsUrl` 헬퍼
  - `waitForChannelStatus` 폴링 유틸
- `src/edgeai-box-client/index.ts` — `createBoxClient` 팩토리 + 재내보내기
- `src/index.ts` — 패키지 진입점 (`export * from './edgeai-box-client'`)
- `src/__tests__/client.test.ts` — Vitest 단위 테스트
  - `auth.login` mock-fetch 성공/실패 시나리오
  - `BoxApiError` 던짐 검증
  - `buildHlsUrl` URL 형식 검증
  - `waitForChannelStatus` 타임아웃 검증

#### `packages/db` 작업 목록

- `src/schema.ts` — Drizzle 테이블 정의 (8개 테이블)
  - `users` 테이블
  - `boxes` 테이블 (`status` enum: 'active' | 'inactive' | 'error', `password_enc` BLOB AES-GCM 암호화)
  - `cameras` 테이블 (FK→boxes, `status` enum: 'online' | 'offline' | 'error')
  - `camera_groups` 테이블 (FK→boxes)
  - `alerts` 테이블 (FK→cameras)
  - `alert_rules` 테이블 (FK→cameras)
  - `web_push_subs` 테이블 (FK→users)
  - `telegram_subs` 테이블 (FK→users)
- `src/migrations/0001_init.sql` — 초기 마이그레이션 SQL
  - CREATE TABLE 8개 (IF NOT EXISTS)
  - 인덱스: `boxes(status)`, `cameras(box_id)`, `cameras(status)`, `alerts(camera_id)`, `alerts(processed)`, `alert_rules(camera_id)`
- `src/migrate.ts` — 마이그레이션 러너 CLI
  - `bun:sqlite` + Drizzle migrator 사용
  - 트랜잭션 내 실행
- `src/seed.ts` — 기본 관리자 시드
  - `ADMIN_USERNAME`, `ADMIN_PASSWORD` 환경 변수 읽기
  - `bcryptjs`로 비밀번호 해시
  - `INSERT OR IGNORE`
- `src/client.ts` — DB 연결 팩토리 (`createDb(path): Database`)
- `src/index.ts` — 패키지 진입점
- `drizzle.config.ts` — Drizzle Kit 설정 (마이그레이션 경로)

### Secondary Goal — `apps/api` + `apps/web` 스켈레톤

**[api와 web은 상호 의존성이 없으므로 병렬 구현 가능]**
단, `packages/shared`와 `packages/db`가 먼저 완성되어야 합니다.

#### `apps/api` 작업 목록

- `src/index.ts` — Hono 앱 생성 + 서버 시작
- `src/routes/health.ts` — `GET /health` → `{ ok: true, version }`
- `src/db/client.ts` — SQLite 연결 초기화 (`packages/db` 사용)
- `src/config.ts` — 환경 변수 로드 + 검증 (Zod)
- `src/logger.ts` — 로거 래퍼 (개발: console, 프로덕션: JSON)
- `src/middleware/corsHandler.ts` — CORS 미들웨어 (개발 허용)
- `src/types/env.ts` — 환경 변수 타입

#### `apps/web` 작업 목록

- SvelteKit 프로젝트 초기화 (`create-svelte`)
- Tailwind CSS 4.0 설치 및 설정 (`src/app.css`)
- shadcn-svelte 초기화 (`npx shadcn-svelte@latest init`)
- `src/routes/+page.svelte` — "CCTV Dashboard" 헤딩 + API 헬스 배지
  - `onMount`에서 `GET /api/health` 호출
  - 응답 ok → 녹색 배지, 실패 → 빨간색 배지
- `src/routes/+layout.svelte` — 기본 레이아웃 (추후 확장용)
- `src/lib/api/client.ts` — API 기본 클라이언트 유틸
- `svelte.config.js` — SvelteKit 설정 (adapter-auto)
- `vite.config.ts` — Vite 설정 (API 프록시 설정 포함)

### Final Goal — 통합 검증

- `bun install` 루트에서 실행 후 전체 패키지 심볼릭 링크 확인
- `bun run typecheck` — TypeScript 에러 0개
- `bun run lint` — Biome 린트 에러 0개
- `bun run db:migrate` — 마이그레이션 성공
- `bun run test` — 단위 테스트 전체 통과
- `bun run dev` (api + web) — 양쪽 앱 정상 기동
- `curl http://localhost:3000/health` — `{"ok":true,"version":"0.1.0"}` 반환

---

## 기술 접근 방식

### 모노레포 전략

```
루트 package.json
├── workspaces: ["apps/*", "packages/*"]
└── scripts:
    ├── dev: "concurrently \"bun --cwd apps/api dev\" \"bun --cwd apps/web dev\""
    ├── build: "bun run --filter='*' build"
    ├── lint: "biome check ."
    ├── format: "biome format . --write"
    └── typecheck: "tsc --build --noEmit"
```

### TypeScript 프로젝트 참조 구조

```
루트 tsconfig.json (references 전용)
├── packages/shared/tsconfig.json (composite: true)
├── packages/db/tsconfig.json (composite: true)
├── apps/api/tsconfig.json (references: [shared, db])
└── apps/web/tsconfig.json (references: [shared])
```

### 패키지 간 의존성

```
apps/api ──→ packages/shared ("@cctv/shared": "workspace:*")
apps/api ──→ packages/db     ("@cctv/db": "workspace:*")
apps/web ──→ packages/shared ("@cctv/shared": "workspace:*")
packages/db ──→ (독립)
packages/shared ──→ (독립)
```

### 병렬 구현 가능 영역

```
[Primary Goal] 루트 설정 완료
        ↓
[Secondary Goal A] packages/shared ──┐ (병렬 가능)
[Secondary Goal B] packages/db ──────┘
        ↓ (둘 다 완료 후)
[Secondary Goal C] apps/api ──┐ (병렬 가능)
[Secondary Goal D] apps/web ──┘
        ↓
[Final Goal] 통합 검증
```

---

## 아키텍처 설계 방향

### BoxClient 내부 구조

```typescript
class BoxClientImpl implements BoxClient {
  #config: BoxClientConfig;

  // 모든 HTTP 요청을 통과하는 단일 지점
  async #fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (this.#config.jwt) {
      headers.set('Authorization', `Bearer ${this.#config.jwt}`);
    } else if (this.#config.apiKey) {
      headers.set('X-API-Key', this.#config.apiKey);
    }
    const res = await fetch(`${this.#config.baseUrl}${path}`, { ...init, headers });
    const json = await res.json();
    // { success: false } → BoxApiError 던짐
    if (!res.ok || json.success === false) {
      throw new BoxApiError(json.message ?? res.statusText, res.status, json.timestamp ?? Date.now());
    }
    return json as T;
  }
  // ... 그룹별 메서드
}
```

### 에러 처리 전략

- `BoxApiError`: EdgeAI Box API 4xx/5xx 및 `{ success: false }` 응답
- `TypeError`: 네트워크 연결 실패 (fetch 수준)
- 상위 레이어(apps/api)에서 도메인별 에러 변환

### 데이터베이스 ID 전략

- PK 타입: `TEXT` (ULID — `ulid` 패키지 또는 `crypto.randomUUID()` 대체)
- 이유: UUID보다 정렬 가능, 인덱스 효율적

---

## 리스크 및 미지사항

| 리스크 | 영향도 | 발생 가능성 | 대응 방법 |
|--------|--------|------------|----------|
| Drizzle + `bun:sqlite` 어댑터 호환성 | 높음 | 낮음 | `drizzle-orm/bun-sqlite` 공식 문서 확인 후 작성 |
| shadcn-svelte CLI가 SvelteKit 2.8+와 충돌 | 중간 | 낮음 | `npx shadcn-svelte@latest` 최신 버전 사용, 실패 시 수동 설치 |
| Biome의 `.svelte` 파일 지원 한계 | 낮음 | 중간 | Biome는 TS/JS만 처리, `.svelte`는 별도 `svelte-check` 사용 |
| `packages/shared` Zod 스키마와 실제 API 응답 불일치 | 높음 | 중간 | `/tmp/edgeai_box_openapi.json` 기준으로 작성, 런타임에서 `safeParse` 사용 |
| TypeScript 프로젝트 참조 빌드 순서 오류 | 낮음 | 낮음 | `tsc --build` 의존성 그래프 자동 정렬 |

---

## 미지사항 (Unknowns)

1. **BoxClient 토큰 갱신 전략**: JWT 만료가 없으나 `ADMIN_PASSWORD` 변경 시 무효화 가능. 401 응답 처리 패턴은 SPEC-AUTH에서 정의 예정.
2. **Box `password_enc` 암호화**: 본 SPEC에서 AES-GCM(노드 `crypto.subtle`) 적용, 마스터 키는 `BOX_VAULT_KEY` 환경 변수. 키 로테이션 정책은 SPEC-AUTH에서 정의.
3. **`bun run dev` 동시 실행 도구**: `concurrently` 또는 Bun의 `--filter` 병렬 실행 중 선택. 런 단계에서 확인.
4. **HLS 세그먼트 `.ts` vs `.m3u8` 인증**: `.ts` 파일은 OpenAPI 명세 기준 인증 불필요. 실제 환경에서 검증 필요.

---

## 구현 참고 파일 목록

| 파일 경로 | 역할 |
|----------|------|
| `/tmp/edgeai_box_openapi.json` | EdgeAI Box API 명세 (Zod 스키마 작성 기준) |
| `.moai/project/product.md` | 제품 비전 및 핵심 기능 |
| `.moai/project/structure.md` | 모노레포 구조 및 데이터 모델 |
| `.moai/project/tech.md` | 기술 스택 버전 및 보안 원칙 |
