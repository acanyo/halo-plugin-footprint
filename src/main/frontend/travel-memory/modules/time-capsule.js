/**
 * 去年今天（时间胶囊）：找出「往年的今天」去过的足迹，逐张翻看。
 *
 * 从 creative-overlays.js 拆出。覆盖层叠在城市卡片墙之上，关闭后焦点回到卡片墙顶部。
 */

import {
    ticketImageUrl,
    ticketItemsFromFootprints,
    setTicketView
} from './ticket-gallery.js';
import { focusCityWallTop } from './city-wall.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints                    () => Footprint[]
 * @param d.cityList                      () => [{city, indices}]
 * @param d.cityWallImages                (fp) => [{url}]
 * @param d.featureEnabled                (key) => boolean
 * @param d.formatCityDate                (value) => string
 * @param d.openCityView                  (ci, triggerBtn) => void
 * @param d.closeCityWall                 (returnFocus) => void
 * @param d.setOverlayHidden              (el, hidden) => void
 */
export function setupTimeCapsule(d) {
    deps = d;
}

// ---------------- 去年今天 ----------------
export const timeCapsule = document.getElementById('timeCapsule');
const timeCapsuleBack = document.getElementById('timeCapsuleBack');
const timeCapsulePrev = document.getElementById('timeCapsulePrev');
const timeCapsuleNext = document.getElementById('timeCapsuleNext');
const timeCapsuleStats = document.getElementById('timeCapsuleStats');
const timeCapsuleBody = document.getElementById('timeCapsuleBody');
let timeCapsuleItemsCache = [];
let timeCapsuleIndex = 0;

export function timeCapsuleItems() {
    const now = new Date();
    const today = String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
    return deps.footprints()
        .filter(fp => {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fp.createTime || '');
            if (!m) return false;
            const year = Number(m[1]);
            const md = m[2] + '-' + m[3];
            return year < now.getFullYear() && md === today;
        })
        .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
}

function timeCapsuleTicketIndex(fp) {
    const items = ticketItemsFromFootprints();
    const byKey = fp.key ? items.findIndex(item => item.key === fp.key) : -1;
    return byKey >= 0 ? byKey : items.indexOf(fp);
}

function renderTimeCapsule() {
    const fp = timeCapsuleItemsCache[timeCapsuleIndex];
    timeCapsuleBody.innerHTML = '';
    timeCapsuleStats.textContent = timeCapsuleItemsCache.length
        ? '往年的今天有 ' + timeCapsuleItemsCache.length + ' 条足迹，这是第 ' + (timeCapsuleIndex + 1) + ' 条'
        : '';
    timeCapsulePrev.hidden = timeCapsuleItemsCache.length < 2;
    timeCapsuleNext.hidden = timeCapsuleItemsCache.length < 2;
    if (!fp) {
        timeCapsuleBody.textContent = '往年的今天没有足迹。';
        return;
    }

    const article = document.createElement('article');
    article.className = 'capsule-card';
    const shot = document.createElement('div');
    shot.className = 'capsule-shot';
    const imgs = deps.cityWallImages(fp);
    if (imgs.length) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = imgs[0].url;
        img.alt = fp.name;
        shot.appendChild(img);
    } else {
        shot.classList.add('no-image');
        shot.textContent = fp.name ? fp.name.charAt(0) : '?';
    }
    article.appendChild(shot);

    const info = document.createElement('div');
    info.className = 'capsule-info';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'capsule-eyebrow';
    eyebrow.textContent = fp.footprintType || '旅行';
    const name = document.createElement('h3');
    name.textContent = fp.name;
    const meta = document.createElement('p');
    meta.className = 'capsule-meta';
    // 地点 / 日期 / 地址各占一行（.capsule-meta 用 white-space: pre-line 显示换行）
    const place = [fp.province, fp.city].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' ');
    const date = fp.createTime ? deps.formatCityDate(fp.createTime).replace(/\s*\/\s*/, '.') : '';
    meta.textContent = [place, date, fp.address].filter(Boolean).join('\n');
    const desc = document.createElement('p');
    desc.className = 'capsule-desc';
    desc.textContent = fp.description || '';
    const actions = document.createElement('div');
    actions.className = 'capsule-actions';
    const galleryBtn = document.createElement('button');
    galleryBtn.type = 'button';
    galleryBtn.textContent = '打开图片墙';
    galleryBtn.addEventListener('click', () => {
        const fpIndex = deps.footprints().indexOf(fp);
        const ci = fpIndex >= 0 ? deps.cityList().findIndex(city => city.indices.includes(fpIndex)) : -1;
        closeTimeCapsule(false);
        if (ci >= 0) deps.openCityView(ci, null);
    });
    actions.appendChild(galleryBtn);
    if (ticketImageUrl(fp.ticketImage)) {
        const ticketBtn = document.createElement('button');
        ticketBtn.type = 'button';
        ticketBtn.className = 'is-ticket';
        ticketBtn.textContent = '查看票根';
        ticketBtn.addEventListener('click', () => {
            const idx = timeCapsuleTicketIndex(fp);
            closeTimeCapsule(false);
            deps.closeCityWall(false);
            if (idx >= 0) setTicketView(true, idx, false);
        });
        actions.appendChild(ticketBtn);
    }
    info.append(eyebrow, name, meta, desc, actions);
    article.appendChild(info);
    timeCapsuleBody.appendChild(article);
}

export function openTimeCapsule() {
    if (!deps.featureEnabled('enableTimeCapsule') || !timeCapsule) return;
    timeCapsuleItemsCache = timeCapsuleItems();
    if (!timeCapsuleItemsCache.length) return;
    timeCapsuleIndex = 0;
    renderTimeCapsule();
    timeCapsule.classList.add('show');
    deps.setOverlayHidden(timeCapsule, false);
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
        timeCapsuleBack.focus();
    }
}

export function closeTimeCapsule(returnFocus = true) {
    if (!timeCapsule || !timeCapsule.classList.contains('show')) return;
    timeCapsule.classList.remove('show');
    deps.setOverlayHidden(timeCapsule, true);
    if (returnFocus) focusCityWallTop();
}

/**
 * 绑定时间胶囊自己的按钮（返回 / 上一条 / 下一条）。由 initCreativeOverlays 按原顺序调用。
 */
export function initTimeCapsule() {
    timeCapsuleBack.addEventListener('click', () => closeTimeCapsule());
    timeCapsulePrev.addEventListener('click', () => {
        if (timeCapsuleItemsCache.length < 2) return;
        timeCapsuleIndex = (timeCapsuleIndex - 1 + timeCapsuleItemsCache.length) % timeCapsuleItemsCache.length;
        renderTimeCapsule();
    });
    timeCapsuleNext.addEventListener('click', () => {
        if (timeCapsuleItemsCache.length < 2) return;
        timeCapsuleIndex = (timeCapsuleIndex + 1) % timeCapsuleItemsCache.length;
        renderTimeCapsule();
    });

}
