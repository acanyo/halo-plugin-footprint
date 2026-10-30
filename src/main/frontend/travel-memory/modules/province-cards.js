/**
 * 省份城市卡片：点省份 → 每个有足迹的城市各出一张小卡片 + 一条引线。
 *
 * 设计要点：
 * - 省份面的填充是 alpha=0（Cesium 的拾取通道会直接丢弃这类片元），
 *   命中判定只能走几何计算（pointInRing / pointInProvince）；
 * - 卡片按各自标记的屏幕位置分左右两侧、沿边错开排布；
 * - 相机完全不动；线画在屏幕空间的 SVG 上，随地球转动与卡片拖动实时跟随；
 * - 拖拽过的不再参与自动排版，再点一次该省份时重新排版。
 *
 * 本文件管卡片组的状态与流程：打开 / 关闭、「全部城市」自动缩放、悬停强调、
 * 每帧重排、拖拽与点击。纯计算与 DOM 细节拆在旁边几个文件里：
 *   - province-index.js          边界几何索引、命中判定、省份高亮材质；
 *   - province-card-layout.js    沿边布局算法；
 *   - province-card-dom.js       卡片与连线节点、连线几何刷新；
 *   - province-card-entrance.js  入场 / 退场动画。
 */

import { SVG_NS } from './env.js';
import { hidePhotoRing } from './photo-ring.js';
import {
    loadProvinceIndex,
    currentProvinceIndex,
    pointInProvince,
    provinceAdcodeOfEntity,
    provinceInfoByAdcode,
    normalizeProvinceName,
    provinceLabelWorldFromInfo,
    applyProvinceHighlight
} from './province-index.js';
import { arrangeProvinceCards } from './province-card-layout.js';
import {
    PROVINCE_CARD_WIDTH,
    PROVINCE_CARD_HEIGHT,
    PROVINCE_LINE_DOT_R,
    PROVINCE_LINE_DOT_R_ACTIVE,
    createProvinceCardNodes,
    applyProvinceCardBox,
    drawProvinceLeaderLines,
    placeProvinceLabel
} from './province-card-dom.js';
import {
    attachProvinceCardDrag,
    isProvinceCardDragging,
    resetProvinceCardDrag,
    cancelProvinceCardClick
} from './province-card-drag.js';
import {
    flyToChinaForCityCards,
    stopProvinceAllFlight,
    isProvinceAllFlying,
    provinceAllBtnEl,
    setProvinceAllBtnPressed,
    syncProvinceAllBtnEnabled
} from './province-all-flight.js';
import {
    planProvinceEntrance,
    startProvinceCardsFly,
    startProvinceMarkerPulse,
    stopProvinceMarkerPulse,
    startProvinceLinesGrow,
    animateProvinceCardsExit
} from './province-card-entrance.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints                 () => Footprint[]
 * @param d.cityList                   () => [{city, indices}]
 * @param d.markerEntities / d.cityMarkerEntities  () => Entity[]
 * @param d.cityMode / d.focusedMarker / d.boundaryVisible  () => 状态
 * @param d.markerCard / d.cityCard / d.viewer  () => HTMLElement / Cesium.Viewer
 * @param d.reduceMotion               () => boolean
 * @param d.applyCityFillHighlight / d.cityFillAdcodeOf / d.cityCenter
 * @param d.cityPhotoItems / d.cityViewItems / d.enqueueCardCover / d.renderCardCover
 * @param d.formatCityDate / d.showCityCard / d.hideCityCard / d.hideMarkerCard
 * @param d.openCityView / d.pauseAutoRotate / d.resumeAutoRotate
 * @param d.refreshMarkerColors / d.setMarkerFocus
 */
export function setupProvinceCards(d) {
    deps = d;
}

