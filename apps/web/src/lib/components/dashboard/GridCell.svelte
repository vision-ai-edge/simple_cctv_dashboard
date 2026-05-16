<script lang="ts">
// TAG: DASHBOARD-001
/**
 * GridCell 컴포넌트.
 *
 * 바둑판 멀티뷰의 단일 셀 — 카메라 선택 드롭다운 + HLS 재생.
 *
 * - 카메라 드롭다운: 전체 카메라 목록 표시, 온라인이 아닌 경우 경고 아이콘
 * - assignedCamera 변경 시: 기존 hls.js 인스턴스 즉시 destroy 후 재초기화
 * - HLS 오류: 이 셀 안에만 표시 (REQ-DASH-010), 다른 셀 영향 없음
 * - onDestroy: hls.js destroy + ref 정리 (메모리 누수 방지)
 *
 * ChannelPreview.svelte 의 dynamic import + cleanup 패턴을 준용한다.
 * hls.js DOM 렌더링 테스트는 jsdom 한계로 제외 (ChannelPreview 패턴 동일).
 *
 * REQ-DASH-007, REQ-DASH-009, REQ-DASH-010
 */

import type { CameraWithBox } from '$lib/types/dashboard';
import { onDestroy, onMount } from 'svelte';

const {
  cameras,
  assignedCamera,
  onAssign,
}: {
  cameras: CameraWithBox[];
  assignedCamera: CameraWithBox | null;
  onAssign: (camera: CameraWithBox | null) => void;
} = $props();

// ---------------------------------------------------------------------------
// 내부 상태
// ---------------------------------------------------------------------------

// biome-ignore lint/style/useConst: bind:this 가 필요한 let (Svelte 5 bind 요구사항)
let videoEl = $state<HTMLVideoElement | undefined>(undefined);

/** 현재 재생 중인 hls.js 인스턴스 (SSR-safe: 일반 let) */
let hlsInstance: { destroy(): void } | null = null;

/** HLS 로드 중 취소 플래그 (비동기 import 경쟁 방지) */
let cancelled = false;

let errorMessage = $state<string | null>(null);
let isLoading = $state(false);

// ---------------------------------------------------------------------------
// HLS lifecycle
// ---------------------------------------------------------------------------

/**
 * 현재 hls.js 인스턴스와 video 엘리먼트를 정리한다.
 * 카메라 변경 및 onDestroy 양쪽에서 호출한다.
 */
function destroyHls() {
  cancelled = true;
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  if (videoEl) {
    videoEl.pause();
    videoEl.src = '';
  }
}

/**
 * assignedCamera 에 맞춰 HLS 재생을 시작한다.
 * 이전 인스턴스를 먼저 파괴한 뒤 새로 초기화한다.
 */
async function initHls(camera: CameraWithBox) {
  if (!videoEl) return;

  // 이전 인스턴스 정리
  destroyHls();
  cancelled = false;

  errorMessage = null;
  isLoading = true;

  const video = videoEl;
  const playlistUrl = `/api/boxes/${camera.boxId}/channels/${camera.channelId}/hls/playlist.m3u8`;

  // Safari: native HLS
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = playlistUrl;
    video.load();
    isLoading = false;
    return;
  }

  // 그 외: hls.js dynamic import (SSR-safe — onMount 내에서만 호출됨)
  try {
    const { default: Hls } = await import('hls.js');

    if (cancelled) return;

    if (!Hls.isSupported()) {
      errorMessage = '이 브라우저는 HLS 재생을 지원하지 않습니다.';
      isLoading = false;
      return;
    }

    const hls = new Hls();
    hlsInstance = hls;

    // HLS 오류 — 이 셀에만 표시 (REQ-DASH-010)
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        errorMessage = `HLS 재생 오류: ${data.details ?? '알 수 없는 오류'}`;
        isLoading = false;
      }
    });

    hls.loadSource(playlistUrl);
    hls.attachMedia(video);

    video.addEventListener(
      'canplay',
      () => {
        isLoading = false;
      },
      { once: true },
    );
  } catch (err) {
    if (cancelled) return;
    errorMessage = err instanceof Error ? `HLS 로드 실패: ${err.message}` : 'HLS 로드 실패';
    isLoading = false;
  }
}

// ---------------------------------------------------------------------------
// 반응형: assignedCamera 변경 감지 → HLS 재초기화
// ---------------------------------------------------------------------------

$effect(() => {
  const cam = assignedCamera;
  if (cam) {
    initHls(cam);
  } else {
    // 카메라 해제 — 기존 스트림 정지
    destroyHls();
    errorMessage = null;
    isLoading = false;
  }
});

// ---------------------------------------------------------------------------
// onMount / onDestroy
// ---------------------------------------------------------------------------

onMount(() => {
  // video 엘리먼트가 준비되면, 이미 assignedCamera가 있으면 HLS 시작
  // ($effect 가 assignedCamera 변화를 감지하므로 별도 호출 불필요)
});

onDestroy(() => {
  destroyHls();
});

// ---------------------------------------------------------------------------
// 드롭다운 핸들러
// ---------------------------------------------------------------------------

function handleSelect(event: Event) {
  const select = event.target as HTMLSelectElement;
  const value = select.value;
  if (value === '') {
    onAssign(null);
  } else {
    const cam = cameras.find((c) => c.id === value) ?? null;
    onAssign(cam);
  }
}
</script>

<div class="flex flex-col h-full bg-black rounded-md border border-slate-700 overflow-hidden">
  <!-- 셀 헤더: 카메라 선택 드롭다운 -->
  <div class="flex items-center gap-2 bg-slate-900 px-2 py-1.5 shrink-0">
    <select
      class="flex-1 bg-slate-800 text-slate-100 text-xs rounded px-2 py-1 border border-slate-600
             focus:outline-none focus:ring-1 focus:ring-blue-500"
      value={assignedCamera?.id ?? ''}
      onchange={handleSelect}
      aria-label="카메라 선택"
    >
      <option value="">-- 카메라 선택 --</option>
      {#each cameras as cam (cam.id)}
        <option value={cam.id}>
          {cam.status !== 'online' ? '⚠ ' : ''}{cam.name} ({cam.boxName})
        </option>
      {/each}
    </select>
  </div>

  <!-- 셀 본문: 비디오 / 빈 상태 / 로딩 / 오류 -->
  <div class="relative flex-1 min-h-0">
    {#if !assignedCamera}
      <!-- 빈 상태 placeholder (REQ-DASH-008) -->
      <div
        class="absolute inset-0 flex items-center justify-center text-slate-500 text-xs select-none"
      >
        카메라를 선택하세요
      </div>
    {:else if errorMessage}
      <!-- HLS 오류 — 이 셀만 영향 (REQ-DASH-010) -->
      <div
        class="absolute inset-0 flex items-center justify-center px-3 text-rose-400 text-xs text-center"
        role="alert"
      >
        {errorMessage}
      </div>
    {:else}
      {#if isLoading}
        <div
          class="absolute inset-0 flex items-center justify-center text-slate-400 text-xs z-10"
        >
          스트림 연결 중...
        </div>
      {/if}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        class="w-full h-full object-contain {isLoading ? 'opacity-0' : 'opacity-100'}"
        controls
        muted
        autoplay
        playsinline
        aria-label="카메라 HLS 라이브 스트림"
      ></video>
    {/if}
  </div>
</div>
