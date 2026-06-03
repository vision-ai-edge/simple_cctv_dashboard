---
name: SPEC-ALERTS-001 M1 완료 현황
description: SPEC-ALERTS-001 Milestone 1 구현 완료 — ModelListResponseSchema 수정 + DB 마이그레이션 0006 + Drizzle 스키마 + 마이그레이션 테스트
type: project
---

M1 완료 (커밋 미완료 상태 — 오케스트레이터가 커밋 처리).

**Why:** SPEC-ALERTS-001 알림 파이프라인 구축을 위한 데이터 레이어 기반 확보.
**How to apply:** M2 작업 시 detection_alerts / detection_cursor 테이블 활용 가능. ModelListResponseSchema는 envelope unwrap 완료.

## 완료된 작업

### M1-1 (DDD PRESERVE)
- `packages/shared/src/__tests__/client.test.ts` — ModelListResponseSchema characterization 테스트 3개 추가
- envelope 테스트가 RED → GREEN 사이클 확인 후 M1-2 적용

### M1-2 (DDD IMPROVE)
- `packages/shared/src/edgeai-box-client/types.ts` — ModelListResponseSchema를 z.preprocess로 수정
- `{ success, timestamp, models: [...] }` envelope 자동 unwrap + bare-array fallback
- ChannelListResponseSchema와 동일 패턴

### M1-3 (DB Migration)
- `packages/db/src/migrations/0006_alerts_and_models.sql` 생성
- 주의: SPEC 원본 `alerts` 테이블명은 기존 0001_init.sql과 충돌 — `detection_alerts`로 변경

### M1-4 (Drizzle Schema)
- `packages/db/src/schema.ts` — 4개 테이블 Drizzle 정의 추가:
  - `webpushSubscriptions` → 테이블명 `webpush_subscriptions`
  - `alertDestinations` → 테이블명 `alert_destinations`
  - `detectionAlerts` → 테이블명 `detection_alerts` (SPEC 원본과 다름)
  - `detectionCursor` → 테이블명 `detection_cursor`

### M1-5 (Migration Tests)
- `packages/db/src/__tests__/migration-0006.test.ts` — 20개 통합 테스트 추가

## 테스트 결과
- shared: 66 → 69 (+ 3 신규)
- db: 28 → 48 (+ 20 신규)
- 기존 테스트 전량 통과

## 핵심 결정 사항
- `alerts` 테이블명 충돌: 0001_init.sql에 camera_id 기반 구형 alerts 존재 → 신규 box_id 기반 테이블은 `detection_alerts`로 명명
- Drizzle 변수명도 `detectionAlerts`로 통일
