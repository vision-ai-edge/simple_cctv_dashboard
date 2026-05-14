# SPEC-BOX-CHANNELS-001 동기화 보고서

**작성일**: 2026-05-15  
**SPEC ID**: SPEC-BOX-CHANNELS-001  
**동기화 대상**: EdgeAI Box 채널 동기화 및 채널 관리 UI  
**브랜치**: feature/SPEC-BOX-CHANNELS-001

---

## 1. 구현 현황

### 1.1 구현 완료 범위

**백엔드 (Hono API, apps/api/)**
- `channelSyncService.ts`: 채널 동기화 비즈니스 로직
  - Box 채널 목록 조회 및 DB Upsert (박스 ID + 채널 ID 복합 유니크 키)
  - ChannelStatus → CameraStatus 변환 규칙 적용
  - 10초 타임아웃, 오류 격리
- `channels.ts` Hono 라우트: 5개 엔드포인트
  - `POST /api/boxes/:id/channels/sync` — 수동 동기화 트리거
  - `GET /api/boxes/:id/channels` — 채널 목록 조회 (DB 기반)
  - `POST /api/boxes/:boxId/channels/:channelId/start` — 채널 활성화
  - `POST /api/boxes/:boxId/channels/:channelId/stop` — 채널 비활성화
  - `GET /api/boxes/:boxId/channels/:channelId/snapshot` — 스냅샷 프록시
- `channelSyncPoller.ts`: 주기 폴링 스케줄러
  - `CHANNEL_SYNC_INTERVAL_MS` (기본 300000ms = 5분, 최소 30000ms 클램핑)
  - `CHANNEL_SYNC_CONCURRENCY` (기본 3, 동시 처리 Box 수 제한)
  - Set 기반 뮤텍스로 중복 폴링 방지
  - 개별 Box 동기화 실패 시 다른 Box 폴링 영향 없음
- DB 마이그레이션 0005
  - `last_synced_at` (INTEGER, nullable) — 마지막 동기화 성공 시각
  - `sync_error` (TEXT, nullable) — 마지막 동기화 실패 메시지
  - `(box_id, channel_id)` 복합 유니크 인덱스

**프론트엔드 (SvelteKit, apps/web/)**
- `ChannelList.svelte`: 채널 목록 섹션
  - 채널 이름, ID, 상태 배지, 마지막 동기화 시각 표시
  - 빈 목록 안내 메시지
- `ChannelRow.svelte`: 채널 행 컴포넌트
  - 활성/비활성 토글 버튼 (Optimistic UI + 실패 시 롤백)
  - 스냅샷 버튼
  - HLS 프리뷰 토글
- `ChannelPreview.svelte`: HLS 인라인 프리뷰
  - video 태그 + hls.js (dynamic import)
  - 자체 도메인 프록시 URL 사용 (자격증명 서버 주입)
- `lib/api/channels.ts`: API 클라이언트 함수 6개
  - sync, list, start, stop, snapshot, getHlsUrl
- `lib/types/channel.ts`: Channel, ChannelSyncResult 타입
- SvelteKit API 라우트 6개 (프록시)
  - `sync/+server.ts` — POST /api/boxes/:id/channels/sync 프록시
  - `[channelId]/start/+server.ts` — POST 활성화 프록시
  - `[channelId]/stop/+server.ts` — POST 비활성화 프록시
  - `[channelId]/snapshot/+server.ts` — GET 스냅샷 프록시
  - `[channelId]/hls/playlist.m3u8/+server.ts` — GET HLS m3u8 프록시 (세그먼트 URL 재작성)
  - `[channelId]/hls/segment/[name]/+server.ts` — GET HLS 세그먼트 프록시
- Box 상세 페이지 (`+page.svelte`)
  - 채널 섹션 추가 (ChannelList 컴포넌트 마운트)
- `+page.server.ts`
  - Lazy 동기화 트리거 (TTL 30초, last_synced_at 기준)
  - 채널 목록 로드

### 1.2 제외된 범위

- **WebRTC 시그널링 프록시** — 사용자 결정으로 별도 SPEC 분리
  - REQ-CHAN-007 Optional 부분

