/**
 * 初始视角与开场动画。
 *
 * 首次加载：地球从另一侧（太平洋方向）旋转入场，飞到「中国朝向」的整球视图，
 * 动画结束再开启自动旋转。尊重系统的减弱动效偏好；恢复 2D 时不播动画。
 *
 * 进入顺序刻意如此：先暂停自动旋转 → 等足迹数据与首屏瓦片 → 播动画或直接落点 →
 * 结束再解除暂停。任何一步超时都直接落点，避免在空白地球上硬播。
 */

import { startIn2D } from './view-mode.js';
import { pauseAutoRotate, resumeAutoRotate, refreshAutoRotate, cesiumCanvas } from './auto-rotate.js';
import { setEntranceActive, isEntranceActive } from './navigation.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.viewer                () => Cesium.Viewer
 * @param d.footprints            () => Footprint[]
 * @param d.footprintsDataReady   () => boolean
 * @param d.reduceMotion          () => boolean
 */
export function setupEntrance(d) {
    deps = d;
}

// ================= 初始视角与开场动画 =================
// 首次加载：地球从另一侧（太平洋方向）旋转入场，飞到“中国朝向”的整球视图，
// 动画结束再开启自动旋转；尊重系统减弱动效，2D 模式恢复时不播动画。
const ENTRANCE_SEEN_KEY = 'footprint-entrance-seen-v1';
function entranceSeen() {
    try { return localStorage.getItem(ENTRANCE_SEEN_KEY) === '1'; } catch (_) { return false; }
}
function markEntranceSeen() {
    try { localStorage.setItem(ENTRANCE_SEEN_KEY, '1'); } catch (_) { /* 隐私模式忽略 */ }
}

function globeFirstPaintReady() {
    const globe = deps.viewer().scene && deps.viewer().scene.globe;
    return !!globe && globe.tilesLoaded === true;
}

// 等首屏底图瓦片加载完成再播入场动画；网络慢时最多等固定时长，
// 超时后仍继续播放，避免页面一直停留在等待状态。
function scheduleEntranceAnimation() {
    const settleAtChina = () => {
        markEntranceSeen();
        deps.viewer().camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000)
        });
        resumeAutoRotate('entrance');   // 没播动画也要解除暂停，按偏好决定是否自转
    };

    // 已看过一次入场（首次进入/历史访问）：刷新后直接停在中国整球视图，
    // 不再跨太平洋重播动画（自转与否由 isAutoRotatePreferred() 决定）。
    if (entranceSeen()) {
        settleAtChina();
        return;
    }

    const DATA_TIMEOUT_MS = 4000;
    const TILE_TIMEOUT_MS = 3500;
    const startAt = performance.now();
    // 先把相机放在入场动画的起点（太平洋方向），让这一段底图优先开始加载，
    // 避免“动画开始后才现加载瓦片”导致空转。
    deps.viewer().camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(-60, 30, 25000000)
    });

    function step(now) {
        const elapsed = now - startAt;
        // 足迹数据还没就绪：等数据回来（可能是“空数据”），避免对空地球播入场
        if (!deps.footprintsDataReady()) {
            if (elapsed < DATA_TIMEOUT_MS) {
                requestAnimationFrame(step);
                return;
            }
            settleAtChina();
            return;
        }
        // 没有足迹数据：不播入场，直接停在中国整球视图
        if (!deps.footprints().length) {
            settleAtChina();
            return;
        }
        // 首屏瓦片就绪才开始动画；等待超时则直接停在中国，避免在空白上硬播
        if (globeFirstPaintReady()) {
            playEntranceAnimation();
            return;
        }
        if (elapsed >= TILE_TIMEOUT_MS) {
            settleAtChina();
            return;
        }
        requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
}

function playEntranceAnimation() {
    setEntranceActive(true);
    markEntranceSeen();
    const startLng = -60, startLat = 30, startH = 25000000;   // 从太平洋一侧开始
    const endLng = 104.0, endLat = 35.0, endH = 21000000;     // 中国大致中心，整球可见
    const duration = 2.6;   // 秒
    const startTime = performance.now();

    const cancelEntrance = () => {
        if (!isEntranceActive()) return;
        setEntranceActive(false);
        deps.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(endLng, endLat, endH) });
        resumeAutoRotate('entrance');
    };
    // 用户拖动/滚轮交互时立即结束入场动画，避免相机被“抢”
    cesiumCanvas.addEventListener('pointerdown', cancelEntrance);
    cesiumCanvas.addEventListener('wheel', cancelEntrance, { passive: true });

    deps.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(startLng, startLat, startH) });
    function tick(now) {
        if (!isEntranceActive()) return;
        const t = Math.min((now - startTime) / (duration * 1000), 1);
        const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
        deps.viewer().camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(
                startLng + (endLng - startLng) * k,
                startLat + (endLat - startLat) * k,
                startH + (endH - startH) * k
            )
        });
        if (t < 1) {
            requestAnimationFrame(tick);
        } else {
            setEntranceActive(false);
            resumeAutoRotate('entrance');   // 入场结束才解除暂停，避免和动画抢相机
        }
    }
    requestAnimationFrame(tick);
}



/**
 * 启动：按是否减弱动效 / 是否恢复 2D 决定播不播入场动画。必须在 setupEntrance 之后调用。
 */
export function initEntrance() {
    const restoring2D = startIn2D();   // ?view=tickets 固定按 3D 启动，不恢复上次的 2D
    if (deps.reduceMotion() || restoring2D) {
        markEntranceSeen();
        if (restoring2D) pauseAutoRotate('2d');   // 恢复成 2D 时地球在后台，保持停转
        deps.viewer().camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000) // 中国大致中心，整球可见
        });
        refreshAutoRotate();
    } else {
        pauseAutoRotate('entrance');   // 入场动画期间不自转
        scheduleEntranceAnimation();
    }

}
