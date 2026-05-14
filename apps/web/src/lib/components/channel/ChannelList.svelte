<script lang="ts">
// TAG: BOX-CHANNELS-001
/**
 * ChannelList 컴포넌트.
 *
 * Box의 채널 목록을 표시하고 수동 동기화 버튼을 제공한다.
 * - 빈 상태: "채널이 없습니다. 동기화 버튼을 눌러 채널을 가져오세요" + 동기화 버튼
 * - 정상 상태: ChannelRow 목록 + 우상단 "채널 동기화" 버튼
 * - 동기화 진행 중: 버튼 disabled + 로딩 텍스트
 * - 동기화 완료: invalidate로 페이지 데이터 갱신
 *
 * REQ-CHAN-005: 채널 목록 섹션
 * REQ-CHAN-009: 수동 동기화 트리거
 */

import { invalidateAll } from '$app/navigation';
import type { ChannelDto } from '$lib/types/channel';
import { syncChannels } from '$lib/api/channels';
import ChannelRow from './ChannelRow.svelte';

const {
  channels,
  boxId,
  lastSynced,
}: {
  channels: ChannelDto[];
  boxId: string;
  lastSynced: number | null;
} = $props();

let isSyncing = $state(false);
let syncMessage = $state<string | null>(null);
let syncError = $state<string | null>(null);

/** 수동 채널 동기화 (REQ-CHAN-009) */
async function handleSync() {
  if (isSyncing) return;

  isSyncing = true;
  syncMessage = null;
  syncError = null;

  try {
    const result = await syncChannels(boxId, fetch);

    if (result.ok) {
      syncMessage = `${result.result.synced}개 채널 동기화 성공`;
      // 채널 목록 갱신 — invalidateAll로 페이지 데이터 재로드
      await invalidateAll();
    } else {
      syncError = result.error.message;
    }
  } catch {
    syncError = '동기화 요청 중 오류가 발생했습니다';
  } finally {
    isSyncing = false;
  }
}

// 마지막 동기화 시각 표시 문자열 (derived)
const lastSyncedText = $derived(
  lastSynced ? new Date(lastSynced).toLocaleString('ko-KR') : null,
);
</script>

<section aria-labelledby="channel-section-title">
  <!-- 섹션 헤더 -->
  <div class="flex items-center justify-between gap-3 mb-4">
    <div>
      <h3 id="channel-section-title" class="text-base font-semibold text-slate-900">채널 목록</h3>
      {#if lastSyncedText}
        <p class="text-xs text-slate-400 mt-0.5">마지막 동기화: {lastSyncedText}</p>
      {/if}
    </div>

    <!-- 동기화 버튼 (빈 상태가 아닐 때만 우상단에 표시) -->
    {#if channels.length > 0}
      <button
        type="button"
        onclick={handleSync}
        disabled={isSyncing}
        class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700
               hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
               focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
      >
        {isSyncing ? '동기화 중...' : '채널 동기화'}
      </button>
    {/if}
  </div>

  <!-- 동기화 결과 메시지 -->
  {#if syncMessage}
    <div
      class="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700"
      role="status"
    >
      {syncMessage}
    </div>
  {/if}

  <!-- 동기화 에러 메시지 -->
  {#if syncError}
    <div
      class="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700"
      role="alert"
    >
      {syncError}
    </div>
  {/if}

  <!-- 빈 상태 (AC-013, REQ-CHAN-005) -->
  {#if channels.length === 0}
    <div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <p class="text-sm text-slate-500 mb-4">
        채널이 없습니다. 동기화 버튼을 눌러 채널을 가져오세요
      </p>
      <button
        type="button"
        onclick={handleSync}
        disabled={isSyncing}
        class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white
               hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
               focus:outline-none focus:ring-2 focus:ring-slate-600 focus:ring-offset-2"
      >
        {isSyncing ? '동기화 중...' : '채널 동기화'}
      </button>
    </div>
  {:else}
    <!-- 채널 목록 (ChannelRow) -->
    <div class="space-y-3">
      {#each channels as channel (channel.id)}
        <ChannelRow {channel} {boxId} />
      {/each}
    </div>
  {/if}
</section>
