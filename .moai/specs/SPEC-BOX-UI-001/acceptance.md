# SPEC-BOX-UI-001: 인수 기준 (Acceptance Criteria)

TAG: SPEC-BOX-UI-001
DOMAIN: box, ui, frontend
PHASE: feature

---

## 인수 시나리오 (Given/When/Then)

### 시나리오 1: 목록 페이지 — 데이터 로딩 및 렌더링

**Given** 인증된 사용자 세션이 존재하고, 백엔드에 2개의 Box가 등록되어 있다.
- Box A: `{name: "카메라A", host: "192.168.1.10", port: 8080, status: "active", lastSyncAt: <현재-1분>}`
- Box B: `{name: "카메라B", host: "192.168.1.11", port: 8080, status: "error", lastSyncAt: null}`

**When** 사용자가 `/(app)/boxes`에 접근한다.

**Then**
- 두 Box가 카드 또는 행 형태로 화면에 표시된다.
- Box A의 status 배지는 emerald 색상으로 "정상" 라벨을 표시한다.
- Box B의 status 배지는 rose 색상으로 "오류" 라벨을 표시한다.
- Box A의 lastSyncAt은 "1분 전" 형태로 표시된다.
- Box B의 lastSyncAt은 "동기화 이력 없음"으로 표시된다.
- 각 Box에 상세 보기 링크가 존재한다.

---

### 시나리오 2: 목록 페이지 — 15초 자동 폴링

**Given** `/(app)/boxes` 목록 페이지가 브라우저에서 가시 상태로 열려 있다.

**When** 첫 로드 후 15초가 경과한다.

**Then**
- `GET /api/boxes` API가 다시 호출된다.
- 백엔드에서 변경된 Box 상태(예: inactive → active)가 화면에 반영된다.

**And** `document.visibilityState`가 `hidden`으로 전환될 때 (예: 다른 탭으로 이동)

**Then**
- 다음 15초 폴링이 발생하지 않는다. (`GET /api/boxes` 미호출)

**And** 다시 `visible`로 복귀할 때

**Then**
- 즉시 1회 `GET /api/boxes`가 호출된다.
- 이후 15초 폴링이 재개된다.

---

### 시나리오 3: 등록 폼 — 정상 경로

**Given** 사용자가 유효한 EdgeAI Box 자격증명을 보유하고 있다.
- `name: "신규카메라"`, `host: "192.168.1.20"`, `port: 8080`, `username: "admin"`, `password: "valid_pass"`

**When** `/(app)/boxes/new`에서 위 정보를 입력하고 폼을 제출한다.

**Then**
- 백엔드 `POST /api/boxes`가 호출된다.
- 백엔드 201 응답 후 `/(app)/boxes/{새 id}` 상세 페이지로 303 리다이렉트된다.
- 상세 페이지에서 신규 Box의 이름과 정보가 표시된다.
- 응답 본문 및 클라이언트 스토어 어디에도 `password` 평문이 포함되지 않는다.

---

### 시나리오 4: 등록 폼 — 중복 등록 거부 (409)

**Given** `host: "192.168.1.10"`, `port: 8080`의 Box가 이미 등록되어 있다.

**When** 동일한 host/port로 `/(app)/boxes/new` 폼을 제출한다.

**Then**
- 백엔드가 409를 반환한다.
- 폼 페이지에 "동일한 Box(host:port)가 이미 등록되어 있습니다" 에러 메시지가 표시된다.
- 리다이렉트가 발생하지 않는다 (폼 페이지에 머문다).
- 백엔드 DB에 추가 INSERT가 수행되지 않는다.

---

### 시나리오 5: 등록 폼 — 자격증명 오류 (400)

**Given** 사용자가 잘못된 password를 입력한다.
- `host: "192.168.1.10"`, `port: 8080`, `password: "wrong_pass"`

**When** `/(app)/boxes/new` 폼을 제출한다.

**Then**
- 백엔드가 400을 반환한다.
- 폼 페이지에 "EdgeAI Box 자격증명을 확인하세요" 에러 메시지가 표시된다.
- `password` 입력 필드가 비워진다 (평문 보존 금지).
- 다른 필드(name, host, port, username)는 입력값이 유지된다.
- 응답 `form.data` 또는 브라우저 콘솔에 평문 password가 노출되지 않는다.

---

### 시나리오 6: 상세 페이지 — 삭제 흐름

**Given** `id: "box-123"`인 Box가 등록되어 있고, 사용자가 `/(app)/boxes/box-123` 상세 페이지에 있다.

**When** "삭제" 버튼을 클릭하고 확인 다이얼로그에서 확인을 선택한다.

**Then**
- 백엔드 `DELETE /api/boxes/box-123`가 호출된다.
- 백엔드 204 응답 후 `/(app)/boxes` 목록 페이지로 303 리다이렉트된다.
- 목록 페이지에서 `box-123` Box가 더 이상 표시되지 않는다.

---

### 시나리오 7: 상세 페이지 — 자격증명 노출 금지

**Given** `id: "box-456"`인 Box가 등록되어 있고, 해당 Box는 API 키를 사용한다 (`hasApiKey: true`).

**When** `/(app)/boxes/box-456` 상세 페이지를 열고, 브라우저 DevTools에서 HTML 응답 및 네트워크 응답을 확인한다.

**Then**
- 페이지 HTML 어디에도 실제 password, jwt 토큰, api_key 값이 포함되지 않는다.
- `hasApiKey: true` 여부는 불리언으로만 표시된다 (예: "API 키 사용: 예").
- 네트워크 응답(`GET /api/boxes/box-456`)에 자격증명 필드가 포함되지 않는다.

