<!--
  省份城市卡片：点省份轮廓后，该省每个有足迹的城市各出一张小卡片，
  分列排在屏幕两侧，用抛物线连回地图上的城市位置。

  分列排版在 utils/card-column.ts（纯函数、有测试），曲线几何在 utils/geometry.ts。
  本组件只做渲染与交互。
-->
<svelte:options customElement={{ tag: 'footprint-province-cards' }} />

<script lang="ts">
import { fade, fly } from 'svelte/transition';
import type { Footprint } from '../types/footprint';
import { cardColumnsEnabled, layoutCardColumns, type CardTarget } from '../utils/card-column';
import { arcControlPoint, sampleBezier } from '../utils/geometry';
import { applyImageRule, galleryOf } from '../utils/image';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

/** 与「城市高亮」同源的琥珀金：整套选中态只有一种颜色 */
const HL_STROKE = '#FFB067';

let host = $state<HTMLElement>();
let open = $state(false);
let provinceName = $state('');
let viewportW = $state(typeof window === 'undefined' ? 1440 : window.innerWidth);
let viewportH = $state(typeof window === 'undefined' ? 900 : window.innerHeight);

interface CityEntry {
  key: string;
  name: string;
  items: Footprint[];
  cover: string;
  /** 城市在屏幕上的坐标，由地图层在调用 show() 时给出 */
  screen: { x: number; y: number };
}

let cities = $state<CityEntry[]>([]);

const slots = $derived(
  open && cardColumnsEnabled(viewportW)
    ? layoutCardColumns({
        targets: cities.map<CardTarget>((c) => ({ key: c.key, x: c.screen.x, y: c.screen.y })),
        viewport: { width: viewportW, height: viewportH },
      })
    : []
);

const CARD_W = 244;
const CARD_H = 96;

/** 连线：从卡片朝城市那一侧的边中点出发，走一条浅弧 */
function pathFor(slot: (typeof slots)[number]): string {
  const from = {
    x: slot.side === 'left' ? slot.left + CARD_W : slot.left,
    y: slot.top + CARD_H / 2,
  };
  const to = slot.target;
  // lift 取小值：连线是「地图标注引线」的观感，不是夸张的抛物线
  const ctrl = arcControlPoint(from, to, 0.12);
  const pts = sampleBezier(from, ctrl, to, 24);
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/**
 * 打开省份卡片组。
 * @param province 省份名
 * @param entries  该省各城市及其在屏幕上的坐标（由地图层投影得出）
 */
export function show(
  province: string,
  entries: Array<{ key: string; name: string; items: Footprint[]; screen: { x: number; y: number } }>
) {
  provinceName = province;
  cities = entries.map((e) => ({
    ...e,
    cover: applyImageRule(galleryOf(e.items[0]?.spec)[0]?.url ?? '', store.config, 'cityWall'),
  }));
  open = true;
}

export function close() {
  open = false;
  cities = [];
}

/** 城市位置随相机移动而变，地图层每帧可调用此方法刷新连线终点 */
export function updateScreenPositions(positions: Record<string, { x: number; y: number }>) {
  if (!open) return;
  cities = cities.map((c) => (positions[c.key] ? { ...c, screen: positions[c.key] } : c));
}

function pick(city: CityEntry) {
  if (!host) return;
  store.setCityFilter(city.key);
  emit(host, 'footprint:city-filter', { city: city.key });
  emit(host, 'footprint:flyto', {
    longitude: city.items[0].spec.longitude,
    latitude: city.items[0].spec.latitude,
    zoom: 200000,
  });
  close();
}

function onResize() {
  viewportW = window.innerWidth;
  viewportH = window.innerHeight;
}

function onKeydown(e: KeyboardEvent) {
  if (open && e.key === 'Escape') close();
}
</script>

<svelte:window on:resize={onResize} on:keydown={onKeydown} />

<div bind:this={host}>
  {#if open && slots.length}
    <!-- 连线层：pointer-events: none，不挡地图交互 -->
    <svg
      class="pointer-events-none fixed inset-0 z-[calc(var(--footprint-z-overlay)-1)] h-full w-full"
      transition:fade={{ duration: 160 }}
      aria-hidden="true"
    >
      {#each slots as slot (slot.key)}
        <!-- 底下压一层很淡的深色描边：浅色底图上也读得清，这是地图标注引线的做法 -->
        <path d={pathFor(slot)} fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="2.6" />
        <path d={pathFor(slot)} fill="none" stroke={HL_STROKE} stroke-width="1.4" />
      {/each}
    </svg>

    {#each slots as slot, i (slot.key)}
      {@const city = cities.find((c) => c.key === slot.key)}
      {#if city}
        <button
          class="fixed z-[var(--footprint-z-overlay)] flex items-center gap-3 overflow-hidden rounded-[var(--footprint-radius)] border border-footprint bg-footprint-surface p-2 text-left shadow-[var(--footprint-shadow-md)] backdrop-blur transition-transform hover:scale-[1.03]"
          style="left: {slot.left}px; top: {slot.top}px; width: {CARD_W}px; height: {CARD_H}px;"
          transition:fly={{ x: slot.side === 'left' ? -12 : 12, duration: 200, delay: i * 30 }}
          onclick={() => pick(city)}
        >
          <span class="relative h-full w-20 shrink-0 overflow-hidden rounded">
            <span
              class="absolute inset-0 flex items-center justify-center text-2xl font-light text-footprint-muted"
              aria-hidden="true"
            >
              {city.name.slice(0, 1)}
            </span>
            {#if city.cover}
              <img src={city.cover} alt="" class="relative h-full w-full object-cover" />
            {/if}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm text-footprint">{city.name}</span>
            <span class="block text-xs text-footprint-muted">{city.items.length} 条足迹</span>
          </span>
        </button>
      {/if}
    {/each}

    <div
      class="fixed left-1/2 top-4 z-[var(--footprint-z-overlay)] -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-sm text-white"
      transition:fade={{ duration: 160 }}
    >
      {provinceName}
      <button class="ml-3 text-white/60 hover:text-white" onclick={close}>收起</button>
    </div>
  {/if}
</div>
