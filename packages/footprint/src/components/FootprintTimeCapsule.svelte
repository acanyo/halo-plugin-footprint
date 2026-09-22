<!--
  去年今天：历史上同月同日有足迹时，回看当天的照片与票根。

  入口是否显示由页面根据 timeCapsuleItems() 是否为空决定——
  没有往年的今天却摆着入口，点进去一片空白，比不显示更糟。
-->
<svelte:options customElement={{ tag: 'footprint-time-capsule' }} />

<script lang="ts">
import { fade, fly } from 'svelte/transition';
import { timeCapsuleItems } from '../utils/insight';
import { applyImageRule, galleryOf } from '../utils/image';
import { formatDate } from '../utils/date';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

let host = $state<HTMLElement>();
let open = $state(false);
let index = $state(0);

const items = $derived(timeCapsuleItems(store.footprints));
const current = $derived(items[index]);
const cover = $derived(
  current ? applyImageRule(galleryOf(current.spec)[0]?.url ?? '', store.config, 'timeline') : ''
);

/** 距今几年 */
const yearsAgo = $derived.by(() => {
  if (!current?.spec.createTime) return 0;
  const y = Number(String(current.spec.createTime).slice(0, 4));
  return y ? new Date().getFullYear() - y : 0;
});

/** 供页面判断入口该不该显示 */
export function hasItems(): boolean {
  return items.length > 0;
}

export function show() {
  if (!items.length) return;
  index = 0;
  open = true;
}

export function close() {
  open = false;
}

function step(delta: number) {
  if (items.length < 2) return;
  index = (index + delta + items.length) % items.length;
}

function locate() {
  if (!host || !current) return;
  emit(host, 'footprint:flyto', {
    longitude: current.spec.longitude,
    latitude: current.spec.latitude,
    zoom: 30000,
  });
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (!open) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
}
</script>

<svelte:window on:keydown={onKeydown} />

<div bind:this={host}>
  {#if open && current}
    <div
      class="fixed inset-0 z-[var(--footprint-z-overlay)] flex items-center justify-center bg-black/75 p-6"
      transition:fade={{ duration: 160 }}
      role="dialog"
      aria-modal="true"
      aria-label="去年今天"
    >
      <div
        class="w-[min(90vw,420px)] overflow-hidden rounded-[var(--footprint-radius)] bg-black/60 text-white"
        transition:fly={{ y: 12, duration: 220 }}
      >
        <p class="px-5 pt-5 text-sm text-white/55">
          {yearsAgo > 0 ? `${yearsAgo} 年前的今天` : '往年的今天'}
        </p>

        {#if cover}
          <img src={cover} alt="" class="mt-3 h-52 w-full object-cover" />
        {/if}

        <div class="space-y-1 p-5">
          <p class="text-base">{current.spec.name}</p>
          <p class="text-xs text-white/60">
            {[current.spec.city, formatDate(current.spec.createTime, 'lightbox')]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {#if current.spec.description}
            <p class="pt-2 text-sm leading-relaxed text-white/80">{current.spec.description}</p>
          {/if}
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3 text-sm">
          <div class="flex items-center gap-3">
            <button aria-label="上一条" onclick={() => step(-1)}>‹</button>
            <span class="tabular-nums text-white/50">{index + 1} / {items.length}</span>
            <button aria-label="下一条" onclick={() => step(1)}>›</button>
          </div>
          <div class="flex gap-2">
            <button class="rounded border border-white/30 px-3 py-1 text-xs" onclick={locate}>
              定位
            </button>
            <button class="rounded border border-white/30 px-3 py-1 text-xs" onclick={close}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
