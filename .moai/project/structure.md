# Simple CCTV Dashboard - 구조 및 아키텍처

## 전체 아키텍처 개요

### 아키텍처 패턴
**모듈식 모노리식 + 워커 패턴** (Modular Monolithic with Background Workers)

```
┌─────────────────────────────────────────────────────────────┐
│                     Web Browser Client                       │
│                    (SvelteKit + TypeScript)                 │
└────────────┬────────────────────────────────────┬───────────┘
             │ HTTP(S)                            │ WebSocket(SSE)
             ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  Hono API Server (Bun)                      │
│  ┌──────────────┬───────────────┬─────────────┐             │
│  │ Camera API   │ Box Register  │ Auth Routes │             │
│  │ Streaming    │ Alert Manager │ User Mgmt   │             │
│  │ & Download   │               │             │             │
│  └──────────────┴───────────────┴─────────────┘             │
│  ┌──────────────────────────────────────────────┐           │
│  │         Shared Services (Database, Auth)     │           │
│  └──────────────────────────────────────────────┘           │
└──────────┬──────────────────────────┬──────────────────────┘
           │ SQL (bun:sqlite)          │ HTTP(S)
           ▼                           ▼
    ┌─────────────────┐       ┌─────────────────────┐
    │   SQLite        │       │  EdgeAI Box API     │
    │   Database      │       │  (Multi-Box Ready)  │
    │                 │       │  @01228710945...    │
    │ • users         │       │  • Channel List     │
    │ • boxes         │       │  • Detection Events │
    │ • cameras       │       │  • Live Stream      │
    │ • alerts        │       │  • Recording         │
    └─────────────────┘       └─────────────────────┘
```

### Background Workers (Async Tasks)
```
┌─────────────────────────────────────────────┐
│         Background Workers (Bun)            │
├─────────────────────────────────────────────┤
│ 1. Detection Event Poller                    │
│    → EdgeAI Box API polling                  │
│    → Alert trigger & notification            │
│    → WebPush/Telegram dispatch               │
│                                              │
│ 2. Box Auth Token Refresher                  │
│    → JWT refresh cycle (via jose)            │
│    → Credential rotation                     │
│                                              │
│ 3. Channel Synchronizer                      │
│    → Periodic channel list sync              │
│    → Camera metadata update                  │
│    → New camera detection                    │
└─────────────────────────────────────────────┘
```

## Bun Workspace 모노레포 구조

