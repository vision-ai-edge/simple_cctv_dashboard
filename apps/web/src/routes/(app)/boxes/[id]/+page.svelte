<script lang="ts">
// TAG: BOX-CHANNELS-001
/**
 * /(app)/boxes/[id] 상세 페이지.
 *
 * Box 메타데이터 렌더링:
 * - name, host:port, baseUrl, username, status 배지
 * - lastSyncAt, createdAt, updatedAt RelativeTime
 * - "API 키 사용: 예/아니오" (hasApiKey 불리언만 표시 — REQ-UI-3 [Unwanted])
 *
 * 두 폼 액션:
 * - ?/refresh: 토큰 수동 갱신 → 인라인 알림
 * - ?/delete: 확인 다이얼로그 후 삭제 → 목록 페이지 리다이렉트
 *
 * 채널 섹션 (SPEC-BOX-CHANNELS-001, REQ-CHAN-005):
 * - ChannelList 컴포넌트로 채널 목록 표시
 * - Lazy 동기화는 +page.server.ts에서 처리
 */

import { enhance } from '$app/forms';
import RelativeTime from '$lib/components/box/RelativeTime.svelte';
import StatusBadge from '$lib/components/box/StatusBadge.svelte';
import ChannelList from '$lib/components/channel/ChannelList.svelte';
import type { ActionData, PageData } from './$types';

const { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>{data.box?.name ?? 'Box 상세'} - CCTV Dashboard</title>
</svelte:head>

<div class="max-w-2xl space-y-6">
  <!-- 뒤로 가기 링크 -->
  <a
    href="/boxes"
    class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
  >
    ← 박스 목록으로
  </a>

  <!-- 로드 에러 -->
  {#if data.loadError}
    <div
      class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
      role="alert"
    >
      {data.loadError}
    </div>
  {/if}

  {#if data.box}
    <!-- Box 정보 카드 -->
    <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 class="text-xl font-semibold text-slate-900">{data.box.name}</h2>
          <p class="mt-0.5 text-sm text-slate-500 font-mono">{data.box.host}:{data.box.port}</p>
        </div>
        <StatusBadge status={data.box.status} />
      </div>

      <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div class="col-span-2">
          <dt class="text-slate-500 font-medium">Base URL</dt>
          <dd class="text-slate-900 font-mono mt-0.5 break-all">{data.box.baseUrl}</dd>
        </div>
        <div>
          <dt class="text-slate-500 font-medium">사용자 이름</dt>
          <dd class="text-slate-900 mt-0.5">{data.box.username}</dd>
        </div>
        <div>
          <dt class="text-slate-500 font-medium">API 키 사용</dt>
          <dd class="text-slate-900 mt-0.5">{data.box.hasApiKey ? '예' : '아니오'}</dd>
        </div>
        <div>
          <dt class="text-slate-500 font-medium">마지막 동기화</dt>
          <dd class="mt-0.5">
            <RelativeTime value={data.box.lastSyncAt} />
          </dd>
        </div>
        <div>
          <dt class="text-slate-500 font-medium">등록일시</dt>
          <dd class="mt-0.5">
            <RelativeTime value={data.box.createdAt} />
          </dd>
        </div>
        <div>
          <dt class="text-slate-500 font-medium">수정일시</dt>
          <dd class="mt-0.5">
            <RelativeTime value={data.box.updatedAt} />
          </dd>
        </div>
      </dl>
    </div>

    <!-- 액션 영역 -->
    <div class="flex flex-col gap-3">
      <!-- 갱신 결과 인라인 알림 -->
      {#if form?.success}
        <div
          class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          role="status"
        >
          토큰이 성공적으로 갱신되었습니다.
        </div>
      {/if}
      {#if form?.error}
        <div
          class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          role="alert"
        >
          {form.error}
        </div>
      {/if}

      <div class="flex items-center gap-3">
        <!-- 토큰 수동 갱신 폼 -->
        <form method="POST" action="?/refresh" use:enhance>
          <button
            type="submit"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700
                   hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            토큰 수동 갱신
          </button>
        </form>

        <!-- 삭제 폼 -->
        <form
          method="POST"
          action="?/delete"
          use:enhance={({ cancel }) => {
            // 확인 다이얼로그 — 취소 시 폼 제출 중단
            if (!confirm('정말 이 Box를 삭제하시겠습니까?')) {
              cancel();
            }
          }}
        >
          <button
            type="submit"
            class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white
                   hover:bg-rose-700 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
          >
            삭제
          </button>
        </form>
      </div>
    </div>

    <!-- 채널 섹션 (SPEC-BOX-CHANNELS-001, REQ-CHAN-005) -->
    <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <!-- 채널 에러 표시 (오류 격리 — Box 표시는 유지) -->
      {#if data.channelError}
        <div
          class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700"
          role="alert"
        >
          채널 목록을 불러오는 중 오류가 발생했습니다: {data.channelError}
        </div>
      {/if}
      <ChannelList
        channels={data.channels}
        boxId={data.box.id}
        lastSynced={data.lastSyncedAt}
      />
    </div>
  {/if}
</div>
