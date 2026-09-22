<!--
  照片环：点足迹标记后围绕标记铺开的多图预览。

  设计要点逐条迁自原实现：
  - 不取代详情卡（卡片照旧从侧边滑入），环另外浮在标记周围；
  - 缩略图铺在一段半环上，第 N+1 位是「全部 M 张 ›」；
  - 点某张 → 原地放大成窗口化查看器（不全屏），←/→ 切换、Esc 退回；
  - Esc 逐级关闭：查看模式 → 环 → 卡片。

  布局算法在 utils/ring-layout.ts（纯函数、有测试），本组件只做渲染与交互。
-->
<svelte:options customElement={{ tag: 'footprint-photo-ring' }} />

<script lang="ts">
import { fade, scale as scaleTransition } from 'svelte/transition';
import type { Footprint, LightboxImage } from '../types/footprint';
import { applyImageRule, galleryOf } from '../utils/image';
import { layoutRing, ringEnabled, type Rect, type RingLayoutResult } from '../utils/ring-layout';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

/** 环上固定展示张数，第 N+1 个位置放「全部 ›」 */
const RING_COUNT = 5;

/** 缩略图尺寸盒：按实际宽高比等比缩放后约束在这个范围内 */
const THUMB_W = 160;
const THUMB_H = 120;

let host = $state<HTMLElement>();
let open = $state(false);
let viewing = $state<number | null>(null);
let anchor = $state({ x: 0, y: 0 });
let obstacles = $state<Rect[]>([]);
let footprint = $state<Footprint | null>(null);
let viewportW = $state(typeof window === 'undefined' ? 1440 : window.innerWidth);
let viewportH = $state(typeof window === 'undefined' ? 900 : window.innerHeight);

const allImages = $derived<LightboxImage[]>(
  footprint
    ? galleryOf(footprint.spec).map((img) => ({
        ...img,
        url: applyImageRule(img.url, store.config, 'timeline'),
      }))
    : []
);

const ringImages = $derived(allImages.slice(0, RING_COUNT));
const hasMore = $derived(allImages.length > RING_COUNT);

const layout = $derived.by<RingLayoutResult | null>(() => {
  if (!open || !ringImages.length) return null;
  // 「全部 ›」也占一个位置，一起参与布局
  const items = Array.from({ length: ringImages.length + (hasMore ? 1 : 0) }, () => ({
    width: THUMB_W,
    height: THUMB_H,
  }));
  return layoutRing({
    anchor,
    items,
    viewport: { width: viewportW, height: viewportH },
    obstacles,
  });
});

/**
 * 打开照片环。
 * @param anchorPoint 标记在视口中的坐标
 * @param avoid 需要避开的矩形，通常是详情卡的 getBoundingClientRect()
 */
export function show(fp: Footprint, anchorPoint: { x: number; y: number }, avoid: Rect[] = []) {
  if (!ringEnabled(window.innerWidth, window.matchMedia('(pointer: coarse)').matches)) return;
  footprint = fp;
  anchor = anchorPoint;
  obstacles = avoid;
  viewing = null;
  open = true;
}

export function close() {
  open = false;
  viewing = null;
  footprint = null;
}

/** Esc 逐级退：查看模式 → 环。再往上（关卡片）由页面处理。 */
function onKeydown(e: KeyboardEvent) {
  if (!open) return;
  if (e.key === 'Escape') {
    if (viewing !== null) viewing = null;
    else close();
    return;
  }
  if (viewing === null) return;
  if (e.key === 'ArrowLeft') viewing = (viewing - 1 + allImages.length) % allImages.length;
  else if (e.key === 'ArrowRight') viewing = (viewing + 1) % allImages.length;
}

function openAll() {
  if (!host) return;
  emit(host, 'footprint:open-lightbox', { images: allImages, index: 0 });
  close();
}

function onResize() {
  viewportW = window.innerWidth;
  viewportH = window.innerHeight;
}
</script>

<svelte:window on:keydown={onKeydown} on:resize={onResize} />

<div bind:this={host}>
  {#if open && layout}
    <!-- 点空白一次全关 -->
    <button
      class="fixed inset-0 z-[calc(var(--footprint-z-overlay)-1)] cursor-default"
      aria-label="关闭照片环"
      transition:fade={{ duration: 120 }}
      onclick={close}
    ></button>

    {#each ringImages as img, i (img.url)}
      <button
        class="fixed z-[var(--footprint-z-overlay)] overflow-hidden rounded-[var(--footprint-radius)] shadow-[var(--footprint-shadow-md)] ring-1 ring-white/25 transition-transform hover:scale-105"
        style="left: {layout.placements[i].x}px; top: {layout.placements[i].y}px;
               width: {THUMB_W * layout.scale}px; height: {THUMB_H * layout.scale}px;
               transform: translate(-50%, -50%);"
        transition:scaleTransition={{ duration: 160, start: 0.85 }}
        aria-label={img.caption || `第 ${i + 1} 张`}
        onclick={() => (viewing = i)}
      >
        <img src={img.url} alt="" class="h-full w-full object-cover" />
      </button>
    {/each}

    {#if hasMore}
      {@const p = layout.placements[ringImages.length]}
      <button
        class="fixed z-[var(--footprint-z-overlay)] flex items-center justify-center rounded-[var(--footprint-radius)] bg-black/70 text-sm text-white ring-1 ring-white/25"
        style="left: {p.x}px; top: {p.y}px; width: {THUMB_W * layout.scale}px;
               height: {THUMB_H * layout.scale}px; transform: translate(-50%, -50%);"
        transition:scaleTransition={{ duration: 160, start: 0.85 }}
        onclick={openAll}
      >
        全部 {allImages.length} 张 ›
      </button>
    {/if}

    <!-- 查看模式：原地放大成窗口化查看器，不全屏 -->
    {#if viewing !== null}
      {@const img = allImages[viewing]}
      <div
        class="fixed left-1/2 top-1/2 z-[var(--footprint-z-lightbox)] max-h-[80vh] max-w-[80vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--footprint-radius)] shadow-[var(--footprint-shadow-md)]"
        transition:scaleTransition={{ duration: 180, start: 0.9 }}
      >
        <button class="block" aria-label="退回照片环" onclick={() => (viewing = null)}>
          <img src={img.url} alt={img.caption ?? ''} class="max-h-[80vh] max-w-[80vw] object-contain" />
        </button>
        {#if img.caption}
          <span class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 text-sm text-white">
            {img.caption}
          </span>
        {/if}
      </div>
    {/if}
  {/if}
</div>
