<script lang="ts">
/**
 * /boxes/[id]/models 전역 모델 관리 페이지.
 *
 * - 모델 목록 표시
 * - 업로드 폼 (modelFile + metadataFile, FormData POST)
 * - 삭제 버튼
 */

import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

let modelFile = $state<File | null>(null);
let metadataFile = $state<File | null>(null);
let uploading = $state(false);
let uploadError = $state<string | null>(null);
let uploadSuccess = $state(false);

let deletingId = $state<string | null>(null);
let deleteError = $state<string | null>(null);

// 업로드 후 목록 새로고침을 위한 로컬 복사
// $derived로 초기값 참조 후 $state로 전환하여 reactivity 경고 방지
const initialModels = $derived(data.models);
let models = $state<typeof initialModels>([]);
$effect(() => {
  if (models.length === 0) {
    models = [...initialModels];
  }
});

async function handleUpload() {
  if (!modelFile) {
    uploadError = '모델 파일을 선택하세요';
    return;
  }
  uploading = true;
  uploadError = null;
  uploadSuccess = false;

  const formData = new FormData();
  formData.append('modelFile', modelFile);
  if (metadataFile) {
    formData.append('metadataFile', metadataFile);
  }

  try {
    const res = await fetch(`/api/boxes/${data.boxId}/models`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { message?: string };
      uploadError = errBody.message ?? `업로드 실패 (HTTP ${res.status})`;
    } else {
      uploadSuccess = true;
      modelFile = null;
      metadataFile = null;
      // 목록 새로고침
      const listRes = await fetch(`/api/boxes/${data.boxId}/models`);
      if (listRes.ok) {
        const body = (await listRes.json()) as unknown;
        if (Array.isArray(body)) models = body;
        else if (
          typeof body === 'object' &&
          body !== null &&
          'models' in body &&
          Array.isArray((body as { models: unknown[] }).models)
        ) {
          models = (body as { models: typeof models }).models;
        }
      }
      setTimeout(() => {
        uploadSuccess = false;
      }, 3000);
    }
  } catch {
    uploadError = '업로드 중 오류가 발생했습니다';
  } finally {
    uploading = false;
  }
}

async function handleDelete(modelId: string) {
  deletingId = modelId;
  deleteError = null;

  try {
    const res = await fetch(`/api/boxes/${data.boxId}/models/${modelId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      deleteError = `삭제 실패 (HTTP ${res.status})`;
    } else {
      models = models.filter((m) => m.modelId !== modelId);
    }
  } catch {
    deleteError = '삭제 중 오류가 발생했습니다';
  } finally {
    deletingId = null;
  }
}
</script>

<svelte:head>
  <title>모델 관리 - CCTV Dashboard</title>
</svelte:head>

<div class="max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a
      href="/boxes/{data.boxId}"
      class="text-sm text-slate-500 hover:text-slate-800 transition-colors"
    >
      ← Box 상세로
    </a>
  </div>

  <h2 class="text-xl font-semibold text-slate-900">모델 관리</h2>

  {#if data.loadError}
    <div class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
      {data.loadError}
    </div>
  {/if}

  <!-- 업로드 폼 -->
  <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
    <h3 class="text-sm font-semibold text-slate-900">모델 업로드</h3>

    {#if uploadError}
      <div class="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
        {uploadError}
      </div>
    {/if}
    {#if uploadSuccess}
      <div class="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        업로드 성공
      </div>
    {/if}

    <div class="space-y-3">
      <div>
        <label for="model-file" class="block text-xs font-medium text-slate-700 mb-1">
          모델 파일 <span class="text-rose-500">*</span>
        </label>
        <input
          id="model-file"
          type="file"
          onchange={(e) => {
            const target = e.target as HTMLInputElement;
            modelFile = target.files?.[0] ?? null;
          }}
          class="block w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3
                 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-medium
                 file:bg-white file:text-slate-700 hover:file:bg-slate-50 file:transition-colors
                 cursor-pointer"
        />
      </div>

      <div>
        <label for="metadata-file" class="block text-xs font-medium text-slate-700 mb-1">
          메타데이터 파일 <span class="text-slate-400">(선택)</span>
        </label>
        <input
          id="metadata-file"
          type="file"
          onchange={(e) => {
            const target = e.target as HTMLInputElement;
            metadataFile = target.files?.[0] ?? null;
          }}
          class="block w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3
                 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-medium
                 file:bg-white file:text-slate-700 hover:file:bg-slate-50 file:transition-colors
                 cursor-pointer"
        />
      </div>

      <button
        type="button"
        onclick={handleUpload}
        disabled={uploading || !modelFile}
        class="rounded-md border border-slate-800 bg-slate-800 px-4 py-2 text-xs font-medium text-white
               hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {uploading ? '업로드 중...' : '업로드'}
      </button>
    </div>
  </div>

  <!-- 모델 목록 -->
  <div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
    <div class="border-b border-slate-200 px-5 py-3">
      <h3 class="text-sm font-semibold text-slate-900">모델 목록 ({models.length})</h3>
    </div>

    {#if deleteError}
      <div class="px-5 py-2 text-xs text-rose-700 border-b border-rose-100 bg-rose-50" role="alert">
        {deleteError}
      </div>
    {/if}

    {#if models.length === 0}
      <div class="px-5 py-8 text-center text-sm text-slate-500">
        등록된 모델이 없습니다.
      </div>
    {:else}
      <ul class="divide-y divide-slate-100">
        {#each models as model (model.modelId)}
          <li class="flex items-center justify-between px-5 py-3 gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-slate-900 truncate">{model.name}</p>
              <p class="text-xs text-slate-400 font-mono mt-0.5">{model.modelId}</p>
              {#if model.version}
                <p class="text-xs text-slate-500 mt-0.5">v{model.version}</p>
              {/if}
            </div>
            <button
              type="button"
              onclick={() => handleDelete(model.modelId)}
              disabled={deletingId === model.modelId}
              class="shrink-0 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium
                     text-rose-600 hover:bg-rose-50 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deletingId === model.modelId ? '삭제 중...' : '삭제'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
