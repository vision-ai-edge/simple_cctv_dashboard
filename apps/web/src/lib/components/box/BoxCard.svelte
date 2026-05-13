<script lang="ts">
/**
 * BoxCard 컴포넌트.
 *
 * 목록 페이지에서 각 Box를 카드 형태로 렌더링한다.
 * name, host:port, StatusBadge, RelativeTime, 상세 보기 링크를 표시한다.
 */

import type { BoxSummary } from '$lib/api/boxes';
import RelativeTime from './RelativeTime.svelte';
import StatusBadge from './StatusBadge.svelte';

const { box }: { box: BoxSummary } = $props();
</script>

<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <!-- Box 이름 -->
      <h3 class="text-base font-semibold text-slate-900 truncate">{box.name}</h3>
      <!-- host:port -->
      <p class="mt-0.5 text-sm text-slate-500 font-mono">{box.host}:{box.port}</p>
    </div>
    <!-- 상태 배지 -->
    <StatusBadge status={box.status} />
  </div>

  <div class="mt-3 flex items-center justify-between">
    <!-- 마지막 동기화 시각 -->
    <div class="flex items-center gap-1.5 text-xs text-slate-400">
      <span>마지막 동기화:</span>
      <RelativeTime value={box.lastSyncAt} />
    </div>
    <!-- 상세 보기 링크 -->
    <a
      href="/boxes/{box.id}"
      class="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
    >
      상세 보기 →
    </a>
  </div>
</div>
