<script lang="ts">
// TAG: BOX-CHANNELS-001
/**
 * ChannelRow 컴포넌트.
 *
 * 채널 1개의 행을 렌더링한다.
 * - 채널 이름, 채널 ID(보조 텍스트), 상태 배지, 마지막 동기화 시각
 * - syncError가 있으면 오류 아이콘 (툴팁)
 * - 해상도 표시 (있으면)
 * - 액션: 토글 (Optimistic UI), 스냅샷 (inline img), 프리뷰 (ChannelPreview mount/unmount)
 *
 * REQ-CHAN-006: Optimistic UI 토글 + 실패 시 롤백
 * REQ-CHAN-007: HLS 인라인 프리뷰 (ChannelPreview)
 * REQ-CHAN-008: 스냅샷 blob → object URL
 */

import { untrack } from 'svelte';
import type { ChannelDto } from '$lib/types/channel';
import { getCameraStatusBadgeClass, getCameraStatusLabel } from './channelBadge.helpers';
import RelativeTime from '$lib/components/box/RelativeTime.svelte';
import ChannelPreview from './ChannelPreview.svelte';
import { startChannel, stopChannel } from '$lib/api/channels';

const { channel: channelProp, boxId }: { channel: ChannelDto; boxId: string } = $props();

// 채널 상태 — Optimistic UI를 위한 로컬 상태
// untrack을 사용하여 초기값 설정 시 반응형 추적을 피한다 (Svelte 5 권장 패턴)
let channel = $state(untrack(() => ({ ...channelProp })));

$effect(() => {
  // props가 갱신될 때 (invalidateAll 이후) 로컬 상태를 동기화한다.
  // 토글 진행 중에는 덮어쓰지 않는다.
  const updated = { ...channelProp };
  if (!isToggling) {
    channel = updated;
  }
});
let isToggling = $state(false);
let toggleError = $state<string | null>(null);

// 스냅샷 상태
let snapshotObjectUrl = $state<string | null>(null);
let isLoadingSnapshot = $state(false);
let snapshotError = $state<string | null>(null);

// HLS 프리뷰 패널 표시 여부
let showPreview = $state(false);

/**
 * 채널 토글 — Optimistic UI.
 * 클릭 즉시 로컬 상태를 반전하고, API 실패 시 원래 상태로 롤백한다.
 */
async function handleToggle() {
  if (isToggling) return;

  const originalStatus = channel.status;
  const isRunning = originalStatus === 'online';

  // Optimistic 상태 전환
  isToggling = true;
  toggleError = null;
  channel = { ...channel, status: isRunning ? 'offline' : 'online' };

  try {
    const result = isRunning
      ? await stopChannel(boxId, channel.channelId, fetch)
      : await startChannel(boxId, channel.channelId, fetch);

    if (!result.ok) {
      // 실패 시 롤백
      channel = { ...channel, status: originalStatus };
      toggleError = isRunning ? '채널 비활성화에 실패했습니다' : '채널 활성화에 실패했습니다';
    }
  } catch {
    // 예외 시 롤백
    channel = { ...channel, status: originalStatus };
    toggleError = '요청 중 오류가 발생했습니다';
  } finally {
    isToggling = false;
  }
}

/**
 * 스냅샷 인라인 표시.
 * blob → object URL 생성. 닫을 때 URL.revokeObjectURL 호출.
 * AC-007: 자체 도메인 프록시 URL만 사용.
 */
async function handleSnapshot() {
  if (isLoadingSnapshot) return;

  // 기존 스냅샷 닫기
  if (snapshotObjectUrl) {
    URL.revokeObjectURL(snapshotObjectUrl);
    snapshotObjectUrl = null;
    return;
  }

  isLoadingSnapshot = true;
  snapshotError = null;

  try {
    // AC-015: 자체 도메인 URL만 사용 (자격증명 미포함)
    const res = await fetch(
      `/api/boxes/${boxId}/channels/${channel.channelId}/snapshot?type=preview`,
    );
    if (!res.ok) {
      snapshotError = `스냅샷 조회 실패 (${res.status})`;
      return;
    }
    const blob = await res.blob();
    snapshotObjectUrl = URL.createObjectURL(blob);
  } catch {
    snapshotError = '스냅샷을 불러올 수 없습니다';
  } finally {
    isLoadingSnapshot = false;
  }
}

