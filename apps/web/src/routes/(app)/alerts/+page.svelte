<script lang="ts">
/**
 * /alerts 알림 히스토리 페이지.
 *
 * 알림 목록 테이블 + 이전/다음 페이지네이션.
 */

import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

const { alerts, pagination, loadError } = $derived(data);

const hasPrev = $derived(pagination.offset > 0);
const hasNext = $derived(pagination.offset + pagination.limit < pagination.total);

const prevOffset = $derived(Math.max(0, pagination.offset - pagination.limit));
const nextOffset = $derived(pagination.offset + pagination.limit);

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
</script>

<svelte:head>
  <title>알림 히스토리 - CCTV Dashboard</title>
</svelte:head>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold text-slate-900">알림 히스토리</h2>
    {#if pagination.total > 0}
      <span class="text-xs text-slate-500">총 {pagination.total}건</span>
    {/if}
  </div>

  {#if loadError}
    <div class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
      {loadError}
    </div>
  {/if}

  {#if alerts.length === 0 && !loadError}
    <div class="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
      <p class="text-sm text-slate-500">알림 기록이 없습니다.</p>
    </div>
  {:else if alerts.length > 0}
    <!-- 알림 테이블 -->
    <div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead class="border-b border-slate-200 bg-slate-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              시각
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              유형
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              채널
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              Box
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each alerts as alert (alert.id)}
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap font-mono">
                {formatTime(alert.firedAt)}
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  {alert.type}
                </span>
              </td>
              <td class="px-4 py-3 text-xs text-slate-700 font-mono">{alert.channelId}</td>
              <td class="px-4 py-3 text-xs text-slate-700">
                {alert.boxName ?? alert.boxId}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- 페이지네이션 -->
    <div class="flex items-center justify-between">
      <span class="text-xs text-slate-500">
        {pagination.offset + 1}–{Math.min(pagination.offset + alerts.length, pagination.total)} / {pagination.total}
      </span>
      <div class="flex gap-2">
        {#if hasPrev}
          <a
            href="/alerts?offset={prevOffset}"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700
                   hover:bg-slate-50 transition-colors"
          >
            이전
          </a>
        {:else}
          <span
            class="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed"
          >
            이전
          </span>
        {/if}
        {#if hasNext}
          <a
            href="/alerts?offset={nextOffset}"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700
                   hover:bg-slate-50 transition-colors"
          >
            다음
          </a>
        {:else}
          <span
            class="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed"
          >
            다음
          </span>
        {/if}
      </div>
    </div>
  {/if}
</div>