// ================= 省份城市卡片（点击省份 → 每个有足迹的城市各一张小卡片 + 抛物线） =================
// 状态与常量提前声明：updateIntroVisibility() 在本文件中段就会直接调用一次，
// 早于文末的「省份城市卡片」函数区，写在后面会踩到 TDZ。
const PROVINCE_CARD_MIN_WIDTH = 821;        // 窄屏（<= 820px）不生效，与 CSS 断点一致
let provinceEls = null;             // { svg, label, layer }，惰性取值避免 TDZ
let provinceCardsActive = false;    // 卡片组是否打开
let provinceCardsMode = 'province'; // 'province' 单省展开 / 'all' 全部城市展开
let provinceCardsAdcode = '';       // 当前省份 adcode
let provinceCardsItems = [];        // [{ ci, el, group, path, dot, grad, ... }]
let provinceLabelText = '';         // 省名标注文本
let provinceLabelWorld = null;      // 省名标注的世界坐标
let provinceCitiesSet = new Set();  // 当前省份的城市下标（标记明暗判定用）
let provinceBrightEntities = new Set();   // 选中省份要保亮的标记实体
let provinceLayoutDirty = true;
let provinceRestorePending = null;  // 从城市相册返回后要恢复的省份
let provinceFocusItem = null;       // 当前被悬停/聚焦的卡片（对应连线整条拉满）
let provinceEntranceUntil = 0;      // 入场动画结束时间戳：期间锁住重排（transform 与 dash 都怕被改写）
let provinceCardsToken = 0;         // 打开 / 关闭的世代号：退场动画的收尾不能被新的一组误清
let provinceHintShown = false;      // 本次会话是否已经提示过"省份可以点"
let provinceHintTimer = null;

let cityFillIndex = new Map();      // 城市高亮图层：adcode -> { entities }（悬停卡片时换色用）
let cityFillHighlightAdcode = '';   // 当前被换成青蓝的城市高亮
let hoveredProvince = false;        // 光标是否停在可点击的省份上

// ================= 省份城市卡片（点击省份 → 每个有足迹的城市各一张小卡片 + 抛物线） =================
// 设计要点：
// - 省份面的填充是 alpha=0（Cesium 的拾取通道会直接丢弃这类片元），命中判定只能走几何计算；
// - 每个有足迹的城市各出一张卡 + 一条线，卡片按各自标记的屏幕位置分左右两侧、错开排布；
// - 相机完全不动；线画在屏幕空间的 SVG 上，随地球转动与卡片拖动实时跟随；
// - 拖拽过的不再参与自动排版，再点一次该省份时重新排版。

function provinceElements() {
    if (!provinceEls) {
        provinceEls = {
            svg: document.getElementById('leaderOverlay'),
            label: document.getElementById('provinceLabel'),
            layer: document.getElementById('provinceCardLayer')
        };
    }
    return provinceEls;
}

function provinceCardsEnabled() {
    return window.innerWidth >= PROVINCE_CARD_MIN_WIDTH;
}

// 展开城市卡片的前置条件：桌面端 + 3D 场景 + 城市聚合态（这一层才有城市标记可连）
export function cityCardsEnabled() {
    if (!provinceCardsEnabled()) return false;
    if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) return false;
    return deps.cityMode();
}

// 省份可点还多一条：中国轮廓已经显示（放大到国内范围）
export function provincePickingEnabled() {
    return cityCardsEnabled() && deps.boundaryVisible();
}

export function provinceAtScreenPoint(point) {
    // 1) 省界描边（alpha=1 的折线）与城市高亮的面都能被 scene.pick 命中，命中就直接给答案
    const picked = deps.viewer().scene.pick(point);
    if (picked && picked.id) {
        const hit = provinceInfoByAdcode(provinceAdcodeOfEntity(picked.id), true);
        if (hit) return hit;
    }
    // 2) 省面本体（alpha=0）拾取不到，退回几何判定：屏幕坐标 → 椭球交点 → 经纬度
    const cartesian = deps.viewer().camera.pickEllipsoid(point, deps.viewer().scene.globe.ellipsoid);
    if (!cartesian) return null;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    return pointInProvince(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude));
}

let provinceHoverCheckedAt = 0;
let provinceHoverCached = false;
export function provinceHoverAt(point) {
    const now = performance.now();
    if (now - provinceHoverCheckedAt < 100) return provinceHoverCached;   // 节流到约 10 次/秒
    provinceHoverCheckedAt = now;
    provinceHoverCached = false;
    if (!provincePickingEnabled()) return false;
    provinceHoverCached = !!provinceAtScreenPoint(point);
    return provinceHoverCached;
}

// ---------- 省份 → 城市 ----------

