/**
 * 足迹标记。
 *
 * 本文件持有标记实体与城市聚合状态：构建/重建、城市聚合与单足迹展开、
 * 随底图坐标系重算位置、飞往城市、渲染自愈、悬停气泡与明暗强调、键盘可达。
 * 其余几块拆在旁边：
 *   - marker-icons.js         图标尺寸与 SVG 图块；
 *   - marker-visibility.js    背面遮挡与地名标签避让（每帧入口仍在这里）；
 *   - marker-merge.js         整球视野下挨得太近的城市圆点合并（分组算法）；
 *   - marker-detail-card.js   足迹卡与城市聚合卡；
 *   - marker-input.js         指针拾取：悬停、点击、点空白逐级退。
 *
 * 封面加载队列见 modules/city-view.js。
 */

import { PROVINCE_MARKER_DIM_ALPHA } from './province-style.js';
import { gcj02ToWgs84, wgs84ToGcj02 } from './coordinate.js';
import { cityWallImages } from './city-view.js';
import {
    hidePhotoRing,
    showPhotoRing,
    isPhotoRingActive,
    firstVisibleRingItem,
    focusWhenVisible
} from './photo-ring.js';
import {
    isProvinceCardsActive,
    closeProvinceCards,
    provinceBrightEntitySet
} from './province-cards.js';
import { outlinePolylines } from './city-fill.js';
import {
    MARKER_SIZE,
    CITY_MARKER_SIZE,
    MARKER_URL,
    cityMarkerUrl,
    cachedMarkerPhoto,
    requestMarkerPhoto
} from './marker-icons.js';
import {
    setGlobeLabelMode,
    markerLabelGraphics,
    resetMarkerLabelLayout,
    forgetMarkerLabel,
    updateMarkerOcclusion,
    facesCamera,
    layoutMarkerLabels,
    prewarmLabelGlyphs
} from './marker-visibility.js';
import { mergeNearbyPoints, summarizeGroups } from './marker-merge.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints               () => Footprint[]      可变数据用取值函数
 * @param d.viewer                   () => Cesium.Viewer
 * @param d.baseProviders            () => Record<string, provider>
 * @param d.footprintCfg             () => object
 * @param d.reduceMotion             () => boolean
 * @param d.boundaryVisible          () => boolean
 * @param d.cityLabelVisible         () => boolean
 * @param d.showMarkerCard / d.showCityCard / d.rememberKeyboardMarkerBtn
 *        详情卡的三个入口（marker-detail-card.js）。走注入而不是 import：详情卡要反过来读本模块的
 *        标记实体与城市聚合，直接互相 import 会形成环。
 */
export function setupMarkers(d) {
    deps = d;
    // 地名标注模式来自后台配置，必须在注入后才能读（模块顶层读会撞上 deps=null）
    const raw = String(d.footprintCfg().globeLabels || 'all').trim().toLowerCase();
    setGlobeLabelMode((raw === 'off' || raw === 'city' || raw === 'all') ? raw : 'all');
}

// 城市聚合状态（提前声明，updateIntroVisibility 会读取）
let cityList = [];            // [{ city, indices: [足迹下标] }]，按数据顺序
let cityMarkerEntities = [];  // 城市标记实体
export const CITY_EXPAND_HEIGHT = 1500000;    // 相机低于此高度时展开为单个足迹
export const CITY_COLLAPSE_HEIGHT = 1800000;  // 高于此高度时聚合为城市标记
export const CITY_VIEW_HEIGHT = 600000;       // 点击城市后的落地高度：低于展开阈值，落到城市尺度（足够近，同城足迹点也能拉开）
let cityMode = true;
// 程序化“飞往城市”的飞行状态：飞行期间抑制高度阈值自动切换，
// 落地后再统一把聚合标记展开为该城市的足迹点，避免用户手动补一次缩放。
let cityFlightActive = false;
let cityFlightIndex = -1;
let cityFlightTimer = null;
let cityMoveEndHandler = null;
let cityRevealRaf = null;
let focusedMarker = null;        // 当前聚焦（悬停/键盘选中）的标记，null 表示无
let groupEmphasisKeys = null;    // 当前旅程/收藏成员；null 表示未启用组合高亮
let markerOcclusionDirty = true; // 标记遮挡需要重算（相机或标记位置变化时置位）
let markerLabelDirty = true;     // 地名标签需要重排（标记或标签显隐变化时置位）
let pendingMarkerAudit = false;  // 需要在真实渲染结果上体检一次标记（展开/重建后）
const markerLift = new Map();             // 下标 -> 渲染抬高米数（自愈用，不影响数据坐标）

let markerEntities = [];
let currentPositions = [];

// ================= 城市圆点合并 =================
// 两个城市圆心在屏幕上近于 CITY_MERGE_RADIUS 就并成一个点（圆点直径 40px，留一点缝）。
// 合并只改「显示」：代表城市的圆点换成全组的数字，其余城市藏起来；
// cityList / 实体下标都不变，城市卡、城记、省份卡片照旧按城市取数。
const CITY_MERGE_RADIUS = CITY_MARKER_SIZE * 0.95;
let cityMergeOwner = [];          // 城市下标 -> 代表城市下标（-1 = 此刻不可见）
let cityMergeGroups = new Map();  // 代表下标 -> { count, members }
const cityMergedAway = new Set(); // 被并进别处、此刻藏起来的城市实体
const cityShownCount = new Map(); // 城市实体 -> 圆点上此刻写的数字（只在变化时换图）
const mergeScreen = new Cesium.Cartesian2();

