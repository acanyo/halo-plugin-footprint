/**
 * 2D / 3D 视图切换。
 *
 * 3D：Cesium 地球（默认首页）；2D：项目原有高德地图（懒加载，见 footprint.js 的 window.Footprint2D）。
 * 切换过程使用 Cesium 原生 morph 动画：3D→2D 先让地球「展开」成平面，动画结束再显示高德页面；
 * 2D→3D 先显示仍处于平面状态的地球，再「合并」回球体。
 *
 * 视图模式写 localStorage，刷新后保持上次选择。
 */

import { isTicketsView } from './ticket-gallery.js';
import { resumeAutoRotate, pauseAutoRotate } from './auto-rotate.js';
import { hidePhotoRing } from './photo-ring.js';
import {
    isProvinceCardsActive,
    closeProvinceCards,
    cancelAllCityFlight
} from './province-cards.js';

let deps = null;

let amapMode = false;   // 当前是否处于 2D 高德地图视图（导航栏显隐、自动旋转暂停都要读）

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.viewer / d.markerCard / d.markerTip  () => HTMLElement / Cesium.Viewer
 * @param d.reduceMotion  () => boolean
 * @param d.hideCityCard / d.hideMarkerCard  () => void
 */
export function setupViewMode(d) {
    deps = d;
}

// ================= 2D/3D 自定义切换按钮 =================
// 3D：Cesium 地球（默认首页）；2D：切换为项目原有高德地图（懒加载，见 footprint.js 的 window.Footprint2D）。
// 切换过程使用 Cesium 原生 morph 动画：3D→2D 先让地球“展开”成平面，动画结束再显示高德页面；
// 2D→3D 先显示仍处于平面状态的地球，再“合并”回球体。
const sceneModeBtn = document.getElementById('sceneModeBtn');
export const view3d = document.getElementById('view-3d');
export const view2d = document.getElementById('view-2d');
const MORPH_DURATION = 1.5;   // 展开/合并动画时长（秒）
let morphing = false;         // morph 动画进行中，防止重复点击
let pendingMode = null;       // 动画结束后的目标模式：'2d' | '3d'
let morphTimeoutId = null;    // 兜底：morph 事件异常未触发时强制完成切换

// 视图模式记忆：刷新后保持上次的 2D/3D 状态
const VIEW_MODE_STORAGE_KEY = 'travelMemoryViewMode';
function getSavedViewMode() {
    try { return localStorage.getItem(VIEW_MODE_STORAGE_KEY) || '3d'; } catch (e) { return '3d'; }
}
export function saveViewMode(mode) {
    try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode); } catch (e) { /* 忽略 */ }
}
// 是否以 2D 视图启动。票根页只属于 3D 地球：带 ?view=tickets 直接进来时固定走 3D，
// 否则票根页会被一起隐藏的 #view-3d 吞掉（详细原因见 forceGlobeForTickets）。
// 这里只影响本次打开，用户记住的 2D 偏好仍然保留，下次普通访问照旧回到 2D。
export function startIn2D() {
    return getSavedViewMode() === '2d' && !isTicketsView();
}

function armMorphTimeout() {
    clearTimeout(morphTimeoutId);
    morphTimeoutId = setTimeout(() => {
        if (!morphing) return;
        console.warn('morph 动画超时，强制执行视图切换');
        if (pendingMode === '2d') {
            finishSwitchTo2D();
        } else if (pendingMode === '3d') {
            finishSwitchTo3D();
        } else {
            morphing = false;
        }
    }, MORPH_DURATION * 1000 + 800);
}

// 中国大致范围（含南海诸岛），用于平面视角定位
const CHINA_VIEW = Cesium.Rectangle.fromDegrees(73.5, 3.8, 135.1, 53.6);
// 世界全图范围，作为 2D 动画起点（Web Mercator 纬度上限约 ±85.05°）
const WORLD_VIEW = Cesium.Rectangle.fromDegrees(-180, -85.05, 180, 85.05);

