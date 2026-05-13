# SPEC-BOX-UI-001: 구현 계획

TAG: SPEC-BOX-UI-001
DOMAIN: box, ui, frontend
PHASE: feature

---

## 기술 스택 확정

| 항목 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | SvelteKit 2.8+ | 기존 프로젝트 동일 |
| UI 레이어 | Svelte 5 runes (`$state`, `$derived`, `$props`) | Svelte 4 Options API 사용 금지 |
| 스타일 | TailwindCSS 4.0 유틸리티 클래스 | shadcn-svelte 도입 없음 |
| 언어 | TypeScript 5.9+ strict, `any` 금지 | |
| 테스트 러너 | Bun test | vitest 추가 없음 |
| 유효성 검사 | Zod (기존 설치) | 신규 패키지 없음 |
| **신규 npm 패키지** | **없음** | 런타임 의존성 추가 금지 |

---

## 의존성 및 연관 SPEC

- **depends-on**: SPEC-AUTH-001 (완료), SPEC-BOX-001 (완료)
- **related**: SPEC-CORE-001, SPEC-BOX-CHANNELS-001 (미래), SPEC-MAP-001 (미래)
- **touches-not-owns**: `apps/web/src/routes/(app)/+layout.svelte` (네비게이션 링크 추가, minor edit)

---

## 개발 방법론

`.moai/config/sections/quality.yaml`의 `development_mode`가 `ddd`로 설정되어 있으나, 본 SPEC은 **신규 UI 코드** 작성이므로 `hybrid_settings.new_features=tdd`에 따라 **RED-GREEN-REFACTOR(TDD) 사이클**을 명시적으로 적용한다. 이는 SPEC-BOX-001과 동일한 정책이다.

---

## 태스크 분해 (우선순위 기반 마일스톤)

### 1차 목표 (Primary Goals) — 핵심 컴포넌트 및 API 헬퍼

#### Task 1: `StatusBadge.svelte` 컴포넌트

**목표**: `status` prop에 따라 emerald/slate/rose 색상과 한국어 라벨을 렌더링하는 재사용 배지

**TDD 사이클**:
- RED: `StatusBadge` 단위 테스트 작성 (active→emerald/"정상", inactive→slate/"비활성", error→rose/"오류")
- GREEN: `apps/web/src/lib/components/box/StatusBadge.svelte` 구현
- REFACTOR: Tailwind 클래스 맵 추출, 타입 안전성 강화

**파일**:
- `apps/web/src/lib/components/box/StatusBadge.svelte`

---

#### Task 2: `RelativeTime.svelte` 컴포넌트

**목표**: `Date | number | null` 입력을 한국어 상대시간으로 렌더링, `title`에 ISO 8601 절대시각

**TDD 사이클**:
- RED: 경계 케이스 5종 테스트 작성
  - null → "동기화 이력 없음"
  - 30초 경과 → "방금 전"
  - 5분 경과 → "5분 전"
  - 3시간 경과 → "3시간 전"
  - 3일 경과 → "yyyy-MM-dd HH:mm" 형식
- GREEN: `apps/web/src/lib/components/box/RelativeTime.svelte` 구현
- REFACTOR: 순수 함수 `formatRelativeTime` 추출 → 독립 테스트 용이성 확보

**파일**:
- `apps/web/src/lib/components/box/RelativeTime.svelte`

---

#### Task 3: `apps/web/src/lib/api/boxes.ts` 서버 헬퍼

**목표**: 서버 사이드 fetch 래퍼. `INTERNAL_API_URL` 기반 절대 URL, cookie 전달, 에러 매핑

**TDD 사이클**:
- RED: 통합 테스트 작성
  - 정상 응답 → BoxSummary[] 반환
  - 401 응답 → 호출자에게 401 전파
  - 400/409/502 → 에러 객체 반환
  - cookie 헤더 전달 검증
- GREEN: `boxes.ts` 구현 (fetch 래퍼, 에러 분기)
- REFACTOR: 공통 fetch 헬퍼 패턴과 일관성 맞추기

**파일**:
- `apps/web/src/lib/api/boxes.ts`

---

### 2차 목표 (Secondary Goals) — 페이지 라우트 구현

#### Task 4: 목록 페이지

**목표**: `/(app)/boxes` 목록 + 15초 visibility-gated 폴링

