/**
 * Viewer 初始化后的首屏配置：相机缩放范围、瓦片忙碌标志、昼夜光照、
 * 「地球可用」信号与星空盒延后加载。
 *
 * globeReady 是这里产出的核心信号：底图第一批瓦片铺完（或 4 秒兜底）后才 resolve，
 * 省界轮廓等「迟一点到也无所谓」的资源都挂在它后面，不跟首屏抢带宽。
 */

let deps = null;
let globeReady = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.viewer  () => Cesium.Viewer
 */
export function setupGlobeBasics(d) {
    deps = d;
}


// LOD 容差按高度自适应：整球 / 中远距离用 Cesium 默认的 2.0，
// 只有贴近地面看城市细节时才收紧到 1.0 保证文字锐利。
// 阈值每减半，屏幕上的瓦片数大约翻两番（1.0 时是 2.0 的约 4 倍请求量）——
// 天地图每天只有一万次额度，这笔账必须省。
const GLOBE_SSE_FAR = 2.0;
const GLOBE_SSE_NEAR = 1.0;
const GLOBE_SSE_NEAR_HEIGHT = 2500000;   // 相机低于此高度算「贴近」

/** 按当前相机高度调整 LOD 容差（相机 moveEnd 与逐帧逻辑都会调）。 */
export function applyScreenSpaceError() {
    const h = deps.viewer().camera.positionCartographic.height;
    const next = h < GLOBE_SSE_NEAR_HEIGHT ? GLOBE_SSE_NEAR : GLOBE_SSE_FAR;
    if (deps.viewer().scene.maximumScreenSpaceError !== next) {
        deps.viewer().scene.maximumScreenSpaceError = next;
    }
}

/** 底图首批瓦片铺完的信号（或 4 秒兜底）。 */
export function globeReadySignal() {
    return globeReady;
}


/** 应用首屏配置并返回可用信号。必须在 setupGlobeBasics 之后调用一次。 */
export function initGlobeBasics() {
    deps.viewer().camera.moveEnd.addEventListener(applyScreenSpaceError);
    applyScreenSpaceError();

    // 预取保持 Cesium 默认（preloadAncestors 打开），转动/平移时瓦片衔接才顺；
    // 只把内存里的瓦片缓存加大，减少重复请求
    deps.viewer().scene.globe.tileCacheSize = 800;


    // ================= 相机交互（鼠标滚轮缩放） =================
    // zoomFactor 在 Cesium 1.121 才作为公开属性暴露（更新日志 #12099），
    // 1.120 中设置 zoomFactor 不会生效（滚轮逻辑读取的是私有字段 _zoomFactor）。
    // 这里做特性检测：新版本用公开属性，1.120 用私有字段回退。
    const cameraController = deps.viewer().scene.screenSpaceCameraController;
    const WHEEL_ZOOM_FACTOR = 3.5;   // 滚轮灵敏度系数（默认 5，越小滚一格缩放越精细）
    if ('zoomFactor' in cameraController) {
        cameraController.zoomFactor = WHEEL_ZOOM_FACTOR;
    } else {
        cameraController._zoomFactor = WHEEL_ZOOM_FACTOR;
    }
    // 缩放距离范围（米）：防止放大穿入地形、拉远把地球滚丢
    cameraController.minimumZoomDistance = 50;
    cameraController.maximumZoomDistance = 50000000;

    // 瓦片全部加载完成后解除忙碌状态
    deps.viewer().scene.globe.tileLoadProgressEvent.addEventListener((pending) => {
        if (pending === 0) document.body.setAttribute('aria-busy', 'false');
    });
    setTimeout(() => document.body.setAttribute('aria-busy', 'false'), 20000);

    // 开启昼夜光照：按时钟时间计算太阳位置，夜半球变暗（2D 平面模式下不生效）
    deps.viewer().scene.globe.enableLighting = true;
    // 让时间自动推进，明暗分界线随时间缓缓移动
    deps.viewer().clock.shouldAnimate = true;

    // ---------- 「地球可用」信号 ----------
    // 底图第一批瓦片铺完的时刻。此时用户已经看到地球，带宽也空出来了，
    // 那些"迟一点到也不影响"的资源都挂在这个信号后面，不跟底图抢首屏。
    //
    // 兜一个 4 秒定时器：底图服务异常时 tileLoadProgressEvent 可能一直不归零，
    // 没有兜底的话后面挂的东西就永远不加载了。
    globeReady = new Promise(resolve => {
        const onTileProgress = queued => {
            if (queued === 0) {
                deps.viewer().scene.globe.tileLoadProgressEvent.removeEventListener(onTileProgress);
                resolve();
            }
        };
        deps.viewer().scene.globe.tileLoadProgressEvent.addEventListener(onTileProgress);
        setTimeout(resolve, 4000);
    });

    // ---------- 星空盒延后加载 ----------
    // 6 张 Tycho 星表贴图合计 849 KB，占首屏近三成，而地球本身一点不依赖它。
    // Cesium 的 SkyBox 是在 update() 里才去取贴图的，且 show 为 false 时直接返回，
    // 所以首帧之前先关掉就能把这 849 KB 整个挪出关键路径。
    //
    // 不能改用 Viewer 的 skyBox:false —— 那个选项会连太阳和月亮一起不创建，
    // 而上面的 enableLighting 依赖太阳，昼夜晨昏线会直接消失。
    if (deps.viewer().scene.skyBox) {
        deps.viewer().scene.skyBox.show = false;
        globeReady.then(() => {
            if (deps.viewer().scene.skyBox) deps.viewer().scene.skyBox.show = true;
        });
    }

    // 3D 地球品牌文案：标题/描述使用“3D 地球”Tab 的独立配置（globeTitle/globeDesc），
    // 导航栏英文名保持默认 "Travel Memory"，不再从基本设置读取。
    const footprintCfg = window.FOOTPRINT_CONFIG || {};
    const navBrandZh = document.querySelector('.nav-brand-zh');
    const introTitleEl = document.querySelector('.intro-title');
    const introDescEl = document.querySelector('.intro-desc');
    if (navBrandZh && footprintCfg.globeTitle) navBrandZh.textContent = footprintCfg.globeTitle;
    if (introTitleEl && footprintCfg.globeTitle) introTitleEl.textContent = footprintCfg.globeTitle;
    if (introDescEl && footprintCfg.globeDesc) introDescEl.textContent = footprintCfg.globeDesc;


}
