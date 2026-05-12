# SPEC-CORE-001: 인수 기준 (Acceptance Criteria)

```
TAG: SPEC-CORE-001
DOMAIN: foundation
PHASE: scaffold
```

---

## 사용 방법

각 항목은 `/moai run SPEC-CORE-001` 실행 후 수동 또는 자동으로 검증합니다.
완료된 항목은 `[x]`로 표시합니다. 모든 항목이 `[x]`여야 SPEC-CORE-001이 완료됩니다.

---

## AC-1: 모노레포 골격

### 시나리오: Bun Workspace 초기화

```
Given: 프로젝트 루트 디렉토리에 있고
When:  `bun install`을 실행하면
Then:  종료 코드 0으로 완료되어야 한다
And:   `node_modules/@cctv/shared`, `node_modules/@cctv/db` 심볼릭 링크가 존재해야 한다
```

**검증 명령어:**
```bash
cd /path/to/simple_cctv_dashboard
bun install
echo "종료 코드: $?"
ls -la node_modules/@cctv/
```

**합격 기준:**
- [ ] 종료 코드: `0`
- [ ] `node_modules/@cctv/shared` 존재
- [ ] `node_modules/@cctv/db` 존재

---

### 시나리오: TypeScript 전체 타입 검사

```
Given: `bun install`이 완료된 상태에서
When:  `bun run typecheck`를 실행하면
Then:  TypeScript 오류 0개로 종료되어야 한다 (종료 코드 0)
```

**검증 명령어:**
```bash
bun run typecheck
echo "종료 코드: $?"
```

**합격 기준:**
- [ ] 종료 코드: `0`
- [ ] stderr에 "error TS" 문자열 없음

---

### 시나리오: Biome 린트 검사

```
Given: 전체 코드베이스가 작성된 상태에서
When:  `bun run lint`를 실행하면
Then:  린트 오류 0개로 종료되어야 한다 (종료 코드 0)
```

**검증 명령어:**
```bash
bun run lint
echo "종료 코드: $?"
```

**합격 기준:**
- [ ] 종료 코드: `0`

---

### 시나리오: 필수 설정 파일 존재

```
Given: 스캐폴딩이 완료된 상태에서
When:  파일 존재 여부를 확인하면
Then:  다음 모든 파일이 존재해야 한다
```

**검증 명령어:**
```bash
test -f package.json && echo "OK: package.json"
test -f tsconfig.json && echo "OK: tsconfig.json"
test -f biome.json && echo "OK: biome.json"
test -f bunfig.toml && echo "OK: bunfig.toml"
test -f .env.example && echo "OK: .env.example"
test -f .gitignore && echo "OK: .gitignore"
```

**합격 기준:**
- [ ] `package.json` 존재 + `"workspaces"` 포함
- [ ] `tsconfig.json` 존재 + `"references"` 포함
- [ ] `biome.json` 존재
- [ ] `bunfig.toml` 존재
- [ ] `.env.example` 존재 + `DATABASE_PATH`, `API_PORT`, `JWT_SECRET` 포함
- [ ] `.gitignore` 존재 + `node_modules/`, `*.sqlite`, `.env` 패턴 포함

---

## AC-2: `packages/shared` — BoxClient

### 시나리오: BoxClient 팩토리 호출

```
Given: `createBoxClient` 팩토리가 존재하고
When:  `createBoxClient({ baseUrl: 'http://localhost', jwt: 'test-token' })`를 호출하면
Then:  BoxClient 인스턴스가 반환되어야 한다
And:   `auth`, `system`, `channels`, `models`, `visionAi`, `media`, `hls`, `webrtc` 그룹이 존재해야 한다
```

**검증: 단위 테스트 (`packages/shared/src/__tests__/client.test.ts`)**

```bash
bun --cwd packages/shared test
```

**합격 기준:**
- [ ] 테스트 파일 `packages/shared/src/__tests__/client.test.ts` 존재
- [ ] 모든 테스트 통과 (종료 코드 0)

---

### 시나리오: `auth.login` 성공 — mock-fetch 기반

```
Given: global fetch가 성공 응답을 반환하도록 mock 설정되고
       응답: { success: true, token: 'jwt-abc', expiresAt: null, timestamp: 1000 }
When:  `client.auth.login('admin', 'password')`를 호출하면
Then:  반환값의 `token`이 'jwt-abc'여야 한다
And:   반환값의 `expiresAt`이 null이어야 한다
```

**테스트 코드 위치:** `packages/shared/src/__tests__/client.test.ts`

**합격 기준:**
- [ ] `auth.login` 성공 테스트 통과

