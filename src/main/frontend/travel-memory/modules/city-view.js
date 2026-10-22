/**
 * 城市足迹全屏视图：左侧足迹 Tab 卡片 + 右侧详情 + 手账照片墙。
 *
 * 从城市卡片墙或足迹详情卡进入，全屏不透明，进入时暂停地球渲染。
 * 卡片封面（缩略图队列 / 首字兜底 / 失败重试）也在这个模块里 ——
 * 小城市卡与城市图片墙共用同一套封面渲染，拆开反而要来回传 DOM。
 */

import { openLightbox, closeLightbox, lightbox } from './lightbox.js';
import { ticketImageUrl, openTicketGalleryForCity } from './ticket-gallery.js';
import { cityWall, cityWallBack, setGlobeRenderLoop } from './city-wall.js';
import {
    takeProvinceRestorePending,
    cityCardsEnabled,
    activateAllCityCards,
    activateProvinceCards
} from './province-cards.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints / d.cityList / d.currentPositions  () => 数据 / 状态
 * @param d.markerCard / d.cityCard / d.markerCardGallery / d.viewer  () => HTMLElement
 * @param d.hideCityCard / d.hideMarkerCard / d.hideMarkerTip / d.showMarkerCard
 * @param d.setOverlayHidden           (el, hidden) => void
 */
export function setupCityView(d) {
    deps = d;
}

// ================= 城市足迹全屏视图（左侧足迹 Tab 卡片 + 右侧详情） =================
export const cityView = document.getElementById('cityView');
const cityViewBack = document.getElementById('cityViewBack');
const cityViewBackLabel = document.getElementById('cityViewBackLabel');
const cityViewTitle = document.getElementById('cityViewTitle');
const cityViewCityList = document.getElementById('cityViewCityList');
const cityViewStats = document.getElementById('cityViewStats');
const cityViewTimeline = document.getElementById('cityViewTimeline');
const cityViewTimelineList = document.getElementById('cityViewTimelineList');
const cityViewTimelineToggle = document.getElementById('cityViewTimelineToggle');
const cityViewTimelineCount = document.getElementById('cityViewTimelineCount');
const cityViewMeta = document.getElementById('cityViewMeta');
const cityViewTickets = document.getElementById('cityViewTickets');
const cityViewPrevCity = document.getElementById('cityViewPrevCity');
const cityViewNextCity = document.getElementById('cityViewNextCity');
const cityTabs = document.getElementById('cityTabs');
const cityStage = document.getElementById('cityStage');
let cityStageObserver = null;   // 手账照片墙滚动到底自动加载的观察器
let cityViewCityIndex = -1;      // 当前城市（deps.cityList() 下标）
let cityViewTabIndex = 0;        // 当前选中的足迹 Tab
let cityViewTriggerBtn = null;   // 键盘触发时的返回焦点按钮
let cityViewRestoreCard = null;  // 从足迹卡进入城市图片墙时，关闭后要还原的足迹卡
let cityViewFromWall = false;    // 当前图片墙是否从城市卡片墙展开（返回时回到卡片墙）

function cityViewFootprints() {
    const city = deps.cityList()[cityViewCityIndex];
    return city ? city.indices.map(i => deps.FOOTPRINTS()[i]).filter(Boolean) : [];
}
export function cityWallImages(fp) {
    let gallery = fp && fp.galleryImages;
    if (typeof gallery === 'string') {
        try { gallery = JSON.parse(gallery); } catch (e) { gallery = []; }
    }
    const normalized = Array.isArray(gallery)
        ? gallery.map((item) => typeof item === 'string' ? { url: item, caption: '' } : item).filter(item => item && item.url)
        : [];
    return normalized.length ? normalized : (fp.image ? [{ url: fp.image, caption: '' }] : []);
}

export function formatCityDate(value) {
    const match = String(value || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!match) return String(value || '日期未知');
    return match[1] + ' / ' + String(match[2]).padStart(2, '0') + '.' + String(match[3]).padStart(2, '0');
}

// ================= 卡片封面（小城市卡与城市卡共用） =================
// 三件事：
// 1) 首字常驻做底，图片加载成功后淡入盖上去 —— 加载慢或失败都只是"还没盖上"，
//    不会出现空白，也不会有"先空着再突然出现"的跳动；
// 2) 封面走 new Image() 预加载 + 并发限流（同时 3 张），不和底图瓦片抢带宽；
// 3) 失败延迟重试一次，仍失败就停在首字（小卡片按约定不放重试按钮）。
const CARD_COVER_CONCURRENCY = 3;
const CARD_COVER_RETRY_MS = 3000;          // 第一次失败后的静默重试延迟
const CARD_COVER_FAIL_TTL_MS = 60000;      // 失败结论只记一分钟，过一会儿再点还会重新试
const cardCoverQueue = [];
const cardCoverResult = new Map();         // url -> { ok, at }
const cardCoverRetried = new Set();        // url -> 已经重试过一次
let cardCoverLoading = 0;
let cardCoverSeq = 0;

