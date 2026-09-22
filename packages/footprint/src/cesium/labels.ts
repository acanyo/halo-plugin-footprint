import { getCesium } from './global';

/**
 * 常驻地名标注。
 *
 * 底图选「无字」时画面上没有任何地名，只靠悬停显示名称：触屏根本没有 hover，
 * 桌面上也要逐个去碰运气。做法是给**已有的标记实体**挂一个 label——
 * 实体本身已经处理好了「模式切换 / 转到背面隐藏」，标签跟着实体走即可，
 * 既不新增实体，也不影响点击拾取。
 *
 * 屏幕空间避让的算法在 label-layout.ts，这里只管标签的视觉参数。
 */

export type LabelMode = 'off' | 'city' | 'all';

export function parseLabelMode(raw: unknown): LabelMode {
  const v = String(raw ?? 'all')
    .trim()
    .toLowerCase();
  return v === 'off' || v === 'city' || v === 'all' ? v : 'all';
}

export function showCityLabels(mode: LabelMode): boolean {
  return mode !== 'off';
}

export function showFootprintLabels(mode: LabelMode): boolean {
  return mode === 'all';
}

const FONT = '500 12px "PingFang SC", "Microsoft YaHei", sans-serif';
/** 与上面的字号保持一致：避让时按它估算文字宽度 */
export const FONT_PX = 12;
/** 标签与标记之间的间隙（贴着圆点写，字小的时候更自然） */
const GAP = 4;

/**
 * 标签图形参数。
 *
 * `outlineWidth: 2.5` 等价于原来的 text-shadow 描边，压在影像底图上也能读清。
 * `show: false` 是有意的：由标记模式切换打开，再由避让布局逐帧决定最终可见性。
 */
export function labelGraphics(text: string, markerSize: number) {
  const Cesium = getCesium();
  return {
    text,
    font: FONT,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.fromCssColorString('#0b0e14').withAlpha(0.85),
    outlineWidth: 2.5,
    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
    verticalOrigin: Cesium.VerticalOrigin.TOP,
    pixelOffset: new Cesium.Cartesian2(0, Math.round(markerSize * 0.42) + GAP),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    show: false,
  };
}
