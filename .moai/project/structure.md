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
│   ├── shared/                    # 공유 타입 및 유틸리티
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── camera.ts       # Camera, CameraGroup 타입
│   │   │   │   ├── box.ts          # Box, BoxAuth 타입
│   │   │   │   ├── alert.ts        # Alert, AlertRule 타입
│   │   │   │   ├── user.ts         # User 타입
│   │   │   │   └── index.ts
│   │   │   ├── constants/
│   │   │   │   ├── api.ts          # API 경로
│   │   │   │   ├── errors.ts       # 에러 코드
│   │   │   │   └── limits.ts       # 제한값
│   │   │   └── utils/
│   │   │       ├── validation.ts   # Zod 스키마
│   │   │       └── format.ts       # 포매팅 유틸
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── db/                          # 데이터베이스 스키마
│       ├── src/
│       │   ├── schema.ts            # Drizzle 테이블 정의
│       │   ├── migrations/          # SQL 마이그레이션
│       │   │   └── 0001_init.sql
│       │   └── index.ts
│       ├── package.json
│       └── drizzle.config.ts
│
├── apps/
│   ├── api/                         # Hono 백엔드 서버
│   │   ├── src/
│   │   │   ├── index.ts             # 서버 엔트리포인트
│   │   │   ├── middleware/          # 인증, CORS, 로깅
│   │   │   │   ├── auth.ts          # JWT 검증
│   │   │   │   ├── errorHandler.ts
│   │   │   │   └── corsHandler.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts          # POST /auth/login, /logout
│   │   │   │   ├── cameras.ts       # GET/POST /cameras
│   │   │   │   ├── boxes.ts         # GET/POST /boxes, /sync
│   │   │   │   ├── alerts.ts        # GET /alerts, WebSocket SSE
│   │   │   │   └── stream.ts        # GET /stream/:cameraId (HLS proxy)
│   │   │   ├── services/
│   │   │   │   ├── authService.ts   # 사용자 인증 로직
│   │   │   │   ├── boxService.ts    # Box API 클라이언트
│   │   │   │   ├── alertService.ts  # 알림 관리 및 전송
│   │   │   │   └── streamService.ts # 스트리밍 프록시
│   │   │   ├── workers/             # 백그라운드 워커
│   │   │   │   ├── detectionPoller.ts
│   │   │   │   ├── tokenRefresher.ts
│   │   │   │   └── channelSyncer.ts
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
│       │   ├── routes/
│       │   │   ├── +page.svelte      # 지도 대시보드 페이지
│       │   │   ├── +layout.svelte    # 레이아웃 (네비게이션)
│       │   │   ├── login/
│       │   │   │   └── +page.svelte  # 로그인 페이지
│       │   │   ├── cameras/
│       │   │   │   └── [id]/
│       │   │   │       └── +page.svelte  # 카메라 상세보기 (라이브)
│       │   │   └── settings/
│       │   │       └── +page.svelte  # Box 등록/설정
│       │   ├── lib/
│       │   │   ├── components/
│       │   │   │   ├── Map.svelte    # 지도 컴포넌트 (Leaflet)
│       │   │   │   ├── LiveStream.svelte  # HLS 비디오 플레이어
│       │   │   │   ├── AlertToast.svelte  # 알림 토스트
│       │   │   │   ├── CameraMarker.svelte
│       │   │   │   ├── CameraList.svelte
│       │   │   │   └── BoxRegisterModal.svelte
│       │   │   ├── stores/
│       │   │   │   ├── auth.ts       # 사용자/인증 상태
│       │   │   │   ├── cameras.ts    # 카메라 목록 상태
│       │   │   │   ├── alerts.ts     # 알림 상태 (SSE 구독)
│       │   │   │   └── ui.ts         # UI 상태 (모달, 선택)
│       │   │   ├── api/
│       │   │   │   └── client.ts     # API 호출 함수들
│       │   │   ├── utils/
│       │   │   │   ├── format.ts     # 데이터 포매팅
│       │   │   │   └── auth.ts       # 토큰 관리
│       │   │   └── types/
│       │   │       └── index.ts      # 재내보기
│       │   ├── styles/
│       │   │   ├── app.css           # 전역 스타일 (Tailwind)
│       │   │   └── theme.css         # 테마 변수
│       │   └── hooks.server.ts       # 서버 훅 (쿠키 관리)
│       ├── package.json
│       ├── svelte.config.js
│       └── tsconfig.json
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
  base_url: string (예: https://...:8443/api),
  username: string (Box 계정),
  password_enc: blob (AES-GCM 암호화 저장),
  jwt_cached: text (nullable, 발급된 Bearer 토큰 캐시),
  jwt_obtained_at: timestamp (nullable),
  api_key_cached: text (nullable, X-API-Key 캐시),
  last_sync_at: timestamp (nullable, 마지막 채널 동기화 시각),
  status: enum ('active' | 'inactive' | 'error'),
  created_at: timestamp,
  updated_at: timestamp
)
```
주: EdgeAI Box JWT/API Key는 만료 시간이 없지만(`expiresAt: null`),
401 응답 또는 비밀번호 변경 시 무효화될 수 있어 username/password를 보관하고
필요 시 자동 재로그인한다. password는 AES-GCM으로 암호화 저장한다.

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
