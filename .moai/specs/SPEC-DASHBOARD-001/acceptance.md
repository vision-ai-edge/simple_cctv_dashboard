<!-- TAG: DASHBOARD-001 -->
---
id: SPEC-DASHBOARD-001
document: acceptance
version: 0.1.0
created: 2026-05-15
---

# SPEC-DASHBOARD-001: 인수 기준 (Acceptance Criteria)

## 품질 게이트 (Quality Gates)

모든 구현이 완료된 후 아래 게이트를 통과해야 한다.

| 게이트 | 기준 | 측정 방법 |
|-------|------|---------|
| 커버리지 | 신규 파일 85% 이상 | `bun run test:cov` |
| LSP 에러 | 0개 | `tsc --noEmit` |
| Biome 린트 | 0 errors | `bun biome check` |
| 회귀 테스트 | 전체 기존 테스트 통과 | `bun test` |

---

## AC-DASH-001: 라우트 구조 검증 (REQ-DASH-001 매핑)

### AC-DASH-001-A — `/dashboard` 보호 라우트 접근 제어
```
Given: 미인증 사용자가
When:  `/dashboard`에 접근하면
Then:  `/login`으로 리다이렉트되어야 한다
```

### AC-DASH-001-B — `/dashboard` 인증 후 정상 렌더링
```
Given: 인증된 사용자가
When:  `/dashboard`에 접근하면
Then:  200 응답과 지도 컴포넌트가 포함된 페이지가 렌더링되어야 한다
```

### AC-DASH-001-C — 루트 리다이렉트
```
Given: 인증된 사용자가
When:  `/` (루트)에 접근하면
Then:  `/dashboard`로 리다이렉트되어야 한다
```

---

## AC-DASH-002: 집계 API 검증 (REQ-DASH-002 매핑)

### AC-DASH-002-A — 인증 없는 요청 거부
```
Given: 인증 토큰 없이
When:  `GET /api/cameras`를 호출하면
Then:  HTTP 401 응답을 반환해야 한다
```

### AC-DASH-002-B — 정상 응답 스키마
```
Given: 인증된 사용자가
  And: DB에 카메라 2개(boxA 소속 1개, boxB 소속 1개)가 존재하고
When:  `GET /api/cameras`를 호출하면
Then:  200 응답과 함께 배열이 반환되어야 한다
  And: 각 항목에 id, channelId, name, status, latitude, longitude,
       boxId, boxName, boxStatus, lastSyncedAt 필드가 존재해야 한다
  And: password_enc, jwt_cached_enc, api_key_cached_enc 필드가
       응답에 포함되지 않아야 한다
```

### AC-DASH-002-C — 카메라 없는 경우 빈 배열
```
Given: 인증된 사용자가
  And: DB에 카메라가 없는 경우
When:  `GET /api/cameras`를 호출하면
Then:  200 응답과 함께 빈 배열 `{ "cameras": [] }`가 반환되어야 한다
```

### AC-DASH-002-D — JOIN 데이터 포함
```
Given: 인증된 사용자가
  And: boxName이 "북문 박스"인 Box에 카메라가 1개 존재하고
When:  `GET /api/cameras`를 호출하면
Then:  응답 항목의 boxName이 "북문 박스"여야 한다
```

---

## AC-DASH-003: 지도 렌더링 검증 (REQ-DASH-003 매핑)

### AC-DASH-003-A — 좌표 있는 카메라 fit-bounds
```
Given: 인증된 사용자가
  And: 좌표(latitude, longitude)가 있는 카메라 3개가 DB에 존재하고
When:  `/dashboard`를 방문하면
Then:  지도 초기 뷰포트가 세 카메라를 모두 포함하는 경계 박스 범위로
       설정되어야 한다
```

### AC-DASH-003-B — 카메라 없을 때 기본 뷰포트
```
Given: 인증된 사용자가
  And: 좌표 있는 카메라가 0개인 경우
When:  `/dashboard`를 방문하면
Then:  지도 초기 중심이 위도 37.5665, 경도 126.9780 (서울)으로 설정되어야 한다
  And: 줌 레벨이 10으로 설정되어야 한다
```

