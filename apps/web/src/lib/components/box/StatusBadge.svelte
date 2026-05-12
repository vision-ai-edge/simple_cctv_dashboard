<script lang="ts">
/**
 * StatusBadge 컴포넌트.
 *
 * Box status 값에 따라 색상 배지와 한국어 라벨을 렌더링한다.
 * - active: emerald (정상)
 * - inactive: slate (비활성)
 * - error: rose (오류)
 */

import { getStatusBadgeClass, getStatusBadgeLabel } from './statusBadge.helpers';
import type { Status } from './statusBadge.helpers';

const { status }: { status: Status | string } = $props();
</script>

<span
  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset {getStatusBadgeClass(status)}"
>
  <span class="size-1.5 rounded-full bg-current opacity-75"></span>
  {getStatusBadgeLabel(status)}
</span>
