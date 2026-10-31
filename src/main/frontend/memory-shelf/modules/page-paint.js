/**
 * 页面内容：把每一页画到 canvas 上再当贴图，含字号自适应与折行。
 */

import { maxAnisotropy } from './state.js';
import { PAGE_PAPER } from './constants.js';
import { formatMonth } from './utils.js';
import {
    pageMargins,
    SANS,
    TITLE,
    TOC_CITY_ROW_H,
    TOC_POINT_ROW_H,
    COVER_OUTER_SAFE,
    TYPE
} from './typography.js';
import { makeCanvas } from './textures.js';
import { drawCover } from './cover-art.js';

// ---------------- 页面内容（画到 canvas 上再当贴图） ----------------


export function pageTextureFor(THREE, spec, key) {
    // 画布按 2.5 倍出图（逻辑版面 400×564）。原来 2 倍（800×1128）"刚好够算"：
    // 正常视角下页约 500px 高、贴图是缩小采样没问题，但两处会顶到天花板 ——
    //   · 检视态滚轮放大到上限 2.2 时，页面约 1100px 高，1128 正好卡在 1:1；
    //   · 2× 视网膜屏上 500 CSS px → 1000 物理 px，同样卡线。
    // 提到 2.5 倍（1000×1410）覆盖这两个场景，单页 5.6MB；配合下面的
    // "窗口外真的释放"，常驻只有 10 页左右 ≈75MB，不会无限增长。
    var canvas = makeCanvas(1000, 1410);
    paintPage(canvas, spec);
    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;      // 页面是斜看的，各向异性拉满才不糊
    texture._canvas = canvas;
    texture._key = key;
    return texture;
}

// 空白页贴图：没有内容的页以前是「没有贴图」，于是渲染成一块纯色，
// 和有内容的页（纸纹 + 页边）放一起就明显是两种东西。
// 这里给空白页同样的纸底与纹理，只是不画内容。
var blankPageCache = null;
export function blankPageTexture(THREE) {
    if (blankPageCache) return blankPageCache;
    var canvas = makeCanvas(1000, 1410);   // 跟内页同密度，补画时不跳分辨率
    var scale = canvas.width / 400;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = PAGE_PAPER;
    ctx.fillRect(0, 0, 400, 564);
    for (var y = 0; y < 564; y += 3) {
        ctx.fillStyle = 'rgba(150,130,100,0.05)';
        ctx.fillRect(0, y, 400, 1);
    }
    // 一道很淡的内边框，让空白页也有「纸」的感觉
    ctx.strokeStyle = 'rgba(59,49,40,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(30.5, 30.5, 339, 503);
    blankPageCache = new THREE.CanvasTexture(canvas);
    blankPageCache.colorSpace = THREE.SRGBColorSpace;
    blankPageCache.anisotropy = maxAnisotropy;
    return blankPageCache;
}

export function repaintTexture(texture, spec) {
    if (!texture || !texture._canvas) return;
    // 已经因为"翻远了"被释放的页别再重画：那张贴图已经 dispose，
    // 再 needsUpdate 会让 three 把它重新传一遍显存（又不回收）。
    if (texture._released) return;
    paintPage(texture._canvas, spec);
    texture.needsUpdate = true;
}

