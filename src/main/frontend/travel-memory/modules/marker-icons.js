/**
 * 足迹标记与城市标记的图标：尺寸档位、玻璃圆环图块与照片标记的合成。
 *
 * 从 markers.js 拆出。尺寸与 SVG 图块是常量与纯函数；照片标记另有一份按图片地址的缓存
 * （合成结果是 data URL，Cesium 的贴图集按字符串去重，同一张图的多个标记只占一格）。
 */

import { COARSE_POINTER } from './env.js';
import { canvasSafeImageUrl } from './postcard.js';
import { accentHex, accentRgba } from '../../shared/accent.js';

// ================= 尺寸 =================
// 图块是正方形；可见图形（白玻璃圆环）占图块的 MARKER_RING_RATIO，外圈留给柔阴影。
// 整块图都铺一层 1% 透明度的命中层：Cesium 拾取会丢弃 alpha 为 0 的像素，
// 不铺的话只有圆环本身能点中，触屏很难点准。
// marker-input.js 的悬停命中半径 = 图块尺寸 × 0.55，和圆环半径（0.41）相比留出了一点余量。
export const MARKER_SIZE = COARSE_POINTER ? 46 : 42;
export const CITY_MARKER_SIZE = COARSE_POINTER ? 46 : 40;
export const MARKER_SIZE_SELECTED = Math.round(MARKER_SIZE * 1.24);   // 选中态放大一档
const MARKER_RING_RATIO = 0.82;   // 圆环直径 / 图块边长
const MARKER_RING_PAD = 4 / 58;   // 白圈厚度占圆环直径的比例（参考：58px 圆环里放 50px 照片）

// 配色与 styles/shared/tokens.css 一致。SVG / canvas 读不到 CSS 变量：
// 玻璃白写死，强调色取后台「主题色」（shared/accent.js）。
const GLASS = 'rgba(255, 255, 255, 0.95)';       // 比 --fp-glass-strong 更实：压在深色影像上不发灰
const ACCENT = accentHex();                      // --fp-accent
const ACCENT_SOFT = accentRgba(0.16);            // --fp-accent-soft（略加实，压在影像上）
const SHADOW = 'rgba(0, 0, 0, 0.32)';
const NUMBER_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

// ================= SVG 图块：照片未就绪 / 没有照片的足迹、城市聚合 =================
// 同一个 56×56 的 viewBox：外圈白玻璃 + 柔阴影；足迹是中间一枚强调色圆点，城市是强调色数字。
function glassRingSvg(inner) {
    const r = 28 * MARKER_RING_RATIO;
    return [
        '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">',
        '<defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%">',
        '<feDropShadow dx="0" dy="1.6" stdDeviation="1.8" flood-color="#000000" flood-opacity="0.3"/>',
        '</filter></defs>',
        '<circle cx="28" cy="28" r="27.5" fill="#ffffff" opacity="0.01"/>',
        '<circle cx="28" cy="28" r="' + r + '" fill="' + GLASS + '" filter="url(#s)"/>',
        inner(r),
        '</svg>'
    ].join('');
}
function svgDataUrl(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** 足迹标记的兜底图：白玻璃圆环 + 强调色圆点（照片加载前、或这条足迹没有照片）。 */
export const MARKER_URL = svgDataUrl(glassRingSvg((r) =>
    '<circle cx="28" cy="28" r="' + (r - 4) + '" fill="' + ACCENT_SOFT + '"/>' +
    '<circle cx="28" cy="28" r="' + (r * 0.3) + '" fill="' + ACCENT + '"/>'
));

/** 城市聚合标记：白玻璃圆环 + 强调色数字（这座城市的足迹数）。 */
export function cityMarkerUrl(count) {
    const text = String(count);
    const size = text.length > 2 ? 15 : 19;
    return svgDataUrl(glassRingSvg(() =>
        '<text x="28" y="' + (28 + size * 0.36) + '" fill="' + ACCENT + '" font-family="' +
        NUMBER_FONT.replace(/"/g, "'") + '" font-weight="700" font-size="' + size +
        '" text-anchor="middle">' + text + '</text>'
    ));
}

// ================= 照片标记：canvas 合成 =================
// Billboard 的图只能是同源可读的位图（SVG 数据 URL 里引用远程图会被浏览器拦掉），
// 所以照片标记在 canvas 上画好：柔阴影 → 白玻璃圆环 → 裁成圆形的照片，再导出成 data URL。
// 跨域图走插件的同源代理（canvasSafeImageUrl），否则 canvas 被污染、toDataURL 直接抛错。
const PHOTO_TILE_PX = 112;        // 合成画布边长：按 2 倍屏画，选中放大后也不糊
const PHOTO_LOAD_CONCURRENCY = 3; // 同时加载的照片数：别和地球瓦片抢带宽

const photoCache = new Map();     // 图片地址 -> data URL | null（null = 加载失败，不再重试）
const photoWaiters = new Map();   // 图片地址 -> 回调列表
const photoQueue = [];
let photoActive = 0;

function composePhotoTile(img) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PHOTO_TILE_PX;
    const ctx = canvas.getContext('2d');
    const c = PHOTO_TILE_PX / 2;
    const ringR = c * MARKER_RING_RATIO;
    const photoR = ringR * (1 - MARKER_RING_PAD * 2);
    // 命中层（与 SVG 图块一致）
    ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
    ctx.fillRect(0, 0, PHOTO_TILE_PX, PHOTO_TILE_PX);
    // 白玻璃圆环 + 柔阴影
    ctx.save();
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = PHOTO_TILE_PX * 0.07;
    ctx.shadowOffsetY = PHOTO_TILE_PX * 0.028;
    ctx.fillStyle = GLASS;
    ctx.beginPath();
    ctx.arc(c, c, ringR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 照片：按短边居中裁成正方形，再裁成圆
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, photoR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, sx, sy, side, side, c - photoR, c - photoR, photoR * 2, photoR * 2);
    ctx.restore();
    return canvas.toDataURL('image/png');
}

function finishPhoto(url, result) {
    photoCache.set(url, result);
    const waiters = photoWaiters.get(url) || [];
    photoWaiters.delete(url);
    waiters.forEach(fn => fn(result));
    photoActive--;
    drainPhotoQueue();
}

function drainPhotoQueue() {
    while (photoActive < PHOTO_LOAD_CONCURRENCY && photoQueue.length) {
        const url = photoQueue.shift();
        photoActive++;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => {
            let result = null;
            try {
                if (img.naturalWidth && img.naturalHeight) result = composePhotoTile(img);
            } catch (e) {
                result = null;   // 画布被污染（代理没生效）：停在兜底图
            }
            finishPhoto(url, result);
        };
        img.onerror = () => finishPhoto(url, null);
        img.src = canvasSafeImageUrl(url);
    }
}

/** 已合成好的照片标记（data URL）；还没好或加载失败时返回空串。 */
export function cachedMarkerPhoto(url) {
    return (url && photoCache.get(url)) || '';
}

/**
 * 排队合成一张照片标记；完成后回调 data URL（失败回调 null）。
 * 同一地址只加载一次，多次请求共用一个结果。
 */
export function requestMarkerPhoto(url, done) {
    if (!url) return;
    if (photoCache.has(url)) {
        const cached = photoCache.get(url);
        Promise.resolve().then(() => done(cached));
        return;
    }
    if (photoWaiters.has(url)) {
        photoWaiters.get(url).push(done);
        return;
    }
    photoWaiters.set(url, [done]);
    photoQueue.push(url);
    drainPhotoQueue();
}
