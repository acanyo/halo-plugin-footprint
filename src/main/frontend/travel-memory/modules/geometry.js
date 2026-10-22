/**
 * 几何计算的小工具。
 *
 * 全是纯函数：给数值和矩形，返回数值和矩形，不读 DOM、不碰 Cesium。
 * 原先散落在主文件的照片环、省份卡片、城市卡片墙三处，同一个「矩形求交」
 * 写了两遍，改动时容易只改一处。
 */

/** 把 value 夹在 [min, max] 之间。 */
export function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/** 保留一位小数（用于展示经度纬度跨度等）。 */
export function round1(value) {
    return Math.round(value * 10) / 10;
}

/**
 * 坐标对齐到「设备像素」而不是 CSS 像素。
 *
 * 显示器开了 125% / 150% 缩放时（devicePixelRatio = 1.25 / 1.5），
 * 整数 CSS 像素映射过去仍是小数设备像素，落在半格上的卡片文字就是糊的。
 * 对齐后每张卡都落在整格上，文字栅格化才稳定清晰。
 */
export function snapDevicePx(value) {
    const dpr = window.devicePixelRatio || 1;
    return Math.round(value * dpr) / dpr;
}

/** 两个轴对齐矩形的交叠面积；不相交返回 0。 */
export function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (w > 0 && h > 0) ? w * h : 0;
}

/**
 * 把 n 张图均匀采样成 k 个下标（含首末）。
 *
 * n=12、k=5 时得到 0,3,6,8,11；不足 k 张时原样返回全部下标。
 */
export function ringSampleIndexes(n, k) {
    if (n <= k) return Array.from({ length: n }, (_, i) => i);
    const set = new Set();
    for (let i = 0; i < k; i++) {
        set.add(Math.round((i * (n - 1)) / (k - 1)));
    }
    let cursor = 0;
    while (set.size < k && cursor < n) {
        set.add(cursor);
        cursor++;
    }
    return [...set].sort((a, b) => a - b);
}

/**
 * 按图片原始宽高比等比装进一个盒子。
 *
 * 只在极端竖图 / 全景图时被上下限夹一下；缺少原始尺寸时按 4:3 估。
 */
export function fitBox(natW, natH, maxW, maxH, minW, minH) {
    const w0 = Number(natW) > 0 ? Number(natW) : 4;
    const h0 = Number(natH) > 0 ? Number(natH) : 3;
    const fit = Math.min(maxW / w0, maxH / h0);
    return {
        w: Math.round(Math.min(maxW, Math.max(minW || 0, w0 * fit))),
        h: Math.round(Math.min(maxH, Math.max(minH || 0, h0 * fit)))
    };
}

/**
 * 环上各位置的屏幕矩形（中心点 ± 每张自己的尺寸），加上整体平移量。
 *
 * @param entries [{x, y, w, h}] 中心点坐标的条目
 */
export function offsetCenteredRects(entries, dx, dy) {
    return entries.map(e => ({
        x: e.x - e.w / 2 + dx,
        y: e.y - e.h / 2 + dy,
        w: e.w,
        h: e.h
    }));
}

/** 一组矩形的包围盒。空数组时返回 Infinity / -Infinity，调用方需自行判空。 */
export function rectsBBox(rects) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rects.forEach(r => {
        minX = Math.min(minX, r.x);
        maxX = Math.max(maxX, r.x + r.w);
        minY = Math.min(minY, r.y);
        maxY = Math.max(maxY, r.y + r.h);
    });
    return { minX, maxX, minY, maxY };
}

/**
 * 一组矩形与卡片的交叠面积：**逐张**算，不按包围盒。
 *
 * 照片环是「弧」，包围盒的四角是空的；按包围盒判重叠会把
 * 「照片其实没碰到卡片」也算成压住，逼着整环离开标记。
 */
export function totalOverlapArea(rects, card) {
    if (!card) return 0;
    let sum = 0;
    rects.forEach(r => { sum += overlapArea(r, card); });
    return sum;
}

/**
 * 清掉重叠所需的最小平移：四个方向各算一次，取位移最小的那个方向。
 *
 * 同样只按「真的压住的照片」算，而不是按包围盒（否则会被空角落带着挪很远）。
 */
export function pushVector(rects, card) {
    let left = 0, right = 0, up = 0, down = 0;
    rects.forEach(r => {
        if (overlapArea(r, card) <= 0) return;
        left = Math.max(left, r.x + r.w - card.x);
        right = Math.max(right, card.x + card.w - r.x);
        up = Math.max(up, r.y + r.h - card.y);
        down = Math.max(down, card.y + card.h - r.y);
    });
    const best = Math.min(left, right, up, down);
    if (!(best > 0)) return { dx: 0, dy: 0, dist: 0 };
    if (best === left) return { dx: -best, dy: 0, dist: best };
    if (best === right) return { dx: best, dy: 0, dist: best };
    if (best === up) return { dx: 0, dy: -best, dist: best };
    return { dx: 0, dy: best, dist: best };
}

/** 两个朝向之间的夹角（0~π），用于「贴着上一帧朝向」的连续性偏好。 */
export function angleGap(a, b) {
    const twoPi = Math.PI * 2;
    const d = Math.abs(a - b) % twoPi;
    return d > Math.PI ? twoPi - d : d;
}
