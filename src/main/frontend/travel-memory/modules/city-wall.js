/**
 * 城市卡片墙（「城记」）：全部已到访城市的总览目录。
 *
 * 一屏卡片，按最近到访排序；点击卡片进入该城市的图片墙。附带两件小事：
 *   - 封面按视口懒加载（IntersectionObserver + 队列，避免一次解码上百张）；
 *   - PC 端悬停卡片时轮播最多 3 张预览图。
 *
 * 卡片封面与城市图片墙共用 cityCardImageUrl / cityWallCardData，
 * 「默认启用」判断也走同一个 featureEnabled —— 两处口径必须一致。
 */

import { stopCityWallWarmQueue, startCityWallWarmQueue } from './city-wall-prewarm.js';
import { ticketImageUrl } from './ticket-gallery.js';
import { lightbox } from './lightbox.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints                 () => Footprint[]
 * @param d.cityList                   () => [{city, indices}]
 * @param d.cityViewItems              (ci) => Footprint[]
 * @param d.cityWallImages             (fp) => [{url, caption}]
 * @param d.formatCityDate             (value) => string
 * @param d.footprintCfg               () => object
 * @param d.provinceCardsActive        () => boolean
 * @param d.markerCard / d.cityCard / d.viewer  () => HTMLElement / Cesium.Viewer
 * @param d.hideMarkerCard / d.hideCityCard / d.hidePhotoRing
 * @param d.closeLightbox / d.closeProvinceCards / d.openCityView
 * @param d.openPostcard / d.openTicketGalleryForCity / d.refreshCityWallFeatureActions
 * @param d.setOverlayHidden           (el, hidden) => void
 */
export function setupCityWall(d) {
    deps = d;
}

// ================= 城市卡片墙（城市总览目录） =================
// 与城市图片墙共用 deps.footprints() / deps.cityList()：卡片点击后直接进入现有 openCityView，
// 不做重复的城市详情实现。卡片按“最近去过时间”倒序排列。
export const cityWall = document.getElementById('cityWall');
export const cityWallBtn = document.getElementById('cityWallBtn');
export const cityWallBack = document.getElementById('cityWallBack');
const cityWallTitle = document.getElementById('cityWallTitle');
const cityWallStats = document.getElementById('cityWallStats');
const cityWallGrid = document.getElementById('cityWallGrid');
const cityWallEmpty = document.getElementById('cityWallEmpty');
const cityWallBody = document.getElementById('cityWallBody');
export const cityWallTimeCapsuleBtn = document.getElementById('cityWallTimeCapsuleBtn');
export const cityWallInsightBtn = document.getElementById('cityWallInsightBtn');
export const cityWallProvinceFilter = document.getElementById('cityWallProvinceFilter');
// 只看某个省（从足迹洞察的省份排行点进来）；关闭卡片墙时自动清掉
let cityWallProvinceFilterName = '';

// 4 个创意功能的开关统一从后台 globe3d 设置读取（默认开启）
export function featureEnabled(key) {
    const value = deps.footprintCfg() && deps.footprintCfg()[key];
    return value !== false;
}

// 城市卡片封面缩略：独立使用后台“城市卡片墙图片”的 from→to→suffix 规则；
// 三项都留空时回退到“标记点图片”的 from→to 规则，保持升级前的行为不变。
export function cityCardImageUrl(url) {
    if (!url || !deps.footprintCfg()) return url;
    const cityFrom = deps.footprintCfg().cityWallImageFrom;
    const cityTo = deps.footprintCfg().cityWallImageTo;
    const citySuffix = deps.footprintCfg().cityWallImageSuffix;
    if (!cityFrom && !cityTo && !citySuffix) {
        // 独立规则未配置：完全沿用旧版的标记点 from→to 替换逻辑
        const from = deps.footprintCfg().markerImageFrom;
        const to = deps.footprintCfg().markerImageTo;
        if (from && to && String(url).includes(from)) {
            return String(url).split(from).join(to);
        }
        return url;
    }
    let out = String(url);
    if (cityFrom) out = out.split(cityFrom).join(cityTo || '');
    if (citySuffix && !out.endsWith(citySuffix)) out += citySuffix;
    return out;
}