---

### 시나리오 8: 인증 가드 — 미인증 접근 차단

**Given** 인증되지 않은 세션(쿠키 없음 또는 만료된 세션)이다.

**When** `/(app)/boxes`, `/(app)/boxes/new`, 또는 `/(app)/boxes/box-123`에 직접 접근한다.

**Then**
- `/login`으로 303 리다이렉트된다.
- 백엔드 API 호출이 전혀 발생하지 않는다 (`event.locals.user` 부재 시 조기 리턴).

---

## 엣지 케이스 (Edge Cases)

### EC-1: 빈 목록 상태

**Given** 등록된 Box가 없다.

**When** `/(app)/boxes`에 접근한다.

**Then** "등록된 Box가 없습니다" 또는 이에 준하는 빈 상태 메시지가 표시된다. 에러 화면이 아닌 정상 빈 목록 화면이어야 한다.

---

### EC-2: 단일 Box

**Given** 정확히 1개의 Box가 등록되어 있다.

**When** `/(app)/boxes`에 접근한다.

**Then** 1개의 Box 카드가 정상 렌더링되며, 목록 레이아웃이 깨지지 않는다.

---

### EC-3: lastSyncAt null Box

**Given** `lastSyncAt`이 null인 Box가 목록에 포함되어 있다 (최초 등록 후 폴링 미완료 상태 등).

**When** 목록 또는 상세 페이지를 렌더링한다.

**Then** `RelativeTime` 컴포넌트가 "동기화 이력 없음"을 표시하며, 에러 없이 렌더링된다.

---

### EC-4: 폴링 중 페이지 이탈 후 복귀

**Given** 목록 페이지에서 폴링이 진행 중이다 (15초 주기).

**When** 사용자가 상세 페이지(`/(app)/boxes/[id]`)로 이동했다가 뒤로 가기로 목록 페이지로 돌아온다.

**Then**
- 이전 폴링 인터벌이 정리되어 있다 (메모리 누수 없음).
- 목록 페이지 재진입 시 새 폴링 사이클이 시작된다.
- 브라우저 콘솔에 폴링 관련 에러가 없다.

---

### EC-5: 만료 세션으로 인한 폴링 401

**Given** 목록 페이지에서 폴링이 진행 중이고, 사용자 세션이 만료되었다.

**When** 폴링 요청(`GET /api/boxes`)이 401 응답을 받는다.

**Then**
- 폴링이 즉시 중단된다 (`clearInterval` 호출).
- `window.location.href`가 `/login`으로 설정된다.
- 추가 폴링 요청이 발생하지 않는다.

---

## 성능/품질 게이트 (Quality Gates)

### 성능 기준

| 항목 | 기준 | 측정 방법 |
|---|---|---|
| 목록 페이지 초기 로드 P95 | 1.5초 미만 | 로컬 백엔드, Box 50개 기준 |
| 폴링 호출 빈도 (비가시 시) | 0회/분 | `visibilityState = hidden` 상태에서 network 탭 확인 |
| 폴링 주기 (가시 시) | 15초 ± 1초 | network 탭 타임스탬프 확인 |

### 코드 품질 기준

| 항목 | 기준 |
|---|---|
| 테스트 커버리지 | 85% 이상 (신규 코드 기준) |
| Biome lint | 0 errors |
| svelte-check | 0 errors |
| TypeScript 컴파일 | 0 errors (strict mode) |

### TRUST 5 체크리스트

| 차원 | 검증 항목 | 기준 |
|---|---|---|
| **Tested** | page-server 통합 테스트 | 85% 이상 커버리지 |
| **Readable** | 한국어 코드 주석, 명확한 변수명 | svelte-check 0 errors |
| **Unified** | Biome 포맷, kebab-case 파일명, camelCase 함수, PascalCase 컴포넌트 | Biome lint 0 errors |
| **Secured** | 자격증명 미노출 (password/jwt/api_key 응답 포함 금지), 401 가드, 보호 라우트 가드 | 시나리오 7, 8 통과 |
| **Trackable** | 모든 커밋 메시지에 `SPEC-BOX-UI-001` 참조 | git log 확인 |

### 보안 검증

- [ ] `GET /api/boxes` 응답 페이로드에 `password`, `jwt`, `apiKey` 필드 미포함 확인
- [ ] 폼 액션 실패 반환값 `form.data`에 `password` 필드가 빈 문자열임을 단위 테스트로 확인
- [ ] 미인증 접근 시 백엔드 호출 0회 확인 (서버 로그)
- [ ] 폴링 401 시 즉시 중단 + 리다이렉트 동작 확인

---

## 완료 정의 (Definition of Done)

다음 항목이 모두 충족되어야 구현 완료로 간주한다:

- [ ] 모든 SPEC 요구사항(REQ-UI-1 ~ REQ-UI-5)이 구현되어 있다.
- [ ] 인수 시나리오 1~8이 모두 수동 검증 또는 자동화 테스트로 통과한다.
- [ ] Bun test 커버리지 85% 이상 달성 (`bun test --coverage`)
- [ ] `bun run check` (svelte-check + TypeScript) 0 errors
- [ ] Biome lint 0 errors
- [ ] 상세 페이지 HTML 소스에 자격증명 평문 미포함 확인
- [ ] 폴링 비가시 시 네트워크 요청 0회 확인 (브라우저 DevTools)
- [ ] PR에 `SPEC-BOX-UI-001` 참조 포함
- [ ] `/(app)/+layout.svelte`에 "박스 관리" 네비게이션 링크 추가 완료
