<!-- TAG: ALERTS-001 -->
# SPEC-ALERTS-001 인수 기준 (Acceptance Criteria)

## REQ ↔ AC 추적 매트릭스

| REQ ID | AC ID | 설명 |
|--------|-------|------|
| REQ-ALERT-001 | AC-A01, AC-A02 | Detection 폴링 워커 동작 |
| REQ-ALERT-002 | AC-A03, AC-A04 | 신규 이벤트 감지 및 중복 방지 |
| REQ-ALERT-003 | AC-A05, AC-A06 | 알림 DB 저장 |
| REQ-ALERT-004 | AC-A07, AC-A08 | In-dashboard 토스트 SSE |
| REQ-ALERT-005 | AC-A09, AC-A10 | WebPush 구독 관리 |
| REQ-ALERT-006 | AC-A11, AC-A12 | WebPush 알림 발송 |
| REQ-ALERT-007 | AC-A13, AC-A14 | Telegram Bot 알림 발송 |
| REQ-ALERT-008 | AC-A15, AC-A16 | 알림 설정 UI |
| REQ-ALERT-009 | AC-A17, AC-A18 | 알림 히스토리 조회 |
| REQ-ALERT-010 | AC-A19 | 알림 전달 지연 목표 |
| REQ-MODEL-001 | AC-M01, AC-M02 | ModelListResponseSchema 수정 |
| REQ-MODEL-002 | AC-M03 | 전역 모델 목록 조회 |
| REQ-MODEL-003 | AC-M04, AC-M05 | 전역 모델 업로드 |
| REQ-MODEL-004 | AC-M06, AC-M07 | 전역 모델 삭제 |
| REQ-MODEL-005 | AC-M08 | 채널 모델 슬롯 조회 |
| REQ-MODEL-006 | AC-M09 | 채널 모델 슬롯 추가 |
| REQ-MODEL-007 | AC-M10 | 채널 모델 슬롯 제거 |
| REQ-MODEL-008 | AC-M11, AC-M12 | 모델 관리 UI |

---

## Area A: AI 검출 이벤트 알림

### AC-A01: Detection 폴링 — 활성 채널만 폴링

```gherkin
Given 활성 박스(status='active')가 1개 있고
  And 활성 채널(status='online')이 2개, 비활성 채널(status='offline')이 1개 있고
  And DETECTION_POLL_INTERVAL_MS=100 으로 설정된 경우
When detectionPoller 가 1 폴링 사이클을 실행하면
Then BoxClient.visionAi.getDetections 는 활성 채널 2개에 대해서만 호출되어야 한다
  And 비활성 채널에는 호출되지 않아야 한다
```

### AC-A02: Detection 폴링 — 비활성·오류 박스 건너뜀

```gherkin
Given 박스 A(status='active'), 박스 B(status='error'), 박스 C(status='inactive') 가 있을 때
When detectionPoller 가 1 폴링 사이클을 실행하면
Then 박스 A의 채널만 폴링되어야 한다
  And 박스 B, C의 채널은 폴링되지 않아야 한다
```

### AC-A03: 신규 이벤트 감지 — 커서 이후만 처리

```gherkin
Given detection_cursor 에 box_id='B1', channel_id='C1', last_seen_timestamp=1000 이 저장되어 있고
  And Box API 응답에 timestamp=900, 1000, 1100, 1200 인 이벤트가 있을 때
When 폴링 워커가 이벤트를 처리하면
Then timestamp=1100, 1200 인 이벤트만 신규로 처리되어야 한다
  And detection_cursor.last_seen_timestamp 가 1200 으로 갱신되어야 한다
```

### AC-A04: 중복 이벤트 방지 — 동일 채널 동시 폴링 불가

```gherkin
Given 채널 C1에 대한 폴링이 진행 중인 경우
When 다음 폴링 사이클이 시작되면
Then 채널 C1에 대한 새 폴링은 시작되지 않아야 한다
  And 다른 채널의 폴링은 정상 진행되어야 한다
```