// 按当前相机重算分组。只在聚合态、3D 视图下合并；其余情况一律拆开
function updateCityMerge() {
    const viewer = deps.viewer();
    // 省份卡片开着时不合并：每张卡片都有一条引线连到自己的城市圆点，圆点不能被藏掉
    const mergeOn = cityMode && viewer.scene.mode === Cesium.SceneMode.SCENE3D && !isProvinceCardsActive();
    const now = Cesium.JulianDate.now();
    const cam = viewer.camera.positionWC;
    const points = cityMarkerEntities.map((ent, ci) => {
        if (!mergeOn || !ent || !ent.position) return null;
        const p = ent.position.getValue(now);
        if (!p || !facesCamera(cam, p)) return null;
        const sp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, p, mergeScreen);
        if (!sp) return null;
        return { x: sp.x, y: sp.y, count: cityList[ci] ? cityList[ci].indices.length : 0 };
    });
    cityMergeOwner = mergeNearbyPoints(points, CITY_MERGE_RADIUS, cityMergeOwner.length === points.length ? cityMergeOwner : null);
    cityMergeGroups = summarizeGroups(points, cityMergeOwner);
    let changed = false;
    cityMarkerEntities.forEach((ent, ci) => {
        const lead = cityMergeOwner[ci];
        const away = lead >= 0 && lead !== ci;
        if (away !== cityMergedAway.has(ent)) {
            changed = true;
            if (away) cityMergedAway.add(ent);
            else cityMergedAway.delete(ent);
        }
        // 代表写全组合计；落单的、不可见的都写自己的数
        const group = cityMergeGroups.get(ci);
        const count = group ? group.count : (cityList[ci] ? cityList[ci].indices.length : 0);
        if (cityShownCount.get(ent) !== count && ent.billboard) {
            cityShownCount.set(ent, count);
            ent.billboard.image = cityMarkerUrl(count);
        }
    });
    if (changed) markerLabelDirty = true;
    return changed;
}

/** 城市 ci 此刻是否代表一组（并进了别的城市）；用于悬停文案和点击。 */
export function cityMergeGroupOf(ci) {
    const group = cityMergeGroups.get(ci);
    return group && group.members.length > 1 ? group : null;
}

// 一组的名字取组里足迹最多、且有城市名的那座（没填城市的足迹归在「未分类」，不拿它当名字）
function cityGroupName(group) {
    const named = group.members
        .filter(i => cityList[i] && cityList[i].city && cityList[i].city !== '未分类')
        .sort((a, b) => cityList[b].indices.length - cityList[a].indices.length);
    return named.length ? cityList[named[0]].city : '';
}

// 城市标签：代表一组时写「南京等 3 座城」
function cityLabelText(ci) {
    const city = cityList[ci];
    if (!city) return '';
    const group = cityMergeGroupOf(ci);
    if (!group) return city.city;
    const name = cityGroupName(group);
    return name ? name + '等 ' + group.members.length + ' 座城' : group.members.length + ' 座城';
}

/** 悬停 / 键盘聚焦时的文案：合并的点写成「南京等 3 座城，12 条足迹」。 */
export function cityTipText(ci) {
    const city = cityList[ci];
    if (!city) return '';
    const group = cityMergeGroupOf(ci);
    return group
        ? cityLabelText(ci) + '，' + group.count + ' 条足迹'
        : city.city + '，' + city.indices.length + ' 条足迹';
}

/**
 * 点了一个合并的点：飞近到这组城市能分开的高度，不打开城市卡，返回 true。
 * 屏幕距离大致和相机高度成反比：要让最近的两城拉开到 1.5 个合并半径，
 * 高度就乘上「现在的距离 / 想要的距离」；每次至少降到 0.6 倍，
 * 但不低于聚合阈值上方一点（再低就直接展开成单个足迹了）。
 * 已经降到那个高度还分不开（两城本来就挨着）时返回 false，由调用方打开城市卡。
 */
const CITY_GROUP_FLOOR_HEIGHT = CITY_COLLAPSE_HEIGHT * 1.05;
export function flyToCityGroup(ci) {
    const group = cityMergeGroupOf(ci);
    if (!group) return false;
    const viewer = deps.viewer();
    const height = viewer.camera.positionCartographic.height;
    if (height <= CITY_GROUP_FLOOR_HEIGHT * 1.1) return false;
    const now = Cesium.JulianDate.now();
    const pts = group.members.map(i => {
        const p = cityMarkerEntities[i] && cityMarkerEntities[i].position && cityMarkerEntities[i].position.getValue(now);
        return p ? Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, p, new Cesium.Cartesian2()) : null;
    }).filter(Boolean);
    let minGap = Infinity;
    for (let a = 0; a < pts.length; a++) {
        for (let b = a + 1; b < pts.length; b++) {
            minGap = Math.min(minGap, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y));
        }
    }
    const ratio = Number.isFinite(minGap) ? Math.min(0.6, minGap / (CITY_MERGE_RADIUS * 1.5)) : 0.6;
    const target = Math.max(CITY_GROUP_FLOOR_HEIGHT, height * ratio);
    let lng = 0, lat = 0, n = 0;
    group.members.forEach(i => {
        const c = cityList[i] && cityCenter(cityList[i]);
        if (c) { lng += c.lng; lat += c.lat; n++; }
    });
    if (!n) return false;
    hideMarkerTip();
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng / n, lat / n, target),
        duration: deps.reduceMotion() ? 0 : 1.2
    });
    return true;
}