---

## 2. 파일 변경 분석 (Plan vs Actual)

### 2.1 예정된 파일 vs 실제 구현

| 파일 경로 | 예정 | 실제 | 상태 |
|---|---|---|---|
| `packages/db/src/migrations/0005_*.sql` | ✓ | ✓ | 완료 |
| `apps/api/src/services/channelSyncService.ts` | ✓ | ✓ | 완료 (313줄) |
| `apps/api/src/routes/channels.ts` | ✓ | ✓ | 완료 (541줄) |
| `apps/api/src/workers/channelSyncPoller.ts` | ✓ | ✓ | 완료 (219줄) |
| `apps/web/src/lib/components/ChannelList.svelte` | ✓ | ✓ | 완료 (134줄) |
| `apps/web/src/lib/components/ChannelRow.svelte` | ✓ | ✓ | 완료 (269줄) |
| `apps/web/src/lib/components/ChannelPreview.svelte` | ✓ | ✓ | 완료 (136줄) |
| SvelteKit API 라우트 6개 | ✓ | ✓ | 완료 |
| WebRTC 시그널링 프록시 | - | 제외 | 사용자 결정 |

### 2.2 부수 수정사항

1. `packages/shared/package.json`: `@cctv/shared/crypto/vault` subpath export 추가
   - SPEC-BOX-001부터 잠재했던 런타임 모듈 해석 오류 해소
2. `biome --fix --unsafe`: non-null assertion → optional chaining 자동 정리

### 2.3 추가된 의존성

- `hls.js@^1.6.16` — apps/web runtime dependency
  - ChannelPreview.svelte에서 dynamic import 사용

### 2.4 추가된 환경변수

- `CHANNEL_SYNC_INTERVAL_MS` (기본 300000ms)
- `CHANNEL_SYNC_CONCURRENCY` (기본 3)

---

## 3. Divergence 분석

### 3.1 계획 대비 실제 구현 차이

| 항목 | plan.md | 실제 | 비고 |
|---|---|---|---|
| channelSyncService 타임아웃 | 10초 | ✓ 10초 구현 | - |
| 폴러 기본 간격 | 5분 | ✓ 300000ms | - |
| 폴러 동시 처리 | 최대 3 | ✓ CHANNEL_SYNC_CONCURRENCY=3 | - |
| Lazy 동기화 TTL | 30초 | ✓ 30초 구현 | - |
| WebRTC 시그널링 프록시 | 예상 포함 | 제외됨 | 사용자 결정 (별도 SPEC 분리) |
| HLS 프록시 방식 | SvelteKit 서버 라우트 + 클라이언트 동기화 | ✓ 구현됨 | m3u8 + 세그먼트 재작성 |

### 3.2 추가 발견사항

1. **부수 모듈 해석 오류 해소**: @cctv/shared/crypto/vault subpath export가 추가되어 런타임 import 오류 완전 해소
2. **코드 정리**: biome --fix --unsafe로 non-null assertion 자동 정리 (타입 안전성 개선)

---

## 4. 갱신된 SPEC 문서

### 4.1 spec.md 변경사항

- **status**: draft → **completed**
- **version**: 0.2.0 → **0.3.0**
- **updated**: 2026-05-14 → **2026-05-15**
- **신규 섹션**: 구현 노트 (Implementation Notes)
  - 구현 완료 범위, 제외된 범위, 부수 수정사항, 추가 의존성/환경변수, 품질 검증 결과, 미해결 사항

### 4.2 프로젝트 문서 갱신

| 파일 | 변경 내용 |
|---|---|
| `tech.md` | hls.js 추가, 채널 동기화 워커 섹션 추가 |
| `structure.md` | 마이그레이션 0005, channelSyncService, channelSyncPoller, 채널 UI 컴포넌트, SvelteKit API 라우트 추가 |
| `product.md` | "7. EdgeAI Box 관리 및 채널 동기화" 섹션 갱신 |

---

## 5. 품질 검증 결과

### 5.1 테스트 현황

```
bun test: 361 pass / 0 fail / 28 test files
```

