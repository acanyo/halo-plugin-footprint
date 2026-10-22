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
 * 这是前台最大的一块（约 1500 行）：命中判定、几何索引、卡片 DOM、沿边布局、
 * 入场/退场动画、拖拽、「全部城市」的自动缩放都在一起，彼此共享同一批状态。
 */

import { COARSE_POINTER, SVG_NS } from './env.js';
import { PROVINCE_CITY_HL_FILL, PROVINCE_MARKER_DIM_ALPHA } from './province-style.js';
import { hidePhotoRing } from './photo-ring.js';
import {
    clampNumber,
    round1,
    snapDevicePx,
    overlapArea
} from './geometry.js';

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
const PROVINCE_GEOJSON_URL = '/plugins/footprint/assets/static/data/china-full.json';
const PROVINCE_CARD_MIN_WIDTH = 821;        // 窄屏（<= 820px）不生效，与 CSS 断点一致
const PROVINCE_CARD_WIDTH = 244;            // 横版卡片默认档（与 CSS .prop-city-card 宽度一致）
const PROVINCE_CARD_HEIGHT = 96;
// 超过这个数量只压缩「同侧间距」，卡片尺寸保持不变 ——
// 同一个城市无论从省份进来还是从「全部城市」进来，都必须长得一模一样。
const PROVINCE_CARD_DENSE_LIMIT = 6;
const PROVINCE_CARD_GAP = 12;               // 同侧卡片最小间距（紧凑档减半）
// 同一条边上卡片的阶梯缩进：四档循环，避免排成一条笔直的队列
const PROVINCE_CARD_STAGGER = [0, 18, 36, 54];
// 「全部城市」自动缩放的落点：轮廓可见（< 9500km）且仍是城市聚合态（> 1500km）
const PROVINCE_ALL_FLY_HEIGHT = 8000000;
const PROVINCE_ALL_FLY_DURATION = 1.6;
const PROVINCE_ALL_FLY_LNG = 104.0;
const PROVINCE_ALL_FLY_LAT = 34.5;
const PROVINCE_SAFE_TOP = 88;               // 顶部导航 64 + 留白
const PROVINCE_SAFE_BOTTOM = 96;            // 底部留白
// 自动排版时离屏幕左右边缘的距离：不贴边，随视口宽度加大
const PROVINCE_SIDE_INSET_MIN = 76;
const PROVINCE_SIDE_INSET_RATIO = 0.07;
// 与「城市高亮」同源的琥珀金：整套选中态只有一种颜色
const PROVINCE_HL_FILL = 'rgba(255, 176, 103, 0.12)';
const PROVINCE_HL_STROKE = '#FFB067';
const PROVINCE_HL_STROKE_WIDTH = 1.4;
// 连线走「地图标注引线」那套材质：细线 + 底下压一层很淡的深色描边（浅色底图上保底）。
// 颜色取象牙白：中性暖白，和卡片文字同族、最不抢戏。
// 注意这一版和最早那版"暖米白"的区别：那时深色描边是 3px/0.6，在卫星影像上会拖出一圈暗边；
// 现在描边已压到 2.8px/0.42，观感会干净得多。
const PROVINCE_LINE_FROM = '#FFF3E0';
const PROVINCE_LINE_TO = 'rgba(255, 243, 224, 0.86)';
const PROVINCE_LINE_FAN = [0.10, 0.18];     // 弧度收敛：更像标注引线，不再像数据流
const PROVINCE_LINE_DOT_R = 3.6;            // 起点圆点：暖白实心 + 深色描边
const PROVINCE_LINE_DOT_R_ACTIVE = 5;
// ---- 展开动画：线到、卡到 ----
const PROVINCE_LINE_GROW_MS = 500;    // 线从标记铺到卡片的时长
const PROVINCE_CARD_FLY_MS = 500;     // 卡片从标记飞到落点的时长
const PROVINCE_CARD_LEAD_MS = 120;    // 卡片比线晚出发一点：线先探出去，卡片再沿线滑出
const PROVINCE_STAGGER_STEP_MS = 40;  // 相邻两张的错峰步长
const PROVINCE_STAGGER_MAX_MS = 600;  // 错峰总时长上限（卡片多时自动压缩步长）
const PROVINCE_PULSE_MS = 320;        // 起点"引爆"脉冲时长（仅「全部城市」）
let provinceEls = null;             // { svg, label, layer }，惰性取值避免 TDZ
let provinceCardsActive = false;    // 卡片组是否打开
let provinceCardsMode = 'province'; // 'province' 单省展开 / 'all' 全部城市展开
let provinceCardsAdcode = '';       // 当前省份 adcode
let provinceCardsItems = [];        // [{ ci, el, group, path, dot, grad, ... }]
let provinceLabelText = '';         // 省名标注文本
let provinceLabelWorld = null;      // 省名标注的世界坐标
let provinceCitiesSet = new Set();  // 当前省份的城市下标（标记明暗判定用）
let provinceBrightEntities = new Set();   // 选中省份要保亮的标记实体
let provinceHighlightAdcode = '';   // 当前高亮的省份（材质改写）
let provinceEntityMap = null;       // Map<adcode, Entity[]>，中国轮廓加载完成后建立
let provinceMaterialSnapshot = null;// Map<Entity, { fill, stroke, width }>，用于还原
let provinceIndex = null;           // Map<adcode, { name, center, bbox, polygons }>
let provinceIndexPromise = null;
let provinceGeoJsonPromise = null;  // china-full.json 的共享请求，见 loadProvinceGeoJson
let provinceLayoutDirty = true;
let provinceRestorePending = null;  // 从城市相册返回后要恢复的省份
let provinceDragState = null;
let provinceFocusItem = null;       // 当前被悬停/聚焦的卡片（对应连线整条拉满）
let provinceEntranceUntil = 0;      // 入场动画结束时间戳：期间锁住重排（transform 与 dash 都怕被改写）
let provincePulseRaf = null;        // 起点脉冲的 rAF 句柄
let provinceCardsToken = 0;         // 打开 / 关闭的世代号：退场动画的收尾不能被新的一组误清
let provinceHintShown = false;      // 本次会话是否已经提示过"省份可以点"
let provinceHintTimer = null;
let provinceCardClickTimer = null;  // 区分单击（进相册）与双击（打开单城市卡）

let cityFillIndex = new Map();      // 城市高亮图层：adcode -> { entities }（悬停卡片时换色用）
let cityFillHighlightAdcode = '';   // 当前被换成青蓝的城市高亮
let provinceAllFlight = false;      // 「全部城市」正在自动缩放到能看见中国轮廓
let provinceAllFlightHandler = null;
let provinceAllFlightTimer = null;
let hoveredProvince = false;        // 光标是否停在可点击的省份上
let provinceAllBtnCache = null;     // 「全部城市」导航按钮
let provinceAllAvailable = null;    // 按钮可用态缓存（只在变化时写 DOM）

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