// 优先 adcode 精确匹配；老数据缺 adcode 时才退回省名归一化匹配
function provinceCitiesOf(adcode, name) {
    const exact = [];
    const byName = [];
    const targetName = normalizeProvinceName(name);
    deps.cityList().forEach((city, ci) => {
        const fp = deps.footprints()[city.indices[0]];
        if (!fp) return;
        if (fp.provinceAdcode) {
            if (String(fp.provinceAdcode) === String(adcode)) exact.push(ci);
            return;
        }
        if (targetName && normalizeProvinceName(fp.province) === targetName) byName.push(ci);
    });
    return exact.length ? exact : byName;
}

// 选中省份时要保亮的标记实体（城市聚合标记 + 这些城市的足迹标记）
function collectProvinceBrightEntities(cities) {
    const set = new Set();
    cities.forEach(ci => {
        const marker = deps.cityMarkerEntities()[ci];
        if (marker) set.add(marker);
        const city = deps.cityList()[ci];
        if (!city) return;
        city.indices.forEach(fi => {
            const ent = deps.markerEntities()[fi];
            if (ent) set.add(ent);
        });
    });
    return set;
}

// ---------- 打开 / 关闭 ----------
// 点击入口：再点同一个省 = 重新排版（把拖拽过的卡片放回自动布局），收起交给点空白 / Esc
export function openProvinceCards(adcode) {
    if (provinceCardsActive && provinceCardsAdcode === String(adcode) && provinceCardsMode === 'province') {
        relayoutProvinceCards();
        return true;
    }
    return activateProvinceCards(adcode);
}

export function activateProvinceCards(adcode) {
    if (!provinceCardsEnabled()) return false;
    if (!currentProvinceIndex()) {
        loadProvinceIndex().then(() => { provinceLayoutDirty = true; });
        return false;
    }
    const info = provinceInfoByAdcode(adcode, false) || currentProvinceIndex().get(String(adcode));
    if (!info) return false;
    const cities = provinceCitiesOf(info.adcode, info.name);
    if (!cities.length) return false;   // 无足迹的省份：什么都不做（也不关闭已打开的卡片）
    return activateCityCards({
        mode: 'province',
        adcode: info.adcode,
        cities: cities,
        labelText: info.name + ' · ' + cities.length + ' 座城市',
        labelWorld: provinceLabelWorldFromInfo(info)
    });
}

// 通用入口：一次性展开一组城市的卡片与连线。
// 省份点击、导航栏「全部城市」都走这里，未来别的入口也复用同一套布局 / 避让 / 连线。
function activateCityCards(config) {
    if (!provinceCardsEnabled()) return false;
    const cities = (config && config.cities) || [];
    if (!cities.length) return false;

    hidePhotoRing();                    // 省份卡片组与照片环互斥
    closeProvinceCards();               // 换组前先清掉上一组（含高亮与卡片）
    // 关键：新的一组立刻接管这一层。上面的 closeProvinceCards() 会排一个
    // "退场动画结束后清空 DOM" 的定时器，世代号不自增的话，它 320ms 后会把
    // 刚画好的新卡片一起清掉（表现为"点另一个省：卡片闪一下就没了，之后再也点不出来"）。
    provinceCardsToken++;
    provinceRestorePending = null;
    // 省份卡片组与详情卡互斥
    if (deps.markerCard().classList.contains('visible')) deps.hideMarkerCard();
    if (deps.cityCard() && deps.cityCard().classList.contains('visible')) deps.hideCityCard(false);

    provinceCardsActive = true;
    provinceCardsMode = config.mode || 'province';
    provinceCardsAdcode = config.adcode || '';
    provinceCitiesSet = new Set(cities);
    provinceBrightEntities = collectProvinceBrightEntities(cities);
    provinceLabelText = config.labelText || '';
    provinceLabelWorld = config.labelWorld || null;

    buildProvinceCardDom(cities);
    if (config.adcode) applyProvinceHighlight(config.adcode);
    deps.refreshMarkerColors();
    deps.pauseAutoRotate('province-cards');
    document.body.classList.add('card-open');
    measureProvinceCards();
    provinceLayoutDirty = true;
    layoutProvinceCards();                       // 先算出落点，卡片此刻还不可见
    // 打开的同时把卡片层暴露给读屏（层里是 role=button 的卡片）
    const layerEl = provinceElements().layer;
    if (layerEl) {
        layerEl.setAttribute('aria-label', provinceLabelText || '城市卡片');
        layerEl.setAttribute('aria-hidden', 'false');
    }
    hideProvinceHint();                          // 用户已经会点了，提示可以退场
    const entranceMs = planProvinceEntrance(provinceCardsItems, provinceCardsMode === 'all', provinceCityCenterOf);
    provinceEntranceUntil = deps.reduceMotion() ? 0 : performance.now() + entranceMs;
    startProvinceCardsFly(provinceCardsItems, layerEl, deps.reduceMotion);   // A：卡片从自己的标记飞出来
    startProvinceLinesGrow(provinceCardsItems, deps.reduceMotion);   // B：线与卡片共用同一套错峰
    startProvinceMarkerPulse(provinceCardsItems, {   // C：起点脉冲（仅「全部城市」）
        reduceMotion: deps.reduceMotion,
        allMode: provinceCardsMode === 'all',
        cityMarkerEntities: deps.cityMarkerEntities,
        focusedMarker: deps.focusedMarker,
        isActive: () => provinceCardsActive
    });
    startProvinceCoverLoads(provinceCardsItems); // 封面按入场顺序排队（并发限流）
    syncProvinceAllBtn();
    return true;
}

