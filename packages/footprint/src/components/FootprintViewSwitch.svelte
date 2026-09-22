<!--
  顶部导航：2D/3D 切换、自动旋转、底图下拉、各功能入口。

  只负责发号施令，不执行任何地图操作——所有动作都派发事件，
  由地球组件与页面接线处理。
-->
<svelte:options customElement={{ tag: 'footprint-view-switch' }} />

<script lang="ts">
import { BASEMAPS, type BasemapKey } from '../cesium/basemap-switcher';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

let host = $state<HTMLElement>();
let basemapOpen = $state(false);

/** 由页面在天地图 Key 未配置时传入，用于禁用相关底图项 */
let tiandituAvailable = $state(false);
/** 自动旋转的用户偏好，由地球组件回传 */
let rotateOn = $state(false);
let currentBasemap = $state<BasemapKey>('amapVec');

export function setTiandituAvailable(v: boolean) {
  tiandituAvailable = v;
}

export function setRotateState(on: boolean) {
  rotateOn = on;
}

const basemapEntries = Object.entries(BASEMAPS) as [BasemapKey, (typeof BASEMAPS)[BasemapKey]][];

function switchMode(mode: '2d' | '3d') {
  if (!host || store.viewMode === mode) return;
  store.setViewMode(mode);
  emit(host, 'footprint:view-mode', { mode });
}

function pickBasemap(key: BasemapKey) {
  currentBasemap = key;
  basemapOpen = false;
  // 底图切换需要地球组件处理，且会连带改变标记坐标系
  host?.dispatchEvent(
    new CustomEvent('footprint:basemap', {
      detail: { key },
      bubbles: true,
      composed: true,
    })
  );
}

function fire(type: string) {
  host?.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
}
</script>

<div bind:this={host}>
  <nav
    class="fixed inset-x-0 top-0 z-[calc(var(--footprint-z-overlay)-2)] flex items-center gap-2 px-6 py-4 text-sm text-white"
  >
    <span class="mr-auto flex items-baseline gap-2">
      <span class="text-base">{store.config.globeTitle}</span>
      <span class="text-xs uppercase tracking-widest text-white/40">Travel Memory</span>
    </span>

    <div class="flex items-center gap-1 rounded-full bg-white/10 p-1">
      <button
        class="rounded-full px-3 py-1 transition-colors"
        class:bg-white={store.viewMode === '2d'}
        class:text-black={store.viewMode === '2d'}
        onclick={() => switchMode('2d')}
      >
        2D
      </button>
      <button
        class="rounded-full px-3 py-1 transition-colors"
        class:bg-white={store.viewMode === '3d'}
        class:text-black={store.viewMode === '3d'}
        onclick={() => switchMode('3d')}
      >
        3D
      </button>
    </div>

    <!-- 按钮反映「用户偏好」而非「此刻是否在转」：卡片/票根页只是临时让镜头停住 -->
    <button
      class="rounded-full px-3 py-1 transition-colors"
      class:bg-white={rotateOn}
      class:text-black={rotateOn}
      class:bg-white-10={!rotateOn}
      aria-pressed={rotateOn}
      title={rotateOn ? '暂停自动旋转' : '开启自动旋转'}
      onclick={() => fire('footprint:toggle-rotate')}
    >
      自动旋转
    </button>

    <div class="relative">
      <button
        class="rounded-full bg-white/10 px-3 py-1"
        aria-expanded={basemapOpen}
        onclick={() => (basemapOpen = !basemapOpen)}
      >
        {BASEMAPS[currentBasemap].label}
      </button>
      {#if basemapOpen}
        <ul class="absolute right-0 mt-1 w-44 overflow-hidden rounded-lg bg-black/85 py-1">
          {#each basemapEntries as [key, option] (key)}
            {@const disabled = option.needKey && !tiandituAvailable}
            <li>
              <button
                class="block w-full px-3 py-1.5 text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/30"
                {disabled}
                title={disabled ? '需要先配置天地图 Key' : ''}
                onclick={() => pickBasemap(key)}
              >
                {option.label}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <button class="rounded-full bg-white/10 px-3 py-1" onclick={() => fire('footprint:open-city-wall')}>
      全部城市
    </button>
    <button class="rounded-full bg-white/10 px-3 py-1" onclick={() => fire('footprint:open-tickets')}>
      票根
    </button>
    {#if store.config.enableTicketJourneyReplay}
      <button class="rounded-full bg-white/10 px-3 py-1" onclick={() => fire('footprint:open-replay')}>
        重走一遍
      </button>
    {/if}
  </nav>
</div>