// 卡片列到左右边缘的留白：不贴着屏幕边，宽屏再多让一点
function provinceSideInset() {
    return Math.max(PROVINCE_SIDE_INSET_MIN, Math.round(window.innerWidth * PROVINCE_SIDE_INSET_RATIO));
}

// 展开城市卡片的前置条件：桌面端 + 3D 场景 + 城市聚合态（这一层才有城市标记可连）
export function cityCardsEnabled() {
    if (!provinceCardsEnabled()) return false;
    if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) return false;
    return deps.cityMode();
}

// 省份可点还多一条：中国轮廓已经显示（放大到国内范围）
export function provincePickingEnabled() {
    return deps.cityCardsEnabled() && deps.boundaryVisible();
}

// ---------- 省份边界 GeoJSON（共享请求） ----------
// 这份 208 KB 的 china-full.json 有两个消费方：画轮廓的 GeoJsonDataSource，
// 和点省份时做几何判定的索引。两边原来各自发一次请求，且一个走 Cesium 的
// Resource、一个走 fetch，几乎同时发出谁也命中不了对方的缓存，
// 结果同一份文件在首屏下载两次（实测 208 KB × 2）。这里收敛成一次。
export function loadProvinceGeoJson() {
    if (!provinceGeoJsonPromise) {
        provinceGeoJsonPromise = fetch(PROVINCE_GEOJSON_URL, { referrerPolicy: 'no-referrer' })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .catch(e => {
                provinceGeoJsonPromise = null;   // 失败允许下次重试
                throw e;
            });
    }
    return provinceGeoJsonPromise;
}

// ---------- 省份边界索引（几何判定用） ----------
function loadProvinceIndex() {
    if (!provinceIndexPromise) {
        provinceIndexPromise = loadProvinceGeoJson()
            .then(geojson => {
                provinceIndex = buildProvinceIndex(geojson);
                return provinceIndex;
            })
            .catch(e => {
                provinceIndexPromise = null;   // 失败允许下次重试
                console.warn('省份边界索引导入失败：', e);
                return null;
            });
    }
    return provinceIndexPromise;
}

function buildProvinceIndex(geojson) {
    const index = new Map();
    const features = (geojson && geojson.features) || [];
    features.forEach(feature => {
        const props = (feature && feature.properties) || {};
        const adcode = String(props.adcode || '').trim();
        const geometry = feature && feature.geometry;
        // 只收省级编码（6 位纯数字）；南海诸岛那个空名分区（100000_JD）直接排除
        if (!geometry || !/^\d{6}$/.test(adcode)) return;
        const polygons = ringSetsOfGeometry(geometry);
        if (!polygons.length) return;
        index.set(adcode, {
            adcode: adcode,
            name: String(props.name || ''),
            center: Array.isArray(props.center) ? props.center : null,
            bbox: bboxOfPolygons(polygons),
            polygons: polygons
        });
    });
    return index;
}

// Polygon / MultiPolygon → [{ outer, holes }]，坐标摊平成 [lng, lat, ...] 的 Float64Array
function ringSetsOfGeometry(geometry) {
    const type = geometry.type;
    const coords = geometry.coordinates || [];
    const polygons = type === 'Polygon' ? [coords] : (type === 'MultiPolygon' ? coords : []);
    const out = [];
    polygons.forEach(rings => {
        if (!Array.isArray(rings) || !rings.length) return;
        const outer = flattenRing(rings[0]);
        if (!outer || outer.length < 6) return;
        const holes = [];
        for (let i = 1; i < rings.length; i++) {
            const hole = flattenRing(rings[i]);
            if (hole && hole.length >= 6) holes.push(hole);
        }
        out.push({ outer: outer, holes: holes });
    });
    return out;
}

function flattenRing(ring) {
    if (!Array.isArray(ring) || !ring.length) return null;
    const flat = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
        const point = ring[i];
        if (!Array.isArray(point)) return null;
        flat[i * 2] = Number(point[0]);
        flat[i * 2 + 1] = Number(point[1]);
    }
    return flat;
}

function bboxOfPolygons(polygons) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    polygons.forEach(set => {
        const ring = set.outer;
        for (let i = 0; i < ring.length; i += 2) {
            const lng = ring[i];
            const lat = ring[i + 1];
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
    });
    return [minLng, minLat, maxLng, maxLat];
}