// 2D 下从“整个世界地图”平滑缩放到指定矩形（绕开 camera.flyTo 在 2D 模式的已知问题）
function animateCameraToRect(targetRect, duration, onComplete) {
    const startPos = deps.viewer().camera.getRectangleCameraCoordinates(WORLD_VIEW);
    const start = deps.viewer().scene.mapProjection.unproject(startPos);
    const endPos = deps.viewer().camera.getRectangleCameraCoordinates(targetRect);
    const end = deps.viewer().scene.mapProjection.unproject(endPos);

    const startLng = Cesium.Math.toDegrees(start.longitude);
    const startLat = Cesium.Math.toDegrees(start.latitude);
    const startH = start.height;
    const endLng = Cesium.Math.toDegrees(end.longitude);
    const endLat = Cesium.Math.toDegrees(end.latitude);
    const endH = end.height;

    const startTime = performance.now();

    function tick(now) {
        // 缩放到中国的途中目标变了（例如从 2D 直接进票根页），立刻让出相机控制权
        if (pendingMode !== '2d') return;
        const t = Math.min((now - startTime) / (duration * 1000), 1);
        const k = t * t * (3 - 2 * t); // smoothstep 缓动
        deps.viewer().camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(
                startLng + (endLng - startLng) * k,
                startLat + (endLat - startLat) * k,
                startH + (endH - startH) * k
            )
        });
        if (t < 1) {
            requestAnimationFrame(tick);
        } else if (onComplete) {
            onComplete();
        }
    }
    requestAnimationFrame(tick);
}

function updateSceneModeBtn() {
    // 按钮显示“将要切换到的视图”，避免“当前状态”造成语义歧义
    const to2D = deps.viewer().scene.mode !== Cesium.SceneMode.SCENE2D;
    sceneModeBtn.textContent = to2D ? '2D 地图' : '3D 地球';
    sceneModeBtn.title = to2D ? '切换到 2D 平面地图' : '切换到 3D 地球';
}

// 切换前收起地球侧可能打开的覆盖层，避免返回 3D 时残留
function closeGlobeOverlays() {
    ['markerCard', 'lightbox', 'cityView', 'markerTip'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('visible');
            el.classList.remove('show');
        }
    });
    document.body.classList.remove('card-open');
    // 这些浮层是直接摘掉类名关掉的（没走 hideMarkerCard/hideCityCard），
    // 对应的自动旋转暂停也要一起解除，否则会一直停在暂停状态
    resumeAutoRotate('card');
    resumeAutoRotate('city-card');
    hidePhotoRing();   // 照片环同理：切 2D 前要收掉
    if (isProvinceCardsActive()) closeProvinceCards();
    else cancelAllCityFlight();
}

export function finishSwitchTo2D() {
    clearTimeout(morphTimeoutId);
    amapMode = true;
    if (view3d) view3d.hidden = true;
    if (view2d) view2d.hidden = false;
    document.body.classList.remove('mode-3d');
    document.body.classList.add('mode-2d');
    sceneModeBtn.textContent = '3D 地球';
    sceneModeBtn.title = '切换到 3D 地球';
    pauseAutoRotate('2d');             // 进入 2D 后暂停地球自转（退出 2D 会自动恢复）
    deps.viewer().clock.shouldAnimate = false;   // 地球隐藏时冻结昼夜光照，降低开销
    saveViewMode('2d');
    if (window.Footprint2D && typeof window.Footprint2D.show === 'function') {
        window.Footprint2D.show();
    }
    morphing = false;
    pendingMode = null;
}

// 2D 落地：展开飞到中国后，让高德页在地球下方先初始化，地图就绪后再交叉淡化，
// 避免“平面地图 → 高德地图”的生硬切页。
function begin2dCrossfade() {
    if (pendingMode !== '2d') return;
    let swapped = false;
    let readyGuard = null;
    const completeSwap = () => {
        if (swapped) return;
        swapped = true;
        clearTimeout(readyGuard);
        view3d.style.transition = 'opacity 0.45s ease';
        view2d.style.transition = 'opacity 0.45s ease';
        view3d.style.opacity = '0';
        view2d.style.opacity = '1';
        setTimeout(() => {
            view3d.style.transition = '';
            view3d.style.opacity = '';
            view2d.style.transition = '';
            view2d.style.opacity = '';
            finishSwitchTo2D();
        }, 480);
    };
    // 先让高德页在地球下方可见（透明）并初始化，地图就绪后再淡化
    view2d.hidden = false;
    view2d.style.opacity = '0';
    view3d.style.opacity = '1';
    if (window.Footprint2D && typeof window.Footprint2D.show === 'function') {
        window.Footprint2D.show(() => completeSwap());
        readyGuard = setTimeout(() => completeSwap(), 2500);   // 兜底：AMap 长时间未就绪也完成切换
    } else {
        completeSwap();
    }
}

