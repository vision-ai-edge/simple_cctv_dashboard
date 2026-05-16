<script lang="ts">
/**
 * AlertToast 컴포넌트.
 *
 * 개별 알림 토스트 팝업.
 * - 8초 후 자동 닫힘
 * - onDismiss 콜백 호출로 부모에게 제거 위임
 */

import type { AlertEvent } from '$lib/alertStream';

const {
  alert,
  onDismiss,
}: {
  alert: AlertEvent;
  onDismiss: () => void;
} = $props();

let timer: ReturnType<typeof setTimeout> | null = null;

$effect(() => {
  timer = setTimeout(() => {
    onDismiss();
  }, 8000);

  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
});

function handleDismiss() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  onDismiss();
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
</script>

<div
  role="alert"
  class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-md min-w-72 max-w-sm"
>
  <!-- 아이콘 -->
  <div class="shrink-0 mt-0.5">
    <span
      class="inline-flex size-5 items-center justify-center rounded-full bg-amber-400 text-white text-xs font-bold"
      aria-hidden="true"
    >
      !
    </span>
  </div>

  <!-- 내용 -->
  <div class="flex-1 min-w-0">
    <p class="text-sm font-semibold text-amber-900 truncate">
      감지 이벤트: {alert.type}
    </p>
    <p class="text-xs text-amber-700 mt-0.5 truncate">
      채널: {alert.channelId} · Box: {alert.boxId}
    </p>
    <p class="text-xs text-amber-600 mt-0.5">
      {formatTime(alert.firedAt)}
    </p>
  </div>

  <!-- 닫기 버튼 -->
  <button
    type="button"
    onclick={handleDismiss}
    class="shrink-0 size-5 flex items-center justify-center rounded text-amber-600 hover:text-amber-900 hover:bg-amber-100 transition-colors"
    aria-label="토스트 닫기"
  >
    ✕
  </button>
</div>