**신규 테스트 파일**
- `apps/api/src/services/__tests__/channelSyncService.test.ts` — Upsert 로직, 상태 변환, 타임아웃, 오류 격리
- `apps/api/src/routes/__tests__/channels.integration.test.ts` — 5개 엔드포인트 정상/오류 시나리오
- `apps/api/src/workers/__tests__/channelSyncPoller.test.ts` — 뮤텍스, 인터벌 클램핑, 스케줄러 시작/중지
- `apps/web/src/lib/api/__tests__/channels.test.ts` — API 클라이언트 함수
- `apps/web/src/lib/components/__tests__/channelBadge.test.ts` — 상태 배지
- `apps/web/src/routes/__tests__/id-page-server-channels.test.ts` — Lazy 동기화 로직

### 5.2 린트 및 타입 검사

```
Biome 린트: 0 errors
  (기존 box_vault.test.ts 코드 5 warnings는 본 SPEC 범위 외)

TypeScript strict: 0 errors
```

### 5.3 회귀 테스트

- SPEC-AUTH-001: ✓ 통과
- SPEC-BOX-001: ✓ 통과
- SPEC-BOX-UI-001: ✓ 통과

---

## 6. 구현 커밋 이력

```
9d5656e chore: biome --fix --unsafe 자동 정리 (SPEC-BOX-CHANNELS-001)
5177240 fix(shared): @cctv/shared/crypto/vault subpath export 추가 (SPEC-BOX-CHANNELS-001)
9b3749d feat(web): SPEC-BOX-CHANNELS-001 채널 관리 UI 구현 (T5~T8)
3b86f21 feat(channels): SPEC-BOX-CHANNELS-001 채널 동기화 백엔드 구현 (T1~T4)
```

---

## 7. 미해결 항목 및 후속 작업

### 7.1 코드 커밋 완료, DB 마이그레이션 수동 적용 필요

**현황**: 마이그레이션 파일(0005_add_camera_sync_columns.sql)은 코드 저장소에 커밋됨
**필요 조치**: 실제 DB 적용은 사용자 환경에서 수동으로 실행
```bash
# 사용자 환경에서 실행
bun --filter @cctv/db run migrate
```

### 7.2 수동 검증 필요

**UI 시나리오** (브라우저에서 테스트)
- AC-005: 채널 목록 표시 (Box 상세 페이지)
- AC-006: 채널 토글 (활성/비활성)
- AC-008: 스냅샷 버튼 클릭
- AC-007: HLS 프리뷰 로드 및 재생
- AC-009: 빈 채널 목록 메시지
- AC-010: 지연 동기화 (30초 TTL)

---

## 8. 사용자 결정 사항

| 항목 | 결정 | 사유 |
|---|---|---|
| WebRTC 시그널링 프록시 | 제외 (별도 SPEC 분리) | 초기 MVP 범위 최소화, HLS 프록시로 충분 |
| 주기 폴링 포함 | 포함 | 사용성 향상, 자동 갱신 필요 |

---

## 9. 배포 체크리스트

- [ ] DB 마이그레이션 실행 (`bun --filter @cctv/db run migrate`)
- [ ] 환경변수 설정 (`CHANNEL_SYNC_INTERVAL_MS`, `CHANNEL_SYNC_CONCURRENCY`)
- [ ] 브라우저 테스트 (채널 토글, 스냅샷, HLS 프리뷰)
- [ ] Vercel 또는 CI/CD 배포
- [ ] 모니터링: 폴러 로그, 채널 동기화 실패율

---

## 10. 다음 단계

**후속 SPEC**
- SPEC-MAP-001: 지도 기반 카메라 마커
- SPEC-LIVE-001: 전용 라이브 스트림 플레이어
- SPEC-ALERT-001: AI 검출 이벤트 알림
- SPEC-WEBRTC-001: WebRTC 시그널링 (선택사항)

**성능 최적화 (향후)**
- HLS 프록시 캐싱 레이어 (CDN 통합)
- 동시 프리뷰 수 제한 UI

---

**보고일**: 2026-05-15  
**상태**: ✓ SPEC 완료, 동기화 완료  
**다음 단계**: T12 (manager-git) — 커밋 메시지 작성 및 PR 생성
