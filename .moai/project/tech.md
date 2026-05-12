# Simple CCTV Dashboard - 기술 스택 및 배포 전략

## 프론트엔드 스택

| 계층 | 기술 | 버전 | 용도 |
|------|------|------|------|
| **프레임워크** | SvelteKit | 2.8+ | 풀스택 웹 프레임워크, 파일기반 라우팅 |
| **언어** | TypeScript | 5.9+ | 타입 안정성, 개발 생산성 |
| **UI 스타일링** | TailwindCSS | 4.0+ | 유틸리티-퍼스트 CSS, 반응형 디자인 |
| **컴포넌트 라이브러리** | shadcn-svelte | 1.0+ | 접근성 높은 UI 컴포넌트 (Button, Modal, Toast 등) |
| **지도** | Leaflet | 1.9+ | 오픈소스 지도 라이브러리 (OSM 지원) |
| **지도 타입스크립트** | leaflet-typescript | - | Leaflet 타입 정의 |
| **영상 재생** | hls.js | 1.6+ | HTTP Live Streaming (HLS) 플레이어 |
| **HTTP 클라이언트** | fetch (native) | - | 기본 Web API 사용 |
| **상태관리** | SvelteKit stores | - | 내장 반응형 저장소 |
| **실시간 통신** | EventSource (SSE) | - | 서버 전송 이벤트 (웹소켓 대체) |
| **번들러** | Vite | 6.0+ | SvelteKit 기본 번들러 |

## 백엔드 스택

| 계층 | 기술 | 버전 | 용도 |
|------|------|------|------|
| **런타임** | Bun | 1.2+ | JavaScript/TypeScript 런타임, 빠른 성능 |
| **프레임워크** | Hono | 4.5+ | 경량 웹 프레임워크 (Fastify 대체) |
| **언어** | TypeScript | 5.9+ | 타입 안정성, 개발 생산성 |
| **데이터베이스** | SQLite | 3.46+ (bun:sqlite) | 임베디드 관계형 DB, 별도 서버 불필요 |
| **ORM** | Drizzle ORM | 1.1+ | 타입안전 쿼리 빌더, 마이그레이션 지원 |
| **입력 검증** | Zod | 4.0+ | 스키마 기반 런타임 검증 |
| **JWT 토큰** | jose | 5.8+ | JWT 암호화/복호화 (HS256) |
| **비밀번호 해싱** | bcryptjs | 2.4+ | 타이밍 안전 비밀번호 해싱 |
| **환경 변수** | dotenv | 16.4+ | .env 파일 파싱 |

## 외부 시스템 통합

### EdgeAI Box API

**기본 정보** (출처: 라이브 OpenAPI 스펙 `/api/openapi.json` v1.3.6)
- **Base URL**: https://01228710945.edgeaibox.com:8443/api
- **OpenAPI**: 3.0.3
- **주요 엔드포인트 그룹**:
  - 인증: `POST /auth/login`, `POST /auth/apikey/regenerate`, `GET /auth/me`
  - 채널: `/channels` CRUD, `/channels/{id}/start|stop|status|snapshot` (start/stop은 비동기 → status 폴링)
  - 비전 AI: `GET /channels/{id}/vision-ai/detections`, `/trackings`, `/config`, `/models`, `/models/{id}/roi`
  - HLS: `GET /hls/{channelId}/playlist.m3u8?token=…|apikey=…` (m3u8만 인증, .ts는 공개)
  - WebRTC: `GET /webrtc/sdk.js`(공개), `/webrtc/player`(쿼리 인증), 시그널링 `ws://…/ws/channels/{id}/webrtc`
  - 미디어: `/channels/{id}/recordings|images|timelapse[/weekly|/monthly]` + 일자별 다운로드 경로
  - 모델: `/models` 업로드(multipart) / 목록 / 삭제
  - 시스템: `/system/health|info|battery|storage|thermal|restart`

**인증 방식** (네 가지, OR 관계)
1. **JWT Bearer** — `POST /auth/login`(username/password)으로 발급, 헤더 `Authorization: Bearer {token}`
2. **API Key** — JWT 인증 후 `POST /auth/apikey/regenerate`로 발급, 헤더 `X-API-Key: {key}`
3. **JWT Query** — `?token={jwt}` (img/video 태그처럼 헤더를 못 보낼 때)
4. **API Key Query** — `?apikey={key}` (HLS playlist, WebRTC player에서 사용)

