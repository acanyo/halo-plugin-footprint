<!--
  左下角标题卡。仅 3D、且仅在整球视图显示——拉近到城市尺度后收起，
  免得挡住地面内容。

  文案用「3D 地球」分组的独立配置（globeTitle / globeDesc），
  不读基本设置里的左下角标题与足迹描述。这是原实现明确区分的两套文案。
-->
<svelte:options customElement={{ tag: 'footprint-title-card' }} />

<script lang="ts">
import { fly } from 'svelte/transition';
import { computeStats } from '../utils/stats';
import { store } from '../stores/footprint.svelte';

/** 相机高于此高度（米）才显示：与城市聚合的展开阈值一致 */
const SHOW_ABOVE_HEIGHT = 1_500_000;

let visible = $state(true);

const stats = $derived(computeStats(store.footprints));

/** 由地图层在相机移动后调用 */
export function syncCameraHeight(height: number) {
  visible = height >= SHOW_ABOVE_HEIGHT;
}

export function setVisible(v: boolean) {
  visible = v;
}
</script>

{#if visible}
  <div
    class="pointer-events-none fixed bottom-10 left-10 z-[calc(var(--footprint-z-overlay)-2)] max-w-[min(38vw,420px)] text-white"
    transition:fly={{ y: 16, duration: 280 }}
  >
    <p class="mb-2 text-xs uppercase tracking-[0.3em] text-white/45">Travel Memory</p>
    <h1 class="mb-3 text-4xl font-light leading-tight">{store.config.globeTitle}</h1>
    {#if store.config.globeDesc}
      <p class="mb-6 text-sm leading-relaxed text-white/70">{store.config.globeDesc}</p>
    {/if}
    <dl class="flex gap-10">
      <div>
        <dd class="text-3xl font-light tabular-nums">{stats.total}</dd>
        <dt class="mt-1 text-xs text-white/50">总足迹数</dt>
      </div>
      <div>
        <dd class="text-3xl font-light tabular-nums">{stats.cities}</dd>
        <dt class="mt-1 text-xs text-white/50">去过的城市</dt>
      </div>
      <div>
        <dd class="text-3xl font-light tabular-nums">{stats.provinces}</dd>
        <dt class="mt-1 text-xs text-white/50">省级行政区</dt>
      </div>
    </dl>
  </div>
{/if}
