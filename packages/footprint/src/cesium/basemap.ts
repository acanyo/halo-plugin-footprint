import { getCesium, type ImageryProvider } from './global';
import { withUsageCounting } from './tile-usage';

/**
 * 底图图层。
 *
 * 高德无需 Key，天地图需要 Key（没配就只提供高德那几层）。
 * 本模块只负责「造出 provider」，不负责挂到 viewer 上——挂载与切换是
 * `basemap-switcher` 的职责，保持「构造」与「装配」分离。
 */

const AMAP_SUBDOMAINS = ['1', '2', '3', '4'];
const AMAP_MAX_LEVEL = 18;

const TDT_SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7'];
const TDT_MAX_LEVEL = 18;

export type BasemapId =
  | 'amapVec'
  | 'amapImg'
  | 'amapImgClean'
  | 'tdtVec'
  | 'tdtVecClean'
  | 'tdtImg'
  | 'tdtImgClean';

export interface BasemapLayers {
  /** 高德矢量路网（含地名标注） */
  amapVec: ImageryProvider;
  /** 高德卫星影像 */
  amapImg: ImageryProvider;
  /** 高德影像上的中文标注层（透明，叠加用） */
  amapImgLabel: ImageryProvider;
  /** 天地图矢量底图，未配置 Key 时为 null */
  tdtVec: ImageryProvider | null;
  /** 天地图矢量注记 */
  tdtCva: ImageryProvider | null;
  /** 天地图影像底图 */
  tdtImg: ImageryProvider | null;
  /** 天地图影像注记 */
  tdtCia: ImageryProvider | null;
}

/**
 * 高德瓦片地址。
 *
 * 三条 URL 的主机与参数各不相同，**不能按 style 推导**：
 * 路网走 webrd 且带 lang/size/scale，影像与影像注记都走 webst 且不带这些参数，
 * 而影像注记的 style 同样是 8。按 style 判断主机会把注记层指到错误的域名。
 */
const AMAP_URLS = {
  /** 矢量路网（含地名标注） */
  vec: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  /** 卫星影像 */
  img: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  /** 影像之上的中文标注（透明层，叠加用） */
  imgLabel: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
} as const;

function amapProvider(kind: keyof typeof AMAP_URLS): ImageryProvider {
  const Cesium = getCesium();
  return new Cesium.UrlTemplateImageryProvider({
    url: AMAP_URLS[kind],
    subdomains: AMAP_SUBDOMAINS,
    maximumLevel: AMAP_MAX_LEVEL,
  });
}

/**
 * 只请求中国范围内的瓦片。
 *
 * 境外瓦片拿回来是空白，但照样扣天地图额度。低层级（z ≤ 5）放行，
 * 保证整球视角不会开天窗——和三维地形用的是同一套思路。
 */
function limitToChina(provider: ImageryProvider): ImageryProvider {
  const Cesium = getCesium();
  const CHINA = Cesium.Rectangle.fromDegrees(72.0, 0.5, 138.5, 56.5);
  provider.getTileDataAvailable = function (x: number, y: number, level: number) {
    try {
      if (level <= 5) return true;
      const rect = provider.tilingScheme.tileXYToRectangle(x, y, level);
      return Cesium.Rectangle.contains(CHINA, Cesium.Rectangle.center(rect));
    } catch {
      // 异常时放行，别因为一次计算失败影响渲染
      return true;
    }
  };
  return provider;
}

/**
 * 天地图 _w（Web 墨卡托）瓦片：第 L 级为 2^L × 2^L 张，行列号与 Cesium 默认的
 * WebMercatorTilingScheme 直接对应，无需偏移。
 * 用 DataServer REST 接口而非 WMTS——后者因矩阵编号/几何不一致会导致瓦片错位。
 */
function tiandituProvider(layer: 'vec' | 'cva' | 'img' | 'cia', key: string): ImageryProvider {
  const Cesium = getCesium();
  return withUsageCounting(
    limitToChina(
      new Cesium.UrlTemplateImageryProvider({
        url: `https://t{s}.tianditu.gov.cn/DataServer?T=${layer}_w&x={x}&y={y}&l={z}&tk=${key}`,
        subdomains: TDT_SUBDOMAINS,
        maximumLevel: TDT_MAX_LEVEL,
      })
    )
  );
}

export function createBasemapLayers(tiandituKey: string): BasemapLayers {
  const hasKey = !!tiandituKey && tiandituKey !== 'YOUR_TIANDITU_KEY';
  return {
    amapVec: amapProvider('vec'),
    amapImg: amapProvider('img'),
    amapImgLabel: amapProvider('imgLabel'),
    tdtVec: hasKey ? tiandituProvider('vec', tiandituKey) : null,
    tdtCva: hasKey ? tiandituProvider('cva', tiandituKey) : null,
    tdtImg: hasKey ? tiandituProvider('img', tiandituKey) : null,
    tdtCia: hasKey ? tiandituProvider('cia', tiandituKey) : null,
  };
}

/** 天地图相关底图是否可用（未配置 Key 时对应按钮应禁用） */
export function hasTiandituLayers(layers: BasemapLayers): boolean {
  return !!layers.tdtVec;
}
