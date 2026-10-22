/**
 * 票根册：票夹 / 横向长串 / 重走一遍 / 护照集章 / 命运抽票 / 未寄出的明信片。
 *
 * 这六块共用一套状态（当前票根下标、票根列表、视图模式、浮层显隐），
 * 彼此调用很密：抽票要读 ticketIndex，重走要读 ticketItems，
 * 明信片要读当前票根。按功能再拆会把同一份状态撕成几份，
 * 所以整体作为一个领域模块迁出，只对外暴露真正被主文件用到的 8 个接口。
 *
 * 依赖注入：主文件里的足迹数据、相机、卡片显隐等通过 setupTicketGallery 注入，
 * 全部用取值函数而不是快照 —— FOOTPRINTS / cityList 刷新时会整体重建。
 *
 * 两段式：
 *   - 模块顶层只做 DOM 查询与状态声明（脚本是 defer 的，此时 DOM 已就绪）；
 *   - init 之前不做任何事件绑定与渲染，避免依赖注入还没到就开始跑。
 */

import { haversineKm } from './footprints-insight.js';
import {
    compareTicketByTime,
    ticketHasCoordinate,
    isSameTicketCity
} from './ticket-utils.js';

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
}

// ================= 票根墙 =================
// 票根是独立于足迹封面和图片墙的单图资源：一条足迹最多对应一张票根。
const ticketGallery = document.getElementById('ticketGallery');
const ticketGalleryBtn = document.getElementById('ticketGalleryBtn');
const ticketGalleryBack = document.getElementById('ticketGalleryBack');
const ticketGalleryEmpty = document.getElementById('ticketGalleryEmpty');
const ticketGalleryStats = document.getElementById('ticketGalleryStats');
const ticketLightbox = ticketGallery;
const ticketWallet = document.getElementById('ticketWallet');
const ticketGalleryHint = document.getElementById('ticketGalleryHint');
const ticketStrip = document.getElementById('ticketStrip');
const ticketStripScroller = document.getElementById('ticketStripScroller');
const ticketStripProgress = document.getElementById('ticketStripProgress');
const ticketStripHint = document.getElementById('ticketStripHint');
const ticketMetaPanel = document.getElementById('ticketMetaPanel');
const ticketLightboxLoading = document.getElementById('ticketGalleryLoading');
const ticketLightboxError = document.getElementById('ticketGalleryError');
const ticketLightboxTitle = document.getElementById('ticketGalleryTitle');
const ticketLightboxPinyin = document.getElementById('ticketGalleryPinyin');
const ticketLightboxEnglish = document.getElementById('ticketGalleryEnglish');
const ticketLightboxSubtitle = document.getElementById('ticketGallerySubtitle');
const ticketLightboxDetails = document.getElementById('ticketGalleryDetails');
const ticketLightboxDescription = document.getElementById('ticketGalleryDescription');
const ticketLightboxCount = document.getElementById('ticketGalleryPosition');
const ticketLightboxRetry = document.getElementById('ticketGalleryRetry');
const ticketPassportBtn = document.getElementById('ticketPassportBtn');
const ticketPassportCount = document.getElementById('ticketPassportCount');
const ticketPassport = document.getElementById('ticketPassport');
const ticketPassportBack = document.getElementById('ticketPassportBack');
const ticketPassportGrid = document.getElementById('ticketPassportGrid');
const ticketPassportStats = document.getElementById('ticketPassportStats');
const ticketPassportReset = document.getElementById('ticketPassportReset');
const ticketStampBadge = document.getElementById('ticketStampBadge');
const ticketOracleBtn = document.getElementById('ticketOracleBtn');
const ticketOracle = document.getElementById('ticketOracle');
const ticketOracleBack = document.getElementById('ticketOracleBack');
const ticketOracleCard = document.getElementById('ticketOracleCard');
const ticketOracleStats = document.getElementById('ticketOracleStats');
const ticketOracleInspiration = document.getElementById('ticketOracleInspiration');
const ticketOracleView = document.getElementById('ticketOracleView');
const ticketOracleAgain = document.getElementById('ticketOracleAgain');
const ticketOracleClose = document.getElementById('ticketOracleClose');
const ticketLetterBtn = document.getElementById('ticketLetterBtn');
const ticketLetter = document.getElementById('ticketLetter');
const ticketLetterBack = document.getElementById('ticketLetterBack');
const ticketLetterTitle = document.getElementById('ticketLetterTitle');
const ticketLetterImg = document.getElementById('ticketLetterImg');
const ticketLetterStage = document.getElementById('ticketLetterStage');
const ticketLetterStatus = document.getElementById('ticketLetterStatus');
const ticketLetterRetry = document.getElementById('ticketLetterRetry');
const ticketLetterCaption = document.getElementById('ticketLetterCaption');
const ticketLetterDownload = document.getElementById('ticketLetterDownload');
const ticketLetterShare = document.getElementById('ticketLetterShare');
const ticketViewModes = document.getElementById('ticketViewModes');
const ticketCityFilterChip = document.getElementById('ticketCityFilter');
const ticketModeArchiveBtn = document.getElementById('ticketModeArchiveBtn');
const ticketModeReplayBtn = document.getElementById('ticketModeReplayBtn');
const ticketReplayView = document.getElementById('ticketReplayView');
const ticketReplayCard = document.getElementById('ticketReplayCard');
const ticketReplaySubtitle = document.getElementById('ticketReplaySubtitle');
const ticketReplayCityBadge = document.getElementById('ticketReplayCityBadge');
const ticketReplayRoute = document.getElementById('ticketReplayRoute');
const ticketReplayDistance = document.getElementById('ticketReplayDistance');
const ticketReplayTotal = document.getElementById('ticketReplayTotal');
const ticketReplayProgressText = document.getElementById('ticketReplayProgressText');
const ticketReplayEta = document.getElementById('ticketReplayEta');
const ticketReplayBarInner = document.getElementById('ticketReplayBarInner');
const ticketReplayPrev = document.getElementById('ticketReplayPrev');
const ticketReplayPlay = document.getElementById('ticketReplayPlay');
const ticketReplayNext = document.getElementById('ticketReplayNext');
const ticketReplayExit = document.getElementById('ticketReplayExit');
const ticketReplaySpeed = document.getElementById('ticketReplaySpeed');
const ticketReplayOpen = document.getElementById('ticketReplayOpen');
const ticketReplayFlight = document.getElementById('ticketReplayFlight');
const ticketReplayFlightLabel = document.getElementById('ticketReplayFlightLabel');
const ticketReplayFlightFrom = document.getElementById('ticketReplayFlightFrom');
const ticketReplayFlightCity = document.getElementById('ticketReplayFlightCity');
const ticketReplayFlightKm = document.getElementById('ticketReplayFlightKm');
const ticketReplayEnd = document.getElementById('ticketReplayEnd');
const ticketReplayEndRange = document.getElementById('ticketReplayEndRange');
const ticketReplayEndTickets = document.getElementById('ticketReplayEndTickets');
const ticketReplayEndCities = document.getElementById('ticketReplayEndCities');
const ticketReplayEndKm = document.getElementById('ticketReplayEndKm');
const ticketReplayEndSpan = document.getElementById('ticketReplayEndSpan');
const ticketReplayEndNote = document.getElementById('ticketReplayEndNote');
const ticketReplayAgain = document.getElementById('ticketReplayAgain');
const ticketReplayCloseEnd = document.getElementById('ticketReplayCloseEnd');
let ticketItems = [];
let ticketIndex = 0;
let ticketTrigger = null;
let walletItems = [];      // 票夹中的票根元素 [{ fp, img }]
const ticketImagePool = new Map();   // 已成功加载的票根图 → img，重复打开直接复用，避免重复请求
let wheelLocked = false;   // 滚轮切换节流
let walletTouchX = null;   // 触摸滑动起点
let walletSwiped = false;  // 滑动后抑制随后的 click，避免一次滑动触发两次切换
let stripScrollTimer = null;   // 横向长串滚轮停稳后的吸附计时
let stripDrag = null;          // 横向长串拖拽状态
// 后台“票根切换样式”：fan = 票夹叠放；strip = 横向长串浏览
let ticketStripMode = false;   // 由 initTicketGallery 按后台配置赋值