### AC-A05: 알림 DB 저장 — 정상 저장

```gherkin
Given 신규 detection 이벤트 { type: 'intrusion', channelId: 'C1' } 가 감지된 경우
When 폴링 워커가 이를 처리하면
Then alerts 테이블에 { type='intrusion', status='new', box_id, channel_id } 레코드가 저장되어야 한다
  And fired_at 은 detection 이벤트의 타임스탬프와 일치해야 한다
```

### AC-A06: 알림 히스토리 1,000건 제한

```gherkin
Given alerts 테이블에 이미 1,000건이 저장되어 있고
When 신규 이벤트 1건이 추가되면
Then alerts 테이블 총 건수는 1,000건으로 유지되어야 한다
  And 가장 오래된 레코드 1건이 삭제되어야 한다
```

### AC-A07: SSE 스트림 — 인증된 사용자에게 알림 전달

```gherkin
Given 인증된 사용자가 GET /api/alerts/stream 에 SSE 연결을 맺고
  And alert_destinations.channel='toast', enabled=1 로 설정된 경우
When 신규 detection 이벤트가 발생하면
Then SSE 스트림으로 { id, type, channelId, boxId, firedAt, payload } 형식의 이벤트가 전달되어야 한다
```

### AC-A08: SSE 스트림 — 미인증 요청 거부

```gherkin
Given 인증 쿠키 없이 GET /api/alerts/stream 에 요청하면
Then 401 Unauthorized 응답을 반환해야 한다
  And SSE 연결이 맺어지지 않아야 한다
```

### AC-A09: WebPush 구독 등록

```gherkin
Given 인증된 사용자가 브라우저 Push Subscription 객체를 보유하고
When POST /api/alerts/webpush/subscribe 를 { endpoint, keys: { p256dh, auth } } 본문으로 요청하면
Then 201 응답을 반환해야 한다
  And webpush_subscriptions 테이블에 해당 구독이 저장되어야 한다
  And 응답 본문에 endpoint, p256dh, auth 원문이 포함되지 않아야 한다
```

### AC-A10: WebPush 구독 해제

```gherkin
Given 사용자가 WebPush 구독을 보유하고 있을 때
When DELETE /api/alerts/webpush/subscribe 를 요청하면
Then 200 응답을 반환해야 한다
  And webpush_subscriptions 테이블에서 해당 구독이 삭제되어야 한다
```

### AC-A11: WebPush 알림 발송 — 정상 발송

```gherkin
Given 사용자의 alert_destinations.channel='webpush', enabled=1 이고
  And webpush_subscriptions 에 유효한 구독 1건이 있을 때
When 신규 detection 이벤트가 발생하면
Then web-push 라이브러리를 통해 해당 구독 endpoint로 알림이 발송되어야 한다
  And 페이로드는 { title, body, icon, data: { alertId, type, channelId } } 형식이어야 한다
```

### AC-A12: WebPush 구독 만료(410) 자동 삭제

```gherkin
Given 사용자의 WebPush 구독 엔드포인트가 만료(410 Gone)된 경우
When 알림 발송을 시도하면
Then webpush_subscriptions 테이블에서 해당 구독이 삭제되어야 한다
  And 서버 오류(5xx)로 처리되지 않아야 한다
```

### AC-A13: Telegram 알림 발송 — 정상 발송

```gherkin
Given TELEGRAM_BOT_TOKEN 환경변수가 설정되어 있고
  And 사용자의 alert_destinations.channel='telegram', enabled=1, config_json.chat_id='12345' 인 경우
When 신규 detection 이벤트가 발생하면
Then Telegram Bot API sendMessage 가 chat_id='12345' 로 호출되어야 한다
  And 메시지는 '[카메라명] {type} 이벤트 감지 — {datetime}' 형식이어야 한다
```

### AC-A14: Telegram Bot 토큰 미설정 시 무시

