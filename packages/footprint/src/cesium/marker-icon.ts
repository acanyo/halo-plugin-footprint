import { isCoarsePointer } from './global';

/**
 * 标记图标（内联 SVG data URI）。
 *
 * 图标统一画在 56×56 的 viewBox 里，拆成「命中层」和「可见图形」两部分，
 * 这样可点击区域做大而视觉大小不变：
 *
 * - **命中层**：r=27 的圆，填充 1% 透明度。Cesium 拾取会丢弃 alpha 为 0 的像素，
 *   所以用几乎看不见的填充把命中区撑满整块图。旧版只有中间 r=22 能点到，
 *   25px 的图标实际可点直径不到 20px，触屏很难点中。
 * - **可见图形**：按系数 k 缩放。图块尺寸变大时图形画得更小，视觉大小保持不变。
 *
 * 触屏设备整体放大图块尺寸（命中区随之变大），但通过 k 让视觉大小不变。
 */

const BOX = 56;
const HIT_R = 27;

/** 视觉基准：图块 26px 时圆环直径约 20px（与旧版一致） */
export const MARKER_REF_SIZE = 26;
/** 城市标记视觉基准 */
export const CITY_MARKER_REF_SIZE = 30;

/** 实际图块尺寸。触屏放大以便手指点中。 */
export const MARKER_SIZE = isCoarsePointer() ? 38 : MARKER_REF_SIZE;
export const CITY_MARKER_SIZE = isCoarsePointer() ? 42 : CITY_MARKER_REF_SIZE;
/** 选中态沿用 34/26 的比例 */
export const MARKER_SIZE_SELECTED = Math.round((MARKER_SIZE * 34) / MARKER_REF_SIZE);

export type MarkerKind = 'footprint' | 'city';

/**
 * @param kind  足迹点或城市聚合点
 * @param k     视觉缩放系数 = 基准尺寸 / 实际图块尺寸
 * @param count 城市聚合点上显示的足迹数量
 */
export function markerIconUrl(kind: MarkerKind, k: number, count?: number): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${BOX}" viewBox="0 0 ${BOX} ${BOX}">`,
    // 命中层：opacity 必须 > 0，Cesium 拾取会丢弃完全透明的像素
    `<circle cx="28" cy="28" r="${HIT_R}" fill="#ffffff" opacity="0.01"/>`,
    `<circle cx="28" cy="28" r="${22 * k}" fill="none" stroke="#ffffff" stroke-width="${2.5 * k}" opacity="0.9"/>`,
  ];
  if (kind === 'city') {
    parts.push(
      `<text x="28" y="${28 + 3 * k}" fill="#f7f5f1" ` +
        `font-family="PingFang SC, Microsoft YaHei, sans-serif" ` +
        `font-size="${15 * k}" text-anchor="middle">${count ?? ''}</text>`
    );
  } else {
    parts.push(
      `<circle cx="28" cy="28" r="${8 * k}" fill="#ffffff" stroke="#1a2029" stroke-width="${2 * k}"/>`
    );
  }
  parts.push('</svg>');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(parts.join(''));
}

/** 足迹标记的默认图标 */
export const MARKER_URL = markerIconUrl('footprint', MARKER_REF_SIZE / MARKER_SIZE);

/** 城市聚合标记的图标（数量不同图标不同，需按需生成） */
export function cityMarkerUrl(count: number): string {
  return markerIconUrl('city', CITY_MARKER_REF_SIZE / CITY_MARKER_SIZE, count);
}
