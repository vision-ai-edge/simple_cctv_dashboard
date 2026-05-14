<!-- TAG: BOX-CHANNELS-001 -->
---
id: SPEC-BOX-CHANNELS-001
title: EdgeAI Box 채널 동기화 및 채널 관리 UI
status: draft
version: 0.2.0
created: 2026-05-14
updated: 2026-05-14
owner: imgughyeon
related_specs:
  - SPEC-CORE-001  # 모노레포 기반 구조
  - SPEC-BOX-001   # 자격증명 볼트, boxService
  - SPEC-BOX-UI-001 # Box 상세 페이지 구조 및 디자인 시스템
  - SPEC-CORE-001  # edgeai-box-client (boxClient.channels.*)
---

# SPEC-BOX-CHANNELS-001: EdgeAI Box 채널 동기화 및 채널 관리 UI

## 변경 이력

| 날짜 | 버전 | 내용 | 작성자 |
|---|---|---|---|
| 2026-05-14 | 0.2.0 | hls.js 의존성 허용, HLS 서버사이드 프록시 방식으로 변경 (REQ-CHAN-007 재작성), 신규 HLS/WebRTC 프록시 엔드포인트 추가, 비기능 요구사항에 대역폭 모니터링 추가 | imgughyeon |
| 2026-05-14 | 0.1.0 | 초안 작성 | imgughyeon |

---

## 환경 (Environment)

- **런타임**: Bun 1.2+, SQLite (bun:sqlite + Drizzle ORM)
- **백엔드**: Hono 4.x (`apps/api/`) — 기존 `/api/boxes/*` 라우트에 채널 서브라우트 추가
- **프론트엔드**: SvelteKit 2.8+ + Svelte 5 runes API — `apps/web/src/routes/(app)/boxes/[id]/`
- **스타일**: TailwindCSS 4.0 (shadcn-svelte 미사용, SPEC-BOX-UI-001 디자인 시스템 준수)
- **언어**: TypeScript 5.9+ strict, `any` 금지
- **외부 클라이언트**: `packages/shared/src/edgeai-box-client/client.ts` (`boxClient.channels.*`)
- **자격증명**: SPEC-BOX-001 AES-GCM 볼트에서 복호화 — 재구현 금지
- **폴링 스케줄러**: Bun 내장 타이머 (`setInterval`) 기반, `CHANNEL_SYNC_INTERVAL_MS` 환경변수 조정 가능
- **스트리밍**: HLS 서버사이드 프록시 우선 (SvelteKit 서버 라우트가 m3u8 + 세그먼트를 Box로 프록시), WebRTC 보조 (서버 시그널링 프록시 또는 단기 토큰 발급)
- **신규 런타임 의존성**: `hls.js` — `apps/web` dependencies에 추가 허용 (dynamic import 권장)

---

## 가정 (Assumptions)

| 번호 | 가정 | 신뢰도 | 검증 방법 |
|------|------|--------|---------|
| A1 | SPEC-BOX-001 볼트 API(`decryptBoxCredentials`)가 정상 동작한다 | 높음 | 기구현 서비스 단위 테스트 |
| A2 | `boxClient.channels.list()` 응답의 `id` 필드가 Box 내에서 고유한 채널 식별자다 | 높음 | EdgeAI Box OpenAPI 3.0.3 명세 |
| A3 | EdgeAI Box JWT는 만료 시간이 없다 (`expiresAt: null`) — SPEC-BOX-001 A2와 동일 | 높음 | 실측 확인 |
| A4 | `ChannelStatus` ENUM: `STOPPED \| CONNECTING \| RUNNING \| PAUSED \| ERROR \| RETRYING` | 높음 | `packages/shared` ChannelStatus 타입 |
| A5 | Box가 다운된 경우 채널 동기화 실패는 마지막 성공 데이터를 유지하고 `sync_error`를 기록한다 | 높음 | 설계 결정 |
| A6 | 라이브 프리뷰는 MVP에서 SvelteKit HLS 프록시 라우트 + video 태그 + hls.js로 제공하며 자격증명은 절대 클라이언트에 노출되지 않는다. 전용 플레이어 페이지는 별도 SPEC으로 분리한다 | 높음 | 범위 결정 |
| A7 | 스냅샷 API는 이미지 바이트를 반환하며 서버가 프록시하여 클라이언트에 제공한다 (자격증명 미노출) | 높음 | EdgeAI Box API 명세 |
| A8 | cameras 테이블 기존 데이터는 보존된다. 신규 컬럼은 nullable 또는 기본값으로 추가된다 | 높음 | 마이그레이션 제약 |
| A9 | 동일 Box에 대한 동시 폴링을 방지하기 위해 Box 단위 뮤텍스(진행 중 플래그)를 사용한다 | 높음 | 설계 결정 |