// 标记悬停气泡与键盘焦点层（提前声明：applyMarkerMode 初始化时就会用到）
export const markerTip = document.getElementById('markerTip');
const markerTipName = document.getElementById('markerTipName');
export const markerFocusLayer = document.getElementById('markerFocusLayer');
let markerTipEntity = null;
let hoveredMarkerKey = '';   // 当前气泡对应的标记（类型:下标），用于跳过同一标记上的重复设置

// 城市中心 = 该城市所有足迹在“当前底图坐标系”下的平均位置
export function cityCenter(city) {
    let lng = 0, lat = 0, n = 0;
    city.indices.forEach(i => {
        const p = currentPositions[i];
        if (p) { lng += p.lng; lat += p.lat; n++; }
    });
    return n ? { lng: lng / n, lat: lat / n } : null;
}

function footprintToBasemap(fp, basemapIsGcj) {
    if (fp.coordType === 'gcj02') {
        // 高德来源：高德底图直接用原坐标，天地图底图转成 WGS84
        return basemapIsGcj
            ? { lng: fp.lng, lat: fp.lat }
            : gcj02ToWgs84(fp.lng, fp.lat);
    }
    // WGS84 来源：天地图底图直接用，高德底图转成 GCJ-02
    return basemapIsGcj
        ? wgs84ToGcj02(fp.lng, fp.lat)
        : { lng: fp.lng, lat: fp.lat };
}

// 按当前底图坐标系刷新所有标记
export function applyMarkerPositions(key) {
    const item = deps.baseProviders()[key];
    const basemapIsGcj = !!(item && item.gcj);
    currentPositions = deps.footprints().map(fp => footprintToBasemap(fp, basemapIsGcj));
    markerEntities.forEach((ent, i) => {
        const pos = currentPositions[i];
        if (ent && pos) {
            // 带上自愈抬高量：换底图不该把已经抬起来的点又按回椭球面
            ent.position = Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, markerLift.get(i) || 0);
        }
    });
    // 城市标记同步到新的平均位置
    cityMarkerEntities.forEach((ent, i) => {
        const center = cityList[i] && cityCenter(cityList[i]);
        if (ent && center) {
            ent.position = Cesium.Cartesian3.fromDegrees(center.lng, center.lat);
        }
    });
    markerOcclusionDirty = true;   // 标记位置变了，遮挡关系要跟着重算
    pendingMarkerAudit = true;     // 位置变了，渲染结果也复检一次
    return currentPositions;
}

// 创建全部标记（数据加载完成后会重建）
export function buildMarkers() {
    resetMarkerLabelLayout();
    markerEntities = deps.footprints().map((fp, i) => {
        const pos = currentPositions[i] || { lng: fp.lng, lat: fp.lat };
        return deps.viewer().entities.add({
            name: fp.name,
            position: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, markerLift.get(i) || 0),
            billboard: {
                image: markerImageOf(fp),
                width: MARKER_SIZE,
                height: MARKER_SIZE,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY   // 背面隐藏由 updateMarkerOcclusion 处理
            },
            label: markerLabelGraphics(fp.name || '', MARKER_SIZE)
        });
    });
    loadMarkerPhotos();
}

// 照片标记：封面合成好之前先用玻璃圆点顶着，合成完再换图（marker-icons.js 负责加载与缓存）。
// 换图按下标找当前实体：体检自愈可能已经把实体换掉了，闭包里的旧实体不能用。
// Cesium 换图后要等新贴图进图集才会画出来，这一小段时间里 pick 拾取不到它；
// 记下换图时刻，渲染体检在这段时间内跳过它，免得把「正在换图」误判成「没画出来」而去抬高。
const MARKER_IMAGE_SETTLE_MS = 1000;
const markerImageSwapAt = new Map();   // 下标 -> 换图时刻（performance.now）
function markerCoverUrl(fp) {
    const first = fp && cityWallImages(fp)[0];
    return first ? first.url : '';
}
function markerImageOf(fp) {
    return cachedMarkerPhoto(markerCoverUrl(fp)) || MARKER_URL;
}
function loadMarkerPhotos() {
    const list = markerEntities;
    deps.footprints().forEach((fp, i) => {
        const url = markerCoverUrl(fp);
        if (!url || cachedMarkerPhoto(url)) return;
        requestMarkerPhoto(url, (image) => {
            if (!image || list !== markerEntities) return;   // 失败停在圆点；标记已整批重建则作废
            const ent = markerEntities[i];
            if (!ent || !ent.billboard) return;
            ent.billboard.image = image;
            markerImageSwapAt.set(i, performance.now());
        });
    });
}

// 构建城市聚合标记（每个城市一个，中心取足迹平均位置）
// 城市聚合键：优先 adcode（城市名可能被手动改过写法，"大理市"/"大理白族自治州" 要算同一座城），
// 没有 adcode 才退回城市名。卡片墙、城市视图、重走同城判定、明信片统计共用这一个键。
export function cityKeyOf(fp) {
    if (!fp) return '';
    const code = String(fp.cityAdcode || '').trim();
    if (code) return code;
    return String(fp.city || '').trim();
}

