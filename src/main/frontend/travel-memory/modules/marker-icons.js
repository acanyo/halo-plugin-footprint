/**
 * 足迹标记与城市标记的图标：尺寸档位与 SVG 图块。
 *
 * 从 markers.js 拆出。只有常量与纯函数，不持有任何状态。
 */

import { COARSE_POINTER } from './env.js';

// ================= 足迹标记点 =================
// 图标统一画在 56×56 的 viewBox 里，拆成「命中层」和「可见图形」两部分，
// 这样可以把可点击区域做大，而视觉上的圆点/圆环保持原样：
// - 命中层：r=27 的圆，填充 1% 透明度。Cesium 拾取会丢弃 alpha 为 0 的像素，
//   因此用几乎看不见的填充把命中区撑满整块图（旧版只有中间 r=22 能点到，
//   25px 的图标实际可点直径不到 20px，触屏很难点中）。
// - 可见图形：按 k 缩放。图块尺寸变大时图形画得更小，视觉大小保持不变。
const MARKER_BOX = 56;
const MARKER_HIT_R = 27;
export const MARKER_REF_SIZE = 26;          // 视觉基准：图块 26px 时圆环直径约 20px（与旧版一致）
export const CITY_MARKER_REF_SIZE = 30;     // 城市标记视觉基准
// 触屏设备整体放大命中区：视觉大小不变，只让手指更容易点中
export const MARKER_SIZE = COARSE_POINTER ? 38 : MARKER_REF_SIZE;
export const CITY_MARKER_SIZE = COARSE_POINTER ? 42 : CITY_MARKER_REF_SIZE;
export const MARKER_SIZE_SELECTED = Math.round(MARKER_SIZE * 34 / MARKER_REF_SIZE);   // 选中态沿用 34/26 的比例

// 配色与页面的测绘手簿色板一致（styles/shared/tokens.css）：标注红只用来表示「去过」。
// SVG 是数据 URL，读不到 CSS 变量，所以这里写死同样的色值。
const MARK_RED = '#d65a4f';
const PAPER_INK = '#e9ece8';
const NIGHT_PAPER = '#12171c';

export function markerIconUrl(kind, k, count) {
    const parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + MARKER_BOX + '" height="' + MARKER_BOX + '" viewBox="0 0 56 56">',
        '<circle cx="28" cy="28" r="' + MARKER_HIT_R + '" fill="#ffffff" opacity="0.01"/>'
    ];
    if (kind === 'city') {
        // 城市：深底圆牌 + 标注红描边 + 足迹数（文楷没进 SVG，用系统字即可，数字本来就是等宽的）
        parts.push('<circle cx="28" cy="28" r="' + (21 * k) + '" fill="' + NIGHT_PAPER + '" fill-opacity="0.82" stroke="' + MARK_RED + '" stroke-width="' + (2.4 * k) + '"/>');
        parts.push('<text x="28" y="' + (28 + 5 * k) + '" fill="' + PAPER_INK + '" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-weight="600" font-size="' + (15 * k) + '" text-anchor="middle">' + count + '</text>');
    } else {
        // 足迹：测量点的画法——实心红点 + 一圈纸色细环，压在任何底图上都分得出来
        parts.push('<circle cx="28" cy="28" r="' + (13 * k) + '" fill="none" stroke="' + PAPER_INK + '" stroke-width="' + (2 * k) + '" opacity="0.92"/>');
        parts.push('<circle cx="28" cy="28" r="' + (7.5 * k) + '" fill="' + MARK_RED + '" stroke="' + NIGHT_PAPER + '" stroke-width="' + (1.6 * k) + '"/>');
    }
    parts.push('</svg>');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(parts.join(''));
}
export const MARKER_URL = markerIconUrl('footprint', MARKER_REF_SIZE / MARKER_SIZE);

export function cityMarkerUrl(count) {
    // 绘制统一走 markerIconUrl（与足迹标记共用同一套命中层，见文件下方标记点一节）
    return markerIconUrl('city', CITY_MARKER_REF_SIZE / CITY_MARKER_SIZE, count);
}
