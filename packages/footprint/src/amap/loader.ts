/**
 * 高德 JS API 的加载与实例管理。
 *
 * 与 Cesium 同理：高德 SDK 必须从官方域名加载才能通过鉴权，不能打进 bundle。
 * 全包只允许经由本文件取用 AMap，把 `any` 限制在这一处。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AMapNamespace = any;
export type AMapInstance = any;

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

const AMAP_VERSION = '2.0';

let loading: Promise<AMapNamespace> | null = null;
let loadedKey: string | null = null;

export function isAMapReady(): boolean {
  return typeof window !== 'undefined' && !!window.AMap;
}

export function getAMap(): AMapNamespace {
  if (!isAMapReady()) {
    throw new Error('高德地图 JS API 尚未加载');
  }
  return window.AMap;
}

/**
 * 按需加载高德 JS API。
 *
 * 换 Key 时重新加载，避免用户改了配置却仍在用旧 Key。
 * 加载失败要清空缓存，否则后续重试会一直拿到这个失败的 Promise。
 */
export function loadAMap(key: string): Promise<AMapNamespace> {
  if (!key) return Promise.reject(new Error('缺少高德 Js Key'));
  if (window.AMap && loadedKey === key) return Promise.resolve(window.AMap);
  if (loading && loadedKey === key) return loading;

  loadedKey = key;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=${AMAP_VERSION}&key=${encodeURIComponent(key)}`;
    script.onload = () => {
      if (window.AMap) resolve(window.AMap);
      else reject(new Error('高德脚本已加载但未挂载 AMap'));
    };
    script.onerror = () => {
      loading = null;
      loadedKey = null;
      reject(new Error('高德地图脚本加载失败'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * 2D 地图实例的生命周期。
 *
 * 保留原实现的关键决策：**切回 3D 时不销毁实例**，只是隐藏。
 * 重建一次高德地图要重新拉瓦片、重建所有标记，来回切换会非常卡；
 * 内存换流畅在这里是划算的。需要时可显式 destroy()。
 */
export class AMapHost {
  private map: AMapInstance | null = null;
  private initializing = false;

  get instance(): AMapInstance | null {
    return this.map;
  }

  get initialized(): boolean {
    return !!this.map;
  }

  /**
   * 进入 2D 视图。首次创建实例，之后仅触发 resize——
   * 容器在隐藏状态下尺寸为 0，不 resize 会显示成一小块。
   */
  async show(container: HTMLElement, key: string, options: Record<string, unknown> = {}) {
    if (this.map) {
      this.map.resize?.();
      return this.map;
    }
    if (this.initializing) return null;

    this.initializing = true;
    try {
      const AMap = await loadAMap(key);
      this.map = new AMap.Map(container, options);
      return this.map;
    } finally {
      this.initializing = false;
    }
  }

  /** 切回 3D：保留实例，返回时直接 resize 即可 */
  hide(): void {
    // 有意为空：保留实例是刻意的取舍，见类注释
  }

  destroy(): void {
    this.map?.destroy?.();
    this.map = null;
    this.initializing = false;
  }
}