export function buildCityMarkers() {
    // 先按聚合键分组，再决定显示用的城市名（取该组里出现次数最多的写法）
    const groups = new Map();
    deps.footprints().forEach((fp, i) => {
        const name = String(fp.city || '').trim() || '未分类';
        const key = cityKeyOf(fp) || name;
        if (!groups.has(key)) groups.set(key, { key, names: new Map(), indices: [] });
        const group = groups.get(key);
        group.indices.push(i);
        group.names.set(name, (group.names.get(name) || 0) + 1);
    });
    cityList = [...groups.values()].map(group => {
        let best = '未分类';
        let bestCount = 0;
        group.names.forEach((count, name) => {
            if (count > bestCount) { best = name; bestCount = count; }
        });
        // key 保留聚合键：城市卡片的"只看这座城市的票根"要用它比对
        return { city: best, key: group.key, indices: group.indices };
    });
    cityMarkerEntities.forEach(ent => deps.viewer().entities.remove(ent));
    resetMarkerLabelLayout();
    cityMergeOwner = [];
    cityMergeGroups = new Map();
    cityMergedAway.clear();
    cityShownCount.clear();
    cityMarkerEntities = cityList.map(city => {
        const center = cityCenter(city);
        return deps.viewer().entities.add({
            name: city.city,
            position: center ? Cesium.Cartesian3.fromDegrees(center.lng, center.lat) : undefined,
            billboard: {
                image: cityMarkerUrl(city.indices.length),
                width: CITY_MARKER_SIZE,
                height: CITY_MARKER_SIZE,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY   // 背面隐藏由 updateMarkerOcclusion 处理
            },
            label: markerLabelGraphics(city.city, CITY_MARKER_SIZE)
        });
    });
    cityMarkerEntities.forEach((ent, ci) => cityShownCount.set(ent, cityList[ci].indices.length));
}

// 切换 城市聚合 / 展开单个足迹 模式
export function applyMarkerMode(city) {
    hidePhotoRing();   // 聚合 / 展开切换后标记的锚点会变，照片环先收掉
    if (city && cityRevealRaf) {
        cancelAnimationFrame(cityRevealRaf);
        cityRevealRaf = null;
        markerEntities.forEach(ent => {
            if (ent && ent.billboard) {
                ent.billboard.width = MARKER_SIZE;
                ent.billboard.height = MARKER_SIZE;
            }
        });
    }
    cityMode = city;
    cityMarkerEntities.forEach(ent => { ent.show = city; });
    markerEntities.forEach(ent => { ent.show = !city; });
    // 标签显隐统一交给避让布局处理（它同时判断"这个模式下该不该有标签"）。
    // 两处各写一份 label.show 会让布局的状态缓存与实际值失同步，
    // 出现"该收的没收回"（例如缩回整球后还留着城市名）。
    markerLabelDirty = true;   // 换了一批标签，下一帧重排避让
    pendingMarkerAudit = true;  // 模式切换后复检一次渲染结果（漏画的点趁早抬高）
    markerOcclusionDirty = true;   // 换了一组标记，遮挡关系重算
    buildMarkerFocusButtons();
    hideMarkerTip();
    const card = document.getElementById('cityCard');
    if (city && card) card.classList.remove('is-revealed');
    // 离开城市聚合态（相机贴到城市尺度、足迹点已展开）时城市标记本身不可见，
    // 连线的锚点随之失去意义 —— 直接收起整组卡片。
    if (!city && isProvinceCardsActive()) closeProvinceCards();
}

// 城市卡只展示已有足迹的聚合信息，不创建或维护独立的城市数据。
export function cityViewItems(ci) {
    const city = cityList[ci];
    return city ? city.indices.map(i => deps.footprints()[i]).filter(Boolean) : [];
}

export function cityPhotoItems(ci) {
    return cityViewItems(ci).flatMap(fp => cityWallImages(fp));
}

// 点击城市后的落地视角：以该城市的平均位置为中心，停在展开阈值下方、
// 但不需要贴到具体足迹点的高度——落地瞬间即可展开足迹，保持“城市上空”的整体视野。
function cityFlightTarget(ci) {
    const city = cityList[ci];
    const center = city && cityCenter(city);
    if (!center) return null;
    return { lng: center.lng, lat: center.lat, height: CITY_VIEW_HEIGHT };
}

// 城市飞行落地收尾：moveEnd 与兜底定时器都可能触发，只执行一次。
// 落地后按高度执行与手动缩放一致的 聚合/展开 切换（阈值带逻辑不变）。
export function finishCityFlight() {
    if (cityFlightTimer !== null) {
        clearTimeout(cityFlightTimer);
        cityFlightTimer = null;
    }
    if (cityMoveEndHandler) {
        deps.viewer().camera.moveEnd.removeEventListener(cityMoveEndHandler);
        cityMoveEndHandler = null;
    }
    cityFlightActive = false;
    const ci = cityFlightIndex;
    cityFlightIndex = -1;
    if (ci < 0) return;
    const h = deps.viewer().camera.positionCartographic.height;
    if (cityMode && h < CITY_EXPAND_HEIGHT) {
        revealCityFootprints(ci);
    } else if (!cityMode && h > CITY_COLLAPSE_HEIGHT) {
        applyMarkerMode(true);
    }
}

