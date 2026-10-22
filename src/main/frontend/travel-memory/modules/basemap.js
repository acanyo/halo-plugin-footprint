/**
 * 底图：天地图影像 provider、底图清单与切换、瓦片容错。
 *
 * 三块内容：
 *   - 天地图影像（需 Key）：_w 墨卡托瓦片，限制在中国范围内请求，省额度；
 *   - 底图清单与切换：高德 / 天地图共 7 档，选择写 localStorage；
 *   - 瓦片失败容错：403/429 直接提示（重试无用），其它错误自动重试有限次，
 *     3 秒内连续两次失败才提示，避免单瓦片抖动误报。
 */

import { amapVec, amapImg, amapImgLabel } from './amap-basemap.js';
import { countTdtProvider } from './tianditu-usage.js';
import { refreshStatusText } from './navigation.js';
import { applyMarkerPositions } from './markers.js';
import { buildCityFills } from './city-fill.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.viewer     () => Cesium.Viewer
 * @param d.cityFillOn () => boolean   城市高亮开关是否开启（换底图时重建填充）
 */
export function setupBaseMap(d) {
    deps = d;
}

let currentBaseKey = null;   // 当前底图，供「重试」重新加载
let btnMap = {};              // #layerButtons 里的底图按钮

/** 当前底图 key（状态栏与标记坐标系都读它）。 */
export function currentBase() {
    return currentBaseKey;
}

/** 底图清单（标记模块按 key 判断坐标系）。 */
export function baseProviderMap() {
    return baseProviders;
}

/** 是否配置了天地图 Key（地形按钮与数据源创建都要判）。 */
export function hasTiandituKey() {
    return hasTDTKey;
}

/** 天地图 Key（三维地形模块需要）。 */
export function tiandituKey() {
    return TDT_KEY;
}

// 底图按钮：天地图 provider 创建后要按 Key 启用/禁用，所以这里先收集
btnMap = Object.fromEntries(
    [...document.querySelectorAll('#layerButtons button')].map(b => [b.dataset.key, b])
);

// ================= 配置 =================
// 天地图 Key：在 https://lbs.tianditu.gov.cn 注册后申请（浏览器端应用）
// 不填则自动降级：只显示高德底图，无天地图影像/注记，也无三维地形
// 天地图 Key 由后台“3D 地球”设置注入，不再硬编码
const TDT_KEY = (window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.tiandituKey) || '';
const hasTDTKey = TDT_KEY && TDT_KEY !== 'YOUR_TIANDITU_KEY';

// 触屏设备判定：标记命中区尺寸与 3D 渲染倍率上限都要用
// （手机/平板放宽可点区域，同时降低渲染倍率，保证拖动、捏合跟手）

const statusText = document.getElementById('statusText');
const statusRetry = document.getElementById('statusRetry');

// 初始加载反馈：标记页面忙碌，瓦片全部就绪后解除（20 秒兜底，防卡死）
document.body.setAttribute('aria-busy', 'true');

// 瓦片加载失败：自动重试（瞬时断连 ERR_CONNECTION_CLOSED 重试通常可恢复），
// 重试耗尽后提示；提示规则：3 秒内连续 2 个瓦片失败才提示，避免单瓦片抖动误报。
let tileErrorCount = 0;
let tileErrorTimer = null;
let tileErrorShown = false;
const TILE_RETRY_MAX = 3;   // timesRetried 达到此值后停止自动重试
function tileErrorHandler(err) {
    // 403 = Key 未授权当前域名（天地图域名白名单），重试无用，直接提示
    const httpStatus = err && err.error && err.error.statusCode;
    const msg403 = /status code:\s*403/i.test((err && err.message) || '');
    const msg429 = /status code:\s*429/i.test((err && err.message) || '');
    if (httpStatus === 403 || msg403) {
        if (!tileErrorShown) {
            tileErrorShown = true;
            statusText.textContent += '，底图 Key 未授权当前域名（403）';
            statusRetry.hidden = false;
        }
        return;
    }
    // 429 = 天地图请求超限（Key 配额或瞬时并发上限），立即重试只会加重限制
    if (httpStatus === 429 || msg429) {
        if (!tileErrorShown) {
            tileErrorShown = true;
            statusText.textContent += '，天地图请求超限（429）';
            statusRetry.hidden = false;
        }
        return;
    }
    // 瓦片失败触发的是 provider.errorEvent，事件对象是 TileProviderError；
    // 设置 retry=true 会让 Cesium 重新请求该瓦片（次数受限，防止无限循环）
    if (err && err.timesRetried >= 0 && err.timesRetried < TILE_RETRY_MAX) {
        err.retry = true;
        return;
    }
    tileErrorCount++;
    clearTimeout(tileErrorTimer);
    tileErrorTimer = setTimeout(() => { tileErrorCount = 0; }, 3000);
    if (!tileErrorShown && tileErrorCount >= 2) {
        tileErrorShown = true;
        statusText.textContent += '，瓦片加载失败';
        statusRetry.hidden = false;
    }
}
// provider 会被底图切换复用，同一 provider 只挂一次监听
const tileErrorAttached = new Set();
function attachTileError(provider) {
    if (provider && provider.errorEvent && !tileErrorAttached.has(provider)) {
        provider.errorEvent.addEventListener(tileErrorHandler);
        tileErrorAttached.add(provider);
    }
}
statusRetry.addEventListener('click', () => {
    statusRetry.hidden = true;
    if (currentBaseKey) switchBase(currentBaseKey);
});


