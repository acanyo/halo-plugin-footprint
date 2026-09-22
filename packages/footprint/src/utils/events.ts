/**
 * 组件 ↔ 地图层的事件契约。
 *
 * 两侧只通过 DOM 事件往来，不共享可变全局状态。集中定义事件名与载荷类型，
 * 避免像旧代码那样靠字符串字面量在 9000 行里对暗号。
 *
 * **`composed: true` 不能漏**：UI 面板开着 Shadow DOM，事件不加 composed
 * 会被影子边界吃掉，而且不会有任何报错——这是本次迁移最容易踩且最难查的坑。
 */

export interface FootprintEventMap {
  /** 请求相机飞到某个坐标 */
  'footprint:flyto': { longitude: number; latitude: number; zoom?: number };
  /** 请求打开某条足迹的详情 */
  'footprint:open-detail': { name: string };
  /** 请求打开图片灯箱 */
  'footprint:open-lightbox': { images: { url: string; caption?: string }[]; index: number };
  /** 切换 2D / 3D 视图 */
  'footprint:view-mode': { mode: '2d' | '3d' };
  /** 请求暂停/恢复地球渲染循环（全屏不透明浮层打开时暂停以省电） */
  'footprint:render-loop': { running: boolean };
  /** 城市筛选变化 */
  'footprint:city-filter': { city: string };
}

/**
 * 从组件内派发事件。
 *
 * @param target 派发源，通常是组件的宿主元素或其内部任意节点
 */
export function emit<K extends keyof FootprintEventMap>(
  target: EventTarget,
  type: K,
  detail: FootprintEventMap[K]
): void {
  target.dispatchEvent(
    new CustomEvent(type, {
      detail,
      bubbles: true,
      // 缺了它事件出不了 Shadow DOM，且不会报错
      composed: true,
    })
  );
}

/**
 * 在地图层（light DOM）监听组件派发的事件。
 *
 * @returns 取消监听的函数
 */
export function on<K extends keyof FootprintEventMap>(
  type: K,
  handler: (detail: FootprintEventMap[K]) => void,
  target: EventTarget = document
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<FootprintEventMap[K]>).detail);
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}
