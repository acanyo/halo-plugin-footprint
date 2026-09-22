import { type CesiumViewer, type ImageryProvider } from './global';
import type { BasemapLayers } from './basemap';
import type { BaseCoordinateSystem } from './markers';

/**
 * 底图切换。
 *
 * 与 basemap.ts 分开：那边只负责「造 provider」，这边负责「装到 viewer 上」。
 * 切换底图会连带影响标记坐标系——高德瓦片是 GCJ-02，标记要从 WGS84 转换后
 * 才对得准；天地图是 ≈WGS84，直接用。所以切换后必须重建标记，
 * 这个联动由调用方通过 onCoordinateSystemChange 处理。
 */

export type BasemapKey =
  | 'amapVec'
  | 'amapImg'
  | 'amapImgClean'
  | 'tdtImg'
  | 'tdtVec'
  | 'tdtImgClean'
  | 'tdtVecClean';

export interface BasemapOption {
  label: string;
  /** 该底图用到的图层，按叠放顺序；后面的盖在前面之上（如影像 + 注记） */
  providers: (layers: BasemapLayers) => (ImageryProvider | null)[];
  /** 是否需要天地图 Key */
  needKey: boolean;
  /** 底图坐标系。gcj02 表示标记需从 WGS84 转换后再放置。 */
  system: BaseCoordinateSystem;
}

export const BASEMAPS: Record<BasemapKey, BasemapOption> = {
  amapVec: {
    label: '高德矢量',
    providers: (l) => [l.amapVec],
    needKey: false,
    system: 'gcj02',
  },
  amapImg: {
    label: '高德卫星',
    providers: (l) => [l.amapImg, l.amapImgLabel],
    needKey: false,
    system: 'gcj02',
  },
  amapImgClean: {
    label: '高德卫星·无字',
    providers: (l) => [l.amapImg],
    needKey: false,
    system: 'gcj02',
  },
  tdtImg: {
    label: '天地图影像',
    providers: (l) => [l.tdtImg, l.tdtCia],
    needKey: true,
    system: 'wgs84',
  },
  tdtVec: {
    label: '天地图矢量',
    providers: (l) => [l.tdtVec, l.tdtCva],
    needKey: true,
    system: 'wgs84',
  },
  tdtImgClean: {
    label: '天地图影像（无标注）',
    providers: (l) => [l.tdtImg],
    needKey: true,
    system: 'wgs84',
  },
  tdtVecClean: {
    label: '天地图矢量（无标注）',
    providers: (l) => [l.tdtVec],
    needKey: true,
    system: 'wgs84',
  },
};

export interface SwitchResult {
  /** 切换后的坐标系。与切换前不同就必须重建标记。 */
  system: BaseCoordinateSystem;
}

/**
 * 切换底图。
 *
 * @returns 切换后的坐标系；传入不可用的底图（需要 Key 但未配置）时返回 null
 */
export function switchBasemap(
  viewer: CesiumViewer,
  layers: BasemapLayers,
  key: BasemapKey
): SwitchResult | null {
  const option = BASEMAPS[key];
  if (!option) return null;

  const providers = option.providers(layers).filter((p): p is ImageryProvider => !!p);
  if (!providers.length) return null;

  viewer.imageryLayers.removeAll(false); // false：不销毁 provider，切回来时可复用
  providers.forEach((p) => viewer.imageryLayers.addImageryProvider(p));

  return { system: option.system };
}

/** 某个底图当前是否可选（天地图相关项需要已配置 Key） */
export function isBasemapAvailable(layers: BasemapLayers, key: BasemapKey): boolean {
  const option = BASEMAPS[key];
  if (!option) return false;
  if (!option.needKey) return true;
  return option.providers(layers).every((p) => !!p);
}
