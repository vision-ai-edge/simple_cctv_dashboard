---
id: SPEC-BOX-UI-001
version: 0.1.0
status: Draft
created: 2026-05-13
updated: 2026-05-13
author: imgughyeon
priority: High
---

# SPEC-BOX-UI-001: EdgeAI Box 관리 UI 구현

## 변경 이력

| 날짜 | 버전 | 내용 | 작성자 |
|---|---|---|---|
| 2026-05-13 | 0.1.0 | 초안 작성 | imgughyeon |

---

## 환경 (Environment)

- **프레임워크**: SvelteKit 2.8+, Svelte 5 (runes API: `$state`, `$derived`, `$props`)
- **스타일**: TailwindCSS 4.0 유틸리티 클래스 (shadcn-svelte 미사용)
- **언어**: TypeScript 5.9+ strict 모드, `any` 금지
- **앱 루트**: `apps/web/`
- **라우팅**: SvelteKit 파일 시스템 라우팅, `(app)` 그룹으로 보호 라우트 구성
- **백엔드**: SPEC-BOX-001에서 구현된 5개 엔드포인트 (`/api/boxes/*`) 의존
- **런타임**: Bun (테스트 러너 포함)

---

## 가정 (Assumptions)

1. **백엔드 API 완성**: SPEC-BOX-001이 완료되어 5개 엔드포인트가 정상 동작한다.
2. **인증 완성**: SPEC-AUTH-001이 완료되어 `event.locals.user` 가드가 정상 동작한다.
3. **개발 프록시**: `vite.config.ts`의 `/api` → `http://localhost:3000` 프록시가 유효하다.
4. **내부 URL**: 서버 사이드 fetch는 `INTERNAL_API_URL` 환경 변수를 사용해 절대 URL로 호출한다 (SvelteKit 무한 재귀 방지).
5. **자격증명 비노출**: `BoxSummary` 응답에 password, jwt, api_key가 포함되지 않으며, `hasApiKey: boolean`만 UI에 노출된다.
6. **신규 npm 패키지 없음**: 본 SPEC에서 새로운 런타임 의존성을 추가하지 않는다.
7. **폴링 주기**: 클라이언트 15초 폴링은 백엔드 `boxStatusPoller` 60초 주기보다 충분히 빠르다.

---

## 요구사항 (Requirements)

### REQ-UI-1: Box 목록 페이지

**[Ubiquitous]** 인증된 사용자에게 `/(app)/boxes`는 등록된 Box 목록을 카드/표 형태로 표시한다.

**[Ubiquitous]** 각 Box 행은 이름, host:port, status 배지, lastSyncAt 상대시간, 상세 보기 링크, 삭제 버튼을 노출한다.

**[State-Driven]** 페이지가 가시 상태(`document.visibilityState === 'visible'`)인 동안 15초 주기로 `GET /api/boxes`를 폴링하여 목록을 갱신한다.

**[Event-Driven]** `document.visibilityState`가 `hidden`으로 전이될 때 폴링을 중단하고, `visible`로 복귀할 때 즉시 1회 갱신 후 폴링을 재개한다.

**[Unwanted]** 폴링 응답이 401일 때 클라이언트는 `/login`으로 리다이렉트하고 폴링을 중단해야 한다.

---

### REQ-UI-2: Box 등록 폼

**[Event-Driven]** 사용자가 `/(app)/boxes/new` 폼을 제출하면 SvelteKit 폼 액션이 입력을 Zod 스키마(`{name, host, port, username, password, useApiKey?}`)로 검증 후 `POST /api/boxes`를 호출하고, 성공 시 `/(app)/boxes/{id}`로 303 리다이렉트한다.

**[Event-Driven]** 백엔드가 400을 반환할 때 폼은 "EdgeAI Box 자격증명을 확인하세요" 메시지를 필드 비독립 에러 영역에 표시한다.

**[Event-Driven]** 백엔드가 409를 반환할 때 폼은 "동일한 Box(host:port)가 이미 등록되어 있습니다" 메시지를 표시한다.

**[Event-Driven]** 백엔드가 502를 반환할 때 폼은 "EdgeAI Box에 연결할 수 없습니다. 네트워크 상태를 확인하세요" 메시지를 표시한다.

**[Unwanted]** 폼은 password 값을 클라이언트 상태로 보존하지 않으며(실패 시 password 필드만 비움), 응답 본문/콘솔/`form.data`에 평문 password를 다시 노출하지 않아야 한다.

---

### REQ-UI-3: Box 상세 및 작업

**[Event-Driven]** `/(app)/boxes/[id]` 진입 시 `+page.server.ts`의 load는 `GET /api/boxes/:id`를 호출하여 BoxSummary를 반환한다. 404 시 SvelteKit `error(404, ...)`로 전이한다.

**[Event-Driven]** 상세 페이지의 "토큰 수동 갱신" 액션은 `POST /api/boxes/:id/refresh`를 호출하고, 결과를 같은 페이지에 인라인 알림으로 표시한다.

**[Event-Driven]** 상세 페이지의 "삭제" 액션은 확인(브라우저 confirm 또는 자체 모달) 후 `DELETE /api/boxes/:id` 호출, 성공 시 `/(app)/boxes`로 303 리다이렉트한다.

**[Unwanted]** 상세 페이지는 `hasApiKey` 불리언만 표시해야 하며, 실제 JWT/API Key/password 값을 절대 렌더링하지 않아야 한다.

