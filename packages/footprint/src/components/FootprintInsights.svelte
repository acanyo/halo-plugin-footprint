<!--
  足迹洞察：自动生成的旅行总结卡，可翻页。

  数据计算全在 utils/insight.ts（纯函数、有测试）。原实现把算法和渲染写在
  同一段 1584 行的「创意功能入口与覆盖层」里，改一条文案要在里面找半天。
-->
<svelte:options customElement={{ tag: 'footprint-insights' }} />

<script lang="ts">
import { fade, fly } from 'svelte/transition';
import { buildInsights } from '../utils/insight';
import { store } from '../stores/footprint.svelte';

let open = $state(false);
let index = $state(0);

const insights = $derived(buildInsights(store.footprints));
const current = $derived(insights[index]);

export function show() {
  if (!insights.length) return;
  index = 0;
  open = true;
}

export function close() {
  open = false;
}

function step(delta: number) {
  if (insights.length < 2) return;
  index = (index + delta + insights.length) % insights.length;
}

function onKeydown(e: KeyboardEvent) {
  if (!open) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
}
</script>

<svelte:window on:keydown={onKeydown} />

{#if open && current}
  <div
    class="fixed inset-0 z-[var(--footprint-z-overlay)] flex items-center justify-center bg-black/70 p-6"
    transition:fade={{ duration: 160 }}
    role="dialog"
    aria-modal="true"
    aria-label="足迹洞察"
  >
    <div class="w-[min(90vw,420px)] text-center text-white">
      {#key current.key}
        <div transition:fly={{ y: 10, duration: 200 }}>
          <p class="mb-3 text-sm text-white/55">{current.title}</p>
          <p class="mb-2 text-4xl font-light leading-tight">{current.value}</p>
          {#if current.detail}
            <p class="text-sm text-white/65">{current.detail}</p>
          {/if}
        </div>
      {/key}

      <div class="mt-8 flex items-center justify-center gap-4 text-sm">
        <button aria-label="上一条" onclick={() => step(-1)}>‹</button>
        <span class="tabular-nums text-white/50">{index + 1} / {insights.length}</span>
        <button aria-label="下一条" onclick={() => step(1)}>›</button>
      </div>

      <button class="mt-6 text-sm text-white/50 hover:text-white" onclick={close}>关闭</button>
    </div>
  </div>
{/if}
