<!-- TAG: BOX-CHANNELS-001 -->

# SPEC-BOX-CHANNELS-001 인수 테스트 기준

## 형식 규약

- **Given**: 전제 조건 (시스템 상태)
- **When**: 트리거 이벤트 (사용자 행동 또는 시스템 이벤트)
- **Then**: 기대 결과 (검증 항목)

---

## 골든 패스 시나리오

### AC-001: Box 등록 직후 채널 자동 동기화

```
Given: Box가 등록되어 있지 않은 상태
  And: EdgeAI Box가 정상 동작 중이며 채널 3개를 반환한다
When: 사용자가 POST /api/boxes 로 신규 Box를 등록한다
Then: 응답 상태는 201이다
  And: 응답 본문에 채널 동기화 결과가 포함되지 않는다 (fire-and-forget)
  And: 백그라운드에서 channelSyncService.syncChannelsForBox 가 1회 호출된다
  And: cameras 테이블에 해당 box_id의 레코드 3개가 생성된다
  And: 각 레코드의 last_synced_at 이 현재 시각이다
  And: 각 레코드의 sync_error 가 NULL이다
```

### AC-002: Box 상세 페이지 진입 시 Lazy 동기화 (캐시 미스)

```
Given: Box가 등록되어 있고 채널 last_synced_at 이 40초 전이다
  And: EdgeAI Box가 정상 동작 중이다
When: 사용자가 /boxes/[id] 페이지에 진입한다
Then: 서버 로드 함수가 채널 동기화를 1회 실행한다 (TTL 30초 초과)
  And: cameras 테이블의 last_synced_at 이 현재 시각으로 갱신된다
  And: 페이지에 최신 채널 목록이 표시된다
```

### AC-003: Box 상세 페이지 진입 시 Lazy 동기화 (캐시 히트)

```
Given: Box가 등록되어 있고 채널 last_synced_at 이 10초 전이다
When: 사용자가 /boxes/[id] 페이지에 진입한다
Then: 서버 로드 함수가 채널 동기화를 실행하지 않는다 (TTL 30초 이내)
  And: 기존 DB 데이터로 채널 목록이 표시된다
  And: EdgeAI Box API 호출이 발생하지 않는다
```

### AC-004: 수동 채널 동기화 성공

```
Given: 사용자가 /boxes/[id] 페이지에 있다
  And: EdgeAI Box가 정상 동작 중이며 채널 5개를 반환한다
When: 사용자가 "채널 동기화" 버튼을 클릭한다
Then: POST /api/boxes/:id/channels/sync 가 호출된다
  And: 응답 { success: true, synced: 5, failed: 0, timestamp: ... } 가 반환된다
  And: 채널 목록 UI가 최신 데이터로 갱신된다
  And: 동기화 버튼이 로딩 상태로 전환되었다가 완료 후 복원된다
```

### AC-005: 채널 활성화 토글 — Optimistic UI 성공

```
Given: 채널 상태가 STOPPED (CameraStatus: offline) 인 채널이 존재한다
When: 사용자가 해당 채널의 "활성화" 토글을 클릭한다
Then: 클릭 즉시 UI의 채널 상태 배지가 "활성화 중..." 또는 online 으로 낙관적 전환된다
  And: POST /api/boxes/:boxId/channels/:channelId/start 가 호출된다
  And: API 성공 시 최종 UI 상태가 유지된다
  And: 토글이 진행 중인 동안 동일 채널의 토글 버튼이 비활성화된다
  [캡처 필요] 활성화 토글 전/후 채널 상태 배지 변경 화면
```

### AC-006: 채널 비활성화 토글 — Optimistic UI 실패 롤백

```
Given: 채널 상태가 RUNNING (CameraStatus: online) 인 채널이 존재한다
  And: EdgeAI Box가 stop 요청에 502 오류를 반환하도록 설정되어 있다
When: 사용자가 해당 채널의 "비활성화" 토글을 클릭한다
Then: 클릭 즉시 UI의 채널 상태 배지가 낙관적으로 offline 으로 전환된다
  And: API 실패 후 채널 상태 배지가 원래 online 으로 롤백된다
  And: 에러 메시지(예: "채널 비활성화에 실패했습니다")가 표시된다
  [캡처 필요] 롤백 후 에러 메시지 및 복원된 상태 배지 화면
```

### AC-007: 스냅샷 캡처

```
Given: 채널이 존재하고 EdgeAI Box 스냅샷 API가 이미지를 반환한다
When: 사용자가 해당 채널의 "스냅샷" 버튼을 클릭한다
Then: GET /api/boxes/:boxId/channels/:channelId/snapshot 이 호출된다
  And: 응답은 Content-Type: image/* 형식이다
  And: 이미지가 채널 카드 내 인라인으로 표시되거나 다운로드된다
  And: 요청/응답에 EdgeAI Box API Key 또는 JWT 원문이 포함되지 않는다
  [캡처 필요] 스냅샷 표시 화면
```

