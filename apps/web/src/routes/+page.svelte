<script lang="ts">
import { type HealthState, fetchHealth } from '$lib/api/client';
import { onMount } from 'svelte';

let health = $state<HealthState>({ status: 'loading' });

onMount(async () => {
  health = await fetchHealth();
});

const badgeClass = $derived.by(() => {
  if (health.status === 'ok') {
    return 'bg-emerald-100 text-emerald-700 ring-emerald-200';
  }
  if (health.status === 'error') {
    return 'bg-rose-100 text-rose-700 ring-rose-200';
  }
  return 'bg-slate-100 text-slate-600 ring-slate-200';
});

const badgeLabel = $derived.by(() => {
  if (health.status === 'ok') return `정상 · v${health.version}`;
  if (health.status === 'error') return `오류: ${health.message ?? '연결 실패'}`;
  return '확인 중...';
});
</script>

<section class="space-y-6">
  <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold text-slate-900">CCTV Dashboard</h2>
        <p class="mt-1 text-sm text-slate-500">
          EdgeAI Box 기반 통합 관제 시스템 — 기반 구조 단계 (SPEC-CORE-001)
        </p>
      </div>
      <span
        class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset {badgeClass}"
        data-testid="health-badge"
      >
        <span class="size-2 rounded-full bg-current opacity-75"></span>
        {badgeLabel}
      </span>
    </div>
  </div>

  <div class="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
    다음 단계: SPEC-AUTH-* (로그인), SPEC-BOX-* (박스 등록), SPEC-MAP-* (지도 마커).
  </div>
</section>