// 移动端城市卡片墙每排数量：由后台 3D 地球设置注入，前端按 1-3 兜底
const CITY_WALL_MOBILE_MIN = 1;
const CITY_WALL_MOBILE_MAX = 3;
function resolveMobileCityWallColumns() {
    const raw = Number(deps.footprintCfg() && deps.footprintCfg().mobileCityWallColumns);
    if (!Number.isFinite(raw)) return 2;
    return Math.min(CITY_WALL_MOBILE_MAX, Math.max(CITY_WALL_MOBILE_MIN, Math.round(raw)));
}

// 地球渲染循环：票根墙需要透明背景透出地球，保持渲染；不透明全屏层打开时暂停
export function setGlobeRenderLoop(running) {
    if (!deps.viewer()) return;
    try {
        if (running && !deps.viewer().useDefaultRenderLoop) {
            deps.viewer().useDefaultRenderLoop = true;
        } else if (!running && deps.viewer().useDefaultRenderLoop) {
            deps.viewer().useDefaultRenderLoop = false;
        }
    } catch (e) { /* 暂停/恢复失败不影响页面功能 */ }
}

// 封面图限量解码队列：滚动时一次只解码少数图片，避免栅格线程被批量解码占满
const CITY_WALL_COVER_CONCURRENCY = 3;   // 同时解码/加载的封面数
const CITY_WALL_COVER_MARGIN = 700;      // 提前加载的距离（px）
const cityWallCoverQueue = [];
let cityWallCoverLoading = 0;
let cityWallCoverObserver = null;
let cityWallCoverDrainScheduled = false;

function drainCityWallCoverQueue() {
    cityWallCoverDrainScheduled = false;
    while (cityWallCoverLoading < CITY_WALL_COVER_CONCURRENCY && cityWallCoverQueue.length) {
        const media = cityWallCoverQueue.shift();
        if (!media || !media.isConnected) continue;
        const img = media.querySelector('img.city-wall-card-cover');
        if (!img || !img.dataset.src || img.getAttribute('src')) continue;
        cityWallCoverLoading++;
        img.src = img.dataset.src;
    }
}

function scheduleCityWallCoverDrain() {
    if (cityWallCoverDrainScheduled) return;
    cityWallCoverDrainScheduled = true;
    requestAnimationFrame(drainCityWallCoverQueue);
}

function cityWallCoverFinished() {
    cityWallCoverLoading = Math.max(0, cityWallCoverLoading - 1);
    scheduleCityWallCoverDrain();
}

function stopCityWallCoverLoader() {
    if (cityWallCoverObserver) {
        cityWallCoverObserver.disconnect();
        cityWallCoverObserver = null;
    }
    cityWallCoverQueue.length = 0;
    cityWallCoverLoading = 0;
    cityWallCoverDrainScheduled = false;
}

function startCityWallCoverLoader() {
    stopCityWallCoverLoader();
    const pending = cityWallGrid.querySelectorAll('.city-wall-card-media.is-loading');
    if (!pending.length) return;
    // 不支持 IntersectionObserver 时回退为立即加载（与原生 lazy 行为相近）
    if (!('IntersectionObserver' in window) || !cityWallBody) {
        pending.forEach(media => {
            const img = media.querySelector('img.city-wall-card-cover');
            if (img && img.dataset.src) img.src = img.dataset.src;
        });
        return;
    }
    cityWallCoverObserver = new IntersectionObserver(entries => {
        let enqueued = false;
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const media = entry.target;
            if (media.dataset.coverQueued) return;
            media.dataset.coverQueued = '1';
            cityWallCoverQueue.push(media);
            enqueued = true;
        });
        if (enqueued) scheduleCityWallCoverDrain();
    }, {
        root: cityWallBody,
        rootMargin: '0px 0px ' + CITY_WALL_COVER_MARGIN + 'px 0px',
        threshold: 0.01
    });
    pending.forEach(media => cityWallCoverObserver.observe(media));
}

