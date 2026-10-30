/**
 * 书封与书脊的画布绘制：封面、书脊、书脊烫金层与封底。
 */

import { formatMonth, palette } from './utils.js';
import { TYPE, TITLE, SANS, mixedRuns, drawMixedLine } from './typography.js';
import { makeCanvas } from './textures.js';

// 书封：布面底 + 烫金细框 + 书名 + 封面照片 + 底部元信息。
// 单独拆出一个「重绘」函数：封面照片是异步加载的，加载完要在同一张 canvas 上重画一次。
// foilOnly=true 时只在**透明底**上画出烫金部分（画成白色，颜色交给材质），
// 用于单独一层金属烫金网格；false 时是完整的布面封面。


export function paintCover(canvas, book, index, foilOnly) {
    // 逻辑坐标固定 384×576，画布可以是它的整数倍。
    // 参考实现的封面/烫金都是 768 的，我们原来是 384 —— 贴到 1.5×2.2 的书面上
    // 就是"糊"，近看立刻露馅（这正是"模型不够真实"里最直接的一条）。
    var w = 384;
    var h = 576;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    var colors = palette(index);
    ctx.clearRect(0, 0, w, h);

    if (!foilOnly) {
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, w, h);

        // 布纹（比 3D 贴图更淡，避免远景摩尔纹）
        for (var y = 0; y < h; y += 3) {
            ctx.fillStyle = 'rgba(255,255,255,0.028)';
            ctx.fillRect(0, y, w, 1);
        }
        for (var x = 0; x < w; x += 3) {
            ctx.fillStyle = 'rgba(0,0,0,0.03)';
            ctx.fillRect(x, 0, 1, h);
        }
    }

    // 烫金细框
    ctx.strokeStyle = foilOnly ? '#ffffff' : colors[2];
    // 框线原来只有 1.5px、透明度 0.55，投到封面上是一道很细的暗线；
    // 现在加粗提亮，才是"烫金细框"而不是"黑边"。
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2.4;
    ctx.strokeRect(22.5, 22.5, w - 45, h - 45);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 0.9;
    ctx.strokeRect(19, 19, w - 38, h - 38);
    ctx.globalAlpha = 1;

    // 顶部：这本书收了哪些年份（真实信息，取代原来的「旅 行 手 册」装饰字）
    ctx.fillStyle = foilOnly ? '#ffffff' : colors[2];
    ctx.globalAlpha = 0.86;
    ctx.font = '500 15px ' + SANS;
    ctx.textAlign = 'center';
    ctx.fillText(book.yearRange || '', w / 2, 66);
    ctx.globalAlpha = 0.4;
    ctx.fillRect(w / 2 - 34, 80, 68, 1);
    ctx.globalAlpha = 1;

    // 书名（按字数自适应 + 逐字换行）
    var chars = String(book.name || '').split('');
    var titleSize = chars.length > 7 ? 42 : chars.length > 4 ? 52 : 62;
    ctx.font = '400 ' + titleSize + 'px ' + TITLE;
    ctx.fillStyle = foilOnly ? '#ffffff' : colors[2];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lines = chars.length > 4 ? 2 : 1;
    var perLine = Math.ceil(chars.length / lines);
    for (var li = 0; li < lines; li++) {
        var text = chars.slice(li * perLine, (li + 1) * perLine).join('');
        if (!text) continue;
        ctx.fillText(text, w / 2, 132 + li * (titleSize + 10));
    }

    // 书名下方留白，再往下才是照片位（原来的「私人旅行纪念册」装饰字去掉）
    var titleBlockBottom = 132 + lines * (titleSize + 10);

    var photoTop = titleBlockBottom + 22;
    var photoHeight = h - photoTop - 108;

    // 照片位（未加载完成时先留一块布色底）；烫金层只画它外圈的金边
    if (!foilOnly) {
        ctx.save();
        roundRect(ctx, 40, photoTop, w - 80, photoHeight, 4);
        ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(40, photoTop, w - 80, photoHeight);
        if (book._coverImage) {
            drawCover(ctx, book._coverImage, 40, photoTop, w - 80, photoHeight);
        }
        ctx.restore();
    }
    ctx.strokeStyle = foilOnly ? '#ffffff' : colors[2];
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(40.5, photoTop + 0.5, w - 81, photoHeight - 1);
    ctx.globalAlpha = 1;

    // 底部元信息（城市数 / 照片数 / 时间）：**不烫金**，是印在布面上的小字 ——
    // 真实精装书的这一栏本来就是印上去的版权/印次信息，不是烫金。
    // 之前它在布面层和烫金层各画了一遍（金层又描一道），所以看着"又糊又像金"。
    // 现在只在布面这层画（foilOnly 直接跳过），并换成"数字用西文衬线 + 中文用宋体"
    // 的两段式排版：数字字距略开、标签更小更淡，中间压一条细线分隔。
    if (!foilOnly) {
        // 排版保持原来的两行（上一版我拆成三行，反而把版面弄乱了）。
        // 只做两件事：① 不在烫金层里画（现在这栏是印在布面上的字）；
        // ② 字体换成"数字走西文衬线、中文走宋体"的一套真实字体栈。
        ctx.fillStyle = colors[2];
        ctx.textBaseline = 'alphabetic';
        drawMixedLine(ctx,
            mixedRuns(book.cityCount + ' 座城市，' + book.photoCount + ' 张照片',
                TYPE.coverMetaLatin, TYPE.coverMeta),
            w / 2, h - 60, 0.9);
        drawMixedLine(ctx,
            mixedRuns(formatMonth(book.latestTime) || '时间未记录',
                TYPE.coverMetaLatinSmall, TYPE.coverMetaSmall),
            w / 2, h - 34, 0.66);
        ctx.globalAlpha = 1;
    }

}

