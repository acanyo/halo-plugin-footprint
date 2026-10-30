/**
 * 程序化纹理：布面、书口纸纹、接触阴影与木纹，按需生成并缓存。
 */
import { PAGE_EDGE } from './constants.js';

// ---------------- 程序化纹理 ----------------

var clothCache = new Map();      // 布色 -> { map, bump }，6 组配色最多 6 份

export function makeCanvas(w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
}

// 布面：底色 + 经纬织纹 + 细颗粒。albedo 与 bump 一次生成，按色缓存复用。
export function clothTextures(THREE, hex) {
    if (clothCache.has(hex)) return clothCache.get(hex);

    var size = 256;
    // 布纹用「经 + 纬 + 斜」三道正弦叠出来的高度场，再推法线和粗糙度 ——
    // 这是 complete-shelf 的 clothSurfaceMaps 的做法。我原来是每 3px 一条
    // 横线加一条竖线的**硬网格**，近看就是纱窗/马赛克，塑料感就是从这儿来的。
    var height = new Float32Array(size * size);
    var phase = ((hex.charCodeAt(1) || 0) % 19) * 0.23;   // 用颜色当种子，同一块布稳定
    for (var hy = 0; hy < size; hy++) {
        for (var hx = 0; hx < size; hx++) {
            var warp = Math.sin((hx + phase) * Math.PI * 0.52);
            var weft = Math.sin((hy - phase) * Math.PI * 0.41);
            var cross = Math.sin((hx + hy + phase) * Math.PI * 0.19);
            height[hy * size + hx] = 0.5 + warp * 0.18 + weft * 0.15 + cross * 0.045;
        }
    }
    var base = new THREE.Color(hex);

    // 反照率：布色 × 高度场的微弱明暗（不是画线，是让经纬本身有色差）
    var albedo = makeCanvas(size, size);
    var a = albedo.getContext('2d');
    var albedoImage = a.createImageData(size, size);
    for (var ai = 0; ai < size * size; ai++) {
        var k = 0.93 + height[ai] * 0.15;
        albedoImage.data[ai * 4] = Math.max(0, Math.min(255, Math.round(base.r * 255 * k)));
        albedoImage.data[ai * 4 + 1] = Math.max(0, Math.min(255, Math.round(base.g * 255 * k)));
        albedoImage.data[ai * 4 + 2] = Math.max(0, Math.min(255, Math.round(base.b * 255 * k)));
        albedoImage.data[ai * 4 + 3] = 255;
    }
    a.putImageData(albedoImage, 0, 0);
    // 一点点绒毛/杂质，避免过于规整
    for (var n = 0; n < 2200; n++) {
        a.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
        a.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }

    // 高度图本身当 bump 用
    var bump = makeCanvas(size, size);
    var b = bump.getContext('2d');
    var bumpImage = b.createImageData(size, size);
    for (var bi = 0; bi < size * size; bi++) {
        var bv = Math.round(height[bi] * 255);
        bumpImage.data[bi * 4] = bumpImage.data[bi * 4 + 1] = bumpImage.data[bi * 4 + 2] = bv;
        bumpImage.data[bi * 4 + 3] = 255;
    }
    b.putImageData(bumpImage, 0, 0);

    // 法线：对高度场求梯度（和参考一样的两点差分）
    var normalCanvas = makeCanvas(size, size);
    var nctx = normalCanvas.getContext('2d');
    var dst = nctx.createImageData(size, size);
    var at = function (x, y) {
        return height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
    };
    for (var ny = 0; ny < size; ny++) {
        for (var nx = 0; nx < size; nx++) {
            var ddx = (at(nx + 1, ny) - at(nx - 1, ny)) * 1.5;
            var ddy = (at(nx, ny + 1) - at(nx, ny - 1)) * 1.5;
            var len = Math.sqrt(ddx * ddx + ddy * ddy + 1);
            var o = (ny * size + nx) * 4;
            dst.data[o] = Math.round((-ddx / len * 0.5 + 0.5) * 255);
            dst.data[o + 1] = Math.round((-ddy / len * 0.5 + 0.5) * 255);
            dst.data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
            dst.data[o + 3] = 255;
        }
    }
    nctx.putImageData(dst, 0, 0);

    // 粗糙度：跟着高度走 —— 布面明暗不均匀的关键，塑料没有这一项
    var roughCanvas = makeCanvas(size, size);
    var rctx = roughCanvas.getContext('2d');
    var rd = rctx.createImageData(size, size);
    for (var ri = 0; ri < size * size; ri++) {
        var v = Math.round(188 + height[ri] * 56);
        rd.data[ri * 4] = rd.data[ri * 4 + 1] = rd.data[ri * 4 + 2] = v;
        rd.data[ri * 4 + 3] = 255;
    }
    rctx.putImageData(rd, 0, 0);

    var result = {
        map: new THREE.CanvasTexture(albedo),
        bump: new THREE.CanvasTexture(bump),
        normal: new THREE.CanvasTexture(normalCanvas),
        roughness: new THREE.CanvasTexture(roughCanvas)
    };
    result.normal.wrapS = result.normal.wrapT = THREE.RepeatWrapping;
    result.roughness.wrapS = result.roughness.wrapT = THREE.RepeatWrapping;
    result.map.colorSpace = THREE.SRGBColorSpace;
    result.map.wrapS = result.map.wrapT = THREE.RepeatWrapping;
    result.bump.wrapS = result.bump.wrapT = THREE.RepeatWrapping;
    result.map.anisotropy = 8;
    result.bump.anisotropy = 8;
    result.normal.anisotropy = 8;
    result.roughness.anisotropy = 8;
    // 织纹要够密：书在检视态会放大到 3 倍以上，1 倍多的重复会把
    // 每根经纬线拉成粗格子，整块封板看起来像马赛克
    result.map.repeat.set(5, 8);
    result.bump.repeat.copy(result.map.repeat);
    result.normal.repeat.copy(result.map.repeat);
    result.roughness.repeat.copy(result.map.repeat);
    clothCache.set(hex, result);
    return result;
}


