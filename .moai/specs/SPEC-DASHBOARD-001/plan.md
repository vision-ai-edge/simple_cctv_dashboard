<!-- TAG: DASHBOARD-001 -->
---
id: SPEC-DASHBOARD-001
document: plan
version: 0.1.0
created: 2026-05-15
---

# SPEC-DASHBOARD-001: 구현 계획

## 브랜치 정보

- **작업 브랜치**: `feature/SPEC-DASHBOARD-001`
- **기준 브랜치**: `main`

---

## 전체 구조 개요

```
신규 파일 목록 (예상)
──────────────────────────────────────────────
apps/api/src/routes/cameras.ts         ← 집계 엔드포인트 구현
apps/web/src/routes/(app)/+page.svelte ← /dashboard 리다이렉트로 교체
apps/web/src/routes/(app)/dashboard/
  +page.server.ts                      ← 카메라 목록 로드 (server load)
  +page.svelte                         ← 지도 뷰 + 사이드바
  grid/
    +page.server.ts                    ← 카메라 목록 로드 (server load)
    +page.svelte                       ← 바둑판 멀티뷰
apps/web/src/lib/components/dashboard/
  CameraMap.svelte                     ← Leaflet 지도 컴포넌트
  CameraMarker.svelte (선택)           ← 마커 팩토리 헬퍼
  NoCoordSidebar.svelte                ← 좌표 없는 카메라 사이드바
  GridCell.svelte                      ← 바둑판 단일 셀 컴포넌트
  GridLayoutSelector.svelte            ← 1×1/2×2/3×3 선택 UI
apps/web/src/lib/api/cameras.ts        ← 집계 API 클라이언트 헬퍼
apps/web/src/lib/types/dashboard.ts    ← CameraWithBox 타입 정의
──────────────────────────────────────────────
수정 파일 목록 (예상)
──────────────────────────────────────────────
apps/api/src/routes/index.ts           ← cameras 라우터 마운트 확인
apps/web/src/routes/(app)/+layout.svelte ← 내비게이션 링크 추가
```

---

## 마일스톤 및 태스크 분해

### M1 — 백엔드 집계 API (우선순위: 높음)

프론트엔드 전체가 이 API에 의존하므로 최우선 구현한다.

#### T1-1 — `CameraWithBox` 타입 및 집계 쿼리 설계
- **파일**: `apps/api/src/routes/cameras.ts`
- **내용**:
  - `cameras` JOIN `boxes` 쿼리를 Drizzle ORM으로 작성
  - 응답 직렬화: `id`, `channelId`, `name`, `status`, `latitude`, `longitude`, `boxId`, `boxName`, `boxStatus`, `lastSyncedAt`
  - Box 자격증명 컬럼(password_enc, jwt_cached_enc, api_key_cached_enc) 응답 제외
  - `requireAuth` 미들웨어 적용
  - Zod 응답 스키마 정의
- **복잡도**: S (소규모)
- **의존성**: 없음

#### T1-2 — 집계 API 라우트 등록 및 테스트
- **파일**: `apps/api/src/routes/index.ts`, `apps/api/src/routes/cameras.ts`
- **내용**:
  - `GET /api/cameras` 라우트를 메인 라우터에 마운트
  - 단위 테스트: 인증 없는 요청 → 401, 인증 있는 요청 → 200 + 카메라 배열
  - 통합 테스트: 카메라 없는 경우 빈 배열 반환, JOIN 결과 검증
- **복잡도**: S
- **의존성**: T1-1

**M1 병렬화**: T1-1과 T1-2는 순차 실행. 백엔드 전체가 M1 완료 후 M2, M3와 동시 진행 가능.

---

### M2 — 지도 뷰 (우선순위: 높음)

MVP #1(지도 기반 카메라 배치)에 해당하는 핵심 기능이다.

#### T2-1 — 프론트엔드 타입 정의 및 API 클라이언트
- **파일**: `apps/web/src/lib/types/dashboard.ts`, `apps/web/src/lib/api/cameras.ts`
- **내용**:
  - `CameraWithBox` 인터페이스 정의 (T1-1 응답 스키마와 일치)
  - `fetchCameras(fetch: FetchLike): Promise<CameraWithBox[]>` 헬퍼 함수
  - 응답 검증 (Zod 또는 타입 가드)