---

### 시나리오: `BoxApiError` 던짐 — API 에러 응답 시

```
Given: global fetch가 다음 응답을 반환하도록 mock 설정되고
       HTTP 상태: 401
       응답 바디: { success: false, message: 'Unauthorized', timestamp: 1000 }
When:  `client.auth.me()`를 호출하면
Then:  `BoxApiError`가 던져져야 한다
And:   `error.message`가 'Unauthorized'이어야 한다
And:   `error.statusCode`가 401이어야 한다
```

**합격 기준:**
- [ ] `BoxApiError` 던짐 테스트 통과

---

### 시나리오: `buildHlsUrl` URL 형식 검증

```
Given: baseUrl이 'https://box.example.com:8443/api'인 BoxClient가 생성되고
When:  `client.hls.buildPlaylistUrl('ch1', { jwt: 'my-jwt' })`를 호출하면
Then:  반환값이 'https://box.example.com:8443/api/hls/ch1/playlist.m3u8?token=my-jwt'이어야 한다
```

**합격 기준:**
- [ ] `buildHlsUrl` URL 형식 테스트 통과

---

### 시나리오: `buildWebRtcPlayerUrl` URL 형식 검증

```
Given: baseUrl이 'https://box.example.com:8443/api'인 BoxClient가 생성되고
When:  `client.webrtc.buildPlayerUrl('ch1', 'my-apikey')`를 호출하면
Then:  반환값이 'https://box.example.com:8443/api/webrtc/player?channel=ch1&apikey=my-apikey'이어야 한다
```

**합격 기준:**
- [ ] `buildWebRtcPlayerUrl` URL 형식 테스트 통과

---

### 시나리오: `waitForChannelStatus` 타임아웃

```
Given: `getChannelStatus`가 항상 { status: 'CONNECTING' }를 반환하도록 mock 설정되고
When:  `client.waitForChannelStatus('ch1', 'RUNNING', { timeoutMs: 100, intervalMs: 10 })`를 호출하면
Then:  `BoxApiError`가 던져져야 한다 (타임아웃)
```

**합격 기준:**
- [ ] `waitForChannelStatus` 타임아웃 테스트 통과

---

### 시나리오: `packages/shared` 빌드

```
Given: TypeScript 소스가 작성된 상태에서
When:  `bun --cwd packages/shared run build`를 실행하면
Then:  종료 코드 0으로 완료되어야 한다
```

**합격 기준:**
- [ ] `packages/shared` 빌드 성공 (종료 코드 0)
- [ ] `packages/shared/dist/index.js` 존재 (또는 번들 없이 타입만 제공하는 경우 `dist/index.d.ts`)

---

## AC-3: `packages/db` — Drizzle 스키마 및 마이그레이션

### 시나리오: 마이그레이션 실행

```
Given: `.env`에 `DATABASE_PATH=./data/test.sqlite`가 설정되고
When:  `bun run db:migrate`를 실행하면
Then:  종료 코드 0으로 완료되어야 한다
And:   `./data/test.sqlite` 파일이 생성되어야 한다
And:   8개 테이블이 모두 존재해야 한다
```

**검증 명령어:**
```bash
DATABASE_PATH=./data/test.sqlite bun run db:migrate
echo "종료 코드: $?"
# 테이블 목록 확인
sqlite3 ./data/test.sqlite ".tables"
```

**합격 기준:**
- [ ] 종료 코드: `0`
- [ ] `sqlite3 ./data/test.sqlite ".tables"` 출력에 `users boxes cameras camera_groups alerts alert_rules web_push_subs telegram_subs` 모두 포함

---

### 시나리오: 시드 실행 — 기본 관리자 생성

```
Given: 마이그레이션이 완료된 DB가 존재하고
       ADMIN_USERNAME=admin, ADMIN_PASSWORD=test-password 환경 변수가 설정된 상태에서
When:  `bun run db:seed`를 실행하면
Then:  종료 코드 0으로 완료되어야 한다
And:   users 테이블에 username='admin' 레코드가 존재해야 한다
And:   password_hash 필드가 bcrypt 형식($2b$)으로 저장되어야 한다
```

**검증 명령어:**
```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD=test-password DATABASE_PATH=./data/test.sqlite bun run db:seed
echo "종료 코드: $?"
sqlite3 ./data/test.sqlite "SELECT username, substr(password_hash, 1, 4) as hash_prefix FROM users;"
```

**합격 기준:**
- [ ] 종료 코드: `0`
- [ ] `username` 컬럼에 `admin` 존재
- [ ] `hash_prefix`가 `$2b$` 또는 `$2a$` (bcrypt 형식)