// 书口：细密横向纸纹
var pageEdgeCache = null;

export function pageEdgeTexture(THREE) {
    if (pageEdgeCache) return pageEdgeCache;
    // 分辨率提到 192×768（参考实现书口贴图是 512×2048）：
    // 书口那块只有 0.3 个世界单位宽，贴图糊一点就全平了。
    var w = 192;
    var h = 768;
    var canvas = makeCanvas(w, h);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = PAGE_EDGE;
    ctx.fillRect(0, 0, w, h);
    // 纸边细线要"数得出来"。
    // 原来是每 2px 一根、纹理再 repeat 4 次 —— 等于上千根挤在书口上，
    // 渲染出来就是一片均匀的糊色（正对书口时尤其明显）。
    // 现在每 6px 一根、不再重复，约 40 根，并穿插几根更深的"订口"，
    // 近看是一条条纸页，远看是纸口质感。
    for (var y = 0; y < h; y += 18) {
        var sig = (y / 18) % 7 === 3;
        ctx.fillStyle = sig ? 'rgba(96,82,62,0.5)' : 'rgba(126,112,90,0.32)';
        ctx.fillRect(0, y, w, sig ? 4 : 2);
        ctx.fillStyle = 'rgba(255,251,242,0.45)';
        ctx.fillRect(0, y + (sig ? 4 : 2), w, 2);
    }
    pageEdgeCache = new THREE.CanvasTexture(canvas);
    pageEdgeCache.colorSpace = THREE.SRGBColorSpace;
    pageEdgeCache.wrapS = pageEdgeCache.wrapT = THREE.RepeatWrapping;
    pageEdgeCache.repeat.set(1, 1);
    return pageEdgeCache;
}

// 木架：横向木纹（反照率 / 粗糙度 / 法线）
var woodCache = null;
// 书脚接触阴影用的软椭圆贴图（中心淡黑、边缘透明），和 reference 的接触阴影同一思路
var contactShadowCache = null;
export function contactShadowMaterial(THREE) {
    if (contactShadowCache) return contactShadowCache;
    var size = 128;
    var canvas = makeCanvas(size, size);
    var ctx = canvas.getContext('2d');
    var grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // 淡淡的就好：0.34 的浓度在亮色板面上看着像"贴了一块"。现在 0.2 起
    grad.addColorStop(0, 'rgba(60,44,26,0.2)');
    grad.addColorStop(0.45, 'rgba(60,44,26,0.11)');
    grad.addColorStop(0.78, 'rgba(60,44,26,0.03)');
    grad.addColorStop(1, 'rgba(60,44,26,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    contactShadowCache = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.9
    });
    return contactShadowCache;
}

