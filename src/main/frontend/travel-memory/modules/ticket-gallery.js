/**
 * 票根册的入口：票根页的开关（setTicketView）、票夹 / 重走模式切换、
 * 「查看这张票」回到票夹定位，以及全部交互的绑定（initTicketGallery）。
 *
 * 票夹 / 重走 / 护照 / 抽票 / 明信片的实现分在同目录的 ticket-*.js：
 *   ticket-dom.js            DOM 节点
 *   ticket-format.js         纯格式化（图片地址、日期、元信息）
 *   ticket-state.js          共享状态（票根列表、当前下标、视图模式、城市筛选）
 *   ticket-wallet.js         票夹与横向长串
 *   ticket-replay.js         重走一遍
 *   ticket-passport.js       护照集章记录 + 时间有色
 *   ticket-passport-book.js  护照浮层
 *   ticket-oracle.js         命运抽票
 *   ticket-letter.js         未寄出的明信片
 * 主文件（index.js）以及其它模块只和本文件打交道，对外接口与拆分前相同。
 *
 * 依赖注入：主文件里的足迹数据、相机、卡片显隐等通过 setupTicketGallery 注入，
 * 全部用取值函数而不是快照 —— FOOTPRINTS / cityList 刷新时会整体重建。
 * 子模块需要的键由 setupTicketGallery 挑出来转发过去（见 setupTicketGallery）。
 *
 * 两段式：
 *   - 模块顶层只做 DOM 查询与状态声明（脚本是 defer 的，此时 DOM 已就绪）；
 *   - init 之前不做任何事件绑定与渲染，避免依赖注入还没到就开始跑。
 */

import {
    ticketCityFilterChip,
    ticketGallery,
    ticketGalleryBack,
    ticketGalleryBtn,
    ticketGalleryEmpty,
    ticketGalleryStats,
    ticketLetter,
    ticketLetterBack,
    ticketLetterBtn,
    ticketLetterDownload,
    ticketLetterRetry,
    ticketLetterShare,
    ticketLightbox,
    ticketModeArchiveBtn,
    ticketModeReplayBtn,
    ticketOracle,
    ticketOracleAgain,
    ticketOracleBack,
    ticketOracleBtn,
    ticketOracleClose,
    ticketOracleView,
    ticketPassport,
    ticketPassportBack,
    ticketPassportBtn,
    ticketPassportReset,
    ticketReplayAgain,
    ticketReplayCard,
    ticketReplayCloseEnd,
    ticketReplayExit,
    ticketReplayNext,
    ticketReplayOpen,
    ticketReplayPlay,
    ticketReplayPrev,
    ticketReplaySpeed,
    ticketReplayView,
    ticketStrip,
    ticketStripHint,
    ticketWallet
} from './ticket-dom.js';
import { ticketDate } from './ticket-format.js';
import {
    getTicketIndex,
    getTicketItems,
    getTicketViewMode,
    resetTicketCityFilter,
    setTicketCityFilter,
    setTicketIndex,
    setTicketItems,
    setTicketViewModeState,
    setupTicketState,
    ticketItemsFromFootprints
} from './ticket-state.js';
import {
    applyTicketSeason,
    clearTicketStampTimer,
    loadTicketPassport,
    persistTicketPassport,
    resetTicketSeason,
    setTicketPassportRecords,
    startTicketStampDwell,
    updateTicketPassportButton,
    updateTicketStampBadge
} from './ticket-passport.js';
import {
    closeTicketPassport,
    openTicketPassport,
    renderTicketPassport,
    setupTicketPassportBook
} from './ticket-passport-book.js';
import {
    canEnterTicketReplay,
    clearTicketReplay,
    enterTicketReplay,
    getTicketReplayIndex,
    getTicketReplayPoints,
    isTicketReplayPlaying,
    pauseTicketReplay,
    resumeTicketReplay,
    setTicketReplayPausedByOverlay,
    setTicketReplayResumeIndex,
    setupTicketReplay,
    startTicketReplay,
    stepTicketReplay,
    ticketReplaySetZoom,
    toggleTicketReplaySpeed,
    toggleTicketReplayZoom,
    updateTicketModeButtons
} from './ticket-replay.js';
import {
    buildTicketWallet,
    centerStripItem,
    ensureTicketCityFilterCleared,
    initTicketWallet,
    isTicketStripMode,
    positionStripArchive,
    renderTicketWallet,
    setTicketStripMode,
    setWalletItems,
    switchTicket,
    updateTicketFeatureButtons
} from './ticket-wallet.js';
import {
    closeTicketOracle,
    getTicketOracleCandidate,
    openTicketOracle,
    setupTicketOracle,
    ticketOracleShuffle
} from './ticket-oracle.js';
import {
    closeTicketLetter,
    downloadTicketLetter,
    openTicketLetter,
    renderTicketLetter,
    setupTicketLetter,
    shareTicketLetter
} from './ticket-letter.js';

