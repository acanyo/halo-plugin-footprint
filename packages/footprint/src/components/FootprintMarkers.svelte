<!--
  足迹标记层。

  shadow: 'none' —— 它不渲染任何自己的 DOM，只操作 Cesium 实体，
  开影子根没有意义。

  职责是**装配**：把 markers / picking / clustering / labels 四个模块接起来，
  并把 Cesium 侧的交互转译成 DOM 事件交给 UI 面板。所有算法都在那四个模块里，
  这里不含业务逻辑——这正是原实现缺的那层，它把实体创建、拾取、聚合切换、
  标签避让全写在一起，散落在 1783 / 1967 / 2379 / 2674 等好几段。
-->
<svelte:options customElement={{ tag: 'footprint-markers', shadow: 'none' }} />

<script lang="ts">
import { onMount } from 'svelte';
import {
  createCityMarkers,
  createFootprintMarkers,
  removeMarkers,
  type BaseCoordinateSystem,
  type CityMarkerEntity,
  type MarkerEntity,
} from '../cesium/markers';
import { MarkerPicking, applyMarkerSelection } from '../cesium/picking';
import { Clustering } from '../cesium/clustering';
import { labelGraphics, parseLabelMode, showCityLabels, showFootprintLabels } from '../cesium/labels';
import { layoutLabels, MAX_LABELS, type LabelCandidate } from '../cesium/label-layout';
import { MARKER_SIZE, CITY_MARKER_SIZE } from '../cesium/marker-icon';
import { getCesium, type CesiumViewer } from '../cesium/global';
import { emit } from '../utils/events';
import { store } from '../stores/footprint.svelte';

/** 由页面在 <footprint-markers> 上设置，指向同一个 viewer */
let host = $state<HTMLElement>();

let footprintMarkers: MarkerEntity[] = [];
let cityMarkers: CityMarkerEntity[] = [];
let picking: MarkerPicking | null = null;
let clustering: Clustering | null = null;
let viewer: CesiumViewer | null = null;
let system: BaseCoordinateSystem = 'gcj02';
let labelsDirty = true;

const labelMode = $derived(parseLabelMode(store.config.globeLabels));

/**
 * 绑定到地球组件的 viewer。由页面在两个组件都就绪后调用，
 * 而不是让本组件自己去 querySelector——那样会产生隐式的组件间耦合。
 */
export function attach(v: CesiumViewer) {
  viewer = v;
  rebuild();
  bindInteractions();
}

/** 底图切换后坐标系可能变化，标记必须按新坐标系重建 */
export function setCoordinateSystem(next: BaseCoordinateSystem) {
  if (next === system) return;
  system = next;
  rebuild();
}

function rebuild() {
  if (!viewer) return;
  removeMarkers(viewer, footprintMarkers);
  removeMarkers(viewer, cityMarkers);

  footprintMarkers = createFootprintMarkers(viewer, store.footprints, system);
  cityMarkers = createCityMarkers(viewer, store.footprints, system);

  attachLabels();
  clustering?.reapply();
  labelsDirty = true;
}

/**
 * 标签挂在已有实体上，不新增实体——实体本身已处理好模式切换与背面隐藏，
 * 标签跟着走即可，也不影响点击拾取。
 */
function attachLabels() {
  if (labelMode === 'off') return;
  if (showFootprintLabels(labelMode)) {
    footprintMarkers.forEach((m) => {
      (m.entity as { label?: unknown }).label = labelGraphics(m.footprint.spec.name, MARKER_SIZE);
    });
  }
  if (showCityLabels(labelMode)) {
    cityMarkers.forEach((m) => {
      (m.entity as { label?: unknown }).label = labelGraphics(m.name, CITY_MARKER_SIZE);
    });
  }
}

