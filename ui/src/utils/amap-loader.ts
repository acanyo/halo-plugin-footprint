/**
 * 按需加载高德地图 JS API。
 *
 * 控制台是单页应用，脚本一旦注入就常驻，因此这里做两件事：
 * 1. 同一个 Key 只注入一次，重复调用复用同一个 Promise；
 * 2. 换 Key 时重新加载，避免用户改了配置却仍在用旧 Key。
 *
 * 不把 SDK 打进插件产物，是因为高德 JS API 必须从其官方域名加载才能通过鉴权。
 */

const AMAP_VERSION = "2.0";

/**
 * 只声明控制台实际用到的那一小部分高德 API（地图选点）。
 * 高德没有官方类型包，这里不追求完整，够用、能拦住拼写错误即可。
 */
export type LngLatTuple = [number, number];

export interface AMapClickEvent {
  lnglat: { getLng(): number; getLat(): number };
}

export interface AMapEventTarget {
  on(event: string, handler: (e: AMapClickEvent) => void): void;
}

export interface AMapMap extends AMapEventTarget {
  add(overlay: AMapMarker): void;
  setZoomAndCenter(zoom: number, center: LngLatTuple): void;
  destroy(): void;
}

export interface AMapMarker extends AMapEventTarget {
  setPosition(position: LngLatTuple): void;
}

export interface AMapNamespace {
  Map: new (
    container: HTMLElement,
    options: { zoom: number; center: LngLatTuple; mapStyle?: string },
  ) => AMapMap;
  Marker: new (options: {
    position: LngLatTuple;
    draggable?: boolean;
    cursor?: string;
  }) => AMapMarker;
}

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

let loadingPromise: Promise<AMapNamespace> | null = null;
let loadedKey: string | null = null;

export function loadAMap(key: string): Promise<AMapNamespace> {
  if (!key) {
    return Promise.reject(new Error("缺少高德 Js Key"));
  }
  if (window.AMap && loadedKey === key) {
    return Promise.resolve(window.AMap);
  }
  if (loadingPromise && loadedKey === key) {
    return loadingPromise;
  }

  loadedKey = key;
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=${AMAP_VERSION}&key=${encodeURIComponent(key)}`;
    script.onload = () => {
      if (window.AMap) {
        resolve(window.AMap);
      } else {
        reject(new Error("高德地图脚本已加载但未挂载 AMap"));
      }
    };
    script.onerror = () => {
      // 失败后清空缓存，否则后续重试会一直拿到这个失败的 Promise
      loadingPromise = null;
      loadedKey = null;
      reject(new Error("高德地图脚本加载失败"));
    };
    document.head.appendChild(script);
  });

  return loadingPromise;
}