// 卡片墙图片空闲预热在 modules/city-wall-prewarm.js
// ============ PC 城市卡片悬停轮播（最多 3 张） ============
const CITY_CARD_CAROUSEL_DELAY = 600;      // 悬停后多久开始
const CITY_CARD_CAROUSEL_INTERVAL = 1800;  // 每张停留时长
let cityCardCarouselCard = null;
let cityCardCarouselTimer = null;
let cityCardCarouselIndex = 0;
let cityCardCarouselPauseUntil = 0;

function loadCityCardPreview(img) {
    if (!img || !img.dataset.src || img.src) return;
    const probe = new Image();
    probe.onload = () => {
        if (!img.isConnected) return;
        img.src = img.dataset.src;
        img.classList.add('is-ready');
    };
    probe.onerror = () => {
        if (!img.isConnected) return;
        img.classList.add('is-error');
    };
    probe.src = img.dataset.src;
}

function stopCityCardCarousel() {
    if (cityCardCarouselTimer) {
        clearTimeout(cityCardCarouselTimer);
        cityCardCarouselTimer = null;
    }
    if (cityCardCarouselCard) {
        cityCardCarouselCard.classList.remove('is-carouseling');
        cityCardCarouselCard.querySelectorAll('.city-wall-card-preview').forEach(img => {
            img.classList.remove('is-active');
        });
    }
    cityCardCarouselCard = null;
    cityCardCarouselIndex = 0;
}

function stepCityCardCarousel() {
    if (Date.now() < cityCardCarouselPauseUntil) return;
    const card = cityCardCarouselCard;
    if (!card || !card.isConnected) {
        stopCityCardCarousel();
        return;
    }
    const imgs = [...card.querySelectorAll('.city-wall-card-cover, .city-wall-card-preview')]
        .filter(img => img.getAttribute('src') && !img.classList.contains('is-error'));
    if (imgs.length < 2) return;
    cityCardCarouselIndex = (cityCardCarouselIndex + 1) % imgs.length;
    imgs.forEach((img, i) => img.classList.toggle('is-active', i === cityCardCarouselIndex));
}

function startCityCardCarousel(card) {
    if (!featureEnabled('cityCardHoverCarousel')) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (cityCardCarouselCard === card && cityCardCarouselTimer) return;
    stopCityCardCarousel();
    cityCardCarouselCard = card;
    const boot = () => {
        if (!card.isConnected) {
            stopCityCardCarousel();
            return;
        }
        if (Date.now() < cityCardCarouselPauseUntil) {
            cityCardCarouselTimer = setTimeout(boot, 150);
            return;
        }
        // 真正开始轮播时才加载后续图片，一次只加载本卡 2 张
        card.querySelectorAll('.city-wall-card-preview').forEach(img => {
            if (!img.src && img.dataset.src) loadCityCardPreview(img);
        });
        card.classList.add('is-carouseling');
        const ready = [...card.querySelectorAll('.city-wall-card-cover, .city-wall-card-preview')]
            .filter(img => img.getAttribute('src') && !img.classList.contains('is-error'));
        if (ready.length) {
            ready.forEach((img, i) => img.classList.toggle('is-active', i === 0));
        }
        cityCardCarouselIndex = 0;
        cityCardCarouselTimer = setInterval(stepCityCardCarousel, CITY_CARD_CAROUSEL_INTERVAL);
    };
    cityCardCarouselTimer = setTimeout(boot, CITY_CARD_CAROUSEL_DELAY);
}

// 滚动时暂停轮播，避免与滚动卡顿叠加