function bindInteractions() {
  if (!viewer) return;

  clustering = new Clustering(
    viewer,
    {
      cityEntities: () => cityMarkers.map((m) => m.entity as { show: boolean }),
      footprintEntities: () => footprintMarkers.map((m) => m.entity as { show: boolean }),
    },
    {
      onModeChange: () => {
        // 换了一批标签，下一帧重排避让
        labelsDirty = true;
      },
    }
  );

  picking = new MarkerPicking(
    viewer,
    {
      footprintEntities: () => footprintMarkers.map((m) => m.entity),
      cityEntities: () => cityMarkers.map((m) => m.entity),
    },
    {
      onClick: (target) => {
        if (!host) return;
        if (!target) {
          applyMarkerSelection(
            footprintMarkers.map((m) => m.entity as never),
            -1
          );
          return;
        }
        if (target.kind === 'footprint') {
          const m = footprintMarkers[target.index];
          applyMarkerSelection(
            footprintMarkers.map((e) => e.entity as never),
            target.index
          );
          store.select(m.footprint);
          emit(host, 'footprint:open-detail', { name: m.footprint.metadata.name });
        } else {
          const c = cityMarkers[target.index];
          emit(host, 'footprint:city-filter', { city: c.key });
        }
      },
    }
  );

  // 标签避让逐帧重排。相机没动时跳过，避免白白算上百个矩形相交。
  const onPostRender = () => {
    if (!labelsDirty || labelMode === 'off') return;
    labelsDirty = false;
    relayoutLabels();
  };
  viewer.scene.postRender.addEventListener(onPostRender);
  viewer.camera.changed.addEventListener(() => {
    labelsDirty = true;
  });
  // 窗口尺寸变化后也要重排：视口边界变了，但相机没动，光靠相机变化判定不会触发
  window.addEventListener('resize', () => {
    labelsDirty = true;
  });
}

/** 把可见标记投影到屏幕，跑一遍避让，再把结果写回 label 的偏移与显隐 */
function relayoutLabels() {
  if (!viewer) return;
  const Cesium = getCesium();
  const inCityMode = clustering?.current === 'city';
  const source = inCityMode
    ? cityMarkers.map((m) => ({ entity: m.entity, text: m.name, size: CITY_MARKER_SIZE }))
    : footprintMarkers.map((m) => ({
        entity: m.entity,
        text: m.footprint.spec.name,
        size: MARKER_SIZE,
      }));

  const width = viewer.scene.canvas.clientWidth;
  const height = viewer.scene.canvas.clientHeight;
  const cx = width / 2;
  const cy = height / 2;

  const visible: Array<{ entity: unknown; candidate: LabelCandidate; dist: number }> = [];
  for (const item of source) {
    const ent = item.entity as { show?: boolean; position?: { getValue(t: unknown): unknown }; label?: { show: boolean } };
    if (ent.show === false || !ent.label) continue;
    const world = ent.position?.getValue(viewer.clock.currentTime);
    if (!world) continue;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, world);
    if (!screen) {
      ent.label.show = false;
      continue;
    }
    visible.push({
      entity: ent,
      candidate: { x: screen.x, y: screen.y, text: item.text, markerSize: item.size },
      dist: (screen.x - cx) ** 2 + (screen.y - cy) ** 2,
    });
  }

  // 越靠视口中心越重要，优先占位；超出上限的直接不参与，省掉两两相交判断
  visible.sort((a, b) => a.dist - b.dist);
  const participating = visible.slice(0, MAX_LABELS);
  visible.slice(MAX_LABELS).forEach((v) => {
    (v.entity as { label: { show: boolean } }).label.show = false;
  });

  const placements = layoutLabels(
    participating.map((v) => v.candidate),
    { width, height }
  );

  participating.forEach((v, i) => {
    const label = (v.entity as { label: { show: boolean; pixelOffset: unknown } }).label;
    const offset = placements[i].offset;
    if (!offset) {
      label.show = false;
      return;
    }
    label.show = true;
    label.pixelOffset = new Cesium.Cartesian2(offset.x, offset.y);
  });
}

onMount(() => {
  return () => {
    picking?.destroy();
    clustering?.destroy();
    if (viewer) {
      removeMarkers(viewer, footprintMarkers);
      removeMarkers(viewer, cityMarkers);
    }
    footprintMarkers = [];
    cityMarkers = [];
  };
});
</script>

<div bind:this={host} hidden></div>