function cachedCardCover(url) {
    const hit = cardCoverResult.get(url);
    if (!hit) return null;
    if (hit.ok) return hit;
    return (Date.now() - hit.at < CARD_COVER_FAIL_TTL_MS) ? hit : null;
}

function drainCardCoverQueue() {
    while (cardCoverLoading < CARD_COVER_CONCURRENCY && cardCoverQueue.length) {
        const job = cardCoverQueue.shift();
        cardCoverLoading++;
        startCardCoverLoad(job);
    }
}

function startCardCoverLoad(job) {
    const release = () => {
        cardCoverLoading--;
        drainCardCoverQueue();
    };
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
        cardCoverResult.set(job.url, {
            ok: true,
            at: Date.now(),
            width: img.naturalWidth,
            height: img.naturalHeight
        });
        // 顺带回传图片原始尺寸：照片环要按实际宽高比排版（其余调用方忽略这个参数）
        job.done(true, { width: img.naturalWidth, height: img.naturalHeight });
        release();
    };
    img.onerror = () => {
        if (job.retry !== false && !cardCoverRetried.has(job.url)) {
            // 图床偶发 502 很常见：先放掉并发名额，延迟一段时间静默重试一次
            cardCoverRetried.add(job.url);
            release();
            window.setTimeout(() => {
                cardCoverQueue.push(job);
                drainCardCoverQueue();
            }, CARD_COVER_RETRY_MS);
            return;
        }
        cardCoverResult.set(job.url, { ok: false, at: Date.now() });
        job.done(false);
        release();
    };
    img.src = job.url;
}

export function loadCardCoverImage(url, done, options) {
    const opts = options || {};
    const cached = opts.force ? null : cachedCardCover(url);
    if (cached) {
        // 命中缓存直接出结果，不重复请求；把图片原始尺寸一并带出去（照片环要用）。
        // 必须异步回调：调用方有可能在"元素创建之后、插入 DOM 之前"就调用这里
        // （照片环就是这样），同步回调会让它们的 isConnected 守卫把结果丢掉 ——
        // 表现就是"第一次打开图片正常，关掉再点同一个标记，一圈方框全空"。
        Promise.resolve().then(() => {
            done(!!cached.ok, cached.ok ? { width: cached.width, height: cached.height } : undefined);
        });
        return;
    }
    cardCoverQueue.push({ url: url, done: done, retry: opts.retry !== false });
    drainCardCoverQueue();
}

/**
 * 在媒体区里画好"首字 + 空的图片层"，返回一个待排队的加载请求（没有封面时返回 null）。
 *
 * <p>拆成"画结构"和"排队加载"两步，是为了让调用方按自己的顺序（比如展开动画的错峰顺序）
 * 决定谁先加载 —— 先飞出来的卡片先拿到封面。</p>
 */
export function renderCardCover(container, url, monogram) {
    if (!container) return null;
    const token = String(++cardCoverSeq);
    container.dataset.coverToken = token;
    container.innerHTML = '';
    const mono = document.createElement('span');
    mono.className = 'card-cover-monogram';
    mono.textContent = monogram || '?';
    container.appendChild(mono);
    if (!url) return null;   // 没有封面：就停在首字
    const photo = document.createElement('span');
    photo.className = 'card-cover-photo';
    container.appendChild(photo);
    return { url: url, container: container, token: token, photo: photo };
}

export function enqueueCardCover(request) {
    if (!request || !request.photo) return;
    loadCardCoverImage(request.url, (ok) => {
        if (!ok) return;                                        // 失败：保持首字
        if (request.container.dataset.coverToken !== request.token) return;   // 已被新的封面取代
        if (!request.container.isConnected) return;             // 卡片已经收起来了
        request.photo.style.backgroundImage = 'url("' + request.url + '")';
        request.photo.classList.add('is-loaded');
    });
}

// 一步到位版：画结构 + 立刻排队（城市卡这种单张卡片用）
export function showCardCover(container, url, monogram) {
    enqueueCardCover(renderCardCover(container, url, monogram));
}

