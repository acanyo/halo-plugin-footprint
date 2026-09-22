import { getCesium, type CesiumViewer } from './global';
import { MARKER_SIZE, MARKER_URL, CITY_MARKER_SIZE, cityMarkerUrl } from './marker-icon';
import { wgs84ToGcj02 } from '../utils/coordinate';
import type { Footprint } from '../types/footprint';

/**
 * 足迹标记与城市聚合标记的实体管理。
 *
 * 只负责「按数据造出/销毁实体」。拾取、悬停、自愈各有独立模块——
 * 原实现把这些混在一起，导致标记相关逻辑散布在 1783、2379、2541、2945
 * 等好几段里，改一处要全文搜索。
 */

/**
 * 城市聚合键。
 *
 * 优先用 adcode：城市名可能被手动改过写法，「大理市」和「大理白族自治州」
 * 要算同一座城。没有 adcode 才退回城市名。
 * 卡片墙、城市视图、重走同城判定、明信片统计共用这一个键——改这里会同时
 * 影响那四处。
 */
export function cityKeyOf(fp: Footprint | null | undefined): string {
  if (!fp) return '';
  const code = String(fp.spec.cityAdcode || '').trim();
  if (code) return code;
  return String(fp.spec.city || '').trim();
}

export interface MarkerEntity {
  /** Cesium 实体 */
  entity: unknown;
  /** 对应的足迹 */
  footprint: Footprint;
}

export interface CityMarkerEntity {
  entity: unknown;
  /** 聚合键 */
  key: string;
  /** 展示用城市名 */
  name: string;
  /** 该城市下的所有足迹 */
  footprints: Footprint[];
}

/** 底图坐标系。高德瓦片是 GCJ-02，天地图是 ≈WGS84。 */
export type BaseCoordinateSystem = 'gcj02' | 'wgs84';

/** 按底图坐标系换算标记位置 */
function positionOf(fp: Footprint, system: BaseCoordinateSystem) {
  const lng = fp.spec.longitude;
  const lat = fp.spec.latitude;
  return system === 'gcj02' ? wgs84ToGcj02(lng, lat) : { lng, lat };
}

/**
 * 创建足迹标记。
 *
 * `disableDepthTestDistance: Infinity` 让标记不被地形遮挡；地球背面的隐藏
 * 由单独的遮挡计算处理，不依赖深度测试。
 */
export function createFootprintMarkers(
  viewer: CesiumViewer,
  footprints: Footprint[],
  system: BaseCoordinateSystem
): MarkerEntity[] {
  const Cesium = getCesium();
  return footprints.map((fp) => {
    const pos = positionOf(fp, system);
    const entity = viewer.entities.add({
      name: fp.spec.name,
      position: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 0),
      billboard: {
        image: MARKER_URL,
        width: MARKER_SIZE,
        height: MARKER_SIZE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    return { entity, footprint: fp };
  });
}

/**
 * 按城市聚合。
 *
 * 展示用的城市名取该组里出现次数最多的写法——同一 adcode 下可能混着
 * 「杭州」「杭州市」两种写法，取众数比取第一个稳。
 */
export function groupByCity(footprints: Footprint[]): Map<string, { name: string; items: Footprint[] }> {
  const groups = new Map<string, { names: Map<string, number>; items: Footprint[] }>();

  for (const fp of footprints) {
    const key = cityKeyOf(fp);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { names: new Map(), items: [] };
      groups.set(key, g);
    }
    g.items.push(fp);
    const name = String(fp.spec.city || '').trim();
    if (name) g.names.set(name, (g.names.get(name) || 0) + 1);
  }

  const result = new Map<string, { name: string; items: Footprint[] }>();
  for (const [key, g] of groups) {
    let best = '';
    let bestCount = -1;
    for (const [name, count] of g.names) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    result.set(key, { name: best || key, items: g.items });
  }
  return result;
}

/** 创建城市聚合标记。中心取该城市所有足迹的平均位置。 */
export function createCityMarkers(
  viewer: CesiumViewer,
  footprints: Footprint[],
  system: BaseCoordinateSystem
): CityMarkerEntity[] {
  const Cesium = getCesium();
  const groups = groupByCity(footprints);
  const result: CityMarkerEntity[] = [];

  for (const [key, { name, items }] of groups) {
    const positions = items.map((fp) => positionOf(fp, system));
    const lng = positions.reduce((s, p) => s + p.lng, 0) / positions.length;
    const lat = positions.reduce((s, p) => s + p.lat, 0) / positions.length;

    const entity = viewer.entities.add({
      name,
      position: Cesium.Cartesian3.fromDegrees(lng, lat, 0),
      billboard: {
        image: cityMarkerUrl(items.length),
        width: CITY_MARKER_SIZE,
        height: CITY_MARKER_SIZE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    result.push({ entity, key, name, footprints: items });
  }
  return result;
}

/** 移除一批实体 */
export function removeMarkers(
  viewer: CesiumViewer,
  markers: Array<{ entity: unknown }>
): void {
  markers.forEach((m) => viewer.entities.remove(m.entity));
}