**TDD 사이클**:
- RED: `list-page-server.test.ts` 작성 (load 반환값, 에러 처리)
- GREEN: `+page.server.ts` load 구현 → `+page.svelte` 렌더링 + 폴링 로직
- REFACTOR: `$effect` cleanup 패턴, visibility 이벤트 리스너 정리

**파일**:
- `apps/web/src/routes/(app)/boxes/+page.server.ts`
- `apps/web/src/routes/(app)/boxes/+page.svelte`
- `apps/web/src/lib/components/box/BoxCard.svelte`
- `apps/web/__tests__/routes/boxes/list-page-server.test.ts`

**폴링 구현 패턴**:
```typescript
// $effect 내부 pseudocode
let intervalId: ReturnType<typeof setInterval> | undefined;

const startPolling = () => {
  intervalId = setInterval(async () => {
    const res = await fetch('/api/boxes');
    if (res.status === 401) {
      stopPolling();
      window.location.href = '/login';
      return;
    }
    boxes = await res.json();
  }, 15_000);
};

const stopPolling = () => clearInterval(intervalId);

const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    fetchBoxes(); // 즉시 1회
    startPolling();
  } else {
    stopPolling();
  }
};

document.addEventListener('visibilitychange', onVisibilityChange);
return () => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibilityChange);
};
```

---

#### Task 5: 등록 폼 페이지

**목표**: `/(app)/boxes/new` Zod 검증 + 4종 에러 처리 + password 비보존

**TDD 사이클**:
- RED: `new-page-server.test.ts` 작성 (성공, 400, 409, 502, Zod 검증 실패)
- GREEN: `+page.server.ts` 액션 구현 → `+page.svelte` 렌더링
- REFACTOR: 에러 메시지 상수 분리, `use:enhance` 점진적 향상 적용

**파일**:
- `apps/web/src/routes/(app)/boxes/new/+page.server.ts`
- `apps/web/src/routes/(app)/boxes/new/+page.svelte`
- `apps/web/src/lib/components/box/BoxForm.svelte`
- `apps/web/__tests__/routes/boxes/new-page-server.test.ts`

**password 비보존 패턴**:
```typescript
// +page.server.ts action 실패 시
return fail(400, {
  ...data,
  password: '', // password 필드는 항상 비워서 반환
  error: '...'
});
```

---

#### Task 6: 상세 페이지

**목표**: `/(app)/boxes/[id]` load + delete + refresh 액션, 자격증명 비노출

**TDD 사이클**:
- RED: `[id]-page-server.test.ts` 작성 (load 정상/404, delete 성공, refresh 성공/실패)
- GREEN: `+page.server.ts` load + actions 구현 → `+page.svelte` 렌더링
- REFACTOR: 액션 응답 타입 정의, 인라인 알림 패턴 통일

**파일**:
- `apps/web/src/routes/(app)/boxes/[id]/+page.server.ts`
- `apps/web/src/routes/(app)/boxes/[id]/+page.svelte`
- `apps/web/__tests__/routes/boxes/[id]-page-server.test.ts`

---

### 3차 목표 (Final Goals) — 네비게이션 및 통합 검증

#### Task 7: 네비게이션 링크 추가

**목표**: `(app)/+layout.svelte`에 "박스 관리" 링크 추가

**파일** (minor edit, 소유하지 않음):
- `apps/web/src/routes/(app)/+layout.svelte`

**변경 내용**: 기존 네비게이션 영역에 `/boxes` 링크 추가 (1~3줄 변경)

---

#### Task 8: 통합 테스트 3종 완성 확인

**목표**: 전체 page-server 테스트 커버리지 85% 이상 달성

**테스트 파일**:
- `apps/web/__tests__/routes/boxes/list-page-server.test.ts`
- `apps/web/__tests__/routes/boxes/new-page-server.test.ts`
- `apps/web/__tests__/routes/boxes/[id]-page-server.test.ts`

---

## 위험 분석 및 완화

### 위험 1: 폴링으로 인한 백엔드 부하

- **발생 조건**: 사용자 수 증가 시 15초 × N 클라이언트 동시 폴링
- **완화**: visibility-gated 폴링으로 비활성 탭은 0회/분 보장
- **후속 검토**: SPEC-BOX-002 후보로 SSE(Server-Sent Events) 대체 검토

### 위험 2: SvelteKit 서버 fetch 무한 재귀

- **발생 조건**: `+page.server.ts`에서 `/api/boxes` 상대 경로로 fetch 시 자기 참조
- **완화**: `INTERNAL_API_URL` 환경 변수로 `http://localhost:3000/api/boxes` 절대 URL 호출 (SPEC-AUTH-001 동일 패턴)