export function cityWallCardData(ci) {
    const fps = deps.cityViewItems(ci);
    const photos = fps.reduce((n, fp) => n + deps.cityWallImages(fp).length, 0);
    const tickets = fps.reduce((n, fp) => n + (ticketImageUrl(fp.ticketImage) ? 1 : 0), 0);
    const latest = fps.map(fp => fp.createTime).filter(Boolean).sort().pop() || '';
    // 封面/轮播预览：按最近足迹顺序，从足迹相册中取最多 3 张不重复照片；
    // 单足迹但相册有很多照片的城市也能获得轮播效果；都没有图片时卡片显示首字占位
    const previews = [];
    const previewsRaw = [];   // 与 previews 一一对应的原图地址（明信片出图用）
    const latestFirst = fps.slice().sort((a, b) =>
        String(b.createTime || '').localeCompare(String(a.createTime || '')));
    for (const fp of latestFirst) {
        const imgs = deps.cityWallImages(fp);
        for (const img of imgs) {
            const url = cityCardImageUrl(img.url);
            if (!previews.includes(url)) {
                previews.push(url);
                previewsRaw.push(img.url);
            }
            if (previews.length >= 3) break;
        }
        if (previews.length >= 3) break;
    }
    const cover = previews[0] || '';
    const coverRaw = previewsRaw[0] || '';
    const province = fps.map(fp => fp.province).find(Boolean) || '';
    // 城市小结用：第一次到访 + 这座城市里走过的地方（按时间升序）
    const first = fps.map(fp => fp.createTime).filter(Boolean).sort()[0] || '';
    const places = fps
        .slice()
        .sort((a, b) => String(a.createTime || '').localeCompare(String(b.createTime || '')))
        .map(fp => fp.name)
        .filter(Boolean);
    return { count: fps.length, photos, tickets, latest, first, places, cover, coverRaw, province, previews };
}

// 「只看某个省」的开关：足迹洞察的省份排行点进来时用，只影响卡片墙这一层
function renderCityWallProvinceFilter() {
    if (!cityWallProvinceFilter) return;
    cityWallProvinceFilter.hidden = !cityWallProvinceFilterName;
    if (!cityWallProvinceFilterName) return;
    cityWallProvinceFilter.textContent = '只看 ' + cityWallProvinceFilterName + ' ✕';
    cityWallProvinceFilter.setAttribute('aria-label',
        '清除筛选，显示全部城市（当前只看 ' + cityWallProvinceFilterName + '）');
}

export function setCityWallProvinceFilter(name) {
    cityWallProvinceFilterName = name || '';
    renderCityWall();
    if (cityWallBody) cityWallBody.scrollTop = 0;
}

function cityWallCards() {
    const cards = deps.cityList()
        .map((city, ci) => ({
            ci,
            name: city.city,
            ...cityWallCardData(ci)
        }))
        .filter(card => !cityWallProvinceFilterName || card.province === cityWallProvinceFilterName);
    // 最近去过的城市排前面，无日期时按名称兜底，保持顺序稳定
    cards.sort((a, b) => {
        const byDate = String(b.latest || '').localeCompare(String(a.latest || ''));
        if (byDate) return byDate;
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    });
    return cards;
}

