# Changelog

이 프로젝트의 모든 주요 변경 사항을 본 파일에 기록합니다.

본 변경 이력은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르며, 버전 번호는 [SemVer](https://semver.org/lang/ko/) 를 준수합니다.

---

## [Unreleased]

### Planned

- SPEC-AUTH-001: 로그인 / JWT 토큰 발급 / API Key 관리 UI
- SPEC-BOX-001: EdgeAI Box 등록 CRUD
- SPEC-MAP-001: 지도 기반 카메라 마커 시각화

---

## [0.1.0] — 2026-05-12

### Added — SPEC-CORE-001 (기반 구조)

#### 모노레포 골격
- Bun 1.3 Workspaces 기반 모노레포 (`apps/*`, `packages/*`)
- TypeScript 5.9 프로젝트 참조 (`tsconfig.base.json` 공유 베이스)
- Biome 1.9 통합 린트 + 포맷 (ESLint + Prettier 대체)
- 루트 스크립트: `dev`, `build`, `lint`, `format`, `typecheck`, `test`, `db:migrate`, `db:seed`

#### packages/shared — EdgeAI Box 타입 클라이언트
- `BoxClient` 클래스 (40+ 엔드포인트 메서드)
  - `auth`: `login`, `me`, `regenerateApiKey`, `changePassword`
  - `system`: `health`, `info`
  - `channels`: `list`, `get`, `create`, `update`, `delete`, `start`, `stop`, `status`, `snapshot`
  - `models`: `list`, `get`, `upload`, `delete`
  - `visionAi`: detections / trackings / config / model 슬롯 / ROI 관리
  - `media`: recordings / images / timelapse 날짜 및 페이지 조회
- URL 헬퍼: `hls.buildPlaylistUrl`, `webrtc.buildPlayerUrl`, `webrtc.buildSignalingWsUrl`
- 폴링 유틸: `waitForChannelStatus` (타임아웃 시 `BoxApiError(408)`)
- Zod 스키마 기반 응답 검증 (passthrough 정책으로 알 수 없는 필드 허용)
- `BoxApiError` 커스텀 예외 (`success: false` 봉투 및 HTTP 4xx/5xx 정규화)

#### packages/db — 영속 계층
- Drizzle ORM + `bun:sqlite` 어댑터
- 8개 테이블 스키마: `users`, `boxes`, `cameras`, `camera_groups`, `alerts`, `alert_rules`, `web_push_subs`, `telegram_subs`
- ULID PK, Unix ms 타임스탬프, CASCADE 외래키, CHECK 제약
- 인덱스 8개 (status, FK, processed 등)
- `migrate.ts`: 트랜잭션 + `__migrations` 메타테이블로 멱등성 보장
- `seed.ts`: bcryptjs 비밀번호 해시 + `INSERT OR IGNORE`

#### apps/api — Hono 백엔드
- `GET /health` 엔드포인트 (`{ ok, version }`)
- 환경 변수 Zod 검증 (`DATABASE_PATH` 누락 시 `exit(1)`)
- 구조화 로거 (개발: 텍스트, 프로덕션: JSON)
- 개발 모드 한정 CORS 미들웨어
- 글로벌 404 / 에러 핸들러 (`success: false` 봉투)
- SIGTERM/SIGINT 정상 종료 처리

#### apps/web — SvelteKit 프론트엔드
- SvelteKit 2.8 + Svelte 5 (runes: `$state`, `$derived`, `$props`)
- Tailwind CSS 4.0 (`@import "tailwindcss"` + `@theme` CSS-first 방식)
- `+layout.svelte`, `+page.svelte`: "CCTV Dashboard" 헤딩 + API 헬스 배지
- 헬스 배지 색상 전이: 녹색(정상) / 빨간색(오류) / 회색(로딩)
- Vite API 프록시 (`/api` → `:3000`)
- `kit.alias` 로 `@cctv/shared` 워크스페이스 별칭 노출

#### 품질 검증
- 단위 테스트 44개 통과 (shared 30 + db 7 + api 7)
- `packages/shared` 라인 커버리지 93.18%, 함수 커버리지 87.02% (목표 85% 초과)
- `bun run typecheck`: 0 errors
- `bun run lint`: 0 errors

### Changed

- `quality.yaml` `development_mode`: `ddd` → `hybrid` (그린필드 신규 코드에 TDD 적용)

### Documentation

- `.moai/project/`: product.md, structure.md, tech.md
- `.moai/specs/SPEC-CORE-001/`: spec.md, plan.md, acceptance.md (구현 결과 반영)
- `README.md`: 프로젝트 개요, Quick Start, 모노레포 구조, 기술 스택
- `CHANGELOG.md`: Keep a Changelog 형식

---

[Unreleased]: https://github.com/vision-ai-edge/simple_cctv_dashboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vision-ai-edge/simple_cctv_dashboard/releases/tag/v0.1.0