### 위험 3: password 평문 보존

- **발생 조건**: 폼 액션 실패 시 `fail()` 반환 데이터에 password 포함
- **완화**: 액션 실패 반환 시 `password: ''`로 명시적 초기화. `form.data`에 password 미반영

### 위험 4: confirm 다이얼로그 UX 한계

- **발생 조건**: 브라우저 기본 `confirm()`은 모바일에서 스타일 제한
- **완화**: 본 SPEC에서는 브라우저 `confirm()`으로 충분. 후속 SPEC에서 자체 모달 개선 검토

---

## 테스트 전략

### 테스트 러너

Bun test (`bun test`)를 기본 러너로 사용한다. DOM 시뮬레이션이 필요한 컴포넌트 단위 테스트보다 **page-server 통합 테스트** 위주로 85% 커버리지 목표를 충족한다.

### 테스트 대상

| 테스트 파일 | 테스트 대상 | 주요 시나리오 |
|---|---|---|
| `list-page-server.test.ts` | `+page.server.ts` load | 정상 목록 반환, 백엔드 오류, 빈 목록 |
| `new-page-server.test.ts` | `+page.server.ts` action | 성공/redirect, 400/409/502 에러, Zod 실패, password 비반환 |
| `[id]-page-server.test.ts` | `+page.server.ts` load+actions | load 정상/404, delete 성공, refresh 성공/실패 |

### 컴포넌트 테스트

- `StatusBadge`, `RelativeTime`은 Bun test + 순수 함수 추출로 로직 단위 테스트
- DOM 렌더링 검증은 E2E(Playwright) 범위로 분류하나 본 SPEC에서는 선택 사항

### 커버리지 목표

- **전체 목표**: 85% 이상
- **신규 코드**: TDD 사이클 적용으로 90% 이상 예상
- **제외 대상**: Svelte 컴포넌트 마크업 부분 (DOM 테스트 없이 로직만 검증)

---

## 구현 후 정리 (권고 사항)

현재 `.moai/config/sections/quality.yaml`의 `development_mode`가 `ddd`로 설정되어 있으나, 본 SPEC과 SPEC-BOX-001 모두 신규 코드에서 TDD를 적용하고 있다. 구현 완료 후 다음 정렬을 권고한다:

```yaml
# .moai/config/sections/quality.yaml
constitution:
  development_mode: "hybrid"  # ddd → hybrid로 변경 권고
```

이는 신규 코드에 TDD, 레거시 코드에 DDD를 자동 적용하는 `hybrid` 모드와 실제 개발 패턴을 일치시킨다. 변경은 별도 PR로 처리하는 것을 권장한다.

---

## 구현 완료 보고 (Implementation Summary)

### 상태
구현 완료 (2026-05-13)

### 방법론
TDD (RED-GREEN-REFACTOR), 8개 Task 순차 실행

### 각 Task 상태 (모두 완료)
- Task 1 — StatusBadge.svelte (+ statusBadge.helpers.ts): GREEN/REFACTOR 완료, 7개 테스트 통과
- Task 2 — RelativeTime.svelte (+ relativeTime.helpers.ts): GREEN/REFACTOR 완료, 9개 테스트 통과
- Task 3 — boxes.ts API 헬퍼: GREEN/REFACTOR 완료, FetchLike 의존성 주입 패턴 채택
- Task 4 — 목록 페이지 + 폴링: GREEN/REFACTOR 완료, visibility-gated 15초 주기 구현
- Task 5 — 등록 폼 페이지: GREEN/REFACTOR 완료, 4종 에러 매핑 + stripPassword 검증
- Task 6 — 상세 페이지: GREEN/REFACTOR 완료, delete/refresh 액션 + 404 처리
- Task 7 — 네비게이션 링크: 완료 (`(app)/+layout.svelte` 수정)
- Task 8 — 통합 테스트 3종: 완료 (`list-page-server.test.ts`, `new-page-server.test.ts`, `id-page-server.test.ts`)

### 테스트 결과
79 pass / 0 fail / 130 expect calls (~27ms)

### LSP 게이트
svelte-check 0 errors, biome 0 errors, TypeScript strict 0 errors → run 단계 PASS

### TRUST 5
PASS (manager-quality 검증, password/jwt/apiKey 비노출 확인)