// 灯箱下方的时间日期：YYYY-MM-DD HH:MM（无时间部分时只显示日期）
export function formatLightboxDate(value) {
    const match = String(value || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (!match) return String(value || '日期未知');
    const date = match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
    return match[4] ? date + ' ' + String(match[4]).padStart(2, '0') + ':' + match[5] : date;
}

function cleanupCityStageAutoLoad() {
    if (cityStageObserver) {
        cityStageObserver.disconnect();
        cityStageObserver = null;
    }
}

function renderCityStage(fp, photoLimit = 8, preserveScroll = false) {
    cleanupCityStageAutoLoad();
    const imgs = cityWallImages(fp);
    const prevScrollTop = preserveScroll ? cityStage.scrollTop : 0;
    const content = document.createElement('div');
    content.className = 'city-stage-content';
    content.style.setProperty('--extra-height', Math.max(0, Math.ceil((imgs.length - 4) / 4)) * 188 + 'px');

    const hero = document.createElement('button');
    hero.type = 'button';
    hero.className = 'city-fp-hero';
    hero.setAttribute('aria-label', fp.name + ' · 查看第 1 张照片');
    if (imgs[0]) hero.style.backgroundImage = 'url("' + imgs[0].url + '")';
    const heroBody = document.createElement('div');
    heroBody.className = 'city-fp-hero-body';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'city-fp-eyebrow';
    eyebrow.textContent = 'Footprint · ' + (fp.footprintType || '旅行');
    const name = document.createElement('h3');
    name.className = 'city-fp-name';
    name.textContent = fp.name;
    const meta = document.createElement('p');
    meta.className = 'city-fp-meta';
    meta.textContent = [fp.city, fp.createTime, fp.address].filter(Boolean).join(' · ');
    heroBody.append(eyebrow, name, meta);
    hero.appendChild(heroBody);
    if (imgs[0]) {
        hero.addEventListener('click', () => openLightbox(fp, 0, hero));
        hero.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openLightbox(fp, 0, hero);
            }
        });
    }
    content.appendChild(hero);

    if (fp.description) {
        const desc = document.createElement('p');
        desc.className = 'city-fp-desc';
        desc.textContent = fp.description;
        content.appendChild(desc);
    }

    const wall = document.createElement('div');
    wall.className = 'city-fp-wall';
    if (imgs.length) {
        imgs.forEach((img, idx) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'city-wall-tile';
            if (idx >= 4) {
                const extraIndex = idx - 4;
                const extraColumn = extraIndex % 4;
                const extraRow = Math.floor(extraIndex / 4);
                tile.classList.add('city-wall-tile-extra');
                tile.style.setProperty('--extra-left', (8 + extraColumn * 23) + '%');
                tile.style.setProperty('--extra-top', (650 + extraRow * 188) + 'px');
            }
            tile.setAttribute('aria-label', fp.name + ' · 第 ' + (idx + 1) + ' 张');
            const photo = document.createElement('img');
            photo.loading = 'lazy';
            photo.src = img.url;
            photo.alt = img.caption || fp.name;
            tile.appendChild(photo);
            tile.addEventListener('click', () => openLightbox(fp, idx, tile));
            wall.appendChild(tile);
        });
        if (imgs.length > 5) {
            const overflowNote = document.createElement('span');
            overflowNote.className = 'city-wall-overflow-note';
            overflowNote.textContent = '共 ' + imgs.length + ' 张照片 · 主图与卡片均可点击放大';
            wall.appendChild(overflowNote);
        }
    } else {
        const empty = document.createElement('div');
        empty.className = 'city-wall-empty';
        empty.textContent = '暂无照片';
        wall.appendChild(empty);
    }
    content.appendChild(wall);

    const mapWall = document.createElement('div');
    mapWall.className = 'city-map-wall';
    const mapCanvas = document.createElement('div');
    mapCanvas.className = 'city-map-canvas';
    const mapRoute = document.createElement('span');
    mapRoute.className = 'city-map-route';
    const mapCore = document.createElement('div');
    mapCore.className = 'city-map-core';
    const mapCoreKicker = document.createElement('span');
    mapCoreKicker.className = 'city-map-core-kicker';
    mapCoreKicker.textContent = 'LOCATION MAP';
    const mapCoreTitle = document.createElement('strong');
    mapCoreTitle.textContent = fp.city || fp.name;
    const mapCoreMeta = document.createElement('small');
    mapCoreMeta.textContent = [fp.lat && fp.lat.toFixed ? fp.lat.toFixed(4) : '', fp.lng && fp.lng.toFixed ? fp.lng.toFixed(4) : ''].filter(Boolean).join('  /  ');
    mapCore.append(mapCoreKicker, mapCoreTitle, mapCoreMeta);
    mapCanvas.append(mapRoute, mapCore);
    const orbitSlots = [
        [4, 10], [25, 4], [61, 4], [83, 10],
        [4, 54], [25, 68], [61, 68], [83, 54]
    ];
    const extraCount = Math.max(0, imgs.length - orbitSlots.length);
    const extraRows = Math.ceil(extraCount / 5);
    mapCanvas.style.height = (900 + extraRows * 190) + 'px';
    imgs.forEach((img, idx) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'city-map-photo';
        const slot = orbitSlots[idx];
        if (slot) {
            card.style.left = slot[0] + '%';
            card.style.top = slot[1] + '%';
        } else {
            const extraIndex = idx - orbitSlots.length;
            card.style.left = (4 + (extraIndex % 5) * 21) + '%';
            card.style.top = (900 + Math.floor(extraIndex / 5) * 190) + 'px';
            card.classList.add('city-map-photo-extra');
        }
        const cardX = slot ? slot[0] : 4 + ((idx - orbitSlots.length) % 5) * 21;
        const cardY = slot ? slot[1] : 900;
        card.style.setProperty('--line-angle', Math.atan2(50 - cardY, 50 - cardX) * 180 / Math.PI + 'deg');
        card.setAttribute('aria-label', fp.name + ' · 地图照片 ' + (idx + 1));
        const connector = document.createElement('span');
        connector.className = 'city-map-connector';
        const pin = document.createElement('span');
        pin.className = 'city-map-pin';
        const photo = document.createElement('img');
        photo.loading = 'lazy';
        photo.src = img.url;
        photo.alt = img.caption || fp.name;
        card.append(connector, pin, photo);
        card.addEventListener('click', () => openLightbox(fp, idx, card));
        mapCanvas.appendChild(card);
    });
    mapWall.appendChild(mapCanvas);
    content.appendChild(mapWall);

    const journal = document.createElement('section');
    journal.className = 'city-journal-wall';
    const journalHead = document.createElement('header');
    journalHead.className = 'city-journal-head';
    const journalKicker = document.createElement('span');
    journalKicker.className = 'city-journal-kicker';
    journalKicker.textContent = 'TRAVEL JOURNAL';
    const journalTitle = document.createElement('h3');
    journalTitle.textContent = fp.name;
    const journalDate = document.createElement('time');
    journalDate.textContent = formatCityDate(fp.createTime);
    const journalCount = document.createElement('span');
    journalCount.className = 'city-journal-count';
    journalCount.textContent = imgs.length + ' 张照片';
    journalHead.append(journalKicker, journalTitle, journalDate, journalCount);
    journal.appendChild(journalHead);

    if (fp.description) {
        const journalDesc = document.createElement('p');
        journalDesc.className = 'city-journal-description';
        journalDesc.textContent = fp.description;
        journal.appendChild(journalDesc);
    }

    const journalGrid = document.createElement('div');
    journalGrid.className = 'city-journal-grid';
    const visibleImages = imgs.slice(0, Math.max(1, photoLimit));
    visibleImages.forEach((img, idx) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'city-journal-card';
        card.classList.add('is-loading');
        card.setAttribute('aria-label', fp.name + ' · 第 ' + (idx + 1) + ' 张');
        const photo = document.createElement('img');
        photo.loading = idx < 4 ? 'eager' : 'lazy';
        photo.src = img.url;
        photo.alt = img.caption || fp.name;
        card.appendChild(photo);
        photo.addEventListener('load', () => {
            card.classList.remove('is-loading', 'is-error');
        });
        photo.addEventListener('error', () => {
            card.classList.remove('is-loading');
            card.classList.add('is-error');
        });
        if (photo.complete) {
            if (photo.naturalWidth > 0) {
                card.classList.remove('is-loading');
            } else {
                card.classList.remove('is-loading');
                card.classList.add('is-error');
            }
        }
        if (img.caption) {
            const caption = document.createElement('span');
            caption.className = 'city-journal-caption';
            caption.textContent = img.caption;
            card.appendChild(caption);
        }
        card.addEventListener('click', () => openLightbox(fp, idx, card));
        journalGrid.appendChild(card);
    });
    if (!imgs.length) {
        const empty = document.createElement('div');
        empty.className = 'city-journal-empty';
        empty.textContent = '暂无照片';
        journalGrid.appendChild(empty);
    }
    journal.appendChild(journalGrid);

    if (imgs.length > visibleImages.length) {
        // 滚动到此处附近时自动加载下一批，不再需要手动点击
        const sentinel = document.createElement('div');
        sentinel.className = 'city-journal-more city-journal-more-auto';
        sentinel.setAttribute('role', 'status');
        sentinel.textContent = '已加载 ' + visibleImages.length + ' / ' + imgs.length + ' 张 · 继续向下自动加载';
        journal.appendChild(sentinel);
    }
    content.appendChild(journal);

    cityStage.innerHTML = '';
    cityStage.appendChild(content);
    cityStage.scrollTop = preserveScroll ? prevScrollTop : 0;

    // 观察加载哨兵：靠近底部时再渲染下一批。
    // 延迟到下一帧再开始观察，避免刚设置 scrollTop=0 时误判为已到达底部。
    if (imgs.length > visibleImages.length && 'IntersectionObserver' in window) {
        const nextLimit = Math.min(visibleImages.length + 8, imgs.length);
        requestAnimationFrame(() => {
            const sentinel = cityStage.querySelector('.city-journal-more-auto');
            if (!sentinel || !sentinel.isConnected) return;
            cityStageObserver = new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    cleanupCityStageAutoLoad();
                    renderCityStage(fp, nextLimit, true);
                }
            }, {
                root: cityStage,
                rootMargin: '0px 0px 180px 0px',
                threshold: 0.01
            });
            cityStageObserver.observe(sentinel);
        });
    }
}

