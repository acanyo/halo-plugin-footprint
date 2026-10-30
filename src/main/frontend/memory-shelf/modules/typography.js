/**
 * 排版规范：版心边距、左右页分家、字体栈与字号表，以及中西文混排的单行绘制。
 */

// ---------------- 内页版式：左右页分家 ----------------
// 一页的版心边距。side 由页序奇偶决定（见 assignPageSides）：
// 左页的订口在右边、右页的订口在左边，所以内侧比外侧多 PAGE_GUTTER_EXTRA。
// side 缺省（'center'）时退回对称版心 —— 书脊/封底那些独立贴图也走这条。
export function pageMargins(side) {
    if (side !== 'left' && side !== 'right') {
        return { left: PAGE_MARGIN.left, right: PAGE_MARGIN.right,
                 top: PAGE_MARGIN.top, bottom: PAGE_MARGIN.bottom };
    }
    var outer = Math.min(PAGE_MARGIN.left, PAGE_MARGIN.right);
    var inner = Math.max(PAGE_MARGIN.left, PAGE_MARGIN.right) + PAGE_GUTTER_EXTRA;
    return side === 'right'
        ? { left: inner, right: outer, top: PAGE_MARGIN.top, bottom: PAGE_MARGIN.bottom }
        : { left: outer, right: inner, top: PAGE_MARGIN.top, bottom: PAGE_MARGIN.bottom };
}

// 给一叠页按奇偶标上左右：第 2s 页在左（含封面内侧那页）、第 1+2s 页在右。
// 书眉与页码都靠它决定"往哪一侧对齐"（真书是外侧对齐）。
export function assignPageSides(pages) {
    pages.forEach(function (spec, index) {
        spec.side = index % 2 === 0 ? 'left' : 'right';
    });
    return pages;
}

// ==========================================================================
// A1 · 统一的排版规范（模块级：页面、书脊、封底这些"有文字的画布"共用一套）
// --------------------------------------------------------------------------
// M    = 版心边距（逻辑坐标 400×564 下）
// TYPE = 字阶：书名 / 章节名 / 照片页标题 / 正文 / 图注 / 书眉页码 / 序号
//        + 封面页专用的大号几档（display / subName / label / eyebrow / tiny）
// 放在这里而不是 paintPage 里面：书脊与封底贴图的绘制函数也要用同一套，
// 放函数里它们取不到（这会直接抛 ReferenceError，整个书架起不来）。
// ==========================================================================
var PAGE_MARGIN = { left: 26, right: 26, top: 46, bottom: 40 };
// 小字用的黑体栈（内页的图注 / 日期 / 标签 / 书眉 / 页码）。见 TYPE 里的说明：
// 宋体细横在缩小采样后发灰，小字必须走黑体才清楚。
export var SANS = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", ' +
    '"Source Han Sans SC", "Hiragino Sans GB", sans-serif';
