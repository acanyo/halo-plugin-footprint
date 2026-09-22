<!--
  3D 地球宿主。

  shadow: 'none' —— Cesium 自带 static/cesium/Widgets/ 下 2000+ 行样式且假定
  自己在全局作用域，canvas 的事件、全屏、右键菜单也都按 light DOM 设计，
  开影子根就要逐个打补丁。「用 Svelte 写」和「开 Shadow DOM」是两件独立的事。

  本组件刻意保持很薄：只负责生命周期、把 store 状态桥接到命令式调用、
  以及把 DOM 事件转译成 Cesium 操作。所有 Cesium 细节在 src/cesium/ 下。
-->
<svelte:options customElement={{ tag: 'footprint-globe', shadow: 'none' }} />

<script lang="ts">
import { onMount } from 'svelte';
import { createViewer, setRenderLoop, type ViewerHandle } from '../cesium/viewer';
import { createBasemapLayers, type BasemapLayers } from '../cesium/basemap';
import { isCesiumReady } from '../cesium/global';
import { on } from '../utils/events';
import { store } from '../stores/footprint.svelte';

let container = $state<HTMLDivElement>();
let handle: ViewerHandle | null = null;
let layers: BasemapLayers | null = null;
let error = $state('');

onMount(() => {
  if (!isCesiumReady()) {
    error = 'Cesium 未加载';
    console.error('[footprint-globe]', error);
    return;
  }
  if (!container) return;

  try {
    handle = createViewer(container);
    layers = createBasemapLayers(store.config.tiandituKey);
    // 默认底图：高德矢量路网
    handle.viewer.imageryLayers.addImageryProvider(layers.amapVec);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error('[footprint-globe] 初始化失败', e);
    return;
  }

  // 相机飞行请求来自各 UI 面板，它们不持有 viewer，只派发事件
  const offFlyTo = on('footprint:flyto', ({ longitude, latitude, zoom }) => {
    const Cesium = window.Cesium;
    if (!handle || !Cesium) return;
    handle.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, zoom ?? 20000),
    });
  });

  // 不透明全屏层打开时暂停渲染省电；票根墙需要透出地球，不会派发 running:false
  const offRenderLoop = on('footprint:render-loop', ({ running }) => {
    if (handle) setRenderLoop(handle.viewer, running);
  });

  return () => {
    offFlyTo();
    offRenderLoop();
    handle?.destroy();
    handle = null;
    layers = null;
  };
});

/** 暴露给地图相关组件取用同一个 viewer，避免各自再造一个 */
export function getViewer() {
  return handle?.viewer ?? null;
}

export function getLayers() {
  return layers;
}
</script>

<div bind:this={container} class="footprint-globe-canvas"></div>
{#if error}
  <p class="footprint-globe-error">地球加载失败：{error}</p>
{/if}

<style>
/* shadow: 'none' 意味着这些样式会进入全局作用域，因此必须带组件前缀。
   这正是旧代码 .city / .ticket 这类通用类名带来的问题，不能重蹈覆辙。 */
.footprint-globe-canvas {
  width: 100%;
  height: 100%;
}

.footprint-globe-error {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  color: #e8eaf2;
  font-size: 14px;
}
</style>
