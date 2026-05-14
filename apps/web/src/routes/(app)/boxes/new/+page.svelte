<script lang="ts">
/**
 * /(app)/boxes/new 등록 폼 페이지.
 *
 * SvelteKit form actions 패턴 + use:enhance 점진적 향상.
 * 실패 시 password 필드를 비워서 반환 (REQ-UI-2 [Unwanted]).
 */

import { applyAction, enhance } from '$app/forms';
import type { ActionData } from './$types';

const { form }: { form: ActionData } = $props();

// biome-ignore lint/style/useConst: Svelte 5 $state rune requires let declaration
let submitting = $state(false);
</script>

<svelte:head>
  <title>박스 등록 - CCTV Dashboard</title>
</svelte:head>

<div class="max-w-lg">
  <!-- 뒤로 가기 링크 -->
  <a
    href="/boxes"
    class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-4"
  >
    ← 박스 목록으로
  </a>

  <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 class="text-lg font-semibold text-slate-900 mb-4">새 박스 등록</h2>

    <!-- 에러 메시지 -->
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
        return async ({ result }) => {
          submitting = false;
          // applyAction 은 redirect/success/failure/error 모두 기본 동작으로 처리.
          // 직전엔 update() 만 호출하여 303 redirect 가 무시되던 문제를 해소한다.
          await applyAction(result);
        };
      }}
      class="space-y-4"
    >
      <!-- Box 이름 -->
      <div>
        <label for="name" class="block text-sm font-medium text-slate-700 mb-1">
          Box 이름 <span class="text-rose-500">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxlength="100"
          value={form?.name ?? ''}
          disabled={submitting}
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400
                 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                 disabled:cursor-not-allowed disabled:bg-slate-50"
          placeholder="예: 카메라A"
        />
      </div>

      <!-- 호스트 -->
      <div>
        <label for="host" class="block text-sm font-medium text-slate-700 mb-1">
          호스트 <span class="text-rose-500">*</span>
        </label>
        <input
          id="host"
          name="host"
          type="text"
          required
          value={form?.host ?? ''}
          disabled={submitting}
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono placeholder-slate-400
                 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                 disabled:cursor-not-allowed disabled:bg-slate-50"
          placeholder="예: 192.168.1.10 또는 box.example.com"
        />
        <p class="mt-1 text-xs text-slate-500">
          도메인 또는 IP만 입력하세요. <code>https://</code> 등 스키마와 경로는 자동으로 제거됩니다.
        </p>
      </div>

      <!-- 포트 -->
      <div>
        <label for="port" class="block text-sm font-medium text-slate-700 mb-1">
          포트 <span class="text-rose-500">*</span>
        </label>
        <input
          id="port"
          name="port"
          type="number"
          required
          min="1"
          max="65535"
          value={form?.port ?? ''}
          disabled={submitting}
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400
                 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                 disabled:cursor-not-allowed disabled:bg-slate-50"
          placeholder="예: 8080"
        />
      </div>

      <!-- 사용자 이름 -->
      <div>
        <label for="username" class="block text-sm font-medium text-slate-700 mb-1">
          사용자 이름 <span class="text-rose-500">*</span>
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autocomplete="username"
          value={form?.username ?? ''}
          disabled={submitting}
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400
                 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                 disabled:cursor-not-allowed disabled:bg-slate-50"
          placeholder="예: admin"
        />
      </div>

      <!-- 비밀번호 (항상 빈 값 — REQ-UI-2 [Unwanted]) -->
      <div>
        <label for="password" class="block text-sm font-medium text-slate-700 mb-1">
          비밀번호 <span class="text-rose-500">*</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autocomplete="current-password"
          disabled={submitting}
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400
                 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                 disabled:cursor-not-allowed disabled:bg-slate-50"
          placeholder="비밀번호를 입력하세요"
        />
      </div>

      <!-- API 키 사용 -->
      <div class="flex items-center gap-2">
        <input
          id="useApiKey"
          name="useApiKey"
          type="checkbox"
          value="on"
          checked={form?.useApiKey === 'on'}
          disabled={submitting}
          class="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        <label for="useApiKey" class="text-sm text-slate-700">
          API 키 사용 (체크 시 API 키로 인증)
        </label>
      </div>

      <!-- 제출 버튼 -->
      <button
        type="submit"
        disabled={submitting}
        class="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white
               hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
               disabled:cursor-not-allowed disabled:bg-blue-400 transition-colors"
      >
        {submitting ? '등록 중...' : '박스 등록'}
      </button>
    </form>
  </div>
</div>
