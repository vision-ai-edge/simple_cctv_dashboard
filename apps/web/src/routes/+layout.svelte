<script lang="ts">
import '../app.css';

const { children } = $props();
</script>

<div class="min-h-screen flex flex-col">
  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-slate-900">CCTV Dashboard</h1>
      <nav class="text-sm text-slate-500">v0.1.0</nav>
    </div>
  </header>
  <main class="flex-1 mx-auto max-w-6xl w-full px-6 py-8">
    {@render children?.()}
  </main>
</div>