### AC-008: HLS 인라인 프리뷰 (서버사이드 프록시)

```
Given: 채널 상태가 RUNNING (online) 이며 HLS 스트림이 제공된다
When: 사용자가 해당 채널의 "프리뷰" 버튼을 클릭한다
Then: hls.js 가 /api/boxes/:boxId/channels/:channelId/hls/playlist.m3u8 을 요청한다
  And: 서버가 Box HLS 엔드포인트에서 m3u8을 가져와 세그먼트 URL을 자체 도메인으로 재작성하여 반환한다
  And: video 엘리먼트가 인라인으로 표시되고 HLS 스트림 재생이 시작된다
  And: 클라이언트의 네트워크 요청 어디에도 box-host 도메인으로의 직접 요청이 없다
  [캡처 필요] HLS 프리뷰 video 엘리먼트 재생 화면
```

### AC-014: HLS 프록시 스트리밍 지연 검증

```
Given: 채널 상태가 RUNNING (online) 이며 HLS 스트림이 제공된다
  And: 서버와 EdgeAI Box 간 네트워크 지연이 정상 범위(< 50ms)이다
When: 사용자가 "프리뷰" 버튼을 클릭하여 HLS 프리뷰를 시작한다
Then: hls.js 가 최초 m3u8 플레이리스트를 수신하기까지 3초 이내여야 한다
  And: 첫 번째 세그먼트 데이터가 클라이언트에 도달하기까지 추가 5초 이내여야 한다
  And: 서버는 Box로부터 받은 세그먼트 바이트를 버퍼링 없이 청크 스트리밍(streaming)으로 클라이언트에 전달해야 한다
  And: 프리뷰 중 서버 메모리에 전체 세그먼트를 버퍼링하지 않아야 한다 (pipe/stream 방식 사용)
  [캡처 필요] 프리뷰 시작 후 첫 프레임 표시 시점 기록 화면
```

---

## 엣지 케이스 시나리오

### AC-009: Box 다운 시 동기화 실패

```
Given: Box가 등록되어 있으나 EdgeAI Box 서버가 응답하지 않는다 (타임아웃 10초)
When: 채널 동기화가 실행된다 (수동 또는 주기 폴링)
Then: cameras.last_synced_at 은 이전 성공 시각을 유지한다
  And: cameras.sync_error 에 오류 메시지가 기록된다 (예: "Connection timeout after 10000ms")
  And: 기존 카메라 레코드는 삭제되지 않고 유지된다
  And: 다른 Box의 동기화는 정상적으로 계속된다 (오류 격리)
  And: 서버 프로세스가 종료되지 않는다
```

### AC-010: Box API에서 채널이 삭제된 경우 동기화

```
Given: DB에 채널 A, B, C 가 존재한다 (box_id = X)
  And: EdgeAI Box API 는 채널 A, B 만 반환한다 (C가 삭제됨)
When: 채널 동기화가 실행된다
Then: 채널 A, B 는 정상 업데이트된다
  And: 채널 C 의 status 가 'offline' 으로 갱신된다 (하드 삭제 없음)
  And: 채널 C 의 last_synced_at 은 갱신되지 않는다
```

### AC-011: 동시 폴링 방지

```
Given: Box X 의 채널 동기화가 현재 진행 중이다 (10초 이상 소요 중)
When: 주기 폴러가 다시 Box X 의 동기화를 시작하려 한다
Then: 두 번째 동기화 시도는 건너뛴다 (뮤텍스 플래그 확인)
  And: 로그에 "Box X 동기화 진행 중, 건너뜀" 메시지가 기록된다
  And: 다른 Box Y, Z 의 동기화는 정상 진행된다
```

### AC-012: 토큰 만료 / 자격증명 오류

```
Given: cameras 테이블에 채널이 존재한다
  And: Box 의 저장된 JWT/API Key 가 만료되었거나 무효하다
When: 채널 동기화가 실행된다
Then: 시스템은 boxService.refreshTokens 를 통해 자격증명 갱신을 시도한다
  And: 갱신 실패 시 sync_error 에 "Authentication failed" 메시지를 기록한다
  And: Box status 가 'error' 로 갱신된다
```

### AC-015: HLS 프록시 — 클라이언트 네트워크에 apikey 미노출 (보안)