**토큰 정책** (실측)
- JWT는 만료 시간이 없음(`expiresAt: null`). 따라서 자동 갱신 워커는 **선택 사항**이며, 실패/세션 무효화 시 재로그인하는 단순 전략으로 충분
- API Key도 만료 없음, regenerate로만 회전(rotation) 가능
- 단, 비밀번호 변경/관리자 폐기 시 토큰 무효화 가능성 → 401 응답 시 자동 재로그인 가드 필요

**기타 중요 사항**
- HTTPS는 자체 서명 인증서일 수 있음 → Bun fetch 측 `tls.rejectUnauthorized=false`는 금지하고, 정식 인증서를 갖춘 도메인을 권장
- 비동기 동작: 채널 start/stop 응답이 즉시 와도 실제 상태는 `/status` 폴링 필요 (값: `STOPPED|CONNECTING|RUNNING|PAUSED|ERROR|RETRYING`, 권장 폴링 주기 2s)
- 핫업데이트 vs 재시작: vision-ai/config·ROI·OSD·Widget = 핫업데이트, 모델/입력/해상도/추적 토글 = 파이프라인 재시작 필수
- 에러 봉투: `{success:false, message, timestamp}` 일관 포맷, 4xx/5xx 동일
- 날짜 포맷: 미디어 API의 `date`는 `YYYYMMDD` 8자리 문자열, 타임스탬프는 `int64` 밀리초 epoch
- 페이지네이션: `{total, limit, offset, hasMore}`, limit 기본 100/최대 1000

## 품질 및 개발 방법론

### 개발 방법론
- **Mode**: Hybrid (TDD for new, DDD for legacy)
- **새로운 코드**: TDD (Red-Green-Refactor 사이클)
- **기존 코드 수정**: DDD (ANALYZE-PRESERVE-IMPROVE)

### TRUST 5 품질 프레임워크

| 원칙 | 기준 | 측정 방법 |
|------|------|---------|
| **T (Tested)** | 85% 이상 커버리지 | vitest + c8 커버리지 보고서 |
| **R (Readable)** | eslint/prettier 통과 | `bun lint`, `bun format` |
| **U (Unified)** | 명명 규칙 준수 | 코드 리뷰, eslint rules |
| **S (Secured)** | OWASP 준수 | 보안 코드 검토, 의존성 감시 |
| **T (Trackable)** | Conventional Commits | git log 확인, 이슈 연결 |

### 커버리지 목표
- **전체 프로젝트**: 85% 이상
- **새로운 기능**: 85% (TDD로 자동 충족)
- **수정된 코드**: 85% (DDD로 테스트 추가)
- **면제 불가**: 명시적 면제 정책 없음 (엄격 모드)

### 코드 표준

**언어 설정**
- **코드 주석**: 한국어 (모든 함수, 복잡한 로직)
- **커밋 메시지**: 한국어 (사용자 친화적)
- **명령/에이전트/스킬**: 영어 (MoAI 시스템 표준)

**명명 규칙**
- **변수/함수**: camelCase (JavaScript)
- **상수**: UPPER_SNAKE_CASE
- **파일/디렉토리**: kebab-case
- **컴포넌트**: PascalCase

**코드 스타일**
- **포매터**: Prettier (자동 포매팅)
- **린터**: ESLint + TypeScript rules
- **import 순서**: 표준, 상대 경로, CSS 순

## 인증 및 보안 (SPEC-AUTH-001)

### 사용자 인증 시스템
- **JWT HttpOnly 쿠키**: Access 토큰 (15분) + Refresh 토큰 (7일)
- **서명 방식**: HS256 (jose 라이브러리)
- **토큰 식별자**: ULID 기반 jti (유일성 보장)
- **블랙리스트**: logout/refresh 시 jti 등록으로 토큰 폐기
- **재사용 감지**: 블랙리스트된 refresh 토큰 재사용 시 전체 세션 무효화 (401)