// persist=false 用于「只是为了让票根页有个 3D 背景」的强制切换：显隐要改，用户偏好不改
function finishSwitchTo3D(persist = true) {
    clearTimeout(morphTimeoutId);
    amapMode = false;
    if (view2d) view2d.hidden = true;
    if (view3d) view3d.hidden = false;
    document.body.classList.remove('mode-2d');
    document.body.classList.add('mode-3d');
    sceneModeBtn.textContent = '2D 地图';
    sceneModeBtn.title = '切换到 2D 平面地图';
    deps.viewer().clock.shouldAnimate = true;
    resumeAutoRotate('2d');   // 回到 3D 按用户偏好恢复自转（不再无条件开启）
    if (persist) saveViewMode('3d');
    if (window.Footprint2D && typeof window.Footprint2D.hide === 'function') {
        window.Footprint2D.hide();
    }
    morphing = false;
    pendingMode = null;
}

// 切 2D：先让地球“展开”成平面，动画结束后再显示高德页面
function switchTo2D() {
    if (amapMode || morphing) return;
    closeGlobeOverlays();
    pauseAutoRotate('2d');   // 立刻停转，别让展开动画和自转抢镜头
    if (deps.reduceMotion()) {   // 无障碍：关闭动画，直接切换
        finishSwitchTo2D();
        return;
    }
    morphing = true;
    pendingMode = '2d';
    armMorphTimeout();
    deps.viewer().scene.morphTo2D(MORPH_DURATION);
}

// 切 3D：先显示仍处于平面状态的地球，再“合并”回球体
function switchTo3D() {
    if (!amapMode || morphing) return;
    if (window.Footprint2D && typeof window.Footprint2D.hide === 'function') {
        window.Footprint2D.hide();
    }
    if (deps.reduceMotion()) {   // 无障碍：关闭动画，直接切换
        finishSwitchTo3D();
        return;
    }
    if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE2D) {
        // 场景不在 2D 平面（正常不该出现，见下面恢复 2D 时的说明）：Cesium 会直接跳过 morph，
        // morphComplete 也就不会触发，只能立刻落地，否则要干等 2.3 秒兜底超时才收尾。
        finishSwitchTo3D();
        return;
    }
    // 提前把视图换回地球（此时它处于上次 morphTo2D 后的平面状态），作为合并动画起点
    if (view2d) view2d.hidden = true;
    if (view3d) view3d.hidden = false;
    document.body.classList.remove('mode-2d');
    document.body.classList.add('mode-3d');
    deps.viewer().resize();   // 容器刚从隐藏恢复，先校正画布尺寸，避免 morph 过程变形
    morphing = true;
    pendingMode = '3d';
    armMorphTimeout();
    deps.viewer().scene.morphTo3D(MORPH_DURATION);
}

// 票根页只属于 3D 地球（挂载在 #view-3d 里，2D 下整个容器是隐藏的），
// 所以当前在 2D 时打开票根页要先切回 3D：不播合并动画，也不写 localStorage，
// 免得用户只是点开一次票根链接，记住的 2D 偏好就被改掉了。
export function forceGlobeForTickets() {
    if (!amapMode && !morphing && deps.viewer().scene.mode === Cesium.SceneMode.SCENE3D) return;
    clearTimeout(morphTimeoutId);
    morphing = false;
    pendingMode = null;
    try {
        // 展开动画途中就切票根页的话，先让它立即落地；否则动画结束时仍会按 pendingMode 切去 2D
        deps.viewer().scene.completeMorph();
        if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) deps.viewer().scene.morphTo3D(0);
    } catch (e) {
        console.warn('票根页切回 3D 失败：', e);
    }
    finishSwitchTo3D(false);
    deps.viewer().resize();   // 容器刚从隐藏恢复，先校正画布尺寸
    deps.viewer().camera.cancelFlight();
    // 平面合并回球体后相机常贴近地表（地球看着是“扁”的），直接归位到整球视角
    deps.viewer().camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000)
    });
}