### AC-DASH-003-C — OSM 타일 레이어 적용
```
Given: 인증된 사용자가
When:  `/dashboard`를 방문하면
Then:  지도 타일 레이어가 OpenStreetMap 타일로 로드되어야 한다
  And: Pan 및 Zoom 인터랙션이 동작해야 한다
```

---

## AC-DASH-004: 카메라 마커 검증 (REQ-DASH-004 매핑)

### AC-DASH-004-A — 좌표 있는 카메라 마커 표시
```
Given: 인증된 사용자가
  And: 좌표가 있는 카메라 2개, 좌표가 없는 카메라 1개가 DB에 존재하고
When:  `/dashboard`를 방문하면
Then:  지도에 마커 2개만 표시되어야 한다
  And: 좌표 없는 카메라는 마커가 없어야 한다
```

### AC-DASH-004-B — 상태별 마커 스타일 구분
```
Given: status가 각각 "online", "offline", "error"인 카메라 3개가
       모두 좌표를 보유하고 있고
When:  `/dashboard` 지도를 렌더링하면
Then:  각 마커의 시각적 색상 또는 아이콘이 상태에 따라 구분되어야 한다
       (online=초록, offline=회색, error=빨간 또는 이에 준하는 색상 체계)
```

---

## AC-DASH-005: 마커 팝업 검증 (REQ-DASH-005 매핑)

### AC-DASH-005-A — 팝업 내용 표시
```
Given: 인증된 사용자가
  And: 지도에 마커가 표시된 카메라가 있고
When:  해당 마커를 클릭하면
Then:  팝업이 표시되어야 한다
  And: 팝업에 채널 이름, Box 이름, 현재 상태가 포함되어야 한다
  And: "상세 보기" 링크가 `/boxes/[boxId]`를 가리켜야 한다
```

### AC-DASH-005-B — 팝업 시 추가 네트워크 요청 없음
```
Given: 인증된 사용자가
  And: `/dashboard` 페이지가 이미 카메라 목록을 로드한 상태에서
When:  마커를 클릭하면
Then:  추가 API 요청이 발생하지 않아야 한다
       (팝업 내용은 이미 로드된 데이터 사용)
```

---

## AC-DASH-006: 사이드바 검증 (REQ-DASH-006 매핑)

### AC-DASH-006-A — 좌표 없는 카메라 사이드바 표시
```
Given: 인증된 사용자가
  And: 좌표 없는 카메라 2개가 DB에 존재하고
When:  `/dashboard`를 방문하면
Then:  사이드바 섹션이 표시되어야 한다
  And: 사이드바에 해당 카메라 2개의 이름, Box 이름, 상태 배지가 표시되어야 한다
```

### AC-DASH-006-B — 좌표 없는 카메라가 없을 때 사이드바 미표시
```
Given: 인증된 사용자가
  And: 모든 카메라가 좌표를 보유하고 있으면
When:  `/dashboard`를 방문하면
Then:  사이드바 섹션이 렌더링되지 않아야 한다
```

---

## AC-DASH-007: 바둑판 멀티뷰 기본 동작 검증 (REQ-DASH-007 매핑)

### AC-DASH-007-A — `/dashboard/grid` 보호 라우트 접근 제어
```
Given: 미인증 사용자가
When:  `/dashboard/grid`에 접근하면
Then:  `/login`으로 리다이렉트되어야 한다
```

### AC-DASH-007-B — 기본 레이아웃 2×2
```
Given: 인증된 사용자가
When:  `/dashboard/grid`에 첫 진입하면
Then:  2×2 레이아웃(4개 셀)이 기본으로 표시되어야 한다
```

### AC-DASH-007-C — 레이아웃 변경 시 셀 초기화
```
Given: 인증된 사용자가
  And: 2×2 레이아웃에서 셀 1개에 카메라를 할당한 상태에서
When:  3×3 레이아웃으로 변경하면
Then:  9개 셀이 모두 빈 자리표시자 상태로 표시되어야 한다
  And: 이전에 할당된 카메라가 셀에 남아 있지 않아야 한다
```

---

## AC-DASH-008: 셀 카메라 할당 및 스트리밍 검증 (REQ-DASH-008 매핑)