export function renderCityWall() {
    if (!cityWall) return;
    stopCityWallCoverLoader();
    stopCityWallWarmQueue();
    stopCityCardCarousel();
    const mobileColumns = resolveMobileCityWallColumns();
    const mobileView = window.matchMedia('(max-width: 820px)').matches;
    cityWall.style.setProperty('--city-wall-mobile-columns', String(mobileColumns));
    // 仅手机端多列（每排 2-3 个）时切换紧凑照片卡样式：图片放大、次要文字隐藏
    cityWall.classList.toggle('city-wall-multi', mobileView && mobileColumns > 1);
    const cards = cityWallCards();
    const cityCount = cards.length;
    const footprintTotal = cards.reduce((n, c) => n + c.count, 0);
    const photoTotal = cards.reduce((n, c) => n + c.photos, 0);
    const ticketTotal = cards.reduce((n, c) => n + c.tickets, 0);
    cityWallTitle.textContent = '城市卡片墙';
    cityWallStats.textContent = cityCount
        ? cityCount + ' 座城市 · ' + footprintTotal + ' 个足迹 · ' + photoTotal + ' 张照片' +
          (ticketTotal ? ' · ' + ticketTotal + ' 张票根' : '')
        : '每一座城市，都值得一张卡片';
    renderCityWallProvinceFilter();
    cityWallGrid.innerHTML = '';
    if (cityWallEmpty) cityWallEmpty.hidden = cityCount > 0;

    cards.forEach(card => {
        const wrap = document.createElement('div');
        wrap.className = 'city-wall-card-wrap';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'city-wall-card' + (card.cover ? '' : ' no-cover');
        btn.dataset.cityIndex = String(card.ci);
        btn.setAttribute('aria-label',
            card.name + (card.province ? '，' + card.province : '') + '，' +
            card.count + ' 个足迹' +
            (card.tickets ? '，' + card.tickets + ' 张票根' : '') + '，打开城市图片墙');

        const media = document.createElement('span');
        media.className = 'city-wall-card-media' + (card.cover ? ' is-loading' : '');
        // 首字占位常驻：封面未加载/加载失败时显示，加载完成后被封面淡入盖住
        const monogram = document.createElement('span');
        monogram.className = 'city-wall-card-monogram';
        monogram.textContent = card.name ? card.name.charAt(0) : '?';
        media.appendChild(monogram);
        if (card.cover) {
            const cover = document.createElement('img');
            cover.className = 'city-wall-card-cover';
            cover.decoding = 'async';
            cover.alt = '';
            cover.dataset.src = card.cover;
            cover.addEventListener('load', () => {
                if (!cover.isConnected) return;   // 卡片墙已关闭时忽略迟到的解码结果
                media.classList.remove('is-loading');
                media.classList.add('is-loaded');
                cityWallCoverFinished();
            });
            cover.addEventListener('error', () => {
                if (!cover.isConnected) return;
                media.classList.remove('is-loading');
                media.classList.add('is-error');
                cityWallCoverFinished();
            });
            media.appendChild(cover);
        }
        // 轮播后续图：不参与首图限量队列，hover 时再按需加载（最多共 3 张）
        if (card.previews.length > 1 && featureEnabled('cityCardHoverCarousel')) {
            card.previews.slice(1).forEach(url => {
                const extra = document.createElement('img');
                extra.className = 'city-wall-card-preview';
                extra.decoding = 'async';
                extra.alt = '';
                extra.setAttribute('aria-hidden', 'true');
                extra.dataset.src = url;
                media.appendChild(extra);
            });
        }
        if (card.tickets) {
            const ticketBadge = document.createElement('span');
            ticketBadge.className = 'city-wall-card-tickets';
            ticketBadge.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-2a2.5 2.5 0 0 0 0-5z"/><path d="M13.5 7v2.8M13.5 14.2V17"/></svg>';
            ticketBadge.appendChild(document.createTextNode(card.tickets + ' 张票根'));
            media.appendChild(ticketBadge);
        }

        const body = document.createElement('span');
        body.className = 'city-wall-card-body';
        const eyebrow = document.createElement('span');
        eyebrow.className = 'city-wall-card-eyebrow';
        eyebrow.textContent = card.province || 'TRAVELED';
        const name = document.createElement('strong');
        name.className = 'city-wall-card-name';
        name.textContent = card.name;
        const meta = document.createElement('span');
        meta.className = 'city-wall-card-meta';
        // 桌面展示「足迹 · 照片」；手机端紧凑卡只留一行，显示足迹数（照片数信息量更低）
        meta.textContent = mobileView
            ? (card.count ? card.count + ' 个足迹' : '暂无足迹')
            : card.count + ' 个足迹 · ' + card.photos + ' 张照片';
        body.append(eyebrow, name, meta);
        if (card.latest) {
            const recent = document.createElement('span');
            recent.className = 'city-wall-card-recent';
            recent.textContent = '最近 ' + deps.formatCityDate(card.latest);
            body.appendChild(recent);
        }

        btn.append(media, body);
        btn.addEventListener('click', (event) => {
            const ci = Number(btn.dataset.cityIndex);
            if (!deps.cityList()[ci]) return;
            // 点在"N 张票根"徽章上 = 只看这座城市的票根；点其它地方 = 打开城市图片墙
            if (event.target.closest('.city-wall-card-tickets')) {
                deps.openTicketGalleryForCity(ci);
                return;
            }
            // 卡片墙保留在下一层，图片墙从上面展开，返回时回到卡片墙并保留滚动位置
            deps.openCityView(ci, null);
        });
        // PC 悬停/键盘聚焦轮播
        btn.addEventListener('mouseenter', () => startCityCardCarousel(btn));
        btn.addEventListener('mouseleave', stopCityCardCarousel);
        btn.addEventListener('focusin', () => startCityCardCarousel(btn));
        btn.addEventListener('focusout', stopCityCardCarousel);
        wrap.appendChild(btn);
        // 明信片入口（独立按钮，避免按钮嵌套）
        if (featureEnabled('enablePostcard')) {
            const postcardBtn = document.createElement('button');
            postcardBtn.type = 'button';
            postcardBtn.className = 'city-wall-card-postcard';
            postcardBtn.textContent = '明信片';
            postcardBtn.setAttribute('aria-label', '为 ' + card.name + ' 生成旅行明信片');
            postcardBtn.addEventListener('click', () => {
                const ci = Number(btn.dataset.cityIndex);
                if (deps.cityList()[ci]) deps.openPostcard(ci, postcardBtn);
            });
            wrap.appendChild(postcardBtn);
        }
        cityWallGrid.appendChild(wrap);
    });
    deps.refreshCityWallFeatureActions();
    startCityWallCoverLoader();
    startCityWallWarmQueue(cityWallGrid);
}

