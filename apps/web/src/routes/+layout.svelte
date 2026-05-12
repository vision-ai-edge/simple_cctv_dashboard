<script lang="ts">
/**
 * 루트 레이아웃.
 *
 * 전역 CSS 임포트 및 공통 메타데이터를 담당한다.
 * 인증된 영역의 레이아웃은 (app)/+layout.svelte에서 제공한다.
 */

import '../app.css';

const { children } = $props();
</script>

{@render children()}
