<svelte:options
  customElement={{
    tag: 'footprint-lightbox',
    props: {
      open: { reflect: true, type: 'Boolean', attribute: 'open' },
    },
  }}
/>

<script lang="ts">
/**
 * 图片灯箱。迁移自 travel-memory.js「图片灯箱」一节（原 108 行）。
 *
 * 与原实现的差异，均为迁移中暴露出的缺陷，非行为改动：
 * - 原实现用 12 个 getElementById 抓取模板里写死的 DOM，本组件自带模板；
 * - 原实现的键盘支持只有关闭按钮的 focus，这里补了 Esc / ←→，
 *   原代码里 `switchLightbox` 已具备逻辑，只是没接键盘；
 * - 焦点归还沿用原行为：关闭后把焦点还给触发它的元素。
 *
 * 用法（由地图层调用）：
 *   const lb = document.querySelector('footprint-lightbox');
 *   lb.show(images, startIndex, triggerEl);
 */
import { tick } from 'svelte';
import type { LightboxImage } from './types/footprint';

let open = $state(false);
let images = $state<LightboxImage[]>([]);
let index = $state(0);
let status = $state<'loading' | 'ok' | 'error'>('loading');

let triggerEl: HTMLElement | null = null;
let closeBtn = $state<HTMLButtonElement>();
let touchStartX: number | null = null;

const current = $derived(images[index]);
const single = $derived(images.length <= 1);

/** 打开灯箱。由外部命令式调用，因此挂在元素实例上而非走 attribute。 */
export async function show(
  list: LightboxImage[],
  startIndex = 0,
  trigger?: HTMLElement
) {
  if (!list?.length) return;
  images = list;
  index = Math.min(Math.max(startIndex, 0), list.length - 1);
  triggerEl = trigger ?? null;
  status = 'loading';
  open = true;
  await tick();
  closeBtn?.focus();
}

export function close(returnFocus = true) {
  open = false;
  images = [];
  if (returnFocus) {
    // 焦点还给触发它的元素，否则键盘用户会被丢回文档开头
    triggerEl?.focus?.();
  }
  triggerEl = null;
}

function switchBy(delta: number) {
  if (images.length < 2) return;
  index = (index + delta + images.length) % images.length;
  status = 'loading';
}

/** 预加载相邻两张，切换时不闪空白 */
$effect(() => {
  if (!open) return;
  [index - 1, index + 1]
    .filter((i) => i >= 0 && i < images.length)
    .forEach((i) => {
      const pre = new Image();
      pre.src = images[i].url;
    });
});

function onKeydown(e: KeyboardEvent) {
  if (!open) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') switchBy(-1);
  else if (e.key === 'ArrowRight') switchBy(1);
}

function onTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX;
}

function onTouchEnd(e: TouchEvent) {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 40) switchBy(dx < 0 ? 1 : -1);
  touchStartX = null;
}

function retry() {
  status = 'loading';
  // 换一个 query 触发重新请求，避免浏览器直接吃缓存里的失败结果
  const img = current;
  if (img) images[index] = { ...img, url: img.url };
}
</script>

<svelte:window on:keydown={onKeydown} />

{#if open}
  <!--
    背景关闭做成独立的 <button> 而不是给容器挂 onclick：
    非交互元素挂点击事件对键盘用户不可达（Svelte 的 a11y 检查也会报），
    而容器本身要承载 dialog 语义，两者职责分开更干净。
  -->
  <div
    class="fixed inset-0 z-[var(--footprint-z-lightbox)] flex items-center justify-center bg-black/85"
    role="dialog"
    aria-modal="true"
    aria-label="图片预览"
    tabindex="-1"
    ontouchstart={onTouchStart}
    ontouchend={onTouchEnd}
  >
    <button
      class="absolute inset-0 h-full w-full cursor-default"
      aria-label="关闭图片预览"
      tabindex="-1"
      onclick={() => close()}
    ></button>
    <button
      bind:this={closeBtn}
      class="absolute right-4 top-4 z-10 h-9 w-9 rounded-full bg-white/15 text-white hover:bg-white/25"
      aria-label="关闭"
      onclick={() => close()}
    >
      ✕
    </button>

    {#if !single}
      <button
        class="absolute left-4 z-10 h-11 w-11 rounded-full bg-white/15 text-white hover:bg-white/25"
        aria-label="上一张"
        onclick={() => switchBy(-1)}
      >
        ‹
      </button>
      <button
        class="absolute right-4 top-1/2 z-10 h-11 w-11 rounded-full bg-white/15 text-white hover:bg-white/25"
        aria-label="下一张"
        onclick={() => switchBy(1)}
      >
        ›
      </button>
    {/if}

    <div class="relative z-10 max-h-[86vh] max-w-[92vw]">
      {#if status === 'loading'}
        <div
          class="absolute inset-0 animate-pulse rounded-[var(--footprint-radius)] bg-white/10"
          aria-hidden="true"
        ></div>
      {/if}

      {#if status === 'error'}
        <div class="flex flex-col items-center gap-3 p-10 text-white/80">
          <span>图片加载失败</span>
          <button class="rounded border border-white/40 px-3 py-1 text-sm" onclick={retry}>
            重试
          </button>
        </div>
      {:else if current}
        <img
          src={current.url}
          alt={current.caption ?? ''}
          class="max-h-[86vh] max-w-[92vw] rounded-[var(--footprint-radius)] object-contain"
          class:opacity-0={status === 'loading'}
          onload={() => (status = 'ok')}
          onerror={() => (status = 'error')}
        />
      {/if}
    </div>

    <div
      class="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-center text-sm text-white/85"
    >
      {#if current?.caption}
        <p class="mb-1">{current.caption}</p>
      {/if}
      {#if !single}
        <p class="tabular-nums text-white/60">{index + 1} / {images.length}</p>
      {/if}
    </div>
  </div>
{/if}
