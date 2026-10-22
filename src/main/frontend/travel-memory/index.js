/**
 * 前台主逻辑。
 *
 * 这个文件正在逐块拆成 modules/ 下的模块。拆的顺序是「叶子优先」：
 * 先搬没有外部依赖的纯逻辑，每搬一块就构建、上站点点一遍、单独提交，
 * 确认无回归再动下一块。下面的 import 清单就是已经搬完的部分。
 *
 * 还没搬的代码仍是一整片顶层语句（当年从 <script> 里抠出来的，
 * 所以整体带着 4 格缩进）。别被缩进误导：它们都在模块顶层，互相可见。
 */

import { wgs84ToGcj02, gcj02ToWgs84 } from './modules/coordinate.js';
import { countTdtProvider, tdtTodayUsage, setTileBatchHandler } from './modules/tianditu-usage.js';
import { amapVec, amapImg, amapImgLabel } from './modules/amap-basemap.js';
import { compareTicketByTime, ticketHasCoordinate, isSameTicketCity } from './modules/ticket-utils.js';
import { startCityWallWarmQueue, stopCityWallWarmQueue } from './modules/city-wall-prewarm.js';
import { lightbox, openLightbox, closeLightbox, switchLightbox, setLightboxDeps } from './modules/lightbox.js';
import { setTdtTerrainDeps, initTdtTerrain } from './modules/tdt-terrain.js';
import {
    setupViewMode,
    isAmapMode,
    finishSwitchTo2D,
    forceGlobeForTickets,
    saveViewMode,
    startIn2D,
    view2d,
    view3d
} from './modules/view-mode.js';
import {
    setupCityFill,
    setCityFillVisible,
    outlinePolylines,
    buildCityFills,
    clearCityFills,
    applyCityFillHighlight,
    cityFillAdcodeOf
} from './modules/city-fill.js';
import {
    setupAutoRotate,
    initAutoRotate,
    pauseAutoRotate,
    resumeAutoRotate,
    refreshAutoRotate,
    applyCanvasCursor,
    cesiumCanvas,
    isAutoRotating,
    isAutoRotatePreferred,
    setHoveredMarker
} from './modules/auto-rotate.js';
import {
    setupCityView,
    initCityView,
    cityView,
    openCityView,
    closeCityView,
    openCityViewAtFootprint,
    selectCityViewTab,
    cityWallImages,
    formatCityDate,
    formatLightboxDate,
    loadCardCoverImage,
    renderCardCover,
    enqueueCardCover,
    showCardCover
} from './modules/city-view.js';
import {
    setupProvinceCards,
    initProvinceCards,
    activateAllCityCards,
    activateProvinceCards,
    cancelAllCityFlight,
    cityCardsEnabled,
    closeProvinceCards,
    loadProvinceGeoJson,
    maybeShowProvinceHint,
    normalizeProvinceName,
    openProvinceCards,
    provinceAdcodeOfEntity,
    provinceAtScreenPoint,
    provinceHoverAt,
    provincePickingEnabled,
    syncProvinceAllAvailability,
    isProvinceCardsActive,
    provinceBrightEntitySet,
    isHoveredProvince,
    setHoveredProvince,
    isProvinceAllFlying,
    takeProvinceRestorePending,
    clearProvinceRestorePending,
    setProvinceEntityIndex
} from './modules/province-cards.js';
import {
    setupPhotoRing,
    initPhotoRing,
    showPhotoRing,
    hidePhotoRing,
    photoRingIsOpenFor,
    focusWhenVisible,
    exitPhotoRingView,
    switchPhotoRingView,
    isPhotoRingActive,
    isPhotoRingViewing,
    firstVisibleRingItem
} from './modules/photo-ring.js';
import { COARSE_POINTER, SVG_NS } from './modules/env.js';
import {
    setupGlobeBasics,
    initGlobeBasics,
    globeReadySignal
} from './modules/globe-basics.js';
import {
    setupEntrance,
    initEntrance
} from './modules/entrance.js';
import {
    setupNavigation,
    initNavigation,
    isIntroVisible,
    isBoundaryVisible,
    isCityLabelVisible,
    isEntranceActive,
    setEntranceActive,
    setChinaBoundarySource,
    setTerrainNote,
    refreshStatusText,
    cityFillFloatBtn
} from './modules/navigation.js';
import {
    setupMarkers,
    initMarkers,
    initMarkersOverlay,
    markerCard,
    cityCard,
    markerCardGallery,
    markerTip,
    markerFocusLayer,
    buildMarkers,
    buildCityMarkers,
    applyMarkerMode,
    applyMarkerPositions,
    rebuildMarkerModeFromCamera,
    syncMarkerModeByHeight,
    removeAllMarkers,
    areDetailCardsReady,
    hideDetailCardsForIntro,
    cityKeyOf,
    cityCenter,
    cityViewItems,
    cityPhotoItems,
    finishCityFlight,
    hideMarkerCard,
    showMarkerCard,
    hideCityCard,
    showCityCard,
    markerScreenPosition,
    cardLayoutRect,
    refreshMarkerColors,
    setMarkerFocus,
    setOverlayHidden,
    markerEntityList,
    cityMarkerEntityList,
    cityListSnapshot,
    isCityMode,
    isCityFlightActive,
    focusedMarkerEntity,
    currentPositionList
} from './modules/markers.js';
import {
    PROVINCE_CITY_HL_FILL,
    PROVINCE_MARKER_DIM_ALPHA
} from './modules/province-style.js';
import {
    setupCityWall,
    initCityWall,
    cityCardImageUrl,
    featureEnabled,
    setGlobeRenderLoop,
    cityWall,
    cityWallBack,
    cityWallBtn,
    cityWallCardData,
    cityWallInsightBtn,
    cityWallProvinceFilter,
    cityWallTimeCapsuleBtn,
    closeCityWall,
    openCityWall,
    renderCityWall,
    setCityWallProvinceFilter
} from './modules/city-wall.js';
import {
    setupCreativeOverlays,
    initCreativeOverlays,
    refreshCityWallFeatureActions,
    loadPostcardImage,
    postcardToBlob,
    canvasSafeImageUrl,
    closeInsight,
    closePostcard,
    closeTimeCapsule,
    openPostcard,
    insightView,
    postcardPreview,
    timeCapsule
} from './modules/creative-overlays.js';
import {
    setupTicketGallery,
    initTicketGallery,
    ticketImageUrl,
    ticketDate,
    ticketItemsFromFootprints,
    wrapTicketLetterText,
    isTicketsView,
    openTicketGalleryForCity,
    setTicketView
} from './modules/ticket-gallery.js';
import {
    clampNumber,
    round1,
    snapDevicePx,
    overlapArea,
    ringSampleIndexes,
    fitBox,
    offsetCenteredRects,
    rectsBBox,
    totalOverlapArea,
    pushVector,
    angleGap
} from './modules/geometry.js';
import {
    haversineKm,
    setInsightDeps,
    insightSpotDate,
    insightKm,
    insightPlaceName,
    insightTimeStats,
    insightProvinceStats,
    insightSegmentStats,
    insightTypeStats,
    insightYearStats,
    insightDerived,
    insightAchievements,
    insightTitlesOf,
    insightFallbackTitle,
    insightTitleOf,
    insightMetrics,
    insightSentences
} from './modules/footprints-insight.js';