export function selectCityViewTab(i) {
    const fps = cityViewFootprints();
    if (!fps.length) return;
    cityViewTabIndex = Math.max(0, Math.min(i, fps.length - 1));
    [...cityTabs.querySelectorAll('.city-tab')].forEach((t, k) => {
        const active = k === cityViewTabIndex;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
    });
    // 时间线跟着高亮当前那一站
    if (cityViewTimelineList) {
        cityViewTimelineList.querySelectorAll('.city-view-timeline-item').forEach(el => {
            el.classList.toggle('is-active', el.dataset.tabIndex === String(cityViewTabIndex));
        });
    }
    renderCityStage(fps[cityViewTabIndex]);
}

// 到访时间线：把"第几次来、隔了多久"讲清楚。
// 只有一次到访也显示（就一条"第 1 次"），否则用户会以为这个功能没生效
// 「到访」和「看这座城市的票根」都不显示时，整条操作行收起来，别在标题下留一条空行
function syncCityViewMeta() {
    if (!cityViewMeta) return;
    const hasTimeline = cityViewTimeline && !cityViewTimeline.hidden;
    const hasTickets = cityViewTickets && !cityViewTickets.hidden;
    cityViewMeta.hidden = !hasTimeline && !hasTickets;
}

// 手机端到访折成一颗胶囊，点开才展开那一排；桌面端这颗按钮由 CSS 隐藏
function setCityViewTimelineExpanded(expanded) {
    if (!cityViewTimeline) return;
    cityViewTimeline.classList.toggle('is-expanded', !!expanded);
    if (!cityViewTimelineToggle) return;
    const count = cityViewTimelineList ? cityViewTimelineList.children.length : 0;
    cityViewTimelineToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    cityViewTimelineToggle.setAttribute('aria-label',
        (expanded ? '收起到访记录' : '展开到访记录') + '，共 ' + count + ' 次');
}