// 对外接口：拆分前都由本文件导出，其它模块仍从这里 import
export { ticketImageUrl, ticketDate } from './ticket-format.js';
export { ticketItemsFromFootprints } from './ticket-state.js';
export { wrapTicketLetterText } from './ticket-letter.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints                   () => Footprint[]
 * @param d.cityList                     () => [{key, ...}]
 * @param d.cityKeyOf                    (fp) => string
 * @param d.viewer                       () => Cesium.Viewer
 * @param d.reduceMotion                 () => boolean
 * @param d.footprintCfg                 () => object     后台配置（window.FOOTPRINT_CONFIG）
 * @param d.markerCard / d.cityCard / d.cityView / d.cityWall  () => HTMLElement
 * @param d.provinceCardsActive          () => boolean
 * @param d.clearProvinceRestorePending  () => void
 * @param d.hideMarkerCard / d.hideCityCard / d.closeProvinceCards / d.forceGlobeForTickets
 * @param d.openCityView / d.openCityWall
 * @param d.pauseAutoRotate / d.resumeAutoRotate / d.restoreGlobeViewForAutoRotate
 * @param d.setGlobeRenderLoop / d.setOverlayHidden
 * @param d.loadPostcardImage / d.postcardToBlob
 */
export function setupTicketGallery(d) {
    deps = d;
    // 子模块只拿各自用到的键（同一批取值函数，不做快照）
    setupTicketState({
        footprints: d.footprints,
        cityKeyOf: d.cityKeyOf,
        footprintCfg: d.footprintCfg
    });
    setupTicketPassportBook({
        setOverlayHidden: d.setOverlayHidden
    });
    setupTicketReplay({
        footprints: d.footprints,
        cityKeyOf: d.cityKeyOf,
        viewer: d.viewer,
        reduceMotion: d.reduceMotion,
        pauseAutoRotate: d.pauseAutoRotate,
        resumeAutoRotate: d.resumeAutoRotate
    });
    setupTicketOracle({
        footprints: d.footprints,
        cityKeyOf: d.cityKeyOf,
        setOverlayHidden: d.setOverlayHidden
    });
    setupTicketLetter({
        loadPostcardImage: d.loadPostcardImage,
        postcardToBlob: d.postcardToBlob,
        setOverlayHidden: d.setOverlayHidden
    });
}

let ticketTrigger = null;

// 票根页是透明背景、刻意透出背后的 3D 地球；而卡片墙 / 城市图片墙是不透明浮层。
// 从它们上面打开票根页时如果不把这层收起来，背景就会一直是那张卡片墙。
// 这里只做「临时隐藏」：不改它们的 .show、不动滚动位置，关掉票根页时原样放回。
let ticketUnderlayLayers = [];
let ticketUnderlayFocus = null;

function setTicketBackLabel(text) {
    if (!ticketGalleryBack) return;
    ticketGalleryBack.setAttribute('aria-label', text);
    const label = ticketGalleryBack.querySelector('span');
    if (label) label.textContent = text;
}

function hideTicketUnderlay() {
    const layers = [];
    if (deps.cityView() && deps.cityView().classList.contains('show')) layers.push(deps.cityView());
    if (deps.cityWall() && deps.cityWall().classList.contains('show')) layers.push(deps.cityWall());
    if (!layers.length) return;
    ticketUnderlayLayers = layers;
    ticketUnderlayFocus = layers.some(el => el.contains(document.activeElement))
        ? document.activeElement
        : null;
    layers.forEach(el => {
        el.classList.add('is-ticket-underlay');
        deps.setOverlayHidden(el, true);   // 收起期间键盘和读屏都到不了它
    });
    document.body.classList.add('ticket-underlay-hidden');
    // 这两层打开时都会暂停地球渲染（省性能），票根页要透出地球，这里恢复渲染
    deps.setGlobeRenderLoop(true);
    setTicketBackLabel('返回城市卡片');
}