// 木架贴图：反照率 + 粗糙度 + 法线三张。
// 原来只有 256×64 的一张色图（比封面贴图低一个数量级），所以近看就是"刷了漆的板子"。
// 现在按木头的成因画：底色随长度缓慢明暗 → 顺纹曲线 → 木节 → 顺纹高光，
// 再由高度场推粗糙度和法线（和书脊布面那套做法一样）。
export function woodMaps(THREE) {
    if (woodCache) return woodCache;
    var w = 1024;
    var h = 256;
    var canvas = makeCanvas(w, h);
    var ctx = canvas.getContext('2d');

    var seed = 20260924;
    var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    // 底色：暖棕色，沿长度方向做几段明暗（像不同木料拼板）
    ctx.fillStyle = '#9c7137';
    ctx.fillRect(0, 0, w, h);
    for (var b = 0; b < 7; b++) {
        var bx = (b / 7) * w;
        var bw = w / 7;
        ctx.fillStyle = 'rgba(' + (150 + Math.round(rnd() * 40)) + ',' +
            (105 + Math.round(rnd() * 26)) + ',' + (50 + Math.round(rnd() * 22)) + ',0.35)';
        ctx.fillRect(bx, 0, bw, h);
    }

    // 高度场：顺纹为主，叠一点宽年轮
    var height = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var grain = Math.sin((y + Math.sin(x * 0.008) * 6) * 0.55);
            var ring = Math.sin((y * 0.14 + x * 0.004));
            height[y * w + x] = 0.5 + grain * 0.16 + ring * 0.06;
        }
    }

    // 顺纹线条：细长、颜色深浅相间
    for (var i = 0; i < 320; i++) {
        var gy = rnd() * h;
        var dark = rnd() > 0.45;
        ctx.strokeStyle = dark
            ? 'rgba(58,38,14,' + (0.06 + rnd() * 0.16).toFixed(3) + ')'
            : 'rgba(255,238,206,' + (0.05 + rnd() * 0.14).toFixed(3) + ')';
        ctx.lineWidth = 0.6 + rnd() * 2.2;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(w * 0.28, gy + (rnd() - 0.5) * 7,
            w * 0.72, gy + (rnd() - 0.5) * 7, w, gy + (rnd() - 0.5) * 3);
        ctx.stroke();
    }

    // 木节：几个同心椭圆
    for (var k = 0; k < 3; k++) {
        var kx = rnd() * w, ky = rnd() * h;
        for (var ring2 = 5; ring2 >= 1; ring2--) {
            ctx.strokeStyle = ring2 % 2
                ? 'rgba(62,40,16,' + (0.10 + 0.03 * ring2).toFixed(3) + ')'
                : 'rgba(214,178,124,0.16)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.ellipse(kx, ky, ring2 * 7, ring2 * 4.2, 0.3, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // 顺纹高光带（板面靠上一条更亮、更"油"的地方）
    var sheenBand = ctx.createLinearGradient(0, 0, 0, h);
    sheenBand.addColorStop(0, 'rgba(255,240,212,0.14)');
    sheenBand.addColorStop(0.42, 'rgba(255,240,212,0.03)');
    sheenBand.addColorStop(1, 'rgba(46,28,8,0.16)');
    ctx.fillStyle = sheenBand;
    ctx.fillRect(0, 0, w, h);

    var map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;

    // 粗糙度：木纹深的地方更粗糙
    var roughCanvas = makeCanvas(w, h);
    var rctx = roughCanvas.getContext('2d');
    var rd = rctx.createImageData(w, h);
    for (var ri = 0; ri < w * h; ri++) {
        var v = Math.round(196 + (0.5 - Math.abs(height[ri] - 0.5)) * 90);
        rd.data[ri * 4] = rd.data[ri * 4 + 1] = rd.data[ri * 4 + 2] = v;
        rd.data[ri * 4 + 3] = 255;
    }
    rctx.putImageData(rd, 0, 0);
    var roughness = new THREE.CanvasTexture(roughCanvas);
    roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
    roughness.anisotropy = 8;

    // 法线：从高度场求梯度
    var normalCanvas = makeCanvas(w, h);
    var nctx = normalCanvas.getContext('2d');
    var nd = nctx.createImageData(w, h);
    var at = function (x, y) {
        return height[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
    };
    for (var ny = 0; ny < h; ny++) {
        for (var nx = 0; nx < w; nx++) {
            var dx = (at(nx + 1, ny) - at(nx - 1, ny)) * 1.2;
            var dy = (at(nx, ny + 1) - at(nx, ny - 1)) * 1.2;
            var len = Math.sqrt(dx * dx + dy * dy + 1);
            var o = (ny * w + nx) * 4;
            nd.data[o] = Math.round((-dx / len * 0.5 + 0.5) * 255);
            nd.data[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
            nd.data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
            nd.data[o + 3] = 255;
        }
    }
    nctx.putImageData(nd, 0, 0);
    var normal = new THREE.CanvasTexture(normalCanvas);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.anisotropy = 8;

    woodCache = { map: map, roughness: roughness, normal: normal };
    return woodCache;
}
