import { getCesium, isCoarsePointer, type CesiumViewer } from './global';

/**
 * Cesium Viewer 的创建与销毁。
 *
 * 只负责「把 Viewer 造出来并调好性能参数」。底图、标记、标注、相机行为
 * 各有独立模块，不在这里堆——原实现把这些全塞在一起，正是它难以维护的起点。
 */

/**
 * LOD 容差按相机高度自适应。
 *
 * 阈值每减半，屏幕上的瓦片数大约翻两番（1.0 时是 2.0 的约 4 倍请求量）。
 * 天地图每天只有一万次额度，这笔账必须省：整球/中远距离用 Cesium 默认的 2.0，
 * 只有贴近地面看城市细节时才收紧到 1.0 保证文字锐利。
 */
const SSE_FAR = 2.0;
const SSE_NEAR = 1.0;
/** 相机低于此高度（米）算「贴近」 */
const SSE_NEAR_HEIGHT = 2_500_000;

/** 内存瓦片缓存。加大可减少转动/平移时的重复请求。 */
const TILE_CACHE_SIZE = 800;

export interface ViewerHandle {
  viewer: CesiumViewer;
  destroy(): void;
}

export function createViewer(container: HTMLElement | string): ViewerHandle {
  const Cesium = getCesium();

  const viewer = new Cesium.Viewer(container, {
    baseLayer: false, // 不用 Cesium 默认底图，全部换成国内服务
    animation: false,
    timeline: false,
    fullscreenButton: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    // 渲染倍率交给下面的 resolutionScale 统一控制
    useBrowserRecommendedResolution: true,
    // 不用 Cesium.Terrain.fromWorldTerrain()：它依赖海外 Ion 服务，
    // 地形改由天地图提供，见 terrain.ts
  });

  viewer.cesiumWidget.creditContainer.style.display = 'none';

  // 高分屏渲染倍率封顶。若放任等于 devicePixelRatio，3 倍屏手机等于按 9 倍像素
  // 渲染，拖动和捏合会明显掉帧。桌面最多 2 倍，触屏 1.5 倍（清晰度几乎无损）。
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, isCoarsePointer() ? 1.5 : 2);

  const applyScreenSpaceError = () => {
    const h = viewer.camera.positionCartographic.height;
    const next = h < SSE_NEAR_HEIGHT ? SSE_NEAR : SSE_FAR;
    if (viewer.scene.maximumScreenSpaceError !== next) {
      viewer.scene.maximumScreenSpaceError = next;
    }
  };
  viewer.camera.moveEnd.addEventListener(applyScreenSpaceError);
  applyScreenSpaceError();

  // 预取保持 Cesium 默认（preloadAncestors 打开），转动/平移时瓦片衔接才顺；
  // 只把内存缓存加大，减少重复请求
  viewer.scene.globe.tileCacheSize = TILE_CACHE_SIZE;

  return {
    viewer,
    destroy() {
      viewer.camera.moveEnd.removeEventListener(applyScreenSpaceError);
      if (!viewer.isDestroyed?.()) {
        viewer.destroy();
      }
    },
  };
}

/**
 * 暂停/恢复渲染循环。
 *
 * 票根墙需要透明背景透出地球，必须保持渲染；只有不透明的全屏层打开时才暂停。
 */
export function setRenderLoop(viewer: CesiumViewer, running: boolean): void {
  viewer.useDefaultRenderLoop = running;
}
