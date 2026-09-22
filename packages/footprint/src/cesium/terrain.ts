import { getCesium, type CesiumViewer } from './global';

/**
 * 天地图三维地形（可选，默认关闭）。
 *
 * 这是专有地形格式，`Cesium.sampleTerrain` 对它不适用，主要覆盖国内范围
 * （级别 5-12 左右）。天地图 Key 绑定域名白名单（未授权返回 403），
 * 且地形与影像/矢量共用每日配额（超限 429）。
 *
 * 因此默认不启用：用户点开时**先探测授权**，成功才启用，失败自动回退平面。
 * 这个「先探测再启用」的设计是原实现的，保留——直接启用会在授权失败时
 * 让 Cesium 疯狂重试并刷屏报错。
 */

const STORAGE_KEY = 'travelMemoryTerrain';

/** 天地图高程覆盖范围 */
const CHINA_BOUNDS = [72.0, 0.5, 138.5, 56.5] as const;

/** 探测用的固定瓦片。选中国境内一块必然有数据的区域。 */
const PROBE_URL = (key: string) =>
  `https://t0.tianditu.gov.cn/mapservice/swdx?T=elv_c&x=211&y=36&l=8&tk=${key}`;

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TdtPlug?: { GeoTerrainProvider?: any };
  }
}

export function readTerrainPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTerrainPreference(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 隐私模式下忽略
  }
}

/** 地形插件是否可用（脚本已加载且配置了 Key） */
export function isTerrainAvailable(tiandituKey: string): boolean {
  return !!tiandituKey && !!window.TdtPlug?.GeoTerrainProvider;
}

/** 关闭地形，回退到平滑椭球 */
export function disableTerrain(viewer: CesiumViewer): void {
  const Cesium = getCesium();
  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  writeTerrainPreference(false);
}

export interface EnableTerrainResult {
  ok: boolean;
  /** 失败原因，用于在状态栏给出可读提示 */
  reason?: string;
}

/**
 * 启用地形。先探测授权，成功才真正挂上。
 */
export async function enableTerrain(
  viewer: CesiumViewer,
  tiandituKey: string
): Promise<EnableTerrainResult> {
  if (!isTerrainAvailable(tiandituKey)) {
    return { ok: false, reason: '未配置天地图 Key 或地形插件未加载' };
  }

  const Cesium = getCesium();
  try {
    const res = await fetch(PROBE_URL(tiandituKey));
    if (!res.ok) {
      // 403 = Key 未授权本域名，429 = 当日配额用尽
      return {
        ok: false,
        reason: res.status === 403 ? 'Key 未授权当前域名' : `探测失败 HTTP ${res.status}`,
      };
    }

    const provider = new window.TdtPlug!.GeoTerrainProvider({
      url: `https://t{s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&x={x}&y={y}&l={z}&tk=${tiandituKey}`,
      subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    });

    // 天地图高程仅覆盖中国范围，且 Cesium 1.120 的 CustomHeightmapTerrainProvider
    // 不读 rectangle 选项。覆盖 getTileDataAvailable：境外/超深瓦片返回 false，
    // Cesium 直接标记为不可用而不发起请求，避免「无效数据」报错刷屏。
    const rect = Cesium.Rectangle.fromDegrees(...CHINA_BOUNDS);
    provider.getTileDataAvailable = function (x: number, y: number, level: number) {
      try {
        // 低级别插件返回平面缓冲，始终可用（保证球面能构建）
        if (level < 5) return true;
        const tileRect = provider.tilingScheme.tileXYToRectangle(x, y, level);
        return Cesium.Rectangle.contains(rect, Cesium.Rectangle.center(tileRect));
      } catch {
        return false;
      }
    };

    viewer.terrainProvider = provider;
    writeTerrainPreference(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
