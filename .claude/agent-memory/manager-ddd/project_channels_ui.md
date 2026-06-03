---
name: SPEC-BOX-CHANNELS-001 채널 관리 UI 구현 현황
description: T5~T8 프론트엔드 구현 완료 상태 및 주요 결정사항
type: project
---

SPEC-BOX-CHANNELS-001 프론트엔드(T5~T8) 구현이 커밋 9b3749d으로 완료됨.

**Why:** 채널 동기화 백엔드(T1~T4, 커밋 3b86f21)와 분리하여 단일 커밋으로 관리.

**How to apply:** 이후 T9(통합 테스트), T10(PR 생성) 작업 시 이 커밋을 기준으로 진행.

주요 결정사항:
- ChannelDto 타입 위치: apps/web/src/lib/types/channel.ts (별도 파일로 분리)
- invalidate 전략: invalidateAll() (ChannelList.svelte 수동 동기화 후)
- $effect를 사용해 props 변경 시 Optimistic UI 로컬 상태 동기화
- hls.js 버전: ^1.6.16 (dependencies, not devDependencies)
- biome-ignore 주석 1건: ChannelPreview.svelte의 bind:this용 let videoEl
- SvelteKit API 라우트: INTERNAL_API_URL 직접 호출 (event.fetch 미사용 - hooks 재귀 방지)
