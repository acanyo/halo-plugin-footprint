/**
 * 未寄出的明信片（阶段 B）：把当前票根画成一封信（canvas），可下载 / 分享。
 *
 * 从 ticket-gallery.js 拆出。图片加载与 toBlob 复用 postcard.js 的实现，经依赖注入传入，
 * 避免与 postcard.js（它 import 了 wrapTicketLetterText）形成循环。
 */

import {
    ticketLetter,
    ticketLetterBack,
    ticketLetterBtn,
    ticketLetterCaption,
    ticketLetterDownload,
    ticketLetterImg,
    ticketLetterRetry,
    ticketLetterShare,
    ticketLetterStage,
    ticketLetterStatus,
    ticketLetterTitle
} from './ticket-dom.js';
import { ticketImageUrl, ticketMeta } from './ticket-format.js';
import { getTicketIndex, getTicketItems, ticketFeatureOn } from './ticket-state.js';
import { clearTicketStampTimer, startTicketStampDwell } from './ticket-passport.js';
import { pauseTicketReplayForOverlay, resumeTicketReplayFromOverlay } from './ticket-replay.js';

let deps = null;

/**
 * @param {object} d 依赖集合（由 setupTicketGallery 从宿主注入里挑出本模块要用的键转发）
 * @param d.loadPostcardImage / d.postcardToBlob
 * @param d.setOverlayHidden              (el, hidden) => void
 */
export function setupTicketLetter(d) {
    deps = d;
}

let ticketLetterFp = null;
let ticketLetterBlobUrl = '';
let ticketLetterFileName = '';
let ticketLetterRenderToken = 0;   // 明信片渲染令牌：关闭浮层后丢弃未完成的渲染结果

// ================= 未寄出的明信片（阶段 B） =================
export function wrapTicketLetterText(ctx, text, maxWidth) {
    const lines = [];
    String(text || '').split('\n').forEach(paragraph => {
        let line = '';
        paragraph.split('').forEach(ch => {
            const test = line + ch;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = ch;
            } else {
                line = test;
            }
        });
        if (line) lines.push(line);
    });
    return lines;
}

function ticketLetterCanvas(fp, image) {
    const meta = ticketMeta(fp);
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    // 画布不能读 CSS 变量：颜色照抄 tokens.css 里白图（.fp-sheet）的值，改色板时两处一起改
    const paper = '#f3f4f1';      // --fp-paper
    const raised = '#fbfbf9';     // --fp-paper-raised
    const ink = '#1e2a33';        // --fp-ink
    const muted = '#7d878b';      // --fp-ink-faint
    const rule = 'rgba(30, 42, 51, 0.14)';   // --fp-rule
    const titleFont = '"快看世界体", "PingFang SC", "Microsoft YaHei", sans-serif';
    const textFont = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, 900, 1280);
    ctx.strokeStyle = rule;
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 24, 852, 1232);

    ctx.fillStyle = ink;
    ctx.font = '400 44px ' + titleFont;
    ctx.textAlign = 'center';
    ctx.fillText('未寄出的明信片', 450, 112);

    // 票根图直接贴在纸面上：不垫白卡、不加粗边框，按内容宽度铺满，
    // 高度由图片自身比例决定；下面的正文起点跟着图高浮动，长图短图都不会顶到文字。
    const shotX = 40;
    const shotW = 820;
    const shotTop = 168;
    const shotMaxH = 520;
    let shotBottom = shotTop + 360;
    if (image) {
        const scale = Math.min(shotW / image.width, shotMaxH / image.height);
        const dw = image.width * scale;
        const dh = image.height * scale;
        const dx = shotX + (shotW - dw) / 2;
        ctx.drawImage(image, dx, shotTop, dw, dh);
        shotBottom = shotTop + dh;
    } else {
        ctx.fillStyle = raised;
        ctx.fillRect(shotX, shotTop, shotW, shotBottom - shotTop);
        ctx.fillStyle = muted;
        ctx.font = '400 150px ' + titleFont;
        ctx.textAlign = 'center';
        ctx.fillText((fp.city || '?').charAt(0), 450, shotTop + 260);
    }
    // 图下小字：城市，日期，票根名
    ctx.fillStyle = muted;
    ctx.font = '400 24px ' + textFont;
    ctx.textAlign = 'center';
    ctx.fillText(
        [fp.city || meta.route, meta.date, fp.name || meta.title].filter(Boolean).join('，'),
        450,
        shotBottom + 44
    );

    // 信件正文
    const desc = String(fp.description || '').trim();
    const noText = meta.no ? '，编号是 ' + meta.no : '';
    const typeText = fp.ticketType ? '；那是一段关于「' + fp.ticketType + '」的旅程' : '';
    const descText = desc ? ' 我还记得：' + (desc.length > 80 ? desc.slice(0, 80) + '…' : desc) : '';
    const letter =
        '致许多年后的自己：\n' +
        '这一张票根，写于' + (meta.date || '某一天') + '的' + (fp.city || meta.route || '远方') + '。\n' +
        '那时候的旅程叫「' + (meta.title || '一次出发') + '」' + noText + typeText + '。' +
        descText + '当时没有说出口的话，都留在这张纸里了。\n' +
        '—— 一张票根，代替当时的我寄出。';
    ctx.fillStyle = ink;
    ctx.font = '400 30px ' + titleFont;
    ctx.textAlign = 'left';
    const lines = wrapTicketLetterText(ctx, letter, 760);
    const lineHeight = 46;
    const startY = shotBottom + 106;
    // 正文行数按剩余高度算：图高变化时不会把落款挤出去
    const maxLines = Math.max(4, Math.floor((1224 - startY) / lineHeight));
    lines.slice(0, maxLines).forEach((line, i) => {
        ctx.fillText(line, 70, startY + i * lineHeight);
    });

    ctx.textAlign = 'right';
    ctx.fillStyle = muted;
    ctx.font = '24px ' + textFont;
    ctx.fillText('旅行记忆', 852, 1245);
    return canvas;
}

