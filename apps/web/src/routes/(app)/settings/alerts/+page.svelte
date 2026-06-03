<script lang="ts">
/**
 * /settings/alerts 알림 설정 페이지.
 *
 * 세 채널 토글:
 * - toast: 브라우저 토스트 (항상 사용 가능)
 * - webpush: 브라우저 WebPush 구독
 * - telegram: Telegram Bot 알림 + chat_id 입력
 */

import {
  getWebPushSubscription,
  subscribeWebPush,
  unsubscribeWebPush,
} from '$lib/webpush';
import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

// 채널별 로컬 상태 (서버 데이터에서 초기화)
function getEnabled(channel: string): boolean {
  return data.destinations.find((d) => d.channel === channel)?.enabled ?? false;
}
function getConfig(channel: string): Record<string, string> {
  return (data.destinations.find((d) => d.channel === channel)?.config as Record<string, string>) ?? {};
}

let toastEnabled = $state(getEnabled('toast'));
let webpushEnabled = $state(getEnabled('webpush'));
let telegramEnabled = $state(getEnabled('telegram'));
let telegramChatId = $state(getConfig('telegram')['chat_id'] ?? '');
let telegramChatIdError = $state<string | null>(null);

let savingChannel = $state<string | null>(null);
let saveError = $state<string | null>(null);
let saveSuccess = $state<string | null>(null);