---

## 도메인 정의

### Channel ↔ Camera 매핑

EdgeAI Box의 "채널(channel)"은 대시보드 DB의 "카메라(camera)"에 1:1 매핑된다.

| EdgeAI Box 필드 | cameras 테이블 컬럼 | 비고 |
|---|---|---|
| `channel.id` | `channel_id` | Box 내부 식별자. `(box_id, channel_id)` 조합으로 글로벌 유일 |
| `channel.name` | `name` | 동기화 시 덮어쓰기 |
| `channel.resolution` | `resolution` | 문자열, nullable |
| `channel.rtspUrl` (또는 streamUrl) | `stream_url` | 동기화 시 갱신 |
| `channel.status` (ChannelStatus) | `status` (CameraStatus) | 아래 변환 규칙 적용 |
| `channel.latitude` | `latitude` | nullable |
| `channel.longitude` | `longitude` | nullable |

### ChannelStatus → CameraStatus 변환 규칙

| ChannelStatus (Box API) | CameraStatus (DB) | 비고 |
|---|---|---|
| `RUNNING` | `online` | 정상 스트리밍 중 |
| `CONNECTING`, `RETRYING` | `offline` | 연결 시도 중 — 아직 영상 없음 |
| `STOPPED`, `PAUSED` | `offline` | 비활성 상태 |
| `ERROR` | `error` | 오류 상태 |

### cameras 테이블 변경 사항

기존 스키마를 유지하면서 다음 2개 컬럼을 추가한다 (마이그레이션 필요).

| 컬럼명 | 타입 | nullable | 기본값 | 용도 |
|---|---|---|---|---|
| `last_synced_at` | INTEGER (Unix ms) | nullable | NULL | 마지막 채널 동기화 성공 시각 |
| `sync_error` | TEXT | nullable | NULL | 마지막 동기화 실패 메시지. 성공 시 NULL로 초기화 |

> 기존 컬럼(`stream_url`, `status`, `resolution` 등)은 유지. NOT NULL 컬럼 신규 추가 금지.

---

## 요구사항 (Requirements)

### REQ-CHAN-001: 채널 동기화 — Box 등록 직후 자동 1회 실행

**[Event-Driven]** WHEN Box 등록이 성공적으로 완료되면 (`POST /api/boxes` 201 응답 직후) THEN 시스템은 해당 Box의 채널 목록을 1회 자동 동기화해야 한다.

- 동기화 실패 시 Box 등록 자체는 롤백하지 않는다.
- 동기화 결과는 응답 본문에 포함하지 않고 백그라운드에서 처리한다 (fire-and-forget, 단 오류는 로깅).

### REQ-CHAN-002: 채널 동기화 — 주기적 서버 폴링

**[Ubiquitous]** 시스템은 `CHANNEL_SYNC_INTERVAL_MS` 환경변수로 설정된 주기(기본 5분, 최소 30초)마다 모든 활성 Box(`status = 'active'`)의 채널 목록을 자동으로 동기화해야 한다.

**[State-Driven]** IF Box `status`가 `'inactive'` 또는 `'error'`이면 THEN 해당 Box의 주기 동기화를 건너뛰어야 한다.

**[Unwanted]** 동일 Box에 대해 이전 동기화가 아직 진행 중이면 시스템은 새 동기화를 시작하지 않아야 한다 (동시 폴링 방지).

### REQ-CHAN-003: 채널 동기화 — Box 상세 페이지 진입 시 Lazy 동기화

**[Event-Driven]** WHEN 사용자가 Box 상세 페이지(`/boxes/[id]`)에 진입하면 THEN 시스템은 해당 Box의 채널 동기화 캐시 TTL(30초)을 확인하여, 마지막 동기화로부터 30초 이상 경과한 경우 서버 측에서 채널 동기화를 1회 실행해야 한다.

