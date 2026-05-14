<!-- TAG: BOX-CHANNELS-001 -->

# SPEC-BOX-CHANNELS-001 구현 계획

## 의존성

| 의존 대상 | 상태 | 비고 |
|---|---|---|
| SPEC-BOX-001 자격증명 볼트 | Implemented | `decryptBoxCredentials`, `boxService` 사용 |
| SPEC-BOX-UI-001 Box 상세 페이지 | Implemented | `/boxes/[id]` 라우트 및 컴포넌트 구조 준수 |
| `packages/shared` edgeai-box-client | Implemented | `boxClient.channels.*` API 활용 |
| `packages/db` schema.ts | Implemented | `cameras` 테이블에 컬럼 추가 필요 |
| `hls.js` | 신규 추가 | `apps/web` runtime dependency. dynamic import 사용 |

---

## DDD 모드 적용: ANALYZE-PRESERVE-IMPROVE

### ANALYZE (현행 코드 분석)

분석 대상 파일:

1. `packages/db/src/schema.ts` — cameras 테이블 현 구조 파악
2. `packages/db/src/migrations/` — 기존 마이그레이션 번호 확인
3. `apps/api/src/routes/boxes.ts` — 기존 Box 라우트 구조 파악 (신규 라우트 병합 지점)
4. `apps/api/src/services/boxService.ts` — 기존 서비스 의존성 확인
5. `apps/api/src/workers/boxStatusPoller.ts` — 기존 폴링 패턴 참조
6. `packages/shared/src/edgeai-box-client/client.ts` — `channels.*` API 시그니처 확인
7. `apps/web/src/routes/(app)/boxes/[id]/+page.svelte` — 기존 Box 상세 컴포넌트 구조
8. `apps/web/src/routes/(app)/boxes/[id]/+page.server.ts` — 서버 로드 함수 구조

### PRESERVE (특성 테스트 작성)

기존 동작 보존을 위한 특성 테스트 대상:

1. `boxes.ts` 라우트: 기존 5개 엔드포인트(`POST /api/boxes`, `GET /api/boxes`, `GET /api/boxes/:id`, `POST /api/boxes/:id/refresh`, `DELETE /api/boxes/:id`) 동작 보존
2. `boxService.ts`: 기존 `registerBox`, `listBoxes`, `getBox`, `deleteBox`, `refreshTokens` 동작 보존
3. `boxStatusPoller.ts`: 기존 60초 Box 상태 폴링 동작 보존
4. `cameras` 테이블: 기존 레코드 및 관계(alerts, alert_rules CASCADE) 보존 — 마이그레이션 검증
5. Box 상세 페이지(`+page.svelte`): 기존 Box 정보 표시, 편집 폼 동작 보존

### IMPROVE (신규 구현)

구현 순서 (우선순위 기준):

**Primary Goal: 채널 동기화 백엔드**
1. DB 마이그레이션 (`last_synced_at`, `sync_error` 컬럼 추가)
2. 채널 동기화 서비스 (`channelSyncService.ts`)
3. 채널 API 라우트 (5개 신규 엔드포인트)

**Secondary Goal: 채널 관리 UI**
4. Box 상세 페이지에 채널 섹션 추가 (읽기 전용 목록)
5. 채널 활성/비활성 토글 (Optimistic UI)
6. 수동 동기화 버튼

**Final Goal: 프리뷰 및 스냅샷**
7. 스냅샷 프록시 엔드포인트
8. HLS 프록시 라우트 (m3u8 플레이리스트 + 세그먼트 — 자격증명 서버사이드 주입)
9. 채널 인라인 HLS 프리뷰 (video 태그 + hls.js dynamic import, 자체 도메인 프록시 URL 사용)
10. WebRTC 시그널링 프록시 (Optional)

**Optional Goal: 주기 폴링 통합**
10. `channelSyncPoller.ts` — 기존 `boxStatusPoller.ts`와 유사한 패턴으로 채널 동기화 주기 폴링

---

## 영향 받는 파일 목록

### 신규 생성

