/**
 * 城市淡色填充：给去过的城市罩一层淡色（城市级边界，clampToGround 贴合地形）。
 *
 * 注意：clampToGround 的多边形不渲染 outline（GeoJSON 的 stroke/strokeWidth 会静默失效），
 * 所以边界轮廓单独提取环线，用贴合地面的折线绘制。
 * DataV 边界是 GCJ-02：高德底图直接使用；切到天地图（WGS84）底图时整体转换坐标与标记对齐。
 *
 * 中国轮廓（省界）的加载留在主文件 —— 它同时决定边界显隐与省份高亮，
 * 但边界数据源通过 setChinaBoundarySource 交给本模块与省卡模块共用。
 */

import { gcj02ToWgs84 } from './coordinate.js';
import {
    CITY_FILL_THEME,
    CITY_FILL_THEMES,
    PROVINCE_CITY_HL_FILL
} from './province-style.js';

let deps = null;

// ---- 模块内部状态 ----
let cityFillVisible = false;     // 城市淡色填充当前是否可见（与边界共用一套阈值状态）
let cityFillDataSources = [];
let cityFillBuildId = 0;
let cityOutlinePolylines = [];   // 城市轮廓描边折线（悬停聚焦时统一调透明度）
let cityFillIndex = new Map();   // 城市高亮图层：adcode -> { entities }（悬停卡片时换色用）
let cityFillHighlightAdcode = '';// 当前被换成青蓝的城市高亮
const cityBoundaryCache = new Map();   // 城市边界数据缓存：同一会话内按 adcode 只请求一次

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.viewer                  () => Cesium.Viewer
 * @param d.footprints / d.cityList () => 数据
 * @param d.baseProviders           () => Record<string, provider>
 * @param d.currentBaseKey          () => string | null
 */
export function setupCityFill(d) {
    deps = d;
}

