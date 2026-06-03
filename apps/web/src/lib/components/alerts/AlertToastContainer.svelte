<script lang="ts">
/**
 * AlertToastContainer 컴포넌트.
 *
 * 토스트 스택 관리 + SSE 스트림 연결.
 * - 마운트 시 connectAlertStream 호출
 * - 언마운트 시 스트림 닫기
 * - 우측 하단 고정 위치에 최대 5개 토스트 렌더링
 */

import { connectAlertStream, type AlertEvent } from '$lib/alertStream';
import AlertToast from './AlertToast.svelte';

const MAX_TOASTS = 5;

let toasts = $state<Array<AlertEvent & { key: string }>>([]);

function addToast(alert: AlertEvent) {
  const key = `${alert.id}-${Date.now()}`;
  toasts = [{ ...alert, key }, ...toasts].slice(0, MAX_TOASTS);
}

function removeToast(key: string) {
  toasts = toasts.filter((t) => t.key !== key);
}

$effect(() => {
  const connection = connectAlertStream({
    onAlert: addToast,
    onConnect: () => {
      // 연결 성공 — 필요 시 상태 표시 가능
    },
    onError: () => {
      // 재연결은 alertStream 내부에서 처리
    },
  });

  return () => {
    connection.close();
  };
});
</script>

<!-- 우측 하단 고정 토스트 영역 -->
<div
  class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
  aria-live="polite"
  aria-label="알림 토스트"
>
  {#each toasts as toast (toast.key)}
    <div class="pointer-events-auto">
      <AlertToast alert={toast} onDismiss={() => removeToast(toast.key)} />
    </div>
  {/each}
</div>