/**
 * 스냅샷 닫기 및 메모리 해제.
 */
function closeSnapshot() {
  if (snapshotObjectUrl) {
    URL.revokeObjectURL(snapshotObjectUrl);
    snapshotObjectUrl = null;
  }
}

/**
 * HLS 프리뷰 토글 (mount/unmount ChannelPreview).
 */
function handlePreviewToggle() {
  showPreview = !showPreview;
}
</script>

<!-- 채널 행 카드 -->
<div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
  <!-- 상단: 채널 정보 + 상태 배지 -->
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h4 class="text-sm font-semibold text-slate-900 truncate">{channel.name}</h4>
        <!-- syncError 아이콘 -->
        {#if channel.syncError}
          <span
            title={channel.syncError}
            class="inline-flex items-center justify-center size-4 rounded-full bg-amber-100 text-amber-600 cursor-help text-xs font-bold"
            aria-label="동기화 오류: {channel.syncError}"
          >
            !
          </span>
        {/if}
      </div>
      <p class="text-xs text-slate-500 font-mono mt-0.5">{channel.channelId}</p>
      {#if channel.resolution}
        <p class="text-xs text-slate-400 mt-0.5">{channel.resolution}</p>
      {/if}
    </div>
    <!-- 상태 배지 -->
    <span
      class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset {getCameraStatusBadgeClass(channel.status)}"
    >
      <span class="size-1.5 rounded-full bg-current opacity-75"></span>
      {getCameraStatusLabel(channel.status)}
    </span>
  </div>

  <!-- 마지막 동기화 시각 -->
  <div class="text-xs text-slate-500">
    <span class="font-medium">마지막 동기화:</span>
    <RelativeTime value={channel.lastSyncedAt} />
  </div>

  <!-- 토글 에러 메시지 -->
  {#if toggleError}
    <div
      class="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
      role="alert"
    >
      {toggleError}
    </div>
  {/if}

  <!-- 스냅샷 에러 메시지 -->
  {#if snapshotError}
    <div
      class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
      role="alert"
    >
      {snapshotError}
    </div>
  {/if}

  <!-- 액션 버튼 -->
  <div class="flex items-center gap-2 flex-wrap">
    <!-- 토글 버튼 (REQ-CHAN-006) -->
    <button
      type="button"
      onclick={handleToggle}
      disabled={isToggling}
      class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700
             hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
             focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
    >
      {#if isToggling}
        처리 중...
      {:else if channel.status === 'online'}
        비활성화
      {:else}
        활성화
      {/if}
    </button>

    <!-- 스냅샷 버튼 (REQ-CHAN-008) -->
    <button
      type="button"
      onclick={handleSnapshot}
      disabled={isLoadingSnapshot}
      class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700
             hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
             focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
    >
      {#if isLoadingSnapshot}
        로딩 중...
      {:else if snapshotObjectUrl}
        스냅샷 닫기
      {:else}
        스냅샷
      {/if}
    </button>

    <!-- 프리뷰 버튼 (REQ-CHAN-007) -->
    <button
      type="button"
      onclick={handlePreviewToggle}
      class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700
             hover:bg-slate-50 transition-colors
             focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
    >
      {showPreview ? '프리뷰 닫기' : '프리뷰'}
    </button>
  </div>

  <!-- 스냅샷 인라인 이미지 표시 (AC-007) -->
  {#if snapshotObjectUrl}
    <div class="relative">
      <img
        src={snapshotObjectUrl}
        alt="{channel.name} 스냅샷"
        class="w-full max-w-full rounded-md border border-slate-200"
      />
      <button
        type="button"
        onclick={closeSnapshot}
        class="absolute top-2 right-2 size-6 rounded-full bg-slate-900/60 text-white text-xs
               flex items-center justify-center hover:bg-slate-900/80 transition-colors"
        aria-label="스냅샷 닫기"
      >
        ✕
      </button>
    </div>
  {/if}

  <!-- HLS 프리뷰 패널 (REQ-CHAN-007, mount/unmount 방식) -->
  {#if showPreview}
    <ChannelPreview {boxId} channelId={channel.channelId} />
  {/if}
</div>