| 파일 경로 | 역할 |
|---|---|
| `packages/db/src/migrations/XXXX_add_camera_sync_columns.sql` | `last_synced_at`, `sync_error` 컬럼 추가 마이그레이션 |
| `apps/api/src/services/channelSyncService.ts` | 채널 동기화 비즈니스 로직 (upsert, 상태 변환) |
| `apps/api/src/routes/channels.ts` | 채널 관련 라우트 5종 (Hono 서브라우터) |
| `apps/api/src/workers/channelSyncPoller.ts` | 주기 채널 동기화 스케줄러 |
| `apps/api/src/services/__tests__/channelSyncService.test.ts` | 단위 테스트 |
| `apps/api/src/routes/__tests__/channels.integration.test.ts` | 통합 테스트 |
| `apps/api/src/workers/__tests__/channelSyncPoller.test.ts` | 스케줄러 단위 테스트 |
| `apps/web/src/lib/components/ChannelList.svelte` | 채널 목록 컴포넌트 (읽기 전용) |
| `apps/web/src/lib/components/ChannelRow.svelte` | 채널 행 (토글, 스냅샷, 프리뷰 버튼) |
| `apps/web/src/lib/components/ChannelPreview.svelte` | HLS 인라인 프리뷰 컴포넌트 |
| `apps/web/src/routes/api/boxes/[id]/channels/sync/+server.ts` | SvelteKit API 라우트 — 동기화 프록시 |
| `apps/web/src/routes/api/boxes/[id]/channels/[channelId]/start/+server.ts` | SvelteKit API 라우트 — 토글 start |
| `apps/web/src/routes/api/boxes/[id]/channels/[channelId]/stop/+server.ts` | SvelteKit API 라우트 — 토글 stop |
| `apps/web/src/routes/api/boxes/[id]/channels/[channelId]/snapshot/+server.ts` | SvelteKit API 라우트 — 스냅샷 프록시 |
| `apps/web/src/routes/api/boxes/[id]/channels/[channelId]/hls/playlist.m3u8/+server.ts` | SvelteKit API 라우트 — HLS m3u8 프록시 (자격증명 서버 주입, 세그먼트 URL 재작성) |
| `apps/web/src/routes/api/boxes/[id]/channels/[channelId]/hls/segment/[name]/+server.ts` | SvelteKit API 라우트 — HLS ts 세그먼트 프록시 |
| `apps/web/src/routes/api/boxes/[id]/channels/[channelId]/webrtc/signal/+server.ts` | SvelteKit API 라우트 — WebRTC 시그널링 프록시 (Optional) |

### 수정

| 파일 경로 | 변경 내용 |
|---|---|
| `packages/db/src/schema.ts` | `cameras` 테이블에 `lastSyncedAt`, `syncError` 컬럼 추가 |
| `apps/api/src/routes/boxes.ts` | 채널 서브라우터(`channels.ts`) 마운트 |
| `apps/api/src/index.ts` | `channelSyncPoller` 초기화 및 종료 훅 등록 |
| `apps/api/src/services/boxService.ts` | `registerBox` 완료 후 `triggerChannelSync` 호출 훅 추가 |
| `apps/web/src/routes/(app)/boxes/[id]/+page.svelte` | 채널 섹션 및 `ChannelList` 컴포넌트 삽입 |
| `apps/web/src/routes/(app)/boxes/[id]/+page.server.ts` | Lazy 동기화 트리거 + 채널 목록 로드 추가 |

---

## 기술적 접근

### 채널 동기화 서비스 (`channelSyncService.ts`)

```
// 핵심 함수 시그니처 (구현 금지 — 설계 참조용)
syncChannelsForBox(boxId: string, db: DB): Promise<SyncResult>
  1. boxService.getBox(boxId) → Box 조회 및 자격증명 복호화
  2. BoxClient 생성 → channels.list() 호출 (타임아웃 10초)
  3. DB cameras 기존 레코드와 Upsert 비교
  4. INSERT / UPDATE 트랜잭션 실행
  5. Box API에 없는 채널 status → 'offline' 갱신
  6. last_synced_at 갱신 / sync_error 초기화
  7. SyncResult 반환 { synced, failed, timestamp }
```

### ChannelStatus → CameraStatus 변환

```
// spec.md 도메인 정의의 변환 규칙 구현
RUNNING           → 'online'
CONNECTING/RETRYING → 'offline'
STOPPED/PAUSED    → 'offline'
ERROR             → 'error'
```

### 채널 동기화 폴러 (`channelSyncPoller.ts`)

- `boxStatusPoller.ts` 패턴 참조 (동일 프로젝트 내 기존 구현)
- `CHANNEL_SYNC_INTERVAL_MS` 환경변수, 기본 300000ms (5분), 최소 30000ms 클램핑
- `CHANNEL_SYNC_CONCURRENCY` 환경변수, 기본 3 — 동시 처리 Box 수
- Box 단위 진행 중 플래그(Set 기반 뮤텍스)로 중복 폴링 방지
- 개별 Box 실패가 다음 Box 처리를 중단하지 않도록 try-catch 격리