function renderCityViewTimeline(fps) {
    if (!cityViewTimeline || !cityViewTimelineList) return;
    cityViewTimelineList.innerHTML = '';
    const visits = fps
        .map((fp, i) => ({ fp, i, time: String(fp.createTime || '') }))
        .filter(visit => visit.time)
        .sort((a, b) => a.time.localeCompare(b.time));
    if (!visits.length) {
        cityViewTimeline.hidden = true;
        setCityViewTimelineExpanded(false);
        syncCityViewMeta();
        return;
    }
    visits.forEach((visit, n) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'city-view-timeline-item' + (visit.i === cityViewTabIndex ? ' is-active' : '');
        btn.dataset.tabIndex = String(visit.i);
        const order = document.createElement('b');
        order.textContent = '第 ' + (n + 1) + ' 次';
        const date = document.createElement('span');
        date.textContent = visit.time.slice(0, 10).replace(/-/g, '.');
        btn.append(order, date);
        if (n > 0) {
            const days = Math.round(
                (new Date(visit.time).getTime() - new Date(visits[n - 1].time).getTime()) / 86400000
            );
            if (days >= 0) {
                const gap = document.createElement('em');
                gap.textContent = '隔 ' + days.toLocaleString('zh-CN') + ' 天';
                btn.appendChild(gap);
            }
        }
        btn.setAttribute('aria-label',
            '第 ' + (n + 1) + ' 次到访 ' + visit.fp.name + '，' + date.textContent);
        btn.addEventListener('click', () => selectCityViewTab(visit.i));
        li.appendChild(btn);
        cityViewTimelineList.appendChild(li);
    });
    cityViewTimeline.hidden = false;
    if (cityViewTimelineCount) cityViewTimelineCount.textContent = String(visits.length);
    // 换城市时收起，避免上一个城市的展开状态残留
    setCityViewTimelineExpanded(false);
    syncCityViewMeta();
}