```
simple_cctv_dashboard/
├── packages/
│   ├── shared/                    # EdgeAI Box 타입 클라이언트, JWT 유틸, 자격증명 볼트
│   │   ├── src/
│   │   │   ├── edgeai-box-client/
│   │   │   │   ├── client.ts       # BoxClient (40+ 엔드포인트)
│   │   │   │   ├── types.ts        # Zod 스키마 (응답 검증)
│   │   │   │   └── error.ts        # BoxApiError 커스텀 예외
│   │   │   ├── jwt/
│   │   │   │   └── index.ts        # JWT 유틸 (SPEC-AUTH-001)
│   │   │   │       # signAccessToken, signRefreshToken, verifyToken, parseTokenClaims, assertJwtSecret
│   │   │   ├── crypto/
│   │   │   │   └── vault.ts        # AES-GCM 자격증명 볼트 유틸 (SPEC-BOX-001)
│   │   │   │       # assertBoxVaultKey, encryptWithVault, decryptWithVault
│   │   │   ├── constants/
│   │   │   │   └── index.ts        # API 경로, 에러 코드, 제한값
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── db/                          # 데이터베이스 스키마
│       ├── src/
│       │   ├── schema/
│       │   │   ├── index.ts          # 9개 테이블 정의 + 암호화 컬럼 (SPEC-BOX-001)
│       │   │   └── auth.ts           # auth_token_blacklist 스키마 (SPEC-AUTH-001)
│       │   ├── helpers/
│       │   │   └── auth.ts           # blacklistJti, isJtiBlacklisted 헬퍼
│       │   ├── migrations/           # SQL 마이그레이션
│       │   │   ├── 0001_initial.sql
│       │   │   ├── 0002_auth_blacklist.sql (SPEC-AUTH-001)
│       │   │   ├── 0003_box_vault.sql (SPEC-BOX-001 — jwt_cached_enc, api_key_cached_enc)
│       │   │   └── 0004_box_unique_url.sql (SPEC-BOX-001 — base_url UNIQUE INDEX)
│       │   ├── migrate.ts            # 마이그레이션 러너
│       │   ├── seed.ts               # 시드 스크립트
│       │   └── index.ts
│       ├── package.json
│       └── drizzle.config.ts
│
├── apps/
│   ├── api/                         # Hono 백엔드 서버
│   │   ├── src/
│   │   │   ├── index.ts             # 서버 엔트리포인트
│   │   │   ├── middleware/          # 인증, CORS, 로깅, 레이트 리미팅
│   │   │   │   ├── requireAuth.ts   # JWT 검증 미들웨어 (SPEC-AUTH-001)
│   │   │   │   ├── rateLimit.ts     # 로그인 횟수 제한 (SPEC-AUTH-001)
│   │   │   │   └── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── health.ts        # GET /api/health
│   │   │   │   ├── auth.ts          # /api/auth/* (login, logout, me, refresh) — SPEC-AUTH-001
│   │   │   │   ├── boxes.ts         # GET/POST /api/boxes/* (5 엔드포인트) — SPEC-BOX-001
│   │   │   │   ├── cameras.ts       # GET/POST /api/cameras (후속)
│   │   │   │   ├── alerts.ts        # GET /api/alerts (후속)
│   │   │   │   └── index.ts
│   │   │   ├── services/
│   │   │   │   ├── authService.ts   # 사용자 인증 로직
│   │   │   │   ├── boxService.ts    # Box 등록/조회/삭제, 401 재인증 가드 (SPEC-BOX-001)
│   │   │   │   ├── alertService.ts  # 알림 관리 및 전송
│   │   │   │   └── streamService.ts # 스트리밍 프록시
│   │   │   ├── workers/             # 백그라운드 워커
│   │   │   │   ├── boxStatusPoller.ts # 60초 Box 상태 폴링 (SPEC-BOX-001)
│   │   │   │   ├── detectionPoller.ts # 이벤트 폴링 (후속)
│   │   │   │   ├── tokenRefresher.ts  # 토큰 갱신 (후속)
│   │   │   │   └── channelSyncer.ts   # 채널 동기화 (후속)
│   │   │   ├── db/
│   │   │   │   └── client.ts        # SQLite 클라이언트
│   │   │   └── types/
│   │   │       └── env.ts           # 환경 변수 타입
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                         # SvelteKit 프론트엔드
│       ├── src/
│       │   ├── app.html             # HTML 템플릿
│       │   ├── app.d.ts             # Locals, PageData 타입 (SPEC-AUTH-001)
│       │   ├── hooks.server.ts      # 전역 쿠키 검증 (SPEC-AUTH-001)
│       │   ├── routes/
│       │   │   ├── +page.svelte      # 루트 페이지 (리다이렉트)
│       │   │   ├── +layout.svelte    # 루트 레이아웃
│       │   │   ├── login/
│       │   │   │   ├── +page.svelte  # 로그인 폼 (SPEC-AUTH-001)
│       │   │   │   └── +page.server.ts # 서버 액션 (SPEC-AUTH-001)
│       │   │   ├── logout/
│       │   │   │   └── +page.server.ts # 로그아웃 액션 (SPEC-AUTH-001)
│       │   │   └── (app)/
│       │   │       ├── +layout.server.ts # 보호 라우트 가드 (SPEC-AUTH-001)
│       │   │       ├── +layout.svelte    # 앱 레이아웃 (SPEC-BOX-UI-001에서 "박스 관리" 링크 추가)
│       │   │       ├── +page.svelte      # 대시보드 (후속 SPEC)
│       │   │       ├── boxes/
│       │   │       │   ├── +page.server.ts  # 목록 load (SPEC-BOX-UI-001)
│       │   │       │   ├── +page.svelte     # 목록 뷰 + 15초 폴링 (SPEC-BOX-UI-001)
│       │   │       │   ├── new/
│       │   │       │   │   ├── +page.server.ts  # 등록 action (SPEC-BOX-UI-001)
│       │   │       │   │   └── +page.svelte     # 등록 폼 (SPEC-BOX-UI-001)
│       │   │       │   └── [id]/
│       │   │       │       ├── +page.server.ts  # 상세 load + delete/refresh actions (SPEC-BOX-UI-001)
│       │   │       │       └── +page.svelte     # 상세 뷰 (SPEC-BOX-UI-001)
│       │   │       └── [기타 보호 라우트]
│       │   ├── lib/
│       │   │   ├── components/
│       │   │   │   ├── box/
│       │   │   │   │   ├── StatusBadge.svelte # 상태 배지 (SPEC-BOX-UI-001)
│       │   │   │   │   ├── BoxCard.svelte     # 목록 카드 (SPEC-BOX-UI-001)
│       │   │   │   │   ├── RelativeTime.svelte # 상대시간 (SPEC-BOX-UI-001)
│       │   │   │   │   ├── statusBadge.helpers.ts # 순수 함수 (SPEC-BOX-UI-001)
│       │   │   │   │   └── relativeTime.helpers.ts # 순수 함수 (SPEC-BOX-UI-001)
│       │   │   │   └── [UI 컴포넌트 - 후속]
│       │   │   ├── api/
│       │   │   │   └── boxes.ts      # BoxSummary 타입 + fetch 헬퍼 (FetchLike 의존성 주입, SPEC-BOX-UI-001)
│       │   │   ├── server/
│       │   │   │   └── auth.ts       # getCurrentUser 헬퍼 (SPEC-AUTH-001)
│       │   │   ├── stores/
│       │   │   │   ├── auth.ts       # 클라이언트 auth 스토어 (SPEC-AUTH-001)
│       │   │   │   └── [UI 스토어 - 후속]
│       │   │   ├── utils/
│       │   │   │   └── [헬퍼 함수 - 후속]
│       │   │   └── types/
│       │   │       └── [타입 정의 - 후속]
│       │   ├── __tests__/
│       │   │   ├── lib/
│       │   │   │   └── components/box/
│       │   │   │       ├── relative-time.test.ts # RelativeTime 테스트 (SPEC-BOX-UI-001)
│       │   │   │       └── status-badge.test.ts  # StatusBadge 테스트 (SPEC-BOX-UI-001)
│       │   │   └── routes/
│       │   │       ├── boxes/
│       │   │       │   ├── list-page-server.test.ts  # 목록 페이지 load 테스트 (SPEC-BOX-UI-001)
│       │   │       │   ├── new-page-server.test.ts   # 등록 페이지 action 테스트 (SPEC-BOX-UI-001)
│       │   │       │   └── id-page-server.test.ts    # 상세 페이지 load+actions 테스트 (SPEC-BOX-UI-001)
│       │   │       └── [로그인/보호 라우트 테스트]
│       │   └── styles/
│       │       └── app.css           # 전역 스타일 (Tailwind)
│       ├── package.json
│       ├── svelte.config.js
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── package.json                     # 워크스페이스 루트
├── bunfig.toml                      # Bun 설정
├── tsconfig.json                    # TypeScript 공유 설정
├── .moai/
│   ├── config/
│   │   └── sections/
│   ├── project/
│   ├── specs/
│   └── docs/
├── .claude/                         # Claude Code 설정
├── .git/
└── .gitignore
```

