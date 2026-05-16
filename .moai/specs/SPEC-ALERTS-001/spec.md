<!-- TAG: ALERTS-001 -->
---
id: SPEC-ALERTS-001
title: AI 검출 이벤트 알림 + AI 모델 관리
status: planned
version: 0.1.0
created: 2026-05-16
updated: 2026-05-16
owner: imgughyeon
related_specs:
  - SPEC-AUTH-001       # users 테이블, requireAuth 미들웨어
  - SPEC-BOX-001        # AES-GCM 자격증명 볼트, withAuthRetry
  - SPEC-BOX-CHANNELS-001  # channelSyncService, BoxClient, cameras 테이블
---

# SPEC-ALERTS-001: AI 검출 이벤트 알림 + AI 모델 관리

## 변경 이력

| 날짜 | 버전 | 내용 | 작성자 |
|------|------|------|--------|
| 2026-05-16 | 0.1.0 | 초안 작성 | imgughyeon |

---

## 환경 (Environment)

- **런타임**: Bun 1.2+, SQLite (bun:sqlite + Drizzle ORM)
- **백엔드**: Hono 4.5+ (`apps/api/`) — 신규 라우트 그룹 `/api/alerts/*`, `/api/models/*`
- **프론트엔드**: SvelteKit 2.8+ + Svelte 5 runes API — `apps/web/src/routes/(app)/`
- **스타일**: TailwindCSS 4.0 + shadcn-svelte 1.0+ (Toast 컴포넌트 재사용)
- **언어**: TypeScript 5.9+ strict, `any` 금지
- **외부 클라이언트**: `packages/shared/src/edgeai-box-client/client.ts`
  - `client.visionAi.*` — 채널별 detection 폴링, 채널 모델 슬롯 관리
  - `client.models.*` — 전역 모델 CRUD (ModelListResponseSchema envelope 버그 수정 포함)
- **자격증명**: SPEC-BOX-001 AES-GCM 볼트 + `withAuthRetry` — 재구현 금지
- **인증**: SPEC-AUTH-001 JWT HttpOnly 쿠키 + `requireAuth` 미들웨어
- **실시간 알림 전달**:
  - In-dashboard: Hono SSE (`/api/alerts/stream`)
  - WebPush: Web Push API (VAPID) + Service Worker
  - Telegram: Bot API (`sendMessage`)
