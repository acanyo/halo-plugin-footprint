<!--
  票根墙。

  票根是独立于足迹封面和图片墙的单图资源：一条足迹最多对应一张票根。
  两种切换样式由后台「票根页 · 切换样式」决定：
  - fan   票夹叠放
  - strip 横向长串滚动浏览

  这是全包唯一动态导入 GSAP 的地方：两种样式之间切换是真正的布局变换，
  Flip 能自动求出每张票的位移并补间，手写要重新测量所有元素。
  动态导入保证没进票根页的访客不下载这 80 kB。
-->
<svelte:options customElement={{ tag: 'footprint-ticket-wall' }} />

<script lang="ts">
import { fade } from 'svelte/transition';
import type { Footprint } from '../types/footprint';
import { applyImageRule, normalizeAttachmentUrl } from '../utils/image';
import { formatDate } from '../utils/date';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

let open = $state(false);
let host = $state<HTMLElement>();
let stage = $state<HTMLElement>();
let index = $state(0);

/** 后台配置的切换样式；运行时也允许临时切换以便对比 */
let style = $state<'fan' | 'strip'>(store.config.ticketGalleryStyle ?? 'fan');

interface Ticket {
  fp: Footprint;
  url: string;
  title: string;
  date: string;
  city: string;
}

const tickets = $derived.by<Ticket[]>(() => {
  const filter = store.cityFilter;
  return store.footprints
    .filter((fp) => {
      if (!normalizeAttachmentUrl(fp.spec.ticketImage)) return false;
      if (!filter) return true;
      return (fp.spec.cityAdcode || fp.spec.city || '') === filter;
    })
    .map((fp) => ({
      fp,
      url: applyImageRule(
        normalizeAttachmentUrl(fp.spec.ticketImage),
        store.config,
        'timeline'
      ),
      title: fp.spec.name,
      date: formatDate(fp.spec.createTime, 'ticket'),
      city: fp.spec.city ?? '',
    }))
    // 按日期排序，票夹和长串都依赖这个顺序
    .sort((a, b) => (a.fp.spec.createTime ?? '').localeCompare(b.fp.spec.createTime ?? ''));
});

const current = $derived(tickets[index]);

export function show(startIndex = 0) {
  index = Math.min(Math.max(startIndex, 0), Math.max(tickets.length - 1, 0));
  open = true;
  // 票根墙背景透明要透出地球，因此**不**暂停渲染循环。
  // 这是原实现明确的约定，改成暂停会让背后的地球僵住。
}

export function close() {
  open = false;
}

function step(delta: number) {
  if (tickets.length < 2) return;
  index = (index + delta + tickets.length) % tickets.length;
}

/**
 * 切换排布样式。用 GSAP Flip 补间——两种样式的每张票位置、尺寸、层叠全不同，
 * 手写要先测量再逐个动画，Flip 只需在变更前后各记录一次状态。
 */
async function toggleStyle() {
  const next = style === 'fan' ? 'strip' : 'fan';
  if (!stage) {
    style = next;
    return;
  }
  const { Flip } = await import('gsap/Flip');
  const items = stage.querySelectorAll('[data-ticket]');
  const state = Flip.getState(items);
  style = next;
  // 等 Svelte 把新布局刷到 DOM 再让 Flip 求差值
  await new Promise((r) => requestAnimationFrame(r));
  // Flip 的 vars 类型未覆盖 duration/ease 等基础补间属性，实际运行时支持
  Flip.from(state, {
    duration: 0.45,
    ease: 'power2.inOut',
    absolute: true,
    stagger: 0.02,
  } as Parameters<typeof Flip.from>[1]);
}

function locate(t: Ticket) {
  if (!host) return;
  emit(host, 'footprint:flyto', {
    longitude: t.fp.spec.longitude,
    latitude: t.fp.spec.latitude,
    zoom: 20000,
  });
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
  {#if open}
    <!-- 背景半透明：票根墙要透出背后的地球，不能用不透明遮罩 -->
    <div
      class="fixed inset-0 z-[var(--footprint-z-overlay)] flex flex-col bg-black/55 backdrop-blur-[2px]"
      transition:fade={{ duration: 180 }}
      role="dialog"
      aria-modal="true"
      aria-label="票根"
    >
      <div class="flex items-center justify-between gap-3 p-4">
        <h2 class="text-base text-white">
          票根 <span class="text-white/50">{tickets.length}</span>
          {#if store.cityFilter}
            <span class="ml-2 rounded bg-white/15 px-2 py-0.5 text-xs">
              {current?.city || store.cityFilter}
            </span>
          {/if}
        </h2>
        <div class="flex items-center gap-2">
          <button class="rounded border border-white/25 px-3 py-1.5 text-sm text-white" onclick={toggleStyle}>
            {style === 'fan' ? '横向长串' : '票夹'}
          </button>
          <button class="rounded border border-white/25 px-3 py-1.5 text-sm text-white" onclick={close}>
            关闭
          </button>
        </div>
      </div>

      {#if !tickets.length}
        <p class="flex-1 pt-24 text-center text-sm text-white/55">还没有票根</p>
      {:else}
        <div
          bind:this={stage}
          class="flex-1 overflow-hidden"
          class:ticket-fan={style === 'fan'}
          class:ticket-strip={style === 'strip'}
        >
          {#each tickets as t, i (t.fp.metadata.name)}
            <button
              data-ticket
              class="ticket-item"
              class:is-current={i === index}
              style="--offset: {i - index}"
              aria-label={t.title}
              onclick={() => (i === index ? locate(t) : (index = i))}
            >
              <img src={t.url} alt={t.title} loading="lazy" />
              <span class="ticket-meta">
                <span class="ticket-title">{t.title}</span>
                <span class="ticket-date">{t.date}</span>
              </span>
            </button>
          {/each}
        </div>

        <div class="flex items-center justify-center gap-4 p-4 text-white">
          <button aria-label="上一张" onclick={() => step(-1)}>‹</button>
          <span class="text-sm tabular-nums text-white/70">{index + 1} / {tickets.length}</span>
          <button aria-label="下一张" onclick={() => step(1)}>›</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
.ticket-item {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(62vw, 360px);
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  border-radius: var(--footprint-radius);
  overflow: hidden;
  box-shadow: var(--footprint-shadow-md);
}

.ticket-item img {
  display: block;
  width: 100%;
  height: auto;
}

.ticket-meta {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: linear-gradient(to top, rgb(0 0 0 / 0.75), transparent);
  color: #fff;
  font-size: 12px;
}

/* 票夹叠放：当前票居中，前后按 offset 向两侧叠开并后退 */
.ticket-fan .ticket-item {
  transform: translate(-50%, -50%) translateX(calc(var(--offset) * 26px))
    scale(calc(1 - min(abs(var(--offset)), 4) * 0.06));
  z-index: calc(100 - abs(var(--offset)));
  opacity: calc(1 - min(abs(var(--offset)), 5) * 0.18);
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
}

/* 横向长串：一字排开，当前票居中 */
.ticket-strip .ticket-item {
  transform: translate(-50%, -50%) translateX(calc(var(--offset) * min(66vw, 384px)));
  opacity: 1;
  transition: transform 0.35s ease;
}

.ticket-item.is-current {
  opacity: 1;
}
</style>
