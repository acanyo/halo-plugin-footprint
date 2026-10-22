/**
 * 自动旋转与画布光标。
 *
 * 自动旋转拆成两层，避免「打开卡片就永久关掉」「切回 3D 又自己转起来」这类不一致：
 * - autoRotatePref：用户偏好，只由用户动作（点按钮 / 拖动地球）改变，写 localStorage；
 * - autoRotatePauses：临时暂停原因（卡片、票根页、2D、入场动画…），对应状态退出即自动恢复。
 * autoRotate 是「此刻是否真的在转」，只由 refreshAutoRotate() 写入。
 *
 * 画布光标（抓手 / 抓取中 / 手型）也在这里：它与拖动取消自旋、悬停暂停共用
 * 同一批指针事件与状态。
 */

import { isHoveredProvince, setHoveredProvince } from './province-cards.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.viewer        () => Cesium.Viewer
 * @param d.reduceMotion  () => boolean
 */
export function setupAutoRotate(d) {
    deps = d;
}

// ================= 自动旋转 =================
const rotateBtn = document.getElementById('rotateBtn');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 自动旋转拆成两层，避免「打开卡片就永久关掉」「切回 3D 又自己转起来」这类不一致：
// - autoRotatePref：用户偏好，只由用户动作（点按钮 / 拖动地球）改变，写 localStorage；
// - autoRotatePauses：临时暂停原因（卡片、票根页、2D、入场动画…），对应状态退出即自动恢复。
// autoRotate 是「此刻是否真的在转」，只由 refreshAutoRotate() 写入。
const AUTO_ROTATE_STORAGE_KEY = 'travelMemoryAutoRotate';
function getSavedAutoRotate() {
    try {
        const saved = localStorage.getItem(AUTO_ROTATE_STORAGE_KEY);
        return saved === null ? true : saved === '1';   // 默认开启：首次访问跟随入场动画
    } catch (e) { return true; }
}
function saveAutoRotate(on) {
    try { localStorage.setItem(AUTO_ROTATE_STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
}
let autoRotatePref = getSavedAutoRotate();
const autoRotatePauses = new Set();
let autoRotate = false;

// 注意：Cesium 1.120 的 Clock 没有 deltaTime 属性（旧版本才有），
// 这里用 performance.now() 自己计算真实时间差，避免得到 NaN 卡死页面。
let lastRotateTime = null;

export function refreshAutoRotate() {
    const allowed = autoRotatePref && !reduceMotion;
    const want = allowed && autoRotatePauses.size === 0;
    // 按钮反映「用户偏好」而不是「此刻是否在转」：卡片 / 票根页 / 2D 只是临时让镜头停住，
    // 停的不是设置本身，退出后会自动接着转。
    rotateBtn.textContent = '自动旋转';   // 标签固定，状态用高亮表达，避免按钮宽度跳动
    rotateBtn.title = allowed ? '暂停自动旋转' : '开启自动旋转';
    rotateBtn.classList.toggle('active', allowed);
    rotateBtn.setAttribute('aria-pressed', String(allowed));
    if (want === autoRotate) return;
    autoRotate = want;
    lastRotateTime = null;               // 状态切换后从零计步，避免瞬移
}

// 临时暂停 / 恢复：同一原因重复调用是幂等的
export function pauseAutoRotate(reason) {
    if (autoRotatePauses.has(reason)) return;
    autoRotatePauses.add(reason);
    refreshAutoRotate();
}
export function resumeAutoRotate(reason) {
    if (!autoRotatePauses.delete(reason)) return;
    refreshAutoRotate();
}

// 拖动地球（位移超过 5px）后自动取消自动旋转；单纯点击不取消
export const cesiumCanvas = deps.viewer().scene.canvas;
let dragActive = false;
let dragStartX = 0;
let dragStartY = 0;

// 光标反馈：画布默认是「抓手」（可拖着转，见 CSS），按下变「抓取中」，
// 悬停到标记上变手型 —— 明确告诉用户这里能拖、那里能点。
let hoveredMarker = false;
let canvasHeld = false;
export function applyCanvasCursor() {
    // 可点目标有两类：标记（足迹/城市）与可点击的省份轮廓，两者都给手型
    const next = canvasHeld ? 'grabbing' : ((hoveredMarker || isHoveredProvince()) ? 'pointer' : '');
    if (cesiumCanvas.style.cursor !== next) cesiumCanvas.style.cursor = next;
}

cesiumCanvas.addEventListener('pointerdown', (e) => {
    dragActive = true;
    canvasHeld = true;
    applyCanvasCursor();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
});
window.addEventListener('pointerup', () => {
    dragActive = false;
    canvasHeld = false;
    applyCanvasCursor();
});
window.addEventListener('pointercancel', () => {
    dragActive = false;
    canvasHeld = false;
    applyCanvasCursor();
});
window.addEventListener('pointermove', (e) => {
    if (!dragActive || !autoRotate) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (dx * dx + dy * dy > 25) {      // 超过 5px 视为拖动
        dragActive = false;
        setAutoRotate(false);          // 拖动后取消自动旋转，需手动再开
    }
}, { passive: true });

// 鼠标悬停在地球表面时暂停自动旋转，移开（星空/空白/控件上方）即恢复。
// 用相机射线与地球椭球求交判断光标是否在地球圆盘内：
// 相交 = 在地球上；不相交 = 在星空/空白处。纯数学计算，无 GPU 开销。
let hoverPaused = false;
let lastHoverCheck = 0;
const hoverCheckInterval = 60;   // 节流到约 16 次/秒，避免高频计算
cesiumCanvas.addEventListener('pointermove', (e) => {
    if (!autoRotate || deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) {
        hoverPaused = false;
        return;
    }
    const now = performance.now();
    if (now - lastHoverCheck < hoverCheckInterval) return;
    lastHoverCheck = now;
    const rect = cesiumCanvas.getBoundingClientRect();
    const pos = new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top);
    const ray = deps.viewer().camera.getPickRay(pos);
    // 与地球椭球求交：有交点 = 光标在地球圆盘内（IntersectionTests.rayEllipsoid）
    const interval = ray
        ? Cesium.IntersectionTests.rayEllipsoid(ray, deps.viewer().scene.globe.ellipsoid)
        : undefined;
    hoverPaused = interval !== undefined;
});
cesiumCanvas.addEventListener('mouseleave', () => {
    hoverPaused = false;
    hoveredMarker = false;
    setHoveredProvince(false);
    applyCanvasCursor();
});

// 用户动作（点按钮）改变的是「偏好」：即使此刻正被卡片暂停，按钮也该如实反映设置本身
function setAutoRotate(on) {
    autoRotatePref = on;
    saveAutoRotate(on);
    refreshAutoRotate();
}
refreshAutoRotate();

rotateBtn.addEventListener('click', () => {
    if (reduceMotion) return;                   // 系统减弱动效时不启用
    setAutoRotate(!autoRotatePref);
});

deps.viewer().clock.onTick.addEventListener(() => {
    if (!autoRotate) return;
    if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) return;  // 只在 3D 旋转
    if (hoverPaused) return;   // 鼠标悬停时暂停
    const now = performance.now();
    const dt = lastRotateTime === null ? 0 : Math.min((now - lastRotateTime) / 1000, 0.2);
    lastRotateTime = now;
    if (dt <= 0) return;
    try {
        deps.viewer().camera.rotate(Cesium.Cartesian3.UNIT_Z, -Cesium.Math.toRadians(2) * dt); // 2 度/秒
    } catch (e) {
        console.error('自动旋转出错：', e);
    }
});
/** 此刻是否真的在转（票根页恢复视角等逻辑要读）。 */
export function isAutoRotating() {
    return autoRotate;
}

/** 用户偏好（是否开启自动旋转），与「此刻是否在转」不同。 */
export function isAutoRotatePreferred() {
    return autoRotatePref;
}

/** 悬停标记：只影响光标形状，与旋转状态无关。 */
export function setHoveredMarker(value) {
    hoveredMarker = !!value;
}


/**
 * 启动旋转时钟。必须在 setupAutoRotate 之后调用一次。
 */
export function initAutoRotate() {
    deps.viewer().clock.onTick.addEventListener(() => {
        if (!autoRotate) return;
        if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) return;  // 只在 3D 旋转
        if (hoverPaused) return;   // 鼠标悬停时暂停
        const now = performance.now();
        const dt = lastRotateTime === null ? 0 : Math.min((now - lastRotateTime) / 1000, 0.2);
        lastRotateTime = now;
        if (dt <= 0) return;
        try {
            deps.viewer().camera.rotate(Cesium.Cartesian3.UNIT_Z, -Cesium.Math.toRadians(2) * dt); // 2 度/秒
        } catch (e) {
            console.error('自动旋转出错：', e);
        }
    });
}