export function coverTexture(THREE, book, index) {
    var canvas = makeCanvas(768, 1152);
    paintCover(canvas, book, index);
    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 16;      // 封面是斜看的，细字/金线靠它才不糊
    texture._canvas = canvas;
    // 封面照片到位后重画，不重建贴图
    texture._repaint = function () {
        paintCover(canvas, book, index);
        texture.needsUpdate = true;
    };
    return texture;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// 把照片按「覆盖」方式画进指定矩形（保持比例，裁掉多余）
export function drawCover(ctx, image, dx, dy, dw, dh) {
    var iw = image.naturalWidth || image.width;
    var ih = image.naturalHeight || image.height;
    if (!iw || !ih) return;
    var scale = Math.max(dw / iw, dh / ih);
    var sw = dw / scale;
    var sh = dh / scale;
    var sx = (iw - sw) / 2;
    var sy = (ih - sh) / 2;
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
}

// 书脊：竖排书名 + 序号
export function spineTexture(THREE, book, index) {
    // 同上：逻辑坐标 96×576，画布按倍率放大（参考实现书脊贴图是 384 宽）
    var w = 96;
    var h = 576;
    var canvas = makeCanvas(384, 1152);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    var colors = palette(index);

    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    for (var y = 0; y < h; y += 3) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(0, y, w, 1);
    }

    // 横向明暗渐变 —— 这是"书脊像不像参考"的关键一步。
    // complete-shelf 的书脊贴图最外层就是从 0 到 1 的一条渐变：
    // 两侧压暗、靠前 1/4 处一条亮带。书脊轮廓虽然是平的，靠这条渐变
    // 才读得出「中间鼓起来」的圆弧感。我之前完全没有它，于是书脊就是
    // 一块死平的布板。
    var shade = ctx.createLinearGradient(0, 0, w, 0);
    // 书脊的圆弧明暗。用户连提两轮"中间还是少一段、不够宽"：
    // 根因是我这条渐变**不对称** —— 亮峰压在左边 18%~45%，中段和右侧偏暗，
    // 看过去就像中间断了一截。真实圆脊是"中线最亮、往两侧对称衰减"，
    // 所以改成中间一条很宽的平台，两侧再压深。
    shade.addColorStop(0, 'rgba(0,0,0,0.34)');
    shade.addColorStop(0.06, 'rgba(0,0,0,0.10)');
    shade.addColorStop(0.16, 'rgba(255,255,255,0.10)');
    shade.addColorStop(0.32, 'rgba(255,255,255,0.17)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0.19)');
    shade.addColorStop(0.68, 'rgba(255,255,255,0.17)');
    shade.addColorStop(0.84, 'rgba(255,255,255,0.10)');
    shade.addColorStop(0.94, 'rgba(0,0,0,0.10)');
    shade.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);

    // 布面纤维：几百根短的经纬线头。**这是"书脊上有没有凹凸"的关键**——
    // 参考实现的 makeSpineTexture 就是画这个（线宽 0.45~1.15、alpha 0.018~0.056）。
    // 之前我只画了每 3px 一条的横线，量出来高频能量只有 0.1~0.7，等于一片平布，
    // 所以"序号到省份名称之间"那一整段看不到任何纹理。
    var seed = 1;
    var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (var f = 0; f < 1100; f++) {
        var fx = rnd() * w;
        var fy = rnd() * h;
        var vertical = rnd() > 0.42;
        ctx.strokeStyle = rnd() > 0.5
            ? 'rgba(255,255,255,' + (0.05 + rnd() * 0.075).toFixed(3) + ')'
            : 'rgba(0,0,0,' + (0.05 + rnd() * 0.06).toFixed(3) + ')';
        ctx.lineWidth = 0.5 + rnd() * 0.8;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(vertical ? fx + (rnd() - 0.5) * 0.9 : fx + 1.5 + rnd() * 5,
                   vertical ? fy + 1.5 + rnd() * 6 : fy + (rnd() - 0.5) * 0.9);
        ctx.stroke();
    }

    // 底部压暗（照参考：0.82 到 1 的一条渐变）
    var bottomShade = ctx.createLinearGradient(0, h * 0.82, 0, h);
    bottomShade.addColorStop(0, 'rgba(0,0,0,0)');
    bottomShade.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = bottomShade;
    ctx.fillRect(0, h * 0.82, w, h * 0.18);

    // **这里不再画任何字**。书脊上的序号/书名/框线全部只画在烫金层里，
    // 否则布面上那层"白字"会和金层叠在一起 —— 用户看到的"白色和金色
    // 两套字体"就是这个：金层描一遍、布面又描一遍，金边外面露出一圈白。

    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 16;      // 书脊竖排书名同样容易糊
    return texture;
}