### AC-DASH-008-A — 카메라 할당 시 HLS 스트림 재생 시작
```
Given: 인증된 사용자가
  And: `/dashboard/grid` 페이지에서 빈 셀이 있고
  And: online 상태의 카메라가 존재하면
When:  해당 셀에서 카메라를 선택하면
Then:  해당 셀에서 HLS 라이브 스트림 재생이 시작되어야 한다
  And: 사용된 HLS URL이 `/api/boxes/:boxId/channels/:channelId/hls/playlist.m3u8`
       형식이어야 한다
```

### AC-DASH-008-B — 빈 셀 자리표시자 표시
```
Given: 인증된 사용자가
When:  `/dashboard/grid`에 진입하면
Then:  할당되지 않은 셀은 빈 자리표시자 UI(예: 회색 배경, 카메라 선택 안내)로
       표시되어야 한다
```

### AC-DASH-008-C — 카메라 교체 시 이전 hls.js 인스턴스 파괴
```
Given: 인증된 사용자가
  And: 셀 A에 카메라 X가 할당되어 스트리밍 중인 상태에서
When:  셀 A에 다른 카메라 Y를 선택하면
Then:  카메라 X의 hls.js 인스턴스가 destroy() 호출되어야 한다
  And: 카메라 Y의 새 hls.js 인스턴스가 생성되어야 한다
```

---

## AC-DASH-009: hls.js 생명주기 검증 (REQ-DASH-009 매핑)

### AC-DASH-009-A — 페이지 이탈 시 모든 hls.js 인스턴스 파괴
```
Given: 인증된 사용자가
  And: `/dashboard/grid`에서 2개 셀에 카메라가 할당되어 스트리밍 중인 상태에서
When:  다른 페이지로 이동하면 (예: `/dashboard`)
Then:  2개의 hls.js 인스턴스가 모두 destroy() 호출되어야 한다
  And: 이탈 후 네트워크 요청이 지속되지 않아야 한다
```

### AC-DASH-009-B — hls.js dynamic import 사용
```
Given: GridCell 컴포넌트가
When:  카메라를 할당받아 스트림을 초기화할 때
Then:  `import('hls.js')` dynamic import를 사용해야 한다
       (초기 번들에 포함되지 않아야 한다)
```

---

## AC-DASH-010: 스트림 오류 처리 검증 (REQ-DASH-010 매핑)

### AC-DASH-010-A — HLS 오류 시 셀 내 메시지 표시
```
Given: 인증된 사용자가
  And: 셀에 카메라가 할당된 상태에서
When:  HLS 스트림 로드가 실패하면 (네트워크 오류 또는 Box 다운)
Then:  해당 셀에 오류 메시지가 표시되어야 한다
  And: 다른 셀의 스트림이 영향을 받지 않아야 한다
```

### AC-DASH-010-B — offline/error 카메라 선택 시 경고
```
Given: 인증된 사용자가
  And: status가 "offline"인 카메라가 셀 선택 목록에 있고
When:  해당 카메라를 확인하면
Then:  경고 아이콘 또는 비활성화 상태 표시가 있어야 한다
```

---

## AC-DASH-011: 내비게이션 링크 검증 (REQ-DASH-011 매핑)

### AC-DASH-011-A — 앱 레이아웃 내비게이션 링크 존재
```
Given: 인증된 사용자가 앱 레이아웃이 포함된 페이지에 있을 때
When:  내비게이션 영역을 확인하면
Then:  "대시보드" 링크(`/dashboard`)가 표시되어야 한다
  And: "멀티뷰" 링크(`/dashboard/grid`)가 표시되어야 한다
```

---

## AC-DASH-012: 성능 검증 (REQ-DASH-012 매핑)

### AC-DASH-012-A — 50개 카메라 1초 이내 렌더링
```
Given: 인증된 사용자가
  And: 좌표 있는 카메라 50개가 DB에 존재하고
When:  `/dashboard`를 방문하면
Then:  지도 마커 렌더링이 1초 이내에 완료되어야 한다
       (product.md 성공 지표 기준)
```

### AC-DASH-012-B — 단일 API 요청으로 카메라 목록 로드
```
Given: 인증된 사용자가
When:  `/dashboard` 또는 `/dashboard/grid`를 방문하면
Then:  카메라 목록 로드가 `GET /api/cameras` 단일 요청으로 처리되어야 한다
       (Box 수만큼 반복 요청하지 않아야 한다)
```

---

## AC-DASH-013: 보안 검증 (REQ-DASH-013 매핑)