function restoreTicketUnderlay() {
    const layers = ticketUnderlayLayers;
    ticketUnderlayLayers = [];
    if (!layers.length) {
        ticketUnderlayFocus = null;
        return;
    }
    layers.forEach(el => {
        el.classList.remove('is-ticket-underlay');
        deps.setOverlayHidden(el, false);
    });
    document.body.classList.remove('ticket-underlay-hidden');
    // 不透明浮层重新盖住地球，继续暂停渲染（与 openCityWall / openCityView 一致）
    deps.setGlobeRenderLoop(false);
    setTicketBackLabel('返回地球');
}

export function openTicketGalleryForCity(ci) {
    const city = deps.cityList()[ci];
    if (!city || !city.key) return;
    setTicketCityFilter(city.key, city.city);
    setTicketView(true);            // 打开时会按筛选重建 ticketItems
    updateTicketFeatureButtons();
}

function openOracleTicketInArchive() {
    if (!getTicketOracleCandidate()) return;
    const idx = getTicketItems().indexOf(getTicketOracleCandidate());
    closeTicketOracle(false);
    if (idx < 0) return;
    // 抽票浮层里点「查看这张票」：先回到票夹，再定位到这张票
    if (getTicketViewMode() !== 'archive') setTicketViewMode('archive');
    setTicketIndex(idx);
    buildTicketWallet();
    renderTicketWallet();
    if (isTicketStripMode()) {
        requestAnimationFrame(() => {
            centerStripItem(getTicketIndex(), false);
            positionStripArchive();
        });
    }
}

// 重走里点「查看这张票」：回到票夹并定位到当前这一站
function openReplayTicketInArchive() {
    const fp = getTicketReplayPoints()[getTicketReplayIndex()];
    if (!fp) return;
    const idx = getTicketItems().indexOf(fp);
    if (idx < 0) return;
    if (getTicketViewMode() !== 'archive') setTicketViewMode('archive');
    setTicketIndex(idx);
    buildTicketWallet();
    renderTicketWallet();
    if (isTicketStripMode()) {
        requestAnimationFrame(() => {
            centerStripItem(getTicketIndex(), false);
            positionStripArchive();
        });
    }
}

function setTicketViewMode(mode) {
    if (mode === getTicketViewMode()) return;
    ensureTicketCityFilterCleared();
    clearTicketReplay();
    if (mode === 'replay') {
        // 先校验再改状态：不满足条件时保持票夹视图，避免模式卡在 replay
        if (!canEnterTicketReplay()) {
            setTicketViewModeState('archive');
            updateTicketModeButtons();
            return;
        }
        setTicketViewModeState('replay');
        clearTicketStampTimer();
        enterTicketReplay();
    } else {
        setTicketViewModeState('archive');
        clearTicketStampTimer();
        if (getTicketItems()[getTicketIndex()]) {
            applyTicketSeason(getTicketItems()[getTicketIndex()]);
        }
        renderTicketWallet();
        // 退出放映后把横向长串重新居中到入口票根，避免字幕与卷轴错位
        if (isTicketStripMode()) {
            requestAnimationFrame(() => {
                centerStripItem(getTicketIndex(), false);
                positionStripArchive();
            });
        }
        updateTicketModeButtons();
        startTicketStampDwell(getTicketItems()[getTicketIndex()]);
        // 从重走回到票夹：自动旋转开着时同样把视角收回整个地球
        deps.restoreGlobeViewForAutoRotate();
    }
}