function renderCityView() {
    const fps = cityViewFootprints();
    cityTabs.innerHTML = '';
    cityStage.innerHTML = '';
    if (cityViewTimeline) cityViewTimeline.hidden = true;
    if (cityViewTimelineList) cityViewTimelineList.innerHTML = '';
    if (cityViewTickets) cityViewTickets.hidden = true;
    syncCityViewMeta();
    if (!fps.length) return;
    const city = deps.cityList()[cityViewCityIndex];
    const photoCount = fps.reduce((n, fp) => n + cityWallImages(fp).length, 0);
    cityViewTitle.textContent = city.city;
    cityViewStats.textContent = fps.length + ' 个足迹 · ' + photoCount + ' 张照片';
    // 这座城市有票根时，给一个键盘也能到达的入口（卡片上的徽章只能鼠标点）
    if (cityViewTickets) {
        const ticketCount = fps.reduce((n, fp) => n + (ticketImageUrl(fp.ticketImage) ? 1 : 0), 0);
        cityViewTickets.hidden = !ticketCount;
        cityViewTickets.textContent = ticketCount
            ? '看这座城市的 ' + ticketCount + ' 张票根'
            : '看这座城市的票根';
    }
    renderCityViewTimeline(fps);

    fps.forEach((fp, i) => {
        const imgs = cityWallImages(fp);
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'city-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('aria-label', fp.name + '，' + (imgs.length || 0) + ' 张照片');
        const order = document.createElement('span');
        order.className = 'city-tab-index';
        order.textContent = String(i + 1).padStart(2, '0');
        const thumbWrap = document.createElement('span');
        thumbWrap.className = 'city-tab-thumb';
        if (imgs[0]) {
            thumbWrap.classList.add('is-loading');
            const th = document.createElement('img');
            th.loading = 'lazy';
            th.src = imgs[0].url;
            th.alt = '';
            thumbWrap.appendChild(th);
            th.addEventListener('load', () => {
                thumbWrap.classList.remove('is-loading', 'is-error');
            });
            th.addEventListener('error', () => {
                thumbWrap.classList.remove('is-loading');
                thumbWrap.classList.add('is-error');
            });
            if (th.complete) {
                if (th.naturalWidth > 0) {
                    thumbWrap.classList.remove('is-loading');
                } else {
                    thumbWrap.classList.remove('is-loading');
                    thumbWrap.classList.add('is-error');
                }
            }
        } else {
            thumbWrap.classList.add('is-empty');
        }
        const info = document.createElement('span');
        info.className = 'city-tab-info';
        const tName = document.createElement('span');
        tName.className = 'city-tab-name';
        tName.textContent = fp.name;
        const tMeta = document.createElement('span');
        tMeta.className = 'city-tab-meta';
        const tDate = document.createElement('span');
        tDate.className = 'city-tab-date';
        tDate.textContent = formatCityDate(fp.createTime);
        const tPhotos = document.createElement('span');
        tPhotos.className = 'city-tab-photos';
        tPhotos.textContent = imgs.length ? imgs.length + ' 张照片' : '暂无照片';
        tMeta.append(tDate, tPhotos);
        info.append(tName, tMeta);
        tab.append(order, thumbWrap, info);
        tab.addEventListener('click', () => selectCityViewTab(i));
        cityTabs.appendChild(tab);
    });
    cityViewTabIndex = Math.min(cityViewTabIndex, fps.length - 1);
    selectCityViewTab(cityViewTabIndex);
}

function switchCityViewCity(delta) {
    if (deps.cityList().length < 2) return;
    cityViewCityIndex = (cityViewCityIndex + delta + deps.cityList().length) % deps.cityList().length;
    cityViewTabIndex = 0;
    renderCityView();
}

// —— 顶部城市列表（下拉选择器）——
function cityListMeta(ci) {
    const city = deps.cityList()[ci];
    if (!city) return { count: 0, photos: 0 };
    const photos = city.indices.reduce(
        (n, fi) => n + cityWallImages(deps.FOOTPRINTS()[fi]).length, 0
    );
    return { count: city.indices.length, photos };
}

function goToCityViewCity(ci) {
    if (!deps.cityList()[ci] || ci === cityViewCityIndex) return;
    cityViewCityIndex = ci;
    cityViewTabIndex = 0;
    renderCityView();
}

