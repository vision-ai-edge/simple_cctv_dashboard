<script lang="ts">
/**
 * /dashboard 메인 페이지.
 *
 * - 서버 로드 데이터(cameras)를 geocoded / noCoord 로 분리 (REQ-DASH-003, REQ-DASH-006).
 * - CameraMap: 좌표 보유 카메라 지도 표시 (REQ-DASH-003, REQ-DASH-004, REQ-DASH-005).
 * - NoCoordSidebar: 좌표 없는 카메라 사이드바 (REQ-DASH-006, D4).
 * - "멀티뷰 보기" 링크 → /dashboard/grid (REQ-DASH-011).
 */

import { fetchCameras, partitionCameras } from '$lib/api/cameras';
import CameraMap from '$lib/components/dashboard/CameraMap.svelte';
import NoCoordSidebar from '$lib/components/dashboard/NoCoordSidebar.svelte';
import { onMount } from 'svelte';
import type { PageData } from './$types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const { data }: { data: PageData } = $props();
let refreshedCameras = $state<PageData['cameras'] | null>(null);
let cameraRefreshKey = $state(0);

// ---------------------------------------------------------------------------
// Derived: 좌표 보유 / 좌표 없음 분리 (REQ-DASH-004, REQ-DASH-006)
// ---------------------------------------------------------------------------

const cameras = $derived(refreshedCameras ?? data.cameras);
const { geocoded, noCoord } = $derived(partitionCameras(cameras));

async function refreshCameras(): Promise<void> {
  const result = await fetchCameras(globalThis.fetch);
  if (!result.ok) return;

  refreshedCameras = result.cameras;
  cameraRefreshKey += 1;
}

onMount(() => {
  const interval = window.setInterval(() => {
    void refreshCameras();
  }, 30_000);

  return () => window.clearInterval(interval);
});
</script>

<div class="space-y-4">
  <!-- 헤더 (REQ-DASH-011) -->
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold text-slate-900">대시보드</h2>
    <a
      href="/dashboard/grid"
      class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
    >
      멀티뷰 보기
    </a>
  </div>

  <!-- 지도 + 사이드바 컨테이너 (relative: 사이드바 오버레이 기준점) -->
  <div class="relative w-full" style="height: 600px;">
    <!-- Leaflet 지도 (REQ-DASH-003, REQ-DASH-004, REQ-DASH-005) -->
    {#key cameraRefreshKey}
      <CameraMap cameras={geocoded} />
    {/key}

    <!-- 좌표 없는 카메라 사이드바 (REQ-DASH-006, D4) -->
    <NoCoordSidebar cameras={noCoord} />
  </div>

  {#if cameras.length === 0}
    <!-- 카메라 없음 안내 -->
    <div class="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      등록된 카메라가 없습니다. 박스를 등록하고 채널을 동기화하세요.
    </div>
  {/if}
</div>
