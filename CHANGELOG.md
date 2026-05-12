# Changelog

이 프로젝트의 모든 주요 변경 사항을 본 파일에 기록합니다.

본 변경 이력은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르며, 버전 번호는 [SemVer](https://semver.org/lang/ko/) 를 준수합니다.

---

## [Unreleased]

### Planned

- SPEC-AUTH-002: 비밀번호 변경 / API Key 관리 UI
- SPEC-BOX-002: 채널 동기화 및 Box 다중 확장
- SPEC-MAP-001: 지도 기반 카메라 마커 시각화

---

## [0.3.0] — 2026-05-13

### Added — SPEC-BOX-001 (EdgeAI Box 등록 및 자격증명 볼트)

#### packages/shared — AES-GCM 자격증명 볼트
- `assertBoxVaultKey`: BOX_VAULT_KEY 32바이트 hex(64자) 검증, 에러 메시지에 키 값 미포함
- `encryptWithVault`: AES-256-GCM 암호화 (12B 랜덤 IV + ciphertext + 16B auth tag 단일 blob)
- `decryptWithVault`: GCM auth tag 자동 검증 (변조 감지)
- Bun 내장 Web Crypto API 사용, 외부 의존성 추가 없음
- 단위 테스트 16개

#### packages/db — boxes 테이블 보강
- 마이그레이션 0003_box_vault.sql: `jwt_cached_enc`, `api_key_cached_enc` BLOB 컬럼 추가
- 마이그레이션 0004_box_unique_url.sql: `base_url` 중복 등록 방지 UNIQUE INDEX
- Drizzle 스키마에 신규 컬럼 + uniqueIndex 선언
- 기존 `jwt_cached`, `api_key_cached` (text) 컬럼은 backward compat용 보존
- 마이그레이션 통합 테스트 15개

#### apps/api — Box 서비스·라우트·폴러
- `boxService`: registerBox, listBoxes, getBox, deleteBox, refreshTokens, withAuthRetry
- `BoxRegistrationError` {statusCode, code} 시그니처 (409 분기 지원)
- `BoxNotFoundError`
- `POST /api/boxes` — 등록 + EdgeAI Box `/auth/login` 즉시 헬스체크, 중복 base_url 409 응답
- `GET /api/boxes`, `GET /api/boxes/:id` — 자격증명 마스킹 응답
- `POST /api/boxes/:id/refresh` — 수동 토큰 갱신
- `DELETE /api/boxes/:id` — 삭제 (204)
- 모든 라우트 requireAuth 미들웨어 보호
- `withAuthRetry`: 401 응답 자동 재로그인 가드 (1회 제한, 실패 시 status='error')
- `boxStatusPoller`: 60초 주기 GET `/system/health`, 3회 연속 실패 시 status='error' 전이, 싱글톤 보장
- 단위 16 + 통합 21 + 폴러 12 + config 4 = 53개 신규 테스트

#### 환경 변수
- `BOX_VAULT_KEY`: 32바이트 hex (64자 필수, 서버 시작 시 검증 후 미충족 시 process.exit(1))
- `BOX_STATUS_POLL_INTERVAL_MS`: 선택 (기본 60000)

#### 보안 강화
- 자격증명 평문이 API 응답·로그·에러 메시지에 절대 노출되지 않음 (메타-테스트 검증)
- OWASP A02 (Cryptographic Failures) 대응
- 401 무한 재귀 방지 (withAuthRetry 1회 제한)
- 폴러 다중 인스턴스 방지 (싱글톤 패턴)

### Documentation

- `.moai/specs/SPEC-BOX-001/`: status Implemented, HISTORY 갱신, Implementation Notes 섹션 추가
- `.moai/project/{product,structure,tech}.md`: SPEC-BOX-001 결과 반영
- `README.md`: 현재 상태 갱신, 환경 변수 표 보강

---

## [0.2.0] — 2026-05-12

### Added — SPEC-AUTH-001 (JWT 쿠키 기반 사용자 인증)

#### packages/db — 토큰 블랙리스트
- `auth_token_blacklist` 테이블 신규 (id, jti UNIQUE, user_id FK, expires_at, created_at)
- 마이그레이션 `0002_auth_blacklist.sql` 추가
- `blacklistJti`, `isJtiBlacklisted` 헬퍼 (cleanup 트랜잭션 포함)
- 단위 테스트 15개

#### packages/shared — JWT 유틸리티
- `signAccessToken`, `signRefreshToken`, `verifyToken`, `parseTokenClaims`, `assertJwtSecret`
- HS256 서명, ULID jti, iss="simple_cctv"
- Access 15분 / Refresh 7일 만료
- jose ^5.8 의존성 추가
- 단위 테스트 19개

#### apps/api — 인증 미들웨어 및 라우트
- `requireAuth` 미들웨어 (쿠키 → verifyToken → 블랙리스트 조회 → context 주입)
- `rateLimit` 미들웨어 (15분 5회 초과 시 429 + Retry-After)
- `POST /api/auth/login` — Zod 검증, bcryptjs 타이밍 안전 비교, 쿠키 2종 발급
- `POST /api/auth/logout` — jti 블랙리스트, 쿠키 만료
- `GET /api/auth/me` — 인증 사용자 정보
- `POST /api/auth/refresh` — Refresh 로테이션, 재사용 감지 시 401
- 통합 + 단위 테스트 39개

#### apps/web — SvelteKit 로그인 및 보호 라우트
- `/login` 페이지 + 서버 액션 (한국어 폼, 로딩 상태)
- `/(app)` 보호 라우트 그룹 + `+layout.server.ts` 가드
- `/logout` 액션
- `hooks.server.ts` — 전역 쿠키 검증
- `lib/server/auth.ts` — getCurrentUser 헬퍼
- `lib/stores/auth.ts` — 클라이언트 auth 스토어
- `app.d.ts` Locals/PageData 타입
- 단위 테스트 21개

### Changed

- API 라우트 마운트 경로를 `/api` prefix 로 통일 (`/health` → `/api/health` 포함)
- Vite proxy 의 `/api → ''` rewrite 제거 — SPEC 명시 경로 패스스루
- `JWT_SECRET` 환경 변수를 선택 → **필수**로 변경 (32바이트 이상)
- `.env.example`: JWT_SECRET 가이드, DATABASE_PATH 절대 경로 권장

### Security

- HttpOnly + SameSite=Lax + Secure(prod 한정) 쿠키 강제
- bcryptjs 타이밍 안전 비밀번호 비교, 균일한 오류 메시지 (사용자 존재 여부 비노출)
- 인메모리 레이트 리미팅 (`POST /api/auth/login` 15분 5회)
- Refresh 토큰 로테이션 + 재사용 감지 (블랙리스트 jti 매칭 시 401)
- JWT_SECRET 32바이트 미만 시 서버 시작 거부

### Fixed

- SvelteKit `hooks.server.ts` 무한 재귀 (event.fetch 가 라우터 통해 hooks 재진입) → 절대 URL fetch 로 우회
- 모노레포에서 `DATABASE_PATH` 상대 경로의 cwd 의존 문제 — `.env.example` 가이드 보강

### Documentation

- `.moai/specs/SPEC-AUTH-001/spec.md`: status Implemented, Implementation Notes 섹션 추가
- `.moai/project/{structure,tech,product}.md`: SPEC-AUTH-001 결과 반영
- `README.md`: 인증 가이드, 환경 변수 표, 헬스체크 경로 갱신

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

[Unreleased]: https://github.com/vision-ai-edge/simple_cctv_dashboard/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/vision-ai-edge/simple_cctv_dashboard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vision-ai-edge/simple_cctv_dashboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vision-ai-edge/simple_cctv_dashboard/releases/tag/v0.1.0