function renderCitySwitcher() {
    if (!cityViewCityList) return;
    cityViewCityList.innerHTML = '';
    deps.cityList().forEach((city, ci) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'city-view-city-option' + (ci === cityViewCityIndex ? ' is-current' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', String(ci === cityViewCityIndex));
        const meta = cityListMeta(ci);
        const nameEl = document.createElement('span');
        nameEl.className = 'city-view-city-option-name';
        nameEl.textContent = city.city;
        const countEl = document.createElement('span');
        countEl.className = 'city-view-city-option-count';
        countEl.textContent = meta.count + ' 个足迹 · ' + meta.photos + ' 张照片';
        btn.append(nameEl, countEl);
        btn.addEventListener('click', () => {
            goToCityViewCity(ci);
            closeCitySwitcher();
        });
        cityViewCityList.appendChild(btn);
    });
}

function openCitySwitcher() {
    if (!cityViewCityList) return;
    renderCitySwitcher();
    cityViewCityList.hidden = false;
    cityViewTitle.setAttribute('aria-expanded', 'true');
    const current = cityViewCityList.querySelector('.is-current') || cityViewCityList.firstElementChild;
    if (current) current.focus();
}

function closeCitySwitcher(returnFocus = false) {
    if (!cityViewCityList || cityViewCityList.hidden) return;
    cityViewCityList.hidden = true;
    cityViewTitle.setAttribute('aria-expanded', 'false');
    if (returnFocus) cityViewTitle.focus();
}

function toggleCitySwitcher() {
    if (cityViewCityList && cityViewCityList.hidden) openCitySwitcher();
    else closeCitySwitcher(true);
}

// 关闭全屏视图，飞到该足迹在地球上的位置（不打开详情卡）
function flyToCityFootprint(fp) {
    const idx = deps.FOOTPRINTS().indexOf(fp);
    closeCityView(false);
    if (idx < 0) return;
    const pos = deps.currentPositions()[idx];
    if (pos) {
        const height = fp.zoomLevel
            ? (156543.03392 * Math.cos(Cesium.Math.toRadians(pos.lat))) / Math.pow(2, fp.zoomLevel) * 1000
            : 120000;
        deps.viewer().camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, height),
            duration: 2.2
        });
    }
}

export function openCityView(ci, triggerBtn) {
    if (!deps.cityList()[ci]) return;
    // 两级浏览：从卡片墙进入时保持卡片墙在下一层，返回按钮文案切换为“返回城市墙”
    const fromWall = !!(cityWall && cityWall.classList.contains('show'));
    cityViewFromWall = fromWall;
    if (fromWall) {
        if (cityViewBackLabel) cityViewBackLabel.textContent = '返回城市墙';
        cityViewBack.setAttribute('aria-label', '返回城市墙');
    } else {
        if (cityViewBackLabel) cityViewBackLabel.textContent = '返回地球';
        cityViewBack.setAttribute('aria-label', '返回地球');
    }
    // 城市图片墙为不透明全屏层，先暂停地球渲染循环，释放主线程/合成带宽
    setGlobeRenderLoop(false);
    if (deps.markerCard().classList.contains('visible')) deps.hideMarkerCard();
    if (deps.cityCard().classList.contains('visible')) deps.hideCityCard(false);
    deps.hideMarkerTip();
    cityViewCityIndex = ci;
    cityViewTabIndex = 0;
    cityViewTriggerBtn = triggerBtn || null;
    renderCityView();
    cityView.classList.add('show');
    deps.setOverlayHidden(cityView, false);
    // 城市图片墙打开时直接隐藏顶部导航，不依赖相机事件（渲染循环暂停时相机事件不会触发）
    document.body.classList.add('city-view-open');
    // 触屏不自动回焦，避免“返回地球”出现焦点描边；
    // 注意 .show 刚加上时整层还是 visibility: hidden（离散过渡约在 130ms 后才翻转），
    // 此时直接 focus() 会被浏览器忽略，键盘用户会停在原来的按钮上，所以要等它真的可见
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
        focusCityViewBackWhenVisible();
    }
}

let cityViewFocusRaf = 0;
function focusCityViewBackWhenVisible() {
    cancelAnimationFrame(cityViewFocusRaf);
    const tick = () => {
        if (!cityView.classList.contains('show')) return;   // 已经关掉就别再抢焦点
        if (getComputedStyle(cityViewBack).visibility === 'hidden') {
            cityViewFocusRaf = requestAnimationFrame(tick);
            return;
        }
        cityViewBack.focus();
    };
    cityViewFocusRaf = requestAnimationFrame(tick);
}

