<!--
  足迹详情卡。点击标记后弹出。

  shadow: 'open'（默认）——它是纯 UI，应该拿到样式硬边界。
  与地图层的往来只走事件：地图层调 open() 传入足迹与锚点屏幕坐标，
  卡片派发 footprint:open-lightbox / footprint:flyto 回去。
-->
<svelte:options customElement={{ tag: 'footprint-detail-card' }} />

<script lang="ts">
import { onMount } from 'svelte';
import { fly } from 'svelte/transition';
import { cubicOut } from 'svelte/easing';
import type { Footprint } from '../types/footprint';
import { galleryOf, applyImageRule } from '../utils/image';
import { formatDate } from '../utils/date';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

let open = $state(false);
let footprint = $state<Footprint | null>(null);
/** 卡片从被点的标记那一侧长出来，方向由锚点在视口中的位置决定 */
let side = $state<'left' | 'right'>('right');
let host = $state<HTMLElement>();
let panel = $state<HTMLElement>();

const images = $derived(
  footprint
    ? galleryOf(footprint.spec).map((img) => ({
        ...img,
        url: applyImageRule(img.url, store.config, 'timeline'),
      }))
    : []
);

const cover = $derived(images[0]?.url ?? '');

/**
 * 打开详情卡。
 * @param anchorX 标记在视口中的 x 坐标，决定卡片从哪一侧长出
 */
export function show(fp: Footprint, anchorX?: number) {
  footprint = fp;
  // 标记在左半屏就往右长，反之往左——避免卡片盖住被点的标记
  side = anchorX !== undefined && anchorX > window.innerWidth / 2 ? 'left' : 'right';
  open = true;
}

export function close() {
  open = false;
  footprint = null;
}

/**
 * 入场/出场用 Svelte 内置过渡，不引 GSAP。
 *
 * 这里只是「从标记那一侧滑出」的位移 + 淡入，内置过渡完全够用，而 GSAP 核心
 * 约 80 kB（gzip +31 kB）打进主包不值得。GSAP 留给真正需要 Flip / Draggable
 * 的票根页与照片环，并且在那边动态导入，不拖累首屏。
 */
const flyParams = $derived({
  x: side === 'right' ? -16 : 16,
  duration: 220,
  easing: cubicOut,
});

function openLightbox(index: number) {
  if (!host) return;
  emit(host, 'footprint:open-lightbox', { images, index });
}

function locate() {
  if (!host || !footprint) return;
  emit(host, 'footprint:flyto', {
    longitude: footprint.spec.longitude,
    latitude: footprint.spec.latitude,
    zoom: 8000,
  });
}

onMount(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
});
</script>

<div bind:this={host}>
  {#if open && footprint}
    <div
      bind:this={panel}
      transition:fly={flyParams}
      class="w-80 max-w-[86vw] overflow-hidden rounded-[var(--footprint-radius)] border border-footprint bg-footprint-surface text-footprint shadow-[var(--footprint-shadow-md)] backdrop-blur"
      role="dialog"
      aria-label="足迹详情"
    >
      {#if cover}
        <button
          class="block h-40 w-full cursor-zoom-in overflow-hidden"
          aria-label="查看大图"
          onclick={() => openLightbox(0)}
        >
          <img src={cover} alt="" class="h-full w-full object-cover" />
        </button>
      {/if}

      <div class="space-y-2 p-4">
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-base font-medium leading-snug">{footprint.spec.name}</h3>
          <button class="shrink-0 text-footprint-muted hover:text-footprint" aria-label="关闭" onclick={close}>
            ✕
          </button>
        </div>

        <p class="text-xs text-footprint-muted">
          {[footprint.spec.province, footprint.spec.city].filter(Boolean).join(' · ')}
          {#if footprint.spec.createTime}
            <span class="ml-2">{formatDate(footprint.spec.createTime, 'lightbox')}</span>
          {/if}
        </p>

        {#if footprint.spec.address}
          <p class="text-xs text-footprint-muted">{footprint.spec.address}</p>
        {/if}

        {#if footprint.spec.description}
          <p class="text-sm leading-relaxed">{footprint.spec.description}</p>
        {/if}

        {#if images.length > 1}
          <div class="flex gap-1.5 overflow-x-auto pb-1">
            {#each images.slice(0, 6) as img, i (img.url)}
              <button
                class="h-12 w-12 shrink-0 overflow-hidden rounded"
                aria-label={`查看第 ${i + 1} 张图片`}
                onclick={() => openLightbox(i)}
              >
                <img src={img.url} alt="" class="h-full w-full object-cover" />
              </button>
            {/each}
          </div>
        {/if}

        <div class="flex gap-2 pt-1">
          <button
            class="rounded border border-footprint px-3 py-1 text-xs hover:bg-black/5"
            onclick={locate}
          >
            定位
          </button>
          {#if footprint.spec.article}
            <a
              class="rounded border border-footprint px-3 py-1 text-xs hover:bg-black/5"
              href={footprint.spec.article}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看文章
            </a>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