- **복잡도**: XS
- **의존성**: T1-1 스키마 확정 후 진행

#### T2-2 — `/dashboard` 서버 로드 함수
- **파일**: `apps/web/src/routes/(app)/dashboard/+page.server.ts`
- **내용**:
  - `load()` 함수: `GET /api/cameras` 호출 (INTERNAL_API_URL 사용)
  - 반환: `{ cameras: CameraWithBox[] }`
  - 오류 처리: API 호출 실패 시 빈 배열 반환 + 콘솔 경고
- **복잡도**: XS
- **의존성**: T2-1

#### T2-3 — `CameraMap.svelte` — Leaflet 지도 컴포넌트
- **파일**: `apps/web/src/lib/components/dashboard/CameraMap.svelte`
- **내용**:
  - props: `cameras: CameraWithBox[]`
  - `onMount` 내에서 `import('leaflet')` dynamic import
  - 지도 초기화: OSM 타일 레이어 추가
  - 초기 뷰포트 로직:
    - 좌표 있는 카메라 ≥ 1개 → `fitBounds`
    - 0개 → 서울 기본 좌표 (37.5665, 126.9780, zoom 10)
  - 마커 렌더링: 상태별 색상 구분 (online=초록, offline=회색, error=빨간)
  - 팝업 내용: 채널 이름, Box 이름, 상태, "상세 보기" 링크
  - `onDestroy` 시 Leaflet 지도 인스턴스 제거 (메모리 누수 방지)
- **복잡도**: M (중규모)
- **의존성**: T2-1

#### T2-4 — `NoCoordSidebar.svelte` — 좌표 없는 카메라 사이드바
- **파일**: `apps/web/src/lib/components/dashboard/NoCoordSidebar.svelte`
- **내용**:
  - props: `cameras: CameraWithBox[]` (좌표 없는 카메라만 필터링하여 전달)
  - 목록 렌더링: 채널 이름, Box 이름, 상태 배지
  - 카메라 0개이면 렌더링 생략 (조건부 표시)
- **복잡도**: XS
- **의존성**: T2-1

#### T2-5 — `/dashboard/+page.svelte` — 지도 페이지 조립
- **파일**: `apps/web/src/routes/(app)/dashboard/+page.svelte`
- **내용**:
  - `CameraMap` 및 `NoCoordSidebar` 조합
  - 서버 데이터(`data.cameras`)를 geocoded/non-geocoded로 분리
  - "멀티뷰 보기" 버튼/링크 → `/dashboard/grid`
  - Leaflet CSS import (클라이언트 사이드만)
- **복잡도**: S
- **의존성**: T2-2, T2-3, T2-4

#### T2-6 — 루트 리다이렉트 수정
- **파일**: `apps/web/src/routes/(app)/+page.svelte`
- **내용**: 현재 placeholder를 `/dashboard`로 즉시 리다이렉트로 교체
- **복잡도**: XS
- **의존성**: REQ-DASH-001

#### T2-7 — 내비게이션 링크 추가
- **파일**: `apps/web/src/routes/(app)/+layout.svelte`
- **내용**: "대시보드"(`/dashboard`) 및 "멀티뷰"(`/dashboard/grid`) 링크 추가
- **복잡도**: XS
- **의존성**: T2-5 (라우트 존재 확인 후)

#### T2-8 — 지도 뷰 단위 테스트
- **파일**: `apps/web/src/__tests__/routes/dashboard/`
- **내용**:
  - `+page.server.ts` load 함수 테스트: API 성공/실패 케이스
  - geocoded/non-geocoded 분리 로직 테스트 (순수 함수로 추출 시)
  - `CameraMap.svelte` — Leaflet mock 사용 마커 렌더링 테스트
- **복잡도**: S
- **의존성**: T2-2 ~ T2-5

**M2 병렬화**: T2-1은 T1-1과 동시 진행 가능. T2-3, T2-4는 T2-1 완료 후 병렬 진행 가능.