// 票根页创意功能：护照集章 + 时间有色（阶段 A）
const TICKET_PASSPORT_STORAGE_KEY = 'footprint-ticket-passport-v1';
const TICKET_STAMP_DWELL_MS = 1500;
let ticketPassportRecords = [];
let ticketStampTimer = null;
let ticketStampIndex = -1;
let ticketViewMode = 'archive';   // archive | replay
let ticketCityFilter = '';        // 只看某座城市的票根（从城市卡片的票根徽章进来时设置）
let ticketCityFilterName = '';
let ticketOracleTimer = null;
let ticketOracleCandidate = null;
let ticketOracleLastIndex = -1;
let ticketLetterFp = null;
let ticketLetterBlobUrl = '';
let ticketLetterFileName = '';
let ticketLetterRenderToken = 0;   // 明信片渲染令牌：关闭浮层后丢弃未完成的渲染结果
let ticketReplayItems = [];
let ticketReplayPoints = [];
let ticketReplayIndex = 0;
let ticketReplayPlaying = false;
let ticketReplayFlying = false;
let ticketReplayTimer = null;
let ticketReplayGeneration = 0;
let ticketReplayEntryIndex = 0;              // 进入放映时的票根，退出后回到这一张
let ticketReplayResumeIndex = -1;            // 切回票夹后，重走再进来接着播的位置
let ticketReplayPausedByOverlay = false;     // 浮层（护照/抽票/明信片）暂停放映的标记
let ticketReplaySpeedValue = 1;              // 播放倍速：1 或 2
const TICKET_REPLAY_DWELL_MS = 4200;

function ticketFeatureOn(key) {
    return !!(deps.footprintCfg() && deps.footprintCfg()[key] === true);
}

function ticketStampId(fp) {
    if (!fp) return '';
    const raw = fp.key ||
        ticketImageUrl(fp.ticketImage) ||
        [fp.name, fp.ticketNo, fp.ticketDate || fp.createTime].filter(Boolean).join('|');
    return String(raw || '').trim() || String(fp.name || '未知票根').trim();
}

function loadTicketPassport() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TICKET_PASSPORT_STORAGE_KEY));
        ticketPassportRecords = Array.isArray(parsed) ? parsed.filter(r => r && r.id) : [];
    } catch (e) {
        ticketPassportRecords = [];
    }
}

// 打开护照时按当前票根列表清理失效记录：
// 既避免 localStorage 只增不减，也避免删掉再重建的票根（identifier 相同）直接带上旧章。
// 票根列表为空时不清理，防止数据还没加载完就误删整本护照。
function pruneTicketPassport() {
    if (!ticketItems.length || !ticketPassportRecords.length) return false;
    const valid = new Set(ticketItems.map(ticketStampId).filter(Boolean));
    const kept = ticketPassportRecords.filter(record => valid.has(record.id));
    if (kept.length === ticketPassportRecords.length) return false;
    ticketPassportRecords = kept;
    persistTicketPassport();
    return true;
}

function persistTicketPassport() {
    try {
        localStorage.setItem(TICKET_PASSPORT_STORAGE_KEY, JSON.stringify(ticketPassportRecords));
    } catch (e) {
        /* 隐私模式/存储满时静默失败，不影响票根浏览 */
    }
}

function isTicketStamped(fp) {
    if (!fp) return false;
    const id = ticketStampId(fp);
    return ticketPassportRecords.some(record => record.id === id);
}

function clearTicketStampTimer() {
    if (ticketStampTimer) {
        clearTimeout(ticketStampTimer);
        ticketStampTimer = null;
    }
    ticketStampIndex = -1;
}

function stampTicket(fp) {
    if (!fp || !ticketFeatureOn('enableTicketPassport') || isTicketStamped(fp)) return;
    ticketPassportRecords.push({
        id: ticketStampId(fp),
        stampedAt: new Date().toISOString()
    });
    persistTicketPassport();
    updateTicketPassportButton();
    updateTicketStampBadge(fp, true);
}

function updateTicketPassportButton() {
    if (!ticketPassportBtn || !ticketPassportCount) return;
    const enabled = ticketFeatureOn('enableTicketPassport');
    ticketPassportBtn.hidden = !enabled || ticketItems.length === 0;
    if (!enabled) return;
    const stamped = ticketItems.filter(fp => isTicketStamped(fp)).length;
    ticketPassportCount.textContent = stamped + '/' + ticketItems.length;
}

function updateTicketLetterAction(fp) {
    if (!ticketLetterBtn) return;
    ticketLetterBtn.hidden = !ticketFeatureOn('enableTicketLetter') || !fp;
}

function updateTicketModeButtons() {
    if (!ticketViewModes) return;
    const replayEnabled = ticketFeatureOn('enableTicketJourneyReplay') &&
        ticketItems.filter(ticketHasCoordinate).length >= 2;
    ticketViewModes.hidden = !replayEnabled;
    if (!replayEnabled) return;
    // 只剩重走一个模式：顶部就是「票夹 / 重走」两段切换器（方案 §10）
    if (ticketModeArchiveBtn) ticketModeArchiveBtn.hidden = false;
    if (ticketModeReplayBtn) ticketModeReplayBtn.hidden = false;
    const active = ticketViewMode === 'replay' ? 'replay' : 'archive';
    if (ticketModeArchiveBtn) ticketModeArchiveBtn.classList.toggle('is-active', active === 'archive');
    if (ticketModeReplayBtn) ticketModeReplayBtn.classList.toggle('is-active', active === 'replay');
}

// 城市筛选：从城市卡片的票根徽章进来时，票根页只看这座城市
function renderTicketCityFilter() {
    if (!ticketCityFilterChip) return;
    ticketCityFilterChip.hidden = !ticketCityFilter;
    if (!ticketCityFilter) return;
    ticketCityFilterChip.textContent = '只看 ' + ticketCityFilterName + ' ✕';
    ticketCityFilterChip.setAttribute('aria-label',
        '清除筛选，显示全部城市的票根（当前只看 ' + ticketCityFilterName + '）');
}

function resetTicketCityFilter() {
    ticketCityFilter = '';
    ticketCityFilterName = '';
    renderTicketCityFilter();
}

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
    ticketCityFilter = city.key;
    ticketCityFilterName = city.city;
    setTicketView(true);            // 打开时会按筛选重建 ticketItems
    updateTicketFeatureButtons();
}

// 城市筛选只属于票夹视图：切到重走、打开抽票/护照时先清掉，
// 否则这些按 ticketItems 取数据的入口会莫名只剩一座城市
function ensureTicketCityFilterCleared() {
    if (!ticketCityFilter) return;
    resetTicketCityFilter();
    ticketItems = ticketItemsFromFootprints();
    ticketIndex = 0;
    buildTicketWallet();
    renderTicketWallet();
}

function updateTicketFeatureButtons() {
    updateTicketPassportButton();
    updateTicketModeButtons();
    renderTicketCityFilter();
    if (ticketOracleBtn) {
        ticketOracleBtn.hidden = !ticketFeatureOn('enableTicketOracle') || ticketItems.length === 0;
    }
    updateTicketLetterAction(ticketItems[ticketIndex]);
}

function updateTicketStampBadge(fp, animate) {
    if (!ticketStampBadge) return;
    const stamped = ticketFeatureOn('enableTicketPassport') && isTicketStamped(fp);
    ticketStampBadge.hidden = !stamped;
    if (!stamped) return;
    const meta = ticketMeta(fp);
    ticketStampBadge.textContent = '已检票 · ' + (fp.city || meta.route || '') +
        (meta.date ? ' · ' + meta.date : '');
    if (animate) {
        ticketStampBadge.classList.remove('is-stale');
        void ticketStampBadge.offsetWidth;
    } else {
        ticketStampBadge.classList.add('is-stale');
    }
}

function startTicketStampDwell(fp) {
    clearTicketStampTimer();
    if (!ticketFeatureOn('enableTicketPassport') || ticketViewMode !== 'archive') return;
    if (isTicketStamped(fp)) return;
    ticketStampIndex = ticketIndex;
    ticketStampTimer = setTimeout(() => {
        ticketStampTimer = null;
        if (ticketGallery.classList.contains('show') &&
            ticketViewMode === 'archive' &&
            ticketIndex === ticketStampIndex &&
            ticketItems[ticketIndex] === fp &&
            !isTicketStamped(fp)) {
            stampTicket(fp);
        }
    }, TICKET_STAMP_DWELL_MS);
}