// 通过 /footprints?view=tickets 查询参数可直接进入票根页；
// 打开/关闭时同步地址，浏览器前进/后退也能切换。
export function isTicketsView() {
    return new URLSearchParams(window.location.search).get('view') === 'tickets';
}
// 触屏设备上自动聚焦会触发 :focus-visible 描边，让“返回地球”看起来多了一圈边框；
// 因此只在非触屏（键盘/鼠标）环境自动回焦，触屏交给用户自然操作。
function focusTicketGalleryControl() {
    if (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) return;
    // 刷新后直接进入票根页时还没有用户交互（userActivation），
    // 此时自动聚焦会让“返回地球”带出 :focus-visible 描边，因此跳过。
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (ticketGalleryBack) ticketGalleryBack.focus();
}
export function setTicketView(open, targetIndex, startRotation) {
    if (!ticketGallery) return;
    if (open) {
        // 票根页只属于 3D 地球：2D 下进来（直接访问、前进后退等）先切回 3D 再开
        deps.forceGlobeForTickets();
        if (getTicketViewMode() !== 'archive') {
            clearTicketReplay();
            setTicketViewModeState('archive');
        }
        setTicketReplayResumeIndex(-1);   // 重新打开票根页时，重走从头开始
        // 打开票根前自动收起可能开着的足迹详情卡 / 城市聚合卡
        if (deps.markerCard() && deps.markerCard().classList.contains('visible')) deps.hideMarkerCard();
        if (deps.cityCard() && deps.cityCard().classList.contains('visible')) deps.hideCityCard(false);
        if (deps.provinceCardsActive()) deps.closeProvinceCards();
        deps.clearProvinceRestorePending();   // 进票根册是另一条浏览线，不再恢复省份卡片组
        // 卡片墙 / 城市图片墙是不透明浮层：先收起来，票根页才能透出背后的地球
        hideTicketUnderlay();
        setTicketItems(ticketItemsFromFootprints());
        loadTicketPassport();
        updateTicketFeatureButtons();
        ticketGalleryEmpty.hidden = getTicketItems().length > 0;
        const cities = new Set(getTicketItems().map(fp => fp.city).filter(Boolean));
        const latest = getTicketItems().map(fp => ticketDate(fp.ticketDate || fp.createTime)).filter(Boolean)[0] || '';
        ticketGalleryStats.textContent = getTicketItems().length
            ? getTicketItems().length + ' 张票根' + (cities.size ? '，' + cities.size + ' 座城市' : '') + (latest ? '，最近一张 ' + latest : '')
            : '还没有票根';
        ticketGallery.classList.add('show');
        deps.setOverlayHidden(ticketGallery, false);
        document.body.classList.add('ticket-gallery-open');
        // 打开票根页时把地址同步为 ?view=tickets，便于分享/直达
        if (!isTicketsView()) history.pushState({ ticketGallery: true }, '', window.location.pathname + '?view=tickets');
        // 打开票根页：地球作为背景。从足迹卡进入时（startRotation === false）明确要求不自转；
        // 其余入口跟随用户偏好 —— 不再无条件打开，否则用户手动关掉的自转会被这个入口重新打开。
        if (startRotation === false) deps.pauseAutoRotate('ticket-view');
        else deps.resumeAutoRotate('ticket-view');
        if (getTicketItems().length) {
            setTicketIndex(targetIndex == null
                ? 0
                : Math.max(0, Math.min(targetIndex, getTicketItems().length - 1)));
            buildTicketWallet();
            renderTicketWallet();
            if (isTicketStripMode()) {
                requestAnimationFrame(() => {
                    centerStripItem(getTicketIndex(), false);
                    positionStripArchive();
                });
            }
            focusTicketGalleryControl();
        } else {
            resetTicketSeason();
            ticketWallet.hidden = true;
            ticketStrip.hidden = true;
            ticketStripHint.hidden = true;
            document.body.classList.remove('ticket-strip-active');
            focusTicketGalleryControl();
        }
    } else {
        // 关闭票根页时浮层会跟着关闭，这时不要再去恢复放映
        setTicketReplayPausedByOverlay(false);
        deps.resumeAutoRotate('ticket-view');   // 票根页的临时停转到此结束
        if (ticketPassport && ticketPassport.classList.contains('show')) closeTicketPassport(false);
        if (ticketOracle && ticketOracle.classList.contains('show')) closeTicketOracle(false);
        if (ticketLetter && ticketLetter.classList.contains('show')) closeTicketLetter(false);
        if (getTicketViewMode() !== 'archive') {
            clearTicketReplay();
            setTicketViewModeState('archive');
        }
        // 返回地球：自动旋转开着时，把重走留下的近地面视角收回整个地球
        deps.restoreGlobeViewForAutoRotate();
        // 先把焦点移出票根容器，再标记 aria-hidden，避免无障碍警告
        if (ticketGallery.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        const pendingFocus = ticketTrigger || ticketUnderlayFocus ||
            document.getElementById('ticketGalleryBtn');
        clearTicketStampTimer();
        resetTicketSeason();
        resetTicketCityFilter();   // 关掉票根页就清掉城市筛选，下次进来是全部票根
        // 把卡片墙 / 城市图片墙原样放回来（只恢复显隐，滚动位置一直是它自己的）
        restoreTicketUnderlay();
        ticketGallery.classList.remove('show');
        deps.setOverlayHidden(ticketGallery, true);
        document.body.classList.remove('ticket-gallery-open');
        document.body.classList.remove('ticket-strip-active');
        ticketStripHint.hidden = true;
        // 关闭后还原地址，避免刷新又回到票根页
        if (isTicketsView()) history.replaceState({}, '', window.location.pathname);
        if (pendingFocus) {
            // 等导航栏恢复可见后再回焦，避免焦点落在隐藏元素上
            setTimeout(() => {
                if (pendingFocus && pendingFocus.isConnected &&
                    getComputedStyle(pendingFocus).visibility !== 'hidden') {
                    pendingFocus.focus({ preventScroll: true });
                }
            }, 80);
        }
    }
}

function openTicketLightbox(index, trigger) {
    setTicketItems(ticketItemsFromFootprints());
    setTicketIndex(Math.max(0, Math.min(index, getTicketItems().length - 1)));
    ticketTrigger = trigger || null;
    buildTicketWallet();
    renderTicketWallet();
    if (isTicketStripMode()) {
        requestAnimationFrame(() => {
            centerStripItem(getTicketIndex(), false);
            positionStripArchive();
        });
    }
    focusTicketGalleryControl();
}

function closeTicketLightbox(returnFocus = true) {
    if (!ticketLightbox) return;
    // 保留已加载图片供下次复用，避免每次打开票根都重新请求
    setWalletItems([]);
    setTicketView(false);
    if (returnFocus && ticketTrigger) ticketTrigger.focus();
    ticketTrigger = null;
}

/**
 * 绑定票根册的全部交互，并在需要时按 ?view=tickets 直接打开。
 * 必须在 setupTicketGallery 之后调用一次。
 */
export function initTicketGallery() {
    setTicketStripMode(!!((deps.footprintCfg() || {}).ticketGalleryStyle === 'strip'));
    ticketGalleryBtn.addEventListener('click', () => setTicketView(true));
    ticketGalleryBack.addEventListener('click', () => setTicketView(false));
    ticketModeArchiveBtn.addEventListener('click', () => setTicketViewMode('archive'));
    ticketModeReplayBtn.addEventListener('click', () => setTicketViewMode('replay'));
    ticketReplayPrev.addEventListener('click', () => stepTicketReplay(-1));
    ticketReplayNext.addEventListener('click', () => stepTicketReplay(1));
    // 票根本体：点一下停下并放大，再点收起；键盘 Enter / 空格同样可用
    ticketReplayCard.addEventListener('click', toggleTicketReplayZoom);
    ticketReplayCard.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
            ev.preventDefault();
            toggleTicketReplayZoom();
        }
    });
    ticketReplaySpeed.addEventListener('click', toggleTicketReplaySpeed);
    ticketReplayOpen.addEventListener('click', openReplayTicketInArchive);
    // 清除城市筛选：回到全部票根
    ticketCityFilterChip.addEventListener('click', () => {
        resetTicketCityFilter();
        setTicketItems(ticketItemsFromFootprints());
        setTicketIndex(0);
        buildTicketWallet();
        renderTicketWallet();
        updateTicketFeatureButtons();
    });
    ticketReplayPlay.addEventListener('click', () => {
        if (isTicketReplayPlaying()) pauseTicketReplay();
        else resumeTicketReplay();
    });
    ticketReplayExit.addEventListener('click', () => setTicketViewMode('archive'));
    ticketReplayAgain.addEventListener('click', () => startTicketReplay());
    ticketReplayCloseEnd.addEventListener('click', () => setTicketViewMode('archive'));
    ticketPassportBtn.addEventListener('click', openTicketPassport);
    ticketPassportBack.addEventListener('click', () => closeTicketPassport());
    ticketOracleBtn.addEventListener('click', openTicketOracle);
    ticketOracleBack.addEventListener('click', () => closeTicketOracle());
    ticketOracleAgain.addEventListener('click', ticketOracleShuffle);
    ticketOracleClose.addEventListener('click', () => closeTicketOracle());
    ticketOracleView.addEventListener('click', openOracleTicketInArchive);
    ticketLetterBtn.addEventListener('click', () => {
        const fp = getTicketItems()[getTicketIndex()];
        if (fp) openTicketLetter(fp);
    });
    ticketLetterBack.addEventListener('click', () => closeTicketLetter());
    ticketLetterDownload.addEventListener('click', downloadTicketLetter);
    ticketLetterShare.addEventListener('click', shareTicketLetter);
    ticketLetterRetry.addEventListener('click', () => { renderTicketLetter(); });
    ticketPassportReset.addEventListener('click', () => {
        if (!window.confirm('确定清除这台设备上的全部集章记录吗？')) return;
        setTicketPassportRecords([]);
        persistTicketPassport();
        if (ticketPassport.classList.contains('show')) renderTicketPassport();
        updateTicketPassportButton();
        updateTicketStampBadge(getTicketItems()[getTicketIndex()], false);
    });
    [ticketPassport, ticketOracle, ticketLetter].forEach(overlay => {
        if (!overlay) return;
        overlay.addEventListener('click', event => {
            if (event.target !== overlay) return;
            if (overlay === ticketPassport) closeTicketPassport();
            else if (overlay === ticketOracle) closeTicketOracle();
            else closeTicketLetter();
        });
    });
    // 票夹 / 横向长串的交互（实现见 ticket-wallet.js）
    initTicketWallet();

    // 票根页背景点击：票夹里点空白 = 返回地球（原有设计）。
    // 重走时不能沿用：重走层是 pointer-events: none 的点击穿透层，点空白会打到这里，
    // 于是"点一下地球"就误退到地球并丢掉正在放的那一段。
    ticketLightbox.addEventListener('click', event => {
        if (event.target !== ticketLightbox) return;
        if (getTicketViewMode() === 'replay') {
            // 重走里点空白：只在放大状态下收回票根，其它什么都不做
            if (ticketReplayView && ticketReplayView.classList.contains('is-focused')) {
                ticketReplaySetZoom(false);
            }
            return;
        }
        closeTicketLightbox();
    });
    document.addEventListener('keydown', event => {
        if (ticketOracle && ticketOracle.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketOracle();
            return;
        }
        if (ticketLetter && ticketLetter.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketLetter();
            return;
        }
        if (ticketPassport && ticketPassport.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketPassport();
            return;
        }
        if (ticketGallery.classList.contains('show') && getTicketViewMode() === 'replay') {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                stepTicketReplay(event.key === 'ArrowRight' ? 1 : -1);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                // 分层关闭：先收回放大的票根，再退出重走
                if (ticketReplayView && ticketReplayView.classList.contains('is-focused')) {
                    ticketReplaySetZoom(false);
                    return;
                }
                setTicketViewMode('archive');
                return;
            }
        }
        if (ticketLightbox.classList.contains('show')) {
            if (event.key === 'ArrowLeft') { event.preventDefault(); switchTicket(-1); }
            if (event.key === 'ArrowRight') { event.preventDefault(); switchTicket(1); }
            if (event.key === 'Escape') { event.preventDefault(); closeTicketLightbox(); }
            return;
        }
        if (ticketGallery.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            setTicketView(false);
        }
    });
    // 页面切到后台时停止放映：后台标签页会节流定时器，回来容易一次跳好几站
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden || getTicketViewMode() !== 'replay') return;
        if (!ticketGallery.classList.contains('show')) return;
        pauseTicketReplay();
    });
    document.addEventListener('footprints:loaded', () => {
        if (ticketGallery.classList.contains('show')) {
            setTicketItems(ticketItemsFromFootprints());
            setTicketIndex(0);
            buildTicketWallet();
            renderTicketWallet();
            if (isTicketStripMode()) {
                requestAnimationFrame(() => {
                    centerStripItem(getTicketIndex(), false);
                    positionStripArchive();
                });
            }
        }
    });
    // 浏览器前进/后退：按 ?view=tickets 参数在票根页与地球页之间切换
    window.addEventListener('popstate', () => {
        setTicketView(isTicketsView());
    });
    // 直接访问 /footprints?view=tickets 时打开票根页（数据就绪后再打开，避免空状态闪烁）
    if (isTicketsView()) {
        document.addEventListener('footprints:loaded', () => {
            if (!ticketGallery.classList.contains('show')) setTicketView(true);
        }, { once: true });
    }

}