// ================= 天地图影像（需要 Key） =================
// 天地图 _w（Web 墨卡托）瓦片：第 L 级为 2^L × 2^L 张（第 1 级即 2×2），
// 行列号与 Cesium 默认 WebMercatorTilingScheme 直接对应，无需任何偏移。
// 使用 DataServer REST 接口（dvgis/cesium-map 等成熟实现同款），
// 避免 WMTS 接口因矩阵编号/几何不一致导致的瓦片错位。
// 图层代码：vec/cva=矢量底图/注记，img/cia=影像底图/注记
let tdtVec = null, tdtCva = null, tdtImg = null, tdtCia = null;
if (hasTDTKey) {
    const tdtOptions = {
        subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
        maximumLevel: 18
    };
    // 只请求中国范围内的瓦片：境外瓦片拿回来也是空白，但照样扣额度。
    // 低层级（z ≤ 5）放行，保证整球视角不会开天窗——和三维地形用的是同一套思路。
    const TDT_RECT = Cesium.Rectangle.fromDegrees(72.0, 0.5, 138.5, 56.5);
    const limitToChina = (provider) => {
        provider.getTileDataAvailable = function (x, y, level) {
            try {
                if (level <= 5) return true;
                const rect = provider.tilingScheme.tileXYToRectangle(x, y, level);
                return Cesium.Rectangle.contains(TDT_RECT, Cesium.Rectangle.center(rect));
            } catch (e) {
                return true;   // 异常时放行，别影响渲染
            }
        };
        return provider;
    };
    tdtVec = countTdtProvider(limitToChina(new Cesium.UrlTemplateImageryProvider({
        ...tdtOptions,
        url: 'https://t{s}.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=' + TDT_KEY
    })));
    tdtCva = countTdtProvider(limitToChina(new Cesium.UrlTemplateImageryProvider({
        ...tdtOptions,
        url: 'https://t{s}.tianditu.gov.cn/DataServer?T=cva_w&x={x}&y={y}&l={z}&tk=' + TDT_KEY
    })));
    tdtImg = countTdtProvider(limitToChina(new Cesium.UrlTemplateImageryProvider({
        ...tdtOptions,
        url: 'https://t{s}.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=' + TDT_KEY
    })));
    tdtCia = countTdtProvider(limitToChina(new Cesium.UrlTemplateImageryProvider({
        ...tdtOptions,
        url: 'https://t{s}.tianditu.gov.cn/DataServer?T=cia_w&x={x}&y={y}&l={z}&tk=' + TDT_KEY
    })));

    // 有 Key 时启用天地图底图按钮
    btnMap.tdtImg.disabled = false;
    btnMap.tdtVec.disabled = false;
    btnMap.tdtImgClean.disabled = false;
    btnMap.tdtVecClean.disabled = false;
}


// ================= 底图切换 =================
// gcj: true 表示该底图基于 GCJ-02（高德），标记需从 WGS84 转换后再放置
const baseProviders = {
    amapVec: { label: '高德矢量', providers: [amapVec], needKey: false, gcj: true },
    amapImg: { label: '高德卫星', providers: [amapImg, amapImgLabel], needKey: false, gcj: true },
    amapImgClean: { label: '高德卫星·无字', providers: [amapImg], needKey: false, gcj: true },
    tdtImg:  { label: '天地图影像', providers: [tdtImg, tdtCia], needKey: true, gcj: false },
    tdtVec:  { label: '天地图矢量', providers: [tdtVec, tdtCva], needKey: true, gcj: false },
    tdtImgClean:  { label: '天地图影像（无标注）', providers: [tdtImg], needKey: true, gcj: false },
    tdtVecClean:  { label: '天地图矢量（无标注）', providers: [tdtVec], needKey: true, gcj: false }
};


const BASE_STORAGE_KEY = 'travelMemoryBaseMap';
function getSavedBase() {
    try { return localStorage.getItem(BASE_STORAGE_KEY) || ''; } catch (e) { return ''; }
}
function saveBase(key) {
    try { localStorage.setItem(BASE_STORAGE_KEY, key); } catch (e) { /* 忽略 */ }
}
// 初始底图：优先使用上次保存且当前可用的底图，否则默认使用“高德卫星·无字”
function resolveInitialBase() {
    const saved = getSavedBase();
    if (saved && baseProviders[saved] && (!baseProviders[saved].needKey || hasTDTKey)) {
        return saved;
    }
    return 'amapImgClean';
}

export function switchBase(key) {
    const item = baseProviders[key];
    if (!item || (item.needKey && !hasTDTKey)) return;

    currentBaseKey = key;
    saveBase(key);   // 记住当前底图，刷新后保持
    tileErrorShown = false;
    statusRetry.hidden = true;

    deps.viewer().imageryLayers.removeAll();
    for (const provider of item.providers) {
        if (provider) {
            deps.viewer().imageryLayers.addImageryProvider(provider);
            attachTileError(provider);   // 瓦片失败走 provider.errorEvent
        }
    }

    for (const [k, btn] of Object.entries(btnMap)) {
        btn.classList.toggle('active', k === key);
    }
    applyMarkerPositions(key);
    if (deps.cityFillOn()) buildCityFills();   // 城市高亮随底图坐标系重建（天地图需转 WGS84）
    refreshStatusText();
}



/** 绑定底图按钮与重试按钮，并套用初始底图。必须在 setupBaseMap 之后调用。 */
export function initBaseMap() {
    document.querySelectorAll('#layerButtons button').forEach(btn => {
        btn.addEventListener('click', () => switchBase(btn.dataset.key));
    });

    // 默认底图：优先恢复上次保存的选择，否则用天地图影像（无标注）/ 高德卫星
    switchBase(resolveInitialBase());
}
