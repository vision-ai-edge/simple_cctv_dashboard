# simple_cctv_dashboard

EdgeAI Box API 기반 CCTV 통합 관제 대시보드.

지도에 카메라를 배치하고, AI 검출 결과를 알림으로 받으며, HLS/WebRTC 라이브 영상을 통합 관리하는 단일 사용자 운영자용 웹 애플리케이션입니다.

> **현재 상태**: SPEC-CORE-001 (기반 구조) 구현 완료. 인증/지도/라이브뷰/알림 기능은 후속 SPEC에서 추가됩니다.

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
# .env 파일을 열어 DATABASE_PATH, ADMIN_USERNAME, ADMIN_PASSWORD 등 수정

# 3) 데이터베이스 초기화 + 관리자 시드
DATABASE_PATH="$PWD/data/cctv.sqlite" bun run db:migrate
ADMIN_USERNAME=admin ADMIN_PASSWORD=change-me DATABASE_PATH="$PWD/data/cctv.sqlite" bun run db:seed

# 4) 개발 서버 동시 실행 (API: :3000, Web: :5173)
DATABASE_PATH="$PWD/data/cctv.sqlite" bun run dev
```

기동 후 브라우저에서 [`http://localhost:5173`](http://localhost:5173) 접속.

### 헬스 체크

```bash
curl http://localhost:3000/health
# {"ok":true,"version":"0.1.0"}
```

---

## 모노레포 구조

```
simple_cctv_dashboard/
├── apps/
│   ├── api/                 # Bun + Hono 백엔드 (REST API)
│   └── web/                 # SvelteKit + Tailwind 4 프론트엔드
├── packages/
│   ├── shared/              # EdgeAI Box 타입 클라이언트 (`@cctv/shared`)
│   │   └── src/edgeai-box-client/
│   │       ├── client.ts    # BoxClient (auth/channels/models/visionAi/media/hls/webrtc)
│   │       ├── types.ts     # Zod 스키마
│   │       └── error.ts     # BoxApiError 커스텀 예외
│   └── db/                  # Drizzle ORM + bun:sqlite (`@cctv/db`)
│       └── src/
│           ├── schema.ts    # 8개 테이블 정의
│           ├── migrate.ts   # 마이그레이션 러너 CLI
│           ├── seed.ts      # 관리자 시드 CLI
│           └── migrations/  # SQL 마이그레이션 파일
├── .moai/                   # MoAI-ADK 프로젝트 메타데이터
│   ├── config/sections/     # quality, workflow, language, user 설정
│   ├── project/             # product, structure, tech 문서
│   └── specs/SPEC-CORE-001/ # SPEC 명세 + 계획 + 인수기준
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
| `DATABASE_PATH` | 필수 | SQLite 파일 경로 (절대 경로 권장) |
| `API_PORT` | 선택 | API 서버 포트 (기본 3000) |
| `NODE_ENV` | 선택 | `development` / `test` / `production` |
| `JWT_SECRET` | 후속 SPEC | JWT 서명 키 (SPEC-AUTH-*) |
| `BOX_VAULT_KEY` | 후속 SPEC | Box 자격증명 암호화 키 (32 bytes hex) |
| `ADMIN_USERNAME` | 시드 시 | 기본 관리자 사용자명 |
| `ADMIN_PASSWORD` | 시드 시 | 기본 관리자 비밀번호 |
| `VAPID_*` | 후속 SPEC | WebPush (SPEC-ALERT-*) |
| `TELEGRAM_BOT_TOKEN` | 후속 SPEC | 텔레그램 알림 (SPEC-ALERT-*) |

---

## 데이터 모델

8개 테이블로 구성됩니다 (자세한 컬럼은 `packages/db/src/schema.ts` 참조):

- `users` — 관리자 계정
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

## 후속 SPEC 로드맵

| SPEC | 범위 |
|------|------|
| `SPEC-AUTH-*` | 로그인 / 비밀번호 변경 / API Key 관리 UI |
| `SPEC-BOX-*` | Box 등록 / 동기화 / 자격증명 관리 |
| `SPEC-MAP-*` | 지도 기반 카메라 마커 / 그룹 시각화 |
| `SPEC-LIVE-*` | HLS / WebRTC 라이브 뷰어 |
| `SPEC-MEDIA-*` | 녹화 / 스냅샷 / 타임랩스 브라우저 |
| `SPEC-ALERT-*` | AI 검출 폴러 / WebPush / Telegram 알림 |
| `SPEC-OPS-*` | Docker / CI / 모니터링 |

---

## 라이선스

이 저장소의 라이선스는 추후 결정됩니다.
