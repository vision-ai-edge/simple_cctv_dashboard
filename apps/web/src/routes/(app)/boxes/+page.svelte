<script lang="ts">
/**
 * /(app)/boxes 목록 페이지.
 *
 * 등록된 Box 목록을 카드 그리드로 렌더링하고,
 * 15초 주기로 GET /api/boxes를 폴링하여 목록을 갱신한다.
 *
 * 폴링 동작:
 * - 가시 상태: 15초 주기로 폴링
 * - 비가시 상태: 폴링 중단 (백그라운드 탭 리소스 절약)
 * - visibilitychange → visible: 즉시 1회 갱신 후 폴링 재개
 * - 401 응답: 폴링 즉시 중단 후 /login 리다이렉트
 */

import type { BoxSummary } from '$lib/api/boxes';
import BoxCard from '$lib/components/box/BoxCard.svelte';
import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

// 폴링으로 갱신되는 boxes 상태 — 초기값은 비어 있고 $effect에서 채운다
let boxes = $state<BoxSummary[]>([]);

// 폴링 인터벌 ID
let intervalId: ReturnType<typeof setInterval> | undefined;

/** GET /api/boxes를 호출하여 boxes 상태를 갱신한다. */
async function refreshBoxes(): Promise<void> {
  try {
    const res = await fetch('/api/boxes');
    if (res.status === 401) {
      // 세션 만료 — 폴링 즉시 중단 후 로그인 페이지로 이동
      stopPolling();
      window.location.href = '/login';
      return;
    }
    if (res.ok) {
      boxes = (await res.json()) as BoxSummary[];
    }
  } catch {
    // 네트워크 오류 — 다음 폴링 주기에 재시도
  }
}

/** 폴링을 시작한다. */
function startPolling(): void {
  stopPolling(); // 중복 방지
  intervalId = setInterval(refreshBoxes, 15_000);
}

/** 폴링을 중단한다. */
function stopPolling(): void {
  clearInterval(intervalId);
  intervalId = undefined;
}

/** visibilitychange 이벤트 핸들러. */
function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    // visible 전환 시 즉시 1회 갱신 후 폴링 재개
    refreshBoxes();
    startPolling();
  } else {
    stopPolling();
  }
}

$effect(() => {
  // 서버 데이터로 boxes 초기화 및 data 변경 시 동기화
  boxes = data.boxes;

  // 마운트 시 가시 상태면 폴링 시작
  if (document.visibilityState === 'visible') {
    startPolling();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  // 언마운트 클린업
  return () => {
    stopPolling();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
});
</script>

<svelte:head>
  <title>박스 관리 - CCTV Dashboard</title>
</svelte:head>

<div class="space-y-6">
  <!-- 페이지 헤더 -->
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold text-slate-900">박스 관리</h2>
    <a
      href="/boxes/new"
      class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      + 박스 등록
    </a>
  </div>

  <!-- 에러 상태 -->
  {#if data.error}
    <div
      class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
      role="alert"
    >
      {data.error}
    </div>
  {/if}

  <!-- 빈 상태 -->
  {#if boxes.length === 0 && !data.error}
    <div class="rounded-xl border border-dashed border-slate-300 p-10 text-center">
      <p class="text-sm text-slate-500">등록된 Box가 없습니다.</p>
      <p class="mt-1 text-sm text-slate-400">
        상단의 "+ 박스 등록" 버튼을 눌러 새 Box를 추가하세요.
      </p>
    </div>

  <!-- Box 카드 그리드 -->
  {:else}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each boxes as box (box.id)}
        <BoxCard {box} />
      {/each}
    </div>
  {/if}
</div>
