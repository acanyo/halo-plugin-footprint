/**
 * 旅行明信片：把某座城市的照片 + 文案画到 canvas，预览、下载、分享。
 *
 * 从 creative-overlays.js 拆出。跨域图统一走同源代理（canvasSafeImageUrl），
 * 否则画布被污染、toBlob 会抛 SecurityError；票根册的写信也复用这里的取图与导出。
 */

import { wrapTicketLetterText } from './ticket-gallery.js';
import { focusCityWallTop } from './city-wall.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.cityList                      () => [{city, ...}]
 * @param d.cityViewItems                 (ci) => Footprint[]
 * @param d.featureEnabled                (key) => boolean
 * @param d.formatCityDate                (value) => string
 * @param d.cityWallCardData              (ci) => object
 * @param d.setOverlayHidden              (el, hidden) => void
 */
export function setupPostcard(d) {
    deps = d;
}

// ---------------- 旅行明信片 ----------------
export const postcardPreview = document.getElementById('postcardPreview');
const postcardBack = document.getElementById('postcardBack');
const postcardTitle = document.getElementById('postcardTitle');
const postcardPreviewImg = document.getElementById('postcardPreviewImg');
const postcardDownload = document.getElementById('postcardDownload');
const postcardShare = document.getElementById('postcardShare');
const postcardStage = document.getElementById('postcardStage');
const postcardStatus = document.getElementById('postcardStatus');
const postcardRetry = document.getElementById('postcardRetry');
let postcardCi = -1;
let postcardBlobUrl = '';
let postcardFileName = '旅行明信片.png';

if (typeof CanvasRenderingContext2D !== 'undefined' &&
    !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        r = Math.min(r || 0, w / 2, h / 2);
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
    };
}

function cityPostcardData(ci) {
    const city = deps.cityList()[ci];
    return {
        city: city ? city.city : '未知城市',
        province: '',
        ...deps.cityWallCardData(ci)
    };
}

export function loadPostcardImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        // 强制走 CORS 模式：万一图片又跳到别的域名，加载会失败而不是悄悄把 canvas 污染掉
        // （canvas 一旦被污染，后面 toBlob 会直接抛 SecurityError，写信就整张出不来）
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = canvasSafeImageUrl(url);
    });
}

/**
 * 票根图可能放在别的域名（图床 / CDN，本地开发时页面域名和图片域名也常常不同）。
 * 跨域图既会被 CORS 拦掉，画进 canvas 之后也没法导出（toBlob 抛 SecurityError），
 * 所以跨域图统一走插件的同源代理 /footprints/image-proxy。
 */
export function canvasSafeImageUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url, window.location.href);
        if (parsed.origin === window.location.origin) return url;
        return '/footprints/image-proxy?url=' + encodeURIComponent(parsed.href);
    } catch (e) {
        return url;
    }
}

// 城市小结：以真实照片为主角，讲"我和这座城市的关系"（第一次去 / 最近一次 / 走过的地方），
// 不再是城市卡片墙那张卡的信息截图。
// 配色取 tokens.css 柔光玻璃的值：canvas 读不到 CSS 变量，只能在这里抄一份，改色板时两处一起改。
const POSTCARD_INK = {
    paper: '#f2f2f4',       // --fp-paper
    raised: '#ffffff',      // --fp-paper-raised
    ink: '#3a3a40',         // --fp-ink
    soft: '#66666e',        // --fp-ink-soft
    faint: '#9a9aa3',       // --fp-ink-faint
    rule: 'rgba(58, 58, 64, 0.08)',        // --fp-rule
    accent: '#7c7bc0',      // --fp-accent
    accentSoft: 'rgba(124, 123, 192, 0.14)', // --fp-accent-soft
    shadow: 'rgba(38, 38, 48, 0.12)'       // --fp-shadow 的颜色
};
const POSTCARD_TITLE_FONT = '"快看世界体", "MiSans", "PingFang SC", "Microsoft YaHei", sans-serif';
const POSTCARD_TEXT_FONT = '"MiSans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';