// 书脊烫金层：透明底 + 白色字，交给材质上金色
export function spineFoilTexture(THREE, book, index) {
    var w = 96;
    var h = 576;
    var canvas = makeCanvas(384, 1152);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.5;
    // 书脊整圈烫金框（和 spineTexture 同一套坐标）
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(7, 13, w - 14, h - 26);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.82;
    ctx.font = '500 18px ' + SANS;
    ctx.fillText(String(index + 1), w / 2, 62);
    ctx.globalAlpha = 1;
    var chars = String(book.name || '').split('');
    var available = h - 190;
    // 与布面层不再重复：这里**是唯一**画书脊文字的地方
    var step = Math.min(64, available / Math.max(1, chars.length));
    var size = Math.min(46, step * 0.8);
    ctx.font = '400 ' + size + 'px ' + TITLE;
    var startY = h / 2 - (chars.length - 1) * step / 2;
    for (var i = 0; i < chars.length; i++) ctx.fillText(chars[i], w / 2, startY + i * step);
    ctx.globalAlpha = 0.6;
    ctx.font = TYPE.tiny;
    ctx.fillText(book.cityCount + ' 城', w / 2, h - 64);
    ctx.globalAlpha = 1;
    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 16;
    return texture;
}

// 封底：一块布面 + 一枚小的烫金印记，和正面区分开
export function backCoverTexture(THREE, book, index) {
    var w = 384;
    var h = 576;
    var canvas = makeCanvas(w, h);
    var ctx = canvas.getContext('2d');
    var colors = palette(index);
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    for (var y = 0; y < h; y += 3) {
        ctx.fillStyle = 'rgba(255,255,255,0.028)';
        ctx.fillRect(0, y, w, 1);
    }
    ctx.strokeStyle = colors[2];
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(30.5, 30.5, w - 61, h - 61);
    ctx.globalAlpha = 1;
    // 下部一枚小印记
    ctx.fillStyle = colors[2];
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(w / 2, h - 96, 15, 0, Math.PI * 2);
    ctx.strokeStyle = colors[2];
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = '400 15px ' + TITLE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(book.name || '').charAt(0), w / 2, h - 95);
    ctx.globalAlpha = 0.55;
    ctx.font = TYPE.tiny;
    // 封底同一行也走混排绘制，和封面保持一致（偏移按字号等比缩小）
    ctx.globalAlpha = 1;
    drawMixedLine(ctx,
        mixedRuns(book.cityCount + ' 座城市，' + book.photoCount + ' 张照片',
            TYPE.coverMetaLatinSmall, TYPE.tiny),
        w / 2, h - 60, 0.55);
    ctx.globalAlpha = 1;
    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}