// 封面加载跟着展开顺序走：先飞出来的卡片先排队，避免 16 张卡同时开火抢带宽。
function startProvinceCoverLoads(items) {
    items
        .slice()
        .sort((a, b) => (a.cardDelay || 0) - (b.cardDelay || 0))
        .forEach(item => deps.enqueueCardCover(item.coverRequest));
}

// 「全部城市」错峰按经度排：取城市中心（转到当前底图坐标系后的平均位置）
function provinceCityCenterOf(ci) {
    return deps.cityList()[ci] ? deps.cityCenter(deps.cityList()[ci]) : null;
}

// 一键展开：所有去过的城市各一张卡片 + 一条连线
export function activateAllCityCards() {
    if (!cityCardsEnabled()) return false;
    const cities = deps.cityList().map((city, ci) => ci);
    if (!cities.length) return false;
    const open = () => activateCityCards({
        mode: 'all',
        adcode: '',
        cities: cities,
        labelText: '全部城市 · ' + cities.length + ' 座',
        labelWorld: allCitiesLabelWorld()
    });
    // 相机还没放大到能看见中国轮廓（或者整球视图下城市挤成一团）时，
    // 先自动飞到"能看见轮廓、城市也散得开"的层级，落地后再展开卡片。
    if (!deps.boundaryVisible()) {
        flyToChinaForCityCards(deps.viewer, deps.reduceMotion, () => {
            if (cityCardsEnabled()) open();
        }, syncProvinceAllBtn);
        return true;
    }
    return open();
}

export function cancelAllCityFlight() {
    if (stopProvinceAllFlight(deps.viewer)) syncProvinceAllBtn();
}

// 全部城市标注的落点：所有城市中心的世界坐标平均值
function allCitiesLabelWorld() {
    let lng = 0;
    let lat = 0;
    let count = 0;
    deps.cityList().forEach(city => {
        const center = deps.cityCenter(city);
        if (!center || !Number.isFinite(center.lng) || !Number.isFinite(center.lat)) return;
        lng += center.lng;
        lat += center.lat;
        count++;
    });
    if (!count) return null;
    return Cesium.Cartesian3.fromDegrees(lng / count, lat / count, 0);
}