## 데이터 모델 (Drizzle ORM)

### Users 테이블
```
CREATE TABLE users (
  id: string (PK),
  username: string (UNIQUE),
  email: string (UNIQUE),
  password_hash: string (bcrypt),
  created_at: timestamp,
  updated_at: timestamp
)
```

### Boxes 테이블 (다중 박스 확장 준비)
```
CREATE TABLE boxes (
  id: string (PK),
  name: string,
  base_url: string (예: https://...:8443/api, UNIQUE INDEX — SPEC-BOX-001),
  username: string (Box 계정),
  password_enc: blob (AES-GCM 암호화, SPEC-BOX-001),
  jwt_cached: text (nullable, 발급된 Bearer 토큰 캐시 — backward compat),
  jwt_cached_enc: blob (AES-GCM 암호화, SPEC-BOX-001),
  jwt_obtained_at: timestamp (nullable),
  api_key_cached: text (nullable, X-API-Key 캐시 — backward compat),
  api_key_cached_enc: blob (AES-GCM 암호화, SPEC-BOX-001),
  last_sync_at: timestamp (nullable, 마지막 채널 동기화 시각),
  status: enum ('active' | 'inactive' | 'error'),
  created_at: timestamp,
  updated_at: timestamp
)
```
주: EdgeAI Box JWT/API Key는 만료 시간이 없지만(`expiresAt: null`),
401 응답 또는 비밀번호 변경 시 무효화될 수 있어 username/password를 보관하고
필요 시 자동 재로그인한다. password는 AES-GCM으로 암호화 저장한다 (SPEC-BOX-001).
암호화된 credentials는 `jwt_cached_enc`, `api_key_cached_enc` blob 컬럼에 저장된다.