// 写信页三种状态：loading（骨架 + 文案）/ ready（出图 + 可下载）/ error（说明 + 重新生成）
function setTicketLetterState(state) {
    if (ticketLetterStage) {
        ticketLetterStage.classList.toggle('is-loading', state === 'loading');
        ticketLetterStage.classList.toggle('is-ready', state === 'ready');
        ticketLetterStage.classList.toggle('is-error', state === 'error');
        ticketLetterStage.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    }
    if (ticketLetterStatus) {
        ticketLetterStatus.textContent = state === 'loading'
            ? '正在写这封信…'
            : (state === 'error' ? '这封信没能生成，可能是票根图取不到。' : '');
    }
    if (ticketLetterRetry) ticketLetterRetry.hidden = state !== 'error';
    if (ticketLetterDownload) ticketLetterDownload.disabled = state !== 'ready';
}

export async function renderTicketLetter() {
    const fp = ticketLetterFp;
    if (!fp) return;
    // 渲染是异步的（图片 + 两次 toBlob）：关闭浮层或换票后本次结果作废，
    // 否则会把 blob URL 和 src 写回已关闭的浮层，并漏掉一次 revokeObjectURL
    const token = ++ticketLetterRenderToken;
    if (ticketLetterBlobUrl) URL.revokeObjectURL(ticketLetterBlobUrl);
    ticketLetterBlobUrl = '';
    if (ticketLetterShare) ticketLetterShare.hidden = true;
    setTicketLetterState('loading');
    const image = await deps.loadPostcardImage(ticketImageUrl(fp.ticketImage));
    if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
    let canvas = ticketLetterCanvas(fp, image);
    let blob = await deps.postcardToBlob(canvas);
    if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
    if (!blob) {
        canvas = ticketLetterCanvas(fp, null);
        blob = await deps.postcardToBlob(canvas);
    }
    if (!blob) {
        setTicketLetterState('error');
        return;
    }
    if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
    ticketLetterBlobUrl = URL.createObjectURL(blob);
    ticketLetterImg.src = ticketLetterBlobUrl;
    setTicketLetterState('ready');
    const ts = String(fp.ticketDate || fp.createTime || '').replace(/-/g, '');
    ticketLetterFileName = (fp.city || '票根') + '-' + (ts || 'letter') + '-未寄出的明信片.png';
    ticketLetterShare.hidden = !(
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [new File([blob], ticketLetterFileName, { type: 'image/png' })] })
    );
}

export async function openTicketLetter(fp) {
    if (!ticketFeatureOn('enableTicketLetter') || !fp || !ticketLetter) return;
    clearTicketStampTimer();
    pauseTicketReplayForOverlay();
    ticketLetterFp = fp;
    if (ticketLetterTitle) {
        ticketLetterTitle.textContent = (fp.city ? fp.city + '，' : '') + '未寄出的明信片';
    }
    const meta = ticketMeta(fp);
    if (ticketLetterCaption) {
        ticketLetterCaption.textContent = [
            '由「' + (fp.name || meta.title || '这张票根') + '」写成',
            fp.city || meta.route,
            meta.date
        ].filter(Boolean).join('，');
    }
    if (ticketLetterImg) {
        ticketLetterImg.alt = (fp.city || '票根') + ' 的未寄出的明信片';
    }
    setTicketLetterState('loading');
    ticketLetterImg.removeAttribute('src');
    ticketLetter.classList.add('show');
    deps.setOverlayHidden(ticketLetter, false);
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
        ticketLetterBack) {
        ticketLetterBack.focus();
    }
    await renderTicketLetter();
}

export function closeTicketLetter(returnFocus = true) {
    if (!ticketLetter || !ticketLetter.classList.contains('show')) return;
    ticketLetterRenderToken++;   // 作废仍在进行中的渲染
    ticketLetter.classList.remove('show');
    deps.setOverlayHidden(ticketLetter, true);
    ticketLetterImg.removeAttribute('src');
    setTicketLetterState('loading');   // 下次打开从骨架态开始
    if (ticketLetterBlobUrl) {
        URL.revokeObjectURL(ticketLetterBlobUrl);
        ticketLetterBlobUrl = '';
    }
    ticketLetterFp = null;
    if (returnFocus && ticketLetterBtn && !ticketLetterBtn.hidden) {
        ticketLetterBtn.focus();
    }
    startTicketStampDwell(getTicketItems()[getTicketIndex()]);
    resumeTicketReplayFromOverlay();
}

export function downloadTicketLetter() {
    if (!ticketLetterBlobUrl) return;
    const a = document.createElement('a');
    a.href = ticketLetterBlobUrl;
    a.download = ticketLetterFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

export async function shareTicketLetter() {
    if (!ticketLetterBlobUrl) return;
    const blob = await fetch(ticketLetterBlobUrl).then(r => r.blob());
    const file = new File([blob], ticketLetterFileName, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: ticketLetterFileName });
        } catch (e) { /* 用户取消分享无需处理 */ }
    }
}