export function closeProvinceCards() {
    cancelAllCityFlight();   // 收起整组时，还没落地的"自动缩放"也要停掉
    if (!provinceCardsActive && !provinceCardsItems.length) return;
    cancelProvinceCardClick();   // 收起时顺带取消还没落地的单/双击判定
    // 退场动画要用到这批元素，先留个副本；世代号保证收尾不会清掉"期间新开的一组"
    const exiting = provinceCardsItems.slice();
    const token = ++provinceCardsToken;
    // 收起时把入场动画的收尾状态一并清掉：脉冲停掉、被脉冲鼓起来的标记还回基准尺寸
    provinceEntranceUntil = 0;
    stopProvinceMarkerPulse();
    provinceCardsItems.forEach(item => {
        const ent = deps.cityMarkerEntities()[item.ci];
        if (ent && ent.billboard && deps.focusedMarker() !== ent && ent.billboard.scale !== 1) {
            ent.billboard.scale = 1;
        }
    });
    // 收起前先还掉"卡片悬停把某座城市标记提亮"的临时状态，
    // 否则那个标记会一直停在放大/全亮的样子
    if (deps.focusedMarker() && provinceCardsItems.some(item => deps.cityMarkerEntities()[item.ci] === deps.focusedMarker())) {
        deps.setMarkerFocus(null);
    }
    provinceCardsActive = false;
    provinceCardsMode = 'province';
    provinceCardsAdcode = '';
    provinceCitiesSet = new Set();
    provinceBrightEntities = new Set();
    provinceFocusItem = null;
    deps.applyCityFillHighlight('');   // 城市高亮还原成主题金色
    resetProvinceCardDrag();
    provinceCardsItems = [];
    provinceLabelText = '';
    provinceLabelWorld = null;
    const els = provinceElements();
    if (els.layer) {
        els.layer.setAttribute('aria-hidden', 'true');   // 关着就把整层从读屏里撤掉
    }
    if (els.svg) {
        // 悬停状态下关掉整组时，"其余线压暗"的整层状态要一起还原，
        // 否则下一次打开卡片组会一上来就是全暗的
        els.svg.classList.remove('has-focus');
    }
    // 有元素就播退场（卡片缩回自己的标记、连线向标记收回），没有或减弱动效时直接清
    if (!deps.reduceMotion() && exiting.length) {
        animateProvinceCardsExit(exiting, els, () => token === provinceCardsToken, () => provinceCardsItems.length > 0);
    } else {
        if (els.layer) els.layer.innerHTML = '';
        if (els.svg) els.svg.innerHTML = '';
    }
    if (els.label) {
        els.label.classList.remove('show');
        els.label.textContent = '';
    }
    applyProvinceHighlight('');
    deps.refreshMarkerColors();
    // 详情卡还开着时不要抢它的 card-open（右下角浮动按钮的让位状态由详情卡决定）
    const markerCardEl = document.getElementById('markerCard');
    const cityCardEl = document.getElementById('cityCard');
    const detailOpen = (markerCardEl && markerCardEl.classList.contains('visible')) ||
        (cityCardEl && cityCardEl.classList.contains('visible'));
    if (!detailOpen) document.body.classList.remove('card-open');
    deps.resumeAutoRotate('province-cards');
    syncProvinceAllBtn();
}

// 再点一次同一个省 = 重新排版（解开拖拽过的卡片，让它们回到自动布局）
function relayoutProvinceCards() {
    if (!provinceCardsActive || !provinceCardsItems.length) return;
    provinceCardsItems.forEach(item => {
        item.locked = false;
        if (item.el) item.el.classList.add('is-flying');   // 借入场飞行态的过渡，位移不硬跳
    });
    provinceLayoutDirty = true;
    layoutProvinceCards();
    window.setTimeout(() => {
        provinceCardsItems.forEach(item => {
            if (item.el) item.el.classList.remove('is-flying');
        });
    }, 420);
}

// ---------- 一次性提示：告诉首次放大到国内范围的用户"省份可以点" ----------
// 只在桌面端、本次会话第一次出现中国轮廓时展示，6 秒后自动退场；
// 用户一旦点开卡片组就立刻收起（说明他已经会了）。
const PROVINCE_HINT_MS = 6000;
export function maybeShowProvinceHint() {
    if (provinceHintShown || !provinceCardsEnabled()) return;
    provinceHintShown = true;
    const el = document.getElementById('provinceHint');
    if (!el) return;
    el.classList.add('show');
    if (provinceHintTimer) clearTimeout(provinceHintTimer);
    provinceHintTimer = window.setTimeout(hideProvinceHint, PROVINCE_HINT_MS);
}

function hideProvinceHint() {
    if (provinceHintTimer) {
        clearTimeout(provinceHintTimer);
        provinceHintTimer = null;
    }
    const el = document.getElementById('provinceHint');
    if (el) el.classList.remove('show');
}

