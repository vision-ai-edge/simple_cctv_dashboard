<script lang="ts">
/**
 * 로그인 페이지.
 *
 * SvelteKit form actions 패턴을 사용한다.
 * use:enhance로 자바스크립트 점진적 향상을 적용하여 로딩 상태를 처리한다.
 */

import { enhance } from '$app/forms';
import type { ActionData } from './$types';

const { form }: { form: ActionData } = $props();

// biome-ignore lint/style/useConst: Svelte 5 $state rune requires let declaration
let submitting = $state(false);
</script>

<svelte:head>
  <title>로그인 - CCTV Dashboard</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
  <div class="w-full max-w-sm">
    <!-- 로그인 카드 -->
    <div class="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div class="mb-6 text-center">
        <h1 class="text-2xl font-semibold text-slate-900">CCTV Dashboard</h1>
        <p class="mt-1 text-sm text-slate-500">계속하려면 로그인하세요</p>
      </div>

      <!-- 오류 메시지 -->
      {#if form?.error}
        <div
          class="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          role="alert"
        >
          {form.error}
        </div>
      {/if}

      <form
        method="POST"
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            submitting = false;
            await update();
          };
        }}
        class="space-y-4"
      >
        <!-- 아이디 필드 -->
        <div>
          <label for="username" class="block text-sm font-medium text-slate-700 mb-1">
            아이디
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autocomplete="username"
            required
            maxlength="64"
            value={form?.username ?? ''}
            disabled={submitting}
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400
                   focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                   disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            placeholder="아이디를 입력하세요"
          />
        </div>

        <!-- 비밀번호 필드 -->
        <div>
          <label for="password" class="block text-sm font-medium text-slate-700 mb-1">
            비밀번호
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            maxlength="128"
            disabled={submitting}
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400
                   focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                   disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            placeholder="비밀번호를 입력하세요"
          />
        </div>

        <!-- 로그인 버튼 -->
        <button
          type="submit"
          disabled={submitting}
          class="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white
                 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                 disabled:cursor-not-allowed disabled:bg-blue-400 transition-colors"
        >
          {submitting ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  </div>
</div>