### Cameras 테이블
```
CREATE TABLE cameras (
  id: string (PK),
  box_id: string (FK),
  channel_id: string,
  name: string,
  latitude: float,
  longitude: float,
  resolution: string,
  stream_url: string (HLS),
  status: enum ('online' | 'offline' | 'error'),
  created_at: timestamp,
  updated_at: timestamp
)
```

### CameraGroups 테이블 (선택사항)
```
CREATE TABLE camera_groups (
  id: string (PK),
  name: string,
  box_id: string (FK),
  created_at: timestamp,
  updated_at: timestamp
)
```

### Alerts 테이블
```
CREATE TABLE alerts (
  id: string (PK),
  camera_id: string (FK),
  type: string (detection type from EdgeAI Box),
  confidence: float,
  timestamp: timestamp,
  image_url: string,
  processed: boolean,
  created_at: timestamp
)
```

### AlertRules 테이블
```
CREATE TABLE alert_rules (
  id: string (PK),
  camera_id: string (FK),
  alert_type: string,
  enabled: boolean,
  notify_toast: boolean,
  notify_web_push: boolean,
  notify_telegram: boolean,
  created_at: timestamp,
  updated_at: timestamp
)
```

### WebPushSubscriptions 테이블
```
CREATE TABLE web_push_subscriptions (
  id: string (PK),
  user_id: string (FK),
  endpoint: string,
  auth: string (encrypted),
  p256dh: string (encrypted),
  created_at: timestamp,
  updated_at: timestamp
)
```

### TelegramSubscriptions 테이블
```
CREATE TABLE telegram_subscriptions (
  id: string (PK),
  user_id: string (FK),
  chat_id: string,
  created_at: timestamp,
  updated_at: timestamp
)
```

## 런타임 토폴로지

### 요청 흐름 1: 지도 조회 및 라이브 보기
```
Browser
  ↓ GET /cameras
API Server
  ↓ SELECT * FROM cameras WHERE box_id = ?
SQLite
  ↓ [카메라 목록]
API Server
  ↓ JSON
Browser (지도 렌더링, 마커 표시)
  ↓ GET /stream/:cameraId (HLS URL)
API Server
  ↓ Proxy to EdgeAI Box HLS endpoint
Browser (hls.js 플레이어)
```

### 요청 흐름 2: AI 검출 이벤트 알림
```
EdgeAI Box (Detection Event)
  ↓ Detection Poller Worker (10초 주기)
API Server
  ↓ AlertService.notifyAll()
  ├─ 1. Database: INSERT INTO alerts
  ├─ 2. WebSocket/SSE: Broadcast to connected clients
  ├─ 3. Web Push API: 등록된 모든 디바이스에 전송
  └─ 4. Telegram Bot API: 등록된 채팅방에 메시지 전송
Browser (토스트 표시)
```

### 요청 흐름 3: Box 등록 및 채널 동기화
```
Browser
  ↓ POST /boxes (URL + 자격증명)
API Server
  ↓ BoxService.authenticate() → EdgeAI Box
  ↓ BoxService.fetchChannels() → 카메라 목록
API Server
  ├─ 1. Database: INSERT INTO boxes
  ├─ 2. Database: INSERT INTO cameras (bulk)
  └─ 3. EventEmit: trigger ChannelSyncer worker
Browser (성공 메시지)
```

## 비기능 요구사항

### 성능
- **지도 렌더링**: 50개 마커 기준 1초 이내
- **API 응답시간**: P95 < 200ms (데이터베이스 쿼리 제외)
- **실시간 알림**: 이벤트 감지 → 사용자 알림 < 5초
- **라이브 스트림**: HLS 지연 < 1초 (네트워크 상태에 따름)

### 가용성
- **API 가용성**: 99.5%
- **데이터베이스**: 자동 복구, 주기적 백업 (수동)
- **워커 복원력**: 실패 시 자동 재시도

### 보안
- **Box 자격증명**: 환경변수 또는 암호화 저장 (절대 프론트엔드 노출 금지)
- **라이브 URL**: 단기 토큰(1시간) 프록시 경유, 직접 노출 금지
- **JWT 토큰**: HTTPOnly 쿠키 또는 localStorage + 짧은 유효기간 (15분)
- **HTTPS**: 모든 통신 암호화

### 확장성
- **다중 Box**: 스키마에 `box_id` 포함, FK 관계 설정
- **카메라 수**: 데이터베이스 인덱싱 (box_id, camera_id 복합키)
- **동시 사용자**: 수평 확장 준비 (상태비저장 API, 별도 메시지 큐 추후)