// ---------- 卡片 DOM ----------
function provinceCardViewModel(ci) {
    const city = deps.cityList()[ci] || {};
    const fps = deps.cityViewItems(ci);
    const photos = deps.cityPhotoItems(ci);
    const latest = fps.map(fp => fp.createTime).filter(Boolean).sort().pop();
    return {
        name: city.city || '未命名城市',
        count: fps.length,
        photos: photos.length,
        cover: photos.length ? photos[0].url : '',
        latest: latest ? deps.formatCityDate(latest).replace(/\s*\/\s*/, '.') : ''
    };
}

function buildProvinceCardDom(cities) {
    const els = provinceElements();
    if (!els.layer || !els.svg) return;
    els.layer.innerHTML = '';
    els.svg.innerHTML = '';
    const defs = document.createElementNS(SVG_NS, 'defs');
    els.svg.appendChild(defs);

    provinceCardsItems = cities.map((ci, index) => {
        const view = provinceCardViewModel(ci);

        // 卡片本体与连线节点（见 province-card-dom.js），这里只把它们组装成卡片项并接上交互
        const nodes = createProvinceCardNodes(view, index, els, defs, deps.renderCardCover);
        const el = nodes.el;

        const item = {
            ci: ci,
            el: el,
            group: nodes.group,
            pathBase: nodes.pathBase,
            path: nodes.path,
            dot: nodes.dot,
            grad: nodes.grad,
            coverRequest: nodes.coverRequest,
            x: 0, y: 0,
            w: PROVINCE_CARD_WIDTH, h: PROVINCE_CARD_HEIGHT,
            edge: 'right',
            locked: false, anchor: null
        };
        attachProvinceCardDrag(item, {
            onMove: updateProvinceLeaderLines,
            onOpenAlbum: openProvinceCityAlbum,
            onOpenCityCard: openProvinceCityCard
        });
        el.addEventListener('pointerenter', () => setProvinceCardFocus(item, true));
        el.addEventListener('pointerleave', () => {
            // 键盘焦点还在卡片上时不移除高亮（鼠标移开不该把 Tab 选中的线也熄掉）
            if (document.activeElement !== el) setProvinceCardFocus(item, false);
        });
        el.addEventListener('focus', () => setProvinceCardFocus(item, true));
        el.addEventListener('blur', () => {
            if (!el.matches(':hover')) setProvinceCardFocus(item, false);
        });
        // 这里不加 .show：卡片要保持不可见，等布局算出落点后由入场动画统一放飞
        return item;
    });
}

// 悬停 / 键盘聚焦某张卡片：自己的连线拉满、其余连线压暗（对比才是重点），
// 起点圆点放大并呼吸，同时把对应的城市标记一起提亮放大 ——
// 复用悬停标记那套视觉语言，让「卡片 ↔ 连线 ↔ 标记」串成一条链。
function setProvinceCardFocus(item, on) {
    if (!item || !item.el) return;
    // 转到地球背面（或还没定位）的卡片不接受强调：它的线本来就是隐藏的，
    // 若被键盘 Tab 聚焦点亮，会出现"没有卡片却有一条高亮线"的怪状态。
    if (on && item.visible === false) return;
    const els = provinceElements();
    item.el.style.zIndex = on ? '120' : String(10 + (item.layoutIndex || 0));
    provinceFocusItem = on ? item : (provinceFocusItem === item ? null : provinceFocusItem);
    item.group.classList.toggle('is-active', on);
    if (item.path) item.path.classList.toggle('is-active', on);
    if (item.dot) {
        item.dot.classList.toggle('is-active', on);
        item.dot.setAttribute('r', String(on ? PROVINCE_LINE_DOT_R_ACTIVE : PROVINCE_LINE_DOT_R));
    }
    if (els.svg) els.svg.classList.toggle('has-focus', on);
    const marker = deps.cityMarkerEntities()[item.ci];
    if (!on) {
        if (marker && deps.focusedMarker() === marker) deps.setMarkerFocus(null);   // 会按当前状态把颜色刷回去
        else deps.refreshMarkerColors();
        deps.applyCityFillHighlight('');   // 城市高亮还回主题金色
        return;
    }
    // 只有「全部城市」模式才额外强调"是哪座城"：把该城市的**城市高亮填充**（主题金色）
    // 换成省份同款青蓝，并把它自己的标记放大、其余标记压暗。
    // 省份模式下省份轮廓已经把这一片标出来了，悬停只强调连线，不动球面上的任何高亮。
    if (provinceCardsMode !== 'all') return;
    if (marker) deps.setMarkerFocus(marker);
    deps.refreshMarkerColors();
    deps.applyCityFillHighlight(deps.cityFillAdcodeOf(item.ci));
}

