<!--
  重走一遍：按日期从第一张票开始，镜头在城市间飞行，逐张回放票根。

  这是与地图耦合最深的 UI——它要驱动相机。做法仍是只派发事件，
  由地球组件执行飞行；本组件不持有 viewer。
-->
<svelte:options customElement={{ tag: 'footprint-journey-replay' }} />

<script lang="ts">
import { fade, fly } from 'svelte/transition';
import type { Footprint } from '../types/footprint';
import { journeyStats, haversineKm, sortByTime } from '../utils/distance';
import { applyImageRule, normalizeAttachmentUrl } from '../utils/image';
import { formatDate } from '../utils/date';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

/** 每站停留时长（毫秒） */
const DWELL_MS = 4200;
/** 相机飞行时长（毫秒），与 DWELL 一起构成单站节奏 */
const FLY_MS = 2300;
/** 站间缓冲 */
const GAP_MS = 480;

let host = $state<HTMLElement>();
let open = $state(false);
let index = $state(0);
let playing = $state(false);
let speed = $state<1 | 2>(1);
/** 是否正在飞行中。飞行期间不推进，避免镜头还没到就跳下一站。 */
let flying = $state(false);

/**
 * 代次。每次开始/停止/跳转都递增，异步回调用它判断自己是否已过期——
 * 不做这层判断的话，上一轮的定时器会把已经停止的放映重新推进。
 * 这是原实现的处理，保留。
 */
let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const items = $derived(
  sortByTime(store.footprints.filter((fp) => normalizeAttachmentUrl(fp.spec.ticketImage)))
);
const stats = $derived(journeyStats(items));
const current = $derived<Footprint | undefined>(items[index]);
const coverUrl = $derived(
  current
    ? applyImageRule(normalizeAttachmentUrl(current.spec.ticketImage), store.config, 'timeline')
    : ''
);

/** 距上一站的里程 */
const legKm = $derived(
  index > 0 && items[index - 1] && current
    ? haversineKm(
        { lat: items[index - 1].spec.latitude, lng: items[index - 1].spec.longitude },
        { lat: current.spec.latitude, lng: current.spec.longitude }
      )
    : 0
);

const progress = $derived(items.length ? ((index + 1) / items.length) * 100 : 0);

/** 剩余时长估算 */
const etaSeconds = $derived(
  Math.max(0, Math.round(((items.length - index - 1) * (DWELL_MS + FLY_MS + GAP_MS)) / speed / 1000))
);

export function show(startIndex = 0) {
  if (!items.length) return;
  index = Math.min(Math.max(startIndex, 0), items.length - 1);
  open = true;
  play();
}

export function close() {
  stop();
  open = false;
}

function play() {
  if (!items.length) return;
  playing = true;
  generation++;
  flyToCurrent();
  scheduleNext(generation);
}

function pause() {
  playing = false;
  generation++;
  if (timer) clearTimeout(timer);
  timer = null;
}

function stop() {
  pause();
  flying = false;
}

function toggle() {
  if (playing) pause();
  else play();
}

function toggleSpeed() {
  speed = speed === 1 ? 2 : 1;
  if (playing) {
    // 变速后按新节奏重排下一次推进
    generation++;
    scheduleNext(generation);
  }
}

function flyToCurrent() {
  if (!host || !current) return;
  flying = true;
  emit(host, 'footprint:flyto', {
    longitude: current.spec.longitude,
    latitude: current.spec.latitude,
    zoom: 60000,
  });
  // 地球组件没有飞行完成回调，按时长估算解除标记
  setTimeout(() => {
    flying = false;
  }, FLY_MS / speed);
}

function scheduleNext(gen: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(
    () => {
      // 过期的代次直接丢弃：停止/跳转后旧定时器不能把放映重新推进
      if (gen !== generation || !playing) return;
      if (index >= items.length - 1) {
        playing = false;
        return;
      }
      index += 1;
      flyToCurrent();
      scheduleNext(gen);
    },
    (DWELL_MS + FLY_MS + GAP_MS) / speed
  );
}

function step(delta: number) {
  if (!items.length) return;
  index = Math.min(Math.max(index + delta, 0), items.length - 1);
  generation++;
  flyToCurrent();
  if (playing) scheduleNext(generation);
}

