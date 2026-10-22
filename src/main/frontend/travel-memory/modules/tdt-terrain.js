/**
 * 天地图三维地形（可选开关，默认关闭）。
 *
 * 专有地形格式，Cesium.sampleTerrain 对它不适用；主要覆盖国内范围（级别 5-12 左右）。
 * 天地图 Key 绑定域名白名单（未授权返回 403），且地形与影像/矢量共用每日配额（429）。
 * 因此默认不启用地形；导航栏「三维地形」开启时先探测授权，成功才启用，失败自动回退平面。
 *
 * 两个外部依赖（写状态栏里的地形文案、用最新状态重绘状态栏）走注入而不是反向 import
 * 主文件，否则会成环，这个模块也就没法单独使用了。
 */

let deps = null;

/**
 * @param d.setTerrainNote   (note: string) => void  写状态栏里"三维地形"那一小段文案
 * @param d.updateStatusText () => void               用最新状态重绘整条状态栏
 */
export function setTdtTerrainDeps(d) {
    deps = d;
}

const terrainBtn = document.getElementById('terrainBtn');
const statusText = document.getElementById('statusText');
const TDT_TERRAIN_STORAGE_KEY = 'travelMemoryTerrain';

function getSavedTerrain() {
    try { return localStorage.getItem(TDT_TERRAIN_STORAGE_KEY) === '1'; } catch (e) { return false; }
}
function saveTerrain(on) {
    try { localStorage.setItem(TDT_TERRAIN_STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
}

let terrainEnabled = false;    // 实际启用状态（探测成功后才为 true）
let terrainPending = false;    // 防止探测期间重复点击

function applyTerrainBtnState() {
    terrainBtn.classList.toggle('active', terrainEnabled);
    terrainBtn.setAttribute('aria-pressed', String(terrainEnabled));
}

/**
 * @param viewer     Cesium.Viewer 实例
 * @param hasTDTKey  是否配置了天地图 Key（且不是占位默认值）
 * @param tdtKey     天地图 Key
 */
function setTdtTerrain(on, viewer, { hasTDTKey, tdtKey }) {
    if (terrainPending) return;
    if (!on) {
        terrainEnabled = false;
        saveTerrain(false);
        deps.setTerrainNote('，未启用三维地形');
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
        applyTerrainBtnState();
        deps.updateStatusText();
        return;
    }
    if (!hasTDTKey || typeof TdtPlug === 'undefined' || !TdtPlug.GeoTerrainProvider) {
        terrainBtn.disabled = true;
        return;
    }
    terrainPending = true;
    fetch('https://t0.tianditu.gov.cn/mapservice/swdx?T=elv_c&x=211&y=36&l=8&tk=' + tdtKey)
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const provider = new TdtPlug.GeoTerrainProvider({
                url: 'https://t{s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&x={x}&y={y}&l={z}&tk=' + tdtKey,
                subdomains: ['0', '1', '2', '3', '4', '5', '6', '7']
            });
            // 天地图高程仅覆盖中国范围，且 Cesium 1.120 的 CustomHeightmapTerrainProvider
            // 不读 rectangle 选项。覆盖 getTileDataAvailable：境外/超深瓦片返回 false，
            // Cesium 直接标记为不可用而不发起请求，避免"无效数据"报错刷屏。
            const chinaRect = Cesium.Rectangle.fromDegrees(72.0, 0.5, 138.5, 56.5);
            provider.getTileDataAvailable = function (x, y, level) {
                try {
                    if (level < 5) return true;    // 低级别插件返回平面缓冲，始终可用（保证球面能构建）
                    if (level >= 12) return false; // 插件 12 级及以上不发送请求
                    const rect = provider.tilingScheme.tileXYToRectangle(x, y, level);
                    return Cesium.Rectangle.contains(chinaRect, Cesium.Rectangle.center(rect));
                } catch (e) {
                    return true;   // 异常时放行给插件原有逻辑，避免影响渲染
                }
            };
            viewer.terrainProvider = provider;
            terrainEnabled = true;
            deps.setTerrainNote('，已启用天地图三维地形');
            saveTerrain(true);
        })
        .catch(e => {
            terrainEnabled = false;
            saveTerrain(false);
            deps.setTerrainNote('，未启用三维地形（Key 未授权当前域名或未开通地形服务）');
            console.warn('天地图三维地形不可用，使用平面地球：', e.message || e);
            statusText.textContent =
                '三维地形不可用：天地图 Key 未授权当前域名或未开通地形服务。' +
                '请在天地图控制台把当前域名加入白名单后重试。';
        })
        .finally(() => {
            terrainPending = false;
            applyTerrainBtnState();
            deps.updateStatusText();
        });
}

/**
 * @param viewer            Cesium.Viewer 实例
 * @param opts.hasTDTKey    是否配置了天地图 Key
 * @param opts.tdtKey       天地图 Key
 * @param opts.enableDefault 后台"默认启用三维地形"配置：未选择过时是否默认开启
 */
export function initTdtTerrain(viewer, { hasTDTKey, tdtKey, enableDefault }) {
    terrainBtn.addEventListener('click', () => setTdtTerrain(!terrainEnabled, viewer, { hasTDTKey, tdtKey }));
    const terrainAvailable = !!(hasTDTKey && typeof TdtPlug !== 'undefined' && TdtPlug.GeoTerrainProvider);
    terrainBtn.hidden = !terrainAvailable;   // 无 Key / 无插件时直接隐藏，不占导航位置
    terrainBtn.disabled = !terrainAvailable;
    // 初始化：恢复上次选择；未选择过时按后台"默认启用三维地形"配置
    if (getSavedTerrain() || enableDefault) {
        setTdtTerrain(true, viewer, { hasTDTKey, tdtKey });
    }
    applyTerrainBtnState();
}