// 卡片高度由内容决定（写死高度会把信息裁掉），所以布局前先量一次真实尺寸；
// 只在建组与 resize 时量，避免每帧读 offsetHeight 触发强制布局。
function measureProvinceCards() {
    provinceCardsItems.forEach(item => {
        if (!item.el) return;
        item.w = item.el.offsetWidth || PROVINCE_CARD_WIDTH;
        item.h = item.el.offsetHeight || PROVINCE_CARD_HEIGHT;
    });
}

function layoutProvinceCards() {
    provinceLayoutDirty = false;
    if (!provinceCardsActive || !provinceCardsItems.length) return;
    arrangeProvinceCards(provinceCardsItems, cityMarkerScreenPosition, applyProvinceCardBox);   // 见 province-card-layout.js
    updateProvinceLeaderLines();
    updateProvinceLabelPosition();
}

// 城市聚合标记的屏幕坐标；转到地球背面或数据缺失时返回 null
function cityMarkerScreenPosition(ci) {
    const ent = deps.cityMarkerEntities()[ci];
    if (!ent) return null;
    const pos = ent.position && ent.position.getValue(Cesium.JulianDate.now());
    if (!pos) return null;
    const normal = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
    const toCamera = Cesium.Cartesian3.subtract(deps.viewer().camera.positionWC, pos, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.dot(normal, toCamera) < 0) return null;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, pos);
    return screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
}

// 连线几何见 province-card-dom.js；这里只把卡片组状态交过去
function updateProvinceLeaderLines() {
    drawProvinceLeaderLines(provinceCardsItems, provinceCardsActive, item => {
        // 刚被转走的这张如果正被悬停/聚焦：连同"其余线压暗"的整层状态一起还原
        if (provinceFocusItem === item) setProvinceCardFocus(item, false);
    });
}

// 省名标注的定位见 province-card-dom.js
function updateProvinceLabelPosition() {
    placeProvinceLabel(provinceElements().label, provinceCardsActive, provinceLabelText, provinceLabelWorld, deps.viewer());
}

// 每帧只在「相机真的动了 / 布局脏 / 正在拖拽」时更新，静止浏览时整段跳过
const provinceCamPos = new Cesium.Cartesian3();
const provinceCamDir = new Cesium.Cartesian3();
let provinceCamReady = false;
function provinceCameraMoved() {
    const camera = deps.viewer().camera;
    if (provinceCamReady &&
        Cesium.Cartesian3.equalsEpsilon(camera.positionWC, provinceCamPos, Cesium.Math.EPSILON6) &&
        Cesium.Cartesian3.equalsEpsilon(camera.directionWC, provinceCamDir, Cesium.Math.EPSILON6)) {
        return false;
    }
    Cesium.Cartesian3.clone(camera.positionWC, provinceCamPos);
    Cesium.Cartesian3.clone(camera.directionWC, provinceCamDir);
    provinceCamReady = true;
    return true;
}

function updateProvinceOverlays() {
    if (!provinceCardsActive) return;
    if (isProvinceCardDragging()) {
        // 拖拽中卡片位置由指针决定，只刷新连线与标注
        updateProvinceLeaderLines();
        updateProvinceLabelPosition();
        return;
    }
    if (performance.now() < provinceEntranceUntil) {
        // 入场动画期间锁住重排：卡片的 transform 归动画管（改写会打断过渡），
        // 线的铺开用的是"整段 dash"，路径长度一变就会出现断口。锚点仍按当前相机刷新。
        // 只在相机真的动了时才刷新 —— 展开瞬间相机通常静止，每帧刷 16 组坐标+32 次属性写是白费。
        if (provinceCameraMoved()) {
            provinceCardsItems.forEach(item => {
                item.anchor = cityMarkerScreenPosition(item.ci);
            });
            updateProvinceLeaderLines();
            updateProvinceLabelPosition();
        }
        return;
    }
    if (!provinceCameraMoved() && !provinceLayoutDirty) return;
    layoutProvinceCards();
}