// 圆角矩形路径（不依赖 ctx.roundRect，老一点的 Safari 也能画）
function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function postcardCanvas(data, image) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1440;
    const ctx = canvas.getContext('2d');
    const c = POSTCARD_INK;
    const title = (size) => '400 ' + size + 'px ' + POSTCARD_TITLE_FONT;
    const text = (size, weight = 400) => weight + ' ' + size + 'px ' + POSTCARD_TEXT_FONT;
    const rule = (y) => {
        ctx.strokeStyle = c.rule;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(84, y);
        ctx.lineTo(996, y);
        ctx.stroke();
    };

    // 浅灰底上一张白卡，柔阴影，大圆角
    ctx.fillStyle = c.paper;
    ctx.fillRect(0, 0, 1080, 1440);
    ctx.save();
    ctx.shadowColor = c.shadow;
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = c.raised;
    roundedRectPath(ctx, 28, 28, 1024, 1384, 48);
    ctx.fill();
    ctx.restore();

    // 城市名（文楷）+ 省份与足迹数
    const cityName = data.city || '';
    ctx.textAlign = 'center';
    ctx.fillStyle = c.ink;
    ctx.font = title(cityName.length > 6 ? 72 : 96);
    ctx.fillText(cityName, 540, 196);

    const subline = [data.province, data.count ? data.count + ' 条足迹' : ''].filter(Boolean).join('，');
    if (subline) {
        ctx.fillStyle = c.soft;
        ctx.font = text(30);
        ctx.fillText(subline, 540, 262);
    }

    // 真实照片当主角：cover 满铺 + 圆角裁切
    const photoX = 60;
    const photoW = 960;
    const photoTop = 318;
    const photoH = 600;
    const photoR = 36;
    if (image) {
        const scale = Math.max(photoW / image.width, photoH / image.height);
        const dw = image.width * scale;
        const dh = image.height * scale;
        ctx.save();
        roundedRectPath(ctx, photoX, photoTop, photoW, photoH, photoR);
        ctx.clip();
        ctx.drawImage(image, photoX + (photoW - dw) / 2, photoTop + (photoH - dh) / 2, dw, dh);
        ctx.restore();
    } else {
        ctx.fillStyle = c.accentSoft;
        roundedRectPath(ctx, photoX, photoTop, photoW, photoH, photoR);
        ctx.fill();
        ctx.fillStyle = c.accent;
        ctx.font = title(220);
        ctx.fillText((data.city || '?').charAt(0), 540, photoTop + photoH * 0.62);
    }

    // 第一次去 / 最近一次：这张小结真正多出来的信息
    ctx.fillStyle = c.faint;
    ctx.font = text(24);
    ctx.fillText('第一次去', 320, 1002);
    ctx.fillText('最近一次', 760, 1002);
    ctx.fillStyle = c.ink;
    ctx.font = text(34, 500);
    const day = (value) => deps.formatCityDate(value).replace(/\s*\/\s*/, '.');
    ctx.fillText(data.first ? day(data.first) : '—', 320, 1050);
    ctx.fillText(data.latest ? day(data.latest) : '—', 760, 1050);

    rule(1104);

    // 走过的地方：这座城市里到过的足迹名
    const places = (data.places || []).join('、');
    if (places) {
        ctx.fillStyle = c.faint;
        ctx.font = text(24);
        ctx.fillText('走过的地方', 540, 1154);
        ctx.fillStyle = c.ink;
        ctx.font = title(32);
        wrapTicketLetterText(ctx, places, 860).slice(0, 2).forEach((line, i) => {
            ctx.fillText(line, 540, 1210 + i * 46);
        });
    }

    rule(1292);
    ctx.fillStyle = c.soft;
    ctx.font = text(26);
    ctx.fillText(
        data.count + ' 条足迹，' + data.photos + ' 张照片，' + data.tickets + ' 张票根',
        540, 1340
    );

    // 落款：一枚强调色小点 + 「旅行记忆」
    ctx.fillStyle = c.faint;
    ctx.font = title(26);
    ctx.fillText('旅行记忆', 552, 1384);
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(552 - ctx.measureText('旅行记忆').width / 2 - 14, 1375, 6, 0, Math.PI * 2);
    ctx.fill();
    return canvas;
}

export function postcardToBlob(canvas) {
    return new Promise(resolve => {
        try {
            canvas.toBlob(blob => resolve(blob), 'image/png');
        } catch (e) {
            resolve(null);
        }
    });
}

