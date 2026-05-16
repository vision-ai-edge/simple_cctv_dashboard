<!-- TAG: ALERTS-001 -->
# SPEC-ALERTS-001 구현 계획

## 전제 조건

- SPEC-BOX-CHANNELS-001 PR #7 main 브랜치 머지 완료
- `cameras` 테이블, BoxClient `client.visionAi.*`, `client.models.*` 사용 가능
- `requireAuth` 미들웨어, AES-GCM 볼트, `withAuthRetry` 사용 가능

---

## 개발 방법론

| 코드 유형 | 방법론 | 사이클 |
|-----------|--------|--------|
| 신규 서비스/라우트/컴포넌트 | TDD | Red → Green → Refactor |
| `ModelListResponseSchema` 수정 (기존 코드) | DDD | Characterization Test → PRESERVE → IMPROVE |
| DB 마이그레이션 | TDD | 마이그레이션 파일 작성 → 적용 테스트 |

---

## 마일스톤

### M1: 데이터 기반 구축 (DB 마이그레이션 + BoxClient 버그 수정)

**목표**: 구현에 필요한 데이터 레이어와 클라이언트 정합성 확보

**작업**:
- M1-1: `ModelListResponseSchema` characterization 테스트 작성 (DDD PRESERVE)
- M1-2: `ModelListResponseSchema` envelope 버그 수정 (`{ success, models: [...] }` unwrap)
- M1-3: DB 마이그레이션 0006 작성 및 적용 (4개 신규 테이블)
  - `webpush_subscriptions`, `alert_destinations`, `alerts`, `detection_cursor`
- M1-4: Drizzle ORM 스키마 및 타입 정의 추가
- M1-5: 마이그레이션 통합 테스트

**완료 기준**: 기존 361개 테스트 전량 통과 + 마이그레이션 테스트 통과

---

### M2: Detection 폴링 워커 + 알림 디스패처

**목표**: AI 검출 이벤트 → DB 저장 → SSE/WebPush/Telegram 파이프라인

**작업**:
- M2-1: `detectionPoller.ts` 서비스 (TDD)
  - 활성 박스·채널 조회 → `visionAi.getDetections()` 호출
  - `detection_cursor` 기반 신규 이벤트 필터링
  - `alerts` 테이블 저장 + 히스토리 1,000건 트리밍
  - 오류 격리 (채널 단위 try/catch)
- M2-2: `alertDispatcher.ts` 서비스 (TDD)
  - SSE 클라이언트 레지스트리 관리
  - WebPush `web-push` 라이브러리 통합 (VAPID 설정)
  - Telegram `sendMessage` HTTP 호출