// 状态栏重绘来自 navigation 模块，这里可以安全地先注入
setTileBatchHandler(refreshStatusText);
// 同理，下面三个也都是函数声明
setLightboxDeps({ cityWallImages, formatLightboxDate, setOverlayHidden });
// 洞察的统计口径同样靠注入拿数据：FOOTPRINTS / cityList 是 let，要取值函数而不是快照
setInsightDeps({ footprints: () => FOOTPRINTS, cityList: () => cityListSnapshot(), cityViewItems, cityWallImages, ticketImageUrl, cityKeyOf });
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

    const btnMap = Object.fromEntries(
        [...document.querySelectorAll('#layerButtons button')].map(b => [b.dataset.key, b])
    );

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

    // ================= 自动旋转与画布光标 =================
    setupAutoRotate({
        viewer: () => viewer,
        reduceMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    });
    initAutoRotate();

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

    function applyCityFillBtnState() {
        cityFillBtn.classList.toggle('active', cityFillEnabled);
        cityFillBtn.setAttribute('aria-pressed', String(cityFillEnabled));
        cityFillFloatBtn.classList.toggle('active', cityFillEnabled);
        cityFillFloatBtn.setAttribute('aria-pressed', String(cityFillEnabled));
    }
    function setCityFillEnabled(on) {
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
    applyCityFillBtnState();
    cityFillBtn.addEventListener('click', () => setCityFillEnabled(!cityFillEnabled));
    cityFillFloatBtn.addEventListener('click', () => setCityFillEnabled(!cityFillEnabled));

    // 系统是否要求减弱动效：入场动画、2D 切换、卡片飞行等多处共用
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ================= 顶部导航与左侧标题卡 =================
    // 实现见 modules/navigation.js：标题卡/导航显隐、状态栏、底图菜单、Esc 逐级关闭。
    setupNavigation({
        viewer: () => viewer,
        reduceMotion: () => reduceMotion,
        applyScreenSpaceError,
        footprints: () => FOOTPRINTS,
        baseProviders: () => baseProviders,
        currentBaseKey: () => currentBaseKey,
        statusText: () => document.getElementById('statusText'),
        statusRetry: () => document.getElementById('statusRetry'),
        hasTdtKey: () => hasTDTKey
    });
    initNavigation();

    // ================= 足迹标记与详情卡 =================
    // 实现见 modules/markers.js：标记构建、城市聚合、详情卡、悬停与标签避让。
    setupMarkers({
        footprints: () => FOOTPRINTS,
        viewer: () => viewer,
        baseProviders: () => baseProviders,
        footprintCfg: () => footprintCfg,
        reduceMotion: () => reduceMotion,
        boundaryVisible: isBoundaryVisible,
        cityLabelVisible: isCityLabelVisible,
        applyScreenSpaceError
    });
    initMarkers();
    initMarkersOverlay();

    // ================= 城市淡色填充 =================
    // 实现见 modules/city-fill.js；主题配色在 modules/province-style.js。
    setupCityFill({
        viewer: () => viewer,
        footprints: () => FOOTPRINTS,
        cityList: () => cityListSnapshot(),
        baseProviders: () => baseProviders,
        currentBaseKey: () => currentBaseKey,
    });

    // ================= 2D/3D 视图切换 =================
    // 实现见 modules/view-mode.js；morph 动画与视图模式记忆都在那边。
    setupViewMode({
        viewer: () => viewer,
        markerCard: () => markerCard,
        markerTip: () => markerTip,
        reduceMotion: () => reduceMotion,
        hideCityCard,
        hideMarkerCard
    });

    // ================= 初始化 Viewer =================
    const viewer = new Cesium.Viewer('cesiumContainer', {
        baseLayer: false,          // 不用 Cesium 默认底图，全部换成国内服务
        animation: false,          // 隐藏左下角动画控件
        timeline: false,           // 隐藏底部时间轴
        fullscreenButton: false,   // 隐藏右下角全屏按钮
        baseLayerPicker: false,    // 隐藏右上角底图选择器
        geocoder: false,           // 隐藏右上角搜索框
        homeButton: false,         // 隐藏右上角 Home 按钮
        sceneModePicker: false,    // 隐藏右上角 2D/3D 模式切换按钮
        navigationHelpButton: false, // 隐藏右上角导航帮助按钮
        infoBox: false,            // 隐藏点击实体后的信息框
        selectionIndicator: false, // 隐藏点击实体后的四角选中框
        useBrowserRecommendedResolution: true // 渲染倍率交给下面的 resolutionScale 统一控制
        // 已移除 Cesium.Terrain.fromWorldTerrain()（依赖海外 Ion 服务），地形改由天地图提供
    });

    viewer.cesiumWidget.creditContainer.style.display = 'none';

    // Cesium 默认的双击会 `viewer.trackedEntity = 拾取到的实体`：相机被拖进"跟随实体"模式，
    // 表现为镜头突然变成斜面、之后旋转缩放都不跟手。本页不需要这个默认行为，直接移除；
    // 顺手清一次跟踪状态，避免之前误触留下的跟随残留。
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    viewer.trackedEntity = undefined;

    // 高分屏渲染倍率封顶：useBrowserRecommendedResolution=false 时有效倍率会直接等于
    // window.devicePixelRatio，3 倍屏手机等于按 9 倍像素渲染，拖动和捏合会明显掉帧。
    // 这里改成显式指定：桌面最多 2 倍，触屏 1.5 倍（清晰度几乎无损，帧率更稳）。
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, COARSE_POINTER ? 1.5 : 2);

    // LOD 容差改成「按高度自适应」：整球 / 中远距离用 Cesium 默认的 2.0，
    // 只有贴近地面看城市细节时才收紧到 1.0 保证文字锐利。
    // 阈值每减半，屏幕上的瓦片数大约翻两番（1.0 时是 2.0 的约 4 倍请求量）——
    // 天地图每天只有一万次额度，这笔账必须省。
    const GLOBE_SSE_FAR = 2.0;
    const GLOBE_SSE_NEAR = 1.0;
    const GLOBE_SSE_NEAR_HEIGHT = 2500000;   // 相机低于此高度算「贴近」
    function applyScreenSpaceError() {
        const h = viewer.camera.positionCartographic.height;
        const next = h < GLOBE_SSE_NEAR_HEIGHT ? GLOBE_SSE_NEAR : GLOBE_SSE_FAR;
        if (viewer.scene.maximumScreenSpaceError !== next) viewer.scene.maximumScreenSpaceError = next;
    }
    viewer.camera.moveEnd.addEventListener(applyScreenSpaceError);
    applyScreenSpaceError();

    // 预取保持 Cesium 默认（preloadAncestors 打开），转动/平移时瓦片衔接才顺；
    // 只把内存里的瓦片缓存加大，减少重复请求
    viewer.scene.globe.tileCacheSize = 800;

    // ================= 首屏配置（相机 / 忙碌标志 / 光照 / 地球可用信号） =================
    setupGlobeBasics({ viewer: () => viewer });
    initGlobeBasics();

    // 3D 地球品牌文案：标题/描述使用“3D 地球”Tab 的独立配置（globeTitle/globeDesc），
    // 导航栏英文名保持默认 "Travel Memory"，不再从基本设置读取。
    const footprintCfg = window.FOOTPRINT_CONFIG || {};
    const navBrandZh = document.querySelector('.nav-brand-zh');
    const introTitleEl = document.querySelector('.intro-title');
    const introDescEl = document.querySelector('.intro-desc');
    if (navBrandZh && footprintCfg.globeTitle) navBrandZh.textContent = footprintCfg.globeTitle;
    if (introTitleEl && footprintCfg.globeTitle) introTitleEl.textContent = footprintCfg.globeTitle;
    if (introDescEl && footprintCfg.globeDesc) introDescEl.textContent = footprintCfg.globeDesc;



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
    let currentBaseKey = null;   // 当前底图，供“重试”重新加载

    // 足迹标记数据：完全由后端注入的 FOOTPRINT_CONFIG.footprints 提供，不内置任何兜底样例；
    // 没有数据时保持空数组，页面不构建任何标记。
    // coordType: 'gcj02' 表示坐标来自高德（火星坐标），'wgs84' 表示标准经纬度（天地图 CGCS2000 直接可用）
    let FOOTPRINTS = [];
    let footprintsDataReady = false;   // 首次足迹数据加载是否已完成（含“确实为空”）

    // ================= 足迹数据加载（FOOTPRINT_CONFIG） =================
    // window.FOOTPRINT_CONFIG.footprints 为 Footprint CRD 数组（模板注入），坐标均为高德（GCJ-02）来源。
    // 加载失败时回退到上面的内置数据。
    function mapTestJsonEntry(entry) {
        const s = entry && entry.spec;
        if (!s || !s.name) return null;
        return {
            key: (entry.metadata && entry.metadata.name) || '',
            name: s.name,
            description: s.description || '',
            address: s.address || '',
            lng: Number(s.longitude),
            lat: Number(s.latitude),
            coordType: 'gcj02',   // test.json 坐标均为高德（GCJ-02）来源
            city: s.city || '',
            province: s.province || '',
            provinceAdcode: String(s.provinceAdcode || ''),
            cityAdcode: String(s.cityAdcode || ''),
            footprintType: s.footprintType || '',
            createTime: formatTestDate(s.createTime),
            article: s.article || '',
            zoomLevel: Number(s.zoomLevel) || 12,
            image: s.image || '',
            ticketImage: s.ticketImage || '',
            ticketTitle: s.ticketTitle || '',
            ticketEnglish: s.ticketEnglish || '',
            ticketSubtitle: s.ticketSubtitle || '',
            ticketDate: s.ticketDate || '',
            ticketRoute: s.ticketRoute || '',
            ticketNo: s.ticketNo || '',
            ticketType: s.ticketType || '',
            galleryImages: (s.galleryImages || []).map(g => ({ url: g.url, caption: '' }))
        };
    }

    // createTime 兼容两种格式：test.json 的 "01/05/2026 01:04:00"（MM/DD/YYYY）与
    // FOOTPRINT_CONFIG 注入的 ISO 格式 "2026-01-05T01:04:00Z"，统一转成 YYYY-MM-DD
    function formatTestDate(str) {
        if (!str) return '';
        const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(str);
        if (m) return m[3] + '-' + m[1] + '-' + m[2];
        const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
        return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : str;
    }

    // 足迹数据源：只读取模板注入的 window.FOOTPRINT_CONFIG.footprints；
    // 配置为空/无效时返回空数组，页面保持无足迹状态，不再回退样例数据。
    async function loadFootprintsFromJson() {
        try {
            const cfg = window.FOOTPRINT_CONFIG || {};
            const list = Array.isArray(cfg.footprints) ? cfg.footprints : [];
            const mapped = list.map(mapTestJsonEntry).filter(Boolean);
            return mapped;
        } catch (e) {
            console.warn('足迹配置解析失败：', e);
            return [];
        }
    }

    // 用加载到的数据替换足迹数组（保持数组引用不变，各处引用自动生效）
    function applyFootprints(loaded) {
        if (!Array.isArray(loaded)) return false;
        FOOTPRINTS.length = 0;
        FOOTPRINTS.push(...loaded);
        return true;
    }

    // 统计区：总足迹数 / 去过的城市数（数据驱动）
    function updateIntroStats() {
        const total = document.getElementById('introTotal');
        const cities = document.getElementById('introCities');
        if (total) total.textContent = FOOTPRINTS.length;
        if (cities) cities.textContent = new Set(FOOTPRINTS.map(f => f.city).filter(Boolean)).size;
    }
    updateIntroStats();


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

    function switchBase(key) {
        const item = baseProviders[key];
        if (!item || (item.needKey && !hasTDTKey)) return;

        currentBaseKey = key;
        saveBase(key);   // 记住当前底图，刷新后保持
        tileErrorShown = false;
        statusRetry.hidden = true;

        viewer.imageryLayers.removeAll();
        for (const provider of item.providers) {
            if (provider) {
                viewer.imageryLayers.addImageryProvider(provider);
                attachTileError(provider);   // 瓦片失败走 provider.errorEvent
            }
        }

        for (const [k, btn] of Object.entries(btnMap)) {
            btn.classList.toggle('active', k === key);
        }
        applyMarkerPositions(key);
        if (cityFillEnabled) buildCityFills();   // 城市高亮随底图坐标系重建（天地图需转 WGS84）
        refreshStatusText();
    }

    document.querySelectorAll('#layerButtons button').forEach(btn => {
        btn.addEventListener('click', () => switchBase(btn.dataset.key));
    });

    // 默认底图：优先恢复上次保存的选择，否则用天地图影像（无标注）/ 高德卫星
    switchBase(resolveInitialBase());

    // ================= 天地图三维地形（可选开关，默认关闭） =================
    // 实现见 modules/tdt-terrain.js；专有地形格式，默认不启用，导航栏「三维地形」
    // 开启时先探测授权，成功才启用，失败自动回退平面。
    setTdtTerrainDeps({
        setTerrainNote,
        updateStatusText: refreshStatusText
    });
    initTdtTerrain(viewer, {
        hasTDTKey,
        tdtKey: TDT_KEY,
        enableDefault: !!(window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.enableTerrainDefault)
    });


    // ================= 初始视角与开场动画 =================
    // 实现见 modules/entrance.js：入场动画、已看过判断、减弱动效与 2D 恢复。
    setupEntrance({
        viewer: () => viewer,
        footprints: () => FOOTPRINTS,
        footprintsDataReady: () => footprintsDataReady,
        reduceMotion: () => reduceMotion
    });
    initEntrance();

    // 图片灯箱在 modules/lightbox.js

    // ================= 城市卡片墙（「城记」） =================
    // 实现见 modules/city-wall.js。封面懒加载、悬停轮播、省市筛选都在那边。
    setupCityWall({
        footprints: () => FOOTPRINTS,
        cityList: () => cityListSnapshot(),
        cityViewItems,
        cityWallImages,
        formatCityDate,
        footprintCfg: () => footprintCfg,
        provinceCardsActive: isProvinceCardsActive,
        markerCard: () => markerCard,
        cityCard: () => cityCard,
        viewer: () => viewer,
        hideMarkerCard,
        hideCityCard,
        hidePhotoRing,
        closeLightbox,
        closeProvinceCards,
        openCityView,
        openPostcard,
        openTicketGalleryForCity,
        refreshCityWallFeatureActions,
        setOverlayHidden
    });
    initCityWall();
    // ================= 创意覆盖层（时间胶囊 / 足迹洞察 / 旅行明信片） =================
    // 实现见 modules/creative-overlays.js。三块都叠在城市卡片墙之上，共享同一套层级约定。
    setupCreativeOverlays({
        footprints: () => FOOTPRINTS,
        cityList: () => cityListSnapshot(),
        cityViewItems,
        cityWallImages,
        featureEnabled,
        formatCityDate,
        cityWallCardData,
        openCityView,
        setOverlayHidden,
        setCityWallProvinceFilter,
        closeCityWall,
        openCityWall,
        renderCityWall,
        cityWall: () => cityWall,
        cityWallBack: () => cityWallBack,
        cityWallBtn: () => cityWallBtn,
        cityWallInsightBtn: () => cityWallInsightBtn,
        cityWallTimeCapsuleBtn: () => cityWallTimeCapsuleBtn,
        cityWallProvinceFilter: () => cityWallProvinceFilter
    });
    initCreativeOverlays();
    // ================= 加载足迹数据并重建标记 =================
    loadFootprintsFromJson().then(loaded => {
        if (applyFootprints(loaded)) {
            removeAllMarkers();
            // 按当前底图坐标系重算标记坐标，并刷新状态栏足迹数（不重载瓦片，避免闪烁）
            if (currentBaseKey) {
                applyMarkerPositions(currentBaseKey);
                refreshStatusText();
            }
            // 重建标记并按当前视角恢复城市/展开模式（整球视图默认城市聚合）
            buildMarkers();
            buildCityMarkers();
            rebuildMarkerModeFromCamera();
            if (cityFillEnabled) buildCityFills();   // 城市高亮开关开启时才随新数据重建
        }
        footprintsDataReady = true;
        updateIntroStats();
        document.dispatchEvent(new CustomEvent('footprints:loaded'));
    });

    // ================= 照片环（点足迹标记后围绕标记铺开的多图预览） =================
    // 实现见 modules/photo-ring.js；布局算法复用 modules/geometry.js。
    setupPhotoRing({
        viewer: () => viewer,
        markerCard: () => markerCard,
        markerFocusLayer: () => markerFocusLayer,
        reduceMotion: () => reduceMotion,
        cityWallImages,
        loadCardCoverImage,
        markerScreenPosition,
        cardLayoutRect,
        pauseAutoRotate,
        resumeAutoRotate
    });
    initPhotoRing();

    // ================= 城市足迹全屏视图（左侧足迹 Tab 卡片 + 右侧详情） =================
    // 实现见 modules/city-view.js；卡片封面队列与时间线也在那边。
    setupCityView({
        footprints: () => FOOTPRINTS,
        cityList: () => cityListSnapshot(),
        currentPositions: currentPositionList,
        markerCard: () => markerCard,
        cityCard: () => cityCard,
        markerCardGallery: () => markerCardGallery,
        viewer: () => viewer,
        hideCityCard,
        hideMarkerCard,
        hideMarkerTip,
        showMarkerCard,
        setOverlayHidden
    });
    initCityView();

    // ================= 省份城市卡片（点击省份 → 每个有足迹的城市各一张小卡片 + 抛物线） =================
    // 实现见 modules/province-cards.js；命中判定的几何索引也在那边。
    setupProvinceCards({
        footprints: () => FOOTPRINTS,
        cityList: () => cityListSnapshot(),
        markerEntities: markerEntityList,
        cityMarkerEntities: cityMarkerEntityList,
        cityMode: isCityMode,
        focusedMarker: focusedMarkerEntity,
        boundaryVisible: isBoundaryVisible,
        markerCard: () => markerCard,
        cityCard: () => cityCard,
        viewer: () => viewer,
        reduceMotion: () => reduceMotion,
        applyCityFillHighlight,
        cityFillAdcodeOf,
        cityCenter,
        cityPhotoItems,
        cityViewItems,
        enqueueCardCover,
        renderCardCover,
        formatCityDate,
        showCityCard,
        hideCityCard,
        hideMarkerCard,
        openCityView,
        pauseAutoRotate,
        resumeAutoRotate,
        refreshMarkerColors,
        setMarkerFocus
    });
    initProvinceCards();

    // ================= 票根册（票夹 / 重走 / 护照 / 抽票 / 明信片） =================
    // 实现见 modules/ticket-gallery.js。六块功能共用一套票根状态，整体作为一个领域迁出；
    // 这里只负责把宿主侧的取值函数与动作注进去，再绑定事件。
    setupTicketGallery({
        footprints: () => FOOTPRINTS,
        cityList: () => cityListSnapshot(),
        cityKeyOf,
        viewer: () => viewer,
        reduceMotion: () => reduceMotion,
        footprintCfg: () => footprintCfg,
        markerCard: () => markerCard,
        cityCard: () => cityCard,
        cityView: () => cityView,
        cityWall: () => cityWall,
        provinceCardsActive: isProvinceCardsActive,
        clearProvinceRestorePending,
        hideMarkerCard,
        hideCityCard,
        closeProvinceCards,
        forceGlobeForTickets,
        openCityView,
        openCityWall,
        pauseAutoRotate,
        resumeAutoRotate,
        restoreGlobeViewForAutoRotate,
        setGlobeRenderLoop,
        setOverlayHidden,
        loadPostcardImage,
        postcardToBlob
    });
    initTicketGallery();

    // 省界轮廓同样挂在 globeReady 之后：它只在放大到国内范围才显示
    // （见下面 boundaryVisible 的高度判定），整球视图下这 208 KB 纯属白占首屏带宽。
    // 挂在瓦片铺完之后而不是等到真正放大时才拉，是为了让用户放大时已经准备好，
    // 不会看到轮廓迟到。
    //
    // 传已解析的 GeoJSON 对象而不是 URL：GeoJsonDataSource.load 两者都收，
    // 传对象就不会再发一次请求，与几何索引共用 loadProvinceGeoJson 那一次下载。
    const chinaDataSource = globeReadySignal()
        .then(loadProvinceGeoJson)
        .then(geojson =>
            Cesium.GeoJsonDataSource.load(geojson, {
                fill: Cesium.Color.PALETURQUOISE.withAlpha(0) // 填充颜色（设为透明）
            })
        );

    chinaDataSource.then(dataSource => {
        setChinaBoundarySource(dataSource);
        dataSource.show = false;   // 默认隐藏，放大到国内范围后由 updateIntroVisibility 显示

        // 由于 Cesium 的 strokeWidth 在复杂边界上可能渲染不佳，
        // 为每个多边形单独绘制一条折线来精确控制边界样式
        const entities = dataSource.entities.values;
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            if (entity.polygon) {
                entity.polygon.outline = false;   // 边界已用独立折线绘制，禁用 polygon outline
                entity.polyline = {
                    positions: entity.polygon.hierarchy.getValue(Cesium.JulianDate.now()).positions,
                    width: 0.5,
                    material: Cesium.Color.WHITE
                };
            }
        }
        // 省份高亮：GeoJsonDataSource 会给 MultiPolygon 的每个子多边形单独建实体
        // （35 个省级 feature 实际生成 339 个实体），所以按 adcode 归组；
        // 同时把原始材质按实体记下来，取消选中时按引用还原。
        const provinceEntityMap = new Map();
        const provinceMaterialSnapshot = new Map();
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            const adcode = provinceAdcodeOfEntity(entity);
            if (!adcode) continue;
            if (!provinceEntityMap.has(adcode)) provinceEntityMap.set(adcode, []);
            provinceEntityMap.get(adcode).push(entity);
            provinceMaterialSnapshot.set(entity, {
                fill: entity.polygon ? entity.polygon.material : null,
                stroke: entity.polyline ? entity.polyline.material : null,
                width: entity.polyline ? entity.polyline.width : null
            });
        }
        setProvinceEntityIndex(provinceEntityMap, provinceMaterialSnapshot);
        viewer.dataSources.add(dataSource);
    }).catch(error => {
        console.error('加载中国轮廓数据失败:', error);
    });

    // 初始构建城市淡色填充（足迹数据加载完成后会重建）
    if (cityFillEnabled) buildCityFills();

    // ================= 恢复上次视图状态 =================
    // 刷新后保持上次的 2D/3D 模式（直接恢复，不做展开动画，避免 3D 闪一下）；
    // 带 ?view=tickets 进来时 startIn2D() 为 false，即保持 3D 并把票根页正常显示出来
    try {
        if (startIn2D() && !isAmapMode()) {
            // 恢复 2D 时只换页面显隐是不够的：Cesium 场景本身还停在 3D 球体上，
            // 之后点“3D 地球”时 morphTo3D 会因为“本来就在 3D”被 Cesium 跳过、不触发 morphComplete，
            // 表现就是瞬间切页、没有合并动画，还要等 2.3 秒兜底超时才收尾。
            // 所以这里用 0 秒 morph 把场景状态补齐（不播动画，用户看不到），
            // 起点用当前相机投影到平面，落点约等于整球视角下的中国，和手动切换 2D 的落点基本一致。
            try {
                viewer.resize();   // 此刻 #view-3d 仍可见，先保证宽高比有效（morph 内部要用画布宽高）
                if (viewer.scene.mode !== Cesium.SceneMode.SCENE2D) viewer.scene.morphTo2D(0);
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

    // ================= 对外只读接口（供「世界这本书」memory-shelf.js 使用） =================
    // 书架是独立脚本（static/js/memory-shelf.js），拿不到本文件的闭包变量，
    // 所以这里显式开一扇小门。三条约定：
    //   1) 全部写成取值函数，不导出快照 —— FOOTPRINTS / cityList 都是 let，
    //      刷新数据时会被整体重建，导出快照会立刻变成僵尸数据；
    //   2) 只导出书架真正需要的，不把内部状态整包抛出去；
    //   3) 这里不产生任何副作用 —— 删掉这段顶多让书架不显示，不影响地球页本身。
    window.FootprintMemoryData = {
        // 数据
        footprints: () => FOOTPRINTS,
        cityList: () => cityListSnapshot(),
        cityKeyOf: (fp) => cityKeyOf(fp),
        normalizeProvinceName: (value) => normalizeProvinceName(value),
        // 取图：画廊优先、主图兜底；拿到的是原图 URL，缩略要再过 cityCardImageUrl
        cityWallImages: (fp) => cityWallImages(fp),
        cityCardImageUrl: (url) => cityCardImageUrl(url),
        // 跨域图要进 canvas / WebGL 必须先转同源代理地址，否则画布被污染、贴图会失败
        canvasSafeImageUrl: (url) => canvasSafeImageUrl(url),
        // 覆盖层控制：书架全屏不透明，打开时要停掉地球渲染省 GPU
        setGlobeRenderLoop: (running) => setGlobeRenderLoop(running),
        setOverlayHidden: (el, hidden) => setOverlayHidden(el, hidden),
    };