- **신규 환경변수** (상세는 결정사항 D5·D6 참조):
  - `TELEGRAM_BOT_TOKEN` — Telegram Bot 토큰
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT` — WebPush VAPID 키

---

## 가정 (Assumptions)

| 번호 | 가정 | 신뢰도 | 검증 방법 |
|------|------|--------|---------|
| A1 | SPEC-BOX-001 볼트 API (`decryptBoxCredentials`, `withAuthRetry`)가 정상 동작한다 | 높음 | 기구현 단위 테스트 통과 |
| A2 | SPEC-BOX-CHANNELS-001 구현이 main에 머지되어 `cameras` 테이블, `channelSyncService`, BoxClient가 사용 가능하다 | 높음 | PR #7 머지 가정 |
| A3 | BoxClient `client.visionAi.getDetections(channelId)` 는 `{ success, channelId, timestamp, count, detections: [...] }` envelope를 반환한다 | 높음 | OpenAPI v1.3.6 명세 |
| A4 | `ModelListResponseSchema` 가 현재 `z.array(ModelInfoSchema)`로 정의되어 있으나 실제 응답은 `{ success, models: [...] }` envelope이다 — 본 SPEC에서 수정한다 | 높음 | types.ts 코드 내 TODO 주석 확인 |
| A5 | 박스 JWT는 만료 시간이 없다 (`expiresAt: null`) — SPEC-BOX-001 A3 동일 | 높음 | 실측 확인 |
| A6 | Telegram Bot 토큰은 환경변수로 관리한다 (사용자별 설정 아님). Chat ID는 사용자별 `alert_destinations` 테이블에 저장한다 | 높음 | D5 결정 반영 |
| A7 | VAPID 키는 환경변수로 관리한다. 앱 재시작 시 기존 구독은 유효하다 | 높음 | D6 결정 반영 |
| A8 | 모델 업로드 파일 크기 기본 상한은 100MB로 설정한다. 박스 측 실제 한도는 별도 확인 필요 | 중간 | D7 결정 반영 (박스 측 확인 후 조정) |
| A9 | ROI 관리 UI는 1차 범위에서 제외한다. 백엔드 API(`/roi`) 라우트는 프록시 형태로 제공하지 않는다 | 높음 | D4 결정 반영 |
| A10 | 알림 히스토리는 최근 1,000건을 보관하며, 오래된 항목은 자동 삭제한다 | 높음 | 설계 결정 |

---

## 데이터 모델 (Migration 0006)

> 기존 마이그레이션 번호: 0005 (`last_synced_at`, `sync_error` 컬럼, SPEC-BOX-CHANNELS-001).
> 본 SPEC은 마이그레이션 **0006** 으로 신규 테이블 4개를 추가한다.

### `webpush_subscriptions` 테이블

```sql
CREATE TABLE webpush_subscriptions (
  id         TEXT PRIMARY KEY,           -- ULID
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL            -- Unix ms
);
CREATE INDEX idx_webpush_subscriptions_user ON webpush_subscriptions(user_id);
```

### `alert_destinations` 테이블

```sql
CREATE TABLE alert_destinations (
  id          TEXT PRIMARY KEY,          -- ULID
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK(channel IN ('toast', 'webpush', 'telegram')),
  enabled     INTEGER NOT NULL DEFAULT 1, -- 0 | 1
  config_json TEXT,                      -- JSON: Telegram의 경우 {"chat_id":"..."}
  created_at  INTEGER NOT NULL,          -- Unix ms
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_alert_destinations_user_channel
  ON alert_destinations(user_id, channel);
```

### `alerts` 테이블

```sql
CREATE TABLE alerts (
  id           TEXT PRIMARY KEY,         -- ULID
  channel_id   TEXT,                     -- cameras.id (nullable: 박스 레벨 알림 대비)
  box_id       TEXT NOT NULL,            -- boxes.id
  type         TEXT NOT NULL,            -- 예: 'intrusion', 'fall', 'unknown'
  payload_json TEXT NOT NULL,            -- 원본 detection 이벤트 JSON
  fired_at     INTEGER NOT NULL,         -- Unix ms (detection timestamp 기준)
  status       TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'delivered'))
);
CREATE INDEX idx_alerts_fired_at ON alerts(fired_at DESC);
CREATE INDEX idx_alerts_box_channel ON alerts(box_id, channel_id);
```

### `detection_cursor` 테이블

```sql
CREATE TABLE detection_cursor (
  box_id              TEXT NOT NULL,
  channel_id          TEXT NOT NULL,     -- cameras.channel_id (Box 내부 ID)
  last_seen_timestamp INTEGER NOT NULL DEFAULT 0, -- Unix ms
  PRIMARY KEY (box_id, channel_id)
);
```

---

## 요구사항 (Requirements)

---

### Area A: AI 검출 이벤트 알림

#### REQ-ALERT-001: 박스 detections 폴링 워커

**[Ubiquitous]** 시스템은 백그라운드 워커를 통해 모든 활성 박스(`status = 'active'`)의 모든 활성 채널(`status = 'online'`)에 대해 주기적으로 `GET /channels/{id}/vision-ai/detections` 를 폴링해야 한다.

**[State-Driven]** IF 박스 `status`가 `'inactive'` 또는 `'error'`이면 THEN 해당 박스의 detection 폴링을 건너뛰어야 한다.

**[Ubiquitous]** 폴링 간격은 환경변수 `DETECTION_POLL_INTERVAL_MS` 로 조정 가능하며 기본값은 결정사항 D3에 따른다.

**[Unwanted]** 동일 채널에 대한 이전 폴링이 진행 중이면 시스템은 새 폴링을 시작하지 않아야 한다.

**[Unwanted]** 폴링 워커의 오류가 전체 서버 프로세스를 종료시켜서는 안 된다. 개별 채널 폴링 실패는 격리되어야 한다.

#### REQ-ALERT-002: 새 이벤트 감지 및 중복 방지

**[Event-Driven]** WHEN 폴링 응답에서 새 detection 이벤트가 감지되면 THEN 시스템은 `detection_cursor` 테이블의 `last_seen_timestamp` 이후 이벤트만 신규로 처리해야 한다.

**[Ubiquitous]** 신규 이벤트 처리 완료 후 시스템은 `detection_cursor.last_seen_timestamp` 를 최신 이벤트 타임스탬프로 갱신해야 한다.

**[Unwanted]** 동일 타임스탬프의 이벤트를 중복 처리해서는 안 된다.

#### REQ-ALERT-003: 알림 이벤트 DB 저장

**[Event-Driven]** WHEN 신규 detection 이벤트가 감지되면 THEN 시스템은 `alerts` 테이블에 해당 이벤트를 `status='new'` 로 저장해야 한다.

**[Ubiquitous]** 알림 히스토리는 최근 1,000건을 유지한다. 초과 시 가장 오래된 항목부터 삭제한다.

#### REQ-ALERT-004: In-dashboard 토스트 알림 (Hono SSE)

**[Event-Driven]** WHEN 브라우저가 `GET /api/alerts/stream` 에 SSE 연결을 맺으면 THEN 시스템은 해당 사용자의 `alert_destinations.channel='toast'` 설정이 활성화된 경우 신규 알림 이벤트를 SSE로 푸시해야 한다.

**[Ubiquitous]** SSE 이벤트 형식은 `data: { id, type, channelId, boxId, firedAt, payload }` JSON이어야 한다.

**[State-Driven]** IF `alert_destinations.channel='toast'` 가 비활성화되어 있으면 THEN SSE 연결은 유지하되 토스트 이벤트를 전송하지 않아야 한다.

**[Unwanted]** SSE 연결 인증에 실패한 사용자에게 알림 이벤트를 전송해서는 안 된다. `requireAuth` 미들웨어를 적용한다.

#### REQ-ALERT-005: WebPush 구독 관리

**[Event-Driven]** WHEN 사용자가 WebPush 알림을 활성화하면 THEN 시스템은 브라우저 Push Subscription 객체를 `POST /api/alerts/webpush/subscribe` 로 받아 `webpush_subscriptions` 테이블에 저장해야 한다.

**[Event-Driven]** WHEN 사용자가 WebPush 알림을 비활성화하면 THEN 시스템은 `DELETE /api/alerts/webpush/subscribe` 를 통해 해당 구독을 삭제해야 한다.

**[Ubiquitous]** VAPID 공개키는 `GET /api/alerts/webpush/vapid-public-key` 로 제공해야 한다. 비밀키는 서버 환경변수에만 보관한다.

#### REQ-ALERT-006: WebPush 알림 발송

**[Event-Driven]** WHEN 신규 detection 이벤트가 감지되면 THEN 시스템은 해당 사용자의 `alert_destinations.channel='webpush'` 설정이 활성화된 경우 `webpush_subscriptions` 테이블의 모든 구독에 WebPush 알림을 발송해야 한다.

**[Ubiquitous]** WebPush 페이로드는 `{ title, body, icon, data: { alertId, type, channelId } }` 형식이어야 한다.

**[Event-Driven]** WHEN 구독이 만료(410 Gone)되면 THEN 시스템은 해당 구독을 `webpush_subscriptions` 테이블에서 삭제해야 한다.

**[Unwanted]** 구독 엔드포인트, `p256dh`, `auth` 값을 클라이언트 API 응답에 노출해서는 안 된다.

#### REQ-ALERT-007: Telegram Bot 알림 발송

**[Event-Driven]** WHEN 신규 detection 이벤트가 감지되면 THEN 시스템은 해당 사용자의 `alert_destinations.channel='telegram'` 설정이 활성화되고 `config_json.chat_id` 가 설정된 경우 Telegram Bot API `sendMessage` 를 호출하여 알림을 전송해야 한다.

**[Ubiquitous]** Telegram 메시지 형식은 `[카메라명] {type} 이벤트 감지 — {datetime}` 이어야 한다.

**[Unwanted]** `TELEGRAM_BOT_TOKEN` 이 설정되지 않은 경우 시스템은 Telegram 알림 발송을 시도하지 않아야 한다. 서버 오류로 처리하지 않고 WARNING 로그만 기록한다.

#### REQ-ALERT-008: 알림 설정 UI

**[Ubiquitous]** 시스템은 알림 설정 페이지(`/settings/alerts`)를 제공해야 한다. 사용자는 토스트, WebPush, Telegram 세 채널을 각각 on/off 할 수 있어야 한다.

**[Event-Driven]** WHEN 사용자가 Telegram 채널을 활성화하면 THEN 시스템은 Telegram Chat ID 입력 필드를 표시하고 저장해야 한다.

**[Event-Driven]** WHEN 사용자가 WebPush 채널을 활성화하면 THEN 시스템은 브라우저 Push Subscription 등록 흐름을 시작해야 한다.

#### REQ-ALERT-009: 알림 히스토리 조회

**[Ubiquitous]** 시스템은 `GET /api/alerts?limit=N&offset=M` API를 제공해야 한다. 응답은 최신순 정렬이며 최대 100건을 반환한다.

**[Ubiquitous]** 시스템은 알림 히스토리 UI(`/alerts` 또는 대시보드 사이드 패널)를 제공해야 한다. 각 항목에는 이벤트 유형, 채널명, 발생 시각, 페이로드 요약을 표시해야 한다.

#### REQ-ALERT-010: 알림 전달 지연 목표

**[Ubiquitous]** 시스템은 detection 이벤트 발생부터 사용자 알림 수신까지 5초 이내를 목표로 해야 한다. 폴링 기반 아키텍처의 특성상 폴링 간격이 지연의 주요 변수이다.

---

### Area B: AI 모델 관리

#### REQ-MODEL-001: ModelListResponseSchema envelope 버그 수정

**[Ubiquitous]** 시스템은 `packages/shared/src/edgeai-box-client/types.ts` 의 `ModelListResponseSchema` 를 `{ success, models: [...] }` envelope를 올바르게 unwrap하도록 수정해야 한다.

**[Ubiquitous]** 수정 전 기존 동작을 보존하는 characterization 테스트를 먼저 작성해야 한다 (DDD PRESERVE 단계).

#### REQ-MODEL-002: 전역 모델 목록 조회

**[Ubiquitous]** 시스템은 `GET /api/models` API를 제공해야 한다. 서버는 박스 클라이언트를 통해 EdgeAI Box `GET /models` 를 호출하고 결과를 반환해야 한다.

**[Ubiquitous]** 응답 형식: `{ models: [{ id, name, type, task, fileSize, isBuiltIn }] }`

#### REQ-MODEL-003: 전역 모델 업로드

**[Event-Driven]** WHEN 사용자가 모델 파일과 메타데이터 파일을 선택하고 업로드 버튼을 클릭하면 THEN 시스템은 `POST /api/models` (multipart/form-data: `modelFile`, `metadataFile`) 를 통해 EdgeAI Box에 모델을 업로드해야 한다.

**[Ubiquitous]** 업로드 파일 크기 상한은 결정사항 D7에 따른다 (기본 100MB).

**[Unwanted]** 파일 크기 상한을 초과한 요청은 `413 Payload Too Large` 로 거부해야 한다.

#### REQ-MODEL-004: 전역 모델 삭제

**[Event-Driven]** WHEN 사용자가 모델 삭제 버튼을 클릭하고 확인하면 THEN 시스템은 `DELETE /api/models/{id}` 를 통해 EdgeAI Box에서 모델을 삭제해야 한다.

**[Unwanted]** 삭제 확인 다이얼로그 없이 즉시 삭제 API를 호출해서는 안 된다.

#### REQ-MODEL-005: 채널별 활성 모델 슬롯 조회

**[Ubiquitous]** 시스템은 `GET /api/boxes/:boxId/channels/:channelId/vision-ai/models` API를 제공해야 한다. 해당 채널에 활성화된 모델 슬롯 목록을 반환한다.

#### REQ-MODEL-006: 채널별 모델 슬롯 추가

**[Event-Driven]** WHEN 사용자가 채널에 모델을 활성화하면 THEN 시스템은 `POST /api/boxes/:boxId/channels/:channelId/vision-ai/models` (body: `{ modelId, enabled? }`) 를 통해 EdgeAI Box에 모델 슬롯을 추가해야 한다.

#### REQ-MODEL-007: 채널별 모델 슬롯 제거

**[Event-Driven]** WHEN 사용자가 채널에서 모델을 비활성화하면 THEN 시스템은 `DELETE /api/boxes/:boxId/channels/:channelId/vision-ai/models/{modelId}` 를 통해 EdgeAI Box에서 모델 슬롯을 제거해야 한다.

#### REQ-MODEL-008: 모델 관리 UI

**[Ubiquitous]** 시스템은 전역 모델 관리 페이지(`/models`)를 제공해야 한다. 페이지는 모델 목록, 업로드 폼, 삭제 버튼을 포함해야 한다.

**[Ubiquitous]** 채널 상세 보기(또는 Box 상세 페이지 내 섹션)에서 해당 채널의 활성 모델 슬롯을 표시하고 추가/제거할 수 있어야 한다.

#### REQ-MODEL-009: ROI 관리 (1차 제외)

**[Optional]** 가능하면 채널 모델 슬롯에 대한 ROI(관심영역) 설정 기능(`/vision-ai/models/{modelId}/roi`)을 제공한다. 이 기능은 1차 범위에서 제외하며 별도 SPEC 또는 SPEC-ALERTS-002에서 다룬다.

---

## API 설계 (신규 서버 엔드포인트)

모든 엔드포인트는 `requireAuth` 미들웨어로 보호된다.

### 알림 관련

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/alerts/stream` | SSE 알림 스트림 (EventSource) |
| `GET` | `/api/alerts` | 알림 히스토리 목록 (`?limit=&offset=`) |
| `GET` | `/api/alerts/webpush/vapid-public-key` | VAPID 공개키 반환 |
| `POST` | `/api/alerts/webpush/subscribe` | WebPush 구독 등록 |
| `DELETE` | `/api/alerts/webpush/subscribe` | WebPush 구독 해제 |
| `GET` | `/api/alerts/destinations` | 알림 채널 설정 조회 |
| `PUT` | `/api/alerts/destinations/:channel` | 알림 채널 설정 변경 (`toast\|webpush\|telegram`) |

