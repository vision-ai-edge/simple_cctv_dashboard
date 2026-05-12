<script lang="ts">
/**
 * (app) 보호 라우트 그룹 레이아웃.
 *
 * 인증된 사용자 영역의 공통 레이아웃을 제공한다.
 * 상단 내비게이션에 로그인한 사용자 이름과 로그아웃 버튼을 표시한다.
 */

import type { LayoutData } from './$types';

const { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<div class="min-h-screen flex flex-col">
  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-slate-900">CCTV Dashboard</h1>
      <div class="flex items-center gap-4">
        <span class="text-sm text-slate-600">
          {data.user.username}
        </span>
        <!-- 로그아웃 폼 — POST /logout으로 서버 액션 호출 -->
        <form method="POST" action="/logout">
          <button
            type="submit"
            class="text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            로그아웃
          </button>
        </form>
      </div>
    </div>
  </header>
  <main class="flex-1 mx-auto max-w-6xl w-full px-6 py-8">
    {@render children()}
  </main>
</div>