**[State-Driven]** IF `cameras.last_synced_at`이 현재 시각 - 30초 이내이면 THEN 동기화를 건너뛰고 기존 DB 데이터를 반환해야 한다.

### REQ-CHAN-004: 동기화 로직 — Upsert

**[Ubiquitous]** 채널 동기화 시 시스템은 `(box_id, channel_id)` 조합을 기준으로 Upsert를 수행해야 한다.

- Box API에 존재하는 채널: DB에 없으면 INSERT, 있으면 UPDATE (이름, 상태, 해상도, 스트림 URL 갱신).
- DB에는 있지만 Box API 응답에 없는 채널: `status`를 `'offline'`으로 갱신하고 `sync_error`를 NULL로 유지 (소프트 삭제 없음, 하드 삭제 없음).
- 동기화 성공 시: `last_synced_at`을 현재 시각으로, `sync_error`를 NULL로 갱신.
- 동기화 실패 시: `last_synced_at`은 변경하지 않고, `sync_error`에 오류 메시지를 기록.

### REQ-CHAN-005: 채널 목록 UI — Box 상세 페이지 내 섹션

**[Ubiquitous]** 시스템은 Box 상세 페이지(`/boxes/[id]`) 내에 채널 목록 섹션을 제공해야 한다. 섹션은 별도 라우트가 아닌 인라인 섹션으로 구성한다.

**[Ubiquitous]** 채널 목록은 채널 이름, 채널 ID, 상태 배지(CameraStatus 기준), 마지막 동기화 시각을 표시해야 한다.

**[State-Driven]** IF `cameras` 테이블에 해당 Box의 채널이 없으면 THEN "채널이 없습니다. 동기화 버튼을 눌러 채널을 가져오세요" 안내 메시지를 표시해야 한다.

### REQ-CHAN-006: 채널 활성/비활성 토글

**[Event-Driven]** WHEN 사용자가 채널의 활성 토글을 클릭하면 THEN 시스템은 서버 API를 통해 EdgeAI Box에 `channels.start(id)` 또는 `channels.stop(id)`를 호출해야 한다.

**[Ubiquitous]** 토글 요청은 Optimistic UI를 적용한다: 클릭 즉시 UI 상태를 전환하고, API 실패 시 원래 상태로 롤백하며 에러 메시지를 표시해야 한다.

**[State-Driven]** IF 채널 상태가 `RUNNING`이면 THEN 토글 UI는 "비활성화" 동작을 표시하고, 그 외 상태이면 "활성화" 동작을 표시해야 한다.

**[Unwanted]** 토글 요청이 진행 중인 동안 시스템은 동일 채널에 대한 중복 토글 요청을 허용하지 않아야 한다 (버튼 비활성화).

### REQ-CHAN-007: 라이브 프리뷰 (MVP, HLS 서버사이드 프록시)

**[Event-Driven]** WHEN 사용자가 채널의 "프리뷰" 버튼을 클릭하면 THEN 시스템은 자체 도메인의 HLS 프록시 URL을 사용하여 hls.js와 video 엘리먼트로 스트림을 인라인 재생해야 한다.

**[Ubiquitous]** 클라이언트는 `/api/boxes/:boxId/channels/:channelId/hls/playlist.m3u8` 형식의 자체 도메인 URL만 사용해야 한다. SvelteKit 서버 라우트가 복호화된 자격증명을 사용해 EdgeAI Box HLS 엔드포인트(`{baseUrl}/hls/{channelId}/playlist.m3u8?apikey={key}`)로 m3u8 및 ts 세그먼트를 프록시 스트리밍해야 한다.

**[Ubiquitous]** hls.js는 `apps/web` 런타임 의존성으로 추가한다. 초기 번들 크기를 최소화하기 위해 dynamic import(`import('hls.js')`)를 사용해야 한다.

**[Optional]** 가능하면 HLS 재생이 실패할 경우 서버 시그널링 프록시 또는 단기 토큰 방식의 WebRTC 대체 수단을 제공한다. WebRTC의 경우도 자격증명 원문은 클라이언트에 노출되지 않아야 한다.

