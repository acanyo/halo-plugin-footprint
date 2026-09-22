/**
 * WGS84 ↔ GCJ-02 坐标转换。
 *
 * 高德瓦片基于 GCJ-02（火星坐标），天地图基于 CGCS2000（≈WGS84）。
 * 在 WGS84 地球上叠加高德瓦片时，标记必须转成 GCJ-02 才能对准地图内容。
 * 算法为公开的 eviltransform / coordtransform 同款；海外坐标不加密，原样返回。
 *
 * 逐字迁移自 travel-memory.js「坐标转换」一节，数值逻辑未作任何改动——
 * 这里一旦有偏差，地图上所有标记都会整体偏移几十到几百米。
 */

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

export interface LngLat {
  lng: number;
  lat: number;
}

/** 是否在中国境外。境外坐标不做偏移加密。 */
export function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/** WGS84 → GCJ-02（在高德底图下放置标记时用） */
export function wgs84ToGcj02(lng: number, lat: number): LngLat {
  if (outOfChina(lng, lat)) {
    return { lng, lat };
  }
  const dLat = transformLat(lng - 105.0, lat - 35.0);
  const dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const mgLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  const mgLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lng: lng + mgLng, lat: lat + mgLat };
}

/** GCJ-02 → WGS84（天地图底图下用；迭代逼近，误差亚米级） */
export function gcj02ToWgs84(lng: number, lat: number): LngLat {
  if (outOfChina(lng, lat)) {
    return { lng, lat };
  }
  let lng2 = lng;
  let lat2 = lat;
  for (let i = 0; i < 3; i++) {
    const g = wgs84ToGcj02(lng2, lat2);
    lng2 = lng2 - (g.lng - lng);
    lat2 = lat2 - (g.lat - lat);
  }
  return { lng: lng2, lat: lat2 };
}