// 射线法：环是闭合折线，首尾点重复与否都不影响结果
function pointInRing(lng, lat, ring) {
    let inside = false;
    const count = ring.length / 2;
    for (let i = 0, j = count - 1; i < count; j = i++) {
        const xi = ring[i * 2], yi = ring[i * 2 + 1];
        const xj = ring[j * 2], yj = ring[j * 2 + 1];
        if ((yi > lat) !== (yj > lat) &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function pointInProvince(lng, lat) {
    if (!provinceIndex) return null;
    for (const info of provinceIndex.values()) {
        const b = info.bbox;
        if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
        for (let i = 0; i < info.polygons.length; i++) {
            const set = info.polygons[i];
            if (!pointInRing(lng, lat, set.outer)) continue;
            let inHole = false;
            for (let h = 0; h < set.holes.length; h++) {
                if (pointInRing(lng, lat, set.holes[h])) { inHole = true; break; }
            }
            if (!inHole) return info;
        }
    }
    return null;
}

export function provinceAdcodeOfEntity(entity) {
    const props = entity && entity.properties;
    if (!props) return '';
    const raw = props.adcode;
    if (!raw) return '';
    const value = typeof raw.getValue === 'function' ? raw.getValue(Cesium.JulianDate.now()) : raw;
    return value ? String(value) : '';
}

// 省级编码直接命中；城市级编码（城市高亮图层的面）按前两位反推省级编码
function provinceInfoByAdcode(adcode, allowCity) {
    if (!provinceIndex || !adcode) return null;
    const direct = provinceIndex.get(String(adcode));
    if (direct) return direct;
    if (allowCity && /^\d{6}$/.test(String(adcode))) {
        return provinceIndex.get(String(adcode).slice(0, 2) + '0000') || null;
    }
    return null;
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
export function normalizeProvinceName(value) {
    return String(value || '')
        .replace(/\s/g, '')
        .replace(/(省|市)$/, '')
        .replace(/特别行政区$/, '')
        .replace(/自治区$/, '')
        .replace(/(维吾尔|壮族|回族|藏族)$/, '');
}

// 优先 adcode 精确匹配；老数据缺 adcode 时才退回省名归一化匹配
function provinceCitiesOf(adcode, name) {
    const exact = [];
    const byName = [];
    const targetName = normalizeProvinceName(name);
    deps.cityList().forEach((city, ci) => {
        const fp = deps.FOOTPRINTS()[city.indices[0]];
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

// ---------- 省份高亮（材质改写 + 记录原值还原） ----------
function applyProvinceHighlight(adcode) {
    const next = adcode ? String(adcode) : '';
    if (next === provinceHighlightAdcode) return;
    if (provinceMaterialSnapshot) {
        provinceMaterialSnapshot.forEach((saved, entity) => {
            if (entity.polygon && saved.fill) entity.polygon.material = saved.fill;
            if (entity.polyline && saved.stroke) entity.polyline.material = saved.stroke;
            if (entity.polyline && saved.width) entity.polyline.width = saved.width;
        });
    }
    provinceHighlightAdcode = next;
    if (!next || !provinceEntityMap) return;
    const entities = provinceEntityMap.get(next);
    if (!entities || !entities.length) return;
    // 每个实体单独赋新材质：所有实体最初共享同一个材质实例，改实例等于全省份一起变
    const fill = Cesium.Color.fromCssColorString(PROVINCE_HL_FILL);
    const stroke = Cesium.Color.fromCssColorString(PROVINCE_HL_STROKE);
    entities.forEach(entity => {
        if (entity.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(fill);
        if (entity.polyline) {
            entity.polyline.material = new Cesium.ColorMaterialProperty(stroke);
            entity.polyline.width = PROVINCE_HL_STROKE_WIDTH;
        }
    });
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
    if (!provinceIndex) {
        loadProvinceIndex().then(() => { provinceLayoutDirty = true; });
        return false;
    }
    const info = provinceInfoByAdcode(adcode, false) || provinceIndex.get(String(adcode));
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
    const entranceMs = planProvinceEntrance(provinceCardsItems);
    provinceEntranceUntil = deps.reduceMotion() ? 0 : performance.now() + entranceMs;
    startProvinceCardsFly(provinceCardsItems);   // A：卡片从自己的标记飞出来
    startProvinceLinesGrow();                    // B：线与卡片共用同一套错峰
    startProvinceMarkerPulse(provinceCardsItems); // C：起点脉冲（仅「全部城市」）
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

// ---------- 展开动画 ----------
// 错峰顺序：单省按"到城市群中心的距离"由内向外推开；全部城市按经度西→东扫过去。
// 卡片多时自动压缩步长，总错峰不超过 PROVINCE_STAGGER_MAX_MS。
function planProvinceEntrance(items) {
    if (!items.length) return 0;
    const step = items.length > 1
        ? Math.min(PROVINCE_STAGGER_STEP_MS, PROVINCE_STAGGER_MAX_MS / (items.length - 1))
        : 0;
    let centerX = 0;
    let centerY = 0;
    let counted = 0;
    items.forEach(item => {
        if (!item.anchor) return;
        centerX += item.anchor.x;
        centerY += item.anchor.y;
        counted++;
    });
    if (counted) {
        centerX /= counted;
        centerY /= counted;
    }
    const allMode = provinceCardsMode === 'all';
    const ordered = items.slice().sort((a, b) => provinceEntranceKey(a, centerX, centerY, allMode) -
        provinceEntranceKey(b, centerX, centerY, allMode));
    ordered.forEach((item, index) => {
        item.staggerDelay = index * step;
        item.lineDelay = item.staggerDelay;
        item.cardDelay = item.staggerDelay + PROVINCE_CARD_LEAD_MS;
    });
    let total = 0;
    items.forEach(item => {
        total = Math.max(total,
            (item.lineDelay || 0) + PROVINCE_LINE_GROW_MS,
            (item.cardDelay || 0) + PROVINCE_CARD_FLY_MS);
    });
    return total + 120;
}

function provinceEntranceKey(item, centerX, centerY, allMode) {
    if (allMode) {
        // 西→东：像一道波从西边扫到东边，正好对上"全国铺开"的语义
        const center = deps.cityList()[item.ci] ? deps.cityCenter(deps.cityList()[item.ci]) : null;
        return center && Number.isFinite(center.lng) ? center.lng : 0;
    }
    // 单省：由内向外推开，同一条边上的卡片按离标记群中心的远近依次出现
    if (!item.anchor) return Number.MAX_VALUE;
    return Math.hypot(item.anchor.x - centerX, item.anchor.y - centerY);
}

// 卡片入场：从自己那个城市标记的位置（略缩小）滑到布局算出的落点。
// 先把"起点态"钉在样式上再切终点态，否则浏览器会把两帧合并、变成原地淡入。
function startProvinceCardsFly(items) {
    const els = provinceElements();
    const flying = [];
    items.forEach(item => {
        const el = item.el;
        if (!el) return;
        el.classList.remove('is-flying');
        el.style.transitionDelay = '';
        if (deps.reduceMotion() || !item.anchor) {
            // 减弱动效、或卡片对应的标记在背面：直接落到最终位置（背面那批由 is-hidden 负责隐藏）
            el.style.transform = 'translate3d(' + Math.round(item.x) + 'px,' + Math.round(item.y) + 'px,0)';
            el.style.opacity = '';
            el.classList.add('show');
            return;
        }
        el.style.transition = 'none';
        el.style.transform = 'translate3d(' + snapDevicePx(item.anchor.x) + 'px,' +
            snapDevicePx(item.anchor.y) + 'px,0) scale(0.82)';
        el.style.opacity = '0';
        flying.push(item);
    });
    if (!flying.length) return;
    void (els.layer && els.layer.offsetWidth);   // 落一次样式计算，把起点态钉住
    flying.forEach(item => {
        const el = item.el;
        el.classList.add('is-flying');
        el.style.transition = '';
        el.style.transitionDelay = Math.round(item.cardDelay || 0) + 'ms';
        el.style.transform = 'translate3d(' + snapDevicePx(item.x) + 'px,' +
            snapDevicePx(item.y) + 'px,0)';
        el.style.opacity = '';
        el.classList.add('show');
    });
    // 飞完就摘掉过渡与延迟：之后相机转动带来的重排、拖拽都要立刻跟手
    let totalMs = 0;
    flying.forEach(item => {
        totalMs = Math.max(totalMs, (item.cardDelay || 0) + PROVINCE_CARD_FLY_MS);
    });
    window.setTimeout(() => {
        flying.forEach(item => {
            if (!item.el) return;
            item.el.style.transitionDelay = '';
            item.el.classList.remove('is-flying');
        });
    }, totalMs + 80);
}

// 起点"引爆"：标记在一个短脉冲里鼓一下，再回到基准尺寸。
// 只在「全部城市」模式做 —— 省份模式下标记已经因为省份高亮而全亮，再动容易和悬停强调混淆。
function startProvinceMarkerPulse(items) {
    if (deps.reduceMotion() || provinceCardsMode !== 'all') return;
    const targets = items.filter(item => item.anchor && deps.cityMarkerEntities()[item.ci]);
    if (!targets.length) return;
    const startedAt = performance.now();
    let finishAt = 0;
    targets.forEach(item => {
        finishAt = Math.max(finishAt, (item.lineDelay || 0) + PROVINCE_PULSE_MS);
    });
    const tick = (now) => {
        if (!provinceCardsActive) {
            provincePulseRaf = null;
            return;
        }
        const elapsed = now - startedAt;
        let pending = false;
        targets.forEach(item => {
            const ent = deps.cityMarkerEntities()[item.ci];
            if (!ent || !ent.billboard) return;
            if (deps.focusedMarker() === ent) return;   // 正在被悬停聚焦的标记交给 hover 逻辑
            const local = elapsed - (item.lineDelay || 0);
            if (local >= PROVINCE_PULSE_MS) {
                if (ent.billboard.scale !== 1) ent.billboard.scale = 1;
                return;
            }
            pending = true;
            if (local < 0) return;
            const k = local / PROVINCE_PULSE_MS;
            ent.billboard.scale = 1 + 0.26 * Math.sin(Math.PI * k);
        });
        if (pending && elapsed < finishAt + 400) {
            provincePulseRaf = requestAnimationFrame(tick);
        } else {
            provincePulseRaf = null;
        }
    };
    if (provincePulseRaf) cancelAnimationFrame(provincePulseRaf);
    provincePulseRaf = requestAnimationFrame(tick);
}

// 一键展开：所有去过的城市各一张卡片 + 一条连线
export function activateAllCityCards() {
    if (!deps.cityCardsEnabled()) return false;
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
        provinceAllFlight = true;
        syncProvinceAllBtn();
        flyToChinaForCityCards(open);
        return true;
    }
    return open();
}

// 自动缩放：终点取一个"轮廓可见 + 城市聚合态"的高度（9.5e6 > h > 1.5e6）
function flyToChinaForCityCards(done) {
    const duration = deps.reduceMotion() ? 0 : PROVINCE_ALL_FLY_DURATION;
    const finish = () => {
        if (provinceAllFlightHandler) {
            deps.viewer().camera.moveEnd.removeEventListener(provinceAllFlightHandler);
            provinceAllFlightHandler = null;
        }
        if (provinceAllFlightTimer !== null) {
            clearTimeout(provinceAllFlightTimer);
            provinceAllFlightTimer = null;
        }
        if (!provinceAllFlight) return;   // 飞行途中已被取消
        provinceAllFlight = false;
        if (deps.cityCardsEnabled()) done();
        syncProvinceAllBtn();
    };
    if (provinceAllFlightTimer !== null) {
        clearTimeout(provinceAllFlightTimer);
        provinceAllFlightTimer = null;
    }
    if (duration > 0) {
        provinceAllFlightHandler = finish;
        deps.viewer().camera.moveEnd.addEventListener(provinceAllFlightHandler);
        provinceAllFlightTimer = setTimeout(finish, duration * 1000 + 700);   // moveEnd 没来时的兜底
    }
    deps.viewer().camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            PROVINCE_ALL_FLY_LNG, PROVINCE_ALL_FLY_LAT, PROVINCE_ALL_FLY_HEIGHT),
        duration: duration
    });
    if (duration <= 0) finish();
}

export function cancelAllCityFlight() {
    if (!provinceAllFlight) return;
    provinceAllFlight = false;
    if (provinceAllFlightHandler) {
        deps.viewer().camera.moveEnd.removeEventListener(provinceAllFlightHandler);
        provinceAllFlightHandler = null;
    }
    if (provinceAllFlightTimer !== null) {
        clearTimeout(provinceAllFlightTimer);
        provinceAllFlightTimer = null;
    }
    syncProvinceAllBtn();
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
    if (provinceCardClickTimer) {   // 收起时顺带取消还没落地的单/双击判定
        clearTimeout(provinceCardClickTimer);
        provinceCardClickTimer = null;
    }
    // 退场动画要用到这批元素，先留个副本；世代号保证收尾不会清掉"期间新开的一组"
    const exiting = provinceCardsItems.slice();
    const token = ++provinceCardsToken;
    // 收起时把入场动画的收尾状态一并清掉：脉冲停掉、被脉冲鼓起来的标记还回基准尺寸
    provinceEntranceUntil = 0;
    if (provincePulseRaf) {
        cancelAnimationFrame(provincePulseRaf);
        provincePulseRaf = null;
    }
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
    provinceDragState = null;
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
        animateProvinceCardsExit(exiting, token);
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

// 收起动画：卡片缩回自己那个标记并淡出，连线向标记端收回（dash 反着走一遍）。
// 用世代号做守卫 —— 动画没结束就点了别的省时，不能再把新的一组清掉。
function animateProvinceCardsExit(items, token) {
    const els = provinceElements();
    items.forEach(item => {
        const el = item.el;
        if (el) {
            el.style.pointerEvents = 'none';   // 退场途中不再响应点击
            el.style.transition = 'transform 0.28s ease, opacity 0.24s ease';
            el.style.transitionDelay = '0ms';
            const backX = item.anchor ? item.anchor.x : item.x;
            const backY = item.anchor ? item.anchor.y : item.y;
            el.style.transform = 'translate3d(' + snapDevicePx(backX) + 'px,' +
                snapDevicePx(backY) + 'px,0) scale(0.88)';
            el.style.opacity = '0';
        }
        [item.pathBase, item.path].forEach(p => {
            if (!p) return;
            let len = 0;
            try { len = p.getTotalLength ? p.getTotalLength() : 0; } catch (e) { len = 0; }
            if (!len || !Number.isFinite(len)) return;
            p.style.transition = 'stroke-dashoffset 0.26s ease';
            p.style.strokeDasharray = len + 'px';
            p.style.strokeDashoffset = len + 'px';
        });
        if (item.dot) {
            item.dot.style.transition = 'opacity 0.24s ease';
            item.dot.style.opacity = '0';
        }
    });
    window.setTimeout(() => {
        if (token !== provinceCardsToken) return;   // 期间已经开了新的一组，别误清
        if (provinceCardsItems.length) return;      // 双保险：层里已经有新内容，绝不碰
        if (els.layer) els.layer.innerHTML = '';
        if (els.svg) els.svg.innerHTML = '';
    }, 320);
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

function provinceLabelWorldFromInfo(info) {
    // 标注落在省份中心：优先用 DataV 的 center（人工校正过，多岛屿省份不会被拉偏），
    // 没有 center 时退回几何包围盒中心。
    let lng = null;
    let lat = null;
    if (info.center && info.center.length >= 2) {
        lng = Number(info.center[0]);
        lat = Number(info.center[1]);
    } else if (info.bbox) {
        lng = (info.bbox[0] + info.bbox[2]) / 2;
        lat = (info.bbox[1] + info.bbox[3]) / 2;
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return Cesium.Cartesian3.fromDegrees(lng, lat, 0);
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

        // ---- 卡片本体：封面 + 城市名 + 数量 + 最近到访，没有按钮，整卡可点 ----
        const el = document.createElement('div');
        el.className = 'prop-city-card';
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.setAttribute('aria-label', view.name + '，' + view.count + ' 条足迹，进入城市相册');
        el.title = '单击进入相册，双击打开城市卡';
        const media = document.createElement('div');
        media.className = 'prop-card-media';
        // 先只画"首字 + 空图片层"，封面等布局与错峰顺序定了再排队加载：
        // 这样先飞出来的卡片先拿到图（见 activateCityCards 里的 startProvinceCoverLoads）
        const coverRequest = deps.renderCardCover(media, view.cover, view.name ? view.name.charAt(0) : '?');
        // 悬停/聚焦时才浮出来的提示：卡片没有按钮，整卡可点，得让人知道能点、以及双击的层次。
        // 盖在封面区上（左边 40%），那里没有文字，不会挡住城市名/统计/日期。
        const hint = document.createElement('span');
        hint.className = 'prop-card-hint';
        const hintMain = document.createElement('em');
        hintMain.textContent = '点击进入相册';
        const hintSub = document.createElement('small');
        hintSub.textContent = '双击看城市卡';
        hint.appendChild(hintMain);
        hint.appendChild(hintSub);
        media.appendChild(hint);
        const body = document.createElement('div');
        body.className = 'prop-card-body';
        const title = document.createElement('h3');
        title.className = 'prop-card-title';
        title.textContent = view.name;
        const stats = document.createElement('p');
        stats.className = 'prop-card-stats';
        const countBold = document.createElement('b');
        countBold.textContent = String(view.count);
        const photoBold = document.createElement('b');
        photoBold.textContent = String(view.photos);
        stats.appendChild(countBold);
        stats.appendChild(document.createTextNode(' 足迹 · '));
        stats.appendChild(photoBold);
        stats.appendChild(document.createTextNode(' 照片'));
        const date = document.createElement('p');
        date.className = 'prop-card-date';
        date.textContent = view.latest ? '最近到访 ' + view.latest : '还没有记录时间';
        body.appendChild(title);
        body.appendChild(stats);
        body.appendChild(date);
        el.appendChild(media);
        el.appendChild(body);
        els.layer.appendChild(el);

        // ---- 连线：一条抛物线 + 起点圆点（颜色走每条线自己的青蓝渐变） ----
        const gradId = 'prop-leader-grad-' + index;
        const grad = document.createElementNS(SVG_NS, 'linearGradient');
        grad.setAttribute('id', gradId);
        grad.setAttribute('gradientUnits', 'userSpaceOnUse');
        ['x1', 'y1', 'x2', 'y2'].forEach(attr => grad.setAttribute(attr, '0'));
        const stopFrom = document.createElementNS(SVG_NS, 'stop');
        stopFrom.setAttribute('offset', '0%');
        stopFrom.setAttribute('stop-color', PROVINCE_LINE_FROM);
        const stopTo = document.createElementNS(SVG_NS, 'stop');
        stopTo.setAttribute('offset', '100%');
        stopTo.setAttribute('stop-color', PROVINCE_LINE_TO);
        grad.appendChild(stopFrom);
        grad.appendChild(stopTo);
        defs.appendChild(grad);

        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('class', 'prop-leader-group');
        // 深色描边打底：浅色底图上靠它把线"垫"出来，深色底图上几乎看不见
        const pathBase = document.createElementNS(SVG_NS, 'path');
        pathBase.setAttribute('class', 'prop-leader-base');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'prop-leader');
        path.setAttribute('stroke', 'url(#' + gradId + ')');
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('class', 'prop-leader-dot');
        dot.setAttribute('r', String(PROVINCE_LINE_DOT_R));
        group.appendChild(pathBase);
        group.appendChild(path);
        group.appendChild(dot);
        els.svg.appendChild(group);

        const item = {
            ci: ci,
            el: el,
            group: group,
            pathBase: pathBase,
            path: path,
            dot: dot,
            grad: grad,
            coverRequest: coverRequest,
            x: 0, y: 0,
            w: PROVINCE_CARD_WIDTH, h: PROVINCE_CARD_HEIGHT,
            edge: 'right',
            locked: false, anchor: null
        };
        attachProvinceCardDrag(item);
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

// ---------- 布局：就近边优先（上下左右都能放）+ 沿边错开 + 互相避让 ----------

// 坐标对齐到「设备像素」而不是 CSS 像素：
// 显示器开了 125% / 150% 缩放时（devicePixelRatio = 1.25 / 1.5），
// 整数 CSS 像素映射过去仍是小数设备像素，落在半格上的卡片文字就是糊的。
// 对齐后每张卡都落在整格上，文字栅格化才稳定清晰。

const PROVINCE_EDGES = ['left', 'right', 'top', 'bottom'];
const PROVINCE_EDGE_SIDE_BIAS = 0.05;   // 上下与左右同样近时优先左右（沿用原来的观感）
const PROVINCE_LAYOUT_STEPS = 12;       // 沿边搜索的最大步数
const PROVINCE_CLUSTER_PAD = 26;        // 标记簇包围盒的外扩，卡片尽量别压住标记群
// 「中央留空区」：可用区中间按这两比例留出一块不放卡片的地方 ——
// 卡片只贴四边，别漂在地球中央（那里是标记群、省名标注和视觉重心）。
// 真排不下时宁可叠在边上，也不会摆进这块区域。
const PROVINCE_CORE_KEEPOUT_X = 0.26;
const PROVINCE_CORE_KEEPOUT_Y = 0.22;

function provinceSafeArea(W, H) {
    const insetX = provinceSideInset();
    return {
        left: insetX,
        right: Math.max(insetX + 140, W - insetX),
        top: PROVINCE_SAFE_TOP,
        bottom: Math.max(PROVINCE_SAFE_TOP + 200, H - PROVINCE_SAFE_BOTTOM)
    };
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}


function markerClusterRect(items) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    items.forEach(item => {
        minX = Math.min(minX, item.anchor.x);
        maxX = Math.max(maxX, item.anchor.x);
        minY = Math.min(minY, item.anchor.y);
        maxY = Math.max(maxY, item.anchor.y);
    });
    return {
        x: minX - PROVINCE_CLUSTER_PAD,
        y: minY - PROVINCE_CLUSTER_PAD,
        w: (maxX - minX) + PROVINCE_CLUSTER_PAD * 2,
        h: (maxY - minY) + PROVINCE_CLUSTER_PAD * 2
    };
}

// 标记到最近那条边的「相对距离」：越小说明越贴那条边
function provinceEdgeAffinity(item, area, spanX, spanY) {
    const a = item.anchor;
    return Math.min(
        (a.x - area.left) / spanX,
        (area.right - a.x) / spanX,
        (a.y - area.top) / spanY,
        (area.bottom - a.y) / spanY
    );
}

// 一次布局：为一张卡片挑位置。按「就近边 → 沿边逐步外扩」搜索，
// 先满足不与已有卡片重叠，再尽量少压住标记群，最后才是离自己标记最近。
function pickProvinceCardSpot(item, area, spanX, spanY, cluster, placed, gap) {
    const w = item.w;
    const h = item.h;
    const a = item.anchor;
    const stagger = PROVINCE_CARD_STAGGER[item.layoutIndex % PROVINCE_CARD_STAGGER.length];
    const score = {
        left: (a.x - area.left) / spanX,
        right: (area.right - a.x) / spanX,
        top: (a.y - area.top) / spanY + PROVINCE_EDGE_SIDE_BIAS,
        bottom: (area.bottom - a.y) / spanY + PROVINCE_EDGE_SIDE_BIAS * 2
    };
    const edges = PROVINCE_EDGES.slice().sort((e1, e2) => score[e1] - score[e2]);
    // 中央留空区（可用区正中那一块）：任何方向都不往这里摆卡片
    const core = {
        x: area.left + spanX * PROVINCE_CORE_KEEPOUT_X,
        y: area.top + spanY * PROVINCE_CORE_KEEPOUT_Y,
        w: spanX * (1 - PROVINCE_CORE_KEEPOUT_X * 2),
        h: spanY * (1 - PROVINCE_CORE_KEEPOUT_Y * 2)
    };

    let best = null;
    edges.forEach((edge, edgeRank) => {
        // 沿边外扩时优先朝屏幕中心那一侧，卡片整体更聚拢、不会甩到角落
        const towardCenter = (edge === 'left' || edge === 'right')
            ? Math.sign((area.top + area.bottom) / 2 - a.y)
            : Math.sign((area.left + area.right) / 2 - a.x);
        for (let k = 0; k <= PROVINCE_LAYOUT_STEPS; k++) {
            const steps = k === 0 ? [0] : [k, -k];
            for (let s = 0; s < steps.length; s++) {
                const step = steps[s];
                const x = edge === 'left' ? area.left + stagger
                    : edge === 'right' ? area.right - w - stagger
                        : a.x - w / 2 + step * (w + gap);
                const y = edge === 'top' ? area.top + stagger
                    : edge === 'bottom' ? area.bottom - h - stagger
                        : a.y - h / 2 + step * (h + gap);
                if (x < area.left || y < area.top || x + w > area.right || y + h > area.bottom) continue;
                const rect = { x: x, y: y, w: w, h: h };
                if (rectsOverlap(rect, core)) continue;   // 中央留空：宁可换方向、换格，也不摆到画面中间
                const padded = { x: x - gap, y: y - gap, w: w + gap * 2, h: h + gap * 2 };
                let blocked = false;
                for (let p = 0; p < placed.length; p++) {
                    if (rectsOverlap(padded, placed[p])) { blocked = true; break; }
                }
                if (blocked) continue;
                let cost = Math.abs(step) * 70 + edgeRank * 30;
                if (towardCenter && step * towardCenter < 0) cost += 8;
                if (cluster) cost += 900 * (overlapArea(rect, cluster) / (w * h));
                if (!best || cost < best.cost) best = { x: x, y: y, edge: edge, cost: cost };
            }
        }
    });
    if (best) return best;

    // 四条边都排满了：在**外圈**做一次粗网格扫描（跳过中央留空区）。
    // 同时记两个候选：完全不压别人的空位；以及"压得最少"的位置 ——
    // 后者是"实在排不下就叠加"的实现，挑压得最少的能避免几张卡挤成一坨。
    const stepX = Math.max(40, Math.round(w / 2));
    const stepY = Math.max(30, Math.round(h / 2));
    let gridBest = null;
    let gridSoft = null;
    for (let gy = area.top; gy + h <= area.bottom; gy += stepY) {
        for (let gx = area.left; gx + w <= area.right; gx += stepX) {
            const rect = { x: gx, y: gy, w: w, h: h };
            if (rectsOverlap(rect, core)) continue;
            const padded = { x: gx - gap, y: gy - gap, w: w + gap * 2, h: h + gap * 2 };
            let overlapSum = 0;
            for (let p = 0; p < placed.length; p++) {
                if (rectsOverlap(padded, placed[p])) overlapSum += overlapArea(rect, placed[p]);
            }
            const d = Math.hypot(gx + w / 2 - a.x, gy + h / 2 - a.y);
            if (!overlapSum) {
                if (!gridBest || d < gridBest.d) gridBest = { x: gx, y: gy, edge: edges[0], d: d };
            } else if (!gridSoft || overlapSum < gridSoft.overlap) {
                gridSoft = { x: gx, y: gy, edge: edges[0], d: d, overlap: overlapSum };
            }
        }
    }
    if (gridBest) return { x: gridBest.x, y: gridBest.y, edge: gridBest.edge, cost: Infinity };
    if (gridSoft) return { x: gridSoft.x, y: gridSoft.y, edge: gridSoft.edge, cost: Infinity };

    // 最后兜底：真的没地方了，就落在首选方向（允许压住别的卡片），保证卡片不丢
    const edge = edges[0];
    const x = edge === 'left' ? area.left + stagger
        : edge === 'right' ? area.right - w - stagger
            : clampNumber(a.x - w / 2, area.left, Math.max(area.left, area.right - w));
    const y = edge === 'top' ? area.top + stagger
        : edge === 'bottom' ? area.bottom - h - stagger
            : clampNumber(a.y - h / 2, area.top, Math.max(area.top, area.bottom - h));
    return { x: x, y: y, edge: edge, cost: Infinity };
}

function layoutProvinceCards() {
    provinceLayoutDirty = false;
    if (!provinceCardsActive || !provinceCardsItems.length) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const area = provinceSafeArea(W, H);
    const spanX = Math.max(1, area.right - area.left);
    const spanY = Math.max(1, area.bottom - area.top);
    // 卡片多时只把同侧间距收紧一点（12 → 8），卡片本身尺寸不变；
    // 再密就交给"就近边外扩 → 网格兜底 → 堆叠"这套机制。
    const gap = provinceCardsItems.length > PROVINCE_CARD_DENSE_LIMIT ? 8 : PROVINCE_CARD_GAP;

    // 1) 锚点：每张卡跟着自己那座城市的标记
    const active = [];
    provinceCardsItems.forEach((item, index) => {
        item.layoutIndex = index;
        item.anchor = cityMarkerScreenPosition(item.ci);
        if (item.anchor) active.push(item);
    });

    // 2) 标记群包围盒 + 已经拖拽定位的卡片（它们位置固定，先占位当障碍）
    const cluster = active.length ? markerClusterRect(active) : null;
    const placed = [];
    provinceCardsItems.forEach(item => {
        if (item.locked && item.anchor) {
            placed.push({ x: item.x, y: item.y, w: item.w, h: item.h });
        }
    });

    // 3) 最贴边的先排：它可选的方向最少，先把位置占住
    active
        .slice()
        .sort((a, b) => provinceEdgeAffinity(a, area, spanX, spanY) -
            provinceEdgeAffinity(b, area, spanX, spanY))
        .forEach(item => {
            const spot = pickProvinceCardSpot(item, area, spanX, spanY, cluster, placed, gap);
            item.x = spot.x;
            item.y = spot.y;
            item.edge = spot.edge;
            placed.push({ x: spot.x, y: spot.y, w: item.w, h: item.h });
            applyProvinceCardBox(item);
        });

    // 4) 转到地球背面（没有屏幕坐标）的卡片保持原位，只由连线层负责淡出
    provinceCardsItems.forEach(item => {
        if (!item.anchor) applyProvinceCardBox(item);
    });

    updateProvinceLeaderLines();
    updateProvinceLabelPosition();
}

function applyProvinceCardBox(item) {
    const el = item.el;
    if (!el) return;
    el.style.transform = 'translate3d(' + snapDevicePx(item.x) + 'px,' + snapDevicePx(item.y) + 'px,0)';
    el.style.zIndex = String(10 + (item.layoutIndex || 0));
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

// ---------- 连线与省名标注 ----------

// 连线落点：卡片中心朝自己的标记方向，与卡片边框的交点。
// 这样卡片无论放在上下左右哪条边，线都钉在朝向标记的那一边上（拐角处也能自然落在角上）。
function provinceCardAnchorPoint(item) {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const dx = item.anchor.x - cx;
    const dy = item.anchor.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const scaleX = dx === 0 ? Infinity : (item.w / 2) / Math.abs(dx);
    const scaleY = dy === 0 ? Infinity : (item.h / 2) / Math.abs(dy);
    const k = Math.min(scaleX, scaleY);
    return { x: cx + dx * k, y: cy + dy * k };
}

function updateProvinceLeaderLines() {
    if (!provinceCardsItems.length) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const viewCenterX = W / 2;
    const viewCenterY = H / 2;
    // 同一条边上的线按顺序递增弧度，形成扇面（每条边各自扇开）
    const edgeTotals = { left: 0, right: 0, top: 0, bottom: 0 };
    const edgeSeen = { left: 0, right: 0, top: 0, bottom: 0 };
    provinceCardsItems.forEach(item => {
        edgeTotals[item.edge || 'right'] = (edgeTotals[item.edge || 'right'] || 0) + 1;
    });

    provinceCardsItems.forEach(item => {
        const anchor = item.anchor;
        const visible = provinceCardsActive && !!anchor;
        item.visible = visible;
        // 隐藏要同时落到 <g> 与三个子元素上：
        // 之前只给 <g> 加了类，但没有任何规则匹配 g.is-hidden，所以卡片转到地球背面
        // 之后线会孤零零留在屏幕上 —— 现在三条规则一起生效，谁也漏不掉。
        item.group.classList.toggle('is-hidden', !visible);
        item.pathBase.classList.toggle('is-hidden', !visible);
        item.path.classList.toggle('is-hidden', !visible);
        item.dot.classList.toggle('is-hidden', !visible);
        item.el.classList.toggle('is-hidden', !visible);
        // 不可见的卡片不该被 Tab 聚焦（否则焦点会落到看不见的卡片上）
        const tabIndex = visible ? 0 : -1;
        if (item.el.tabIndex !== tabIndex) item.el.tabIndex = tabIndex;
        if (!visible) {
            // 刚被转走的这张如果正被悬停/聚焦：连同"其余线压暗"的整层状态一起还原
            if (provinceFocusItem === item) setProvinceCardFocus(item, false);
            return;
        }

        const edge = item.edge || 'right';
        const fanIndex = edgeSeen[edge]++;
        // 终点：卡片朝向自己标记的那条边上的交点
        const end = provinceCardAnchorPoint(item);
        const endX = end.x;
        const endY = end.y;
        const dx = endX - anchor.x;
        const dy = endY - anchor.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // 起点：直接从城市标记圆点的中心出发
        const startX = anchor.x;
        const startY = anchor.y;

        // 控制点 = 弦中点沿垂直方向偏移；方向统一取「远离视口中心」的那一侧，
        // 保证同一侧的线朝同一个方向鼓出，不会互相穿插成结。
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        let px = -uy;
        let py = ux;
        const outX = midX + px * 120 - viewCenterX;
        const outY = midY + py * 120 - viewCenterY;
        const inX = midX - px * 120 - viewCenterX;
        const inY = midY - py * 120 - viewCenterY;
        if (outX * outX + outY * outY < inX * inX + inY * inY) {
            px = -px;
            py = -py;
        }
        const fan = PROVINCE_LINE_FAN[0] + (PROVINCE_LINE_FAN[1] - PROVINCE_LINE_FAN[0]) *
            (fanIndex / Math.max(1, edgeTotals[edge] - 1));
        const ctrlX = midX + px * len * fan;
        const ctrlY = midY + py * len * fan;

        const d = 'M' + round1(startX) + ' ' + round1(startY) +
            ' Q' + round1(ctrlX) + ' ' + round1(ctrlY) +
            ' ' + round1(endX) + ' ' + round1(endY);
        item.pathBase.setAttribute('d', d);   // 深色底与亮线共用同一条路径
        item.path.setAttribute('d', d);
        item.dot.setAttribute('cx', round1(startX));
        item.dot.setAttribute('cy', round1(startY));
        item.grad.setAttribute('x1', round1(startX));
        item.grad.setAttribute('y1', round1(startY));
        item.grad.setAttribute('x2', round1(endX));
        item.grad.setAttribute('y2', round1(endY));
    });
}

const provinceLabelNormal = new Cesium.Cartesian3();
const provinceLabelToCam = new Cesium.Cartesian3();
function updateProvinceLabelPosition() {
    const els = provinceElements();
    if (!els.label) return;
    if (!provinceCardsActive || !provinceLabelWorld) {
        els.label.classList.remove('show');
        return;
    }
    Cesium.Cartesian3.normalize(provinceLabelWorld, provinceLabelNormal);
    Cesium.Cartesian3.subtract(deps.viewer().camera.positionWC, provinceLabelWorld, provinceLabelToCam);
    if (Cesium.Cartesian3.dot(provinceLabelNormal, provinceLabelToCam) < 0) {
        els.label.classList.remove('show');   // 省份中心转到地球背面
        return;
    }
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, provinceLabelWorld);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
        els.label.classList.remove('show');
        return;
    }
    if (els.label.textContent !== provinceLabelText) els.label.textContent = provinceLabelText;
    els.label.style.left = snapDevicePx(screen.x) + 'px';
    els.label.style.top = snapDevicePx(screen.y - 18) + 'px';
    els.label.classList.add('show');
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
    if (provinceDragState) {
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
deps.viewer().scene.postRender.addEventListener(updateProvinceOverlays);

// “拉出来”的生长动画：线沿自身长度铺开；动画结束后清掉 dash，
// 否则线随地球移动、长度变化时会出现断口。
function startProvinceLinesGrow() {
    if (deps.reduceMotion()) return;
    provinceCardsItems.forEach(item => {
        // 深色底描边必须和亮线一起铺开：只给亮线做 dash 动画的话，
        // 底层会整条先出现（就是"先看到一条纯黑的线"），亮线再慢慢盖上去。
        const paths = [item.pathBase, item.path].filter(Boolean);
        const path = item.path;
        if (!path || typeof path.getTotalLength !== 'function' || !paths.length) return;
        let length = 0;
        try { length = path.getTotalLength(); } catch (e) { length = 0; }
        if (!length || !Number.isFinite(length)) return;
        const delay = Math.round(item.lineDelay || 0);
        paths.forEach(p => {
            p.style.transition = 'none';
            p.style.strokeDasharray = length + 'px';
            p.style.strokeDashoffset = length + 'px';
        });
        requestAnimationFrame(() => {
            paths.forEach(p => {
                p.style.transition = 'stroke-dashoffset ' + (PROVINCE_LINE_GROW_MS / 1000) +
                    's cubic-bezier(0.16, 1, 0.3, 1) ' + delay + 'ms';
                p.style.strokeDashoffset = '0px';
            });
            window.setTimeout(() => {
                paths.forEach(p => {
                    p.style.transition = '';
                    p.style.strokeDasharray = '';
                    p.style.strokeDashoffset = '';
                });
            }, PROVINCE_LINE_GROW_MS + delay + 120);
        });
    });
}

// ---------- 拖拽 / 点击 ----------
function applyProvinceDragPosition(item, clientX, clientY, grabX, grabY) {
    const w = item.w || PROVINCE_CARD_WIDTH;
    const h = item.h || PROVINCE_CARD_HEIGHT;
    item.x = clampNumber(clientX - grabX, 8, Math.max(8, window.innerWidth - w - 8));
    item.y = clampNumber(clientY - grabY, 8, Math.max(8, window.innerHeight - h - 8));
    applyProvinceCardBox(item);
}

function attachProvinceCardDrag(item) {
    const el = item.el;
    el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const rect = el.getBoundingClientRect();
        provinceDragState = {
            item: item,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            grabX: e.clientX - rect.left,
            grabY: e.clientY - rect.top,
            moved: false
        };
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略：拿不到指针捕获也能拖 */ }
        e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
        const state = provinceDragState;
        if (!state || state.item !== item || state.pointerId !== e.pointerId) return;
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) < 4) return;   // 4px 以内算点击，不算拖拽
        state.moved = true;
        item.locked = true;   // 拖过的卡片不再被自动排版移动
        el.classList.add('is-dragging');
        applyProvinceDragPosition(item, e.clientX, e.clientY, state.grabX, state.grabY);
        updateProvinceLeaderLines();
        e.preventDefault();
    });
    const finish = (e) => {
        const state = provinceDragState;
        if (!state || state.item !== item) return;
        provinceDragState = null;
        el.classList.remove('is-dragging');
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放或从未捕获 */ }
        // 单击延迟 180ms 再执行：给"双击打开单城市卡"留出判定窗口
        if (!state.moved) {
            if (provinceCardClickTimer) clearTimeout(provinceCardClickTimer);
            provinceCardClickTimer = window.setTimeout(() => {
                provinceCardClickTimer = null;
                openProvinceCityAlbum(item.ci);
            }, 180);
        }
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    // 双击 = 打开单城市卡（大玻璃卡）：形成「小卡 → 大卡 → 相册」的层次
    el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (provinceCardClickTimer) {
            clearTimeout(provinceCardClickTimer);
            provinceCardClickTimer = null;
        }
        openProvinceCityCard(item.ci);
    });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault();
        openProvinceCityAlbum(item.ci);
    });
}

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