// 订口（内侧）比外缘再多留的宽度：翻开之后文字不会挤进书脊那道暗角里。
// 左右页由**页序的奇偶**决定（第 2s 页在左、第 1+2s 页在右），见 assignPageSides()。
var PAGE_GUTTER_EXTRA = 9;
// 3D 相册每页放几张照片（一个跨页两页 → 一跨 4 张，翻页次数减半）。
// ⚠️ DOM 版相册另有 ALBUM_PER_PAGE（那个按每页 1 张，用户明确要求过），两套互不影响。
export var BOOK_ALBUM_PER_PAGE = 2;
// 目录页的行高（逻辑 px）：城市行高、它下面的足迹点行矮。
// 这两个数 **paintPage 和 bookPageSpecs 都要用**（一个画、一个分页），
// 必须放模块级 —— 放进 bookPageSpecs 里 paintPage 取不到，会直接抛 ReferenceError，
// 整本书都画不出来。
export var TOC_CITY_ROW_H = 34;
export var TOC_POINT_ROW_H = 22;
// 封面内侧那页（书摊开时永远在左半）内容要往订口方向收多少：
// 翻过去的纸比封面小一圈，外缘本来就露出一条封面内侧（参考实现也是），
// 把内容让开这么宽之后，翻页之后正好被纸盖住 —— 露出来的只有空白纸边。
// 0.186 世界单位 ≈ 页宽的 12.5% ≈ 400 逻辑 px × 0.125 ≈ 50，留到 60 更稳。
export var COVER_OUTER_SAFE = 60;
export var TYPE = {
    book: '700 34px "Songti SC", "SimSun", serif',
    head: '600 21px "Songti SC", "SimSun", serif',
    title: '600 25px "Songti SC", "SimSun", serif',
    // ⚠️ 小字一律走**黑体**（微软雅黑 / 苹方），不要用宋体：
    // 宋体的横是发丝级的细线，页面在屏幕上只有约 500px 高、贴图要经 mipmap
    // 缩小 2.8 倍，细横一缩就发灰 —— 用户反复反馈的"文字不清晰"就是这个，
    // 不是分辨率不够（2.5 倍贴图余量充足）。中文书也本来就是
    // 正文宋体、图注/标签黑体的排法。
    // 字号保持原样（用户明确要求别再放大），只换字体 + 加粗：
    // 清晰度靠"黑体 + 更重的字重"，不靠字号。
    body: '600 17px ' + SANS,
    meta: '600 15px ' + SANS,
    folio: '600 16px ' + SANS,
    index: '700 18px ' + SANS,
    eyebrow: '700 13px ' + SANS,
    display: '600 42px "Songti SC", "SimSun", serif',
    subName: '600 28px "Songti SC", serif',
    // 最小一档保持 14px（上上轮定的大小），只加粗 + 换黑体
    tiny: '600 14px ' + SANS,
    label: '700 14px ' + SANS,
    // 封面底部那两行元信息（城市数/照片数、时间）。
    // ⚠️ 这里**不能**用 Georgia 之类的西文衬线打头：那会让数字命中西文字体、
    // 中文落到宋体，两套字体在**同一行**里的基线落点不同 —— 看起来就是
    // "数字偏下、没和文字对齐"。统一走 CJK 字体，数字与中文出自同一套字形。
    coverMeta: '500 19px "Songti SC", "SimSun", serif',
    coverMetaSmall: '500 15px "Songti SC", "SimSun", serif',
    // 封面元信息里的**西文段**（数字、字母、半角符号）：保留 Georgia 的观感，
    // 但绘制时按"对齐到中文基线"做微调 —— 见 drawMixedLine
    coverMetaLatin: '500 19px Georgia, "Times New Roman", serif',
    coverMetaLatinSmall: '500 15px Georgia, "Times New Roman", serif'
};

// 封面元信息的西文基线微调（px，负数=把数字往上抬）。
// 两套字体在同一个 em 盒里的字形落点不同：同一行里数字会比中文低一截，
// 所以给西文段单独一个偏移。控制台里也能调：
//     window.FOOTPRINT_META_LATIN_SHIFT = -4   // 然后重开一次书架即生效
var META_LATIN_SHIFT = -3;

// 把一行中英文混排的文字切成"西文段 / 中文段"
export function mixedRuns(text, latinFont, cjkFont) {
    var runs = [];
    var current = null;
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var isCjk = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch);
        if (!current || current.latin === isCjk) {
            current = { text: ch, latin: !isCjk, font: isCjk ? cjkFont : latinFont };
            runs.push(current);
        } else {
            current.text += ch;
        }
    }
    return runs;
}

// 在 canvas 上居中画一行中西混排文字：西文段用西文字体并**单独加基线偏移**，
// 中文段用中文字体原位画 —— 这样既有西文数字的形，数字又与中文齐平。
export function drawMixedLine(ctx, runs, centerX, y, alpha) {
    var shift = (typeof window.FOOTPRINT_META_LATIN_SHIFT === 'number')
        ? window.FOOTPRINT_META_LATIN_SHIFT : META_LATIN_SHIFT;
    var total = 0;
    runs.forEach(function (run) {
        ctx.font = run.font;
        total += ctx.measureText(run.text).width;
    });
    var x = centerX - total / 2;
    var prevAlpha = ctx.globalAlpha;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.textAlign = 'left';
    runs.forEach(function (run) {
        ctx.font = run.font;
        ctx.fillText(run.text, x, y + (run.latin ? shift : 0));
        x += ctx.measureText(run.text).width;
    });
    ctx.globalAlpha = prevAlpha;
    ctx.textAlign = 'center';
}
