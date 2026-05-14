<script lang="ts">
/**
 * /(app) 루트 페이지 — /dashboard 서버 리다이렉트 fallback.
 *
 * REQ-DASH-001: +page.server.ts 에서 303 redirect 를 처리하므로
 * 이 컴포넌트는 실제로 렌더링되지 않는다.
 * 브라우저 JS 비활성화 환경에서도 서버 리다이렉트가 동작한다.
 */
</script>

<!-- +page.server.ts 에서 /dashboard 로 리다이렉트하므로 이 내용은 렌더링되지 않는다 -->
<div></div>