---

### M3 — 바둑판 멀티뷰 (우선순위: 중간)

신규 요청 기능이다. M1, M2 완료 후 진행한다.

#### T3-1 — `GridLayoutSelector.svelte` — 레이아웃 선택 UI
- **파일**: `apps/web/src/lib/components/dashboard/GridLayoutSelector.svelte`
- **내용**:
  - props: `layout: 1 | 4 | 9` (셀 수), 변경 이벤트 emit
  - 1×1, 2×2, 3×3 선택 버튼/세그먼트 컨트롤
  - 레이아웃 변경 시 셀 초기화 이벤트 발생
- **복잡도**: XS
- **의존성**: 없음

#### T3-2 — `GridCell.svelte` — 바둑판 단일 셀 컴포넌트
- **파일**: `apps/web/src/lib/components/dashboard/GridCell.svelte`
- **내용**:
  - props: `cameras: CameraWithBox[]`, `assignedCamera: CameraWithBox | null`
  - 카메라 선택 드롭다운 — `online` 카메라 우선, `offline/error` 경고 아이콘 표시
  - 카메라 할당 시 → HLS 프록시 URL 구성 후 hls.js 재생 (ChannelPreview.svelte 패턴 준용)
  - 카메라 변경/제거 시 → 기존 hls.js 인스턴스 즉시 destroy 후 재초기화
  - 빈 상태 placeholder UI
  - HLS 오류 시 셀 내 오류 메시지 표시 (다른 셀 영향 없음)
  - `onDestroy` 시 hls.js 인스턴스 파괴
- **복잡도**: M
- **의존성**: T2-1

#### T3-3 — `/dashboard/grid/+page.server.ts` — 서버 로드
- **파일**: `apps/web/src/routes/(app)/dashboard/grid/+page.server.ts`
- **내용**:
  - `load()` 함수: `GET /api/cameras` 호출 (T2-2와 동일 패턴)
  - 반환: `{ cameras: CameraWithBox[] }`
- **복잡도**: XS
- **의존성**: T2-1

#### T3-4 — `/dashboard/grid/+page.svelte` — 멀티뷰 페이지 조립
- **파일**: `apps/web/src/routes/(app)/dashboard/grid/+page.svelte`
- **내용**:
  - `$state`로 레이아웃(`cellCount: 1 | 4 | 9`) 관리, 초기값 4 (2×2)
  - `$state`로 셀 할당 배열(`assignments: (CameraWithBox | null)[]`) 관리
  - `GridLayoutSelector` + `GridCell` 배열 조합
  - CSS Grid: `grid-cols-1`, `grid-cols-2`, `grid-cols-3` 동적 적용
  - 레이아웃 변경 시 assignments 초기화
  - `onDestroy` 훅 — 모든 GridCell hls.js 인스턴스 cleanup 보장
- **복잡도**: M
- **의존성**: T3-1, T3-2, T3-3

#### T3-5 — 바둑판 멀티뷰 단위 테스트
- **파일**: `apps/web/src/__tests__/routes/dashboard/grid/`
- **내용**:
  - `+page.server.ts` load 테스트
  - `GridCell.svelte` — 카메라 할당/해제 시 hls.js lifecycle 검증 (mock)
  - 레이아웃 변경 시 assignments 초기화 검증
- **복잡도**: S
- **의존성**: T3-2 ~ T3-4

**M3 병렬화**: T3-1과 T3-3은 서로 독립적으로 진행 가능. T3-2는 T2-1 완료 후 독립 진행 가능.

---

### M4 — 통합 검증 및 LSP 게이트 (우선순위: 높음)

모든 M1~M3 구현 완료 후 실행한다.

#### T4-1 — TypeScript strict 및 LSP 제로 에러 검증
- `bun run type-check` (또는 `tsc --noEmit`) 실행
- LSP 에러 0개, 타입 에러 0개 확인
- **복잡도**: XS

#### T4-2 — 커버리지 85% 달성 확인
- `bun run test:cov` 실행
- 신규 파일 대상 커버리지 85% 이상 확인
- 부족 시 누락 테스트 케이스 추가
- **복잡도**: S

