/**
 * 票夹与横向长串：构建票根图片、渲染当前票根与元信息、切换 / 吸附 / 拖拽。
 *
 * 从 ticket-gallery.js 拆出。票夹样式（fan / strip）由 initTicketGallery 按后台配置写入；
 * 交互监听在 initTicketWallet，由 initTicketGallery 在原来的位置调用。
 */

import {
    ticketGallery,
    ticketGalleryHint,
    ticketLetterBtn,
    ticketLightboxCount,
    ticketLightboxDescription,
    ticketLightboxDetails,
    ticketLightboxEnglish,
    ticketLightboxError,
    ticketLightboxLoading,
    ticketLightboxPinyin,
    ticketLightboxRetry,
    ticketLightboxSubtitle,
    ticketLightboxTitle,
    ticketMetaPanel,
    ticketOracleBtn,
    ticketStrip,
    ticketStripHint,
    ticketStripProgress,
    ticketStripScroller,
    ticketWallet
} from './ticket-dom.js';
import {
    ticketEscape,
    ticketImageUrl,
    ticketMeta,
    ticketPinyin
} from './ticket-format.js';
import {
    getTicketCityFilter,
    getTicketIndex,
    getTicketItems,
    renderTicketCityFilter,
    resetTicketCityFilter,
    setTicketIndex,
    setTicketItems,
    ticketFeatureOn,
    ticketItemsFromFootprints
} from './ticket-state.js';
import {
    applyTicketSeason,
    startTicketStampDwell,
    updateTicketPassportButton,
    updateTicketStampBadge
} from './ticket-passport.js';
import { updateTicketModeButtons } from './ticket-replay.js';

let walletItems = [];      // 票夹中的票根元素 [{ fp, img }]
const ticketImagePool = new Map();   // 已成功加载的票根图 → img，重复打开直接复用，避免重复请求
let wheelLocked = false;   // 滚轮切换节流
let walletTouchX = null;   // 触摸滑动起点
let walletSwiped = false;  // 滑动后抑制随后的 click，避免一次滑动触发两次切换
let stripScrollTimer = null;   // 横向长串滚轮停稳后的吸附计时
let stripDrag = null;          // 横向长串拖拽状态
// 后台“票根切换样式”：fan = 票夹叠放；strip = 横向长串浏览
let ticketStripMode = false;   // 由 initTicketGallery 按后台配置赋值

function updateTicketLetterAction(fp) {
    if (!ticketLetterBtn) return;
    ticketLetterBtn.hidden = !ticketFeatureOn('enableTicketLetter') || !fp;
}

// 城市筛选只属于票夹视图：切到重走、打开抽票/护照时先清掉，
// 否则这些按 ticketItems 取数据的入口会莫名只剩一座城市
export function ensureTicketCityFilterCleared() {
    if (!getTicketCityFilter()) return;
    resetTicketCityFilter();
    setTicketItems(ticketItemsFromFootprints());
    setTicketIndex(0);
    buildTicketWallet();
    renderTicketWallet();
}

export function updateTicketFeatureButtons() {
    updateTicketPassportButton();
    updateTicketModeButtons();
    renderTicketCityFilter();
    if (ticketOracleBtn) {
        ticketOracleBtn.hidden = !ticketFeatureOn('enableTicketOracle') || getTicketItems().length === 0;
    }
    updateTicketLetterAction(getTicketItems()[getTicketIndex()]);
}