async function updateDestination(
  channel: string,
  enabled: boolean,
  config?: Record<string, string>,
) {
  savingChannel = channel;
  saveError = null;
  saveSuccess = null;

  try {
    const res = await fetch(`/api/alerts/destinations/${channel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, config }),
    });
    if (!res.ok) {
      saveError = `저장 실패 (HTTP ${res.status})`;
    } else {
      saveSuccess = channel;
      setTimeout(() => {
        saveSuccess = null;
      }, 3000);
    }
  } catch {
    saveError = '저장 중 오류가 발생했습니다';
  } finally {
    savingChannel = null;
  }
}

async function handleToastToggle() {
  toastEnabled = !toastEnabled;
  await updateDestination('toast', toastEnabled);
}

async function handleWebpushToggle() {
  if (!webpushEnabled) {
    // 구독 요청
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      saveError = '브라우저 알림 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.';
      return;
    }
    try {
      await subscribeWebPush(fetch);
      webpushEnabled = true;
      await updateDestination('webpush', true);
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'WebPush 구독 실패';
    }
  } else {
    // 구독 해제
    try {
      await unsubscribeWebPush(fetch);
      webpushEnabled = false;
      await updateDestination('webpush', false);
    } catch {
      saveError = 'WebPush 구독 해제 실패';
    }
  }
}

async function handleTelegramToggle() {
  if (!telegramEnabled) {
    if (!telegramChatId.trim()) {
      telegramChatIdError = 'Chat ID를 입력하세요';
      return;
    }
    telegramEnabled = true;
    await updateDestination('telegram', true, { chat_id: telegramChatId.trim() });
  } else {
    telegramEnabled = false;
    await updateDestination('telegram', false);
  }
}

async function handleTelegramSaveConfig() {
  telegramChatIdError = null;
  const chatId = telegramChatId.trim();
  if (!chatId) {
    telegramChatIdError = 'Chat ID를 입력하세요';
    return;
  }
  if (!/^-?\d+$/.test(chatId)) {
    telegramChatIdError = '유효한 Chat ID 형식이 아닙니다 (숫자)';
    return;
  }
  await updateDestination('telegram', telegramEnabled, { chat_id: chatId });
}

// 현재 WebPush 구독 상태 확인 (브라우저에서만)
$effect(() => {
  if (typeof window !== 'undefined') {
    getWebPushSubscription().then((sub) => {
      if (sub) webpushEnabled = true;
    });
  }
});
</script>

<svelte:head>
  <title>알림 설정 - CCTV Dashboard</title>
</svelte:head>

<div class="max-w-2xl space-y-6">
  <h2 class="text-xl font-semibold text-slate-900">알림 설정</h2>

  {#if data.loadError}
    <div class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
      {data.loadError}
    </div>
  {/if}

  {#if saveError}
    <div class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
      {saveError}
    </div>
  {/if}

  <!-- Toast 채널 -->
  <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-semibold text-slate-900">브라우저 토스트</h3>
        <p class="text-xs text-slate-500 mt-0.5">감지 이벤트 발생 시 화면 우측 하단에 토스트 알림 표시</p>
      </div>
      <button
        type="button"
        onclick={handleToastToggle}
        disabled={savingChannel === 'toast'}
        class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors
               focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1
               disabled:opacity-50 disabled:cursor-not-allowed
               {toastEnabled ? 'bg-slate-800' : 'bg-slate-200'}"
        aria-label="토스트 알림 {toastEnabled ? '비활성화' : '활성화'}"
        aria-pressed={toastEnabled}
      >
        <span
          class="inline-block size-4 rounded-full bg-white shadow transition-transform
                 {toastEnabled ? 'translate-x-6' : 'translate-x-1'}"
        ></span>
      </button>
    </div>
    {#if saveSuccess === 'toast'}
      <p class="text-xs text-emerald-600">저장되었습니다</p>
    {/if}
  </div>

  <!-- WebPush 채널 -->
  <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-semibold text-slate-900">웹 푸시 알림</h3>
        <p class="text-xs text-slate-500 mt-0.5">브라우저 푸시 알림 (사이트를 열지 않아도 수신 가능)</p>
      </div>
      <button
        type="button"
        onclick={handleWebpushToggle}
        disabled={savingChannel === 'webpush'}
        class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors
               focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1
               disabled:opacity-50 disabled:cursor-not-allowed
               {webpushEnabled ? 'bg-slate-800' : 'bg-slate-200'}"
        aria-label="웹 푸시 알림 {webpushEnabled ? '비활성화' : '활성화'}"
        aria-pressed={webpushEnabled}
      >
        <span
          class="inline-block size-4 rounded-full bg-white shadow transition-transform
                 {webpushEnabled ? 'translate-x-6' : 'translate-x-1'}"
        ></span>
      </button>
    </div>
    {#if saveSuccess === 'webpush'}
      <p class="text-xs text-emerald-600">저장되었습니다</p>
    {/if}
  </div>

  <!-- Telegram 채널 -->
  <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-semibold text-slate-900">Telegram 알림</h3>
        <p class="text-xs text-slate-500 mt-0.5">Telegram Bot을 통해 메시지 수신</p>
      </div>
      <button
        type="button"
        onclick={handleTelegramToggle}
        disabled={savingChannel === 'telegram'}
        class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors
               focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1
               disabled:opacity-50 disabled:cursor-not-allowed
               {telegramEnabled ? 'bg-slate-800' : 'bg-slate-200'}"
        aria-label="Telegram 알림 {telegramEnabled ? '비활성화' : '활성화'}"
        aria-pressed={telegramEnabled}
      >
        <span
          class="inline-block size-4 rounded-full bg-white shadow transition-transform
                 {telegramEnabled ? 'translate-x-6' : 'translate-x-1'}"
        ></span>
      </button>
    </div>

    <!-- Chat ID 입력 -->
    <div class="space-y-2">
      <label for="telegram-chat-id" class="block text-xs font-medium text-slate-700">
        Telegram Chat ID
      </label>
      <div class="flex gap-2">
        <input
          id="telegram-chat-id"
          type="text"
          bind:value={telegramChatId}
          placeholder="-1001234567890"
          class="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900
                 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400
                 {telegramChatIdError ? 'border-rose-400' : ''}"
        />
        <button
          type="button"
          onclick={handleTelegramSaveConfig}
          disabled={savingChannel === 'telegram'}
          class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700
                 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          저장
        </button>
      </div>
      {#if telegramChatIdError}
        <p class="text-xs text-rose-600">{telegramChatIdError}</p>
      {/if}
      <p class="text-xs text-slate-500">
        Bot을 채팅방에 추가한 뒤 Chat ID를 입력하세요. 개인 채팅은 양수, 그룹은 음수입니다.
      </p>
    </div>

    {#if saveSuccess === 'telegram'}
      <p class="text-xs text-emerald-600">저장되었습니다</p>
    {/if}
  </div>
</div>
