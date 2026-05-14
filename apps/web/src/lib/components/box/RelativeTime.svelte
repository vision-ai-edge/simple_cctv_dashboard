<script lang="ts">
/**
 * RelativeTime 컴포넌트.
 *
 * Date | number | null 입력을 한국어 상대시간으로 렌더링한다.
 * ISO 8601 절대시각을 datetime 속성과 title 속성에 설정한다.
 *
 * 렌더링 규칙:
 * - null              → "동기화 이력 없음"
 * - 60초 미만         → "방금 전"
 * - 60분 미만         → "n분 전"
 * - 24시간 미만       → "n시간 전"
 * - 24시간 이상       → "yyyy-MM-dd HH:mm"
 */

import { formatRelativeTime, toIsoString } from './relativeTime.helpers';

const { value }: { value: Date | number | string | null | undefined } = $props();

// 표시 문자열 (목록 페이지의 15초 폴링으로 충분히 갱신됨)
const display = $derived(formatRelativeTime(value));
const iso = $derived(toIsoString(value));
</script>

{#if value === null || value === undefined || iso === ''}
  <span class="text-slate-400 text-sm">동기화 이력 없음</span>
{:else}
  <time datetime={iso} title={iso} class="text-slate-600 text-sm">
    {display}
  </time>
{/if}