export function openCityWall() {
    if (!cityWall || cityWall.classList.contains('show')) return;
    // 卡片墙背景不透明，暂停地球渲染，避免其满帧率渲染抢走滚动所需资源
    setGlobeRenderLoop(false);
    if (lightbox.classList.contains('show')) deps.closeLightbox(false);
    deps.hidePhotoRing();
    if (deps.markerCard().classList.contains('visible')) deps.hideMarkerCard();
    if (deps.cityCard().classList.contains('visible')) deps.hideCityCard(false);
    if (deps.provinceCardsActive()) deps.closeProvinceCards();
    renderCityWall();
    cityWall.classList.add('show');
    deps.setOverlayHidden(cityWall, false);
    document.body.classList.add('city-wall-open');
    // 与城市图片墙一致：触屏不自动聚焦，避免“返回地球”出现焦点描边
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
        cityWallBack.focus();
    }
}

export function closeCityWall(returnFocus = true) {
    if (!cityWall || !cityWall.classList.contains('show')) return;
    stopCityCardCarousel();
    cityWall.classList.remove('show');
    deps.setOverlayHidden(cityWall, true);
    document.body.classList.remove('city-wall-open');
    // 关掉卡片墙就清掉省份筛选，下次进来看到的是全部城市
    cityWallProvinceFilterName = '';
    renderCityWallProvinceFilter();
    stopCityWallCoverLoader();
    stopCityWallWarmQueue();
    setGlobeRenderLoop(true);
    if (returnFocus) {
        const trigger = cityWallBtn;
        setTimeout(() => {
            if (trigger && trigger.isConnected &&
                getComputedStyle(trigger).visibility !== 'hidden') {
                trigger.focus();
            }
        }, 0);
    }
}

/**
 * 绑定滚动相关监听：滚动时暂停轮播，避免与滚动卡顿叠加。
 * 必须在 setupCityWall 之后调用。
 */
export function initCityWall() {
    document.addEventListener('wheel', () => {
        cityCardCarouselPauseUntil = Date.now() + 350;
    }, { passive: true });
    document.addEventListener('touchmove', () => {
        cityCardCarouselPauseUntil = Date.now() + 350;
    }, { passive: true });
}