// morph 动画结束：按目标模式完成视图交换
deps.viewer().scene.morphComplete.addEventListener(() => {
    try {
        updateSceneModeBtn();
        if (pendingMode === '2d') {
            // 展开完成后保持平面地球可见，先平滑缩放到中国范围，再切换高德页面，
            // 避免直接从“整张平面世界地图”跳到“中国高德地图”的违和感。
            clearTimeout(morphTimeoutId);
            const ZOOM_DURATION = 1.2;   // 平面视角飞到中国范围的时长（秒）
            morphTimeoutId = setTimeout(() => {
                if (pendingMode === '2d') begin2dCrossfade();
            }, ZOOM_DURATION * 1000 + 600);
            try {
                animateCameraToRect(CHINA_VIEW, ZOOM_DURATION, () => {
                    clearTimeout(morphTimeoutId);
                    begin2dCrossfade();
                });
            } catch (e) {
                console.warn('平面视角定位失败：', e);
                clearTimeout(morphTimeoutId);
                begin2dCrossfade();
            }
        } else if (pendingMode === '3d') {
            finishSwitchTo3D();
            // 视角归位：morph 从平面回到球体后相机常贴近地表，地球会显得“扁”。
            // 不用 flyTo（飞行状态可能挂起导致无法拖拽），直接 setView 回到整球视角。
            deps.viewer().camera.cancelFlight();   // 兜底：清理可能残留的飞行状态
            deps.viewer().camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
            });
        } else {
            morphing = false;
        }
    } catch (e) {
        console.error('2D/3D 切换失败：', e);
        morphing = false;
        pendingMode = null;
    }
});

sceneModeBtn.addEventListener('click', () => {
    if (amapMode) {
        switchTo3D();
    } else {
        switchTo2D();
    }
});

// 2D 视图：顶部导航栏隐藏，由高德页底部控制栏的“3D 地球”按钮切回 3D
const back3dBtn = document.getElementById('back3dBtn');
if (back3dBtn) {
    back3dBtn.addEventListener('click', () => {
        if (amapMode) switchTo3D();
    });
}

/**
 * 恢复上次的 2D/3D 模式（刷新后保持，不做展开动画，避免 3D 闪一下）。
 *
 * 恢复 2D 时只换页面显隐不够：Cesium 场景本身还停在 3D 球体上，
 * 之后点「3D 地球」时 morphTo3D 会因「本来就在 3D」被跳过、不触发 morphComplete，
 * 表现是瞬间切页、没有合并动画。所以这里用 0 秒 morph 把场景状态补齐。
 */
export function restoreSavedViewMode() {
    try {
        if (startIn2D() && !amapMode) {
            try {
                deps.viewer().resize();   // 此刻 #view-3d 仍可见，先保证宽高比有效
                if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE2D) {
                    deps.viewer().scene.morphTo2D(0);
                }
            } catch (e) {
                console.warn('2D 场景状态初始化失败（切回 3D 时可能没有动画）：', e);
            }
            finishSwitchTo2D();
        }
    } catch (e) {
        console.warn('恢复视图状态失败，使用默认 3D 视图：', e);
        saveViewMode('3d');
        document.body.classList.remove('mode-2d');
        document.body.classList.add('mode-3d');
        if (view3d) view3d.hidden = false;
        if (view2d) view2d.hidden = true;
    }
}

/** 当前是否在 2D 高德视图（标题卡显隐、导航栏常驻、票根页强制 3D 都要用）。 */
export function isAmapMode() {
    return amapMode;
}

/** 启动时若记住的是 2D，由主文件在数据就绪后调一次。 */
export function enterSaved2DIfNeeded() {
    if (startIn2D() && !amapMode) startIn2D();
}
