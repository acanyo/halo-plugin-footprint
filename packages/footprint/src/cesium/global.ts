/**
 * 全局 Cesium 的访问边界。
 *
 * Cesium 由页面用 `<script src=".../cesium/Cesium.js">` 加载（它必须从自己的
 * 目录读取 Workers/Assets，打进 bundle 反而麻烦），因此不是 npm 依赖，
 * 而是挂在 window 上的全局对象。
 *
 * 全包只允许经由本文件取用 Cesium，好处有二：
 * 1. `any` 的扩散被限制在这一处，不会渗进业务代码；
 * 2. 未加载时给出明确报错，而不是在某个深处抛 "Cesium is not defined"。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CesiumNamespace = any;
export type CesiumViewer = any;
export type ImageryProvider = any;

declare global {
  interface Window {
    Cesium?: CesiumNamespace;
  }
}

export function isCesiumReady(): boolean {
  return typeof window !== 'undefined' && !!window.Cesium;
}

export function getCesium(): CesiumNamespace {
  if (typeof window === 'undefined' || !window.Cesium) {
    throw new Error(
      'Cesium 尚未加载。请确认页面在本组件之前引入了 /plugins/footprint/assets/static/cesium/Cesium.js'
    );
  }
  return window.Cesium;
}

/** 触屏设备判定。标记命中区尺寸与渲染倍率上限都依赖它。 */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}