// 展开为单个足迹：切换模式后，让该城市的标记点从 0 尺寸依次长大，
// 形成“聚合点散开”的空间连续感；系统减弱动效时直接切换。
function revealCityFootprints(ci) {
    const city = cityList[ci];
    if (!city || !city.indices.length) return;
    const alreadyExpanded = !cityMode;
    applyMarkerMode(false);
    const card = document.getElementById('cityCard');
    if (card) card.classList.add('is-revealed');
    if (alreadyExpanded || deps.reduceMotion()) {
        pendingMarkerAudit = true;   // 没播动画也要体检一次渲染结果
        return;
    }
    if (cityRevealRaf) cancelAnimationFrame(cityRevealRaf);
    const indices = city.indices.slice();
    indices.forEach(fi => {
        const ent = markerEntities[fi];
        if (ent && ent.billboard) {
            ent.billboard.width = 0;
            ent.billboard.height = 0;
        }
    });
    const STEP_MS = 55;
    const DURATION_MS = 420;
    // 基准时间必须取「第一帧的时间戳」，不能用 performance.now()：
    // 这个函数是从相机 moveEnd（落地收尾）调进来的，那一刻还在 Cesium 的渲染帧里，
    // performance.now() 会晚于当前帧的起始时间，于是第一帧算出来 t <= 0、
    // pending 一直是 false，动画立刻结束，这一城的标记就永远停在 0 尺寸（看不见）。
    let startedAt = null;
    const restoreSize = (fi) => {
        const ent = markerEntities[fi];
        if (ent && ent.billboard) {
            ent.billboard.width = MARKER_SIZE;
            ent.billboard.height = MARKER_SIZE;
        }
    };
    const tick = (now) => {
        if (startedAt === null) startedAt = now;
        let pending = false;
        indices.forEach((fi, k) => {
            const ent = markerEntities[fi];
            if (!ent || !ent.billboard) return;
            const t = (now - startedAt - k * STEP_MS) / DURATION_MS;
            if (t >= 1) {
                restoreSize(fi);
            } else {
                // t <= 0 是「这一站还没轮到」，也要让循环继续跑；
                // 之前只在 t > 0 时继续，第一帧 t=0 会让循环立刻退出，动画整段丢失
                pending = true;
                if (t <= 0) return;
                const eased = 1 - Math.pow(1 - t, 3);
                ent.billboard.width = Math.max(1, Math.round(MARKER_SIZE * eased));
                ent.billboard.height = Math.max(1, Math.round(MARKER_SIZE * eased));
            }
        });
        if (pending && !cityMode) {
            cityRevealRaf = requestAnimationFrame(tick);
        } else {
            cityRevealRaf = null;
            // 兜底：动画结束时还没长到正常尺寸的（包括上面那种一帧就退出、以及
            // 中途被切回聚合模式的情况），直接补回基准尺寸，绝不让标记停在看不见的尺寸
            indices.forEach(restoreSize);
            indices.forEach(fi => {
                const ent = markerEntities[fi];
                if (ent) ent.show = true;   // 落地就该看到的点，先点亮；下一帧遮挡判定会按真实几何再校正
            });
            // 收尾后再按当前相机重算一次可见性与标签：落地瞬间的时序差异
            // 不该让某个点/名字停在上一帧状态，等用户拖动才恢复
            markerOcclusionDirty = true;
            markerLabelDirty = true;
            pendingMarkerAudit = true;   // 动画结束后在真实渲染结果上体检一次
        }
    };
    cityRevealRaf = requestAnimationFrame(tick);
}

/** 取消正在播的「聚合点散开」动画（选中某个足迹时，尺寸要交给选中态）。 */
export function cancelCityReveal() {
    if (cityRevealRaf) {
        cancelAnimationFrame(cityRevealRaf);
        cityRevealRaf = null;
    }
}

// ============ 标记自愈：实体状态正常、但画笔没上（点与名字一起消失）============
// 症状：show=true、width/height 正常、位置合法、label.show=true，可 scene.pick 在它自己的
// 屏幕位置上拾到的是地球 —— 也就是 Cesium 这一帧根本没画它，拖动/缩放后才恢复。
// 做法：展开或重建后，用 pick 在真实渲染结果上逐个体检；确认"没被画出来"的实体重建一次
// （remove + add，让位置/图标/标签全部由 Cesium 重新走一遍可视化流程）。
// ⚠ 根因（2026-09-14 现场探测确认）：Cesium 的 disableDepthTestDistance 是靠顶点着色器里
//   gl_Position.z = -gl_Position.w 把深度顶到近平面实现的，且只在顶点未被裁剪时执行；
//   当标记**正好落在椭球面（h=0）**上时这个组合会失效 —— 同一坐标只要抬高一点点就正常。
//   所以"总是画在最前"保留（地形也挡不住），改为一档档抬高直到能画出来：
//   只动被这条边界情况命中的少数点，其余点保持 h=0，避免无谓的视差偏移。
const MARKER_LIFT_STEPS = [120, 600, 2500];    // 自愈抬高档位（米）
const auditScreen = new Cesium.Cartesian2();     // 体检时换算屏幕坐标的结果缓冲
function auditMarkerRendering() {
    if (cityMode) return;                       // 聚合态下足迹点本来就是隐藏的
    if (cityRevealRaf) {                        // 正在播"聚合点散开"动画：等它播完再体检，避免误判
        pendingMarkerAudit = true;
        return;
    }
    const now = Cesium.JulianDate.now();
    let rebuilt = 0;
    let retry = false;
    let waiting = false;
    markerEntities.forEach((ent, i) => {
        if (!ent || !ent.show) return;
        const fp = deps.footprints()[i];
        if (!fp) return;
        const lifted = markerLift.get(i) || 0;
        const nextStep = MARKER_LIFT_STEPS.find(v => v > lifted);
        if (nextStep === undefined) return;     // 已经抬到最高一档仍画不出来，不再折腾
        const widthProp = ent.billboard && ent.billboard.width;
        const width = widthProp && widthProp.getValue ? widthProp.getValue(now) : widthProp;
        if (typeof width === 'number' && width < MARKER_SIZE * 0.6) {
            waiting = true;                     // 尺寸还在动画里，先不算它
            return;
        }
        if (performance.now() - (markerImageSwapAt.get(i) || -Infinity) < MARKER_IMAGE_SETTLE_MS) {
            waiting = true;                     // 刚换成照片，贴图还没进图集，等它画出来再看
            return;
        }
        const pos = ent.position && ent.position.getValue(now);
        if (!pos) return;
        const sp = Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, pos, auditScreen);
        if (!sp || sp.x < 0 || sp.y < 0 || sp.x > window.innerWidth || sp.y > window.innerHeight) return;
        const picked = deps.viewer().scene.pick(new Cesium.Cartesian2(sp.x, sp.y));
        if (picked && picked.id === ent) return;   // 画出来了，正常
        if (picked && (markerEntities.indexOf(picked.id) >= 0 || cityMarkerEntities.indexOf(picked.id) >= 0)) {
            return;                                // 被另一个标记压住：属正常遮挡，不动它
        }
        // 没被画出来 → 抬高一点重建这个实体（下一次体检会再确认）
        markerLift.set(i, nextStep);
        const center = currentPositions[i] || { lng: fp.lng, lat: fp.lat };
        const fresh = deps.viewer().entities.add({
            name: fp.name,
            position: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, nextStep),
            billboard: {
                image: markerImageOf(fp),
                width: MARKER_SIZE,
                height: MARKER_SIZE,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: markerLabelGraphics(fp.name || '', MARKER_SIZE)
        });
        fresh.show = true;
        forgetMarkerLabel(ent);
        deps.viewer().entities.remove(ent);
        markerEntities[i] = fresh;
        rebuilt++;
        retry = true;
    });
    if (rebuilt) {
        markerOcclusionDirty = true;
        markerLabelDirty = true;
        if (retry) pendingMarkerAudit = true;   // 下一帧再体检一次，必要时继续抬高
        console.warn('[footprint] 检测到 ' + rebuilt + ' 个足迹标记未被渲染，已抬高重建');
    } else if (waiting) {
        pendingMarkerAudit = true;              // 还有点在动，等停下来再看
    }
}