export function closeCityView(returnFocus = true) {
    cancelAnimationFrame(cityViewFocusRaf);
    const fromWall = cityViewFromWall;
    cityViewFromWall = false;
    if (lightbox.classList.contains('show')) closeLightbox(false);
    cityView.classList.remove('show');
    deps.setOverlayHidden(cityView, true);
    document.body.classList.remove('city-view-open');
    // 回到卡片墙时地球仍暂停；只有真正回到地球才恢复渲染
    if (!fromWall || !(cityWall && cityWall.classList.contains('show'))) {
        setGlobeRenderLoop(true);
    }
    closeCitySwitcher();
    const restore = cityViewRestoreCard;
    cityViewRestoreCard = null;
    // 省份城市卡片：从卡片进相册前记录过，回到地球后原样重建（相机没动，不需要额外状态）
    const provinceRestore = takeProvinceRestorePending();
    if (provinceRestore && !fromWall && cityCardsEnabled()) {
        if (provinceRestore.mode === 'all') activateAllCityCards();
        else activateProvinceCards(provinceRestore.adcode);
    }
    if (returnFocus) {
        if (fromWall && cityWall && cityWall.classList.contains('show')) {
            // 等图片墙淡出后把焦点还给卡片墙的返回按钮
            setTimeout(() => {
                if (cityWallBack && cityWallBack.isConnected &&
                    cityWall.classList.contains('show')) {
                    cityWallBack.focus();
                }
            }, 280);
            return;
        }
        if (restore) {
            const fp = deps.FOOTPRINTS()[restore.fpIndex];
            if (fp) {
                deps.showMarkerCard(fp, restore.fpIndex);
                const target = restore.trigger && restore.trigger.isConnected
                    ? restore.trigger
                    : deps.markerCardGallery();
                if (target) {
                    // 等卡片可见过渡结束后再回焦，避免焦点落在仍不可见的容器里
                    setTimeout(() => { if (target.isConnected) target.focus(); }, 480);
                }
            }
        } else if (cityViewTriggerBtn) {
            cityViewTriggerBtn.focus();
            cityViewTriggerBtn = null;
        }
    }
}

/**
 * 从足迹详情卡进入城市图片墙，并自动选中该足迹对应的 Tab。
 *
 * 主文件原先自己写了一遍「找城市 → 找 tab → 记还原卡」，与这里的
 * openCityView + selectCityViewTab 是同一套状态，交给本模块统一处理。
 */
export function openCityViewAtFootprint(fp, triggerEl) {
    if (!fp) return;
    const fpIndex = deps.FOOTPRINTS().indexOf(fp);
    if (fpIndex < 0) return;
    const cities = deps.cityList();
    const cityIndex = cities.findIndex(city => city.indices.includes(fpIndex));
    if (cityIndex < 0) return;
    const tabIndex = cities[cityIndex].indices.indexOf(fpIndex);
    if (tabIndex < 0) return;

    cityViewRestoreCard = { fpIndex, trigger: triggerEl || null };
    openCityView(cityIndex, null);
    cityViewTabIndex = tabIndex;
    selectCityViewTab(tabIndex);
}



/**
 * 绑定图片墙的返回、切换城市、时间线折叠与键盘交互。必须在 setupCityView 之后调用。
 */
export function initCityView() {
    cityViewBack.addEventListener('click', () => closeCityView());
    if (cityViewTimelineToggle) {
        cityViewTimelineToggle.addEventListener('click', () => {
            setCityViewTimelineExpanded(!cityViewTimeline.classList.contains('is-expanded'));
        });
    }
    cityViewTickets.addEventListener('click', () => {
        if (cityViewCityIndex >= 0) openTicketGalleryForCity(cityViewCityIndex);
    });
    cityViewPrevCity.addEventListener('click', () => switchCityViewCity(-1));
    cityViewNextCity.addEventListener('click', () => switchCityViewCity(1));
    cityView.addEventListener('click', (e) => {
        if (e.target === cityView) closeCityView();
    });
    // 城市名可点击：展开城市下拉列表
    cityViewTitle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCitySwitcher();
    });
    cityViewCityList.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
        if (cityView.classList.contains('show') &&
            cityViewCityList && !cityViewCityList.hidden &&
            !e.target.closest('.city-view-head')) {
            closeCitySwitcher();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (cityViewCityList && !cityViewCityList.hidden && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeCitySwitcher(true);
        }
    }, true);
    // Tab 列表内用 ↑ / ↓ 切换足迹
    cityTabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const fps = cityViewFootprints();
        if (fps.length < 2) return;
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        selectCityViewTab((cityViewTabIndex + d + fps.length) % fps.length);
        const tabs = [...cityTabs.querySelectorAll('.city-tab')];
        if (tabs[cityViewTabIndex]) tabs[cityViewTabIndex].focus();
    });

}