// 明信片页三种状态：loading（骨架 + 文案）/ ready（出图 + 可下载）/ error（说明 + 重新生成）
function setPostcardState(state) {
    if (postcardStage) {
        postcardStage.classList.toggle('is-loading', state === 'loading');
        postcardStage.classList.toggle('is-ready', state === 'ready');
        postcardStage.classList.toggle('is-error', state === 'error');
        postcardStage.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    }
    if (postcardStatus) {
        postcardStatus.textContent = state === 'loading'
            ? '正在生成明信片…'
            : (state === 'error' ? '这张明信片没能生成，可能是城市照片取不到。' : '');
    }
    if (postcardRetry) postcardRetry.hidden = state !== 'error';
    if (postcardDownload) postcardDownload.disabled = state !== 'ready';
}

async function renderPostcardPreview() {
    if (postcardBlobUrl) URL.revokeObjectURL(postcardBlobUrl);
    const data = cityPostcardData(postcardCi);
    postcardTitle.textContent = data.city + '明信片';
    const city = deps.cityList()[postcardCi];
    data.province = city ? deps.cityViewItems(postcardCi).map(fp => fp.province).find(Boolean) || '' : '';
    if (postcardShare) postcardShare.hidden = true;
    setPostcardState('loading');
    // 明信片是拿去下载/分享的成品图，用未经"缩略图替换规则"处理的原始地址；
    // 城市卡片墙继续用小图（cover），翻页才轻快
    const coverUrl = data.coverRaw || data.cover;
    const image = coverUrl ? await loadPostcardImage(coverUrl) : null;
    let canvas = postcardCanvas(data, image);
    let blob = await postcardToBlob(canvas);
    if (!blob) {
        canvas = postcardCanvas(data, null);
        blob = await postcardToBlob(canvas);
    }
    if (!blob) {
        setPostcardState('error');
        return;
    }
    postcardBlobUrl = URL.createObjectURL(blob);
    postcardPreviewImg.src = postcardBlobUrl;
    setPostcardState('ready');
    const ts = (data.latest || '').replace(/-/g, '');
    postcardFileName = data.city + '-' + (ts || 'postcard') + '-旅行明信片.png';
    postcardShare.hidden = !(
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [new File([blob], postcardFileName, { type: 'image/png' })] })
    );
}

export async function openPostcard(ci, triggerBtn) {
    if (!deps.featureEnabled('enablePostcard') || !deps.cityList()[ci] || !postcardPreview) return;
    postcardCi = ci;
    setPostcardState('loading');
    postcardPreviewImg.removeAttribute('src');
    postcardPreview.classList.add('show');
    deps.setOverlayHidden(postcardPreview, false);
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
        postcardBack.focus();
    }
    await renderPostcardPreview();
}

export function closePostcard(returnFocus = true) {
    if (!postcardPreview || !postcardPreview.classList.contains('show')) return;
    postcardPreview.classList.remove('show');
    deps.setOverlayHidden(postcardPreview, true);
    postcardPreviewImg.removeAttribute('src');
    setPostcardState('loading');   // 下次打开从骨架态开始
    if (postcardBlobUrl) {
        URL.revokeObjectURL(postcardBlobUrl);
        postcardBlobUrl = '';
    }
    postcardCi = -1;
    if (returnFocus) focusCityWallTop();
}

function downloadPostcard() {
    if (!postcardBlobUrl) return;
    const a = document.createElement('a');
    a.href = postcardBlobUrl;
    a.download = postcardFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

async function sharePostcard() {
    if (!postcardBlobUrl) return;
    const blob = await fetch(postcardBlobUrl).then(r => r.blob());
    const file = new File([blob], postcardFileName, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: postcardFileName });
        } catch (e) { /* 用户取消分享无需处理 */ }
    }
}

/**
 * 绑定明信片页的按钮（返回 / 下载 / 分享 / 重新生成）。由 initCreativeOverlays 按原顺序调用。
 */
export function initPostcard() {
    postcardBack.addEventListener('click', () => closePostcard());
    postcardDownload.addEventListener('click', downloadPostcard);
    postcardShare.addEventListener('click', sharePostcard);
    postcardRetry.addEventListener('click', () => { renderPostcardPreview(); });

}
