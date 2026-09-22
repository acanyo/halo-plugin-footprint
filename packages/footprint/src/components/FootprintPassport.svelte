<!--
  护照集章 + 命运抽票。

  集章状态存在本机（localStorage），不上传服务端——这是原实现的设计，
  它记录的是「这台设备上的人真的看过哪些票根」。

  逻辑在 utils/passport.ts（纯函数、有测试），本组件只做展示。
-->
<svelte:options customElement={{ tag: 'footprint-passport' }} />

<script lang="ts">
import { fade, fly } from 'svelte/transition';
import type { Footprint } from '../types/footprint';
import {
  addStamp,
  drawOracle,
  loadStamps,
  passportProgress,
  resetStamps,
  stampIdOf,
  STAMP_DWELL_MS,
} from '../utils/passport';
import { applyImageRule, normalizeAttachmentUrl } from '../utils/image';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

type Mode = 'passport' | 'oracle';

let host = $state<HTMLElement>();
let open = $state(false);
let mode = $state<Mode>('passport');
/** 改这个值触发集章进度重算；localStorage 不是响应式的，需要手动打点 */
let stampVersion = $state(0);

let oraclePicked = $state<Footprint | null>(null);
let oracleInspiration = $state('');
let shuffling = $state(false);

const tickets = $derived(
  store.footprints.filter((fp) => normalizeAttachmentUrl(fp.spec.ticketImage))
);

const progress = $derived.by(() => {
  stampVersion; // 建立依赖
  return passportProgress(tickets);
});

const stampedIds = $derived.by(() => {
  stampVersion;
  return new Set(loadStamps().map((r) => r.id));
});

export function show(which: Mode = 'passport') {
  mode = which;
  open = true;
  if (which === 'oracle') draw();
}

export function close() {
  open = false;
}

/**
 * 正式浏览某张票根时调用。停留超过阈值才盖章——
 * 快速翻页不该把所有章都刷出来，集章的意义在于「真的看过」。
 */
export function markViewed(fp: Footprint): () => void {
  const id = stampIdOf(fp);
  const timer = setTimeout(() => {
    if (addStamp(id)) stampVersion++;
  }, STAMP_DWELL_MS);
  return () => clearTimeout(timer);
}

function draw() {
  shuffling = true;
  // 洗牌动效：短暂延迟后出结果，太快出结果没有"抽"的感觉
  setTimeout(() => {
    const r = drawOracle(tickets, store.footprints);
    oraclePicked = r.picked;
    oracleInspiration = r.inspiration;
    shuffling = false;
  }, 600);
}

function viewPicked() {
  if (!host || !oraclePicked) return;
  emit(host, 'footprint:flyto', {
    longitude: oraclePicked.spec.longitude,
    latitude: oraclePicked.spec.latitude,
    zoom: 30000,
  });
  close();
}

function doReset() {
  resetStamps();
  stampVersion++;
}

function coverOf(fp: Footprint): string {
  return applyImageRule(normalizeAttachmentUrl(fp.spec.ticketImage), store.config, 'cityWall');
}

function onKeydown(e: KeyboardEvent) {
  if (open && e.key === 'Escape') close();
}
</script>

<svelte:window on:keydown={onKeydown} />

<div bind:this={host}>
  {#if open}
    <div
      class="fixed inset-0 z-[var(--footprint-z-overlay)] overflow-y-auto bg-black/80 p-6"
      transition:fade={{ duration: 160 }}
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'passport' ? '护照集章' : '命运抽票'}
    >
      <div class="mx-auto w-[min(92vw,720px)] text-white">
        {#if mode === 'passport'}
          <div class="mb-5 flex items-center justify-between gap-3">
            <h2 class="text-lg">
              护照集章
              <span class="ml-2 text-sm tabular-nums text-white/55">
                {progress.collected} / {progress.total}
              </span>
            </h2>
            <div class="flex gap-2">
              <button class="rounded border border-white/30 px-3 py-1 text-sm" onclick={doReset}>
                重置
              </button>
              <button class="rounded border border-white/30 px-3 py-1 text-sm" onclick={close}>
                关闭
              </button>
            </div>
          </div>

          {#if progress.complete}
            <p
              class="mb-5 rounded-[var(--footprint-radius)] bg-gradient-to-r from-amber-400/25 to-amber-200/10 p-4 text-center text-sm text-amber-200"
              transition:fly={{ y: 8, duration: 220 }}
            >
              集齐了。这本护照上的每一张票，你都真的看过。
            </p>
          {/if}

          <div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {#each tickets as fp (fp.metadata.name)}
              {@const stamped = stampedIds.has(stampIdOf(fp))}
              <div
                class="relative aspect-[3/4] overflow-hidden rounded border"
                class:border-amber-300={stamped}
                class:border-white-15={!stamped}
                class:opacity-35={!stamped}
              >
                <img src={coverOf(fp)} alt={fp.spec.name} class="h-full w-full object-cover" />
                {#if stamped}
                  <span
                    class="absolute right-1 top-1 rounded-full bg-amber-300 px-1.5 py-0.5 text-[10px] text-black"
                  >
                    已集
                  </span>
                {/if}
              </div>
            {/each}
          </div>

          {#if !tickets.length}
            <p class="py-16 text-center text-sm text-white/50">还没有票根</p>
          {/if}
        {:else}
          <div class="flex flex-col items-center gap-5 py-10 text-center">
            <h2 class="text-lg">命运抽票</h2>
            {#if shuffling}
              <div class="h-64 w-48 animate-pulse rounded-[var(--footprint-radius)] bg-white/10"></div>
              <p class="text-sm text-white/55">洗牌中…</p>
            {:else if oraclePicked}
              <img
                src={coverOf(oraclePicked)}
                alt={oraclePicked.spec.name}
                class="max-h-64 rounded-[var(--footprint-radius)]"
                transition:fly={{ y: 10, duration: 240 }}
              />
              <div>
                <p class="text-base">{oraclePicked.spec.name}</p>
                <p class="text-xs text-white/55">{oraclePicked.spec.city}</p>
              </div>
              {#if oracleInspiration}
                <p class="text-sm text-white/70">
                  下一站，或许可以去 <span class="text-amber-200">{oracleInspiration}</span>
                </p>
              {/if}
              <div class="flex gap-2">
                <button class="rounded border border-white/30 px-4 py-1.5 text-sm" onclick={viewPicked}>
                  去看看
                </button>
                <button class="rounded border border-white/30 px-4 py-1.5 text-sm" onclick={draw}>
                  再抽一张
                </button>
                <button class="rounded border border-white/30 px-4 py-1.5 text-sm" onclick={close}>
                  关闭
                </button>
              </div>
            {:else}
              <p class="text-sm text-white/55">还没有票根可抽</p>
              <button class="rounded border border-white/30 px-4 py-1.5 text-sm" onclick={close}>
                关闭
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