// ---------- 点击（拖拽见 province-card-drag.js） ----------

// 打开单城市卡（大卡）。showCityCard 内部会收起省份卡片组（两者互斥），
// 收起走的是退场动画，所以视觉上是"小卡缩回、大卡从标记方向展开"。
function openProvinceCityCard(ci) {
    if (!deps.cityList()[ci]) return;
    deps.showCityCard(ci);
}

// 点卡片 = 进该城市的相册；返回地球后原样恢复这组卡片与连线
function openProvinceCityAlbum(ci) {
    if (!deps.cityList()[ci]) return;
    const adcode = provinceCardsAdcode;
    const mode = provinceCardsMode;
    closeProvinceCards();
    provinceRestorePending = mode === 'all'
        ? { mode: 'all' }
        : (adcode ? { mode: 'province', adcode: adcode } : null);
    deps.openCityView(ci, null);
}

// ---------- 导航栏「全部城市」入口（飞行与按钮 DOM 见 province-all-flight.js） ----------
function syncProvinceAllBtn() {
    // 自动缩放期间也算"已按下"：用户点了立刻有反馈，落地后无缝变成展开态
    setProvinceAllBtnPressed(isProvinceAllFlying() || (provinceCardsActive && provinceCardsMode === 'all'));
}

// 可用态：只有「3D + 桌面端 + 城市聚合态」时才可点（每帧调用，只在翻转时写 DOM）
export function syncProvinceAllAvailability() {
    syncProvinceAllBtnEnabled(cityCardsEnabled);
}

// 再点一次收起，和省份卡片是同一套开关语义
function toggleAllCityCards() {
    if (isProvinceAllFlying()) return true;   // 正在飞过去，忽略重复点击
    if (provinceCardsActive && provinceCardsMode === 'all') {
        closeProvinceCards();
        return true;
    }
    return activateAllCityCards();
}

/** 卡片组是否打开（标记明暗、Esc 逐级退、各入口开关都要读）。 */
export function isProvinceCardsActive() {
    return provinceCardsActive;
}

/** 当前卡片组里「要保亮」的标记实体集合，供 markerEmphasisColor 用。 */
export function provinceBrightEntitySet() {
    return provinceBrightEntities;
}

/** 光标是否停在可点的省份上（画布光标形状用）。 */
export function isHoveredProvince() {
    return hoveredProvince;
}

export function setHoveredProvince(value) {
    hoveredProvince = !!value;
}

/** 从城市相册返回后要恢复的省份；取出即清空。 */
export function takeProvinceRestorePending() {
    const pending = provinceRestorePending;
    provinceRestorePending = null;
    return pending;
}

export function clearProvinceRestorePending() {
    provinceRestorePending = null;
}

/**
 * 绑定省份卡片组的全部运行时监听。必须在 setupProvinceCards 之后调用一次。
 */
export function initProvinceCards() {
    // 与相机帧同步的浮层重排
    deps.viewer().scene.postRender.addEventListener(updateProvinceOverlays);

    // 导航栏「全部城市」按钮
    const btn = provinceAllBtnEl();
    if (btn) {
        btn.addEventListener('click', () => toggleAllCityCards());
        syncProvinceAllBtn();
        syncProvinceAllAvailability();
    }

    // 视口变化：重排；窄屏直接整组收起（门控与样式断点一致）
    window.addEventListener('resize', () => {
        if (!provinceCardsActive) return;
        if (!provinceCardsEnabled()) {
            closeProvinceCards();
            return;
        }
        measureProvinceCards();
        provinceLayoutDirty = true;
    });

    // 足迹数据重载后：省市对应关系可能变了，收起已打开的卡片组
    document.addEventListener('footprints:loaded', () => {
        if (provinceCardsActive) closeProvinceCards();
        hidePhotoRing();   // 数据重载后照片可能已变，收起照片环
    });

    loadProvinceIndex();   // 提前取一次边界数据，首次点击省份时不必等网络
}