// 飞往城市：终点按足迹分布计算，落地瞬间自动展开该城市的足迹点。
export function flyToCity(ci) {
    if (cityFlightActive && cityFlightIndex === ci) return;   // 同一城市飞行进行中不重复起飞
    const target = cityFlightTarget(ci);
    if (!target) return;
    const duration = deps.reduceMotion() ? 0 : 1.8;
    if (cityFlightTimer !== null) {
        clearTimeout(cityFlightTimer);
        cityFlightTimer = null;
    }
    if (cityMoveEndHandler) {
        deps.viewer().camera.moveEnd.removeEventListener(cityMoveEndHandler);
        cityMoveEndHandler = null;
    }
    cityFlightActive = true;
    cityFlightIndex = ci;
    if (duration > 0) {
        cityMoveEndHandler = finishCityFlight;
        deps.viewer().camera.moveEnd.addEventListener(cityMoveEndHandler);
        cityFlightTimer = setTimeout(finishCityFlight, duration * 1000 + 600);
    }
    deps.viewer().camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(target.lng, target.lat, target.height),
        duration: duration
    });
    if (duration <= 0) finishCityFlight();
}

// ================= 悬停名称（标注式引导线，跟随标记） =================

/**
 * 指针落到某个标记（或空白，key 为 ''）上时调用：与上次相同返回 false（不必重设气泡），
 * 否则记下并返回 true。hideMarkerTip 会清空它，指针再动一次就能重新弹出来。
 */
export function claimHoveredMarkerKey(key) {
    if (key === hoveredMarkerKey) return false;
    hoveredMarkerKey = key;
    return true;
}

// 悬停/键盘聚焦时：其他标记变暗、城市轮廓透明度降低，只有当前标记保持全亮，
// 同时把聚焦的标记放大一点点。放大走 billboard.scale（Cesium 会把它乘到
// 图块宽高上），与选中态 / 复原动画改的 width 互不覆盖，两个效果可以叠加。
const MARKER_HOVER_SCALE = 1.16;

// 标记明暗的唯一出口：悬停聚焦优先；其次看省份卡片组选中的城市；两者都没有就全亮。
// 两者写两套颜色会互相覆盖（悬停结束把颜色刷回全亮、省份高亮就丢了）。
function markerEmphasisColor(entity, focus) {
    const dim = Cesium.Color.WHITE.withAlpha(PROVINCE_MARKER_DIM_ALPHA);
    if (focus) return focus === entity ? Cesium.Color.WHITE : dim;
    if (groupEmphasisKeys) {
        const index = markerEntities.indexOf(entity);
        const footprint = index >= 0 ? deps.footprints()[index] : null;
        return footprint && groupEmphasisKeys.has(footprint.key)
            ? Cesium.Color.WHITE
            : dim;
    }
    if (isProvinceCardsActive()) return provinceBrightEntitySet().has(entity) ? Cesium.Color.WHITE : dim;
    return Cesium.Color.WHITE;
}

export function refreshMarkerColors() {
    markerEntities.forEach(ent => {
        if (ent && ent.billboard) ent.billboard.color = markerEmphasisColor(ent, focusedMarker);
    });
    cityMarkerEntities.forEach(ent => {
        if (ent && ent.billboard) ent.billboard.color = markerEmphasisColor(ent, focusedMarker);
    });
}

function applyGroupVisibility() {
    markerEntities.forEach((entity, index) => {
        if (!entity) return;
        const member = !groupEmphasisKeys ||
            groupEmphasisKeys.has(deps.footprints()[index]?.key);
        if (entity.billboard) entity.billboard.show = member;
        if (!member) {
            entity.show = false;
            if (entity.label) entity.label.show = false;
        }
    });
    markerFocusLayer.querySelectorAll('[data-footprint-key]').forEach(button => {
        button.hidden = !!groupEmphasisKeys &&
            !groupEmphasisKeys.has(button.dataset.footprintKey);
    });
}