- M2-3: `detectionPoller` 서버 시작 시 부팅, 셧다운 훅 등록
- M2-4: 환경변수 검증 (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT`, `TELEGRAM_BOT_TOKEN`)

**완료 기준**: 단위 테스트 85%+, detection 이벤트 → DB 저장 통합 테스트 통과

---

### M3: 알림 API 라우트 (백엔드)

**목표**: 알림 스트림, 설정, WebPush 구독, 히스토리 API

**작업**:
- M3-1: `GET /api/alerts/stream` — Hono SSE 라우트 (TDD)
  - `requireAuth` 미들웨어 적용
  - SSE 연결 생성 → 디스패처 레지스트리 등록
  - 연결 종료 시 레지스트리에서 제거
- M3-2: `GET /api/alerts` — 히스토리 목록 (limit/offset 페이지네이션)
- M3-3: WebPush 구독 엔드포인트
  - `GET /api/alerts/webpush/vapid-public-key`
  - `POST /api/alerts/webpush/subscribe`
  - `DELETE /api/alerts/webpush/subscribe`
- M3-4: 알림 설정 CRUD
  - `GET /api/alerts/destinations`
  - `PUT /api/alerts/destinations/:channel`

**완료 기준**: API 단위 테스트 85%+, SSE 스트림 통합 테스트 통과

---

### M4: 모델 관리 API 라우트 (백엔드)

**목표**: 전역 모델 CRUD + 채널별 모델 슬롯 관리 API

**작업**:
- M4-1: 전역 모델 라우트 (TDD)
  - `GET /api/models` — 목록 조회
  - `POST /api/models` — 업로드 (multipart, 100MB 상한)
  - `DELETE /api/models/:id` — 삭제
- M4-2: 채널별 모델 슬롯 라우트 (TDD)
  - `GET /api/boxes/:boxId/channels/:channelId/vision-ai/models`
  - `POST /api/boxes/:boxId/channels/:channelId/vision-ai/models`
  - `DELETE /api/boxes/:boxId/channels/:channelId/vision-ai/models/:modelId`
- M4-3: 박스 소유권 검증 미들웨어 재사용
- M4-4: Zod 입력 검증 스키마 정의

**완료 기준**: 모델 API 단위 테스트 85%+

---

### M5: 프론트엔드 UI

**목표**: 알림 설정, 히스토리, 토스트, 모델 관리 화면

**작업**:
- M5-1: Service Worker 등록 및 WebPush 구독 로직
  - `apps/web/static/sw.js` — push event 수신 → Notification 표시
  - `lib/webpush.ts` — 구독 등록/해제 유틸
- M5-2: SSE 클라이언트 + 토스트 연동
  - `lib/alertStream.ts` — EventSource 연결, 재연결 로직
  - 토스트 컴포넌트 (shadcn-svelte Toast 재사용)
- M5-3: 알림 설정 페이지 (`/settings/alerts`)
  - toast/webpush/telegram 각 채널 on/off 토글
  - Telegram Chat ID 입력 폼
  - WebPush 브라우저 권한 요청 흐름
- M5-4: 알림 히스토리 페이지 또는 사이드 패널 (`/alerts`)
- M5-5: 모델 관리 페이지 (`/models`)
  - 전역 모델 목록 + 업로드 폼 + 삭제 버튼
- M5-6: 채널 상세 섹션 내 모델 슬롯 UI (Box 상세 → 채널 행 확장)

**완료 기준**: 컴포넌트 단위 테스트 85%+, 수동 브라우저 검증 (토스트/WebPush/Telegram)

---

## 기술 접근 방식

### 알림 파이프라인 (P3: 백엔드 폴링 + SSE)

```
[detectionPoller] ─→ GET /channels/{id}/vision-ai/detections (Box API, 3초 간격)
        │
        ├─→ detection_cursor 비교 (신규 이벤트만)
        │
        ├─→ alerts 테이블 저장
        │
        └─→ alertDispatcher.dispatch(alert)
                ├─→ SSE 브로드캐스트 (활성 연결 사용자)
                ├─→ WebPush 발송 (web-push 라이브러리, VAPID)
                └─→ Telegram sendMessage (fetch, Bot API)
```

### ModelListResponseSchema DDD 수정 패턴

```typescript
// PRESERVE (characterization test) 먼저 작성:
// 현재 동작: z.array(ModelInfoSchema) — envelope 미처리
// 수정 후: ChannelListResponseSchema 패턴 동일하게 preprocess 적용

export const ModelListResponseSchema = z.preprocess((val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.models)) return obj.models;
  }
  return val;
}, z.array(ModelInfoSchema));
```

### Service Worker 구조

```
apps/web/static/
└── sw.js          # push 이벤트 수신 → self.registration.showNotification()
```

### 환경변수 추가 목록

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `DETECTION_POLL_INTERVAL_MS` | 선택 | 기본 3000ms |
| `DETECTION_POLL_TIMEOUT_MS` | 선택 | 기본 5000ms |
| `TELEGRAM_BOT_TOKEN` | 선택 | 미설정 시 Telegram 알림 비활성 |
| `VAPID_PUBLIC_KEY` | 선택 | 미설정 시 WebPush 비활성 |
| `VAPID_PRIVATE_KEY` | 선택 | 미설정 시 WebPush 비활성 |
| `VAPID_CONTACT` | 선택 | `mailto:…` 또는 URL |
| `MODEL_UPLOAD_MAX_MB` | 선택 | 기본 100 |

### 신규 의존성

| 패키지 | 위치 | 용도 |
|--------|------|------|
| `web-push` | `apps/api` | WebPush 발송 (VAPID 서명) |

---

## 위험 및 완화 방안

| 위험 | 심각도 | 완화 방안 |
|------|--------|---------|
| Box 측 detection API 응답 형식 불일치 | 중간 | A3 가정 기반. types.ts 수정 시 Zod passthrough로 미지 필드 허용 |
| WebPush 구독 만료 410 미처리 | 높음 | 410 응답 시 구독 자동 삭제 (REQ-ALERT-006) |
| SSE 동시 연결 과다 | 낮음 | 레지스트리 기반 연결 수 모니터링, MVP는 단일 사용자 |
| Telegram API 레이트 리미팅 | 낮음 | 초당 30건 한도. 이벤트 폭발 시 큐 또는 디바운스 고려 (후속) |
| 모델 업로드 100MB Bun 메모리 | 중간 | Hono multipart streaming 사용. Bun request body 크기 설정 확인 |

---

## 결정 사항 (2026-05-16 사용자 확정)

| ID | 결정 항목 | 확정 |
|----|----------|------|
| D1 | SPEC 범위 | **통합 유지** — 알림 + 모델 관리를 단일 SPEC-ALERTS-001 로 처리 |
| D2 | 폴링 전략 | **P3** — 백엔드 워커 폴링 + 프론트 SSE 푸시 |
| D3 | 폴링 간격 | **3초** (환경변수 `DETECTION_POLL_INTERVAL_MS` 로 조정 가능, 기본 3000) |
| D4 | ROI 관리 UI | **1차 제외** — 채널 모델 슬롯 추가/제거까지만 |
| D5 | Telegram Bot 토큰 | **환경변수** `TELEGRAM_BOT_TOKEN` (사용자별 chat_id 는 alert_destinations.config_json) |
| D6 | VAPID 키 | **환경변수** `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` |
| D7 | 모델 업로드 크기 상한 | **100MB** (환경변수 `MODEL_UPLOAD_MAX_MB` 로 조정 가능). 박스 측 실측 한도 확인 시 재조정 |

> 구현 의존성: 본 SPEC 의 일부 UI 작업(REQ-ALERT-XXX 토스트 통합)은 SPEC-DASHBOARD-001 (PR #7) 의 머지 후 main rebase 를 받아 진행한다. M1~M4 백엔드 작업은 dashboard 의존성 없이 선행 가능.
