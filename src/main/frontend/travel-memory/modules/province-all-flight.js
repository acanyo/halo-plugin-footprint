/**
 * 导航栏「全部城市」：相机还没放大到能看见中国轮廓时的自动缩放，以及按钮的按下 / 可用态。
 *
 * 从 province-cards.js 拆出。飞行状态归本模块；卡片组本身的开关仍在 province-cards.js，
 * 这里只通过参数里的回调把「落地后展开」「同步按钮」交回去，所以不反向 import 它。
 */

// 「全部城市」自动缩放的落点：轮廓可见（< 9500km）且仍是城市聚合态（> 1500km）
const PROVINCE_ALL_FLY_HEIGHT = 8000000;
const PROVINCE_ALL_FLY_DURATION = 1.6;
const PROVINCE_ALL_FLY_LNG = 104.0;
const PROVINCE_ALL_FLY_LAT = 34.5;

let provinceAllFlight = false;      // 「全部城市」正在自动缩放到能看见中国轮廓
let provinceAllFlightHandler = null;
let provinceAllFlightTimer = null;
let provinceAllBtnCache = null;     // 「全部城市」导航按钮
let provinceAllAvailable = null;    // 按钮可用态缓存（只在变化时写 DOM）

// 自动缩放：终点取一个"轮廓可见 + 城市聚合态"的高度（9.5e6 > h > 1.5e6）
// done 在落地且没被取消时调用；onSettled 在状态翻转时调用（用来同步按钮按下态）。
export function flyToChinaForCityCards(viewer, reduceMotion, done, onSettled) {
    provinceAllFlight = true;
    onSettled();   // 自动缩放期间按钮也算"已按下"：用户点了立刻有反馈
    const duration = reduceMotion() ? 0 : PROVINCE_ALL_FLY_DURATION;
    const finish = () => {
        if (provinceAllFlightHandler) {
            viewer().camera.moveEnd.removeEventListener(provinceAllFlightHandler);
            provinceAllFlightHandler = null;
        }
        if (provinceAllFlightTimer !== null) {
            clearTimeout(provinceAllFlightTimer);
            provinceAllFlightTimer = null;
        }
        if (!provinceAllFlight) return;   // 飞行途中已被取消
        provinceAllFlight = false;
        done();
        onSettled();
    };
    if (provinceAllFlightTimer !== null) {
        clearTimeout(provinceAllFlightTimer);
        provinceAllFlightTimer = null;
    }
    if (duration > 0) {
        provinceAllFlightHandler = finish;
        viewer().camera.moveEnd.addEventListener(provinceAllFlightHandler);
        provinceAllFlightTimer = setTimeout(finish, duration * 1000 + 700);   // moveEnd 没来时的兜底
    }
    viewer().camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            PROVINCE_ALL_FLY_LNG, PROVINCE_ALL_FLY_LAT, PROVINCE_ALL_FLY_HEIGHT),
        duration: duration
    });
    if (duration <= 0) finish();
}

// 停掉还没落地的自动缩放；本来就没在飞时返回 false
export function stopProvinceAllFlight(viewer) {
    if (!provinceAllFlight) return false;
    provinceAllFlight = false;
    if (provinceAllFlightHandler) {
        viewer().camera.moveEnd.removeEventListener(provinceAllFlightHandler);
        provinceAllFlightHandler = null;
    }
    if (provinceAllFlightTimer !== null) {
        clearTimeout(provinceAllFlightTimer);
        provinceAllFlightTimer = null;
    }
    return true;
}

/** 「全部城市」自动缩放是否还在进行（Esc 要能取消）。 */
export function isProvinceAllFlying() {
    return provinceAllFlight;
}

// ---------- 导航栏「全部城市」按钮 ----------
function provinceAllBtnEl() {
    if (!provinceAllBtnCache) provinceAllBtnCache = document.getElementById('provinceAllBtn');
    return provinceAllBtnCache;
}

// 按钮按下态（展开着「全部城市」或正在飞过去）
export function setProvinceAllBtnPressed(on) {
    const btn = provinceAllBtnEl();
    if (!btn) return;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
}

// 可用态：只有「3D + 桌面端 + 城市聚合态」时才可点（每帧调用，只在翻转时写 DOM）
export function syncProvinceAllBtnEnabled(isEnabled) {
    const btn = provinceAllBtnEl();
    if (!btn) return;
    const enabled = isEnabled();
    if (provinceAllAvailable === enabled) return;
    provinceAllAvailable = enabled;
    btn.disabled = !enabled;
}
