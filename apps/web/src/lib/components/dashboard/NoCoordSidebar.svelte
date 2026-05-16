<script lang="ts">
/**
 * NoCoordSidebar — 좌표 없는 카메라 사이드바 컴포넌트.
 *
 * REQ-DASH-006: 좌표 없는 카메라 목록을 표시한다.
 * - 0개이면 렌더링 생략 (REQ-DASH-006 [State-Driven]).
 * - D4: lg 이상 → 지도 우측 오버레이, md 이하 → 하단 collapsible.
 * - shadcn-svelte 미사용 — Tailwind 4 native 클래스만 사용 (SPEC-BOX-UI-001).
 */

import type { CameraWithBox } from '$lib/types/dashboard';
import { getCameraStatusBadgeClass, getCameraStatusLabel } from '$lib/components/channel/channelBadge.helpers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** 좌표 없는 카메라 목록 (caller 측에서 필터링하여 전달) */
  cameras: CameraWithBox[];
}

const { cameras }: Props = $props();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** md 이하에서 하단 섹션 펼침/접힘 상태 */
let collapsed = $state(false);
</script>

{#if cameras.length > 0}
  <!--
    lg 이상: 지도 우측 오버레이 패널 (absolute 포지션 — 부모가 relative여야 함)
    md 이하: 하단 고정 collapsible 섹션
    REQ-DASH-014 반응형 준수
  -->
  <aside
    class="
      bg-white border border-slate-200 rounded-lg shadow-sm
      lg:absolute lg:top-4 lg:right-4 lg:w-64 lg:max-h-[calc(100%-2rem)] lg:overflow-y-auto
      max-lg:w-full max-lg:mt-3
    "
    aria-label="좌표 없는 카메라 목록"
  >
    <!-- 헤더 + 접힘 토글 (md 이하만 표시) -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
      <h3 class="text-sm font-semibold text-slate-700">
        좌표 미설정 카메라
        <span class="ml-1 text-xs font-normal text-slate-400">({cameras.length})</span>
      </h3>
      <!-- md 이하에서만 보이는 접힘 버튼 -->
      <button
        class="lg:hidden text-xs text-slate-500 hover:text-slate-800 transition-colors"
        onclick={() => { collapsed = !collapsed; }}
        type="button"
        aria-expanded={!collapsed}
      >
        {collapsed ? '펼치기' : '접기'}
      </button>
    </div>

    <!-- 목록 (md 이하 + collapsed 시 숨김) -->
    {#if !collapsed}
      <ul class="divide-y divide-slate-100">
        {#each cameras as cam (cam.id)}
          <li class="px-4 py-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <!-- 채널 이름 -->
                <p class="text-sm font-medium text-slate-800 truncate">{cam.name}</p>
                <!-- Box 이름 -->
                <p class="text-xs text-slate-500 truncate">{cam.boxName}</p>
              </div>
              <!-- 상태 배지 (channelBadge.helpers.ts 재사용) -->
              <span
                class="flex-shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {getCameraStatusBadgeClass(cam.status)}"
              >
                {getCameraStatusLabel(cam.status)}
              </span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}
