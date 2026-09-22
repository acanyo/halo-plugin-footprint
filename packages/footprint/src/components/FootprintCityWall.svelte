<!--
  城市卡片墙。整球视角下的城市总览目录。

  合并了原实现分散的三处：「城市卡片墙」（3975）、「卡片封面」（3192）、
  「PC 城市卡片悬停轮播」（4159）。封面加载逻辑已抽到 utils/cover-loader.ts。
-->
<svelte:options customElement={{ tag: 'footprint-city-wall' }} />

<script lang="ts">
import { fade, fly } from 'svelte/transition';
import type { Footprint } from '../types/footprint';
import { groupByCity } from '../cesium/markers';
import { applyImageRule, galleryOf } from '../utils/image';
import { coverLoader } from '../utils/cover-loader';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

/** 悬停多久开始轮播 */
const CAROUSEL_DELAY = 600;
/** 每张停留时长 */
const CAROUSEL_INTERVAL = 1800;
/** 轮播最多取几张 */
const CAROUSEL_MAX = 3;

let open = $state(false);
let host = $state<HTMLElement>();
let keyword = $state('');

interface CityCard {
  key: string;
  name: string;
  count: number;
  photoCount: number;
  covers: string[];
  first: Footprint;
}

const cards = $derived.by<CityCard[]>(() => {
  const groups = groupByCity(store.footprints);
  const list: CityCard[] = [];
  for (const [key, { name, items }] of groups) {
    const covers = items
      .flatMap((fp) => galleryOf(fp.spec))
      .map((img) => applyImageRule(img.url, store.config, 'cityWall'))
      .filter(Boolean)
      .slice(0, CAROUSEL_MAX);
    list.push({
      key,
      name,
      count: items.length,
      photoCount: items.reduce((n, fp) => n + galleryOf(fp.spec).length, 0),
      covers,
      first: items[0],
    });
  }
  // 足迹多的城市排前面，同数量按名称稳定排序，避免每次渲染顺序跳动
  return list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
});

const visible = $derived(
  keyword.trim() ? cards.filter((c) => c.name.includes(keyword.trim())) : cards
);

/** 移动端每排城市数，由后台配置，前端按 1-3 兜底 */
const mobileColumns = $derived(
  Math.min(3, Math.max(1, Math.round(Number(store.config.mobileCityWallColumns) || 2)))
);

/** 已加载成功的封面 URL，决定首字占位是否被盖上 */
const loaded = $state(new Set<string>());

/** 当前轮播到第几张，按城市 key 记 */
const carouselIndex = $state(new Map<string, number>());
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let carouselTimer: ReturnType<typeof setInterval> | null = null;

export function show() {
  open = true;
  // 打开时预热封面。首字占位常驻做底，图片成功后淡入盖上去——
  // 加载慢或失败都只是「还没盖上」，不会出现空白或突然跳动。
  for (const card of cards) {
    const url = card.covers[0];
    if (url) void coverLoader.load(url).then((ok) => ok && loaded.add(url));
  }
}

export function close() {
  open = false;
  stopCarousel();
}

function stopCarousel() {
  if (hoverTimer) clearTimeout(hoverTimer);
  if (carouselTimer) clearInterval(carouselTimer);
  hoverTimer = null;
  carouselTimer = null;
}

/** PC 悬停轮播。移动端没有 hover，不启用。 */
function onCardEnter(card: CityCard) {
  if (!store.config.cityCardHoverCarousel) return;
  if (window.matchMedia('(pointer: coarse)').matches) return;
  if (card.covers.length < 2) return;

  stopCarousel();
  hoverTimer = setTimeout(() => {
    // 轮播用到的图也要先预热，否则切过去是空白
    card.covers.forEach((u) => void coverLoader.load(u).then((ok) => ok && loaded.add(u)));
    carouselTimer = setInterval(() => {
      const next = ((carouselIndex.get(card.key) ?? 0) + 1) % card.covers.length;
      carouselIndex.set(card.key, next);
    }, CAROUSEL_INTERVAL);
  }, CAROUSEL_DELAY);
}

function onCardLeave(card: CityCard) {
  stopCarousel();
  carouselIndex.set(card.key, 0);
}

function pick(card: CityCard) {
  if (!host) return;
  store.setCityFilter(card.key);
  emit(host, 'footprint:city-filter', { city: card.key });
  emit(host, 'footprint:flyto', {
    longitude: card.first.spec.longitude,
    latitude: card.first.spec.latitude,
    zoom: 300000,
  });
  close();
}

function coverOf(card: CityCard): string {
  const idx = carouselIndex.get(card.key) ?? 0;
  const url = card.covers[idx] ?? card.covers[0] ?? '';
  return loaded.has(url) ? url : '';
}
</script>

<div bind:this={host}>
  {#if open}
    <div
      class="fixed inset-0 z-[var(--footprint-z-overlay)] overflow-y-auto bg-black/80 backdrop-blur-sm"
      transition:fade={{ duration: 160 }}
      role="dialog"
      aria-modal="true"
      aria-label="城市总览"
    >
      <div class="mx-auto w-[min(92vw,1100px)] py-10">
        <div class="mb-5 flex items-center justify-between gap-4">
          <h2 class="text-lg text-white">去过的城市 <span class="text-white/50">{cards.length}</span></h2>
          <div class="flex items-center gap-2">
            <input
              bind:value={keyword}
              type="text"
              placeholder="搜索城市"
              class="rounded border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/40"
            />
            <button class="rounded border border-white/25 px-3 py-1.5 text-sm text-white" onclick={close}>
              关闭
            </button>
          </div>
        </div>

        <div class="city-wall-grid" style="--mobile-columns: {mobileColumns}">
          {#each visible as card (card.key)}
            <button
              class="group relative aspect-[3/4] overflow-hidden rounded-[var(--footprint-radius)] border border-white/10 bg-white/5 text-left"
              transition:fly={{ y: 8, duration: 180 }}
              onmouseenter={() => onCardEnter(card)}
              onmouseleave={() => onCardLeave(card)}
              onfocus={() => onCardEnter(card)}
              onblur={() => onCardLeave(card)}
              onclick={() => pick(card)}
            >
              <!-- 首字常驻做底：加载慢或失败都只是「还没盖上」，不会空白 -->
              <span
                class="absolute inset-0 flex items-center justify-center text-5xl font-light text-white/25"
                aria-hidden="true"
              >
                {card.name.slice(0, 1)}
              </span>

              {#if coverOf(card)}
                <img
                  src={coverOf(card)}
                  alt=""
                  class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
                />
              {/if}

              <span
                class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3"
              >
                <span class="block text-sm text-white">{card.name}</span>
                <span class="block text-xs text-white/60">
                  {card.count} 条足迹 · {card.photoCount} 张照片
                </span>
              </span>
            </button>
          {/each}
        </div>

        {#if !visible.length}
          <p class="py-16 text-center text-sm text-white/50">没有匹配的城市</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
/*
  每排数量：移动端由后台配置（1-3），桌面端自适应铺满。
  用 CSS 变量而非在 JS 里算，窗口缩放时不需要重新渲染。
*/
.city-wall-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(var(--mobile-columns, 2), minmax(0, 1fr));
}

@media (min-width: 768px) {
  .city-wall-grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
</style>