function renderTicketPassport() {
    if (!ticketPassportGrid || !ticketPassportStats) return;
    if (pruneTicketPassport()) updateTicketPassportButton();
    const ordered = ticketItems.slice().sort(compareTicketByTime);
    ticketPassportGrid.innerHTML = '';
    ordered.forEach(fp => {
        const stamped = isTicketStamped(fp);
        const cell = document.createElement('div');
        cell.className = 'ticket-passport-cell' + (stamped ? '' : ' is-missing');
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = ticketImageUrl(fp.ticketImage);
        img.alt = '';
        const status = document.createElement('span');
        status.className = 'ticket-passport-cell-status';
        status.textContent = stamped ? '已检票' : '未检票';
        const title = document.createElement('span');
        title.className = 'ticket-passport-cell-title';
        title.textContent = [fp.name || fp.ticketTitle, fp.city].filter(Boolean).join(' · ');
        cell.append(img, status, title);
        ticketPassportGrid.appendChild(cell);
    });
    const stamped = ordered.filter(fp => isTicketStamped(fp)).length;
    ticketPassportStats.textContent = stamped + ' / ' + ordered.length + ' 已集章' +
        (stamped === ordered.length && ordered.length ? ' · 全站抵达' : '');
    if (ticketPassportReset) {
        ticketPassportReset.hidden = ordered.length === 0;
    }
}

function openTicketPassport() {
    if (!ticketFeatureOn('enableTicketPassport') || !ticketItems.length || !ticketPassport) return;
    ensureTicketCityFilterCleared();
    clearTicketStampTimer();
    pauseTicketReplayForOverlay();
    renderTicketPassport();
    ticketPassport.classList.add('show');
    deps.setOverlayHidden(ticketPassport, false);
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
        ticketPassportBack) {
        ticketPassportBack.focus();
    }
}

function closeTicketPassport(returnFocus = true) {
    if (!ticketPassport || !ticketPassport.classList.contains('show')) return;
    ticketPassport.classList.remove('show');
    deps.setOverlayHidden(ticketPassport, true);
    if (returnFocus && ticketPassportBtn && !ticketPassportBtn.hidden) {
        ticketPassportBtn.focus();
    }
    startTicketStampDwell(ticketItems[ticketIndex]);
    resumeTicketReplayFromOverlay();
}

// 时间有色：按票根日期月份决定页面氛围（阶段 A）
function ticketSeasonKey(fp) {
    const raw = String((fp && (fp.ticketDate || fp.createTime)) || '');
    const match = /^(\d{4})[-/.](\d{1,2})/.exec(raw);
    if (!match) return '';
    const month = Number(match[2]);
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
}

function applyTicketSeason(fp) {
    if (!ticketGallery) return;
    // 时间有色只改文字强调色（CSS 变量 --season-accent），不碰背景、票根图与地球
    const season = fp ? ticketSeasonKey(fp) : '';
    if (season && ticketFeatureOn('enableTicketSeasonLight')) {
        ticketGallery.dataset.season = season;
    } else {
        ticketGallery.removeAttribute('data-season');
    }
}

function resetTicketSeason() {
    if (ticketGallery) {
        ticketGallery.removeAttribute('data-season');
    }
}


// ================= 命运抽票（阶段 B） =================
function ticketOracleBackFace() {
    if (!ticketOracleCard) return;
    ticketOracleCard.classList.remove('is-back');
    void ticketOracleCard.offsetWidth;
    ticketOracleCard.classList.add('is-back');
    ticketOracleCard.innerHTML = '';
    if (ticketOracleStats) {
        ticketOracleStats.textContent = '正在翻找一张票…';
    }
    if (ticketOracleInspiration) ticketOracleInspiration.textContent = '';
    if (ticketOracleView) ticketOracleView.disabled = true;
}

function ticketOracleShowCandidate(fp) {
    if (!ticketOracleCard || !fp) return;
    ticketOracleCard.classList.remove('is-back', 'is-shuffling');
    ticketOracleCard.innerHTML = '';
    const img = document.createElement('img');
    img.alt = fp.ticketTitle || fp.name || '票根';
    img.referrerPolicy = 'no-referrer';
    img.src = ticketImageUrl(fp.ticketImage);
    img.onerror = () => {
        ticketOracleCard.innerHTML = '<span style="padding:20px;color:#6e5945;">这张票根暂时打不开<br>但它仍是一段旅程</span>';
    };
    ticketOracleCard.appendChild(img);
    const meta = ticketMeta(fp);
    if (ticketOracleStats) {
        ticketOracleStats.textContent = (fp.city || meta.route || '未知城市') +
            (meta.date ? ' · ' + meta.date : '') +
            (fp.name ? ' · ' + fp.name : '');
    }
    if (ticketOracleInspiration) {
        ticketOracleInspiration.textContent = nextTicketStopSuggestion();
    }
    if (ticketOracleView) ticketOracleView.disabled = false;
}

function nextTicketStopSuggestion() {
    // 与城市聚合同一套键：adcode 优先，避免同一座城市因为写法不同被当成"没去过"
    const ticketCities = new Set(ticketItems.map(fp => deps.cityKeyOf(fp)).filter(Boolean));
    const candidates = [];
    deps.FOOTPRINTS().forEach(fp => {
        if (ticketImageUrl(fp.ticketImage) || !fp.city) return;
        const key = deps.cityKeyOf(fp);
        if (!key || ticketCities.has(key) || candidates.includes(fp.city)) return;
        candidates.push(fp.city);
    });
    if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        return '下一站，或许可以去「' + pick + '」看看。';
    }
    const fallbacks = [
        '把去过的城市再走一遍也不错，下一张票根正在等你。',
        '旅行的下一站不在地图上，而在你的心里。',
        '所有出发都是回家，只是路线不同。'
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

function ticketOracleShuffle() {
    clearTimeout(ticketOracleTimer);
    ticketOracleCandidate = null;
    ticketOracleBackFace();
    if (ticketOracleCard) ticketOracleCard.classList.add('is-shuffling');
    if (ticketOracleAgain) ticketOracleAgain.disabled = true;
    let steps = 0;
    const tick = () => {
        steps++;
        if (steps >= 7) {
            if (ticketOracleCard) ticketOracleCard.classList.remove('is-shuffling');
            const pickable = ticketItems.length > 1;
            let idx = ticketOracleLastIndex;
            while (pickable && idx === ticketOracleLastIndex) {
                idx = Math.floor(Math.random() * ticketItems.length);
            }
            // 只有一张票根时不会进入上面的循环，idx 会停在 -1（对应 undefined），
            // 结果卡片一直停在背面、按钮永远不可用；这里兜底到第一张。
            if (idx < 0 || !ticketItems[idx]) idx = 0;
            ticketOracleLastIndex = idx;
            ticketOracleCandidate = ticketItems[idx];
            ticketOracleShowCandidate(ticketOracleCandidate);
            if (ticketOracleAgain) ticketOracleAgain.disabled = false;
            return;
        }
        ticketOracleTimer = setTimeout(tick, 130);
    };
    ticketOracleTimer = setTimeout(tick, 130);
}

function openTicketOracle() {
    if (!ticketFeatureOn('enableTicketOracle') || !ticketItems.length || !ticketOracle) return;
    ensureTicketCityFilterCleared();
    clearTicketStampTimer();
    pauseTicketReplayForOverlay();
    ticketOracle.classList.add('show');
    deps.setOverlayHidden(ticketOracle, false);
    ticketOracleShuffle();
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
        ticketOracleBack) {
        ticketOracleBack.focus();
    }
}

function closeTicketOracle(returnFocus = true) {
    if (!ticketOracle || !ticketOracle.classList.contains('show')) return;
    clearTimeout(ticketOracleTimer);
    ticketOracleTimer = null;
    ticketOracleCandidate = null;
    ticketOracle.classList.remove('show');
    deps.setOverlayHidden(ticketOracle, true);
    if (returnFocus && ticketOracleBtn && !ticketOracleBtn.hidden) {
        ticketOracleBtn.focus();
    }
    startTicketStampDwell(ticketItems[ticketIndex]);
    resumeTicketReplayFromOverlay();
}