```gherkin
Given TELEGRAM_BOT_TOKEN 환경변수가 설정되지 않은 경우
When 신규 detection 이벤트가 발생하면
Then Telegram API 호출 시도가 없어야 한다
  And 서버는 5xx 오류를 반환하지 않아야 한다
  And WARNING 레벨 로그만 기록되어야 한다
```

### AC-A15: 알림 설정 UI — 채널별 on/off

```gherkin
Given 사용자가 /settings/alerts 페이지에 접속한 경우
When 토스트 토글을 끄면
Then PUT /api/alerts/destinations/toast { enabled: false } 요청이 전송되어야 한다
  And UI에서 토스트 토글이 비활성화 상태로 표시되어야 한다
```

### AC-A16: 알림 설정 UI — Telegram Chat ID 입력

```gherkin
Given 사용자가 Telegram 채널을 활성화하면
When Chat ID 입력 필드에 '12345' 를 입력하고 저장하면
Then PUT /api/alerts/destinations/telegram { enabled: true, config: { chat_id: '12345' } } 요청이 전송되어야 한다
```

### AC-A17: 알림 히스토리 API

```gherkin
Given alerts 테이블에 10건의 알림이 있을 때
When GET /api/alerts?limit=5&offset=0 을 요청하면
Then 200 응답과 함께 최신순 5건이 반환되어야 한다
  And 각 항목에는 { id, type, channelId, boxId, firedAt, status, payload } 가 포함되어야 한다
```

### AC-A18: 알림 히스토리 UI

```gherkin
Given /alerts 페이지에 접속한 경우
When 페이지가 로드되면
Then 알림 히스토리 목록이 표시되어야 한다
  And 각 항목에 이벤트 유형, 채널명, 발생 시각이 표시되어야 한다
```

### AC-A19: 알림 전달 지연 — 5초 이내

```gherkin
Given DETECTION_POLL_INTERVAL_MS=3000 이고
  And SSE 연결이 활성화된 경우
When EdgeAI Box 에서 새 detection 이벤트가 발생하면
Then 최악의 경우 (폴링 직후 이벤트 발생) 약 3초 + 처리 시간 이내에 SSE 이벤트가 전달되어야 한다
  And 평균 전달 지연은 5초 미만이어야 한다
```

---

## Area B: AI 모델 관리

### AC-M01: ModelListResponseSchema — Characterization 테스트 (DDD PRESERVE)

```gherkin
Given types.ts 의 현재 ModelListResponseSchema 코드가 z.array(ModelInfoSchema) 로 정의된 경우
When 실제 Box API 응답 형식 { success: true, models: [...] } 을 파싱하면
Then 현재 코드는 실패하고 (버그 확인)
  And 수정 후에는 models 배열을 올바르게 파싱해야 한다
  And 기존 array 형식 입력도 그대로 통과해야 한다 (하위 호환)
```

### AC-M02: ModelListResponseSchema — 수정 후 동작

```gherkin
Given 수정된 ModelListResponseSchema 가 적용된 경우
When BoxClient.models.list() 를 호출하면
Then { success: true, models: [{ id, name, ... }] } 응답을 올바르게 파싱하여 ModelInfo[] 를 반환해야 한다
  And 직접 array 형식의 응답도 파싱해야 한다 (하위 호환)
```

### AC-M03: 전역 모델 목록 조회

```gherkin
Given 인증된 사용자가 있을 때
When GET /api/models 를 요청하면
Then 200 응답과 함께 { models: [{ id, name, type, task, fileSize, isBuiltIn }] } 형식의 응답을 반환해야 한다
  And BoxClient.models.list() 가 호출되어야 한다
```

### AC-M04: 전역 모델 업로드 — 정상 업로드

```gherkin
Given 인증된 사용자가 modelFile(50MB)과 metadataFile을 준비한 경우
When POST /api/models 를 multipart/form-data 로 요청하면
Then 201 응답이 반환되어야 한다
  And BoxClient.models.upload() 가 해당 파일들로 호출되어야 한다
```

### AC-M05: 전역 모델 업로드 — 크기 초과