// 创建一张票根图片；两种展示样式共用加载/失败处理
function createTicketImage(fp, i, className) {
    const originalUrl = ticketImageUrl(fp.ticketImage);
    // 同一张票根已成功加载过：直接复用原 img 元素，避免再次发起图片请求
    const pooled = originalUrl ? ticketImagePool.get(originalUrl) : null;
    if (pooled) {
        pooled.className = className;
        pooled.alt = fp.ticketTitle || fp.name || '';
        pooled.dataset.index = String(i);
        pooled.referrerPolicy = 'no-referrer';
        pooled.decoding = 'async';
        pooled.classList.add('is-loaded');
        pooled.classList.remove('is-error');
        return pooled;
    }

    const img = document.createElement('img');
    img.className = className;
    img.alt = fp.ticketTitle || fp.name || '';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.dataset.index = String(i);
    let triedHttps = false;
    img.onload = () => {
        img.classList.add('is-loaded');
        if (originalUrl) ticketImagePool.set(originalUrl, img);
        if (i === getTicketIndex()) {
            ticketLightboxLoading.hidden = true;
            ticketLightboxError.hidden = true;
        }
        // 长串样式：图片实际尺寸就绪后再补左右留白并让当前票根保持居中
        if (ticketStripMode) {
            updateStripPadding();
            requestAnimationFrame(() => {
                centerStripItem(getTicketIndex(), false);
                positionStripArchive();
            });
        }
    };
    img.onerror = () => {
        // HTTPS 页面会拦截 HTTP 图片；同一域名通常可直接升级为 HTTPS。
        if (!triedHttps && window.location.protocol === 'https:' && /^http:\/\//i.test(originalUrl)) {
            triedHttps = true;
            img.src = originalUrl.replace(/^http:\/\//i, 'https://');
            return;
        }
        img.classList.add('is-error');
        if (i === getTicketIndex()) {
            ticketLightboxLoading.hidden = true;
            ticketLightboxError.hidden = false;
        }
    };
    img.src = originalUrl;
    return img;
}

// 按后台配置构建票夹或横向长串
export function buildTicketWallet() {
    // 保留已加载图片：下次打开时直接从 ticketImagePool 复用，不重新发请求
    walletItems = [];
    ticketGalleryHint.hidden = true;
    ticketStripProgress.hidden = true;
    ticketStripHint.hidden = true;
    document.body.classList.remove('ticket-strip-active');
    if (ticketStripMode) {
        const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
        ticketWallet.hidden = true;
        ticketStrip.hidden = false;
        ticketStripProgress.hidden = getTicketItems().length < 2;
        ticketStripHint.hidden = getTicketItems().length < 2;
        if (getTicketItems().length) {
            document.body.classList.add('ticket-strip-active');
            // 移动端没有鼠标，改用滑动提示；桌面端隐藏顶部提示
            ticketGalleryHint.textContent = isTouch
                ? '左右滑动切换票根'
                : '滚动鼠标或拖动查看票根';
            ticketGalleryHint.hidden = !isTouch || getTicketItems().length < 2;
        } else {
            ticketGalleryHint.hidden = true;
        }
        buildTicketStrip();
    } else {
        ticketWallet.hidden = false;
        ticketStrip.hidden = true;
        buildFanWallet();
    }
}

// 票夹：把每张票根叠成一层，第一张完整展示，后面的从边缘露出一条边。
function buildFanWallet() {
    ticketWallet.innerHTML = '';
    walletItems = getTicketItems().map((fp, i) => {
        const img = createTicketImage(fp, i, 'ticket-wallet-item');
        ticketWallet.appendChild(img);
        return { fp, img };
    });
    const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
    ticketGalleryHint.textContent = isTouch ? '左右滑动切换票根' : '点击票根或滚动鼠标切换';
    ticketGalleryHint.hidden = getTicketItems().length < 2;
}

// 横向长串：所有票根排成一行，通过滚动/拖拽切换
function buildTicketStrip() {
    ticketStripScroller.innerHTML = '';
    ticketStripScroller.scrollLeft = 0;
    walletItems = getTicketItems().map((fp, i) => {
        const img = createTicketImage(fp, i, 'ticket-strip-item');
        ticketStripScroller.appendChild(img);
        return { fp, img };
    });
    updateStripPadding();
}

function renderTicketMeta(fp) {
    const meta = ticketMeta(fp);
    const titleText = ticketLightboxTitle.querySelector('.ticket-meta-title-text');
    if (titleText) titleText.textContent = meta.title;
    else ticketLightboxTitle.textContent = meta.title;
    ticketLightboxEnglish.textContent = fp.ticketEnglish || fp.ticketTitle || '';
    ticketLightboxEnglish.hidden = !ticketLightboxEnglish.textContent;
    if (ticketLightboxPinyin) {
        const cityPinyin = ticketPinyin(fp.cityAdcode);
        const provincePinyin = ticketPinyin(fp.provinceAdcode);
        const pinyinText = cityPinyin && provincePinyin && cityPinyin !== provincePinyin
            ? cityPinyin + ', ' + provincePinyin
            : (cityPinyin || provincePinyin || '');
        ticketLightboxPinyin.textContent = pinyinText;
        ticketLightboxPinyin.hidden = !pinyinText;
    }
    ticketLightboxSubtitle.textContent = '';
    ticketLightboxSubtitle.hidden = true;
    // 只显示用户自己写的说明；没写就空着（样式里 :empty 不占位）
    ticketLightboxDescription.textContent = meta.description || '';
    ticketLightboxDescription.hidden = false;
    ticketLightboxDetails.innerHTML = [
        ['城市', meta.route, 'route', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>'],
        ['省份', meta.province, 'province', ''],
        ['日期', meta.date, 'date', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17"/></svg>'],
        ['票号', meta.no, 'no', '']
    ].filter(item => item[1]).map(item => '<div class="ticket-meta-field ticket-meta-field-' + item[2] + '">' + item[3] + '<dt>' + ticketEscape(item[0]) + '</dt><dd>' + ticketEscape(item[1]) + '</dd></div>').join('');
    ticketLightboxCount.textContent = '第 ' + (getTicketIndex() + 1) + ' 张，共 ' + getTicketItems().length + ' 张';
}

export function renderTicketWallet() {
    const fp = getTicketItems()[getTicketIndex()];
    if (!fp) return;
    applyTicketSeason(fp);
    renderTicketMeta(fp);
    updateTicketStampBadge(fp, false);
    updateTicketLetterAction(fp);
    startTicketStampDwell(fp);
    if (ticketStripMode) {
        renderStripWallet();
    } else {
        renderFanWallet();
    }
    updateTicketFeatureButtons();
}

function renderFanWallet() {
    walletItems.forEach((item, i) => {
        const img = item.img;
        const active = i === getTicketIndex();
        img.classList.toggle('is-active', active);
        img.classList.toggle('is-behind', !active);
        img.setAttribute('aria-label', (i + 1) + ' / ' + walletItems.length + ' ' + (item.fp.ticketTitle || item.fp.name || '票根'));
        if (active) {
            img.style.transform = '';
            img.style.zIndex = '10';
            img.tabIndex = -1;
            // 未加载完成且未失败时显示加载提示；加载完或失败后隐藏
            ticketLightboxLoading.hidden = img.classList.contains('is-loaded') || img.classList.contains('is-error');
            ticketLightboxError.hidden = !img.classList.contains('is-error');
        } else {
            const distance = Math.abs(i - getTicketIndex());
            const k = Math.min(distance, 5);
            const dir = i < getTicketIndex() ? -1 : 1;
            const dx = dir * (8 + k * 4);
            // 移动端保留扇形折叠（第2张约1.7°、后续最大2.8°），配合限高不戳出顶部
            const deg = window.matchMedia('(max-width: 900px)').matches
                ? dir * Math.min(2.8, 0.6 + k * 1.1)
                : dir * Math.min(1.2, 0.4 + k * 0.4);
            img.style.transform = 'translate(' + dx + 'px, 0) rotate(' + deg + 'deg)';
            img.style.zIndex = String(10 - distance);
            img.tabIndex = 0;
        }
    });
}

function renderStripWallet() {
    walletItems.forEach((item, i) => {
        const img = item.img;
        const active = i === getTicketIndex();
        img.classList.toggle('is-active', active);
        img.setAttribute('aria-label', (i + 1) + ' / ' + walletItems.length + ' ' + (item.fp.ticketTitle || item.fp.name || '票根'));
        img.tabIndex = active ? -1 : 0;
    });
    const current = walletItems[getTicketIndex()] && walletItems[getTicketIndex()].img;
    ticketLightboxLoading.hidden = !current || current.classList.contains('is-loaded') || current.classList.contains('is-error');
    ticketLightboxError.hidden = !current || !current.classList.contains('is-error');
    renderStripProgress();
}

// 字幕下方的极简指示线：亮点在线上随当前票根位置移动，其余部分保持低透明度
function renderStripProgress() {
    if (!ticketStripMode || !ticketStripProgress) return;
    const rail = ticketStripProgress.querySelector('.ticket-progress-rail');
    if (!rail) return;
    const total = getTicketItems().length;
    rail.innerHTML = '';
    for (let i = 0; i < total; i++) {
        const segment = document.createElement('button');
        segment.type = 'button';
        segment.className = 'ticket-progress-segment' + (i === getTicketIndex() ? ' is-current' : '');
        segment.dataset.index = String(i);
        segment.setAttribute('aria-label', '查看第 ' + (i + 1) + ' 张票根');
        segment.setAttribute('aria-current', i === getTicketIndex() ? 'true' : 'false');
        rail.appendChild(segment);
    }
}

export function switchTicket(delta) {
    if (getTicketItems().length < 2) return;
    setTicketIndex((getTicketIndex() + delta + getTicketItems().length) % getTicketItems().length);
    renderTicketWallet();
    if (ticketStripMode) centerStripItem(getTicketIndex(), true);
}

// ================= 横向长串：定位 / 吸附 / 拖拽 =================
function stripViewportCenter() {
    const rect = ticketStripScroller.getBoundingClientRect();
    return rect.left + ticketStripScroller.clientWidth / 2;
}

function stripItemCenter(el) {
    const rect = el.getBoundingClientRect();
    return rect.left + rect.width / 2;
}

// 给首尾两张留出“能滚到居中”的左右留白：
// 视口过宽时若不补白，中间票根的左右邻图永远无法滚到正中央，吸附会弹回中间。
function updateStripPadding() {
    if (!ticketStripScroller.clientWidth || !ticketStripScroller.firstElementChild) return;
    const itemWidth = ticketStripScroller.firstElementChild.offsetWidth;
    if (!itemWidth) return;
    const pad = Math.max(0, Math.floor((ticketStripScroller.clientWidth - itemWidth) / 2));
    ticketStripScroller.style.paddingLeft = pad + 'px';
    ticketStripScroller.style.paddingRight = pad + 'px';
}

function nearestStripIndex() {
    const viewportCenter = stripViewportCenter();
    let best = 0;
    let bestDist = Infinity;
    walletItems.forEach((item, i) => {
        const el = item.img;
        if (!el || !el.offsetWidth) return;
        const dist = Math.abs(stripItemCenter(el) - viewportCenter);
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    });
    return best;
}

export function centerStripItem(index, smooth) {
    const item = walletItems[index];
    if (!item || !item.img || !ticketStripScroller.clientWidth) return;
    const el = item.img;
    const delta = stripItemCenter(el) - stripViewportCenter();
    const target = Math.max(0, ticketStripScroller.scrollLeft + delta);
    ticketStripScroller.scrollTo({
        left: target,
        behavior: smooth ? 'smooth' : 'auto'
    });
}

function snapStrip() {
    if (!ticketStripMode || getTicketItems().length < 2) return;
    const idx = nearestStripIndex();
    if (idx === getTicketIndex()) return;
    // 只在真正切换到另一张票根时，把新票根平滑吸附到视口正中央
    setTicketIndex(idx);
    renderTicketWallet();
    centerStripItem(idx, true);
}

// 方案 1：票据档案页垫在当前票根下，只从票根下缘露出一截
let stripArchiveRaf = null;
export function positionStripArchive() {
    if (!ticketStripMode || !ticketGallery.classList.contains('show')) return;
    // 字幕式元信息使用正常文档流，始终排在当前票根下方。
    ticketMetaPanel.style.position = '';
    ticketMetaPanel.style.left = '';
    ticketMetaPanel.style.top = '';
    ticketMetaPanel.style.zIndex = '';
    ticketStripScroller.style.marginBottom = '';
    ticketStripScroller.style.zIndex = '';
}

function reloadTicket(index) {
    const item = walletItems[index];
    if (!item) return;
    const img = item.img;
    img.classList.remove('is-loaded', 'is-error');
    if (index === getTicketIndex()) {
        ticketLightboxLoading.hidden = false;
        ticketLightboxError.hidden = true;
    }
    img.src = ticketImageUrl(item.fp.ticketImage);
}

/**
 * 绑定票夹 / 横向长串的切换、滚轮、触摸、拖拽与吸附。
 * 由 initTicketGallery 在原来的位置调用，监听注册顺序与拆分前一致。
 */
export function initTicketWallet() {
    ticketLightboxRetry.addEventListener('click', () => reloadTicket(getTicketIndex()));
    ticketStripProgress.querySelector('.ticket-progress-rail').addEventListener('click', event => {
        const segment = event.target.closest('.ticket-progress-segment');
        if (!segment) return;
        const index = Number(segment.dataset.index);
        if (Number.isInteger(index)) {
            setTicketIndex(index);
            renderTicketWallet();
            centerStripItem(getTicketIndex(), true);
        }
    });
    // 点露出的边缘 → 翻到前面；点当前票根 → 转到下一张
    ticketWallet.addEventListener('click', event => {
        if (walletSwiped) {
            walletSwiped = false;
            return;
        }
        const img = event.target.closest('.ticket-wallet-item');
        if (!img) return;
        const index = Number(img.dataset.index);
        if (index === getTicketIndex()) {
            switchTicket(1);
        } else {
            setTicketIndex(index);
            renderTicketWallet();
        }
    });
    // 鼠标滚轮切换
    ticketWallet.addEventListener('wheel', event => {
        if (getTicketItems().length < 2 || wheelLocked) return;
        event.preventDefault();
        wheelLocked = true;
        switchTicket(event.deltaY > 0 ? 1 : -1);
        setTimeout(() => { wheelLocked = false; }, 320);
    }, { passive: false });
    // 触摸滑动切换（只在票根区域上滑动时切换，信息区滑动不切换）
    ticketWallet.addEventListener('touchstart', event => {
        walletTouchX = event.touches[0].clientX;
    }, { passive: true });
    ticketWallet.addEventListener('touchend', event => {
        if (walletTouchX === null) return;
        const dx = event.changedTouches[0].clientX - walletTouchX;
        walletTouchX = null;
        if (Math.abs(dx) > 40) {
            walletSwiped = true;
            switchTicket(dx < 0 ? 1 : -1);
            setTimeout(() => { walletSwiped = false; }, 400);
        }
    }, { passive: true });

    // 横向长串：鼠标滚轮（纵向滚动映射为横向）、拖拽滑动、停稳后吸附居中
    ticketStripScroller.addEventListener('wheel', event => {
        if (!ticketStripMode || getTicketItems().length < 2) return;
        event.preventDefault();
        const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        ticketStripScroller.scrollLeft += delta;
        clearTimeout(stripScrollTimer);
        stripScrollTimer = setTimeout(snapStrip, 160);
    }, { passive: false });

    ticketStripScroller.addEventListener('pointerdown', event => {
        if (!ticketStripMode || getTicketItems().length < 2) return;
        // 触屏交给浏览器原生滚动 + scroll-snap，手感更顺滑；手动拖拽只用于鼠标
        if (event.pointerType !== 'mouse') return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        stripDrag = {
            id: event.pointerId,
            startX: event.clientX,
            startLeft: ticketStripScroller.scrollLeft,
            moved: false
        };
        ticketStripScroller.classList.add('dragging');
        try {
            ticketStripScroller.setPointerCapture(event.pointerId);
        } catch (e) {
            /* 忽略捕获失败 */
        }
    });
    ticketStripScroller.addEventListener('pointermove', event => {
        if (!stripDrag || stripDrag.id !== event.pointerId) return;
        const dx = event.clientX - stripDrag.startX;
        if (Math.abs(dx) > 5) stripDrag.moved = true;
        ticketStripScroller.scrollLeft = stripDrag.startLeft - dx;
    });
    function endStripDrag(event) {
        if (!stripDrag || stripDrag.id !== event.pointerId) return;
        const wasMoved = stripDrag.moved;
        stripDrag = null;
        ticketStripScroller.classList.remove('dragging');
        if (wasMoved) snapStrip();
    }
    ticketStripScroller.addEventListener('pointerup', endStripDrag);
    ticketStripScroller.addEventListener('pointercancel', endStripDrag);
    // 横条滚动时让档案页跟随当前主票根移动
    ticketStripScroller.addEventListener('scroll', () => {
        if (!ticketStripMode || !ticketGallery.classList.contains('show')) return;
        clearTimeout(stripScrollTimer);
        stripScrollTimer = setTimeout(snapStrip, 180);
        if (stripArchiveRaf) return;
        stripArchiveRaf = requestAnimationFrame(() => {
            stripArchiveRaf = null;
            positionStripArchive();
        });
    }, { passive: true });
    window.addEventListener('resize', () => {
        if (!ticketStripMode || !ticketGallery.classList.contains('show') || getTicketItems().length < 2) return;
        updateStripPadding();
        requestAnimationFrame(() => {
            centerStripItem(getTicketIndex(), false);
            positionStripArchive();
        });
    });
}

// ---------- 取值 / 赋值（票夹样式在 init 时按后台配置赋值；关闭票根页时清空票夹元素） ----------
export function isTicketStripMode() {
    return ticketStripMode;
}
export function setTicketStripMode(on) {
    ticketStripMode = on;
}
export function setWalletItems(items) {
    walletItems = items;
}