#### T4-3 — Biome 린트 제로 에러
- `bun biome check` 실행, 0 errors 확인
- **복잡도**: XS

---

## 태스크 의존성 그래프

```
T1-1 ──→ T1-2
  │
  ├──→ T2-1 ──→ T2-2 ──→ T2-5 ──→ T2-7
  │      │──→ T2-3 ──→ T2-5
  │      │──→ T2-4 ──→ T2-5
  │      │──→ T2-8
  │      │
  │      └──→ T3-2 ──→ T3-4
  │            │──→ T3-5
  │
  ├──→ T3-1 ──→ T3-4
  └──→ T3-3 ──→ T3-4

T2-6 (독립, 루트 리다이렉트)

T4-1, T4-2, T4-3 (M1~M3 완료 후)
```

---

## 리스크 및 대응

| 리스크 | 영향 | 대응 방안 |
|--------|------|---------|
| Leaflet SSR 이슈 — `window is not defined` | 지도 렌더링 실패 | `onMount` 내 dynamic import, `browser` 가드 사용 |
| hls.js 멀티 인스턴스 메모리 누수 | 페이지 이탈 후 스트림 지속 | `ChannelPreview.svelte` cleanup 패턴 엄격히 준용 |
| Leaflet CSS 미로드 | 마커/팝업 스타일 깨짐 | 클라이언트 사이드 CSS import 또는 `app.css`에 leaflet CSS 추가 |
| JOIN 쿼리 성능 | 카메라 수 증가 시 응답 지연 | `box_id` 인덱스 활용, SELECT 필드 제한 (이미 구조 문서에 명시) |
| 3×3 동시 HLS 스트림 대역폭 | 서버 아웃바운드 대역폭 급증 | SPEC-BOX-CHANNELS-001 대역폭 모니터링 정책 준수, 사용자 안내 |

---

## 구현 참고 자산

| 자산 | 위치 | 참고 이유 |
|------|------|---------|
| hls.js dynamic import + cleanup 패턴 | `apps/web/src/lib/components/channel/ChannelPreview.svelte` | GridCell hls.js 생명주기 구현의 기준 |
| 서버 load 함수 패턴 | `apps/web/src/routes/(app)/boxes/+page.server.ts` | INTERNAL_API_URL 사용, FetchLike 의존성 주입 |
| 채널 API 클라이언트 패턴 | `apps/web/src/lib/api/channels.ts` | cameras.ts API 클라이언트 작성 참고 |
| 상태 배지 헬퍼 | `apps/web/src/lib/components/channel/channelBadge.helpers.ts` | 카메라 상태 배지 재사용 또는 참고 |
| HLS 프록시 URL 구성 | `apps/web/src/routes/(app)/boxes/[id]/api/...` | GridCell HLS URL 구성 패턴 |
| Box 서비스 쿼리 패턴 | `apps/api/src/routes/boxes.ts` | cameras.ts 집계 쿼리 JOIN 패턴 참고 |

---

## 결정 사항 (2026-05-15 사용자 확정)

| 번호 | 결정 사항 | 확정 |
|------|---------|------|
| D1 | 바둑판 멀티뷰 기본 레이아웃 | **2×2** |
| D2 | 루트 `/` 처리 방식 | **`/dashboard` 로 리다이렉트** (기존 보호 라우트 가드 통과 후 즉시 리다이렉트) |
| D3 | 지도 초기 기본 중심점 | **환경 변수 `PUBLIC_MAP_DEFAULT_LAT` / `PUBLIC_MAP_DEFAULT_LNG`**, 기본값 서울 시청 (37.5665, 126.9780). 좌표 보유 카메라가 1개 이상일 경우 fit-bounds 우선 적용 후 ENV 값은 fallback. |
| D4 | 좌표 없는 카메라 사이드바 위치 | **지도 우측 오버레이 패널** (lg 이상 가로 화면). md 이하에서는 지도 하단 collapsible 섹션 (REQ-DASH-014 반응형 일관). |
