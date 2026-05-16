<script lang="ts">
/**
 * ChannelModelSlots 컴포넌트.
 *
 * 채널에 할당된 모델 슬롯 표시 + 추가/제거.
 * - GET /api/boxes/:boxId/channels/:channelId/vision-ai/models
 * - POST /api/boxes/:boxId/channels/:channelId/vision-ai/models
 * - DELETE /api/boxes/:boxId/channels/:channelId/vision-ai/models/:modelId
 */

const { boxId, channelId }: { boxId: string; channelId: string } = $props();

interface AssignedModel {
  modelId: string;
  name: string;
  version?: string;
}

interface GlobalModel {
  modelId: string;
  name: string;
  version?: string;
}

let assignedModels = $state<AssignedModel[]>([]);
let globalModels = $state<GlobalModel[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let selectedModelId = $state('');
let assigning = $state(false);
let removingId = $state<string | null>(null);

async function loadData() {
  loading = true;
  error = null;
  try {
    const [assignedRes, globalRes] = await Promise.all([
      fetch(`/api/boxes/${boxId}/channels/${channelId}/vision-ai/models`),
      fetch(`/api/boxes/${boxId}/models`),
    ]);

    if (assignedRes.ok) {
      const body = (await assignedRes.json()) as unknown;
      if (Array.isArray(body)) assignedModels = body as AssignedModel[];
      else if (
        typeof body === 'object' &&
        body !== null &&
        'models' in body &&
        Array.isArray((body as { models: unknown[] }).models)
      ) {
        assignedModels = (body as { models: AssignedModel[] }).models;
      }
    }

    if (globalRes.ok) {
      const body = (await globalRes.json()) as unknown;
      if (Array.isArray(body)) globalModels = body as GlobalModel[];
      else if (
        typeof body === 'object' &&
        body !== null &&
        'models' in body &&
        Array.isArray((body as { models: unknown[] }).models)
      ) {
        globalModels = (body as { models: GlobalModel[] }).models;
      }
    }
  } catch {
    error = '모델 정보를 불러올 수 없습니다';
  } finally {
    loading = false;
  }
}

async function handleAssign() {
  if (!selectedModelId) return;
  assigning = true;
  error = null;
  try {
    const res = await fetch(
      `/api/boxes/${boxId}/channels/${channelId}/vision-ai/models`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModelId }),
      },
    );
    if (!res.ok) {
      error = `모델 할당 실패 (HTTP ${res.status})`;
    } else {
      selectedModelId = '';
      await loadData();
    }
  } catch {
    error = '모델 할당 중 오류가 발생했습니다';
  } finally {
    assigning = false;
  }
}

async function handleRemove(modelId: string) {
  removingId = modelId;
  error = null;
  try {
    const res = await fetch(
      `/api/boxes/${boxId}/channels/${channelId}/vision-ai/models/${modelId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      error = `모델 제거 실패 (HTTP ${res.status})`;
    } else {
      assignedModels = assignedModels.filter((m) => m.modelId !== modelId);
    }
  } catch {
    error = '모델 제거 중 오류가 발생했습니다';
  } finally {
    removingId = null;
  }
}

// 이미 할당되지 않은 글로벌 모델만 드롭다운에 표시
const availableModels = $derived(
  globalModels.filter((g) => !assignedModels.some((a) => a.modelId === g.modelId)),
);

$effect(() => {
  loadData();
});
</script>

<div class="mt-3 border-t border-slate-100 pt-3 space-y-2">
  <div class="flex items-center justify-between">
    <p class="text-xs font-medium text-slate-600">모델 슬롯</p>
  </div>

  {#if error}
    <div class="rounded border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs text-rose-700" role="alert">
      {error}
    </div>
  {/if}

  {#if loading}
    <p class="text-xs text-slate-400">로딩 중...</p>
  {:else}
    <!-- 할당된 모델 목록 -->
    {#if assignedModels.length === 0}
      <p class="text-xs text-slate-400">할당된 모델이 없습니다.</p>
    {:else}
      <ul class="space-y-1">
        {#each assignedModels as model (model.modelId)}
          <li class="flex items-center justify-between gap-2 rounded bg-slate-50 px-2.5 py-1.5">
            <div class="min-w-0">
              <span class="text-xs font-medium text-slate-700 truncate">{model.name}</span>
              {#if model.version}
                <span class="ml-1 text-xs text-slate-400">v{model.version}</span>
              {/if}
            </div>
            <button
              type="button"
              onclick={() => handleRemove(model.modelId)}
              disabled={removingId === model.modelId}
              class="shrink-0 text-xs text-rose-500 hover:text-rose-700 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              제거
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- 모델 추가 드롭다운 -->
    {#if availableModels.length > 0}
      <div class="flex gap-2 items-center">
        <select
          bind:value={selectedModelId}
          class="flex-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700
                 focus:outline-none focus:ring-1 focus:ring-slate-400"
        >
          <option value="">모델 선택...</option>
          {#each availableModels as m (m.modelId)}
            <option value={m.modelId}>{m.name}{m.version ? ` (v${m.version})` : ''}</option>
          {/each}
        </select>
        <button
          type="button"
          onclick={handleAssign}
          disabled={assigning || !selectedModelId}
          class="rounded border border-slate-800 bg-slate-800 px-2.5 py-1 text-xs font-medium text-white
                 hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {assigning ? '추가 중...' : '추가'}
        </button>
      </div>
    {/if}
  {/if}
</div>