// ---------- 导航栏「全部城市」入口 ----------
function provinceAllBtnEl() {
    if (!provinceAllBtnCache) provinceAllBtnCache = document.getElementById('provinceAllBtn');
    return provinceAllBtnCache;
}

function syncProvinceAllBtn() {
    const btn = provinceAllBtnEl();
    if (!btn) return;
    // 自动缩放期间也算"已按下"：用户点了立刻有反馈，落地后无缝变成展开态
    const on = provinceAllFlight || (provinceCardsActive && provinceCardsMode === 'all');
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
}

// 可用态：只有「3D + 桌面端 + 城市聚合态」时才可点（每帧调用，只在翻转时写 DOM）
export function syncProvinceAllAvailability() {
    const btn = provinceAllBtnEl();
    if (!btn) return;
    const enabled = deps.cityCardsEnabled();
    if (provinceAllAvailable === enabled) return;
    provinceAllAvailable = enabled;
    btn.disabled = !enabled;
}

// 再点一次收起，和省份卡片是同一套开关语义
function toggleAllCityCards() {
    if (provinceAllFlight) return true;   // 正在飞过去，忽略重复点击
    if (provinceCardsActive && provinceCardsMode === 'all') {
        closeProvinceCards();
        return true;
    }
    return activateAllCityCards();
}

(function wireProvinceAllBtn() {
    const btn = provinceAllBtnEl();
    if (!btn) return;
    btn.addEventListener('click', () => toggleAllCityCards());
    syncProvinceAllBtn();
    syncProvinceAllAvailability();
})();

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

/** 「全部城市」自动缩放是否还在进行（Esc 要能取消）。 */
export function isProvinceAllFlying() {
    return provinceAllFlight;
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
 * 中国轮廓加载完成后，把按 adcode 归组的省份实体交给本模块。
 * 轮廓的加载本身仍在主文件（它同时决定了边界显隐与城市填充），
 * 这里只接管「省份高亮需要的两张索引表」。
 */
export function setProvinceEntityIndex(entityMap, materialSnapshot) {
    provinceEntityMap = entityMap;
    provinceMaterialSnapshot = materialSnapshot;
}



/**
 * 绑定与相机帧同步的省份浮层更新。必须在 setupProvinceCards 之后调用一次。
 */
export function initProvinceCards() {
    deps.viewer().scene.postRender.addEventListener(updateProvinceOverlays);
}