```
Given: 채널 상태가 RUNNING (online) 이며 HLS 스트림이 제공된다
  And: 브라우저 DevTools Network 탭이 열려 있다
When: 사용자가 "프리뷰" 버튼을 클릭하여 HLS 스트림을 재생한다
Then: Network 탭의 모든 요청 URL에 "apikey", "token", "jwt" 등의 자격증명 파라미터가 포함되지 않는다
  And: 모든 HLS 관련 요청의 대상 호스트가 대시보드 자체 도메인이다 (box-host 도메인 직접 요청 없음)
  And: Response Header 또는 Response Body에 EdgeAI Box API Key 또는 JWT 원문이 포함되지 않는다
  And: 브라우저 콘솔 로그에 자격증명 관련 문자열이 출력되지 않는다
  [캡처 필요] DevTools Network 탭 — 모든 HLS 요청이 /api/boxes/... 경로임을 확인하는 화면
```

### AC-013: 빈 채널 목록 UI

```
Given: Box 가 등록되어 있으나 cameras 테이블에 해당 box_id 의 레코드가 없다
When: 사용자가 /boxes/[id] 페이지의 채널 섹션을 확인한다
Then: "채널이 없습니다. 동기화 버튼을 눌러 채널을 가져오세요" 메시지가 표시된다
  And: "채널 동기화" 버튼이 표시된다
  [캡처 필요] 빈 채널 목록 상태 화면
```

---

## UI 검증 항목

| 검증 항목 | 기준 | 비고 |
|---|---|---|
| 채널 목록 섹션 위치 | Box 상세 페이지 내 인라인 섹션 | 별도 라우트 없음 |
| 상태 배지 색상 | online(녹색), offline(회색), error(적색) | SPEC-BOX-UI-001 배지 스타일 준수 |
| 토글 버튼 비활성화 | 진행 중 동안 disabled 상태 | Svelte 5 `$state` 기반 |
| 스냅샷 인라인 표시 | 채널 카드 내 img 엘리먼트 | 최대 너비 100% |
| HLS 프리뷰 비디오 | inline video 엘리먼트, controls 속성 | |
| 동기화 버튼 로딩 | 로딩 스피너 또는 텍스트 변경 | |
| sync_error 표시 | 채널 행에 툴팁 또는 에러 아이콘 | |
| 빈 채널 메시지 | 안내 텍스트 + 동기화 버튼 | |
| Tailwind 유틸리티 | shadcn-svelte 미사용, TailwindCSS 4.0 직접 사용 | SPEC-BOX-UI-001 준수 |

---

## 보안 검증 항목

| 검증 항목 | 기준 | OWASP |
|---|---|---|
| API Key / JWT 원문 미노출 | 모든 API 응답 및 클라이언트 측 JavaScript 소스에 원문 없음 | A01 접근 제어 |
| 스냅샷 프록시 자격증명 | `GET /api/boxes/:boxId/channels/:channelId/snapshot` 응답 헤더에 자격증명 없음 | A02 암호화 실패 |
| HLS 프록시 apikey 미노출 | 클라이언트 네트워크 요청(m3u8, 세그먼트) URL 및 헤더에 apikey/JWT 원문 없음 (AC-015 참조) | A02 암호화 실패 |
| 인증 미들웨어 | 모든 신규 엔드포인트에 `requireAuth` 적용 확인 (401 응답 테스트) | A01 |
| 입력 검증 | Zod 스키마 없이 채널 API 호출 시 400 응답 | A03 주입 |
| 비인증 접근 | 인증 없이 스냅샷/스트림 URL 엔드포인트 접근 시 401 반환 | A01 |
| OWASP A09 로깅 | `sync_error` 컬럼에 원시 자격증명이 로깅되지 않음 | A09 보안 로깅 |

---

## Definition of Done

모든 다음 항목을 충족해야 구현 완료로 간주한다:

- [ ] DB 마이그레이션 적용 완료 (last_synced_at, sync_error 컬럼 추가, 기존 데이터 보존)
- [ ] 신규 백엔드 엔드포인트 5개 정상 동작 (통합 테스트 통과)
- [ ] 채널 동기화 서비스 단위 테스트 85% 이상 커버리지
- [ ] 주기 폴링 스케줄러 단위 테스트 통과 (뮤텍스, 인터벌 클램핑)
- [ ] Box 상세 페이지 채널 섹션 렌더링 확인 (빈 상태, 정상 상태)
- [ ] 채널 토글 Optimistic UI + 롤백 동작 확인
- [ ] 스냅샷 인라인 표시 확인
- [ ] HLS 서버사이드 프록시 동작 확인 (m3u8 세그먼트 URL 재작성, 자격증명 미노출 — AC-014, AC-015)
- [ ] 보안 검증 항목 전항 통과
- [ ] 기존 테스트(SPEC-BOX-001, SPEC-BOX-UI-001 관련) 전량 통과
- [ ] Biome 린트 오류 0건
- [ ] TypeScript strict 오류 0건
