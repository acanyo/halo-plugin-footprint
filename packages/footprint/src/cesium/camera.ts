import { getCesium, type CesiumViewer } from './global';

/**
 * 相机控制参数。
 *
 * 只负责「把相机调成我们要的手感」，不含自动旋转——那是一套带状态的策略，
 * 见 auto-rotate.ts。
 */

/** 滚轮灵敏度系数。Cesium 默认 5，越小滚一格缩放越精细。 */
const WHEEL_ZOOM_FACTOR = 3.5;

/** 缩放距离范围（米）：防止放大穿入地形、拉远把地球滚丢 */
const MIN_ZOOM_DISTANCE = 50;
const MAX_ZOOM_DISTANCE = 50_000_000;

export function configureCamera(viewer: CesiumViewer): void {
  const controller = viewer.scene.screenSpaceCameraController;

  // zoomFactor 在 Cesium 1.121 才作为公开属性暴露（更新日志 #12099）。
  // 1.120 中设置公开属性不生效，滚轮逻辑读的是私有字段 _zoomFactor。
  // 做特性检测：新版本用公开属性，旧版本回退到私有字段。
  if ('zoomFactor' in controller) {
    controller.zoomFactor = WHEEL_ZOOM_FACTOR;
  } else {
    controller._zoomFactor = WHEEL_ZOOM_FACTOR;
  }

  controller.minimumZoomDistance = MIN_ZOOM_DISTANCE;
  controller.maximumZoomDistance = MAX_ZOOM_DISTANCE;
}

/**
 * 昼夜光照：按时钟时间计算太阳位置，夜半球变暗（2D 平面模式下不生效）。
 * 同时让时间自动推进，明暗分界线随时间缓缓移动。
 */
export function enableLighting(viewer: CesiumViewer): void {
  viewer.scene.globe.enableLighting = true;
  viewer.clock.shouldAnimate = true;
}

/**
 * 判断屏幕坐标是否落在地球圆盘内。
 *
 * 用相机射线与地球椭球求交：有交点 = 在地球上，无交点 = 在星空/空白处。
 * 纯数学计算，无 GPU 开销，因此可以按需高频调用。
 */
export function isPointOnGlobe(viewer: CesiumViewer, offsetX: number, offsetY: number): boolean {
  const Cesium = getCesium();
  const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(offsetX, offsetY));
  if (!ray) return false;
  return Cesium.IntersectionTests.rayEllipsoid(ray, viewer.scene.globe.ellipsoid) !== undefined;
}

/** 是否处于 3D 场景模式（2D 平面模式下部分行为要跳过） */
export function isScene3D(viewer: CesiumViewer): boolean {
  const Cesium = getCesium();
  return viewer.scene.mode === Cesium.SceneMode.SCENE3D;
}

export function flyTo(
  viewer: CesiumViewer,
  longitude: number,
  latitude: number,
  height = 20_000
): void {
  const Cesium = getCesium();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
  });
}
