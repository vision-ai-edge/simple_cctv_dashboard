<!-- TAG: DASHBOARD-001 -->
---
id: SPEC-DASHBOARD-001
title: 지도 기반 카메라 배치 + 바둑판 멀티뷰 대시보드
status: planned
version: 0.1.0
created: 2026-05-15
updated: 2026-05-15
owner: imgughyeon
branch: feature/SPEC-DASHBOARD-001
related_specs:
  - SPEC-BOX-CHANNELS-001  # HLS 프록시, 채널 목록 API
  - SPEC-BOX-001            # Box 자격증명 볼트, boxService
  - SPEC-BOX-UI-001         # 디자인 시스템, 기존 라우트 구조
  - SPEC-AUTH-001           # 보호 라우트 가드
---

# SPEC-DASHBOARD-001: 지도 기반 카메라 배치 + 바둑판 멀티뷰 대시보드

## 변경 이력

| 날짜 | 버전 | 내용 | 작성자 |
|---|---|---|---|
| 2026-05-15 | 0.1.0 | 초안 작성 — 지도 뷰(MVP #1) + 바둑판 멀티뷰(신규 요청) | imgughyeon |

---

## 환경 (Environment)

- **런타임**: Bun 1.2+, SQLite (bun:sqlite + Drizzle ORM)
- **백엔드**: Hono 4.x (`apps/api/`) — 신규 집계 엔드포인트 `GET /api/cameras` 추가
- **프론트엔드**: SvelteKit 2.8+ + Svelte 5 runes API (`$state`, `$derived`, `$props`)
- **스타일**: TailwindCSS 4.0 (shadcn-svelte 미사용, SPEC-BOX-UI-001 디자인 시스템 준수)
- **언어**: TypeScript 5.9+ strict, `any` 금지
- **지도 라이브러리**: Leaflet 1.9+ (`leaflet` + `@types/leaflet`)
- **지도 타일**: OpenStreetMap (OSM) — 무료, 외부 API 키 불필요
- **영상 재생**: hls.js 1.6+ — SPEC-BOX-CHANNELS-001에서 이미 추가된 의존성, dynamic import 패턴 재사용
- **기존 재사용 자산**:
  - `GET /api/boxes/:id/channels` 엔드포인트 (채널 목록, DB 기반)
  - `GET /api/boxes/:id/channels/:channelId/hls/playlist.m3u8` 엔드포인트 (HLS 프록시)
  - `ChannelPreview.svelte` — hls.js dynamic import + cleanup 패턴
  - `cameras` 테이블 — `latitude REAL`, `longitude REAL`, `name`, `status`, `channel_id`, `box_id` 컬럼
  - `boxes` 테이블 — `name`, `status` 컬럼
  - `/(app)/+layout.server.ts` 보호 라우트 가드

---

## 가정 (Assumptions)

| 번호 | 가정 | 신뢰도 | 검증 방법 |
|------|------|--------|---------|
| A1 | SPEC-BOX-CHANNELS-001이 완료되어 `GET /api/boxes/:id/channels` 및 HLS 프록시 엔드포인트가 정상 동작한다 | 높음 | 기구현 — SPEC-BOX-CHANNELS-001 구현 완료 상태 확인 |
| A2 | `cameras` 테이블의 `latitude`/`longitude` 컬럼이 nullable REAL로 존재한다 | 높음 | `packages/db` 스키마 및 structure.md 확인 |
| A3 | 좌표가 없는 카메라(`latitude IS NULL` 또는 `longitude IS NULL`)는 지도 마커 대신 사이드바 목록에 표시한다 | 높음 | 범위 결정 (이 SPEC) |
| A4 | 좌표 편집(드래그, 수동 입력) 기능은 이 SPEC 범위에 포함하지 않는다 | 높음 | 사용자 확인 |
| A5 | Leaflet은 SSR(서버사이드 렌더링) 환경에서 동작하지 않으므로 SvelteKit의 `onMount` 또는 `browser` 가드 내에서 dynamic import로 로드한다 | 높음 | Leaflet 공식 문서 및 SvelteKit 관례 |
| A6 | 집계 API(`GET /api/cameras`)는 모든 Box의 카메라를 Box 메타데이터와 함께 단일 응답으로 반환한다 — N+1 팬아웃을 방지하기 위해 신규 엔드포인트로 구현한다 | 높음 | 설계 결정 (트레이드오프 아래 문서화) |
| A7 | 바둑판 멀티뷰의 셀 구성(어떤 카메라를 어느 셀에 배치할지)은 페이지 로컬 상태로 관리하며 DB에 영속하지 않는다 (세션 기간만 유지) | 높음 | 범위 결정 (이 SPEC) |
| A8 | HLS 스트림 동시 재생 수 증가에 따른 서버 대역폭 소비는 SPEC-BOX-CHANNELS-001의 비기능 요구사항(대역폭 모니터링)과 동일하게 적용된다 | 높음 | 기존 정책 준용 |
| A9 | 바둑판 멀티뷰 레이아웃(1×1, 2×2, 3×3)은 사용자가 직접 선택하며, 초기 진입 시 기본값은 2×2로 설정한다 | 중간 | 범위 결정 — 사용자 승인 필요 |
| A10 | 루트 `/` 접근 시 `/dashboard`로 리다이렉트한다 — 현재 `/(app)/+page.svelte`는 "대시보드 후속 SPEC" placeholder이므로 리다이렉트로 대체한다 | 높음 | structure.md 확인 |

---

## 트레이드오프: 집계 API vs N+1 팬아웃

### 선택지 A — 신규 `GET /api/cameras` 집계 엔드포인트 (권장, 이 SPEC 선택)

장점:
- 단일 HTTP 요청으로 모든 카메라와 Box 메타데이터를 반환
- 프론트엔드 로직 단순화 (단일 fetch)
- 향후 페이지네이션·필터링 추가 용이

단점:
- 신규 백엔드 엔드포인트 구현 필요
- Box 수가 적을 때는 N+1과 성능 차이 미미

### 선택지 B — 기존 `/api/boxes/:id/channels` 반복 호출 (N+1 팬아웃)

장점:
- 기존 API 재사용, 백엔드 변경 없음

단점:
- Box 수만큼 순차 또는 병렬 요청 필요
- 병렬 요청 시 서버 부하 급증 위험
- 프론트엔드에서 결과 병합 로직 필요

**결론**: 선택지 A — `GET /api/cameras` 신규 집계 엔드포인트를 추가한다.

---

## 도메인 정의

### 집계 카메라 응답 스키마

```
GET /api/cameras 응답 항목:
{
  id: string,           // cameras.id (PK)
  channelId: string,    // cameras.channel_id
  name: string,         // cameras.name
  status: "online" | "offline" | "error",
  latitude: number | null,
  longitude: number | null,
  boxId: string,        // cameras.box_id
  boxName: string,      // boxes.name (JOIN)
  boxStatus: "active" | "inactive" | "error",
  lastSyncedAt: number | null  // Unix ms
}
```

### 지도 마커 분류

| 상태 | 마커 색상 | 설명 |
|------|---------|------|
| `online` | 초록색 | 정상 스트리밍 중 |
| `offline` | 회색 | 비활성 또는 연결 중 |
| `error` | 빨간색 | 오류 상태 |
| 좌표 없음 | 마커 없음 | 사이드바 목록에만 표시 |

### 바둑판 멀티뷰 레이아웃 정의

| 레이아웃 | 셀 수 | 그리드 |
|--------|-----|------|
| 1×1 | 1 | 단일 대형 셀 |
| 2×2 | 4 | 2열 2행 균등 셀 |
| 3×3 | 9 | 3열 3행 균등 셀 |

---

## 요구사항 (Requirements)

### REQ-DASH-001: 라우트 구조 — `/dashboard` 신규 페이지

**[Ubiquitous]** 시스템은 `/(app)/dashboard/+page.svelte` 및 `/(app)/dashboard/+page.server.ts` 파일을 제공해야 한다. 해당 라우트는 기존 `/(app)/+layout.server.ts` 보호 라우트 가드 하에 있어 인증 없이 접근 불가해야 한다.

**[Event-Driven]** 사용자가 루트 경로(`/`)에 접근하면 시스템은 `/dashboard`로 리다이렉트해야 한다.

### REQ-DASH-002: 집계 API — `GET /api/cameras`

**[Ubiquitous]** 시스템은 `GET /api/cameras` 엔드포인트를 제공해야 한다. 해당 엔드포인트는 `cameras` 테이블과 `boxes` 테이블을 JOIN하여 모든 카메라 목록을 단일 응답으로 반환해야 한다.

**[Ubiquitous]** 응답 항목은 `id`, `channelId`, `name`, `status`, `latitude`, `longitude`, `boxId`, `boxName`, `boxStatus`, `lastSyncedAt` 필드를 포함해야 한다.

**[Unwanted]** 해당 엔드포인트는 `requireAuth` 미들웨어가 없으면 응답하지 않아야 한다 (인증 필수).

**[Ubiquitous]** 해당 엔드포인트는 기존 Hono 라우트 파일 `apps/api/src/routes/cameras.ts`에 구현해야 한다.

### REQ-DASH-003: 지도 뷰 — Leaflet 지도 렌더링

**[Ubiquitous]** 대시보드 페이지에서 시스템은 Leaflet + OpenStreetMap 타일을 사용하는 인터랙티브 지도를 렌더링해야 한다.

**[Ubiquitous]** Leaflet은 `onMount` 또는 `browser` 가드 내에서 dynamic import로 로드해야 한다 (SSR 호환).

**[State-Driven]** 좌표가 있는 카메라(`latitude != null AND longitude != null`)가 1개 이상 존재하는 경우, 시스템은 해당 카메라들의 경계 박스(fit-bounds)에 맞게 초기 뷰포트를 설정해야 한다.

**[State-Driven]** 좌표가 있는 카메라가 0개인 경우, 시스템은 기본 중심점(위도 37.5665, 경도 126.9780, 줌 레벨 10 — 서울 기본값)으로 초기 뷰포트를 설정해야 한다.

**[Ubiquitous]** 시스템은 Pan(이동) 및 Zoom(확대/축소) 인터랙션을 지원해야 한다.

### REQ-DASH-004: 지도 뷰 — 카메라 마커 표시

**[Ubiquitous]** 대시보드 페이지에서, 시스템은 좌표(`latitude`, `longitude`)가 있는 각 카메라에 대해 Leaflet 마커를 지도 위에 표시해야 한다.

**[Ubiquitous]** 마커의 시각적 스타일(색상 또는 아이콘)은 카메라 상태(`online`/`offline`/`error`)에 따라 구분되어야 한다.

**[Ubiquitous]** 좌표가 없는 카메라(`latitude IS NULL` 또는 `longitude IS NULL`)는 지도 마커를 표시하지 않고 사이드바 목록에 별도 표시해야 한다.

### REQ-DASH-005: 지도 뷰 — 마커 클릭 팝업

**[Event-Driven]** 사용자가 지도 마커를 클릭하면 시스템은 팝업을 표시해야 한다. 팝업은 다음 정보를 포함해야 한다:
- 채널 이름 (`cameras.name`)
- Box 이름 (`boxes.name`)
- 현재 상태 (`status`)
- "상세 보기" 링크 — 기존 `/boxes/[boxId]` 페이지로 이동하거나 해당 채널 행을 앵커로 스크롤

**[Unwanted]** 팝업은 별도의 네트워크 요청 없이 이미 로드된 데이터만 사용해야 한다 (페이지 로드 시 fetch한 카메라 목록 재사용).

### REQ-DASH-006: 지도 뷰 — 좌표 없는 카메라 사이드바

**[State-Driven]** 좌표가 없는 카메라가 1개 이상 존재하는 경우, 시스템은 지도 옆 또는 하단에 사이드바 목록을 표시해야 한다. 목록 항목은 채널 이름, Box 이름, 상태 배지를 표시해야 한다.

**[State-Driven]** 좌표가 없는 카메라가 0개인 경우, 시스템은 사이드바를 표시하지 않아야 한다.

### REQ-DASH-007: 바둑판 멀티뷰 — 라우트 및 레이아웃 선택

**[Ubiquitous]** 시스템은 `/(app)/dashboard/grid/+page.svelte` 및 `/(app)/dashboard/grid/+page.server.ts` 파일을 제공해야 한다. 해당 라우트는 인증 보호 하에 있어야 한다.

**[Ubiquitous]** 멀티뷰 페이지는 레이아웃 선택 UI를 제공해야 한다 — 1×1, 2×2, 3×3 중 하나를 선택 가능. 초기 진입 시 기본값은 2×2이다.

**[Event-Driven]** 사용자가 레이아웃을 변경하면 시스템은 현재 셀 할당을 초기화(모든 셀 비할당 상태)하고 새 레이아웃으로 그리드를 재구성해야 한다.

### REQ-DASH-008: 바둑판 멀티뷰 — 셀 카메라 할당

**[Ubiquitous]** 각 셀은 "카메라 선택" 드롭다운 또는 선택 UI를 제공해야 한다. 선택 가능한 카메라 목록은 `GET /api/cameras` 응답 기반으로 구성한다.

**[Event-Driven]** 사용자가 셀에 카메라를 할당하면 시스템은 해당 셀에 HLS 라이브 스트림을 즉시 재생해야 한다. 스트림 URL은 기존 HLS 프록시 엔드포인트(`/api/boxes/:boxId/channels/:channelId/hls/playlist.m3u8`)를 사용해야 한다.

**[Event-Driven]** 사용자가 셀에서 카메라를 제거하거나 다른 카메라로 교체하면 시스템은 기존 hls.js 인스턴스를 즉시 파괴(destroy)하고 새 스트림을 초기화해야 한다.

**[State-Driven]** 할당되지 않은 셀은 빈 자리표시자(placeholder) 상태로 표시되어야 한다.

### REQ-DASH-009: 바둑판 멀티뷰 — hls.js 인스턴스 생명주기 관리

**[Ubiquitous]** 시스템은 `ChannelPreview.svelte`의 hls.js dynamic import 및 cleanup 패턴을 바둑판 멀티뷰 셀에 동일하게 적용해야 한다.

**[Event-Driven]** 사용자가 멀티뷰 페이지에서 벗어나면(페이지 이탈) 시스템은 모든 활성 hls.js 인스턴스를 파괴해야 한다 (`onDestroy` 또는 SvelteKit cleanup 훅 사용).

**[Unwanted]** 페이지 이탈 후 hls.js 인스턴스가 메모리에 잔류하거나 네트워크 요청을 지속하지 않아야 한다.

### REQ-DASH-010: 바둑판 멀티뷰 — 스트림 오류 처리

**[Unwanted]** HLS 스트림 로드에 실패하면 시스템은 해당 셀에 오류 메시지를 표시해야 한다 — 전체 페이지를 중단시키지 않아야 한다.

**[State-Driven]** 카메라 상태가 `offline` 또는 `error`인 경우, 시스템은 해당 카메라를 셀 선택 목록에서 비활성화(disabled) 상태로 표시하거나 경고 아이콘과 함께 표시해야 한다.

### REQ-DASH-011: 대시보드 — 내비게이션 링크

**[Ubiquitous]** 기존 `/(app)/+layout.svelte` 앱 레이아웃에 "대시보드" 및 "멀티뷰" 내비게이션 링크를 추가해야 한다. 각각 `/dashboard`와 `/dashboard/grid`로 이동해야 한다.

### REQ-DASH-012: 성능 — 지도 마커 렌더링

**[Ubiquitous]** 50개 카메라 마커 기준으로 지도 렌더링이 1초 이내에 완료되어야 한다 (product.md 성공 지표 준수).

**[Ubiquitous]** 대시보드 페이지 로드 시 `GET /api/cameras` 호출은 단일 요청으로 처리해야 한다 (N+1 금지).

### REQ-DASH-013: 보안 — 자격증명 비노출

**[Unwanted]** `GET /api/cameras` 응답에 EdgeAI Box 자격증명(JWT, API Key, 비밀번호)이 포함되어서는 안 된다. Box 메타데이터(이름, 상태)만 포함한다.

**[Unwanted]** 바둑판 멀티뷰의 HLS 스트림은 기존 HLS 프록시 엔드포인트를 통해서만 재생되어야 한다. 클라이언트가 EdgeAI Box 자격증명을 직접 사용하지 않아야 한다.

### REQ-DASH-014: 반응형 레이아웃

**[Ubiquitous]** 대시보드 지도 뷰와 바둑판 멀티뷰는 데스크탑 및 태블릿 해상도에서 정상 동작해야 한다. 모바일 전용 레이아웃 최적화는 이 SPEC 범위에서 제외한다.

---

## 범위 외 (Out of Scope)

- 카메라 좌표(latitude/longitude) 편집 — 드래그 앤 드롭 또는 수동 입력 (향후 SPEC)
- 바둑판 셀 구성 영속화 — 세션 종료 후 레이아웃 저장 (향후 SPEC)
- 녹화, 타임랩스, AI 알림 (각각 별도 SPEC)
- 모바일 전용 레이아웃 (반응형은 지원, 전용 모바일 모드 제외)
- WebRTC 스트리밍 (HLS 프록시만 사용, WebRTC는 향후 SPEC)

---

## 보안 고려사항

| 항목 | 요구사항 | 구현 방법 |
|---|---|---|
| 인증 | 모든 신규 엔드포인트 `requireAuth` 미들웨어 적용 | Hono 라우트 미들웨어 체인 |
| 자격증명 비노출 | `GET /api/cameras` 응답에 Box JWT/API Key 미포함 | 응답 직렬화 시 제외 필드 명시 |
| HLS 스트림 | 클라이언트는 자체 도메인 HLS 프록시 URL만 사용 | SPEC-BOX-CHANNELS-001 기존 패턴 준수 |
| 입력 검증 | 쿼리 파라미터 Zod 스키마 검증 | Hono `zValidator` 미들웨어 |

---

## 비기능 요구사항 요약

| 항목 | 요구사항 |
|---|---|
| 지도 마커 렌더링 시간 | 50개 기준 1초 이내 (product.md 성공 지표) |
| 카메라 API 응답시간 | P95 < 200ms (structure.md 비기능 요구사항) |
| hls.js 메모리 누수 | 페이지 이탈 시 모든 인스턴스 파괴 |
| 동시 HLS 스트림 | 멀티뷰 최대 9개 동시 재생 (3×3 레이아웃) — 대역폭 모니터링 필요 |
| TypeScript strict | `any` 금지, 모든 신규 코드 strict 준수 |
| 테스트 커버리지 | 신규 코드 85% 이상 (quality.yaml 준수) |