### 보안 메커니즘
- **HttpOnly + SameSite=Lax 쿠키**: XSS/CSRF 공격 방지
- **Secure 플래그**: production 환경에서만 HTTPS 강제
- **bcryptjs 타이밍 안전 비교**: 사용자 존재 여부 비노출 (균일한 오류 메시지)
- **인메모리 레이트 리미팅**: POST /api/auth/login 15분 5회 제한 (429 응답)
- **JWT_SECRET 검증**: 32바이트 이상 강제 (서버 시작 시 검증, 미충족 시 exit(1))

### 인증 플로우
1. 사용자가 `/login`에서 username/password 제출
2. 서버가 bcryptjs로 비밀번호 검증
3. 성공 시 Access + Refresh 토큰 발급 후 HttpOnly 쿠키 설정
4. 클라이언트는 모든 요청 시 쿠키가 자동 포함됨
5. `requireAuth` 미들웨어가 Access 토큰 검증 + 블랙리스트 조회
6. `/logout` 시 토큰 jti를 블랙리스트 등록 후 쿠키 만료

### SvelteKit 통합
- **hooks.server.ts**: 전역 쿠키 파싱 및 event.locals 주입
- **/(app) 보호 라우트**: +layout.server.ts에서 세션 검증, 미인증 시 /login 리다이렉트
- **절대 URL fetch**: SvelteKit 무한 재귀 방지 (hooks 재진입 차단)
- **INTERNAL_API_URL**: 내부 API 호스트 오버라이드 가능 (기본: http://localhost:3000)

---

## 보안 원칙 및 제약사항

### EdgeAI Box 자격증명 보호
- **절대 금지**: 프론트엔드에 Box username/password, JWT, API Key 노출 (Base URL은 화면에는 보여도 무방)
- **권장 방식**:
  - 환경변수 (.env 파일, .gitignore 포함)
  - 암호화 저장소 (e.g., AWS Secrets Manager)
  - 백엔드 프록시 경유

### 라이브 스트림 URL 관리
- **EdgeAI Box 자격증명 노출 금지**: Box JWT/API Key는 절대 브라우저로 내려보내지 않는다
- **프록시 패턴**:
  - 프론트엔드: `GET /api/cameras/:id/live-url?type=hls|webrtc` 호출
  - 백엔드: 우리 백엔드가 Box `apikey`를 합쳐 EdgeAI Box HLS playlist URL을 만들고, 그 위에 **우리 자체 단기 서명 토큰(예: 5분)** 을 붙여 응답 (브라우저는 우리 서명 토큰만 본다)
  - 백엔드는 우리 서명 토큰 검증 후 실제 Box URL로 리다이렉트하거나 m3u8/세그먼트를 스트리밍 프록시
  - 이중 인증: 사용자 세션(JWT) + 단기 서명 토큰 + 리소스 권한 검사
- **WebRTC**: 시그널링 WS도 동일 패턴(`/api/cameras/:id/webrtc-signal`로 우리 백엔드가 wrap)

### JWT 토큰 저장
- **프론트엔드**: HTTPOnly 쿠키 추천 (XSS 방지)
- **유효기간**: 15분 (짧은 주기)
- **갱신 토큰**: 별도 refresh endpoint (7일 유효)
- **로그아웃**: 쿠키 삭제 + 토큰 블랙리스트 (선택사항)

### HTTPS 및 암호화
- **통신**: 모든 API 통신 HTTPS 강제
- **데이터베이스 암호화**: SQLite 평문 (프로덕션 시 고려)
- **비밀번호**: bcrypt로 일방향 해시 (salt 자동)

## 테스트 전략

### 테스트 프레임워크
- **단위/통합**: vitest (Node.js, TypeScript native)
- **커버리지**: c8 (기본 내장)
- **E2E**: Playwright (브라우저 테스트, 선택사항)

### 테스트 대상

**백엔드 (TDD)**
- API 엔드포인트: 200/400/500 응답 검증
- 서비스 로직: 데이터 변환, 비즈니스 규칙
- 데이터베이스: CRUD 작업, 관계 무결성

**프론트엔드 (TDD)**
- 컴포넌트: 렌더링, 사용자 상호작용
- 저장소: 상태 변경, 구독
- 유틸리티: 포매팅, 검증

### 테스트 작성 순서 (TDD 사이클)
1. **Red**: 실패하는 테스트 작성
2. **Green**: 최소한의 코드로 통과
3. **Refactor**: 리팩토링 (테스트 통과 유지)

## CI/CD 및 배포

### 빌드 도구
- **번들러**: Vite (프론트엔드) + Bun (백엔드)
- **빌드 명령어**:
  - `bun install` - 의존성 설치
  - `bun run build` - 프로덕션 빌드
  - `bun run test` - 테스트 실행
  - `bun run test:cov` - 커버리지 리포트

### 배포 환경

**개발 환경** (localhost)
```
PORT=5173 (프론트엔드)
API_PORT=3000 (백엔드)
DATABASE_URL=sqlite:///cctv_dev.db
NODE_ENV=development
```

**스테이징 환경** (준비 중)
```
DATABASE_URL=sqlite:///cctv_staging.db
EDGEAI_BOX_URL=https://staging.edgeaibox.com:8443/api
```

**프로덕션 환경** (준비 중)
```
DATABASE_URL=sqlite:///cctv_prod.db
EDGEAI_BOX_URL=https://01228710945.edgeaibox.com:8443/api
```

### 배포 전략

**배포 대상**
1. **로컬 개발**: Bun dev 서버 (핫 리로드)
2. **클라우드** (준비 중):
   - Vercel (프론트엔드)
   - Railway/Render (백엔드)
   - Neon (PostgreSQL, 선택사항)

**배포 체크리스트**
- [ ] 모든 테스트 통과 (85% 커버리지)
- [ ] LSP 에러/경고 0개
- [ ] 커밋 메시지 Conventional Commits 준수
- [ ] 환경변수 설정 확인
- [ ] 데이터베이스 마이그레이션 실행
- [ ] 성능 테스트 완료 (API P95 < 200ms)

## 운영 및 모니터링

### 로깅
- **포맷**: JSON 구조화 로깅 (프로덕션)
- **레벨**: DEBUG (개발), INFO (프로덕션)
- **저장**: 파일 또는 클라우드 로깅 (ELK, Loki)

### 모니터링
- **API**: 응답시간 (P50/P95/P99), 에러율
- **데이터베이스**: 쿼리 성능, 커넥션 수
- **워커**: 실패율, 재시도 횟수
- **알림**: Telegram/Slack 통합 (선택사항)

### 장애 대응
- **복구 시간 목표 (RTO)**: 1시간
- **데이터 손실 목표 (RPO)**: 1시간 (백업 빈도)
- **자동 재시작**: 시스템 장애 시 자동 복구
- **수동 개입**: 데이터 무결성 확인 필요

## 성능 최적화

### 프론트엔드
- **번들 크기**: 초기 로드 < 200KB (gzip)
- **이미지**: WebP 포맷, 지연 로드
- **CSS**: Tree-shaking (Tailwind 기본)
- **캐싱**: 서비스 워커 (PWA, 선택사항)

### 백엔드
- **데이터베이스 인덱싱**: box_id, camera_id, user_id
- **쿼리 최적화**: JOIN 최소화, SELECT 필드 제한
- **캐싱**: 채널 목록 (10분 TTL), 토큰 (유효기간까지)
- **벤치마크**: `bun run bench` (선택사항)

## 의존성 버전 관리

### 핵심 의존성 (자동 업데이트 제외)
- Bun: 1.2 LTS 이상 (장기 지원)
- Hono: 4.5 이상 (API 호환성)
- SvelteKit: 2.8 이상 (제주로우 업그레이드)

### 정기 검토
- 월 1회 보안 업데이트 확인
- 분기 1회 주요 버전 업그레이드 평가
- npm audit 실행 (보안 취약점 검사)

## 기술 제약 및 고려사항

### 알려진 제한사항
1. **SQLite 동시성**: 쓰기 잠금 (수백 사용자 이상 시 PostgreSQL 전환 필요)
2. **HLS 지연**: 세그먼트 기반 전송 (WebRTC 대체 고려)
3. **Box 인증**: 토큰 만료 시 수동 재인증 (자동화 워커 보완)

### 향후 기술 진화
- **데이터베이스**: SQLite → PostgreSQL (다중 인스턴스 배포)
- **실시간 통신**: SSE → WebSocket (양방향 통신)
- **메시지 큐**: BullMQ/RabbitMQ (워커 확장성)
- **모니터링**: CloudWatch/Datadog (프로덕션 관찰성)