### SvelteKit 채널 API 라우트 구조

SvelteKit `/routes/api/boxes/[id]/channels/...` 라우트는 `INTERNAL_API_URL`을 통해 Hono 백엔드로 프록시한다 (SPEC-BOX-UI-001 기존 패턴 준수).

### HLS 서버사이드 프록시 설계

```
// HLS m3u8 프록시 동작 흐름 (설계 참조용)
1. 클라이언트 → GET /api/boxes/:boxId/channels/:channelId/hls/playlist.m3u8
2. SvelteKit 서버 라우트 → Hono API 경유 or 직접 Box 호출
3. Hono 채널 서비스 → decryptBoxCredentials → BoxClient.channels HLS URL 구성
4. Box에서 m3u8 원본 수신 → 세그먼트 URL을 자체 도메인으로 재작성
   예: https://box-host/hls/ch-001/seg.ts?apikey=KEY
     → /api/boxes/:boxId/channels/:channelId/hls/segment/seg.ts
5. 재작성된 m3u8 → 클라이언트 반환 (Content-Type: application/vnd.apple.mpegurl)
6. hls.js가 세그먼트 요청 → /api/.../hls/segment/seg.ts
7. SvelteKit 서버 → Box에서 세그먼트 바이트 스트림 수신 → 클라이언트로 파이프
```

- 자격증명(`apikey`, JWT)은 서버-Box 구간에서만 사용. 클라이언트 요청에 절대 포함되지 않음.
- `Cache-Control: no-store` 적용 (m3u8 및 세그먼트 모두).

---

## 위험 요소 및 Mitigation

| 위험 | 심각도 | Mitigation |
|---|---|---|
| Box 다운 시 동기화 실패 | 중간 | `sync_error` 컬럼에 오류 기록, 마지막 성공 데이터 유지, 폴러 격리 |
| 채널 ID 충돌 (다른 Box의 동일 channelId) | 낮음 | `(box_id, channel_id)` 복합 유니크 인덱스로 격리 보장 |
| 동시 폴링으로 인한 DB 충돌 | 중간 | Box 단위 진행 중 플래그(Set) + Drizzle 트랜잭션 |
| HLS URL에 apikey 노출 | 해소됨 | SvelteKit HLS 프록시 라우트 도입으로 클라이언트에 자격증명 미노출. 서버-Box 구간만 apikey 사용 |
| 마이그레이션 기존 데이터 손실 | 높음 | nullable 컬럼 추가만 수행, 기존 레코드는 NULL로 유지 |
| 토글 실패 시 Optimistic UI 불일치 | 중간 | API 실패 시 원래 상태로 롤백, 에러 메시지 표시 |
| HLS 프록시 대역폭 부담 | 높음 | 서버가 HLS 세그먼트를 중계하므로 동시 프리뷰 수에 비례해 대역폭 소비. **Mitigation**: 동시 프리뷰 수를 UI에서 1~2개로 제한, 서버 대역폭 지표 모니터링 알림 설정 권고 (향후 CDN 오프로딩 SPEC 분리 권고) |

---

## 테스트 전략

### DDD 특성 테스트 (기존 동작 보존)

- `apps/api/src/routes/__tests__/boxes.integration.test.ts` — 기존 5개 엔드포인트 통과 확인
- `apps/api/src/services/__tests__/boxService.test.ts` — 기존 서비스 동작 보존
- `apps/api/src/workers/__tests__/boxStatusPoller.test.ts` — 기존 폴러 동작 보존

### 신규 단위 테스트 (Bun test)

| 테스트 파일 | 커버리지 대상 |
|---|---|
| `channelSyncService.test.ts` | Upsert 로직, 상태 변환, 타임아웃 처리, 오류 격리 |
| `channels.integration.test.ts` | 5개 신규 엔드포인트 정상/오류 시나리오 |
| `channelSyncPoller.test.ts` | 뮤텍스 동작, 인터벌 클램핑, 스케줄러 시작/중지 |

### 커버리지 목표

- 신규 파일: 85% 이상 (TRUST 5 기준)
- 특성 테스트: 기존 테스트 전량 통과

### UI 테스트

- Bun + Svelte 컴포넌트 테스트 (SPEC-BOX-UI-001 패턴 준수)
- 채널 토글 Optimistic UI 롤백 시나리오
- 빈 채널 목록 메시지 렌더링
