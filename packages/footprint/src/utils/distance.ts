import type { Footprint } from '../types/footprint';

/**
 * 球面距离与行程统计。
 *
 * haversineKm 在原实现里被「重走一遍」「足迹洞察」「明信片统计」三处共用，
 * 逐字迁移。地球半径取 6371 km（平均半径），与原实现一致——
 * 换成赤道半径 6378 会让所有里程数字变化，那是可见的行为改变。
 */

const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

const pointOf = (fp: Footprint): LatLng => ({ lat: fp.spec.latitude, lng: fp.spec.longitude });

/** 按时间排序，无时间的排在最后（顺序稳定） */
export function sortByTime(footprints: Footprint[]): Footprint[] {
  return [...footprints].sort((a, b) => {
    const ta = a.spec.createTime ?? '';
    const tb = b.spec.createTime ?? '';
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return ta.localeCompare(tb);
  });
}

export interface JourneyStats {
  /** 总里程（公里） */
  totalKm: number;
  /** 站点数 */
  stops: number;
  /** 去过的城市数 */
  cities: number;
  /** 时间跨度（天），无有效时间时为 0 */
  spanDays: number;
  /** 相邻两站的距离，长度为 stops - 1 */
  legs: number[];
}

/** 按时间顺序串起整趟行程的统计 */
export function journeyStats(footprints: Footprint[]): JourneyStats {
  const sorted = sortByTime(footprints);
  const legs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    legs.push(haversineKm(pointOf(sorted[i - 1]), pointOf(sorted[i])));
  }

  const cities = new Set(
    sorted.map((fp) => fp.spec.cityAdcode || fp.spec.city || '').filter(Boolean)
  );

  const times = sorted.map((fp) => fp.spec.createTime).filter((t): t is string => !!t);
  let spanDays = 0;
  if (times.length >= 2) {
    const first = Date.parse(times[0]);
    const last = Date.parse(times[times.length - 1]);
    if (Number.isFinite(first) && Number.isFinite(last)) {
      spanDays = Math.max(0, Math.round((last - first) / 86_400_000));
    }
  }

  return {
    totalKm: legs.reduce((s, v) => s + v, 0),
    stops: sorted.length,
    cities: cities.size,
    spanDays,
    legs,
  };
}
