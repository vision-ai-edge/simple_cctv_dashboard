<script lang="ts">
// TAG: DASHBOARD-001
/**
 * GridLayoutSelector 컴포넌트.
 *
 * 바둑판 멀티뷰 레이아웃(셀 수)을 선택하는 세그먼트 버튼 UI.
 * - 1×1 (cellCount=1), 2×2 (cellCount=4), 3×3 (cellCount=9)
 * - 레이아웃 변경 시 onLayoutChange 콜백 호출 → 부모에서 assignments 초기화
 *
 * REQ-DASH-007, REQ-DASH-008
 */

const {
  layout,
  onLayoutChange,
}: {
  layout: 1 | 4 | 9;
  onLayoutChange: (newLayout: 1 | 4 | 9) => void;
} = $props();

const OPTIONS: { value: 1 | 4 | 9; label: string; title: string }[] = [
  { value: 1, label: '1×1', title: '단일 셀 레이아웃' },
  { value: 4, label: '2×2', title: '2×2 그리드 레이아웃' },
  { value: 9, label: '3×3', title: '3×3 그리드 레이아웃' },
];

function select(value: 1 | 4 | 9) {
  if (value !== layout) {
    onLayoutChange(value);
  }
}
</script>

<!-- 세그먼트 컨트롤 (REQ-DASH-007) -->
<div
  class="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 gap-0.5"
  role="group"
  aria-label="그리드 레이아웃 선택"
>
  {#each OPTIONS as opt (opt.value)}
    <button
      type="button"
      title={opt.title}
      aria-pressed={layout === opt.value}
      class="px-3 py-1 text-sm font-medium rounded transition-colors
        {layout === opt.value
        ? 'bg-white text-slate-900 shadow-sm'
        : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}"
      onclick={() => select(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>
