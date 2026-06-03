---
name: SPEC-ALERTS-001 M5 프론트엔드 UI 완료 현황
description: M5 프론트엔드 구현 완료 (178 tests pass, svelte-check 0 errors)
type: project
---

SPEC-ALERTS-001 M5 프론트엔드 UI 구현 완료 (2026-05-15).

**Why:** M1~M4 백엔드 완료 후 UI 계층 구현.

**How to apply:** SPEC-ALERTS-001 구현 완료 확인 시 참조.

## 생성 파일 목록

### Service Worker / lib
- `apps/web/static/sw.js` — push 이벤트 수신 → showNotification, notificationclick → openWindow
- `apps/web/src/lib/webpush.ts` — urlBase64ToUint8Array, subscribeWebPush, unsubscribeWebPush, getWebPushSubscription
- `apps/web/src/lib/alertStream.ts` — connectAlertStream, getBackoffDelay, parseAlertMessage (지수 백오프: 1→2→5→10→30s 상한)

### Components
- `apps/web/src/lib/components/alerts/AlertToast.svelte` — 8초 자동 닫힘, onDismiss props
- `apps/web/src/lib/components/alerts/AlertToastContainer.svelte` — SSE 연결 + 토스트 스택 (max 5)
- `apps/web/src/lib/components/channel/ChannelModelSlots.svelte` — 채널별 모델 할당/제거

### Routes
- `apps/web/src/routes/(app)/settings/alerts/+page.server.ts` + `+page.svelte` — 3채널 토글
- `apps/web/src/routes/(app)/alerts/+page.server.ts` + `+page.svelte` — 히스토리 + 페이지네이션
- `apps/web/src/routes/(app)/boxes/[id]/models/+page.server.ts` + `+page.svelte` — 모델 업로드/삭제

### 수정 파일
- `apps/web/src/routes/(app)/+layout.svelte` — 알림/알림설정 nav 링크 + AlertToastContainer 마운트
- `apps/web/src/lib/components/channel/ChannelRow.svelte` — ChannelModelSlots 통합 (모델 관리 버튼)
- `apps/web/src/routes/(app)/boxes/[id]/+page.svelte` — 모델 관리 링크 추가

### Tests (5개 신규)
- `src/__tests__/lib/webpush.test.ts` — urlBase64ToUint8Array 7개
- `src/__tests__/lib/alertStream.test.ts` — getBackoffDelay 7개 + parseAlertMessage 11개
- `src/__tests__/routes/alerts/page-server.test.ts` — 8개
- `src/__tests__/routes/settings/alerts-page-server.test.ts` — 8개
- `src/__tests__/routes/boxes/id/models-page-server.test.ts` — 9개

## 테스트 결과
- 178 pass, 0 fail (기존 144 + 신규 34)
- svelte-check: 0 errors, 0 warnings

## 주요 결정사항
- shadcn-svelte 미사용, 순수 Tailwind 적용 (기존 코드베이스 일치)
- +page.server.ts SvelteKit 의존 모듈은 직접 import 불가 → 로직 복제 패턴 적용
- VAPID key: urlBase64ToUint8Array 결과의 .buffer as ArrayBuffer 변환 필요 (TS strict 호환)
- models 페이지 로컬 상태: $derived 초기값 + $effect 초기화 패턴으로 경고 해소