function paintPage(canvas, spec) {
    // 所有排版都按 400x564 这套「逻辑坐标」写，实际画布可以是它的任意整数倍
    var w = 400;
    var h = 564;
    var scale = canvas.width / w;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // 内页三支墨色。**次级文字别太淡**：页面是在 3D 灯光下渲染的，
    // 58% 的沉墨在斜看/远看时会灰掉，用户反馈"有些看不清"。
    // 正文 ink 不动；muted 从 0.58 提到 0.76；accent 从 #9b704e 压到 #7f5c3d
    // （城市序号、小标、右侧「N 张」都用它）。
    var ink = '#3b3128';
    var muted = 'rgba(59,49,40,0.76)';
    var accent = '#7f5c3d';
    // 版心边距 M 与字阶 TYPE 定义在模块级（见 paintCover 之前）——
    // 书脊/封底贴图也画同族文字，放函数里它们就取不到了。
    // M 随左右页变：订口（内侧）比外缘多 PAGE_GUTTER_EXTRA。
    var M = pageMargins(spec.side);
    var innerW = w - M.left - M.right;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = PAGE_PAPER;
    ctx.fillRect(0, 0, w, h);
    // 纸纹
    for (var y = 0; y < h; y += 3) {
        ctx.fillStyle = 'rgba(150,130,100,0.05)';
        ctx.fillRect(0, y, w, 1);
    }
    // ---- A1 纸张质感（所有页共用，画在内容之下所以不会压到文字）----
    // 细颗粒：真实纸不是纯色，扫过时要有微弱起伏
    for (var gp = 0; gp < 2600; gp++) {
        ctx.fillStyle = Math.random() > 0.5
            ? 'rgba(255,255,255,0.045)' : 'rgba(140,120,96,0.045)';
        ctx.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
    }
    // 边缘轻微压暗：纸叠在书里，靠订口与外缘各有一点暗角，
    // 不然整页是"发光的白"，看着像屏幕而不是纸
    var edgeShade = ctx.createLinearGradient(0, 0, w, 0);
    edgeShade.addColorStop(0, 'rgba(120,100,76,0.055)');
    edgeShade.addColorStop(0.14, 'rgba(120,100,76,0)');
    edgeShade.addColorStop(0.86, 'rgba(120,100,76,0)');
    edgeShade.addColorStop(1, 'rgba(120,100,76,0.035)');
    ctx.fillStyle = edgeShade;
    ctx.fillRect(0, 0, w, h);
    var topShade = ctx.createLinearGradient(0, 0, 0, h);
    topShade.addColorStop(0, 'rgba(120,100,76,0.03)');
    topShade.addColorStop(0.2, 'rgba(120,100,76,0)');
    topShade.addColorStop(0.85, 'rgba(120,100,76,0)');
    topShade.addColorStop(1, 'rgba(120,100,76,0.03)');
    ctx.fillStyle = topShade;
    ctx.fillRect(0, 0, w, h);

    // 照片页：一页 1~2 张，每张按**自己的比例**装进框里（不裁构图），下面一行图注。
    // 一页两张 = 一跨四张，翻页次数减半；图注左边是「城市 · 年月」、右边是「03 / 53」。
    if (spec.kind === 'photo') {
        var shots = (spec.shots && spec.shots.length)
            ? spec.shots
            : (spec.photo ? [{ url: spec.photo, image: spec.image, time: spec.time }] : []);
        if (!shots.length) shots = [{ url: '', image: null, time: '' }];
        var shotTop = 56;
        var shotBottom = h - M.bottom;
        var capH = 26;                    // 每条图注占的高度
        var shotGap = 26;                 // 两张之间
        var boxH = Math.max(120, (shotBottom - shotTop - shots.length * capH -
            (shots.length - 1) * shotGap) / shots.length);
        shots.forEach(function (shot, i) {
            var y0 = shotTop + i * (boxH + capH + shotGap);
            var iw = (shot.image && shot.image.naturalWidth) || 4;
            var ih = (shot.image && shot.image.naturalHeight) || 3;
            var fit = Math.min(innerW / iw, boxH / ih);
            var dw = iw * fit;
            var dh = ih * fit;
            var dx = M.left + (innerW - dw) / 2;
            var dy = y0 + (boxH - dh) / 2;
            ctx.fillStyle = 'rgba(59,49,40,0.07)';
            ctx.fillRect(dx, dy, dw, dh);
            // 这里**不能**用 drawCover：那是按"覆盖"裁切的，相册要的是
            // 按原比例装进框（两侧留白也不裁构图），尺寸上面已经算好了。
            if (shot.image) ctx.drawImage(shot.image, dx, dy, dw, dh);
            ctx.strokeStyle = 'rgba(59,49,40,0.18)';
            ctx.lineWidth = 1;
            ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = muted;
            ctx.font = TYPE.tiny;
            var capText = (spec.title || '') +
                (shot.time ? '，' + formatMonth(shot.time) : '');
            // ⚠️ 图注按**版心宽度**排，不跟着照片宽度缩。原来可用宽度是
            // dw - 58：竖构图高度顶满时 dw 只有 130 左右，减掉给序号的 58
            // 就只剩几十像素，图注被截成四五个字（用户报的"显示不全"）。
            var capY = y0 + boxH + 18;
            ctx.fillText(trim(ctx, capText, innerW - 56), M.left, capY);
            if (shot.no) {
                ctx.textAlign = 'right';
                ctx.fillText(shot.no + ' / ' + (spec.photoTotal || shot.no),
                    w - M.right, capY);
                ctx.textAlign = 'left';
            }
        });
        // 书眉 / 页码统一由下面公共那段画（外侧对齐）
    }

    // 省封面页：照片内嵌，文字与统计各占一条带，互不重叠
    else if (spec.kind === 'cover') {
        // 这页永远在左半（封面内侧）。它的**纹理右边**对应书上那条外缘，
        // 而翻过去的纸比封面小一圈、会露出这条封面内侧（参考实现也这样，
        // 是正常的）—— 所以内容两侧都让开 COVER_OUTER_SAFE：整体收一圈，
        // 外缘那条翻页之后正好被纸盖住，露出来的只剩空白纸边。
        var coverSafe = Math.max(M.left, M.right, COVER_OUTER_SAFE);
        var cx0 = coverSafe;
        var cy0 = 34;
        var cw = w - coverSafe * 2;
        var chh = 266;
        ctx.fillStyle = 'rgba(59,49,40,0.1)';
        ctx.fillRect(cx0, cy0, cw, chh);
        if (spec.image) drawCover(ctx, spec.image, cx0, cy0, cw, chh);
        ctx.strokeStyle = 'rgba(59,49,40,0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cw - 1, chh - 1);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = accent;
        ctx.font = TYPE.eyebrow;
        ctx.fillText(spec.kicker || '', cx0, cy0 + chh + 34);
        ctx.fillStyle = ink;
        // 省名缩一档（42 → 38 起）：内容整体收了一圈，字也收一点才匀
        ctx.font = fitFont(ctx, spec.title || '', cw - 8, [38, 34, 30, 26, 22]);
        ctx.fillText(spec.title || '', cx0, cy0 + chh + 78);
        ctx.fillStyle = muted;
        ctx.font = TYPE.meta;
        wrapText(ctx, spec.subtitle || '', cx0, cy0 + chh + 106, cw, 22);

        // 统计带：和正文拉开距离，避免压字
        var stats = spec.stats || [];
        var baseY = 494;
        ctx.strokeStyle = 'rgba(59,49,40,0.16)';
        ctx.beginPath();
        ctx.moveTo(cx0, baseY - 34);
        ctx.lineTo(w - coverSafe, baseY - 34);
        ctx.stroke();
        var sx = cx0 + 24;
        stats.forEach(function (item) {
            ctx.fillStyle = ink;
            ctx.font = TYPE.subName;
            ctx.fillText(String(item.value), sx, baseY);
            ctx.fillStyle = muted;
            ctx.font = TYPE.tiny;
            ctx.fillText(item.label, sx, baseY + 22);
            sx += 132;
        });
        return;
    }

    // 城市扉页（frontispiece）：城市名 + 时间范围 + 卷首图 + 照片数，纯排版页
    else if (spec.kind === 'title') {
        var tc = w / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = accent;
        ctx.font = TYPE.label;
        ctx.fillText(spec.kicker || '', tc, 76);
        ctx.fillStyle = ink;
        ctx.font = fitFont(ctx, spec.title || '', innerW - 8, [42, 36, 31, 27, 23]);
        ctx.fillText(spec.title || '', tc, 136);
        ctx.fillStyle = muted;
        // ⚠️ 这里原来写死 '500' + 默认（宋体）：城市名下面那行日期因此又细又淡，
        // 换黑体那轮没覆盖到。小字一律 600 + 黑体。
        ctx.font = fitFont(ctx, spec.range || '', innerW - 8, [15, 14, 13, 12], '600', SANS);
        ctx.fillText(spec.range || '', tc, 166);
        // 双细线：扉页的分量靠这两条线撑
        ctx.strokeStyle = 'rgba(59,49,40,0.30)';
        ctx.beginPath(); ctx.moveTo(tc - 48, 190); ctx.lineTo(tc + 48, 190); ctx.stroke();
        ctx.strokeStyle = 'rgba(59,49,40,0.14)';
        ctx.beginPath(); ctx.moveTo(tc - 30, 195); ctx.lineTo(tc + 30, 195); ctx.stroke();
        // 卷首图：紧跟双细线往下排，宽度给满版心，高度自适应到"统计行之上"。
        // 统计行固定落在页码之上（h-52 vs h-26），所以图永远不会压过页码那条水平线。
        var tTop = 208;
        var tBottom = h - 72;                    // 统计行(h-52)再往上让 20px
        var tw = innerW;
        var th = Math.max(120, tBottom - tTop);
        var tiw = (spec.image && spec.image.naturalWidth) || 4;
        var tih = (spec.image && spec.image.naturalHeight) || 3;
        var tfit = Math.min(tw / tiw, th / tih);
        var tdw = tiw * tfit;
        var tdh = tih * tfit;
        var tdx = tc - tdw / 2;
        var tdy = tTop + (th - tdh) / 2;
        ctx.fillStyle = 'rgba(59,49,40,0.07)';
        ctx.fillRect(tdx, tdy, tdw, tdh);
        if (spec.image) ctx.drawImage(spec.image, tdx, tdy, tdw, tdh);
        ctx.strokeStyle = 'rgba(59,49,40,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tdx + 0.5, tdy + 0.5, tdw - 1, tdh - 1);
        ctx.fillStyle = muted;
        ctx.font = TYPE.tiny;
        ctx.fillText(spec.statsLine || '', tc, h - 52);
    }

    // 足迹点页：和城市扉页同族，但多一段**描述** —— 标题 + 日期/地址 + 描述 + 卷首图
    else if (spec.kind === 'spot') {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = accent;
        ctx.font = TYPE.label;
        ctx.fillText(spec.kicker || '', M.left, 58);
        ctx.fillStyle = ink;
        ctx.font = fitFont(ctx, spec.title || '', innerW - 8, [34, 30, 26, 22]);
        ctx.fillText(spec.title || '', M.left, 102);
        // 日期、地址（都没有就空着，不留占位）
        var metaLine = [spec.date, spec.address].filter(Boolean).join('，');
        if (metaLine) {
            ctx.fillStyle = muted;
            ctx.font = TYPE.tiny;
            ctx.fillText(trim(ctx, metaLine, innerW), M.left, 126);
        }
        // 描述：最多 4 行
        ctx.fillStyle = muted;
        ctx.font = TYPE.meta;
        var descLines = wrapLines(ctx,
            spec.desc || '这条足迹还没有写描述。', innerW, 4);
        descLines.forEach(function (line, i) {
            ctx.fillText(line, M.left, 160 + i * 24);
        });
        // 卷首图**紧跟描述**往下排（自适应）：描述短 → 图就高，描述长 → 图就矮；
        // 下沿统一卡在统计行之上，图不会压过页码那条水平线。
        var sTop = 160 + descLines.length * 24 + 8;
        var sBottom = h - 72;                    // 同城市扉页：统计行再往上 20px
        var sw = innerW;
        var sh = Math.max(100, sBottom - sTop);
        var siw = (spec.image && spec.image.naturalWidth) || 4;
        var sih = (spec.image && spec.image.naturalHeight) || 3;
        var sfit = Math.min(sw / siw, sh / sih);
        var sdw = siw * sfit;
        var sdh = sih * sfit;
        var sdx = M.left + (innerW - sdw) / 2;
        var sdy = sTop + (sh - sdh) / 2;
        ctx.fillStyle = 'rgba(59,49,40,0.07)';
        ctx.fillRect(sdx, sdy, sdw, sdh);
        if (spec.image) ctx.drawImage(spec.image, sdx, sdy, sdw, sdh);
        ctx.strokeStyle = 'rgba(59,49,40,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sdx + 0.5, sdy + 0.5, sdw - 1, sdh - 1);
        ctx.textAlign = 'center';
        ctx.fillStyle = muted;
        ctx.font = TYPE.tiny;
        ctx.fillText(spec.statsLine || '', w / 2, h - 52);
        ctx.textAlign = 'left';
    }

    // 目录：城市 → 最近到访 → 「N 张 · 相册第 x–y 页」。这页的点按也是活的
    // （spec.cities 与章节列表同一份顺序），所以它同时是个"快捷入口"。
    else if (spec.kind === 'contents') {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = accent;
        ctx.font = TYPE.label;
        ctx.fillText('目录', M.left, 58);
        ctx.fillStyle = ink;
        ctx.font = TYPE.book;
        ctx.fillText(spec.title || '', M.left, 100);
        ctx.strokeStyle = 'rgba(59,49,40,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(M.left, 120); ctx.lineTo(w - M.right, 120); ctx.stroke();
        var contTop = 152;
        spec.rowsTop = contTop;
        // 行高不固定（城市行高、足迹点行矮），所以逐行记下自己的上下沿，
        // 命中测试按这张表找行 —— 不再假设一个统一行距。
        spec.rowTops = [];
        var y = contTop;
        (spec.rows || []).forEach(function (row) {
            var isCity = row.kind === 'city';
            var rowH = isCity ? TOC_CITY_ROW_H : TOC_POINT_ROW_H;
            var base = y + (isCity ? 22 : 16);
            spec.rowTops.push([y, y + rowH]);
            if (isCity) {
                // 序号 + 城市名 + 点线 + 页码范围
                ctx.fillStyle = accent;
                ctx.font = TYPE.index;
                ctx.fillText(String(row.no || ''), M.left, base);
                ctx.fillStyle = ink;
                ctx.font = TYPE.head;
                var nameText = trim(ctx, row.name, innerW - 150);
                ctx.fillText(nameText, M.left + 30, base);
                var nameEnd = M.left + 30 + ctx.measureText(nameText).width + 6;
                ctx.font = TYPE.tiny;
                ctx.fillStyle = accent;
                var rightText = trim(ctx, row.right || '', 110);
                var rightW = ctx.measureText(rightText).width;
                ctx.textAlign = 'right';
                ctx.fillText(rightText, w - M.right, base);
                ctx.textAlign = 'left';
                // 点线：从名字末尾拉到页码左边（目录的经典排法）
                ctx.save();
                ctx.strokeStyle = 'rgba(59,49,40,0.32)';
                ctx.setLineDash([1, 3.5]);
                ctx.beginPath();
                ctx.moveTo(nameEnd, base - 4);
                ctx.lineTo(w - M.right - rightW - 6, base - 4);
                ctx.stroke();
                ctx.restore();
                ctx.strokeStyle = 'rgba(59,49,40,0.18)';
                ctx.beginPath();
                ctx.moveTo(M.left, y + rowH - 5);
                ctx.lineTo(w - M.right, y + rowH - 5);
                ctx.stroke();
            } else {
                // 足迹点行：缩进 + 名称 + 日期 + 页码
                ctx.fillStyle = muted;
                ctx.font = TYPE.tiny;
                ctx.fillText('·', M.left + 34, base);
                ctx.fillStyle = ink;
                ctx.font = TYPE.meta;
                var pointName = trim(ctx, row.name, innerW - 170);
                ctx.fillText(pointName, M.left + 46, base);
                var pointEnd = M.left + 46 + ctx.measureText(pointName).width + 6;
                ctx.fillStyle = muted;
                ctx.font = TYPE.tiny;
                var subText = trim(ctx, row.sub || '', 96);
                ctx.fillText(subText, pointEnd, base);
                if (row.right) {
                    ctx.textAlign = 'right';
                    ctx.fillStyle = accent;
                    ctx.fillText(trim(ctx, row.right, 80), w - M.right, base);
                    ctx.textAlign = 'left';
                }
            }
            y += rowH;
        });
        if (spec.note) {
            ctx.fillStyle = muted;
            ctx.font = TYPE.tiny;
            ctx.fillText(spec.note, M.left, h - M.bottom);
        }
    }

    // 尾页（colophon）：一行总数 + 两行出处。一页就把书收住了。
    else if (spec.kind === 'colophon') {
        var pc = w / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.strokeStyle = 'rgba(59,49,40,0.24)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pc - 46, 196); ctx.lineTo(pc + 46, 196); ctx.stroke();
        ctx.fillStyle = ink;
        // 就是这一行：42px 的「3 座城市 · 53 张照片」宽 546px，页面只有 400px，
        // 不缩字号两头就被裁掉（用户看到的"前后显示不全"）。fitFont 会一直往下缩到塞得进。
        ctx.font = fitFont(ctx, spec.headline, innerW - 4);
        ctx.fillText(spec.headline || '', pc, 268);
        ctx.fillStyle = muted;
        (spec.lines || []).forEach(function (line, i) {
            ctx.font = fitFont(ctx, line, innerW - 4, [15, 14, 13, 12], '600', SANS);
            ctx.fillText(line, pc, 314 + i * 26);
        });
    }

    // 通用列表 / 信息页
    else {
    var pad = M.left;
    var cursor = 56;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (spec.eyebrow) {
        ctx.fillStyle = accent;
        ctx.font = TYPE.label;
        ctx.fillText(spec.eyebrow, pad, cursor);
        cursor += 14;
    }
    if (spec.title) {
        ctx.fillStyle = ink;
        ctx.font = TYPE.book;
        ctx.fillText(spec.title, pad, cursor + 36);
        cursor += 52;
    }
    ctx.strokeStyle = 'rgba(59,49,40,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, cursor + 8);
    ctx.lineTo(w - pad, cursor + 8);
    ctx.stroke();
    cursor += 30;

    if (spec.paragraph) {
        ctx.fillStyle = muted;
        ctx.font = TYPE.body;
        cursor = wrapText(ctx, spec.paragraph, pad, cursor, w - pad * 2, 28) + 14;
    }

    // 记下行的起点，命中测试要按同一套坐标反推点到第几行
    spec.rowsTop = cursor;
    spec.rowPitch = 54;               // 行距不变（用户明确要求），命中测试按它反推
    spec.rowTops = [];
    (spec.rows || []).forEach(function (row) {
        var base = cursor + 20;
        spec.rowTops.push([cursor, cursor + 54]);
        ctx.fillStyle = accent;
        ctx.font = TYPE.index;
        ctx.fillText(String(row.no), pad, base);
        ctx.fillStyle = ink;
        ctx.font = TYPE.head;
        ctx.fillText(trim(ctx, row.name, innerW - 130), pad + 42, base);
        ctx.fillStyle = muted;
        ctx.font = TYPE.meta;
        ctx.fillText(trim(ctx, row.sub || '', 190), pad + 42, base + 22);
        ctx.textAlign = 'right';
        ctx.fillText(row.right || '', w - M.right, base);
        ctx.textAlign = 'left';
        cursor = base + 34;
        ctx.strokeStyle = 'rgba(59,49,40,0.14)';
        ctx.beginPath();
        ctx.moveTo(pad, cursor - 6);
        ctx.lineTo(w - M.right, cursor - 6);
        ctx.stroke();
    });


    if (!spec.rows && !spec.paragraph && spec.image) {
        ctx.fillStyle = 'rgba(59,49,40,0.08)';
        ctx.fillRect(pad, cursor, innerW, 250);
        drawCover(ctx, spec.image, pad, cursor, innerW, 250);
        cursor += 274;
    }
    }

    // ---- 书眉 + 页码：所有页面共用（封面内侧那页已经提前 return 了），
    //      且**画在内容之后**，不会被内容盖住。
    //      位置照真书的规矩：**对齐外侧**（左页靠左、右页靠右），内侧留给订口。
    //      文案由 spec.headLeft / spec.headRight 给（省名 / 城市名），
    //      不用全局 state —— 全局那个在"从相册退回章节"时可能还留着上一座城。
    ctx.textBaseline = 'alphabetic';
    var headText = spec.side === 'right' ? spec.headRight : spec.headLeft;
    var outward = spec.side === 'right';       // 右页：外缘在右边
    if (headText) {
        ctx.fillStyle = 'rgba(59,49,40,0.68)';   // 书眉：0.5 太淡，斜看几乎看不见
        ctx.font = TYPE.folio;
        ctx.textAlign = outward ? 'right' : 'left';
        ctx.fillText(trim(ctx, headText, innerW - 44),
            outward ? w - M.right : M.left, M.top - 18);
        ctx.strokeStyle = 'rgba(59,49,40,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(M.left, M.top - 10);
        ctx.lineTo(w - M.right, M.top - 10);
        ctx.stroke();
    }
    if (spec.pageNo) {
        ctx.fillStyle = 'rgba(59,49,40,0.68)';   // 页码：同上
        ctx.font = TYPE.folio;
        ctx.textAlign = outward ? 'right' : 'left';
        ctx.fillText(String(spec.pageNo),
            outward ? w - M.right : M.left, h - 26);
    }
    ctx.textAlign = 'left';
}