```gherkin
Given MODEL_UPLOAD_MAX_MB=100 으로 설정된 경우
When 101MB 파일로 POST /api/models 를 요청하면
Then 413 Payload Too Large 응답이 반환되어야 한다
  And BoxClient.models.upload() 는 호출되지 않아야 한다
```

### AC-M06: 전역 모델 삭제 — 확인 후 삭제

```gherkin
Given 인증된 사용자가 모델 삭제 버튼을 클릭하고
When 확인 다이얼로그에서 '삭제' 를 선택하면
Then DELETE /api/models/:id 요청이 전송되어야 한다
  And BoxClient.models.delete(id) 가 호출되어야 한다
  And 모델 목록에서 해당 모델이 제거되어야 한다
```

### AC-M07: 전역 모델 삭제 — 확인 없이 취소

```gherkin
Given 사용자가 모델 삭제 버튼을 클릭하고
When 확인 다이얼로그에서 '취소' 를 선택하면
Then DELETE API 요청이 전송되지 않아야 한다
  And 모델 목록이 변경되지 않아야 한다
```

### AC-M08: 채널 활성 모델 슬롯 조회

```gherkin
Given 인증된 사용자가 있고 박스 소유권이 확인된 경우
When GET /api/boxes/:boxId/channels/:channelId/vision-ai/models 를 요청하면
Then 200 응답과 함께 { models: [{ modelId, enabled, ... }] } 형식의 응답을 반환해야 한다
  And BoxClient.visionAi.getChannelModels(channelId) 가 호출되어야 한다
```

### AC-M09: 채널 모델 슬롯 추가

```gherkin
Given 인증된 사용자가 채널에 모델을 추가하려 할 때
When POST /api/boxes/:boxId/channels/:channelId/vision-ai/models 를 { modelId, enabled: true } 본문으로 요청하면
Then 201 응답이 반환되어야 한다
  And BoxClient.visionAi.addChannelModel(channelId, { modelId, enabled }) 가 호출되어야 한다
```

### AC-M10: 채널 모델 슬롯 제거

```gherkin
Given 인증된 사용자가 채널에서 모델을 제거하려 할 때
When DELETE /api/boxes/:boxId/channels/:channelId/vision-ai/models/:modelId 를 요청하면
Then 200 응답이 반환되어야 한다
  And BoxClient.visionAi.removeChannelModel(channelId, modelId) 가 호출되어야 한다
```

### AC-M11: 모델 관리 페이지 — 목록 및 업로드

```gherkin
Given 인증된 사용자가 /models 페이지에 접속한 경우
When 페이지가 로드되면
Then 전역 모델 목록이 표시되어야 한다
  And 모델 업로드 폼(modelFile, metadataFile)이 표시되어야 한다
  And 각 모델에 삭제 버튼이 표시되어야 한다
```

### AC-M12: 채널 상세 내 모델 슬롯 UI

```gherkin
Given 사용자가 Box 상세 페이지의 채널 행을 확장하면
When 해당 채널의 모델 슬롯 섹션이 표시될 때
Then 현재 활성화된 모델 슬롯 목록이 표시되어야 한다
  And 전역 모델 목록에서 모델을 선택하여 추가할 수 있어야 한다
  And 각 슬롯에 제거 버튼이 표시되어야 한다
```

---

## 품질 게이트 (Definition of Done)

| 항목 | 기준 |
|------|------|
| 테스트 커버리지 | 새 코드 85% 이상 (vitest + c8) |
| TypeScript | strict 모드, 타입 오류 0건 |
| Biome / ESLint | 린트 오류 0건 |
| 기존 테스트 | 361건 전량 통과 (회귀 없음) |
| 보안 | VAPID 비밀키·Bot 토큰 API 응답 미노출 확인 |
| 수동 검증 | 브라우저 토스트, WebPush, Telegram 알림 수신 확인 |
| DB 마이그레이션 | 마이그레이션 0006 적용 후 기존 데이터 무결성 확인 |
| 알림 지연 | 실측 5초 이내 (3초 폴링 기준) |