**[Unwanted]** EdgeAI Box의 API Key 또는 JWT는 클라이언트 네트워크 요청, 브라우저 콘솔, 클라이언트 측 JavaScript 소스 어디에도 노출되어서는 안 된다.

### REQ-CHAN-008: 스냅샷

**[Event-Driven]** WHEN 사용자가 채널의 "스냅샷" 버튼을 클릭하면 THEN 시스템은 서버 프록시 엔드포인트를 통해 EdgeAI Box `snapshot` API를 호출하고 이미지를 인라인으로 표시하거나 다운로드해야 한다.

**[Unwanted]** 스냅샷 요청 시 클라이언트가 EdgeAI Box 자격증명(API Key, JWT)을 직접 알지 않아야 한다. 서버 프록시가 자격증명을 주입하여 Box API를 호출해야 한다.

### REQ-CHAN-009: 수동 동기화 트리거

**[Event-Driven]** WHEN 사용자가 Box 상세 페이지의 "채널 동기화" 버튼을 클릭하면 THEN 시스템은 `POST /api/boxes/:id/channels/sync` 엔드포인트를 호출하여 즉시 1회 채널 동기화를 수행해야 한다.

**[Event-Driven]** WHEN 동기화가 완료되면 THEN 시스템은 채널 목록 UI를 갱신해야 한다.

### REQ-CHAN-010: 비기능 — 동기화 타임아웃 및 동시성

**[Ubiquitous]** 채널 동기화 시 EdgeAI Box API 호출 타임아웃은 10초로 제한해야 한다.

**[Ubiquitous]** 주기 폴링 스케줄러는 단일 스레드에서 순차적으로 Box를 처리하거나, 최대 동시 처리 Box 수를 환경변수(`CHANNEL_SYNC_CONCURRENCY`, 기본값 3)로 제한해야 한다.

**[Unwanted]** 폴링 스케줄러의 오류가 전체 서버 프로세스를 종료시켜서는 안 된다. 개별 Box 동기화 실패는 격리되어야 한다.

---

## API 설계 (신규 서버 엔드포인트)

모든 엔드포인트는 기존 `requireAuth` 미들웨어로 보호된다.

### 1. 채널 동기화 트리거

```
POST /api/boxes/:id/channels/sync
```

- **요청 본문**: 없음
- **응답 성공 (200)**:
  ```json
  {
    "success": true,
    "synced": 5,
    "failed": 0,
    "timestamp": 1748000000000
  }
  ```
- **응답 실패 (404)**: Box 없음
- **응답 실패 (502)**: EdgeAI Box 통신 오류

### 2. 채널 목록 조회 (DB 기반)

```
GET /api/boxes/:id/channels
```

- **응답 (200)**: `cameras` 테이블의 해당 Box 채널 목록
  ```json
  {
    "channels": [
      {
        "id": "cam-ulid",
        "channelId": "ch-001",
        "name": "입구 카메라",
        "status": "online",
        "resolution": "1920x1080",
        "streamUrl": "rtsp://...",
        "lastSyncedAt": 1748000000000,
        "syncError": null
      }
    ]
  }
  ```

### 3. 채널 토글 (활성화/비활성화)

```
POST /api/boxes/:boxId/channels/:channelId/start
POST /api/boxes/:boxId/channels/:channelId/stop
```

- **응답 성공 (200)**: `{ "success": true }`
- **응답 실패 (502)**: Box API 오류

### 4. 스냅샷 프록시

```
GET /api/boxes/:boxId/channels/:channelId/snapshot?type=preview|fullsize
```

- **응답**: `Content-Type: image/*` (이미지 바이트 스트림)
- **서버 동작**: 복호화된 자격증명으로 EdgeAI Box snapshot API 호출 후 응답 바이트를 클라이언트로 파이프
- **오류 (502)**: Box API 호출 실패

### 5. HLS 프록시 — m3u8 플레이리스트

```
GET /api/boxes/:boxId/channels/:channelId/hls/playlist.m3u8
```