function onKeydown(e: KeyboardEvent) {
  if (!open) return;
  if (e.key === 'Escape') close();
  else if (e.key === ' ') {
    e.preventDefault();
    toggle();
  } else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
}

const finished = $derived(open && !playing && index >= items.length - 1 && items.length > 0);
</script>

<svelte:window on:keydown={onKeydown} />

<div bind:this={host}>
  {#if open}
    <!-- 半透明：放映时要看得见背后的地球飞行 -->
    <div
      class="pointer-events-none fixed inset-0 z-[var(--footprint-z-overlay)]"
      transition:fade={{ duration: 200 }}
    >
      {#if finished}
        <div
          class="pointer-events-auto absolute left-1/2 top-1/2 w-[min(90vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--footprint-radius)] bg-black/80 p-6 text-center text-white"
          transition:fly={{ y: 12, duration: 240 }}
        >
          <h3 class="mb-4 text-lg">这趟旅程走完了</h3>
          <dl class="mb-5 grid grid-cols-2 gap-3 text-sm">
            <div><dt class="text-white/55">票根</dt><dd class="tabular-nums">{stats.stops}</dd></div>
            <div><dt class="text-white/55">城市</dt><dd class="tabular-nums">{stats.cities}</dd></div>
            <div>
              <dt class="text-white/55">里程</dt>
              <dd class="tabular-nums">{Math.round(stats.totalKm).toLocaleString('zh-CN')} km</dd>
            </div>
            <div><dt class="text-white/55">跨度</dt><dd class="tabular-nums">{stats.spanDays} 天</dd></div>
          </dl>
          <div class="flex justify-center gap-2">
            <button
              class="rounded border border-white/35 px-4 py-1.5 text-sm"
              onclick={() => {
                index = 0;
                play();
              }}
            >
              再走一遍
            </button>
            <button class="rounded border border-white/35 px-4 py-1.5 text-sm" onclick={close}>
              结束
            </button>
          </div>
        </div>
      {:else if current}
        <!-- 当前票根卡：靠边放，中间留给地球 -->
        <div
          class="pointer-events-auto absolute left-6 top-1/2 w-[min(32vw,320px)] -translate-y-1/2 overflow-hidden rounded-[var(--footprint-radius)] bg-black/70 text-white shadow-[var(--footprint-shadow-md)]"
          transition:fly={{ x: -12, duration: 240 }}
        >
          {#if coverUrl}
            <img src={coverUrl} alt="" class="w-full object-cover" />
          {/if}
          <div class="space-y-1 p-3">
            <p class="text-sm">{current.spec.name}</p>
            <p class="text-xs text-white/60">
              {[current.spec.city, formatDate(current.spec.createTime, 'ticket')]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {#if legKm > 0}
              <p class="text-xs text-white/50">
                距上一站 {Math.round(legKm).toLocaleString('zh-CN')} km
              </p>
            {/if}
          </div>
        </div>
      {/if}

      <!-- 控制条 -->
      <div
        class="pointer-events-auto absolute bottom-6 left-1/2 flex w-[min(92vw,560px)] -translate-x-1/2 flex-col gap-2 rounded-full bg-black/70 px-5 py-3 text-white"
        transition:fly={{ y: 12, duration: 240 }}
      >
        <div class="h-1 overflow-hidden rounded-full bg-white/20">
          <div class="h-full bg-white/80 transition-[width]" style="width: {progress}%"></div>
        </div>
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="tabular-nums text-white/60">{index + 1} / {items.length}</span>
          <div class="flex items-center gap-3">
            <button aria-label="上一站" onclick={() => step(-1)}>‹</button>
            <button class="min-w-12" onclick={toggle}>{playing ? '暂停' : '继续'}</button>
            <button aria-label="下一站" onclick={() => step(1)}>›</button>
            <button
              class="rounded border border-white/30 px-2 py-0.5 text-xs"
              aria-label={`播放速度，当前 ${speed} 倍速`}
              onclick={toggleSpeed}
            >
              {speed}×
            </button>
          </div>
          <span class="tabular-nums text-white/60">
            {flying ? '飞行中' : `剩余约 ${etaSeconds}s`}
          </span>
        </div>
      </div>

      <button
        class="pointer-events-auto absolute right-6 top-6 text-white/70 hover:text-white"
        aria-label="退出放映"
        onclick={close}
      >
        ✕
      </button>
    </div>
  {/if}
</div>