---

### REQ-UI-4: 상태 시각화 컴포넌트

**[Ubiquitous]** `StatusBadge` 컴포넌트는 `status` prop에 따라 정해진 색상 토큰(active=emerald, inactive=slate, error=rose)과 한국어 라벨("정상", "비활성", "오류")을 표시한다.

**[Ubiquitous]** `RelativeTime` 컴포넌트는 `Date | number | null` 입력을 받아 "방금 전", "n분 전", "n시간 전", "yyyy-MM-dd HH:mm" 규칙으로 한국어 상대시간을 렌더링하고, ISO 8601 절대시각을 `title` 속성에 둔다.

**[Optional]** lastSyncAt이 null인 Box에 대해 `RelativeTime`은 "동기화 이력 없음"을 표시한다.

---

### REQ-UI-5: 네비게이션 및 접근 제어

**[Ubiquitous]** `/(app)/+layout.svelte`는 보호 영역 상단 또는 사이드에 "박스 관리" 링크를 추가하여 `/(app)/boxes` 진입점을 노출한다.

**[Ubiquitous]** 모든 `/(app)/boxes/*` 라우트는 `(app)` 그룹의 `+layout.server.ts` 가드를 상속받아 미인증 접근 시 `/login`으로 리다이렉트된다.

**[Unwanted]** 본 SPEC의 어떤 페이지도 `event.locals.user`가 없는 상태에서 백엔드 호출을 시도하지 않아야 한다.

---

## 사양 (Specifications)

### BoxSummary 타입 정의

```typescript
// apps/web/src/lib/api/boxes.ts
interface BoxSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  baseUrl: string;
  username: string;
  status: 'active' | 'inactive' | 'error';
  lastSyncAt: number | null;
  createdAt: number;
  updatedAt: number;
  hasApiKey: boolean;
}
```

### 파일 구조

```
apps/web/src/
├── routes/(app)/boxes/
│   ├── +page.server.ts         # load: GET /api/boxes (서버 사이드 fetch)
│   ├── +page.svelte            # 목록 뷰: 상태 배지, lastSync, 자동 폴링 15초
│   ├── new/
│   │   ├── +page.server.ts     # default action: POST /api/boxes, Zod 검증, 성공 시 redirect
│   │   └── +page.svelte        # 등록 폼
│   └── [id]/
│       ├── +page.server.ts     # load: GET /api/boxes/:id; actions: delete, refresh
│       └── +page.svelte        # 상세 뷰 + 삭제 확인 + 갱신 버튼
├── lib/components/box/
│   ├── StatusBadge.svelte      # status prop → emerald/slate/rose 배지
│   ├── BoxCard.svelte          # 목록용 카드 컴포넌트
│   ├── BoxForm.svelte          # 등록 폼 재사용 컴포넌트
│   └── RelativeTime.svelte     # Date|number|null → 한국어 상대시간
├── lib/api/
│   └── boxes.ts                # 서버 사이드 fetch 헬퍼 (cookie 전달, 에러 매핑)
└── __tests__/routes/boxes/
    ├── list-page-server.test.ts
    ├── new-page-server.test.ts
    └── [id]-page-server.test.ts
```

### 에러 응답 매핑

| HTTP 상태 | 표시 메시지 |
|---|---|
| 400 | "EdgeAI Box 자격증명을 확인하세요" |
| 401 | 전역 처리: `/login` 리다이렉트 |
| 409 | "동일한 Box(host:port)가 이미 등록되어 있습니다" |
| 502 | "EdgeAI Box에 연결할 수 없습니다. 네트워크 상태를 확인하세요" |

### 상태 배지 색상 토큰

| status 값 | Tailwind 색상 | 한국어 라벨 |
|---|---|---|
| `active` | `emerald` | "정상" |
| `inactive` | `slate` | "비활성" |
| `error` | `rose` | "오류" |

### RelativeTime 렌더링 규칙

| 경과 시간 | 표시 형식 |
|---|---|
| null | "동기화 이력 없음" |
| 60초 미만 | "방금 전" |
| 60분 미만 | "n분 전" |
| 24시간 미만 | "n시간 전" |
| 24시간 이상 | "yyyy-MM-dd HH:mm" |

### 폴링 동작 사양

- 주기: 15초 (`setInterval`)
- 구현: `$effect` + `setInterval` + cleanup 함수
- 일시 중단: `document.visibilityState === 'hidden'` 시
- 재개: `visibilitychange` 이벤트로 `visible` 전환 시 즉시 1회 갱신 후 재개
- 401 응답: `window.location.href = '/login'` 후 폴링 종료

---

## 추적성 (Traceability)

```
TAG: SPEC-BOX-UI-001
DOMAIN: box, ui, frontend
PHASE: feature
PACKAGES: web (apps/web routes + components + lib/api)
EXTERNAL: SPEC-BOX-001 백엔드 API (POST/GET/GET:id/POST:id/refresh/DELETE:id)
RELATED: SPEC-CORE-001, SPEC-AUTH-001, SPEC-BOX-001, SPEC-BOX-CHANNELS-001 (미래)
STATUS: Draft (2026-05-13)
DEPENDS_ON: SPEC-AUTH-001 (완료), SPEC-BOX-001 (완료)
SECURITY: 자격증명 비노출(OWASP A02 일관), 401 가드, 보호 라우트 가드
```
