/**
 * 前台主逻辑 · 装配层。
 *
 * 具体功能已按领域拆到 modules/ 下，这个文件只做三件事：
 *   1) 建 Viewer 与全局配置（底图 provider、足迹数据、地形）；
 *   2) 按依赖顺序 setup / init 各模块 —— 先注入数据与元素，再绑定事件；
 *   3) 收尾：恢复上次视图、暴露 window.FootprintMemoryData 给书架脚本。
 *
 * 还没搬走的代码仍是一整片顶层语句（当年从 <script> 里抠出来的，
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
    restoreSavedViewMode,
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
    initCityFill,
    setCityFillVisible,
    isCityFillEnabled,
    setCityFillEnabled,
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
    setupBaseMap,
    initBaseMap,
    baseProviderMap,
    currentBase,
    hasTiandituKey,
    tiandituKey,
    switchBase,
    attachTileError
} from './modules/basemap.js';
import {
    FOOTPRINTS,
    loadFootprintsFromJson,
    applyFootprints,
    updateIntroStats,
    isFootprintDataReady,
    markFootprintDataReady
} from './modules/footprint-data.js';
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
    // ================= 自动旋转与画布光标 =================
    setupAutoRotate({
        viewer: () => viewer,
        reduceMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    });
    initAutoRotate();


    // 系统是否要求减弱动效：入场动画、2D 切换、卡片飞行等多处共用
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ================= 顶部导航与左侧标题卡 =================
    // 实现见 modules/navigation.js：标题卡/导航显隐、状态栏、底图菜单、Esc 逐级关闭。
    setupNavigation({
        viewer: () => viewer,
        reduceMotion: () => reduceMotion,
        applyScreenSpaceError,
        footprints: () => FOOTPRINTS,
        baseProviders: baseProviderMap,
        currentBaseKey: currentBase,
        statusText: () => document.getElementById('statusText'),
        statusRetry: () => document.getElementById('statusRetry'),
        hasTdtKey: hasTiandituKey
    });
    initNavigation();

    // ================= 底图 =================
    // 实现见 modules/basemap.js：天地图 provider、7 档底图切换、瓦片容错。
    setupBaseMap({
        viewer: () => viewer,
        cityFillOn: isCityFillEnabled
    });
    initBaseMap();

    // ================= 足迹标记与详情卡 =================
    // 实现见 modules/markers.js：标记构建、城市聚合、详情卡、悬停与标签避让。
    setupMarkers({
        footprints: () => FOOTPRINTS,
        viewer: () => viewer,
        baseProviders: baseProviderMap,
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
        baseProviders: baseProviderMap,
        currentBaseKey: currentBase,
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




    // ================= 天地图三维地形（可选开关，默认关闭） =================
    // 实现见 modules/tdt-terrain.js；专有地形格式，默认不启用，导航栏「三维地形」
    // 开启时先探测授权，成功才启用，失败自动回退平面。
    setTdtTerrainDeps({
        setTerrainNote,
        updateStatusText: refreshStatusText
    });
    initTdtTerrain(viewer, {
        hasTDTKey: hasTiandituKey(),
        tdtKey: tiandituKey(),
        enableDefault: !!(window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.enableTerrainDefault)
    });


    // ================= 初始视角与开场动画 =================
    // 实现见 modules/entrance.js：入场动画、已看过判断、减弱动效与 2D 恢复。
    setupEntrance({
        viewer: () => viewer,
        footprints: () => FOOTPRINTS,
        footprintsDataReady: isFootprintDataReady,
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
            if (currentBase()) {
                applyMarkerPositions(currentBase());
                refreshStatusText();
            }
            // 重建标记并按当前视角恢复城市/展开模式（整球视图默认城市聚合）
            buildMarkers();
            buildCityMarkers();
            rebuildMarkerModeFromCamera();
            if (isCityFillEnabled()) buildCityFills();   // 城市高亮开关开启时才随新数据重建
        }
        markFootprintDataReady();
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
    if (isCityFillEnabled()) buildCityFills();

    // 恢复上次的 2D/3D 视图（实现见 modules/view-mode.js）
    restoreSavedViewMode();

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