function openOracleTicketInArchive() {
    if (!ticketOracleCandidate) return;
    const idx = ticketItems.indexOf(ticketOracleCandidate);
    closeTicketOracle(false);
    if (idx < 0) return;
    // 抽票浮层里点「查看这张票」：先回到票夹，再定位到这张票
    if (ticketViewMode !== 'archive') setTicketViewMode('archive');
    ticketIndex = idx;
    buildTicketWallet();
    renderTicketWallet();
    if (ticketStripMode) {
        requestAnimationFrame(() => {
            centerStripItem(ticketIndex, false);
            positionStripArchive();
        });
    }
}

// 重走里点「查看这张票」：回到票夹并定位到当前这一站
function openReplayTicketInArchive() {
    const fp = ticketReplayPoints[ticketReplayIndex];
    if (!fp) return;
    const idx = ticketItems.indexOf(fp);
    if (idx < 0) return;
    if (ticketViewMode !== 'archive') setTicketViewMode('archive');
    ticketIndex = idx;
    buildTicketWallet();
    renderTicketWallet();
    if (ticketStripMode) {
        requestAnimationFrame(() => {
            centerStripItem(ticketIndex, false);
            positionStripArchive();
        });
    }
}

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
    const cream = '#f3eee2';
    const ink = '#35423d';
    const muted = '#8b7865';
    const accent = '#9b704e';
    const bg = ctx.createLinearGradient(0, 0, 0, 1280);
    bg.addColorStop(0, '#e8e0d2');
    bg.addColorStop(1, '#d6cbb8');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 900, 1280);
    ctx.strokeStyle = 'rgba(118,92,61,0.34)';
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, 852, 1232);

    ctx.fillStyle = accent;
    ctx.font = '600 24px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A LETTER FROM A TICKET', 450, 78);
    ctx.fillStyle = ink;
    ctx.font = '400 44px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
    ctx.fillText('未寄出的明信片', 450, 132);

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
        ctx.fillStyle = '#e4dccd';
        ctx.fillRect(shotX, shotTop, shotW, shotBottom - shotTop);
        ctx.fillStyle = muted;
        ctx.font = '400 150px "Noto Serif SC", "Songti SC", serif';
        ctx.textAlign = 'center';
        ctx.fillText((fp.city || '?').charAt(0), 450, shotTop + 260);
    }
    // 图下小字：城市 · 日期 · 票根名
    ctx.fillStyle = muted;
    ctx.font = '400 24px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
    ctx.textAlign = 'center';
    ctx.fillText(
        [fp.city || meta.route, meta.date, fp.name || meta.title].filter(Boolean).join(' · '),
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
    ctx.font = '400 30px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
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
    ctx.font = '26px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText('旅行记忆 · 票根收藏', 852, 1245);
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

async function renderTicketLetter() {
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

async function openTicketLetter(fp) {
    if (!ticketFeatureOn('enableTicketLetter') || !fp || !ticketLetter) return;
    clearTicketStampTimer();
    pauseTicketReplayForOverlay();
    ticketLetterFp = fp;
    if (ticketLetterTitle) {
        ticketLetterTitle.textContent = (fp.city ? fp.city + ' · ' : '') + '未寄出的明信片';
    }
    const meta = ticketMeta(fp);
    if (ticketLetterCaption) {
        ticketLetterCaption.textContent = [
            '由「' + (fp.name || meta.title || '这张票根') + '」写成',
            fp.city || meta.route,
            meta.date
        ].filter(Boolean).join(' · ');
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

function closeTicketLetter(returnFocus = true) {
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
    startTicketStampDwell(ticketItems[ticketIndex]);
    resumeTicketReplayFromOverlay();
}

function downloadTicketLetter() {
    if (!ticketLetterBlobUrl) return;
    const a = document.createElement('a');
    a.href = ticketLetterBlobUrl;
    a.download = ticketLetterFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

async function shareTicketLetter() {
    if (!ticketLetterBlobUrl) return;
    const blob = await fetch(ticketLetterBlobUrl).then(r => r.blob());
    const file = new File([blob], ticketLetterFileName, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: ticketLetterFileName });
        } catch (e) { /* 用户取消分享无需处理 */ }
    }
}

// 票根排序/坐标校验的纯逻辑在 modules/ticket-utils.js；
// 这里只留一个薄包装，因为它要闭包引用主文件里的 ticketItems。
function sortedTicketItems() {
    return ticketItems.slice().sort(compareTicketByTime);
}
// ================= 重走一遍（阶段 D） =================
function updateTicketReplayPlayButton() {
    if (ticketReplayPlay) {
        ticketReplayPlay.textContent = ticketReplayPlaying ? '暂停' : '继续';
    }
}

function updateTicketReplaySpeedButton() {
    if (!ticketReplaySpeed) return;
    ticketReplaySpeed.textContent = ticketReplaySpeedValue + '×';
    ticketReplaySpeed.setAttribute('aria-label', '播放速度，当前 ' + ticketReplaySpeedValue + ' 倍速');
    ticketReplaySpeed.classList.toggle('is-on', ticketReplaySpeedValue > 1);
}

function toggleTicketReplaySpeed() {
    ticketReplaySpeedValue = ticketReplaySpeedValue > 1 ? 1 : 2;
    updateTicketReplaySpeedButton();
    // 正在放映就按新倍速重排下一段（当前停留重新计时，不跳站）
    if (ticketReplayPlaying) scheduleNextTicketReplay();
    if (ticketReplayEta) ticketReplayEta.textContent = ticketReplayRemainingText();
}

// 剩余时间：按「停留 + 飞行 + 落卡停顿」的整段估算，同城/缺坐标的段会更快，所以标「约」
function ticketReplayRemainingText() {
    const len = ticketReplayPoints.length;
    const left = Math.max(0, len - 1 - ticketReplayIndex);
    if (!left) return '';
    const perStopMs = (TICKET_REPLAY_DWELL_MS + 2300 + 480) / ticketReplaySpeedValue;
    const seconds = Math.round(left * perStopMs / 1000);
    return '剩余约 ' + (seconds >= 90 ? Math.round(seconds / 60) + ' 分钟' : seconds + ' 秒');
}

function ticketReplayFlyTo(fp, duration, onDone) {
    if (!fp || !ticketHasCoordinate(fp)) {
        // 没有坐标时不飞：仍回调，避免调用方把 ticketReplayFlying 卡在 true
        if (onDone) onDone();
        return;
    }
    const target = Cesium.Cartesian3.fromDegrees(Number(fp.lng), Number(fp.lat), 150000);
    const dur = deps.reduceMotion() ? 0 : Math.max(0, duration || 0);
    if (dur <= 0) {
        deps.viewer().camera.flyTo({ destination: target, duration: 0 });
        if (onDone) onDone();
        return;
    }
    deps.viewer().camera.flyTo({
        destination: target,
        duration: dur,
        complete: onDone || undefined,
        cancel: onDone || undefined
    });
}

// 相机飞行是异步的：暂停/改站/退出时必须显式取消，
// 否则镜头会继续飞向已经放弃的目标（票夹已经回来了，地球还在动）
function cancelTicketReplayFlight() {
    try {
        deps.viewer().camera.cancelFlight();
    } catch (e) {
        /* 相机未在飞行或场景尚未就绪时忽略 */
    }
}

function ticketReplayShowStop(index, animate) {
    const points = ticketReplayPoints;
    if (!points.length) return;
    const len = points.length;
    ticketReplayIndex = Math.max(0, Math.min(index, len - 1));
    const fp = points[ticketReplayIndex];
    // 放映期间不改写票夹游标；退出时由 clearTicketReplay 复位到进入前的票根

    ticketReplayCard.classList.remove('is-arriving', 'is-missing');
    ticketReplayCard.innerHTML = '';
    const img = document.createElement('img');
    img.alt = fp.ticketTitle || fp.name || '票根';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onerror = () => {
        ticketReplayCard.classList.add('is-missing');
        ticketReplayCard.textContent = (fp.city || fp.name || '?').charAt(0);
    };
    img.src = ticketImageUrl(fp.ticketImage);
    ticketReplayCard.appendChild(img);
    if (animate) {
        void ticketReplayCard.offsetWidth;
        ticketReplayCard.classList.add('is-arriving');
    }

    const meta = ticketMeta(fp);
    ticketReplaySubtitle.textContent = [fp.name || meta.title, fp.city || meta.route, meta.date]
        .filter(Boolean).join(' · ');
    // 时间有色：氛围色跟随当前放映到的那一张票根
    applyTicketSeason(fp);
    // 第二行拆成「状态文字 + 里程数字」两块：数字单独给强调色与等宽数字，移动中更醒目
    let routeText;
    let distanceText = '';
    if (ticketReplayIndex === 0) {
        routeText = ticketHasCoordinate(fp) ? '旅程起点' : '旅程起点 · 这张票根没有定位';
    } else {
        const prev = points[ticketReplayIndex - 1];
        const sameCity = isSameTicketCity(prev, fp);
        const noCoord = !ticketHasCoordinate(prev) || !ticketHasCoordinate(fp);
        if (noCoord) {
            routeText = '上一站无法定位，原地淡入下一张';
        } else if (sameCity) {
            routeText = '与上一站同一城市，原地停留';
        } else {
            routeText = '沿着上一站的方向继续';
            distanceText = '距上一站 ' + Math.round(haversineKm(prev, fp)).toLocaleString('zh-CN') + ' km';
        }
    }
    ticketReplayRoute.textContent = routeText;
    if (ticketReplayDistance) {
        ticketReplayDistance.textContent = distanceText;
    }
    // 同城角标：这座城市在本次重走里有多张票根时，标出这是第几张
    if (ticketReplayCityBadge) {
        const key = deps.cityKeyOf(fp);
        let badge = '';
        if (key) {
            const group = ticketReplayPoints.filter(item => deps.cityKeyOf(item) === key);
            if (group.length > 1) {
                const position = group.indexOf(fp) + 1;
                badge = (String(fp.city || '').trim() || '同城') + ' · 同城 ' + position + '/' + group.length;
            }
        }
        ticketReplayCityBadge.textContent = badge;
        ticketReplayCityBadge.hidden = !badge;
    }
    const totalKm = ticketReplayKilometers(ticketReplayIndex);
    ticketReplayProgressText.textContent = (ticketReplayIndex + 1) + ' / ' + len;
    // 累计里程和「距上一站」放在同一行，进度区只留进度与剩余时间
    if (ticketReplayTotal) {
        ticketReplayTotal.textContent = totalKm > 0
            ? '累计 ' + Math.round(totalKm).toLocaleString('zh-CN') + ' km'
            : '';
    }
    if (ticketReplayEta) {
        ticketReplayEta.textContent = ticketReplayRemainingText();
    }
    if (ticketReplayBarInner) {
        /* 进度条走 transform: scaleX，别动 width（宽度动画会触发重排） */
        ticketReplayBarInner.style.transform = 'scaleX(' + ((ticketReplayIndex + 1) / len) + ')';
    }
    // 预加载下一张，避免飞行落地后才开始解码
    const next = points[ticketReplayIndex + 1];
    if (next) {
        const pre = new Image();
        pre.src = ticketImageUrl(next.ticketImage);
    }
}

// 从第一张票根累加到第 upTo 张的直线估算里程。
// 缺坐标的段和「同城段」都跳过：界面上这两类段也不显示里程，累计口径保持一致
function ticketReplayKilometers(upTo) {
    const points = ticketReplayPoints;
    const end = Math.min(upTo, points.length - 1);
    let km = 0;
    for (let i = 1; i <= end; i++) {
        const from = points[i - 1];
        const to = points[i];
        if (!ticketHasCoordinate(from) || !ticketHasCoordinate(to)) continue;
        if (isSameTicketCity(from, to)) continue;
        km += haversineKm(from, to);
    }
    return km;
}

function ticketReplayShowFlight(from, to, kmValue, flightSeconds) {
    if (!ticketReplayFlight) return;
    if (ticketReplayView) ticketReplayView.classList.add('is-flying');
    // 进度条动画时长跟着实际飞行时长走（变速时同步）
    ticketReplayFlight.style.setProperty('--flight-duration', (flightSeconds || 2.3) + 's');
    const km = kmValue ? Math.round(kmValue).toLocaleString('zh-CN') + ' km' : '';
    ticketReplayFlightLabel.textContent = '正在飞往';
    if (ticketReplayFlightFrom) {
        ticketReplayFlightFrom.textContent = (from && (from.city || from.name)) || '上一站';
    }
    ticketReplayFlightCity.textContent = to.city || to.name || '下一站';
    ticketReplayFlightKm.textContent = km ? '约 ' + km + ' · 直线估算' : '';
    // 每次起飞都重放一次进度条：先摘掉 is-on 再强制重排
    ticketReplayFlight.classList.remove('is-on');
    void ticketReplayFlight.offsetWidth;
    ticketReplayFlight.classList.add('is-on');
    ticketReplayFlight.setAttribute('aria-hidden', 'false');
    // 底部影院条同步跟着走：状态行说去哪个城市，里程行显示这一段
    if (ticketReplayRoute) {
        ticketReplayRoute.textContent = '正在飞往 ' + (to.city || to.name || '下一站');
    }
    if (ticketReplayDistance) {
        ticketReplayDistance.textContent = km ? '约 ' + km : '';
    }
}

function ticketReplayHideFlight() {
    if (ticketReplayFlight) {
        ticketReplayFlight.classList.remove('is-on');
        ticketReplayFlight.setAttribute('aria-hidden', 'true');
    }
    if (ticketReplayView) ticketReplayView.classList.remove('is-flying');
}

// 票根放大 / 收起：只有用户明确点票根才会放大（方案 A）
function ticketReplaySetZoom(zoom) {
    if (!ticketReplayView || !ticketReplayCard) return;
    ticketReplayView.classList.toggle('is-focused', !!zoom);
    ticketReplayCard.setAttribute('aria-expanded', zoom ? 'true' : 'false');
    ticketReplayCard.setAttribute('aria-label', zoom ? '收起票根' : '放大票根');
}

function toggleTicketReplayZoom() {
    if (ticketViewMode !== 'replay' || !ticketReplayCard) return;
    // 飞行途中卡片是淡出的，这时不允许（键盘）触发放大
    if (ticketReplayView.classList.contains('is-flying')) return;
    const zoomed = ticketReplayView.classList.contains('is-focused');
    if (zoomed) {
        ticketReplaySetZoom(false);
        return;
    }
    // 点票根的意思就是「停下来让我看清这张」：正在放映就先暂停
    if (ticketReplayPlaying) pauseTicketReplay();
    ticketReplaySetZoom(true);
}

function scheduleNextTicketReplay() {
    clearTimeout(ticketReplayTimer);
    ticketReplayTimer = null;
    if (!ticketReplayPlaying || ticketViewMode !== 'replay') return;
    const gen = ticketReplayGeneration;
    const rate = ticketReplaySpeedValue;
    ticketReplayTimer = setTimeout(() => {
        if (gen !== ticketReplayGeneration || !ticketReplayPlaying || ticketReplayFlying) return;
        const points = ticketReplayPoints;
        const next = ticketReplayIndex + 1;
        if (next >= points.length) {
            finishTicketReplay();
            return;
        }
        const from = points[ticketReplayIndex];
        const to = points[next];
        const sameCity = isSameTicketCity(from, to);
        const noCoord = !ticketHasCoordinate(from) || !ticketHasCoordinate(to);
        if (sameCity || noCoord) {
            ticketReplayTimer = setTimeout(() => {
                if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                ticketReplayHideFlight();
                ticketReplayShowStop(next, true);
                scheduleNextTicketReplay();
            }, 520 / rate);
        } else {
            const km = haversineKm(from, to);
            const flightSeconds = 2.3 / rate;
            ticketReplayFlying = true;
            ticketReplayShowFlight(from, to, km, flightSeconds);
            ticketReplayFlyTo(to, flightSeconds, () => {
                if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                ticketReplayFlying = false;
                ticketReplayTimer = setTimeout(() => {
                    if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                    ticketReplayHideFlight();
                    ticketReplayShowStop(next, true);
                    scheduleNextTicketReplay();
                }, 480 / rate);
            });
        }
    }, TICKET_REPLAY_DWELL_MS / rate);
}

function pauseTicketReplay() {
    if (!ticketReplayPlaying) return;
    ticketReplayGeneration++;
    ticketReplayPlaying = false;
    clearTimeout(ticketReplayTimer);
    ticketReplayTimer = null;
    ticketReplayFlying = false;
    cancelTicketReplayFlight();
    ticketReplayHideFlight();
    // 方案 A：暂停只冻结当前画面，不再把票根搬到画面中央
    if (ticketReplayView) ticketReplayView.classList.add('is-paused');
    updateTicketReplayPlayButton();
}

function resumeTicketReplay() {
    if (ticketReplayPlaying || !ticketReplayPoints.length || ticketViewMode !== 'replay') return;
    if (!ticketReplayEnd.hidden) return;
    ticketReplayGeneration++;
    ticketReplayPlaying = true;
    updateTicketReplayPlayButton();
    if (ticketReplayView) ticketReplayView.classList.remove('is-paused');
    ticketReplaySetZoom(false);
    ticketReplayShowStop(ticketReplayIndex, false);
    scheduleNextTicketReplay();
}

// 抽票/护照/明信片浮层打开时暂停放映，关闭后接着播，不丢播放位置
function pauseTicketReplayForOverlay() {
    if (ticketViewMode !== 'replay' || !ticketReplayPlaying) return;
    ticketReplayPausedByOverlay = true;
    pauseTicketReplay();
}

function resumeTicketReplayFromOverlay() {
    if (!ticketReplayPausedByOverlay) return;
    ticketReplayPausedByOverlay = false;
    if (ticketViewMode !== 'replay' || !ticketGallery.classList.contains('show')) return;
    if (!ticketReplayEnd.hidden) return;
    resumeTicketReplay();
}

// 手动上一站/下一站：卡片立即切换，同时把镜头带到这一站（缺坐标时保持原地）
function ticketReplayFlyToStop(index) {
    const fp = ticketReplayPoints[index];
    if (!ticketHasCoordinate(fp)) return;
    ticketReplayFlyTo(fp, 1.4, null);
}

function stepTicketReplay(delta) {
    if (!ticketReplayPoints.length || !ticketReplayEnd.hidden) return;
    const wasPlaying = ticketReplayPlaying;
    pauseTicketReplay();
    const len = ticketReplayPoints.length;
    const next = (ticketReplayIndex + delta + len) % len;
    // 播放中不重复触发落卡动画：紧接着的 resume 会重绘当前卡片
    ticketReplayShowStop(next, !wasPlaying);
    ticketReplayFlyToStop(next);
    if (wasPlaying) resumeTicketReplay();
}

function finishTicketReplay() {
    if (!ticketReplayEnd) return;
    ticketReplayGeneration++;
    ticketReplayPlaying = false;
    clearTimeout(ticketReplayTimer);
    ticketReplayTimer = null;
    ticketReplayFlying = false;
    ticketReplayHideFlight();
    updateTicketReplayPlayButton();
    const points = ticketReplayPoints;
    const km = ticketReplayKilometers(points.length - 1);
    const cities = new Set(points.map(fp => fp.city).filter(Boolean));
    const first = points[0];
    const last = points[points.length - 1];
    const stamp = fp => {
        const raw = String(fp.ticketDate || fp.createTime || '').slice(0, 10);
        return raw ? raw.replace(/-/g, '.') : '';
    };
    const yearOf = fp => Number(String(fp.ticketDate || fp.createTime || '').slice(0, 4));
    const yearA = yearOf(first);
    const yearB = yearOf(last);
    if (ticketReplayEndRange) {
        const from = stamp(first);
        const to = stamp(last);
        ticketReplayEndRange.textContent = (from && to && from !== to) ? from + ' → ' + to : (from || '');
    }
    if (ticketReplayEndTickets) ticketReplayEndTickets.textContent = String(points.length);
    if (ticketReplayEndCities) ticketReplayEndCities.textContent = cities.size ? String(cities.size) : '—';
    if (ticketReplayEndKm) ticketReplayEndKm.textContent = Math.round(km).toLocaleString('zh-CN');
    if (ticketReplayEndSpan) {
        ticketReplayEndSpan.textContent = (yearA && yearB && yearB >= yearA)
            ? String(yearB - yearA + 1)
            : '—';
    }
    // 重走只放映「带票根图」的足迹，这里说明一下总数，免得用户以为别的足迹丢了
    if (ticketReplayEndNote) {
        const withoutTicket = Math.max(0, deps.FOOTPRINTS().length - ticketItems.length);
        ticketReplayEndNote.textContent = withoutTicket
            ? '重走只放映有票根图的足迹，另有 ' + withoutTicket + ' 个足迹未附票根'
            : '';
        ticketReplayEndNote.hidden = !withoutTicket;
    }
    ticketReplayEnd.hidden = false;
    if (ticketReplayView) ticketReplayView.classList.add('is-ended');
    ticketReplayResumeIndex = 0;   // 已播完：下次进重走从头开始，而不是停在终点卡
}

function startTicketReplay(startIndex = 0) {
    if (!ticketReplayPoints.length) return;
    ticketReplayGeneration++;
    ticketReplayPlaying = true;
    ticketReplayFlying = false;
    const len = ticketReplayPoints.length;
    const start = Math.max(0, Math.min(Number(startIndex) || 0, len - 1));
    ticketReplayIndex = start;
    if (ticketReplayEnd) ticketReplayEnd.hidden = true;
    ticketReplayHideFlight();
    if (ticketReplayView) {
        ticketReplayView.classList.remove('is-focused', 'is-flying', 'is-paused', 'is-ended');
    }
    ticketReplaySetZoom(false);
    deps.pauseAutoRotate('replay');   // 放映期间暂停自转，退出放映时按用户偏好恢复
    ticketReplayShowStop(start, true);
    if (ticketHasCoordinate(ticketReplayPoints[start])) {
        ticketReplayFlyTo(ticketReplayPoints[start], 0.001, null);
    }
    scheduleNextTicketReplay();
    updateTicketReplayPlayButton();
}

// 至少两张带经纬度的票根才能放映（入口按钮与进入校验共用同一条件）
function canEnterTicketReplay() {
    return !!ticketReplayView && ticketItems.filter(ticketHasCoordinate).length >= 2;
}

function enterTicketReplay() {
    if (!ticketReplayView) return;
    ticketReplayItems = sortedTicketItems();
    ticketReplayPoints = ticketReplayItems;
    if (!canEnterTicketReplay()) return;
    updateTicketReplaySpeedButton();
    // 只在真正进入放映时记录一次当前票根，退出时复位
    ticketReplayEntryIndex = ticketIndex;
    ticketGallery.classList.add('is-replay-mode');
    ticketReplayView.hidden = false;
    // 从票夹切回来时接着上次的站继续播（-1 表示从头开始）
    startTicketReplay(ticketReplayResumeIndex);
    updateTicketModeButtons();
}

function clearTicketReplay() {
    const wasReplay = ticketViewMode === 'replay';
    ticketReplayGeneration++;
    ticketReplayPlaying = false;
    ticketReplayFlying = false;
    clearTimeout(ticketReplayTimer);
    ticketReplayTimer = null;
    cancelTicketReplayFlight();
    ticketReplayHideFlight();
    if (ticketReplayEnd) ticketReplayEnd.hidden = true;
    if (ticketReplayView) ticketReplayView.hidden = true;
    if (ticketReplayView) ticketReplayView.classList.remove('is-focused', 'is-flying', 'is-paused', 'is-ended');
    ticketReplaySetZoom(false);
    if (ticketGallery) ticketGallery.classList.remove('is-replay-mode');
    // 回到进入放映前的票根，不停留在最后看过的那一张；
    // 只有真的在放映中才复位，避免之后切模式时把票夹游标拽回旧位置
    if (wasReplay) {
        // 记下播到哪一站：切回票夹再进来能接着播
        ticketReplayResumeIndex = ticketReplayIndex;
        if (ticketItems[ticketReplayEntryIndex]) ticketIndex = ticketReplayEntryIndex;
    }
    ticketReplayPausedByOverlay = false;
    deps.resumeAutoRotate('replay');   // 退出放映：按用户偏好恢复自转
    updateTicketReplayPlayButton();
}

function setTicketViewMode(mode) {
    if (mode === ticketViewMode) return;
    ensureTicketCityFilterCleared();
    clearTicketReplay();
    if (mode === 'replay') {
        // 先校验再改状态：不满足条件时保持票夹视图，避免模式卡在 replay
        if (!canEnterTicketReplay()) {
            ticketViewMode = 'archive';
            updateTicketModeButtons();
            return;
        }
        ticketViewMode = 'replay';
        clearTicketStampTimer();
        enterTicketReplay();
    } else {
        ticketViewMode = 'archive';
        clearTicketStampTimer();
        if (ticketItems[ticketIndex]) {
            applyTicketSeason(ticketItems[ticketIndex]);
        }
        renderTicketWallet();
        // 退出放映后把横向长串重新居中到入口票根，避免字幕与卷轴错位
        if (ticketStripMode) {
            requestAnimationFrame(() => {
                centerStripItem(ticketIndex, false);
                positionStripArchive();
            });
        }
        updateTicketModeButtons();
        startTicketStampDwell(ticketItems[ticketIndex]);
        // 从重走回到票夹：自动旋转开着时同样把视角收回整个地球
        deps.restoreGlobeViewForAutoRotate();
    }
}

function ticketEscape(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

export function ticketImageUrl(value) {
    // Halo 附件字段在不同版本/配置下可能返回 URL 字符串、对象或单元素数组。
    if (Array.isArray(value)) value = value.find(item => ticketImageUrl(item)) || '';
    if (value && typeof value === 'object') {
        value = value.url || value.src || value.thumbnail || value.path || value.spec?.url || '';
    }
    const url = String(value || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    if (/^\/\//.test(url)) return window.location.protocol + url;
    if (/^\//.test(url)) return url;
    return '';
}

export function ticketDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    return match ? match[1] + '.' + match[2] + '.' + match[3] : raw;
}

export function ticketItemsFromFootprints() {
    return deps.FOOTPRINTS().filter(fp =>
        ticketImageUrl(fp.ticketImage) &&
        (!ticketCityFilter || deps.cityKeyOf(fp) === ticketCityFilter));
}

function ticketMeta(fp) {
    return {
        title: fp.name || fp.ticketTitle || '未命名足迹',
        subtitle: '',
        date: ticketDate(fp.ticketDate || fp.createTime),
        route: fp.city || '',
        province: fp.province || '',
        no: fp.ticketNo || '',
        type: fp.ticketType || fp.footprintType || '',
        description: fp.description || ''
    };
}

// 后台按行政区划代码记录城市/省份；前端据此补上不带声调的拼音。
// 映射表由 district-pinyin.js 注入到 window.FOOTPRINT_PINYIN。
function ticketPinyin(adcode) {
    if (!adcode || !window.FOOTPRINT_PINYIN) return '';
    const key = String(adcode || '').replace(/\.0+$/, '').padStart(6, '0');
    return window.FOOTPRINT_PINYIN[key] || '';
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
        if (ticketViewMode !== 'archive') {
            clearTicketReplay();
            ticketViewMode = 'archive';
        }
        ticketReplayResumeIndex = -1;   // 重新打开票根页时，重走从头开始
        // 打开票根前自动收起可能开着的足迹详情卡 / 城市聚合卡
        if (deps.markerCard() && deps.markerCard().classList.contains('visible')) deps.hideMarkerCard();
        if (deps.cityCard() && deps.cityCard().classList.contains('visible')) deps.hideCityCard(false);
        if (deps.provinceCardsActive()) deps.closeProvinceCards();
        deps.clearProvinceRestorePending();   // 进票根册是另一条浏览线，不再恢复省份卡片组
        // 卡片墙 / 城市图片墙是不透明浮层：先收起来，票根页才能透出背后的地球
        hideTicketUnderlay();
        ticketItems = ticketItemsFromFootprints();
        loadTicketPassport();
        updateTicketFeatureButtons();
        ticketGalleryEmpty.hidden = ticketItems.length > 0;
        const cities = new Set(ticketItems.map(fp => fp.city).filter(Boolean));
        const latest = ticketItems.map(fp => ticketDate(fp.ticketDate || fp.createTime)).filter(Boolean)[0] || '';
        ticketGalleryStats.textContent = ticketItems.length
            ? ticketItems.length + ' 张票根 · ' + (cities.size || '多个') + ' 个目的地' + (latest ? ' · 最近 ' + latest : '')
            : '收集每一次出发的凭证';
        ticketGallery.classList.add('show');
        deps.setOverlayHidden(ticketGallery, false);
        document.body.classList.add('ticket-gallery-open');
        // 打开票根页时把地址同步为 ?view=tickets，便于分享/直达
        if (!isTicketsView()) history.pushState({ ticketGallery: true }, '', window.location.pathname + '?view=tickets');
        // 打开票根页：地球作为背景。从足迹卡进入时（startRotation === false）明确要求不自转；
        // 其余入口跟随用户偏好 —— 不再无条件打开，否则用户手动关掉的自转会被这个入口重新打开。
        if (startRotation === false) deps.pauseAutoRotate('ticket-view');
        else deps.resumeAutoRotate('ticket-view');
        if (ticketItems.length) {
            ticketIndex = targetIndex == null
                ? 0
                : Math.max(0, Math.min(targetIndex, ticketItems.length - 1));
            buildTicketWallet();
            renderTicketWallet();
            if (ticketStripMode) {
                requestAnimationFrame(() => {
                    centerStripItem(ticketIndex, false);
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
        ticketReplayPausedByOverlay = false;
        deps.resumeAutoRotate('ticket-view');   // 票根页的临时停转到此结束
        if (ticketPassport && ticketPassport.classList.contains('show')) closeTicketPassport(false);
        if (ticketOracle && ticketOracle.classList.contains('show')) closeTicketOracle(false);
        if (ticketLetter && ticketLetter.classList.contains('show')) closeTicketLetter(false);
        if (ticketViewMode !== 'archive') {
            clearTicketReplay();
            ticketViewMode = 'archive';
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
        if (i === ticketIndex) {
            ticketLightboxLoading.hidden = true;
            ticketLightboxError.hidden = true;
        }
        // 长串样式：图片实际尺寸就绪后再补左右留白并让当前票根保持居中
        if (ticketStripMode) {
            updateStripPadding();
            requestAnimationFrame(() => {
                centerStripItem(ticketIndex, false);
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
        if (i === ticketIndex) {
            ticketLightboxLoading.hidden = true;
            ticketLightboxError.hidden = false;
        }
    };
    img.src = originalUrl;
    return img;
}

// 按后台配置构建票夹或横向长串
function buildTicketWallet() {
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
        ticketStripProgress.hidden = ticketItems.length < 2;
        ticketStripHint.hidden = ticketItems.length < 2;
        if (ticketItems.length) {
            document.body.classList.add('ticket-strip-active');
            // 移动端没有鼠标，改用滑动提示；桌面端隐藏顶部提示
            ticketGalleryHint.textContent = isTouch
                ? '左右滑动切换票根'
                : '滚动鼠标或拖动查看票根';
            ticketGalleryHint.hidden = !isTouch || ticketItems.length < 2;
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
    walletItems = ticketItems.map((fp, i) => {
        const img = createTicketImage(fp, i, 'ticket-wallet-item');
        ticketWallet.appendChild(img);
        return { fp, img };
    });
    const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
    ticketGalleryHint.textContent = isTouch ? '左右滑动切换票根' : '点击票根或滚动鼠标切换';
    ticketGalleryHint.hidden = ticketItems.length < 2;
}

// 横向长串：所有票根排成一行，通过滚动/拖拽切换
function buildTicketStrip() {
    ticketStripScroller.innerHTML = '';
    ticketStripScroller.scrollLeft = 0;
    walletItems = ticketItems.map((fp, i) => {
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
    ticketLightboxDescription.textContent = meta.description || '风吹洱海，云落苍山，生活在别处，也在此刻。';
    ticketLightboxDescription.hidden = false;
    ticketLightboxDetails.innerHTML = [
        ['城市', meta.route, 'route', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>'],
        ['省份', meta.province, 'province', ''],
        ['日期', meta.date, 'date', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17"/></svg>'],
        ['票号', meta.no, 'no', '']
    ].filter(item => item[1]).map(item => '<div class="ticket-meta-field ticket-meta-field-' + item[2] + '">' + item[3] + '<dt>' + ticketEscape(item[0]) + '</dt><dd>' + ticketEscape(item[1]) + '</dd></div>').join('');
    ticketLightboxCount.textContent = (ticketIndex + 1) + ' / ' + ticketItems.length;
}

function renderTicketWallet() {
    const fp = ticketItems[ticketIndex];
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
        const active = i === ticketIndex;
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
            const distance = Math.abs(i - ticketIndex);
            const k = Math.min(distance, 5);
            const dir = i < ticketIndex ? -1 : 1;
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
        const active = i === ticketIndex;
        img.classList.toggle('is-active', active);
        img.setAttribute('aria-label', (i + 1) + ' / ' + walletItems.length + ' ' + (item.fp.ticketTitle || item.fp.name || '票根'));
        img.tabIndex = active ? -1 : 0;
    });
    const current = walletItems[ticketIndex] && walletItems[ticketIndex].img;
    ticketLightboxLoading.hidden = !current || current.classList.contains('is-loaded') || current.classList.contains('is-error');
    ticketLightboxError.hidden = !current || !current.classList.contains('is-error');
    renderStripProgress();
}

// 字幕下方的极简指示线：亮点在线上随当前票根位置移动，其余部分保持低透明度
function renderStripProgress() {
    if (!ticketStripMode || !ticketStripProgress) return;
    const rail = ticketStripProgress.querySelector('.ticket-progress-rail');
    if (!rail) return;
    const total = ticketItems.length;
    rail.innerHTML = '';
    for (let i = 0; i < total; i++) {
        const segment = document.createElement('button');
        segment.type = 'button';
        segment.className = 'ticket-progress-segment' + (i === ticketIndex ? ' is-current' : '');
        segment.dataset.index = String(i);
        segment.setAttribute('aria-label', '查看第 ' + (i + 1) + ' 张票根');
        segment.setAttribute('aria-current', i === ticketIndex ? 'true' : 'false');
        rail.appendChild(segment);
    }
}

function openTicketLightbox(index, trigger) {
    ticketItems = ticketItemsFromFootprints();
    ticketIndex = Math.max(0, Math.min(index, ticketItems.length - 1));
    ticketTrigger = trigger || null;
    buildTicketWallet();
    renderTicketWallet();
    if (ticketStripMode) {
        requestAnimationFrame(() => {
            centerStripItem(ticketIndex, false);
            positionStripArchive();
        });
    }
    focusTicketGalleryControl();
}

function closeTicketLightbox(returnFocus = true) {
    if (!ticketLightbox) return;
    // 保留已加载图片供下次复用，避免每次打开票根都重新请求
    walletItems = [];
    setTicketView(false);
    if (returnFocus && ticketTrigger) ticketTrigger.focus();
    ticketTrigger = null;
}

function switchTicket(delta) {
    if (ticketItems.length < 2) return;
    ticketIndex = (ticketIndex + delta + ticketItems.length) % ticketItems.length;
    renderTicketWallet();
    if (ticketStripMode) centerStripItem(ticketIndex, true);
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

function centerStripItem(index, smooth) {
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
    if (!ticketStripMode || ticketItems.length < 2) return;
    const idx = nearestStripIndex();
    if (idx === ticketIndex) return;
    // 只在真正切换到另一张票根时，把新票根平滑吸附到视口正中央
    ticketIndex = idx;
    renderTicketWallet();
    centerStripItem(idx, true);
}

// 方案 1：票据档案页垫在当前票根下，只从票根下缘露出一截
let stripArchiveRaf = null;
function positionStripArchive() {
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
    if (index === ticketIndex) {
        ticketLightboxLoading.hidden = false;
        ticketLightboxError.hidden = true;
    }
    img.src = ticketImageUrl(item.fp.ticketImage);
}


/**
 * 绑定票根册的全部交互，并在需要时按 ?view=tickets 直接打开。
 * 必须在 setupTicketGallery 之后调用一次。
 */
export function initTicketGallery() {
    ticketStripMode = !!((deps.footprintCfg() || {}).ticketGalleryStyle === 'strip');
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
        ticketItems = ticketItemsFromFootprints();
        ticketIndex = 0;
        buildTicketWallet();
        renderTicketWallet();
        updateTicketFeatureButtons();
    });
    ticketReplayPlay.addEventListener('click', () => {
        if (ticketReplayPlaying) pauseTicketReplay();
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
        const fp = ticketItems[ticketIndex];
        if (fp) openTicketLetter(fp);
    });
    ticketLetterBack.addEventListener('click', () => closeTicketLetter());
    ticketLetterDownload.addEventListener('click', downloadTicketLetter);
    ticketLetterShare.addEventListener('click', shareTicketLetter);
    ticketLetterRetry.addEventListener('click', () => { renderTicketLetter(); });
    ticketPassportReset.addEventListener('click', () => {
        if (!window.confirm('确定清除这台设备上的全部集章记录吗？')) return;
        ticketPassportRecords = [];
        persistTicketPassport();
        if (ticketPassport.classList.contains('show')) renderTicketPassport();
        updateTicketPassportButton();
        updateTicketStampBadge(ticketItems[ticketIndex], false);
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
    ticketLightboxRetry.addEventListener('click', () => reloadTicket(ticketIndex));
    ticketStripProgress.querySelector('.ticket-progress-rail').addEventListener('click', event => {
        const segment = event.target.closest('.ticket-progress-segment');
        if (!segment) return;
        const index = Number(segment.dataset.index);
        if (Number.isInteger(index)) {
            ticketIndex = index;
            renderTicketWallet();
            centerStripItem(ticketIndex, true);
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
        if (index === ticketIndex) {
            switchTicket(1);
        } else {
            ticketIndex = index;
            renderTicketWallet();
        }
    });
    // 鼠标滚轮切换
    ticketWallet.addEventListener('wheel', event => {
        if (ticketItems.length < 2 || wheelLocked) return;
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
        if (!ticketStripMode || ticketItems.length < 2) return;
        event.preventDefault();
        const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        ticketStripScroller.scrollLeft += delta;
        clearTimeout(stripScrollTimer);
        stripScrollTimer = setTimeout(snapStrip, 160);
    }, { passive: false });

    ticketStripScroller.addEventListener('pointerdown', event => {
        if (!ticketStripMode || ticketItems.length < 2) return;
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
        if (!ticketStripMode || !ticketGallery.classList.contains('show') || ticketItems.length < 2) return;
        updateStripPadding();
        requestAnimationFrame(() => {
            centerStripItem(ticketIndex, false);
            positionStripArchive();
        });
    });

    // 票根页背景点击：票夹里点空白 = 返回地球（原有设计）。
    // 重走时不能沿用：重走层是 pointer-events: none 的点击穿透层，点空白会打到这里，
    // 于是"点一下地球"就误退到地球并丢掉正在放的那一段。
    ticketLightbox.addEventListener('click', event => {
        if (event.target !== ticketLightbox) return;
        if (ticketViewMode === 'replay') {
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
        if (ticketGallery.classList.contains('show') && ticketViewMode === 'replay') {
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
        if (!document.hidden || ticketViewMode !== 'replay') return;
        if (!ticketGallery.classList.contains('show')) return;
        pauseTicketReplay();
    });
    document.addEventListener('footprints:loaded', () => {
        if (ticketGallery.classList.contains('show')) {
            ticketItems = ticketItemsFromFootprints();
            ticketIndex = 0;
            buildTicketWallet();
            renderTicketWallet();
            if (ticketStripMode) {
                requestAnimationFrame(() => {
                    centerStripItem(ticketIndex, false);
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
