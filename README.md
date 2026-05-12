# simple_cctv_dashboard

EdgeAI Box API 기반 CCTV 통합 관제 대시보드.

지도에 카메라를 배치하고, AI 검출 결과를 알림으로 받으며, HLS/WebRTC 라이브 영상을 통합 관리하는 단일 사용자 운영자용 웹 애플리케이션입니다.

> **현재 상태**: SPEC-CORE-001 (기반 구조) + SPEC-AUTH-001 (JWT 쿠키 인증) + SPEC-BOX-001 (Box 등록 백엔드) 구현 완료. 채널 동기화/지도/라이브뷰/알림 기능은 후속 SPEC에서 추가됩니다.

---

## Quick Start

### 사전 요구 사항

- [Bun](https://bun.sh) `>= 1.2.0`
- macOS / Linux (Windows 는 WSL2 권장)

### 설치 및 기동

```bash
# 1) 의존성 설치
bun install

# 2) 환경 변수 설정
cp .env.example .env
# .env 파일을 열어 다음 항목을 수정:
# - DATABASE_PATH: 절대 경로 권장 (예: $PWD/data/cctv.sqlite)
# - JWT_SECRET: 32바이트 이상 (생성: openssl rand -base64 48)
# - BOX_VAULT_KEY: 32바이트 hex (64자, 생성: openssl rand -hex 32) — Box 자격증명 AES-GCM 볼트 키 필수
# - BOX_STATUS_POLL_INTERVAL_MS: 선택, 기본 60000 (60초) — Box 상태 폴링 주기
# - ADMIN_USERNAME, ADMIN_PASSWORD: 초기 관리자 자격증명

# 3) 데이터베이스 초기화 + 관리자 시드
DATABASE_PATH="$PWD/data/cctv.sqlite" bun run db:migrate
ADMIN_USERNAME=admin ADMIN_PASSWORD=change-me DATABASE_PATH="$PWD/data/cctv.sqlite" bun run db:seed

# 4) 개발 서버 동시 실행 (API: :3000, Web: :5173)
DATABASE_PATH="$PWD/data/cctv.sqlite" bun run dev
```

기동 후 브라우저에서 [`http://localhost:5173`](http://localhost:5173) 접속.

### 헬스 체크

```bash
curl http://localhost:3000/api/health
# {"ok":true,"version":"0.1.0"}
```

또는 브라우저에서 [`http://localhost:5173/api/health`](http://localhost:5173/api/health) 접속.

---

## 모노레포 구조

```
simple_cctv_dashboard/
├── apps/
│   ├── api/                 # Bun + Hono 백엔드 (REST API)
│   │   └── src/
│   │       ├── middleware/
│   │       │   ├── requireAuth.ts    # JWT 인증 미들웨어
│   │       │   └── rateLimit.ts      # 로그인 횟수 제한
│   │       └── routes/
│   │           ├── health.ts         # 헬스 체크
│   │           └── auth.ts           # /api/auth/* (login, logout, me, refresh)
│   └── web/                 # SvelteKit + Tailwind 4 프론트엔드
│       └── src/
│           ├── hooks.server.ts       # 전역 쿠키 검증
│           ├── routes/
│           │   ├── login/            # /login 페이지
│           │   ├── logout/           # /logout 액션
│           │   └── (app)/            # 보호 라우트 그룹 (인증 필수)
│           └── lib/
│               ├── server/auth.ts    # getCurrentUser 헬퍼
│               └── stores/auth.ts    # 클라이언트 auth 스토어
├── packages/
│   ├── shared/              # EdgeAI Box & JWT 유틸 (`@cctv/shared`)
│   │   └── src/
│   │       ├── edgeai-box-client/
│   │       │   ├── client.ts    # BoxClient (auth/channels/models/visionAi/media/hls/webrtc)
│   │       │   ├── types.ts     # Zod 스키마
│   │       │   └── error.ts     # BoxApiError 커스텀 예외
│   │       └── jwt/
│   │           └── index.ts     # JWT 서명/검증 유틸 (HS256)
│   └── db/                  # Drizzle ORM + bun:sqlite (`@cctv/db`)
│       └── src/
│           ├── schema/
│           │   ├── index.ts      # 9개 테이블 정의
│           │   └── auth.ts       # auth_token_blacklist 테이블
│           ├── helpers/auth.ts   # 블랙리스트 헬퍼 함수
│           ├── migrate.ts        # 마이그레이션 러너 CLI
│           ├── seed.ts           # 관리자 시드 CLI
│           └── migrations/
│               ├── 0001_initial.sql
│               └── 0002_auth_blacklist.sql
├── .moai/                   # MoAI-ADK 프로젝트 메타데이터
│   ├── config/sections/     # quality, workflow, language, user 설정
│   ├── project/             # product, structure, tech 문서
│   ├── specs/SPEC-CORE-001/ # SPEC 명세 + 계획 + 인수기준
│   └── specs/SPEC-AUTH-001/ # JWT 인증 SPEC (완료)
├── package.json             # Bun workspaces (apps/* + packages/*)
├── tsconfig.json            # TypeScript project references
├── tsconfig.base.json       # 공통 컴파일러 옵션
├── biome.json               # 통합 린트 + 포맷
└── bunfig.toml              # Bun 런타임 설정
```

---

## 기술 스택

| 영역 | 도구 | 버전 |
|------|------|------|
| 런타임 | Bun | `^1.3` |
| 언어 | TypeScript | `^5.9` |
| 백엔드 | [Hono](https://hono.dev) | `^4.6` |
| 데이터베이스 | SQLite (`bun:sqlite`) + [Drizzle ORM](https://orm.drizzle.team) | `^0.36` |
| 프론트엔드 | [SvelteKit](https://kit.svelte.dev) + Svelte 5 (runes) | `^2.8` / `^5` |
| 스타일 | [Tailwind CSS](https://tailwindcss.com) | `^4.0` |
| 검증 | [Zod](https://zod.dev) | `^3.23` |
| 비밀번호 해시 | bcryptjs | `^2.4` |
| JWT 인증 | [jose](https://github.com/panva/jose) (HS256) | `^5.10` |
| 식별자 | [ULID](https://github.com/ulid/spec) | — |
| 린트 + 포맷 | [Biome](https://biomejs.dev) | `^1.9` |
| 테스트 | `bun:test` | (내장) |
| 외부 의존 | EdgeAI Box REST API | v1.3.6 (OpenAPI 3.0.3) |

---

## Available Scripts

루트 `package.json` 에 정의된 스크립트:

| 스크립트 | 설명 |
|----------|------|
| `bun run dev` | api + web 동시 개발 서버 (concurrently) |
| `bun run build` | 모든 워크스페이스 빌드 |
| `bun run lint` | Biome 린트 검사 |
| `bun run format` | Biome 포맷 자동 적용 |
| `bun run typecheck` | TypeScript 전체 타입 검사 (`tsc --build`) |
| `bun run test` | 모든 패키지 단위 테스트 |
| `bun run test:cov` | 커버리지 측정 |
| `bun run db:migrate` | SQLite 마이그레이션 적용 |
| `bun run db:seed` | 기본 관리자 시드 |

> 패키지별 스크립트는 `bun run --cwd <path> <script>` 로 호출하세요 (예: `bun run --cwd apps/api dev`).

---

## 환경 변수

`.env` 파일에 설정합니다. 전체 목록은 `.env.example` 참조.

| 변수 | 필수 | 설명 |
|------|------|------|
| `DATABASE_PATH` | 필수 | SQLite 파일 경로 (**절대 경로 권장** — 모노레포에서 cwd 의존 문제 예방) |
| `API_PORT` | 선택 | API 서버 포트 (기본 3000) |
| `NODE_ENV` | 선택 | `development` / `test` / `production` |
| `JWT_SECRET` | **필수** | JWT 서명 키 — **32바이트 이상 필수** (`openssl rand -base64 48` 권장). 서버 시작 시 검증, 미충족 시 종료 |
| `INTERNAL_API_URL` | 선택 | SvelteKit hooks 가 호출하는 내부 API URL (기본 `http://localhost:3000`) |
| `BOX_VAULT_KEY` | **필수 (SPEC-BOX-001)** | Box 자격증명 암호화 키 — **32바이트 hex (64자 필수)** (`openssl rand -hex 32` 권장). 서버 시작 시 검증, 미충족 시 종료 |
| `BOX_STATUS_POLL_INTERVAL_MS` | 선택 | Box 상태 폴링 주기 (밀리초, 기본 60000 = 60초) — SPEC-BOX-001 |
| `ADMIN_USERNAME` | 시드 시 | 기본 관리자 사용자명 |
| `ADMIN_PASSWORD` | 시드 시 | 기본 관리자 비밀번호 |
| `VAPID_*` | 후속 SPEC | WebPush (SPEC-ALERT-*) |
| `TELEGRAM_BOT_TOKEN` | 후속 SPEC | 텔레그램 알림 (SPEC-ALERT-*) |

---

## 데이터 모델

9개 테이블로 구성됩니다 (자세한 컬럼은 `packages/db/src/schema/` 참조):

- `users` — 관리자 계정 (username, hashed_password, email)
- `auth_token_blacklist` — 로그아웃된 토큰 (jti UNIQUE, expires_at로 cleanup)
- `boxes` — EdgeAI Box 등록 정보 (자격증명 AES-GCM 암호화)
- `cameras` — 박스 산하 카메라 (지도 좌표 포함)
- `camera_groups` — 카메라 그룹화
- `alerts` — AI 검출 알림 기록
- `alert_rules` — 알림 규칙
- `web_push_subs` — WebPush 구독 정보
- `telegram_subs` — Telegram 구독 정보

모든 테이블의 PK 는 ULID 문자열, 타임스탬프는 Unix epoch milliseconds (INTEGER).

---

## 개발 방법론

- **Hybrid 모드** (`.moai/config/sections/quality.yaml`):
  - 신규 코드 → TDD (RED-GREEN-REFACTOR)
  - 기존 코드 수정 → DDD (ANALYZE-PRESERVE-IMPROVE)
- **TRUST 5** 품질 게이트: Tested · Readable · Unified · Secured · Trackable
- **SPEC 우선**: 모든 기능은 `.moai/specs/SPEC-XXX/` 에 EARS 형식 명세 후 구현

---

## 인증 사용 가이드

SPEC-AUTH-001 로 구현된 JWT HttpOnly 쿠키 기반 인증:

- **로그인**: `/login` 페이지에서 기본 관리자 계정(ADMIN_USERNAME/ADMIN_PASSWORD)으로 로그인
- **토큰 발급**: 성공 시 HttpOnly 쿠키 자동 설정 (Access 15분, Refresh 7일)
- **보호 라우트**: `/(app)` 라우트 그룹은 세션 검증 필수 (미인증 시 `/login` 리다이렉트)
- **API 직접 호출**: Access 토큰은 쿠키에만 저장되며, API 호출 시 `Cookie` 헤더로 자동 전송
- **필수 환경 변수**: `JWT_SECRET` (32바이트 이상) — 미충족 시 서버 시작 실패
- **로그아웃**: `/logout` 액션으로 토큰 폐기 및 쿠키 만료

---

## 후속 SPEC 로드맵

| SPEC | 범위 | 상태 |
|------|------|------|
| `SPEC-AUTH-001` | JWT 쿠키 기반 로그인 / Refresh 로테이션 / 보호 라우트 가드 | ✅ 완료 |
| `SPEC-AUTH-002` | 비밀번호 변경 / API Key 관리 | 계획 |
| `SPEC-BOX-001` | Box 등록 / 동기화 / 자격증명 관리 | 계획 |
| `SPEC-MAP-001` | 지도 기반 카메라 마커 / 그룹 시각화 | 계획 |
| `SPEC-LIVE-001` | HLS / WebRTC 라이브 뷰어 | 계획 |
| `SPEC-MEDIA-001` | 녹화 / 스냅샷 / 타임랩스 브라우저 | 계획 |
| `SPEC-ALERT-001` | AI 검출 폴러 / WebPush / Telegram 알림 | 계획 |
| `SPEC-OPS-001` | Docker / CI / 모니터링 | 계획 |

---

## 라이선스

이 저장소의 라이선스는 추후 결정됩니다.