export function setMarkerFocus(entity) {
    if (focusedMarker === entity) return;
    if (focusedMarker && focusedMarker.billboard) focusedMarker.billboard.scale = 1;
    focusedMarker = entity;
    if (entity && entity.billboard) entity.billboard.scale = MARKER_HOVER_SCALE;
    const outlineMat = Cesium.Color.WHITE.withAlpha(entity ? 0.2 : 0.4);
    outlinePolylines().forEach(p => { if (p) p.material = outlineMat; });
    refreshMarkerColors();
}

/**
 * 设置当前旅程/收藏的成员高亮。传 null 恢复普通标记颜色。
 * groupEmphasisKeys 使用 Footprint.key（metadata.name），避免同名地点误匹配。
 */
export function setGroupEmphasis(keys) {
    groupEmphasisKeys = keys && keys.size ? new Set(keys) : null;
    if (groupEmphasisKeys) applyMarkerMode(false);
    applyGroupVisibility();
    refreshMarkerColors();
}

export function showMarkerTip(entity, text) {
    markerTipEntity = entity;
    markerTipName.textContent = text;
    markerTip.classList.add('show');
    setMarkerFocus(entity);
    updateMarkerTipPosition();
}

export function hideMarkerTip() {
    markerTipEntity = null;
    hoveredMarkerKey = '';   // 气泡被别的入口收起后，指针再动一次可以重新弹出来
    markerTip.classList.remove('show');
    setMarkerFocus(null);
}

// 每帧把名称钉在标记旁边（标记随地球转动/底图切换而移动）
function updateMarkerTipPosition() {
    if (!markerTipEntity) return;
    const ent = markerTipEntity;
    if (!ent) return;
    const pos = ent.position && ent.position.getValue(Cesium.JulianDate.now());
    if (!pos) return;
    // 标记转到地球背面时，隐藏悬停标注（与标记遮挡保持一致）
    const normal = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
    const toCamera = Cesium.Cartesian3.subtract(deps.viewer().camera.positionWC, pos, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.dot(normal, toCamera) < 0) {
        hideMarkerTip();
        return;
    }
    const screenPos = pos && Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, pos);
    if (!screenPos) return;
    // 先按右侧布局测量；靠近屏幕右缘时镜像到标记左侧
    markerTip.classList.remove('left');
    const w = markerTip.offsetWidth;
    const h = markerTip.offsetHeight;
    const placeLeft = screenPos.x + 4 + w > window.innerWidth - 8;
    let x, y;
    if (placeLeft) {
        markerTip.classList.add('left');
        x = screenPos.x - 4 - markerTip.offsetWidth;
    } else {
        x = screenPos.x + 4;
    }
    x = Math.max(8, Math.min(x, window.innerWidth - markerTip.offsetWidth - 8));
    y = Math.max(8, Math.min(screenPos.y - h / 2, window.innerHeight - h - 8));
    markerTip.style.left = x + 'px';
    markerTip.style.top = y + 'px';
}

// 遮挡判定与标签避让共用一个每帧入口：遮挡函数顺带回答「相机是否动过」，
// 相机静止又没有模式变化时整段跳过。
function updateMarkerOverlays() {
    // 遮挡与标签布局的实现见 marker-visibility.js；遮挡重算后脏标记一律清掉（与拆分前一致）
    // 合并要在遮挡判定之前算：遮挡判定按它决定哪些城市藏起来。
    // 合并跟着相机变，相机没动时上一帧的结果仍然成立，所以和遮挡共用同一个「要不要重算」的判断
    const provinceActive = isProvinceCardsActive();
    if (markerOcclusionDirty || cameraChangedSinceMerge() || provinceActive !== mergeProvinceActive) {
        mergeProvinceActive = provinceActive;
        if (updateCityMerge()) markerOcclusionDirty = true;
    }
    const cameraMoved = updateMarkerOcclusion(markerOcclusionDirty, deps.viewer, cityMode, cityMarkerEntities, markerEntities, cityMergedAway);
    applyGroupVisibility();
    markerOcclusionDirty = false;
    if (!cameraMoved && !markerLabelDirty) return;
    markerLabelDirty = false;
    layoutMarkerLabels({
        viewer: deps.viewer,
        footprints: deps.footprints,
        boundaryVisible: deps.boundaryVisible,
        cityLabelVisible: deps.cityLabelVisible,
        cityMode: cityMode,
        cityEntities: cityMarkerEntities,
        markerEntities: markerEntities,
        cityList: cityList,
        cityLabelOf: cityLabelText
    });
    applyGroupVisibility();
    if (pendingMarkerAudit) {
        pendingMarkerAudit = false;
        auditMarkerRendering();
    }
}
// 窗口尺寸变化后标签要重排（视口边界变了，但相机没动，光靠相机变化判定不会触发）
window.addEventListener('resize', () => { markerLabelDirty = true; markerOcclusionDirty = true; });

// 合并用的「相机动过没有」：与遮挡判定各记各的（遮挡那份在 marker-visibility.js 里，读不到）
let mergeProvinceActive = false;
const mergeCamPos = new Cesium.Cartesian3();
const mergeCamDir = new Cesium.Cartesian3();
function cameraChangedSinceMerge() {
    const camera = deps.viewer().camera;
    if (Cesium.Cartesian3.equalsEpsilon(camera.positionWC, mergeCamPos, Cesium.Math.EPSILON6) &&
        Cesium.Cartesian3.equalsEpsilon(camera.directionWC, mergeCamDir, Cesium.Math.EPSILON6)) {
        return false;
    }
    Cesium.Cartesian3.clone(camera.positionWC, mergeCamPos);
    Cesium.Cartesian3.clone(camera.directionWC, mergeCamDir);
    return true;
}

