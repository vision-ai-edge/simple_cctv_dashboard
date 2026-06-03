<script lang="ts">
// TAG: DASHBOARD-001
/**
 * /dashboard/grid 멀티뷰 페이지.
 *
 * - 기본 레이아웃: 2×2 (cellCount=4, D1 결정 사항)
 * - GridLayoutSelector 로 레이아웃 변경 → assignments 전체 초기화 (REQ-DASH-007)
 * - 각 GridCell 은 독립적인 hls.js 인스턴스를 가짐 (REQ-DASH-009)
 * - 셀 할당 상태는 페이지 로컬 state — DB 영속 없음 (A7, 향후 URL 파라미터/localStorage 검토 가능)
 *
 * REQ-DASH-007, REQ-DASH-008, REQ-DASH-009, REQ-DASH-010
 */

import GridCell from '$lib/components/dashboard/GridCell.svelte';
import GridLayoutSelector from '$lib/components/dashboard/GridLayoutSelector.svelte';
import type { CameraWithBox } from '$lib/types/dashboard';
import { onMount } from 'svelte';
import type { PageData } from './$types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const { data }: { data: PageData } = $props();

const STORAGE_KEY = 'cctv-dashboard-grid-state';

// ---------------------------------------------------------------------------
// 레이아웃 상태 (D1: 기본값 4 = 2×2)
// ---------------------------------------------------------------------------

let cellCount = $state<1 | 4 | 9>(4);

// ---------------------------------------------------------------------------
// 셀 할당 배열
// ---------------------------------------------------------------------------

let assignments = $state<(CameraWithBox | null)[]>(Array(4).fill(null));
let storageReady = $state(false);

// ---------------------------------------------------------------------------
// CSS Grid 클래스 (derived)
// ---------------------------------------------------------------------------

const gridClass = $derived<string>(
  cellCount === 1 ? 'grid-cols-1' : cellCount === 4 ? 'grid-cols-2' : 'grid-cols-3',
);

// ---------------------------------------------------------------------------
// 핸들러
// ---------------------------------------------------------------------------

/**
 * 레이아웃 변경 — assignments 전체 초기화 (REQ-DASH-007).
 * 레이아웃 변경은 셀 재배치를 의미하므로 기존 할당을 모두 비운다.
 */
function handleLayoutChange(newLayout: 1 | 4 | 9) {
  cellCount = newLayout;
  assignments = resizeAssignments(assignments, newLayout);
}

/**
 * 특정 인덱스 셀의 카메라 할당 변경.
 */
function handleAssign(index: number, camera: CameraWithBox | null) {
  assignments = assignments.map((a, i) => (i === index ? camera : a));
}

function resizeAssignments(
  currentAssignments: (CameraWithBox | null)[],
  newLayout: 1 | 4 | 9,
): (CameraWithBox | null)[] {
  return Array.from({ length: newLayout }, (_, i) => currentAssignments[i] ?? null);
}

function restoreGridState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as { cellCount?: number; cameraIds?: Array<string | null> };
    const restoredCellCount =
      parsed.cellCount === 1 || parsed.cellCount === 4 || parsed.cellCount === 9
        ? parsed.cellCount
        : 4;
    const cameraById = new Map(data.cameras.map((camera) => [camera.id, camera]));
    cellCount = restoredCellCount;
    assignments = Array.from({ length: restoredCellCount }, (_, i) => {
      const cameraId = parsed.cameraIds?.[i];
      return cameraId ? (cameraById.get(cameraId) ?? null) : null;
    });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persistGridState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      cellCount,
      cameraIds: assignments.map((camera) => camera?.id ?? null),
    }),
  );
}

onMount(() => {
  restoreGridState();
  storageReady = true;
});

$effect(() => {
  if (!storageReady) return;
  persistGridState();
});
</script>

<div class="flex flex-col h-[calc(100vh-4rem)] gap-3 p-3">
  <!-- 헤더 -->
  <div class="flex items-center justify-between shrink-0">
    <h1 class="text-lg font-semibold text-slate-900">멀티뷰</h1>
    <div class="flex items-center gap-3">
      <GridLayoutSelector layout={cellCount} onLayoutChange={handleLayoutChange} />
      <a
        href="/dashboard"
        class="text-sm text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline"
      >
        지도 뷰로 돌아가기
      </a>
    </div>
  </div>

  <!-- 바둑판 그리드 (REQ-DASH-008, REQ-DASH-009) -->
  <div class="grid {gridClass} gap-2 flex-1 min-h-0">
    {#each assignments as assignedCamera, index (index)}
      <GridCell
        cameras={data.cameras}
        {assignedCamera}
        onAssign={(cam) => handleAssign(index, cam)}
      />
    {/each}
  </div>
</div>