function trim(ctx, text, maxWidth) {
    var value = String(text || '');
    if (ctx.measureText(value).width <= maxWidth) return value;
    while (value.length > 1 && ctx.measureText(value + '…').width > maxWidth) {
        value = value.slice(0, -1);
    }
    return value + '…';
}

// 一行大字**缩到能塞进版心为止**：从上往下试字号，第一个放得下的就用。
// 立这个规矩是因为尾页那行「3 座城市，53 张照片」用 42px 要 546px，
// 而页面只有 400px —— 居中绘制时两头会被画布直接裁掉。
var DISPLAY_SIZES = [42, 36, 31, 27, 23, 20, 17, 15];
function fitFont(ctx, text, maxWidth, sizes, weight, family) {
    var value = String(text || '');
    var list = sizes || DISPLAY_SIZES;
    var font = '';
    for (var i = 0; i < list.length; i += 1) {
        // 默认是标题字体（文楷只有常规字重，所以没指定时用 400）
        font = (weight || (family ? '600' : '400')) + ' ' + list[i] + 'px ' + (family || TITLE);
        ctx.font = font;
        if (ctx.measureText(value).width <= maxWidth) return font;
    }
    return font;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    var value = String(text || '');
    if (!value) return y;
    var line = '';
    for (var i = 0; i < value.length; i++) {
        var test = line + value[i];
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            line = value[i];
            y += lineHeight;
        } else {
            line = test;
        }
    }
    if (line) { ctx.fillText(line, x, y); y += lineHeight; }
    return y;
}

// 折行但**限制行数**：超过 maxLines 就把最后一行截成"…"。足迹点页的描述用，
// 免得一段长描述把下面的卷首图顶出页面。
function wrapLines(ctx, text, maxWidth, maxLines) {
    var value = String(text || '');
    var lines = [];
    if (!value) return lines;
    var line = '';
    for (var i = 0; i < value.length; i += 1) {
        var test = line + value[i];
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            if (lines.length >= maxLines - 1) {
                lines.push(trim(ctx, value.slice(i), maxWidth));
                return lines;
            }
            line = value[i];
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    return lines;
}