### 모델 관련

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/models` | 전역 모델 목록 |
| `POST` | `/api/models` | 전역 모델 업로드 (multipart) |
| `DELETE` | `/api/models/:id` | 전역 모델 삭제 |
| `GET` | `/api/boxes/:boxId/channels/:channelId/vision-ai/models` | 채널 활성 모델 슬롯 목록 |
| `POST` | `/api/boxes/:boxId/channels/:channelId/vision-ai/models` | 채널 모델 슬롯 추가 |
| `DELETE` | `/api/boxes/:boxId/channels/:channelId/vision-ai/models/:modelId` | 채널 모델 슬롯 제거 |

---

## 보안 고려사항

| 항목 | 요구사항 | 구현 방법 |
|------|----------|---------|
| VAPID 비밀키 | 서버 환경변수에만 보관, API 응답 노출 금지 | `VAPID_PRIVATE_KEY` 환경변수 |
| Telegram Bot 토큰 | 서버 환경변수에만 보관 | `TELEGRAM_BOT_TOKEN` 환경변수 |
| WebPush 구독 정보 | endpoint/p256dh/auth 원문 API 응답 노출 금지 | 저장만, 반환 시 마스킹 |
| SSE 인증 | EventSource는 Authorization 헤더 미지원 → 쿠키 기반 인증 | `requireAuth` 미들웨어 (쿠키 읽기) |
| 모델 업로드 검증 | 파일 확장자 및 크기 검증, 악성 파일 방지 | Zod 스키마 + Content-Type 검증 |
| OWASP A01 | 박스 소유권 검증 | `boxService.getBox(id)` 소유권 확인 |
| 자격증명 비노출 | detection 폴링 시 Box API Key/JWT 미노출 | 서버 사이드 폴링, 클라이언트 미노출 |

---

## 비기능 요구사항

| 항목 | 요구사항 |
|------|----------|
| 알림 전달 지연 | 이벤트 발생 → 사용자 수신 5초 이내 |
| Detection 폴링 간격 | 기본 3초 (결정사항 D3, 환경변수 `DETECTION_POLL_INTERVAL_MS`) |
| 폴링 타임아웃 | 채널당 Box API 호출 5초 |
| 알림 히스토리 보관 | 최근 1,000건 |
| 모델 업로드 크기 상한 | 100MB (결정사항 D7) |
| 오류 격리 | 개별 채널 폴링 실패 → 다른 채널 및 서버에 영향 없음 |
| 테스트 커버리지 | 새 코드 85% 이상 (TDD), BoxClient 수정 코드 DDD characterization 테스트 선행 |

---

## 범위 외 (Out of Scope)

- ROI 관리 UI 및 API (1차 제외, REQ-MODEL-009 Optional)
- WebRTC 시그널링 알림 채널 (별도 SPEC)
- 채널별 알림 필터링 규칙 (특정 채널만 알림 받기) — 후속 SPEC
- 알림 그룹화 및 디-중복화 (동일 이벤트 다중 발생 시 단일 알림) — 후속 SPEC
- 이메일 알림 채널 — 후속 SPEC
- 멀티테넌트: 다중 사용자 알림 격리 — 별도 SPEC (현재 단일 사용자 가정)

---

## 결정사항 (Open Decisions)

| ID | 결정 항목 | 권장안 | 근거 |
|----|----------|--------|------|
| D1 | SPEC 범위: 알림+모델 한 SPEC vs 분리 | **통합 유지 (SPEC-ALERTS-001)** | 알림 검출에 모델 슬롯 정보가 연동되므로 분리 시 의존성 복잡도 증가. 추후 ROI 등 확장 시 SPEC-ALERTS-002로 분리 |
| D2 | 폴링 전략 (P1/P2/P3) | **P3 권장 (백엔드 폴링 + 프론트 SSE)** | 단순성·신뢰성 최적. P1처럼 단일 백그라운드 워커가 detections 폴링 → DB 저장 → 활성 SSE 클라이언트 푸시 + WebPush/Telegram 디스패치 |
| D3 | 폴링 간격 | **3초 기본** | 5초 내 전달 목표 달성을 위해 3초 적절. 1초는 과도한 Box API 호출. 환경변수 `DETECTION_POLL_INTERVAL_MS` 로 조정 가능 |
| D4 | ROI 관리 UI | **1차 제외** | 채널 모델 슬롯 추가/제거까지만 구현. ROI 좌표 편집 UI는 별도 SPEC |
| D5 | Telegram Bot 토큰 관리 | **환경변수 (`TELEGRAM_BOT_TOKEN`)** | 단일 팀 운영 모델. Chat ID는 사용자별 `alert_destinations.config_json` 에 저장 |
| D6 | VAPID 키 관리 | **환경변수 (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT`)** | DB 저장 대비 단순. 앱 재시작 시 기존 구독 유효 |
| D7 | 모델 업로드 파일 크기 상한 | **100MB (기본값, 환경변수 `MODEL_UPLOAD_MAX_MB` 로 조정)** | 박스 측 실제 한도 미확인. 100MB 설정 후 실측 필요 |
