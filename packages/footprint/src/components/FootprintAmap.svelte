<!--
  2D 高德地图视图。

  shadow: 'none' —— 与地球同理：高德 SDK 自带样式、控件与事件处理都按
  light DOM 设计，塞进影子根要逐个打补丁。

  懒加载：只有真正切到 2D 才创建实例。切回 3D 时保留实例（见 amap/loader.ts
  的取舍说明），下次回来只 resize。
-->
<svelte:options customElement={{ tag: 'footprint-amap', shadow: 'none' }} />

<script lang="ts">
import { onMount } from 'svelte';
import { AMapHost, getAMap } from '../amap/loader';
import { applyImageRule, galleryOf } from '../utils/image';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';
import type { Footprint } from '../types/footprint';

let container = $state<HTMLDivElement>();
let host = $state<HTMLElement>();
let error = $state('');
let ready = $state(false);

const amap = new AMapHost();
let markers: unknown[] = [];

/** 由页面在切到 2D 时调用 */
export async function show() {
  if (!container) return;
  try {
    const map = await amap.show(container, store.config.amapKey, {
      zoom: 5,
      center: [104, 35],
      mapStyle: store.config.mapStyle || undefined,
      viewMode: '2D',
    });
    if (!map) return; // 正在初始化中
    if (!ready) {
      buildMarkers(map);
      ready = true;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error('[footprint-amap] 初始化失败', e);
  }
}

export function hide() {
  amap.hide();
}

/** 标记点：复用与 3D 一致的图片规则，保证两个视图里缩略图质量一致 */
function buildMarkers(map: unknown) {
  const AMap = getAMap();
  const m = map as { add(o: unknown): void };
  markers = store.footprints.map((fp: Footprint) => {
    const cover = applyImageRule(galleryOf(fp.spec)[0]?.url ?? '', store.config, 'marker');
    const marker = new AMap.Marker({
      position: [fp.spec.longitude, fp.spec.latitude],
      title: fp.spec.name,
      // 直接传原坐标，不做转换：本插件存的就是 GCJ-02（后端走高德 Web API
      // 地理编码，返回火星坐标），与高德 JS API 期望的坐标系一致。
      // 原实现的 2D 也是这样原样传入的。
      content: cover
        ? `<span class="footprint-amap-marker" style="background-image:url('${cover}')"></span>`
        : undefined,
      offset: new AMap.Pixel(-13, -13),
    });
    marker.on('click', () => {
      store.select(fp);
      if (host) emit(host, 'footprint:open-detail', { name: fp.metadata.name });
    });
    m.add(marker);
    return marker;
  });
}

onMount(() => {
  return () => {
    markers = [];
    amap.destroy();
  };
});
</script>

<div bind:this={host}>
  <div bind:this={container} class="footprint-amap-canvas"></div>
  {#if error}
    <p class="footprint-amap-error">2D 地图加载失败：{error}</p>
  {/if}
</div>

<style>
/* shadow: 'none'，样式进全局作用域，因此类名必须带组件前缀 */
.footprint-amap-canvas {
  width: 100%;
  height: 100%;
}

.footprint-amap-error {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  color: #35423d;
  font-size: 14px;
}

:global(.footprint-amap-marker) {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid #fff;
  background-size: cover;
  background-position: center;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
}
</style>