// 单个足迹的悬停文案：名称 · 城市（无城市则只显示名称）
export function footprintTipText(fp) {
    return fp.city && fp.city !== fp.name ? fp.name + '，' + fp.city : fp.name;
}

// ================= 标记键盘可达（Tab 聚焦 → Enter 打开详情卡） =================
// 每个标记对应一个屏幕外按钮；聚焦时在球面上亮出该标记名称，
// 键盘激活后焦点移入详情卡，关闭时再回到标记按钮。
// 照片环开着时这些按钮只是"屏幕外待命"（见 CSS 的 body.photo-ring-open 段）：
// 焦点一旦落上去就立刻交回环里，免得键盘用户停在一个看不见的按钮上。
function bounceFocusIntoPhotoRing() {
    if (!isPhotoRingActive()) return false;
    const item = firstVisibleRingItem();
    if (!item || !item.isConnected) return false;
    item.focus();
    return true;
}

function buildMarkerFocusButtons() {
    markerFocusLayer.innerHTML = '';
    if (cityMode) {
            // 城市模式：聚焦显示「城市 · N 个足迹」，Enter 打开城市聚合卡
        cityList.forEach((city, ci) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'marker-focus-btn';
            btn.textContent = '查看' + city.city + '，' + city.indices.length + ' 条足迹';
            btn.addEventListener('focus', () => {
                if (bounceFocusIntoPhotoRing()) return;
                showMarkerTip(cityMarkerEntities[ci], city.city + '，' + city.indices.length + ' 条足迹');
            });
            btn.addEventListener('blur', hideMarkerTip);
            btn.addEventListener('click', (e) => {
                deps.showCityCard(ci, e.detail === 0 ? btn : null);
            });
            markerFocusLayer.appendChild(btn);
        });
        return;
    }
    // 展开模式：单个足迹，聚焦显示名称，Enter 打开详情卡
    deps.footprints().forEach((fp, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'marker-focus-btn';
        btn.dataset.footprintKey = fp.key || '';
        btn.textContent = '查看' + fp.name + '足迹详情';
        btn.addEventListener('focus', () => {
            if (bounceFocusIntoPhotoRing()) return;
            showMarkerTip(markerEntities[i], footprintTipText(fp));
        });
        btn.addEventListener('blur', hideMarkerTip);
        btn.addEventListener('click', (e) => {
            deps.showMarkerCard(fp, i);
            showPhotoRing(fp, i, btn);   // 键盘路径同样出照片环（与鼠标一致）
            if (e.detail === 0) {   // 键盘激活（detail=0），鼠标点击不会跳焦点
                deps.rememberKeyboardMarkerBtn(btn);
                // 焦点落在照片环的第一张上：环在 DOM 里位于卡片之前，
                // 若把焦点放在卡片关闭按钮上，正向 Tab 就再也到不了环了。
                const ringItem = isPhotoRingActive() ? firstVisibleRingItem() : null;
                if (ringItem) focusWhenVisible(ringItem);
                else document.getElementById('markerCardClose').focus();
            }
        });
        markerFocusLayer.appendChild(btn);
    });
}
// 初始按钮由 applyMarkerMode(true) 在标记构建后生成

/** 当前标记实体（重建后数组会整体替换，所以用取值函数）。 */
export function markerEntityList() {
    return markerEntities;
}

export function cityMarkerEntityList() {
    return cityMarkerEntities;
}

export function cityListSnapshot() {
    return cityList;
}

export function isCityMode() {
    return cityMode;
}

export function isCityFlightActive() {
    return cityFlightActive;
}

export function focusedMarkerEntity() {
    return focusedMarker;
}

export function currentPositionList() {
    return currentPositions;
}

/** 初始构建：先按空数据建一次，数据到位后会再重建。 */
export function initMarkers() {
    buildMarkers();
    buildCityMarkers();
    applyMarkerMode(true);   // 初始整球视图：城市聚合
}

/** 地球铺完首批瓦片后调用：把地名字形提前栅格化，第一次飞到展开层级时不再卡一下。 */
export function prewarmMarkerLabels() {
    prewarmLabelGlyphs(deps.viewer(), [
        ...deps.footprints().map(fp => fp.name || ''),
        ...cityList.map(city => city.city || '')
    ]);
}

/** 清空全部标记实体（重建前调用）。 */
export function removeAllMarkers() {
    markerEntities.forEach(ent => deps.viewer().entities.remove(ent));
}

/** 足迹数据重建后：按当前视角恢复模式并排一次体检。 */
export function rebuildMarkerModeFromCamera() {
    const h = deps.viewer().camera.positionCartographic.height;
    applyMarkerMode(h > CITY_COLLAPSE_HEIGHT);
    pendingMarkerAudit = true;
}

/** 高度阈值驱动的模式切换（updateIntroVisibility 每帧调用）。 */
export function syncMarkerModeByHeight(cameraHeight) {
    if (cityFlightActive) return;
    if (groupEmphasisKeys) return;
    if (cityMode && cameraHeight < CITY_EXPAND_HEIGHT) {
        applyMarkerMode(false);
    } else if (!cityMode && cameraHeight > CITY_COLLAPSE_HEIGHT) {
        applyMarkerMode(true);
    }
}

/**
 * 绑定与相机帧同步的悬停/标签更新。必须在 setupMarkers 之后调用一次。
 */
export function initMarkersOverlay() {
    deps.viewer().scene.postRender.addEventListener(updateMarkerTipPosition);
    deps.viewer().scene.postRender.addEventListener(updateMarkerOverlays);
}