---

### 시나리오: 마이그레이션 멱등성 — 동일 마이그레이션 2회 실행

```
Given: 마이그레이션이 이미 실행된 DB가 존재하고
When:  `bun run db:migrate`를 다시 실행하면
Then:  종료 코드 0으로 완료되어야 한다
And:   기존 데이터가 손상되지 않아야 한다
```

**합격 기준:**
- [ ] 2회 실행 시 종료 코드: `0` (오류 없음)

---

### 시나리오: 스키마 파일 존재 확인

```
Given: 스캐폴딩이 완료된 상태에서
When:  파일 존재 여부를 확인하면
Then:  다음 모든 파일이 존재해야 한다
```

**검증 명령어:**
```bash
test -f packages/db/src/schema.ts && echo "OK: schema.ts"
test -f packages/db/src/migrations/0001_init.sql && echo "OK: 0001_init.sql"
test -f packages/db/src/migrate.ts && echo "OK: migrate.ts"
test -f packages/db/src/seed.ts && echo "OK: seed.ts"
test -f packages/db/drizzle.config.ts && echo "OK: drizzle.config.ts"
```

**합격 기준:**
- [ ] `packages/db/src/schema.ts` 존재
- [ ] `packages/db/src/migrations/0001_init.sql` 존재
- [ ] `packages/db/src/migrate.ts` 존재
- [ ] `packages/db/src/seed.ts` 존재
- [ ] `packages/db/drizzle.config.ts` 존재

---

## AC-4: `apps/api` 스켈레톤

### 시나리오: `/health` 엔드포인트 — 정상 응답

```
Given: `.env`가 올바르게 설정된 상태에서
When:  `bun --cwd apps/api run dev`로 서버를 시작하고
       `curl http://localhost:3000/health`를 실행하면
Then:  HTTP 상태 200을 반환해야 한다
And:   응답 바디가 { "ok": true, "version": "<version>" } 형식이어야 한다
```

**검증 명령어:**
```bash
# 백그라운드 서버 시작
DATABASE_PATH=./data/dev.sqlite bun --cwd apps/api run dev &
sleep 2
# 헬스 체크
curl -s http://localhost:3000/health
echo ""
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health
```

**합격 기준:**
- [ ] HTTP 상태 코드: `200`
- [ ] 응답 바디 `"ok": true` 포함
- [ ] 응답 바디 `"version"` 필드 존재

---

### 시나리오: 환경 변수 누락 시 서버 기동 실패

```
Given: DATABASE_PATH 환경 변수가 설정되지 않은 상태에서
When:  `bun --cwd apps/api run dev`를 실행하면
Then:  종료 코드 1로 종료되어야 한다
And:   오류 메시지에 누락된 변수명이 포함되어야 한다
```

**합격 기준:**
- [ ] 환경 변수 누락 시 프로세스 즉시 종료 (종료 코드 1)
- [ ] stderr에 의미 있는 오류 메시지 출력

---

### 시나리오: CORS 헤더 확인

```
Given: 개발 서버가 실행 중인 상태에서
When:  `curl -H "Origin: http://localhost:5173" http://localhost:3000/health`를 실행하면
Then:  응답 헤더에 `Access-Control-Allow-Origin`이 포함되어야 한다
```

**합격 기준:**
- [ ] `Access-Control-Allow-Origin` 헤더 존재

---

## AC-5: `apps/web` 스켈레톤

### 시나리오: 웹 앱 기동 및 페이지 접근

```
Given: API 서버와 웹 서버가 모두 실행 중인 상태에서
When:  브라우저에서 `http://localhost:5173`을 방문하면
Then:  "CCTV Dashboard" 텍스트가 페이지에 표시되어야 한다
```

**검증 명령어 (Playwright 또는 수동):**
```bash
bun --cwd apps/web run dev &
sleep 3
# 페이지 소스에서 텍스트 확인
curl -s http://localhost:5173 | grep -c "CCTV Dashboard"
```

**합격 기준:**
- [ ] 웹 서버 기동 성공 (종료 코드 0)
- [ ] `"CCTV Dashboard"` 텍스트 존재

---

### 시나리오: API 헬스 배지 — API 서버 정상 시

```
Given: API 서버가 정상 실행 중이고
       웹 앱이 API URL에 접근 가능한 상태에서
