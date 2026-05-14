<script lang="ts">
// TAG: BOX-CHANNELS-001
/**
 * ChannelPreview 컴포넌트.
 *
 * HLS 스트림을 video 엘리먼트로 인라인 재생한다.
 * - hls.js를 dynamic import로 로드 (초기 번들 크기 최소화)
 * - Safari (native HLS): video.canPlayType으로 감지하여 직접 src 설정
 * - 그 외 브라우저: Hls.isSupported() 시 Hls 인스턴스 생성
 * - 언마운트 시 Hls 인스턴스 destroy + video pause + src 해제 (메모리 누수 방지)
 *
 * AC-008, AC-015: 자체 도메인 URL(/api/boxes/.../hls/playlist.m3u8)만 사용.
 *                 자격증명은 서버-Box 구간에서만 사용.
 * REQ-CHAN-007: WebRTC fallback 구현 금지 (HLS 실패 시 에러 메시지만 표시).
 */

import { onMount } from 'svelte';

const { boxId, channelId }: { boxId: string; channelId: string } = $props();

// HLS 프록시 URL — 자체 도메인만 사용 (AC-015)
// $derived로 props 참조를 올바르게 캡처
const playlistUrl = $derived(`/api/boxes/${boxId}/channels/${channelId}/hls/playlist.m3u8`);

// biome-ignore lint/style/useConst: bind:this가 필요한 let (Svelte 5 bind 요구사항)
let videoEl = $state<HTMLVideoElement | undefined>(undefined);
let errorMessage = $state<string | null>(null);
let isLoading = $state(true);

// hls.js 인스턴스 레퍼런스 (언마운트 시 destroy용)
// Svelte 5 runes에서 일반 let 변수로 관리
let hlsInstance: { destroy(): void } | null = null;

onMount(() => {
  if (!videoEl) return;

  const video = videoEl;

  // 로딩 완료 이벤트
  const onCanPlay = () => { isLoading = false; };
  video.addEventListener('canplay', onCanPlay);

  // Safari: native HLS 지원 여부 확인
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = playlistUrl;
    video.load();
    return () => {
      video.removeEventListener('canplay', onCanPlay);
      video.pause();
      video.src = '';
    };
  }

  // 그 외 브라우저: hls.js dynamic import
  let cancelled = false;
  (async () => {
    try {
      const { default: Hls } = await import('hls.js');

      if (cancelled) return;

      if (!Hls.isSupported()) {
        errorMessage = '이 브라우저는 HLS 재생을 지원하지 않습니다.';
        isLoading = false;
        return;
      }

      const hls = new Hls({
        // 세그먼트 요청은 자체 도메인 프록시로만 보냄 (AC-015)
        xhrSetup: undefined,
      });

      hlsInstance = hls;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          errorMessage = `HLS 재생 오류: ${data.details ?? '알 수 없는 오류'}`;
          isLoading = false;
        }
      });

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);
    } catch (err) {
      if (cancelled) return;
      errorMessage = err instanceof Error ? `HLS 로드 실패: ${err.message}` : 'HLS 로드 실패';
      isLoading = false;
    }
  })();

  // 언마운트 클린업
  return () => {
    cancelled = true;
    video.removeEventListener('canplay', onCanPlay);
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    video.pause();
    video.src = '';
  };
});
</script>

<div class="rounded-md border border-slate-200 overflow-hidden bg-black">
  <!-- 로딩 표시 -->
  {#if isLoading && !errorMessage}
    <div class="flex items-center justify-center h-32 text-slate-400 text-xs">
      스트림 연결 중...
    </div>
  {/if}

  <!-- HLS 에러 메시지 (WebRTC fallback 없음 — REQ-CHAN-007) -->
  {#if errorMessage}
    <div
      class="flex items-center justify-center h-32 px-4 text-rose-400 text-xs text-center"
      role="alert"
    >
      {errorMessage}
    </div>
  {/if}

  <!-- video 엘리먼트 -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoEl}
    class="w-full {isLoading || errorMessage ? 'hidden' : 'block'}"
    controls
    muted
    autoplay
    playsinline
    aria-label="채널 HLS 라이브 프리뷰"
  ></video>
</div>