// ================= 城市高亮开关 =================
// 默认关闭（首次加载不高亮），开启后放大到国内范围才显示填充+轮廓；
// 选择用 localStorage 记住，刷新后保持。关闭时不加载/不渲染城市边界。
const CITY_FILL_STORAGE_KEY = 'travelMemoryCityFill';
function getSavedCityFill() {
    try { return localStorage.getItem(CITY_FILL_STORAGE_KEY) === '1'; } catch (e) { return false; }
}
function saveCityFill(on) {
    try { localStorage.setItem(CITY_FILL_STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
}
let cityFillEnabled = getSavedCityFill();
const cityFillBtn = document.getElementById('cityFillBtn');

/** 城市高亮是否开启（换底图、数据重建时要判）。 */
export function isCityFillEnabled() {
    return cityFillEnabled;
}

function applyCityFillBtnState() {
    cityFillBtn.classList.toggle('active', cityFillEnabled);
    cityFillBtn.setAttribute('aria-pressed', String(cityFillEnabled));
    deps.cityFillFloatBtn().classList.toggle('active', cityFillEnabled);
    deps.cityFillFloatBtn().setAttribute('aria-pressed', String(cityFillEnabled));
}

export function setCityFillEnabled(on) {
    if (cityFillEnabled === on) return;
    cityFillEnabled = on;
    applyCityFillBtnState();
    saveCityFill(on);
    if (on) {
        buildCityFills();   // 开启后加载边界并显示（仍按缩放阈值显隐）
    } else {
        clearCityFills();   // 关闭时移除填充与轮廓
    }
}

/** 绑定高亮开关按钮并套用已保存的选择。必须在 setupCityFill 之后调用。 */
export function initCityFill() {
    applyCityFillBtnState();
    cityFillBtn.addEventListener('click', () => setCityFillEnabled(!cityFillEnabled));
    deps.cityFillFloatBtn().addEventListener('click', () => setCityFillEnabled(!cityFillEnabled));
}

/** 主文件的可见性阈值（updateIntroVisibility）调用：同步边界与城市填充的显隐。 */
export function setCityFillVisible(visible) {
    if (cityFillVisible === visible) return;
    cityFillVisible = visible;
    // 只在状态真正翻转时才写 DataSource.show —— 逐帧赋值会反复触发
    // Cesium 的属性变更，白白消耗在每帧的渲染回调里。
    cityFillDataSources.forEach(ds => { ds.show = visible; });
}

/** 城市轮廓描边折线：悬停聚焦标记时统一调透明度。 */
export function outlinePolylines() {
    return cityOutlinePolylines;
}


// 使用阿里云 DataV 提供的公开中国边界数据（国内可访问）。
// 该数据默认是 GCJ-02，与高德底图对齐；切到天地图（WGS84）时会有约 500 米偏移，
// 国家尺度下基本不可见（城市级填充已做坐标转换，见 buildCityFills）。

// 给去过的城市罩一层淡色（城市级边界，clampToGround 贴合地形）。
// 注意：clampToGround 的多边形不渲染 outline（GeoJSON 的 stroke/strokeWidth 会静默失效），
// 所以边界轮廓单独提取环线，用贴合地面的折线绘制。
// DataV 边界是 GCJ-02：高德底图直接使用；切到天地图（WGS84）底图时整体转换坐标与标记对齐。

export function loadCityBoundary(adcode) {
    if (!cityBoundaryCache.has(adcode)) {
        cityBoundaryCache.set(
            adcode,
            // DataV 服务带防盗链：请求携带站点 Referer（如 lik.cc）会返回 403，
            // 这里显式关闭 Referer（no-referrer），与无 Referer 的 curl 结果一致（200）。
            fetch('https://geo.datav.aliyun.com/areas_v3/bound/' + adcode + '.json', {
                referrerPolicy: 'no-referrer'
            })
                .then(res => {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .catch(e => {
                    cityBoundaryCache.delete(adcode);   // 失败允许下次重试
                    throw e;
                })
        );
    }
    return cityBoundaryCache.get(adcode);
}

// 把 DataV 的 GCJ-02 边界整体转成 WGS84（天地图底图时调用）
export function cityBoundaryToWgs84(geojson) {
    const clone = typeof structuredClone === 'function'
        ? structuredClone(geojson)
        : JSON.parse(JSON.stringify(geojson));
    const convert = coords => {
        if (typeof coords[0] === 'number') {
            const w = gcj02ToWgs84(coords[0], coords[1]);
            return [w.lng, w.lat];
        }
        return coords.map(convert);
    };
    (clone.features || []).forEach(f => {
        if (f.geometry && f.geometry.coordinates) {
            f.geometry.coordinates = convert(f.geometry.coordinates);
        }
    });
    return clone;
}

export function clearCityFills() {
    cityFillDataSources.forEach(ds => deps.viewer().dataSources.remove(ds));
    cityFillDataSources = [];
    cityOutlinePolylines = [];
    cityFillIndex = new Map();   // 换了底图/数据后会整体重建，索引与"换色"状态一并清掉
    cityFillHighlightAdcode = '';
    cityFillVisible = false;   // 下次构建时按当前相机高度重新决定显隐
}

export function buildCityFills() {
    const buildId = ++cityFillBuildId;   // 防止上次异步加载残留
    clearCityFills();
    const fillColor = CITY_FILL_THEMES[CITY_FILL_THEME] || CITY_FILL_THEMES.amber;
    const item = deps.currentBaseKey() ? deps.baseProviders()[deps.currentBaseKey()] : null;
    const basemapIsGcj = !!(item && item.gcj);
    const seen = new Set();
    deps.FOOTPRINTS().forEach(fp => {
        const adcode = String(fp.cityAdcode || '');
        if (!adcode || seen.has(adcode)) return;
        seen.add(adcode);
        loadCityBoundary(adcode).then(geojson => {
            if (buildId !== cityFillBuildId) return null;   // 已被更新的构建取代
            const data = basemapIsGcj ? geojson : cityBoundaryToWgs84(geojson);
            return Cesium.GeoJsonDataSource.load(data, {
                clampToGround: true,   // 贴合地形，避免被地形盖住
                fill: Cesium.Color.fromCssColorString(fillColor.fill)
                // 轮廓用独立的贴合地面折线绘制，不交给 GeoJsonDataSource，
                // 避免 Cesium 对 terrain 上的 outline 报“不支持”的警告
            });
        }).then(ds => {
            if (!ds) return;
            if (buildId !== cityFillBuildId) {   // 已被更新的构建取代
                deps.viewer().dataSources.remove(ds);
                return;
            }
            // 按当前高度决定显隐：用户已经放大到国内范围时，边界加载完成应立即出现，
            // 不必等他再缩放一次
            ds.show = cityFillVisible;

            // 边界轮廓：从多边形层级中提取外环与孔洞环，闭合后画成贴合地面的折线
            const now = Cesium.JulianDate.now();
            const fillEntities = [];
            ds.entities.values.forEach(entity => {
                const polygon = entity.polygon;
                if (!polygon || !polygon.hierarchy) return;
                fillEntities.push(entity);
                // clampToGround + terrain 不支持 polygon outline，轮廓统一用贴合地面的折线绘制
                polygon.outline = false;
                const hierarchy = polygon.hierarchy.getValue(now);
                if (!hierarchy || !hierarchy.positions || !hierarchy.positions.length) return;
                const rings = [hierarchy.positions];
                (hierarchy.holes || []).forEach(hole => {
                    if (hole && hole.positions && hole.positions.length) rings.push(hole.positions);
                });
                rings.forEach(ring => {
                    const closed = ring.slice();
                    closed.push(closed[0]);   // 闭合环线
                    const outlineEnt = ds.entities.add({
                        polyline: {
                            positions: closed,
                            clampToGround: true,   // 贴合地形
                            width: 1,
                            material: Cesium.Color.WHITE.withAlpha(0.4)
                        }
                    });
                    cityOutlinePolylines.push(outlineEnt.polyline);
                });
            });

            deps.viewer().dataSources.add(ds);
            cityFillDataSources.push(ds);
            // 记下"这座城市的高亮面是哪些实体"：悬停卡片时要把它们从主题金色换成青蓝
            cityFillIndex.set(String(adcode), { entities: fillEntities });
        }).catch(e => {
            console.warn('城市边界加载失败 ' + adcode + ':', e);
        });
    });
}

// ---------- 城市高亮换色：金色 ⇄ 青蓝 ----------
export function cityFillBaseColor() {
    const theme = CITY_FILL_THEMES[CITY_FILL_THEME] || CITY_FILL_THEMES.amber;
    return Cesium.Color.fromCssColorString(theme.fill);
}

// 卡片 -> 该城市的 adcode（与 buildCityFills 的聚合键一致：取该城第一条足迹的 cityAdcode）
export function cityFillAdcodeOf(ci) {
    const city = deps.cityList()[ci];
    if (!city) return '';
    for (let i = 0; i < city.indices.length; i++) {
        const fp = deps.FOOTPRINTS()[city.indices[i]];
        if (fp && fp.cityAdcode) return String(fp.cityAdcode);
    }
    return '';
}

export function paintCityFill(entry, highlight) {
    if (!entry || !entry.entities) return;
    const color = highlight
        ? Cesium.Color.fromCssColorString(PROVINCE_CITY_HL_FILL)
        : cityFillBaseColor();
    // 每个实体单独赋新材质：同一个数据源里的实体共享材质实例，改实例会整城一起变
    entry.entities.forEach(entity => {
        if (entity.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(color);
    });
}

// 同一时刻只换一座城：换新的之前先把上一座还原成主题金色
export function applyCityFillHighlight(adcode) {
    const next = adcode ? String(adcode) : '';
    if (next === cityFillHighlightAdcode) return;
    const previous = cityFillIndex.get(cityFillHighlightAdcode);
    if (previous) paintCityFill(previous, false);
    cityFillHighlightAdcode = next;
    const entry = next ? cityFillIndex.get(next) : null;
    if (entry) paintCityFill(entry, true);
}