When:  루트 페이지(`/`)를 로드하면
Then:  녹색 헬스 배지("정상" 또는 "OK" 표시)가 표시되어야 한다
```

**합격 기준:**
- [ ] 헬스 배지 컴포넌트가 `+page.svelte`에 구현됨
- [ ] API 응답에 따라 배지 색상이 변경됨

---

### 시나리오: Tailwind + shadcn-svelte 설치 확인

```
Given: 스캐폴딩이 완료된 상태에서
When:  파일 존재 여부와 설정을 확인하면
Then:  Tailwind와 shadcn-svelte가 초기화된 상태여야 한다
```

**검증 명령어:**
```bash
test -f apps/web/src/app.css && echo "OK: app.css"
# Tailwind 클래스 사용 확인
grep -r "@tailwind\|@import.*tailwind" apps/web/src/
# shadcn-svelte 컴포넌트 디렉토리
test -d apps/web/src/lib/components/ui && echo "OK: shadcn-svelte ui dir"
```

**합격 기준:**
- [ ] `apps/web/src/app.css` 존재 + Tailwind 임포트 포함
- [ ] `apps/web/src/lib/components/ui/` 디렉토리 존재 (shadcn-svelte 초기화 결과)

---

## AC-6: 통합 검증

### 시나리오: 전체 앱 동시 개발 서버 실행

```
Given: `bun install`과 `bun run db:migrate`가 완료된 상태에서
When:  루트에서 `bun run dev`를 실행하면
Then:  apps/api와 apps/web 양쪽 서버가 모두 기동되어야 한다
```

**합격 기준:**
- [ ] `http://localhost:3000/health` → HTTP 200
- [ ] `http://localhost:5173` → HTTP 200

---

### 시나리오: 전체 단위 테스트 통과

```
Given: 전체 패키지가 설치된 상태에서
When:  `bun run test`를 실행하면
Then:  모든 테스트가 통과해야 한다 (종료 코드 0)
```

**검증 명령어:**
```bash
bun run test
echo "종료 코드: $?"
```

**합격 기준:**
- [ ] 종료 코드: `0`
- [ ] 실패한 테스트 0개

---

### 시나리오: 커버리지 최소 기준

```
Given: 단위 테스트가 모두 통과한 상태에서
When:  `bun run test:cov`를 실행하면
Then:  `packages/shared`의 커버리지가 85% 이상이어야 한다
```

**검증 명령어:**
```bash
bun run test:cov 2>&1 | grep -E "packages/shared|All files"
```

**합격 기준:**
- [ ] `packages/shared` 커버리지 ≥ 85%

---

## AC-7: `.gitignore` 및 보안

### 시나리오: 민감 파일이 Git에 추적되지 않음

```
Given: `.gitignore`가 올바르게 설정된 상태에서
When:  `git status`를 실행하면
Then:  다음 파일/패턴이 추적 목록에 없어야 한다
```

**검증 명령어:**
```bash
git status --porcelain | grep -E "\.env$|\.sqlite$|node_modules"
```

**합격 기준:**
- [ ] `.env` — git status에 표시 안 됨
- [ ] `*.sqlite` 파일 — git status에 표시 안 됨
- [ ] `node_modules/` — git status에 표시 안 됨

---

## 품질 게이트 (Quality Gates)

SPEC-CORE-001이 완료되려면 다음 품질 게이트가 모두 통과해야 합니다:

| 게이트 | 명령어 | 기준 |
|--------|--------|------|
| TypeScript 타입 검사 | `bun run typecheck` | 종료 코드 0, TS 에러 0개 |
| Biome 린트 | `bun run lint` | 종료 코드 0 |
| 단위 테스트 | `bun run test` | 종료 코드 0, 실패 0개 |
| 커버리지 | `bun run test:cov` | packages/shared ≥ 85% |
| API 헬스 | `curl http://localhost:3000/health` | HTTP 200, `"ok":true` |
| 웹 기동 | `curl http://localhost:5173` | HTTP 200 |
| 마이그레이션 | `bun run db:migrate` | 종료 코드 0, 8개 테이블 |

---

## Definition of Done

- [ ] 모든 AC 시나리오에서 합격 기준 달성
- [ ] 모든 품질 게이트 통과
- [ ] `packages/shared`, `packages/db`, `apps/api`, `apps/web` 4개 서브패키지 구조 완성
- [ ] `.env.example`에 모든 환경 변수 문서화
- [ ] Biome 린트/포맷 위반 0개
- [ ] TypeScript 에러 0개
- [ ] `BoxClient.auth.login` 단위 테스트 (mock-fetch 기반) 통과
- [ ] `/health` 엔드포인트 200 응답 확인
- [ ] `bun run dev` 양쪽 앱 동시 기동 성공