### AC-DASH-013-A — 집계 API 자격증명 비노출
```
Given: 인증된 사용자가
When:  `GET /api/cameras` 응답을 검사하면
Then:  응답 JSON에 password_enc, jwt_cached_enc, api_key_cached_enc,
       password, jwt_cached, api_key_cached 필드가 없어야 한다
```

### AC-DASH-013-B — HLS 스트림 자격증명 비노출
```
Given: 인증된 사용자가
  And: `/dashboard/grid`에서 카메라를 할당하고 스트리밍 중일 때
When:  브라우저 네트워크 요청을 검사하면
Then:  클라이언트 요청 URL에 EdgeAI Box apikey 또는 JWT 토큰이
       포함되지 않아야 한다
  And: 모든 HLS 요청이 자체 도메인의 프록시 엔드포인트로만 전송되어야 한다
```

---

## AC-DASH-014: 반응형 레이아웃 검증 (REQ-DASH-014 매핑)

### AC-DASH-014-A — 데스크탑 해상도 정상 동작
```
Given: 인증된 사용자가 1280px 이상 너비의 브라우저를 사용하여
When:  `/dashboard` 및 `/dashboard/grid`를 방문하면
Then:  지도와 그리드가 정상적으로 렌더링되어야 한다
  And: 레이아웃이 깨지거나 오버플로우가 발생하지 않아야 한다
```

---

## 테스트 전략

### 단위 테스트 (vitest)

| 대상 | 테스트 파일 위치 | 검증 항목 |
|------|--------------|---------|
| `GET /api/cameras` 엔드포인트 | `apps/api/src/__tests__/routes/cameras.test.ts` | 401 거부, 200 + 스키마 검증, 빈 배열, JOIN 결과 |
| `+page.server.ts` (dashboard) | `apps/web/src/__tests__/routes/dashboard/page-server.test.ts` | load() 성공/실패, 반환 타입 |
| `+page.server.ts` (grid) | `apps/web/src/__tests__/routes/dashboard/grid/page-server.test.ts` | load() 성공/실패 |
| geocoded/non-geocoded 분리 로직 | `apps/web/src/__tests__/lib/dashboard/camera-utils.test.ts` | 좌표 필터링 순수 함수 |
| `GridCell.svelte` hls.js lifecycle | `apps/web/src/__tests__/lib/components/dashboard/grid-cell.test.ts` | 할당 시 init, 변경 시 destroy+re-init, 페이지 이탈 시 destroy |

### 통합 테스트 (vitest)

| 대상 | 검증 항목 |
|------|---------|
| `/api/cameras` ↔ `cameras` JOIN `boxes` | 실제 SQLite 인메모리 DB 사용, JOIN 결과 정합성 |

### 수동 검증 시나리오 (브라우저)

| 시나리오 | 확인 방법 |
|---------|---------|
| 지도 마커 색상 구분 | 브라우저에서 online/offline/error 카메라 마커 시각 확인 |
| 팝업 내용 및 "상세 보기" 링크 | 마커 클릭 후 팝업 내용 확인 및 링크 동작 확인 |
| 사이드바 좌표 없는 카메라 표시 | 좌표 없는 카메라 DB 삽입 후 사이드바 렌더링 확인 |
| 3×3 동시 재생 | 9개 셀 모두 카메라 할당 후 동시 재생 확인 |
| 페이지 이탈 시 스트림 중단 | Network 탭에서 HLS 세그먼트 요청 중단 확인 |
| HLS 오류 메시지 | 비활성 채널 할당 후 오류 메시지 표시 확인 |

---

## Definition of Done

- [ ] M1 ~ M3 모든 태스크 구현 완료
- [ ] AC-DASH-001 ~ AC-DASH-014 모든 기준 충족
- [ ] `bun test` — 기존 361개 + 신규 테스트 전량 통과
- [ ] 신규 파일 테스트 커버리지 85% 이상
- [ ] `tsc --noEmit` — 0 errors
- [ ] `bun biome check` — 0 errors
- [ ] 수동 검증 시나리오 전량 통과
- [ ] Conventional Commits 준수 커밋 이력 존재
- [ ] SPEC-BOX-CHANNELS-001, SPEC-BOX-UI-001, SPEC-AUTH-001 회귀 테스트 전량 통과