- **역할**: SvelteKit 서버 라우트가 EdgeAI Box의 HLS m3u8을 가져와 세그먼트 URL을 자체 도메인 프록시 경로로 재작성한 후 클라이언트에 전달
- **응답**: `Content-Type: application/vnd.apple.mpegurl` (m3u8 텍스트)
- **세그먼트 URL 재작성 예시**: `https://box-host/hls/ch-001/seg-001.ts?apikey=KEY` → `/api/boxes/:boxId/channels/:channelId/hls/segment/seg-001.ts`
- **캐시**: `Cache-Control: no-store`
- **오류 (502)**: Box HLS 엔드포인트 접근 실패

### 6. HLS 프록시 — ts 세그먼트

```
GET /api/boxes/:boxId/channels/:channelId/hls/segment/[name]
```

- **역할**: SvelteKit 서버 라우트가 세그먼트 파일명(`[name]`)으로 Box의 실제 세그먼트 URL을 구성하여 바이트 스트림을 클라이언트에 파이프
- **응답**: `Content-Type: video/mp2t`
- **캐시**: `Cache-Control: no-store`
- **오류 (502)**: Box 세그먼트 접근 실패

### 7. WebRTC 시그널링 프록시 (Optional)

```
POST /api/boxes/:boxId/channels/:channelId/webrtc/signal
```

- **역할**: 서버가 자격증명을 주입하여 Box WebRTC 시그널링 엔드포인트로 요청을 전달. 클라이언트는 자격증명 없이 시그널링만 수행.
- **응답**: Box WebRTC 시그널링 응답 본문을 그대로 전달
- **캐시**: `Cache-Control: no-store`

---

## 보안 고려사항

| 항목 | 요구사항 | 구현 방법 |
|---|---|---|
| 자격증명 비노출 | API Key, JWT 원문을 클라이언트에 직접 전송 금지 | 서버 프록시 엔드포인트 경유 (HLS m3u8+세그먼트, 스냅샷, WebRTC 모두 서버 프록시) |
| HLS 토큰 처리 | apikey/JWT를 클라이언트 네트워크 요청에 노출 금지 | SvelteKit HLS 프록시 라우트가 자격증명을 서버 측에서 주입. 클라이언트는 자체 도메인 URL만 사용 |
| 인증 | 모든 신규 엔드포인트 `requireAuth` 미들웨어 적용 | Hono 라우트 미들웨어 체인 |
| OWASP A01 (접근 제어) | Box 소유권 검증 — 다른 사용자의 Box 채널에 접근 불가 | `boxService.getBox(id)`의 소유권 확인 (현재 단일 사용자, 향후 다중 사용자 대비) |
| 입력 검증 | 모든 요청 파라미터 Zod 스키마 검증 | Hono `zValidator` 미들웨어 |
| 타임아웃 | EdgeAI Box API 호출 10초 타임아웃 | `AbortController` + `signal` |

---

## 비기능 요구사항 요약

| 항목 | 요구사항 |
|---|---|
| 동기화 타임아웃 | Box API 호출당 10초 |
| 주기 폴링 기본 간격 | 5분 (`CHANNEL_SYNC_INTERVAL_MS=300000`) |
| 폴링 최소 간격 | 30초 (환경변수로 더 짧게 설정 시 30초로 클램핑) |
| 폴링 동시 처리 Box 수 | 최대 3 (`CHANNEL_SYNC_CONCURRENCY=3`, 기본값) |
| Lazy 동기화 캐시 TTL | 30초 (`cameras.last_synced_at` 기준) |
| 에러 격리 | 개별 Box 동기화 실패는 다른 Box 및 서버 프로세스에 영향 없음 |
| HLS 프록시 대역폭 | SvelteKit HLS 프록시는 서버 아웃바운드 대역폭을 소비함. 서버 대역폭 모니터링 필요 (동시 프리뷰 수 기준 추적 권고) |

---

## 범위 외 (Out of Scope)

- 전용 라이브 스트림 플레이어 페이지 (별도 SPEC으로 분리 권고)
- 채널 생성/수정/삭제 (EdgeAI Box에서 관리, 대시보드는 읽기+토글만)
- WebRTC SFU/미디어 서버 중계 (Optional 시그널링 프록시만 제공)
- 채널별 알림 규칙 (SPEC-ALERT-* 범위)
- 카메라 그룹 관리 (별도 SPEC)
- HLS 프록시 캐싱 레이어 (현재 범위: no-store, 향후 CDN 연동 시 별도 SPEC)
