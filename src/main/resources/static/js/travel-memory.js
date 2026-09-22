    // ================= 配置 =================
    // 天地图 Key：在 https://lbs.tianditu.gov.cn 注册后申请（浏览器端应用）
    // 不填则自动降级：只显示高德底图，无天地图影像/注记，也无三维地形
    // 天地图 Key 由后台“3D 地球”设置注入，不再硬编码
    const TDT_KEY = (window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.tiandituKey) || '';
    const hasTDTKey = TDT_KEY && TDT_KEY !== 'YOUR_TIANDITU_KEY';

    // 触屏设备判定：标记命中区尺寸与 3D 渲染倍率上限都要用
    // （手机/平板放宽可点区域，同时降低渲染倍率，保证拖动、捏合跟手）
    const COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

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

    // ================= 坐标转换（WGS84 <-> GCJ-02） =================
    // 高德瓦片基于 GCJ-02（火星坐标），天地图基于 CGCS2000（≈WGS84）。
    // 在 WGS84 地球上叠加高德瓦片时，标记必须转成 GCJ-02 才能对准地图内容。
    // 算法为公开的 eviltransform / coordtransform 同款；海外坐标不加密，原样返回。
    const GCJ_A = 6378245.0;
    const GCJ_EE = 0.00669342162296594323;

    function gcjOutOfChina(lng, lat) {
        return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
    }

    function gcjTransformLat(x, y) {
        let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
        return ret;
    }

    function gcjTransformLng(x, y) {
        let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
        return ret;
    }

    // WGS84 -> GCJ-02（高德底图下放置标记用）
    function wgs84ToGcj02(lng, lat) {
        if (gcjOutOfChina(lng, lat)) {
            return { lng, lat };
        }
        const dLat = gcjTransformLat(lng - 105.0, lat - 35.0);
        const dLng = gcjTransformLng(lng - 105.0, lat - 35.0);
        const radLat = (lat / 180.0) * Math.PI;
        let magic = Math.sin(radLat);
        magic = 1 - GCJ_EE * magic * magic;
        const sqrtMagic = Math.sqrt(magic);
        const mgLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
        const mgLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
        return { lng: lng + mgLng, lat: lat + mgLat };
    }

    // GCJ-02 -> WGS84（天地图底图下用；迭代逼近，误差亚米级）
    function gcj02ToWgs84(lng, lat) {
        if (gcjOutOfChina(lng, lat)) {
            return { lng, lat };
        }
        let lng2 = lng;
        let lat2 = lat;
        for (let i = 0; i < 3; i++) {
            const g = wgs84ToGcj02(lng2, lat2);
            lng2 = lng2 - (g.lng - lng);
            lat2 = lat2 - (g.lat - lat);
        }
        return { lng: lng2, lat: lat2 };
    }

    // ================= 高德底图（无需 Key） =================
    // 高德矢量路网图（含地名标注）
    const amapVec = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        maximumLevel: 18
    });

    // 高德卫星影像
    const amapImg = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        maximumLevel: 18
    });

    // 高德卫星影像上的中文标注（style=8，透明标注层，叠加在影像上）
    const amapImgLabel = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        maximumLevel: 18
    });

    // ================= 天地图用量统计 =================
    // 天地图按 Key 计额度（个人 Key 每天约一万次），这里只做"看得见"：
    // 把当天发出的瓦片数记在 localStorage，状态栏直接显示。
    // 注意：不要再在客户端做令牌桶限速/排队/透明瓦片兜底——那会让瓦片迟到或留空，
    // 转动地球时看起来就是"卡住"（观感远比省几额度重要）。要省量请走缓存方案。
    const TILE_USAGE_KEY = 'footprint-tile-usage';
    let tdtTilesSinceStatus = 0;

    function tdtCountTile() {
        // 攒够 25 张刷一次状态栏，别每来一张瓦片就重写一次 DOM
        tdtTilesSinceStatus += 1;
        if (tdtTilesSinceStatus >= 25) {
            tdtTilesSinceStatus = 0;
            try { updateStatusText(); } catch (e) { /* 初始化未完成时忽略 */ }
        }
        try {
            const today = new Date().toISOString().slice(0, 10);
            const raw = JSON.parse(localStorage.getItem(TILE_USAGE_KEY) || '{}');
            const count = raw.date === today ? (Number(raw.count) || 0) : 0;
            localStorage.setItem(TILE_USAGE_KEY, JSON.stringify({ date: today, count: count + 1 }));
        } catch (e) {
            // 隐私模式下 localStorage 可能不可用，忽略
        }
    }

    function tdtTodayUsage() {
        try {
            const today = new Date().toISOString().slice(0, 10);
            const raw = JSON.parse(localStorage.getItem(TILE_USAGE_KEY) || '{}');
            return raw.date === today ? (Number(raw.count) || 0) : 0;
        } catch (e) {
            return 0;
        }
    }

    // 给天地图的 provider 包一层：只计数，不改请求节奏
    function countTdtProvider(provider) {
        const original = provider.requestImage.bind(provider);
        provider.requestImage = function (x, y, level, request) {
            tdtCountTile();
            return original(x, y, level, request);
        };
        return provider;
    }

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

    // ================= 相机交互（鼠标滚轮缩放） =================
    // zoomFactor 在 Cesium 1.121 才作为公开属性暴露（更新日志 #12099），
    // 1.120 中设置 zoomFactor 不会生效（滚轮逻辑读取的是私有字段 _zoomFactor）。
    // 这里做特性检测：新版本用公开属性，1.120 用私有字段回退。
    const cameraController = viewer.scene.screenSpaceCameraController;
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
    viewer.scene.globe.tileLoadProgressEvent.addEventListener((pending) => {
        if (pending === 0) document.body.setAttribute('aria-busy', 'false');
    });
    setTimeout(() => document.body.setAttribute('aria-busy', 'false'), 20000);

    // 开启昼夜光照：按时钟时间计算太阳位置，夜半球变暗（2D 平面模式下不生效）
    viewer.scene.globe.enableLighting = true;
    // 让时间自动推进，明暗分界线随时间缓缓移动
    viewer.clock.shouldAnimate = true;

    // 3D 地球品牌文案：标题/描述使用“3D 地球”Tab 的独立配置（globeTitle/globeDesc），
    // 导航栏英文名保持默认 "Travel Memory"，不再从基本设置读取。
    const footprintCfg = window.FOOTPRINT_CONFIG || {};
    const navBrandZh = document.querySelector('.nav-brand-zh');
    const introTitleEl = document.querySelector('.intro-title');
    const introDescEl = document.querySelector('.intro-desc');
    if (navBrandZh && footprintCfg.globeTitle) navBrandZh.textContent = footprintCfg.globeTitle;
    if (introTitleEl && footprintCfg.globeTitle) introTitleEl.textContent = footprintCfg.globeTitle;
    if (introDescEl && footprintCfg.globeDesc) introDescEl.textContent = footprintCfg.globeDesc;

    // ================= 左侧标题卡（仅 3D，整球视图显示） =================
    const pageIntro = document.getElementById('pageIntro');
    const topNav = document.getElementById('topNav');   // 导航栏与标题卡同步显隐
    const navTools = document.getElementById('navTools');
    const navMoreBtn = document.getElementById('navMoreBtn');
    const navBackGlobeBtn = document.getElementById('navBackGlobeBtn');
    const backGlobeBtn = document.getElementById('backGlobeBtn');   // 放大后显示，一键回球
    const cityFillFloatBtn = document.getElementById('cityFillFloatBtn');   // 放大后显示，城市高亮开关
    // 相机高度（米）：高于 SHOW 时显示（能看到整个地球），低于 HIDE 时隐藏；
    // 两个值必须拉开一段（回滞区间），否则在阈值附近轻微缩放就会来回闪烁。
    const INTRO_SHOW_HEIGHT = 10500000;
    const INTRO_HIDE_HEIGHT = 9500000;
    let introVisible = false;
    let amapMode = false;   // 当前是否处于 2D 高德地图视图（切换按钮逻辑与导航栏显隐共用）
    let entranceActive = false;   // 开场动画进行中（暂缓标题卡显示）

    // 中国边界线：仅在放大到国内范围时显示，首屏整球视图保持干净。
    // 低于 SHOW 高度显示，高于 HIDE 高度隐藏；同样留出回滞区间防闪烁。
    const BOUNDARY_SHOW_HEIGHT = 9500000;
    const BOUNDARY_HIDE_HEIGHT = 11000000;
    let chinaBoundarySource = null;
    let boundaryVisible = false;
    let cityFillVisible = false;   // 城市淡色填充当前是否可见（与边界共用一套阈值状态）
    // 城市名的显示层级比中国轮廓更深一档：轮廓刚出现时（整球仍占大半屏）不铺名字，
    // 再放大到区域尺度才标注城市。想让它更早/更晚出现，改这两个常量即可。
    const CITY_LABEL_SHOW_HEIGHT = 4000000;
    const CITY_LABEL_HIDE_HEIGHT = 5000000;
    let cityLabelVisible = false;
    // 详情卡（足迹卡 / 城市聚合卡）：整球视图（标题卡出现）时自动收起；初始化完成前不触发
    let detailCardsReady = false;
    // 城市聚合状态（提前声明，updateIntroVisibility 会读取）
    let cityList = [];            // [{ city, indices: [足迹下标] }]，按数据顺序
    let cityMarkerEntities = [];  // 城市标记实体
    const CITY_EXPAND_HEIGHT = 1500000;    // 相机低于此高度时展开为单个足迹
    const CITY_COLLAPSE_HEIGHT = 1800000;  // 高于此高度时聚合为城市标记
    const CITY_VIEW_HEIGHT = 600000;       // 点击城市后的落地高度：低于展开阈值，落到城市尺度（足够近，同城足迹点也能拉开）
    let cityMode = true;
    // 程序化“飞往城市”的飞行状态：飞行期间抑制高度阈值自动切换，
    // 落地后再统一把聚合标记展开为该城市的足迹点，避免用户手动补一次缩放。
    let cityFlightActive = false;
    let cityFlightIndex = -1;
    let cityFlightTimer = null;
    let cityMoveEndHandler = null;
    let cityRevealRaf = null;
    // 城市淡色填充（提前声明，updateIntroVisibility 会控制显隐）
    let cityFillDataSources = [];
    let cityFillBuildId = 0;
    let cityOutlinePolylines = [];   // 城市轮廓描边折线（悬停聚焦时统一调透明度）
    let focusedMarker = null;        // 当前聚焦（悬停/键盘选中）的标记，null 表示无
    let markerOcclusionDirty = true; // 标记遮挡需要重算（相机或标记位置变化时置位）
    let markerLabelDirty = true;     // 地名标签需要重排（标记或标签显隐变化时置位）
    let pendingMarkerAudit = false;  // 需要在真实渲染结果上体检一次标记（展开/重建后）
    // 地名标签的布局状态（提前声明：buildMarkers / buildCityMarkers 会和标记一起重建）
    const labelLayoutState = new Map();       // ent -> { show, x, y }，避免重复写 Cesium 属性
    const slotBlockRects = [];                // 本帧已占用的矩形（标记 + 已放下的标签），逐帧清空复用
    const labelScreen = new Cesium.Cartesian2();
    const markerLift = new Map();             // 下标 -> 渲染抬高米数（自愈用，不影响数据坐标）
    const cityBoundaryCache = new Map();   // 城市边界数据缓存：同一会话内按 adcode 只请求一次
    // 城市填充主题：amber 琥珀橙 / gold 柔金 / mint 薄荷青 / ice 冰蓝
    const CITY_FILL_THEME = 'amber';
    const CITY_FILL_THEMES = {
        amber: { fill: 'rgba(255, 149, 66, 0.22)' },
        gold:  { fill: 'rgba(240, 198, 120, 0.25)' },
        mint:  { fill: 'rgba(88, 204, 180, 0.20)' },
        ice:   { fill: 'rgba(110, 160, 255, 0.18)' }
    };

    // ================= 省份城市卡片（点击省份 → 每个有足迹的城市各一张小卡片 + 抛物线） =================
    // 状态与常量提前声明：updateIntroVisibility() 在本文件中段就会直接调用一次，
    // 早于文末的「省份城市卡片」函数区，写在后面会踩到 TDZ。
    const PROVINCE_GEOJSON_URL = '/plugins/footprint/assets/static/data/china-full.json';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const PROVINCE_CARD_MIN_WIDTH = 821;        // 窄屏（<= 820px）不生效，与 CSS 断点一致
    const PROVINCE_CARD_WIDTH = 244;            // 横版卡片默认档（与 CSS .prop-city-card 宽度一致）
    const PROVINCE_CARD_HEIGHT = 96;
    // 超过这个数量只压缩「同侧间距」，卡片尺寸保持不变 ——
    // 同一个城市无论从省份进来还是从「全部城市」进来，都必须长得一模一样。
    const PROVINCE_CARD_DENSE_LIMIT = 6;
    const PROVINCE_CARD_GAP = 12;               // 同侧卡片最小间距（紧凑档减半）
    // 同一条边上卡片的阶梯缩进：四档循环，避免排成一条笔直的队列
    const PROVINCE_CARD_STAGGER = [0, 18, 36, 54];
    // 「全部城市」自动缩放的落点：轮廓可见（< 9500km）且仍是城市聚合态（> 1500km）
    const PROVINCE_ALL_FLY_HEIGHT = 8000000;
    const PROVINCE_ALL_FLY_DURATION = 1.6;
    const PROVINCE_ALL_FLY_LNG = 104.0;
    const PROVINCE_ALL_FLY_LAT = 34.5;
    const PROVINCE_SAFE_TOP = 88;               // 顶部导航 64 + 留白
    const PROVINCE_SAFE_BOTTOM = 96;            // 底部留白
    // 自动排版时离屏幕左右边缘的距离：不贴边，随视口宽度加大
    const PROVINCE_SIDE_INSET_MIN = 76;
    const PROVINCE_SIDE_INSET_RATIO = 0.07;
    // 与「城市高亮」同源的琥珀金：整套选中态只有一种颜色
    const PROVINCE_HL_FILL = 'rgba(255, 176, 103, 0.12)';
    const PROVINCE_HL_STROKE = '#FFB067';
    const PROVINCE_HL_STROKE_WIDTH = 1.4;
    // 悬停卡片时，对应城市的「城市高亮」填充加亮一档（比默认的 rgba(255,149,66,.22) 更实）
    const PROVINCE_CITY_HL_FILL = 'rgba(255, 196, 120, 0.42)';
    // 连线走「地图标注引线」那套材质：细线 + 底下压一层很淡的深色描边（浅色底图上保底）。
    // 颜色取象牙白：中性暖白，和卡片文字同族、最不抢戏。
    // 注意这一版和最早那版"暖米白"的区别：那时深色描边是 3px/0.6，在卫星影像上会拖出一圈暗边；
    // 现在描边已压到 2.8px/0.42，观感会干净得多。
    const PROVINCE_LINE_FROM = '#FFF3E0';
    const PROVINCE_LINE_TO = 'rgba(255, 243, 224, 0.86)';
    const PROVINCE_LINE_FAN = [0.10, 0.18];     // 弧度收敛：更像标注引线，不再像数据流
    const PROVINCE_LINE_DOT_R = 3.6;            // 起点圆点：暖白实心 + 深色描边
    const PROVINCE_LINE_DOT_R_ACTIVE = 5;
    const PROVINCE_MARKER_DIM_ALPHA = 0.35;     // 非选中省份的标记压暗到这一档
    // ---- 展开动画：线到、卡到 ----
    const PROVINCE_LINE_GROW_MS = 500;    // 线从标记铺到卡片的时长
    const PROVINCE_CARD_FLY_MS = 500;     // 卡片从标记飞到落点的时长
    const PROVINCE_CARD_LEAD_MS = 120;    // 卡片比线晚出发一点：线先探出去，卡片再沿线滑出
    const PROVINCE_STAGGER_STEP_MS = 40;  // 相邻两张的错峰步长
    const PROVINCE_STAGGER_MAX_MS = 600;  // 错峰总时长上限（卡片多时自动压缩步长）
    const PROVINCE_PULSE_MS = 320;        // 起点"引爆"脉冲时长（仅「全部城市」）
    let provinceEls = null;             // { svg, label, layer }，惰性取值避免 TDZ
    let provinceCardsActive = false;    // 卡片组是否打开
    let provinceCardsMode = 'province'; // 'province' 单省展开 / 'all' 全部城市展开
    let provinceCardsAdcode = '';       // 当前省份 adcode
    let provinceCardsItems = [];        // [{ ci, el, group, path, dot, grad, ... }]
    let provinceLabelText = '';         // 省名标注文本
    let provinceLabelWorld = null;      // 省名标注的世界坐标
    let provinceCitiesSet = new Set();  // 当前省份的城市下标（标记明暗判定用）
    let provinceBrightEntities = new Set();   // 选中省份要保亮的标记实体
    let provinceHighlightAdcode = '';   // 当前高亮的省份（材质改写）
    let provinceEntityMap = null;       // Map<adcode, Entity[]>，中国轮廓加载完成后建立
    let provinceMaterialSnapshot = null;// Map<Entity, { fill, stroke, width }>，用于还原
    let provinceIndex = null;           // Map<adcode, { name, center, bbox, polygons }>
    let provinceIndexPromise = null;
    let provinceLayoutDirty = true;
    let provinceRestorePending = null;  // 从城市相册返回后要恢复的省份
    let provinceDragState = null;
    let provinceFocusItem = null;       // 当前被悬停/聚焦的卡片（对应连线整条拉满）
    let provinceEntranceUntil = 0;      // 入场动画结束时间戳：期间锁住重排（transform 与 dash 都怕被改写）
    let provincePulseRaf = null;        // 起点脉冲的 rAF 句柄
    let provinceCardsToken = 0;         // 打开 / 关闭的世代号：退场动画的收尾不能被新的一组误清
    let provinceHintShown = false;      // 本次会话是否已经提示过"省份可以点"
    let provinceHintTimer = null;
    let provinceCardClickTimer = null;  // 区分单击（进相册）与双击（打开单城市卡）

    // ================= 照片环（点足迹标记后围绕标记铺开的多图预览） =================
    const PHOTO_RING_COUNT = 5;            // 环上固定展示张数（第 6 个角度位放「全部 ›」）
    // 缩略图不写死宽高：按每张图片的实际宽高比等比缩放，约束在这个盒子里。
    // 上限大约是初版 76×54 的两倍；下限兜住极端竖图（细长条）与全景图（扁长条）。
    const PHOTO_RING_MAX_W = 260;
    const PHOTO_RING_MAX_H = 120;
    const PHOTO_RING_MIN_W = 72;
    const PHOTO_RING_MIN_H = 72;
    const PHOTO_RING_PLACEHOLDER_W = 160;  // 图片还没加载完时的占位尺寸（4:3 的典型值）
    const PHOTO_RING_PLACEHOLDER_H = 120;
    const PHOTO_RING_COMPACT_SCALE = 0.82; // 空间不足时的降级：整体等比缩小
    const PHOTO_RING_RADIUS = 78;          // 环形半径的下限（实际按位置数自适应撑开）
    const PHOTO_RING_COMPACT_RADIUS = 66;
    // 半环朝向的扫描步长：弧线不写死成"上半圆/左半圆"，沿整圈按这个步长找空位。
    // 5° 是"看不出台阶"与"每帧评估量"的折中（72 个朝向 × 档位 ≈ 300 次评估，单次只算几个矩形）。
    const PHOTO_RING_ARC_STEP_DEG = 5;
    // 为了塞进视口而做的整体平移也要计价，屏幕边缘因此和卡片一样是"真的障碍物"：
    // 否则贴边时布局会免费把整圈平移两百多像素 —— 平移量超过半径后，标记就跑到照片圈外面去了
    // （用户看到的"挂在屏幕边上的一圈"）。平移量按 PHOTO_RING_EDGE_SHIFT_LIMIT **封顶**计价：
    // 超过这个量之后不再"越推越贵"，否则布局会为了省推距去选更小的降级档（照片无故缩小）。
    const PHOTO_RING_EDGE_PUSH_COST = 0.04;
    const PHOTO_RING_EDGE_SHIFT_LIMIT = 150;
    // 锚点滑出视口后，照片环跟着淡出的深度：出屏这么多像素就完全看不见了
    const PHOTO_RING_EDGE_FADE_PX = 70;
    const PHOTO_RING_VIEW_MAX_W = 480;     // 查看模式大图：同样按实际宽高比装进这个盒子
    const PHOTO_RING_VIEW_MAX_H = 340;
    const PHOTO_RING_VIEW_RADIUS = 130;    // 查看模式：从标记外移到这个半径
    const PHOTO_RING_DOT_LIMIT = 40;       // 位置指示点最多铺这么多（超大相册只留计数）
    const PHOTO_RING_CLOSE_SIZE = 28;      // 查看模式关闭按钮的尺寸（与 CSS .photo-ring-close 一致）
    const PHOTO_RING_CLOSE_OFFSET = 18;    // 关闭按钮沿图片右上角对角线外移的距离
    // 被足迹卡压住时，沿最小位移轴把整圈推开；上限放宽到 400px ——
    // 卡片宽度约 410px，标记贴着卡片时只有推开才能让照片不被压在卡片后面
    // （宁可环稍微偏离标记，也不能让照片看不见）。实际位置仍会被视口钳制。
    const PHOTO_RING_MAX_PUSH = 400;
    const PHOTO_RING_FLY_MS = 240;         // 出现动画时长
    const PHOTO_RING_STAGGER_MS = 40;      // 逐张错峰
    let photoRingActive = false;
    let photoRingViewing = false;
    let photoRingFp = null;
    let photoRingIndex = -1;               // 足迹下标（用来跟随标记）
    let photoRingViewIndex = 0;            // 查看模式：当前看的是该足迹第几张
    let photoRingViewerEl = null;          // 查看模式下承载大图的元素（环里独立的那个，不复用缩略图）
    let photoRingViewerAngle = 0;          // 查看模式大图所在的角度（与后续布局解耦）
    let photoRingViewerSize = null;        // 查看模式大图的尺寸（按图片实际宽高比）
    let photoRingGuideEl = null;           // 当前悬停/聚焦的缩略图（用于画引导线）
    let photoRingLayoutDirty = false;      // 有图片刚加载完、尺寸变了 → 需要重排
    let photoRingSlots = [];               // 环上各张在"全部图片"里的下标
    let photoRingEls = null;               // { root, items[], all, prev, next, counter, close }
    let photoRingToken = 0;                // 世代号：异步回调/动画的作废判定
    let photoRingEntranceUntil = 0;
    let photoRingLayout = null;            // { w, h, compact, entries: [{ angle, x, y }] }
    let photoRingArcAngle = null;          // 上一次布局选中的弧线朝向（用于连续性偏好，避免环突然翻边）
    let photoRingTriggerBtn = null;        // 键盘打开时，关闭后把焦点还给它
    let cityFillIndex = new Map();      // 城市高亮图层：adcode -> { entities }（悬停卡片时换色用）
    let cityFillHighlightAdcode = '';   // 当前被换成青蓝的城市高亮
    let provinceAllFlight = false;      // 「全部城市」正在自动缩放到能看见中国轮廓
    let provinceAllFlightHandler = null;
    let provinceAllFlightTimer = null;
    let hoveredProvince = false;        // 光标是否停在可点击的省份上
    let provinceAllBtnCache = null;     // 「全部城市」导航按钮
    let provinceAllAvailable = null;    // 按钮可用态缓存（只在变化时写 DOM）

    // 逐帧要读的三个浮层元素：第一次取到后缓存，省掉每帧三次 getElementById。
    // 这里用惰性取值而不是直接引用变量 —— 这几个元素是在本函数之后才声明的（避免 TDZ）。
    let introOverlayEls = null;
    function introOverlayElements() {
        if (!introOverlayEls) {
            introOverlayEls = [
                document.getElementById('cityView'),
                document.getElementById('cityWall'),
                document.getElementById('ticketGallery')
            ];
        }
        return introOverlayEls;
    }

    function updateIntroVisibility() {
        // 开场动画期间：标题卡暂缓显示，动画结束后由下一帧的相机高度逻辑自动显示
        if (entranceActive) {
            if (introVisible) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            topNav.classList.add('visible');
            document.body.classList.remove('nav-zoom');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
            return;
        }
        // 全屏覆盖层（城市卡片墙 / 城市足迹 / 票根）打开时隐藏顶部导航栏与标题卡，避免遮挡；
        // 这里用 getElementById 动态判断，避免引用后置声明的变量（TDZ）。
        const [cityViewEl, cityWallEl, ticketGalleryEl] = introOverlayElements();
        const overlayOpen = !!(cityViewEl && cityViewEl.classList.contains('show')) ||
            !!(cityWallEl && cityWallEl.classList.contains('show')) ||
            !!(ticketGalleryEl && ticketGalleryEl.classList.contains('show'));
        if (overlayOpen) {
            if (introVisible) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            topNav.classList.remove('visible');
            document.body.classList.remove('nav-zoom');
            navTools.classList.remove('open');
            topNav.classList.remove('tools-open');
            navMoreBtn.setAttribute('aria-expanded', 'false');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
            return;
        }
        // 2D 高德视图：导航栏常驻（保证 2D/3D 切换按钮可用），地球标题卡/浮动按钮隐藏
        if (amapMode) {
            pageIntro.classList.remove('visible');
            topNav.classList.add('visible');
            document.body.classList.remove('nav-zoom');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
            return;
        }
        // 相机高度每帧只取一次：positionCartographic 每次调用都会新建 Cartographic 并做坐标换算，
        // 而下面三处判断（标题卡分层、边界与城市名分层、聚合切换）用的是同一个值。
        const cameraHeight = viewer.camera.positionCartographic.height;
        // 2D / Columbus / 变形过程中标题一律隐藏；导航栏保留（否则 2D 下无法切回 3D）
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
            if (introVisible) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            topNav.classList.add('visible');
            document.body.classList.remove('nav-zoom');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
        } else {
            const h = cameraHeight;
            if (!introVisible && h > INTRO_SHOW_HEIGHT) {
                introVisible = true;
                pageIntro.classList.add('visible');
                // 回到整球视图时复位“工具”溢出菜单，避免残留展开态
                navTools.classList.remove('open');
                topNav.classList.remove('tools-open');
                navMoreBtn.setAttribute('aria-expanded', 'false');
                if (detailCardsReady) {
                    // 回到整球视图时自动关闭详情卡：标题卡就在左下角，卡片不收会和它叠在一起；
                    // 城市聚合卡同样会挡住标题卡，所以不能只收足迹卡。
                    if (markerCard.classList.contains('visible')) hideMarkerCard();
                    if (cityCard.classList.contains('visible')) hideCityCard(false);
                    // 省份城市卡片组同理：整球视图下省份已经不可点，留着只会挡标题卡
                    if (provinceCardsActive) closeProvinceCards();
                }
            } else if (introVisible && h < INTRO_HIDE_HEIGHT) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            // 导航常驻：整球视图显示全部工具；放大后保留 2D/票根/回到整球等入口。
            // 每次渲染都按当前相机高度校正状态，覆盖层关闭后也能自动恢复。
            topNav.classList.add('visible');
            document.body.classList.toggle('nav-zoom', !introVisible);
            // 浮动快捷按钮只作为非导航场景的补充；nav-zoom 时由 CSS 隐藏
            backGlobeBtn.classList.toggle('show', !introVisible);
            cityFillFloatBtn.classList.toggle('show', !introVisible);
        }

        // 中国边界：放大到国内范围才显示，拉远/整球视图隐藏；带 SHOW/HIDE 回滞区间
        const boundaryH = cameraHeight;
        if (!boundaryVisible && boundaryH < BOUNDARY_SHOW_HEIGHT) {
            boundaryVisible = true;
            // 第一次放大到国内范围：一次性告诉用户"省份可以点"
            maybeShowProvinceHint();
        } else if (boundaryVisible && boundaryH > BOUNDARY_HIDE_HEIGHT) {
            boundaryVisible = false;
        }
        if (chinaBoundarySource) chinaBoundarySource.show = boundaryVisible;

        // 城市名层级：与轮廓共用同一份高度读数，再深一档才出现（带回滞防闪）
        if (!cityLabelVisible && boundaryH < CITY_LABEL_SHOW_HEIGHT) {
            cityLabelVisible = true;
        } else if (cityLabelVisible && boundaryH > CITY_LABEL_HIDE_HEIGHT) {
            cityLabelVisible = false;
        }

        // 城市淡色填充：与边界共用同一份可见状态（边界数据加载失败时也照常工作），
        // 并且只在状态真正翻转时才写 DataSource.show —— 逐帧赋值会反复触发
        // Cesium 的属性变更，白白消耗在每帧的渲染回调里。
        if (cityFillVisible !== boundaryVisible) {
            cityFillVisible = boundaryVisible;
            cityFillDataSources.forEach(ds => { ds.show = cityFillVisible; });
        }

        // 城市聚合切换：放大到城市范围展开为单个足迹，拉远聚合回城市标记。
        // 程序化“飞往城市”期间先不按高度切换，落地瞬间由 finishCityFlight 统一展开。
        if (!cityFlightActive) {
            const modeH = cameraHeight;
            // LOD 容差也跟着高度走（moveEnd 之外再兜一层：瞬时 setView 不会触发 moveEnd）
            applyScreenSpaceError();
            if (cityMode && modeH < CITY_EXPAND_HEIGHT) {
                applyMarkerMode(false);
            } else if (!cityMode && modeH > CITY_COLLAPSE_HEIGHT) {
                applyMarkerMode(true);
            }
        }
        // 导航栏「全部城市」的可用态跟着层级走（只在翻转时写 DOM）
        syncProvinceAllAvailability();
    }
    viewer.scene.postRender.addEventListener(updateIntroVisibility);
    updateIntroVisibility();

    // 回到整球视图：飞回初始中国朝向的整球视角
    function flyBackToGlobe() {
        // 卡片组开着时先收（会播 0.28s 退场动画），再起飞 —— 否则卡片是"瞬间消失 + 地球飞走"
        if (provinceCardsActive) closeProvinceCards();
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
            duration: 1.8
        });
    }
    backGlobeBtn.addEventListener('click', flyBackToGlobe);
    if (navBackGlobeBtn) navBackGlobeBtn.addEventListener('click', flyBackToGlobe);

    // 票根页（重走放映）会把镜头停在某个城市附近，
    // 这个高度下自动旋转看起来像原地打转；返回地球/回到票夹时若自动旋转开着，
    // 就把视角收回整个地球。只在确实被拉近（低于整球高度）时触发，避免多余飞行。
    function restoreGlobeViewForAutoRotate() {
        if (!autoRotate) return;
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return;
        if (viewer.camera.positionCartographic.height >= INTRO_SHOW_HEIGHT) return;
        viewer.camera.cancelFlight();
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
            duration: reduceMotion ? 0 : 1.8
        });
    }

    // ================= 2D/3D 自定义切换按钮 =================
    // 3D：Cesium 地球（默认首页）；2D：切换为项目原有高德地图（懒加载，见 footprint.js 的 window.Footprint2D）。
    // 切换过程使用 Cesium 原生 morph 动画：3D→2D 先让地球“展开”成平面，动画结束再显示高德页面；
    // 2D→3D 先显示仍处于平面状态的地球，再“合并”回球体。
    const sceneModeBtn = document.getElementById('sceneModeBtn');
    const view3d = document.getElementById('view-3d');
    const view2d = document.getElementById('view-2d');
    const MORPH_DURATION = 1.5;   // 展开/合并动画时长（秒）
    let morphing = false;         // morph 动画进行中，防止重复点击
    let pendingMode = null;       // 动画结束后的目标模式：'2d' | '3d'
    let morphTimeoutId = null;    // 兜底：morph 事件异常未触发时强制完成切换

    // 视图模式记忆：刷新后保持上次的 2D/3D 状态
    const VIEW_MODE_STORAGE_KEY = 'travelMemoryViewMode';
    function getSavedViewMode() {
        try { return localStorage.getItem(VIEW_MODE_STORAGE_KEY) || '3d'; } catch (e) { return '3d'; }
    }
    function saveViewMode(mode) {
        try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode); } catch (e) { /* 忽略 */ }
    }
    // 是否以 2D 视图启动。票根页只属于 3D 地球：带 ?view=tickets 直接进来时固定走 3D，
    // 否则票根页会被一起隐藏的 #view-3d 吞掉（详细原因见 forceGlobeForTickets）。
    // 这里只影响本次打开，用户记住的 2D 偏好仍然保留，下次普通访问照旧回到 2D。
    function startIn2D() {
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
        const startPos = viewer.camera.getRectangleCameraCoordinates(WORLD_VIEW);
        const start = viewer.scene.mapProjection.unproject(startPos);
        const endPos = viewer.camera.getRectangleCameraCoordinates(targetRect);
        const end = viewer.scene.mapProjection.unproject(endPos);

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
            viewer.camera.setView({
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
        const to2D = viewer.scene.mode !== Cesium.SceneMode.SCENE2D;
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
        if (provinceCardsActive) closeProvinceCards();
        else cancelAllCityFlight();
    }

    function finishSwitchTo2D() {
        clearTimeout(morphTimeoutId);
        amapMode = true;
        if (view3d) view3d.hidden = true;
        if (view2d) view2d.hidden = false;
        document.body.classList.remove('mode-3d');
        document.body.classList.add('mode-2d');
        sceneModeBtn.textContent = '3D 地球';
        sceneModeBtn.title = '切换到 3D 地球';
        pauseAutoRotate('2d');             // 进入 2D 后暂停地球自转（退出 2D 会自动恢复）
        viewer.clock.shouldAnimate = false;   // 地球隐藏时冻结昼夜光照，降低开销
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
        viewer.clock.shouldAnimate = true;
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
        if (reduceMotion) {   // 无障碍：关闭动画，直接切换
            finishSwitchTo2D();
            return;
        }
        morphing = true;
        pendingMode = '2d';
        armMorphTimeout();
        viewer.scene.morphTo2D(MORPH_DURATION);
    }

    // 切 3D：先显示仍处于平面状态的地球，再“合并”回球体
    function switchTo3D() {
        if (!amapMode || morphing) return;
        if (window.Footprint2D && typeof window.Footprint2D.hide === 'function') {
            window.Footprint2D.hide();
        }
        if (reduceMotion) {   // 无障碍：关闭动画，直接切换
            finishSwitchTo3D();
            return;
        }
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE2D) {
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
        viewer.resize();   // 容器刚从隐藏恢复，先校正画布尺寸，避免 morph 过程变形
        morphing = true;
        pendingMode = '3d';
        armMorphTimeout();
        viewer.scene.morphTo3D(MORPH_DURATION);
    }

    // 票根页只属于 3D 地球（挂载在 #view-3d 里，2D 下整个容器是隐藏的），
    // 所以当前在 2D 时打开票根页要先切回 3D：不播合并动画，也不写 localStorage，
    // 免得用户只是点开一次票根链接，记住的 2D 偏好就被改掉了。
    function forceGlobeForTickets() {
        if (!amapMode && !morphing && viewer.scene.mode === Cesium.SceneMode.SCENE3D) return;
        clearTimeout(morphTimeoutId);
        morphing = false;
        pendingMode = null;
        try {
            // 展开动画途中就切票根页的话，先让它立即落地；否则动画结束时仍会按 pendingMode 切去 2D
            viewer.scene.completeMorph();
            if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) viewer.scene.morphTo3D(0);
        } catch (e) {
            console.warn('票根页切回 3D 失败：', e);
        }
        finishSwitchTo3D(false);
        viewer.resize();   // 容器刚从隐藏恢复，先校正画布尺寸
        viewer.camera.cancelFlight();
        // 平面合并回球体后相机常贴近地表（地球看着是“扁”的），直接归位到整球视角
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000)
        });
    }

    // morph 动画结束：按目标模式完成视图交换
    viewer.scene.morphComplete.addEventListener(() => {
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
                viewer.camera.cancelFlight();   // 兜底：清理可能残留的飞行状态
                viewer.camera.setView({
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

    function refreshAutoRotate() {
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
    function pauseAutoRotate(reason) {
        if (autoRotatePauses.has(reason)) return;
        autoRotatePauses.add(reason);
        refreshAutoRotate();
    }
    function resumeAutoRotate(reason) {
        if (!autoRotatePauses.delete(reason)) return;
        refreshAutoRotate();
    }

    // 拖动地球（位移超过 5px）后自动取消自动旋转；单纯点击不取消
    const cesiumCanvas = viewer.scene.canvas;
    let dragActive = false;
    let dragStartX = 0;
    let dragStartY = 0;

    // 光标反馈：画布默认是「抓手」（可拖着转，见 CSS），按下变「抓取中」，
    // 悬停到标记上变手型 —— 明确告诉用户这里能拖、那里能点。
    let hoveredMarker = false;
    let canvasHeld = false;
    function applyCanvasCursor() {
        // 可点目标有两类：标记（足迹/城市）与可点击的省份轮廓，两者都给手型
        const next = canvasHeld ? 'grabbing' : ((hoveredMarker || hoveredProvince) ? 'pointer' : '');
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
        if (!autoRotate || viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
            hoverPaused = false;
            return;
        }
        const now = performance.now();
        if (now - lastHoverCheck < hoverCheckInterval) return;
        lastHoverCheck = now;
        const rect = cesiumCanvas.getBoundingClientRect();
        const pos = new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top);
        const ray = viewer.camera.getPickRay(pos);
        // 与地球椭球求交：有交点 = 光标在地球圆盘内（IntersectionTests.rayEllipsoid）
        const interval = ray
            ? Cesium.IntersectionTests.rayEllipsoid(ray, viewer.scene.globe.ellipsoid)
            : undefined;
        hoverPaused = interval !== undefined;
    });
    cesiumCanvas.addEventListener('mouseleave', () => {
        hoverPaused = false;
        hoveredMarker = false;
        hoveredProvince = false;
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
        if (reduceMotion) return;            // 系统减弱动效时不启用
        setAutoRotate(!autoRotatePref);
    });

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

    viewer.clock.onTick.addEventListener(() => {
        if (!autoRotate) return;
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return;  // 只在 3D 旋转
        if (hoverPaused) return;   // 鼠标悬停时暂停
        const now = performance.now();
        const dt = lastRotateTime === null ? 0 : Math.min((now - lastRotateTime) / 1000, 0.2);
        lastRotateTime = now;
        if (dt <= 0) return;
        try {
            viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -Cesium.Math.toRadians(2) * dt); // 2 度/秒
        } catch (e) {
            console.error('自动旋转出错：', e);
        }
    });

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

    let markerEntities = [];
    let currentPositions = [];

    // 标记悬停气泡与键盘焦点层（提前声明：applyMarkerMode 初始化时就会用到）
    const markerTip = document.getElementById('markerTip');
    const markerTipName = document.getElementById('markerTipName');
    const markerFocusLayer = document.getElementById('markerFocusLayer');
    let markerTipEntity = null;
    let lastKeyboardMarkerBtn = null;
    let hoveredMarkerKey = '';   // 当前气泡对应的标记（类型:下标），用于跳过同一标记上的重复设置

    // ================= 城市聚合（整球显示城市标记，放大后展开为单个足迹） =================
    // 城市标记图标：白色圆环 + 中心数量
    function cityMarkerUrl(count) {
        // 绘制统一走 markerIconUrl（与足迹标记共用同一套命中层，见文件下方标记点一节）
        return markerIconUrl('city', CITY_MARKER_REF_SIZE / CITY_MARKER_SIZE, count);
    }

    // 城市中心 = 该城市所有足迹在“当前底图坐标系”下的平均位置
    function cityCenter(city) {
        let lng = 0, lat = 0, n = 0;
        city.indices.forEach(i => {
            const p = currentPositions[i];
            if (p) { lng += p.lng; lat += p.lat; n++; }
        });
        return n ? { lng: lng / n, lat: lat / n } : null;
    }

    let terrainNote = hasTDTKey ? '，未启用三维地形' : '，未配置天地图 Key（无地形）';

    // 状态栏文案：当前底图 + 坐标系 + 地形状态 + 足迹数 + 数据来源。
    // 天地图每日额度属于运维数据，只在调试模式下显示（地址栏加 ?debug，
    // 或 localStorage.footprintDebug = '1'），不把后台指标丢给读者看。
    const DEBUG_STATUS = (() => {
        try {
            return new URLSearchParams(window.location.search).has('debug') ||
                localStorage.getItem('footprintDebug') === '1';
        } catch (e) { return false; }
    })();

    function updateStatusText() {
        const item = currentBaseKey ? baseProviders[currentBaseKey] : null;
        const coordName = item && item.gcj ? 'GCJ-02' : 'CGCS2000/WGS84';
        const usage = DEBUG_STATUS && item && item.needKey
            ? ` · 今日天地图瓦片 ${tdtTodayUsage()} 张 / 额度约 1 万`
            : '';
        statusText.textContent =
            (item ? item.label + '底图' : '底图') + `（${coordName}）${terrainNote}` +
            ` · ${FOOTPRINTS.length} 个足迹标记` + usage + ' · 地图数据 © 高德 / 天地图 · 渲染 CesiumJS';
    }

    // 把一条足迹从它自己的坐标系转换到当前底图坐标系：
    // 高德底图基于 GCJ-02，天地图底图基于 CGCS2000（≈WGS84）。
    function footprintToBasemap(fp, basemapIsGcj) {
        if (fp.coordType === 'gcj02') {
            // 高德来源：高德底图直接用原坐标，天地图底图转成 WGS84
            return basemapIsGcj
                ? { lng: fp.lng, lat: fp.lat }
                : gcj02ToWgs84(fp.lng, fp.lat);
        }
        // WGS84 来源：天地图底图直接用，高德底图转成 GCJ-02
        return basemapIsGcj
            ? wgs84ToGcj02(fp.lng, fp.lat)
            : { lng: fp.lng, lat: fp.lat };
    }

    // 按当前底图坐标系刷新所有标记
    function applyMarkerPositions(key) {
        const item = baseProviders[key];
        const basemapIsGcj = !!(item && item.gcj);
        currentPositions = FOOTPRINTS.map(fp => footprintToBasemap(fp, basemapIsGcj));
        markerEntities.forEach((ent, i) => {
            const pos = currentPositions[i];
            if (ent && pos) {
                // 带上自愈抬高量：换底图不该把已经抬起来的点又按回椭球面
                ent.position = Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, markerLift.get(i) || 0);
            }
        });
        // 城市标记同步到新的平均位置
        cityMarkerEntities.forEach((ent, i) => {
            const center = cityList[i] && cityCenter(cityList[i]);
            if (ent && center) {
                ent.position = Cesium.Cartesian3.fromDegrees(center.lng, center.lat);
            }
        });
        markerOcclusionDirty = true;   // 标记位置变了，遮挡关系要跟着重算
        pendingMarkerAudit = true;     // 位置变了，渲染结果也复检一次
        return currentPositions;
    }

    // 底图选择持久化：localStorage 保存，刷新后继续使用上次选择的底图
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
        updateStatusText();
    }

    document.querySelectorAll('#layerButtons button').forEach(btn => {
        btn.addEventListener('click', () => switchBase(btn.dataset.key));
    });

    // 底图下拉菜单：点击开关、选择后收起、点击外部或按 Esc 关闭
    const layerMenu = document.getElementById('layerMenu');
    const layerMenuBtn = document.getElementById('layerMenuBtn');
    const layerPanel = document.getElementById('layerButtons');

    layerMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = layerPanel.hidden;
        layerPanel.hidden = !open;
        layerMenuBtn.setAttribute('aria-expanded', String(!open));
        layerMenu.classList.toggle('open', !open);
    });

    layerPanel.addEventListener('click', () => {
        layerPanel.hidden = true;
        layerMenuBtn.setAttribute('aria-expanded', 'false');
        layerMenu.classList.remove('open');
    });

    document.addEventListener('click', (e) => {
        if (!layerPanel.hidden && !layerMenu.contains(e.target)) {
            layerPanel.hidden = true;
            layerMenuBtn.setAttribute('aria-expanded', 'false');
            layerMenu.classList.remove('open');
        }
    });

    // “工具”溢出菜单（紧凑模式/窄屏）：主入口常驻，探索类工具收进菜单
    function setNavToolsOpen(open) {
        navTools.classList.toggle('open', open);
        topNav.classList.toggle('tools-open', open);
        navMoreBtn.setAttribute('aria-expanded', String(open));
        if (!open && !layerPanel.hidden) {
            layerPanel.hidden = true;
            layerMenuBtn.setAttribute('aria-expanded', 'false');
            layerMenu.classList.remove('open');
        }
    }
    navMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setNavToolsOpen(!navTools.classList.contains('open'));
    });
    document.addEventListener('click', (e) => {
        if (navTools.classList.contains('open') && !navTools.contains(e.target) && !navMoreBtn.contains(e.target)) {
            setNavToolsOpen(false);
        }
    });
    // 从窄屏切回桌面时复位“工具”弹出态，避免残留的下拉样式
    const navMobileMql = window.matchMedia('(max-width: 820px)');
    function syncNavToolsState() {
        if (!navMobileMql.matches) {
            navTools.classList.remove('open');
            topNav.classList.remove('tools-open');
            navMoreBtn.setAttribute('aria-expanded', 'false');
        }
    }
    if (navMobileMql.addEventListener) {
        navMobileMql.addEventListener('change', syncNavToolsState);
    } else {
        navMobileMql.addListener(syncNavToolsState);
    }

    document.addEventListener('keydown', (e) => {
        // 灯箱打开时：← / → 切换图片
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && lightbox.classList.contains('show')) {
            switchLightbox(e.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        // 照片环的查看模式：← / → 只在查看模式里翻图（不抢地球的键盘操作）
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && photoRingViewing) {
            switchPhotoRingView(e.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        if (e.key !== 'Escape') return;
        if (!layerPanel.hidden) {
            layerPanel.hidden = true;
            layerMenuBtn.setAttribute('aria-expanded', 'false');
            layerMenu.classList.remove('open');
            return;
        }
        if (navTools.classList.contains('open')) {
            setNavToolsOpen(false);
            return;
        }
        if (lightbox.classList.contains('show')) {
            closeLightbox();
            return;
        }
        if (postcardPreview.classList.contains('show')) {
            closePostcard();
            return;
        }
        if (timeCapsule.classList.contains('show')) {
            closeTimeCapsule();
            return;
        }
        if (insightView.classList.contains('show')) {
            closeInsight();
            return;
        }
        if (cityView.classList.contains('show')) {
            closeCityView();
            return;
        }
        if (cityWall.classList.contains('show')) {
            closeCityWall();
            return;
        }
        if (markerCard.classList.contains('visible')) {
            hideMarkerCard();
            return;
        }
        if (cityCard && cityCard.classList.contains('visible')) {
            hideCityCard();
            return;
        }
        if (provinceAllFlight) {
            cancelAllCityFlight();   // 「全部城市」还在飞：Esc 先取消这次自动缩放
            return;
        }
        // 照片环逐级退：先退出查看模式，再关环，最后才轮到卡片
        if (photoRingViewing) {
            exitPhotoRingView();
            return;
        }
        if (photoRingActive) {
            hidePhotoRing(true);   // 键盘关闭时把焦点还给触发它的标记按钮
            return;
        }
        if (provinceCardsActive) {
            closeProvinceCards();
        }
    });

    // 默认底图：优先恢复上次保存的选择，否则用天地图影像（无标注）/ 高德卫星
    switchBase(resolveInitialBase());

    // ================= 天地图三维地形（可选开关，默认关闭） =================
    // 注意：这是专有地形格式，Cesium.sampleTerrain 对它不适用；主要覆盖国内范围（级别 5-12 左右）。
    // 天地图 Key 绑定域名白名单（未授权返回 403），且地形与影像/矢量共用每日配额（429）。
    // 因此默认不启用地形；导航栏「三维地形」开启时先探测授权，成功才启用，失败自动回退平面。
    const terrainBtn = document.getElementById('terrainBtn');
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

    function setTdtTerrain(on) {
        if (terrainPending) return;
        if (!on) {
            terrainEnabled = false;
            saveTerrain(false);
            terrainNote = '，未启用三维地形';
            viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
            applyTerrainBtnState();
            updateStatusText();
            return;
        }
        if (!hasTDTKey || typeof TdtPlug === 'undefined' || !TdtPlug.GeoTerrainProvider) {
            terrainBtn.disabled = true;
            return;
        }
        terrainPending = true;
        fetch('https://t0.tianditu.gov.cn/mapservice/swdx?T=elv_c&x=211&y=36&l=8&tk=' + TDT_KEY)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const provider = new TdtPlug.GeoTerrainProvider({
                    url: 'https://t{s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&x={x}&y={y}&l={z}&tk=' + TDT_KEY,
                    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7']
                });
                // 天地图高程仅覆盖中国范围，且 Cesium 1.120 的 CustomHeightmapTerrainProvider
                // 不读 rectangle 选项。覆盖 getTileDataAvailable：境外/超深瓦片返回 false，
                // Cesium 直接标记为不可用而不发起请求，避免“无效数据”报错刷屏。
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
                terrainNote = '，已启用天地图三维地形';
                saveTerrain(true);
            })
            .catch(e => {
                terrainEnabled = false;
                saveTerrain(false);
                terrainNote = '，未启用三维地形（Key 未授权当前域名或未开通地形服务）';
                console.warn('天地图三维地形不可用，使用平面地球：', e.message || e);
                statusText.textContent =
                    '三维地形不可用：天地图 Key 未授权当前域名或未开通地形服务。' +
                    '请在天地图控制台把当前域名加入白名单后重试。';
            })
            .finally(() => {
                terrainPending = false;
                applyTerrainBtnState();
                updateStatusText();
            });
    }

    terrainBtn.addEventListener('click', () => setTdtTerrain(!terrainEnabled));
    const terrainAvailable = !!(hasTDTKey && typeof TdtPlug !== 'undefined' && TdtPlug.GeoTerrainProvider);
    terrainBtn.hidden = !terrainAvailable;   // 无 Key / 无插件时直接隐藏，不占导航位置
    if (!terrainAvailable) {
        terrainBtn.disabled = true;
    } else {
        terrainBtn.disabled = false;
    }
    // 初始化：恢复上次选择（默认关闭，不请求任何地形瓦片）
    // 初始化：恢复上次选择；未选择过时按后台“默认启用三维地形”配置
    if (getSavedTerrain() || (window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.enableTerrainDefault)) {
        setTdtTerrain(true);
    }
    applyTerrainBtnState();

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
        const globe = viewer.scene && viewer.scene.globe;
        return !!globe && globe.tilesLoaded === true;
    }

    // 等首屏底图瓦片加载完成再播入场动画；网络慢时最多等固定时长，
    // 超时后仍继续播放，避免页面一直停留在等待状态。
    function scheduleEntranceAnimation() {
        const settleAtChina = () => {
            markEntranceSeen();
            viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000)
            });
            resumeAutoRotate('entrance');   // 没播动画也要解除暂停，按偏好决定是否自转
        };

        // 已看过一次入场（首次进入/历史访问）：刷新后直接停在中国整球视图，
        // 不再跨太平洋重播动画（自转与否由 autoRotatePref 决定）。
        if (entranceSeen()) {
            settleAtChina();
            return;
        }

        const DATA_TIMEOUT_MS = 4000;
        const TILE_TIMEOUT_MS = 3500;
        const startAt = performance.now();
        // 先把相机放在入场动画的起点（太平洋方向），让这一段底图优先开始加载，
        // 避免“动画开始后才现加载瓦片”导致空转。
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(-60, 30, 25000000)
        });

        function step(now) {
            const elapsed = now - startAt;
            // 足迹数据还没就绪：等数据回来（可能是“空数据”），避免对空地球播入场
            if (!footprintsDataReady) {
                if (elapsed < DATA_TIMEOUT_MS) {
                    requestAnimationFrame(step);
                    return;
                }
                settleAtChina();
                return;
            }
            // 没有足迹数据：不播入场，直接停在中国整球视图
            if (!FOOTPRINTS.length) {
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
        entranceActive = true;
        markEntranceSeen();
        const startLng = -60, startLat = 30, startH = 25000000;   // 从太平洋一侧开始
        const endLng = 104.0, endLat = 35.0, endH = 21000000;     // 中国大致中心，整球可见
        const duration = 2.6;   // 秒
        const startTime = performance.now();

        const cancelEntrance = () => {
            if (!entranceActive) return;
            entranceActive = false;
            viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(endLng, endLat, endH) });
            resumeAutoRotate('entrance');
        };
        // 用户拖动/滚轮交互时立即结束入场动画，避免相机被“抢”
        cesiumCanvas.addEventListener('pointerdown', cancelEntrance);
        cesiumCanvas.addEventListener('wheel', cancelEntrance, { passive: true });

        viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(startLng, startLat, startH) });
        function tick(now) {
            if (!entranceActive) return;
            const t = Math.min((now - startTime) / (duration * 1000), 1);
            const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
            viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(
                    startLng + (endLng - startLng) * k,
                    startLat + (endLat - startLat) * k,
                    startH + (endH - startH) * k
                )
            });
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                entranceActive = false;
                resumeAutoRotate('entrance');   // 入场结束才解除暂停，避免和动画抢相机
            }
        }
        requestAnimationFrame(tick);
    }

    const restoring2D = startIn2D();   // ?view=tickets 固定按 3D 启动，不恢复上次的 2D
    if (reduceMotion || restoring2D) {
        markEntranceSeen();
        if (restoring2D) pauseAutoRotate('2d');   // 恢复成 2D 时地球在后台，保持停转
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000) // 中国大致中心，整球可见
        });
        refreshAutoRotate();
    } else {
        pauseAutoRotate('entrance');   // 入场动画期间不自转
        scheduleEntranceAnimation();
    }

    // ================= 足迹标记点 =================
    // 图标统一画在 56×56 的 viewBox 里，拆成「命中层」和「可见图形」两部分，
    // 这样可以把可点击区域做大，而视觉上的圆点/圆环保持原样：
    // - 命中层：r=27 的圆，填充 1% 透明度。Cesium 拾取会丢弃 alpha 为 0 的像素，
    //   因此用几乎看不见的填充把命中区撑满整块图（旧版只有中间 r=22 能点到，
    //   25px 的图标实际可点直径不到 20px，触屏很难点中）。
    // - 可见图形：按 k 缩放。图块尺寸变大时图形画得更小，视觉大小保持不变。
    // 初始底图已在 switchBase 中确定，currentPositions 已按底图坐标系转换好。
    const MARKER_BOX = 56;
    const MARKER_HIT_R = 27;
    const MARKER_REF_SIZE = 26;          // 视觉基准：图块 26px 时圆环直径约 20px（与旧版一致）
    const CITY_MARKER_REF_SIZE = 30;     // 城市标记视觉基准
    // 触屏设备整体放大命中区：视觉大小不变，只让手指更容易点中
    const MARKER_SIZE = COARSE_POINTER ? 38 : MARKER_REF_SIZE;
    const CITY_MARKER_SIZE = COARSE_POINTER ? 42 : CITY_MARKER_REF_SIZE;
    const MARKER_SIZE_SELECTED = Math.round(MARKER_SIZE * 34 / MARKER_REF_SIZE);   // 选中态沿用 34/26 的比例

    function markerIconUrl(kind, k, count) {
        const parts = [
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + MARKER_BOX + '" height="' + MARKER_BOX + '" viewBox="0 0 56 56">',
            '<circle cx="28" cy="28" r="' + MARKER_HIT_R + '" fill="#ffffff" opacity="0.01"/>',
            '<circle cx="28" cy="28" r="' + (22 * k) + '" fill="none" stroke="#ffffff" stroke-width="' + (2.5 * k) + '" opacity="0.9"/>'
        ];
        if (kind === 'city') {
            parts.push('<text x="28" y="' + (28 + 3 * k) + '" fill="#f7f5f1" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="' + (15 * k) + '" text-anchor="middle">' + count + '</text>');
        } else {
            parts.push('<circle cx="28" cy="28" r="' + (8 * k) + '" fill="#ffffff" stroke="#1a2029" stroke-width="' + (2 * k) + '"/>');
        }
        parts.push('</svg>');
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(parts.join(''));
    }
    const MARKER_URL = markerIconUrl('footprint', MARKER_REF_SIZE / MARKER_SIZE);

    // ================= 常驻地名（标注层） =================
    // 底图选「无字」时画面上没有任何地名，只靠悬停显示名称：触屏根本没有 hover，
    // 桌面上也要逐个去碰运气。这里给已有的标记实体挂一个 label ——
    // 实体本身已经处理好了「模式切换 / 转到背面隐藏」，标签跟着实体走即可，
    // 既不新增实体，也不影响点击拾取。层级与标记一致：聚合态标城市，展开态标足迹。
    const GLOBE_LABEL_MODE = (() => {
        const raw = String(footprintCfg.globeLabels || 'all').trim().toLowerCase();
        return (raw === 'off' || raw === 'city' || raw === 'all') ? raw : 'all';
    })();
    const SHOW_CITY_LABELS = GLOBE_LABEL_MODE !== 'off';
    const SHOW_FOOTPRINT_LABELS = GLOBE_LABEL_MODE === 'all';
    const LABEL_FONT = '500 12px "PingFang SC", "Microsoft YaHei", sans-serif';
    const LABEL_FONT_PX = 12;        // 与上面的字号保持一致：避让时按它估算文字宽度
    const LABEL_LINE_HEIGHT = 17;    // 一行文字占的高度（含行距），用于屏幕空间避让
    const LABEL_PAD = 3;             // 避让时给每个标签留的余量
    const LABEL_GAP = 4;             // 标签与标记之间的间隙（贴着圆点写，字小的时候更自然）
    const LABEL_MARGIN = 4;          // 与视口边缘的最小距离
    const LABEL_MAX = 160;           // 单帧参与避让的标签上限（按离视口中心由近到远取）
    const LABEL_OUTLINE_COLOR = Cesium.Color.fromCssColorString('#0b0e14').withAlpha(0.85);
    // 标签候选位：8 个方向 × 2 圈（先试第一圈，放不下再整体外推一档）
    const LABEL_SLOT_DIRS = [
        { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 },
        { x: 0.7, y: 1 }, { x: -0.7, y: 1 }, { x: 0.7, y: -1 }, { x: -0.7, y: -1 }
    ];
    // 三圈：前两圈贴标记，第三圈兜底。同城足迹点挨得近时（窄视口尤其明显），
    // 名字宁可放得远一点，也不能整个消失——消失会让人以为"这个点没显示出来"。
    const LABEL_SLOT_RINGS = [1, 1.9, 2.6];
    // 悬停命中半径系数：覆盖到标记图块，但够不到紧挨着的标签文字
    // （文字距圆心的距离是 图块半径×0.42 + 间隙，这里取 0.55 留出安全余量）
    const MARKER_HIT_SLOP = 0.55;

    function markerLabelGraphics(text, markerSize) {
        return {
            text: text,
            font: LABEL_FONT,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.WHITE,
            outlineColor: LABEL_OUTLINE_COLOR,
            outlineWidth: 2.5,        // 等价于原来的 text-shadow 描边，压在影像底图上也能读清
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, Math.round(markerSize * 0.42) + LABEL_GAP),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: false               // 由 applyMarkerMode 打开，再由避让布局逐帧去重
        };
    }

    // 创建全部标记（数据加载完成后会重建）
    function buildMarkers() {
        labelLayoutState.clear();
        markerEntities = FOOTPRINTS.map((fp, i) => {
            const pos = currentPositions[i] || { lng: fp.lng, lat: fp.lat };
            return viewer.entities.add({
                name: fp.name,
                position: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, markerLift.get(i) || 0),
                billboard: {
                    image: MARKER_URL,
                    width: MARKER_SIZE,
                    height: MARKER_SIZE,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY   // 背面隐藏由 updateMarkerOcclusion 处理
                },
                label: markerLabelGraphics(fp.name || '', MARKER_SIZE)
            });
        });
    }

    // 构建城市聚合标记（每个城市一个，中心取足迹平均位置）
    // 城市聚合键：优先 adcode（城市名可能被手动改过写法，"大理市"/"大理白族自治州" 要算同一座城），
    // 没有 adcode 才退回城市名。卡片墙、城市视图、重走同城判定、明信片统计共用这一个键。
    function cityKeyOf(fp) {
        if (!fp) return '';
        const code = String(fp.cityAdcode || '').trim();
        if (code) return code;
        return String(fp.city || '').trim();
    }

    function buildCityMarkers() {
        // 先按聚合键分组，再决定显示用的城市名（取该组里出现次数最多的写法）
        const groups = new Map();
        FOOTPRINTS.forEach((fp, i) => {
            const name = String(fp.city || '').trim() || '未分类';
            const key = cityKeyOf(fp) || name;
            if (!groups.has(key)) groups.set(key, { key, names: new Map(), indices: [] });
            const group = groups.get(key);
            group.indices.push(i);
            group.names.set(name, (group.names.get(name) || 0) + 1);
        });
        cityList = [...groups.values()].map(group => {
            let best = '未分类';
            let bestCount = 0;
            group.names.forEach((count, name) => {
                if (count > bestCount) { best = name; bestCount = count; }
            });
            // key 保留聚合键：城市卡片的"只看这座城市的票根"要用它比对
            return { city: best, key: group.key, indices: group.indices };
        });
        cityMarkerEntities.forEach(ent => viewer.entities.remove(ent));
        labelLayoutState.clear();
        cityMarkerEntities = cityList.map(city => {
            const center = cityCenter(city);
            return viewer.entities.add({
                name: city.city,
                position: center ? Cesium.Cartesian3.fromDegrees(center.lng, center.lat) : undefined,
                billboard: {
                    image: cityMarkerUrl(city.indices.length),
                    width: CITY_MARKER_SIZE,
                    height: CITY_MARKER_SIZE,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY   // 背面隐藏由 updateMarkerOcclusion 处理
                },
                label: markerLabelGraphics(city.city, CITY_MARKER_SIZE)
            });
        });
    }

    // 切换 城市聚合 / 展开单个足迹 模式
    function applyMarkerMode(city) {
        hidePhotoRing();   // 聚合 / 展开切换后标记的锚点会变，照片环先收掉
        if (city && cityRevealRaf) {
            cancelAnimationFrame(cityRevealRaf);
            cityRevealRaf = null;
            markerEntities.forEach(ent => {
                if (ent && ent.billboard) {
                    ent.billboard.width = MARKER_SIZE;
                    ent.billboard.height = MARKER_SIZE;
                }
            });
        }
        cityMode = city;
        cityMarkerEntities.forEach(ent => { ent.show = city; });
        markerEntities.forEach(ent => { ent.show = !city; });
        // 标签显隐统一交给避让布局处理（它同时判断"这个模式下该不该有标签"）。
        // 两处各写一份 label.show 会让布局的状态缓存与实际值失同步，
        // 出现"该收的没收回"（例如缩回整球后还留着城市名）。
        markerLabelDirty = true;   // 换了一批标签，下一帧重排避让
        pendingMarkerAudit = true;  // 模式切换后复检一次渲染结果（漏画的点趁早抬高）
        markerOcclusionDirty = true;   // 换了一组标记，遮挡关系重算
        buildMarkerFocusButtons();
        hideMarkerTip();
        const card = document.getElementById('cityCard');
        if (city && card) card.classList.remove('is-revealed');
        // 离开城市聚合态（相机贴到城市尺度、足迹点已展开）时城市标记本身不可见，
        // 连线的锚点随之失去意义 —— 直接收起整组卡片。
        if (!city && provinceCardsActive) closeProvinceCards();
    }

    buildMarkers();
    buildCityMarkers();
    applyMarkerMode(true);   // 初始整球视图：城市聚合

    // ================= 标记交互：悬停显示名称，点击打开详情卡 =================
    const markerCard = document.getElementById('markerCard');
    const markerCardMedia = document.getElementById('markerCardMedia');
    const markerCardTitle = document.getElementById('markerCardTitle');
    const markerCardMeta = document.getElementById('markerCardMeta');
    const markerCardAddr = document.getElementById('markerCardAddr');
    const markerCardDesc = document.getElementById('markerCardDesc');
    const markerCardActions = markerCard.querySelector('.marker-card-actions');
    const markerCardTicket = document.getElementById('markerCardTicket');
    const markerCardGallery = document.getElementById('markerCardGallery');
    const markerCardGalleryLabel = document.getElementById('markerCardGalleryLabel');
    const markerCardStamp = document.getElementById('markerCardStamp');
    const cityCard = document.getElementById('cityCard');
    const cityCardMedia = document.getElementById('cityCardMedia');
    const cityCardTitle = document.getElementById('cityCardTitle');
    const cityCardDesc = document.getElementById('cityCardDesc');
    const cityStatFootprints = document.getElementById('cityStatFootprints');
    const cityStatPhotos = document.getElementById('cityStatPhotos');
    const cityCardGallery = document.getElementById('cityCardGallery');
    const cityCardLocate = document.getElementById('cityCardLocate');
    let activeCityIndex = -1;
    let cityCardTriggerBtn = null;
    detailCardsReady = true;   // 详情卡已就绪，可响应整球视图自动关闭
    let activeFootprintIndex = -1;
    let markerRestoreRaf = null;

    function setMarkerSelected(index) {
        if (markerRestoreRaf) {
            cancelAnimationFrame(markerRestoreRaf);
            markerRestoreRaf = null;
        }
        if (cityRevealRaf) {
            cancelAnimationFrame(cityRevealRaf);
            cityRevealRaf = null;
        }
        markerEntities.forEach((ent, i) => {
            const sel = i === index;
            ent.billboard.width = sel ? MARKER_SIZE_SELECTED : MARKER_SIZE;
            ent.billboard.height = sel ? MARKER_SIZE_SELECTED : MARKER_SIZE;
            ent.billboard.color = sel ? Cesium.Color.WHITE : Cesium.Color.WHITE.withAlpha(0.42);
        });
    }

    // 关闭卡片时，标记圆点/光圈与卡片淡出同节奏复原。
    // 注意：billboard.width/color 读回的是 Property 包装对象，不能直接当数值用，
    // 所以起点状态用代码里记录的选中项（选中/全亮，其他基准尺寸/42% 透明度）。
    function restoreMarkers(duration, selIndex) {
        if (markerRestoreRaf) {
            cancelAnimationFrame(markerRestoreRaf);
            markerRestoreRaf = null;
        }
        const start = performance.now();
        function tick(now) {
            const t = Math.min((now - start) / duration, 1);
            const k = t * t * (3 - 2 * t);   // smoothstep 缓动
            markerEntities.forEach((ent, i) => {
                const fromW = (i === selIndex) ? MARKER_SIZE_SELECTED : MARKER_SIZE;
                const fromA = (i === selIndex) ? 1.0 : 0.42;
                ent.billboard.width = fromW + (MARKER_SIZE - fromW) * k;
                ent.billboard.height = fromW + (MARKER_SIZE - fromW) * k;
                ent.billboard.color = Cesium.Color.WHITE.withAlpha(fromA + (1 - fromA) * k);
            });
            if (t < 1) {
                markerRestoreRaf = requestAnimationFrame(tick);
            } else {
                markerRestoreRaf = null;
            }
        }
        markerRestoreRaf = requestAnimationFrame(tick);
    }

    // 浮层显隐统一先处理焦点：隐藏时先 blur，再置 inert，最后更新 aria-hidden，
    // 避免“焦点停留在 aria-hidden=true 的祖先内”造成的无障碍警告。
    function setOverlayHidden(el, hidden) {
        if (!el) return;
        if (hidden && el.contains && el.contains(document.activeElement)) {
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
        }
        if ('inert' in el) {
            el.inert = !!hidden;
        }
        el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }

    function hideMarkerCard() {
        hidePhotoRing();                               // 卡片收起时照片环一起收（环是卡片的延伸）
        document.body.classList.remove('card-open');   // 恢复右下角浮动按钮
        resumeAutoRotate('card');                      // 详情卡关掉：按用户偏好恢复自转
        if (!markerCard.classList.contains('visible')) return;
        markerCard.classList.remove('visible');
        // 注意：这里要的是「那个按钮」，不是判断结果 —— 直接写 && 链会得到布尔值，
        // 后面调 .focus() 会抛 TypeError（键盘打开卡片后再点「打开图片墙」会因此打不开图墙）
        const keyboardRestore = (lastKeyboardMarkerBtn &&
            lastKeyboardMarkerBtn.isConnected &&
            markerCard.contains(document.activeElement))
            ? lastKeyboardMarkerBtn
            : null;
        lastKeyboardMarkerBtn = null;
        setOverlayHidden(markerCard, true);
        const selIndex = activeFootprintIndex;   // 先记录再置空，供复原动画使用
        activeFootprintIndex = -1;
        if (reduceMotion) {
            markerEntities.forEach(ent => {
                ent.billboard.width = MARKER_SIZE;
                ent.billboard.height = MARKER_SIZE;
                ent.billboard.color = Cesium.Color.WHITE;
            });
        } else {
            restoreMarkers(450, selIndex);   // 与卡片淡出时长一致
        }
        // 键盘关闭后，把焦点还给触发打开的标记按钮
        if (keyboardRestore) {
            keyboardRestore.focus();
        }
    }

    // ================= 详情卡主图：加载成功显示图片，失败回退首字占位 + 重试 =================
    let cardImgLoadId = 0;   // 防止快速切换卡片时旧请求覆盖新图

    function showCardMonogram(fp, showRetry) {
        markerCardMedia.classList.add('no-image');
        markerCardMedia.style.backgroundImage = 'none';
        markerCardMedia.innerHTML =
            '<span class="marker-card-monogram">' + (fp.name ? fp.name.charAt(0) : '?') + '</span>' +
            (showRetry ? '<button class="marker-card-retry" type="button">重试</button>' : '');
        if (showRetry) {
            markerCardMedia.querySelector('.marker-card-retry').addEventListener('click', (e) => {
                e.stopPropagation();
                const f = FOOTPRINTS[activeFootprintIndex];
                if (f && f.image) loadCardImage(f, true);   // 重试：绕过失败缓存
            });
        }
    }

    // force=true 用于卡片上的"重试"按钮：跳过共享缓存里那条失败结论，真的重新请求一次
    function loadCardImage(fp, force) {
        const myId = ++cardImgLoadId;
        markerCardMedia.classList.add('no-image');
        markerCardMedia.style.backgroundImage = 'none';
        markerCardMedia.innerHTML =
            '<span class="marker-card-monogram">' + (fp.name ? fp.name.charAt(0) : '?') + '</span>';
        // 走共用的封面加载队列（并发限流 + 成功缓存）；这张卡有显式的重试按钮，
        // 所以关掉"静默重试"，失败立刻把重试按钮交出来。
        loadCardCoverImage(fp.image, (ok) => {
            if (myId !== cardImgLoadId) return;   // 已被更新的卡片取代
            if (!ok) {
                showCardMonogram(fp, true);   // 图片失败：首字占位 + 重试
                return;
            }
            markerCardMedia.classList.remove('no-image');
            markerCardMedia.style.backgroundImage = 'url("' + fp.image + '")';
            markerCardMedia.innerHTML = '';
        }, { retry: false, force: !!force });
    }

    // ================= 足迹卡入场方向：从被点的标记那一侧长出来 =================
    // 足迹卡是「这一条记录」的展开，所以位移方向与缩放原点都指向标记点，
    // 城市卡则是侧边容器、固定从右侧滑入。这样不用读文字也能看出这张卡属于哪个点。
    const CARD_ENTER_DISTANCE = 22;    // 入场起点离静止位的距离（像素）
    const CARD_ENTER_MIN_DIST = 40;    // 标记离卡片太近时不硬凑方向，退回默认的右侧滑入

    // 卡片的「静止布局盒」：只按定位属性和布局尺寸推算，绝不碰 transform。
    // 一旦临时改 transform，浏览器会从被改动的那一帧重新开始一段过渡，
    // 把真正的入场动画搅乱（实测会把「从标记方向展开」变成「从上往下掉」）。
    // offsetWidth/offsetHeight 本身不受 transform 影响，left/right/top/bottom
    // 是 position:fixed 相对视口的计算值，桌面（right+top）与窄屏（left+bottom）都覆盖。
    function cardLayoutRect(card) {
        if (!card) return null;
        const width = card.offsetWidth;
        const height = card.offsetHeight;
        if (!width || !height) return null;
        const cs = getComputedStyle(card);
        const px = (value) => (value === 'auto' ? null : parseFloat(value));
        const left = px(cs.left) ?? (px(cs.right) === null ? null : window.innerWidth - px(cs.right) - width);
        const top = px(cs.top) ?? (px(cs.bottom) === null ? null : window.innerHeight - px(cs.bottom) - height);
        if (left === null || top === null) return null;
        return { left, top, width, height };
    }

    // 标记点的屏幕坐标；聚合态 / 地球背面 / 数据缺失时返回 null，调用方走默认方向
    function markerScreenPosition(index) {
        const ent = markerEntities[index];
        if (!ent || ent.show === false) return null;
        if (!ent.billboard || ent.billboard.show === false) return null;
        const pos = ent.position && ent.position.getValue(Cesium.JulianDate.now());
        if (!pos) return null;
        // 与悬停标注同一套半球判定：转到地球背面的标记没有可参照的屏幕位置
        const normal = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
        const toCamera = Cesium.Cartesian3.subtract(viewer.camera.positionWC, pos, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.dot(normal, toCamera) < 0) return null;
        const screen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos);
        return screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
    }

    function applyCardEnterDirection(index) {
        const rect = cardLayoutRect(markerCard);
        const screen = rect ? markerScreenPosition(index) : null;
        if (!screen) {
            markerCard.style.removeProperty('--card-enter-x');
            markerCard.style.removeProperty('--card-enter-y');
            markerCard.style.removeProperty('--card-origin-x');
            markerCard.style.removeProperty('--card-origin-y');
            return;
        }
        const dx = screen.x - (rect.left + rect.width / 2);
        const dy = screen.y - (rect.top + rect.height / 2);
        const len = Math.hypot(dx, dy);
        if (len < CARD_ENTER_MIN_DIST) {
            markerCard.style.setProperty('--card-enter-x', '0px');
            markerCard.style.setProperty('--card-enter-y', '0px');
        } else {
            markerCard.style.setProperty('--card-enter-x', Math.round(dx / len * CARD_ENTER_DISTANCE) + 'px');
            markerCard.style.setProperty('--card-enter-y', Math.round(dy / len * CARD_ENTER_DISTANCE) + 'px');
        }
        // 缩放原点落在离标记最近的那条边上：卡片看起来是从标记这一侧张开的
        const pct = (value) => Math.max(0, Math.min(100, value)).toFixed(1) + '%';
        markerCard.style.setProperty('--card-origin-x', pct((screen.x - rect.left) / rect.width * 100));
        markerCard.style.setProperty('--card-origin-y', pct((screen.y - rect.top) / rect.height * 100));
    }

    // 开场时序：带方向的「隐藏态」必须先落到样式上，再切到可见态。
    // 否则浏览器会把这次变化当成「上一次的静止值 → 可见值」，过渡起点变成默认的右侧位置，
    // 表现为第一张卡片总是从右边滑进来、只有第二次打开才从标记方向展开。
    function openMarkerCardFrom(index) {
        const savedTransition = markerCard.style.transition;
        markerCard.style.transition = 'none';   // 让隐藏态立即生效（卡片此刻不可见，不会有闪烁）
        applyCardEnterDirection(index);
        void markerCard.offsetWidth;            // 强制一次样式计算，把带方向的隐藏态定为过渡起点
        markerCard.style.transition = savedTransition;
        markerCard.classList.add('visible');
    }

    function showMarkerCard(fp, index) {
        hideCityCard(false);
        closeProvinceCards();   // 详情卡与省份卡片组互斥：打开详情卡就收起省份卡片
        pauseAutoRotate('card');   // 打开足迹详情卡：临时停转（关掉卡片按用户偏好自动恢复）
        activeFootprintIndex = index;
        markerCardTitle.textContent = fp.name;
        markerCardAddr.textContent = fp.address || '';
        markerCardDesc.textContent = fp.description || '';

        const metaParts = [];
        if (fp.footprintType) metaParts.push(fp.footprintType);
        if (fp.city) metaParts.push(fp.city);
        markerCardMeta.textContent = metaParts.join(' / ');
        markerCardMeta.hidden = metaParts.length === 0;

        // 日期单独做成印章（纸票据的识别符号），不再和信息行挤在一行
        const stampText = ticketDate(fp.createTime || fp.ticketDate);
        markerCardStamp.textContent = stampText;
        markerCardStamp.hidden = !stampText;

        // 足迹详情卡动作：只有配置了票根的足迹才提供“打开票根”，无票根时整行隐藏。
        // 主次分开：有票根时票根是主操作，否则图片墙顶上，避免所有按钮看起来一样重要。
        const hasTicket = !!ticketImageUrl(fp.ticketImage);
        const galleryCount = cityWallImages(fp).length;
        const hasGallery = galleryCount > 0;
        markerCardGallery.hidden = !hasGallery;
        markerCardTicket.hidden = !hasTicket;
        markerCardActions.hidden = !hasGallery && !hasTicket;
        markerCardTicket.classList.toggle('is-primary', hasTicket);
        markerCardGallery.classList.toggle('is-primary', hasGallery && !hasTicket);
        markerCardGalleryLabel.textContent = galleryCount > 1 ? '打开图片墙 · ' + galleryCount : '打开图片墙';

        if (fp.image) {
            loadCardImage(fp);
        } else {
            showCardMonogram(fp, false);
        }

        setMarkerSelected(index);
        openMarkerCardFrom(index);   // 从被点的标记方向展开（标记不可用时保持默认的右侧滑入）
        document.body.classList.add('card-open');   // 隐藏右下角浮动按钮，避免遮挡
        setOverlayHidden(markerCard, false);
    }

    document.getElementById('markerCardClose').addEventListener('click', hideMarkerCard);

    // 打开票根：跳到票根墙并定位到当前足迹对应的那张票根
    markerCardTicket.addEventListener('click', () => {
        if (activeFootprintIndex < 0) return;
        const fp = FOOTPRINTS[activeFootprintIndex];
        if (!fp || !ticketImageUrl(fp.ticketImage)) return;
        const items = ticketItemsFromFootprints();
        // 优先按足迹唯一 key 定位，避免对象替换/顺序变化时错配到其他票根
        let ticketIndex = fp.key ? items.findIndex(item => item.key === fp.key) : -1;
        if (ticketIndex < 0) ticketIndex = items.indexOf(fp);
        if (ticketIndex < 0) return;
        hideMarkerCard();
        setTicketView(true, ticketIndex, false);   // 从足迹卡进入票根时不自动开启地球旋转
    });

    // 城市卡只展示已有足迹的聚合信息，不创建或维护独立的城市数据。
    function cityViewItems(ci) {
        const city = cityList[ci];
        return city ? city.indices.map(i => FOOTPRINTS[i]).filter(Boolean) : [];
    }

    function cityPhotoItems(ci) {
        return cityViewItems(ci).flatMap(fp => cityWallImages(fp));
    }

    // 点击城市后的落地视角：以该城市的平均位置为中心，停在展开阈值下方、
    // 但不需要贴到具体足迹点的高度——落地瞬间即可展开足迹，保持“城市上空”的整体视野。
    function cityFlightTarget(ci) {
        const city = cityList[ci];
        const center = city && cityCenter(city);
        if (!center) return null;
        return { lng: center.lng, lat: center.lat, height: CITY_VIEW_HEIGHT };
    }

    // 城市飞行落地收尾：moveEnd 与兜底定时器都可能触发，只执行一次。
    // 落地后按高度执行与手动缩放一致的 聚合/展开 切换（阈值带逻辑不变）。
    function finishCityFlight() {
        if (cityFlightTimer !== null) {
            clearTimeout(cityFlightTimer);
            cityFlightTimer = null;
        }
        if (cityMoveEndHandler) {
            viewer.camera.moveEnd.removeEventListener(cityMoveEndHandler);
            cityMoveEndHandler = null;
        }
        cityFlightActive = false;
        const ci = cityFlightIndex;
        cityFlightIndex = -1;
        if (ci < 0) return;
        const h = viewer.camera.positionCartographic.height;
        if (cityMode && h < CITY_EXPAND_HEIGHT) {
            revealCityFootprints(ci);
        } else if (!cityMode && h > CITY_COLLAPSE_HEIGHT) {
            applyMarkerMode(true);
        }
    }

    // 展开为单个足迹：切换模式后，让该城市的标记点从 0 尺寸依次长大，
    // 形成“聚合点散开”的空间连续感；系统减弱动效时直接切换。
    function revealCityFootprints(ci) {
        const city = cityList[ci];
        if (!city || !city.indices.length) return;
        const alreadyExpanded = !cityMode;
        applyMarkerMode(false);
        const card = document.getElementById('cityCard');
        if (card) card.classList.add('is-revealed');
        if (alreadyExpanded || reduceMotion) {
            pendingMarkerAudit = true;   // 没播动画也要体检一次渲染结果
            return;
        }
        if (cityRevealRaf) cancelAnimationFrame(cityRevealRaf);
        const indices = city.indices.slice();
        indices.forEach(fi => {
            const ent = markerEntities[fi];
            if (ent && ent.billboard) {
                ent.billboard.width = 0;
                ent.billboard.height = 0;
            }
        });
        const STEP_MS = 55;
        const DURATION_MS = 420;
        // 基准时间必须取「第一帧的时间戳」，不能用 performance.now()：
        // 这个函数是从相机 moveEnd（落地收尾）调进来的，那一刻还在 Cesium 的渲染帧里，
        // performance.now() 会晚于当前帧的起始时间，于是第一帧算出来 t <= 0、
        // pending 一直是 false，动画立刻结束，这一城的标记就永远停在 0 尺寸（看不见）。
        let startedAt = null;
        const restoreSize = (fi) => {
            const ent = markerEntities[fi];
            if (ent && ent.billboard) {
                ent.billboard.width = MARKER_SIZE;
                ent.billboard.height = MARKER_SIZE;
            }
        };
        const tick = (now) => {
            if (startedAt === null) startedAt = now;
            let pending = false;
            indices.forEach((fi, k) => {
                const ent = markerEntities[fi];
                if (!ent || !ent.billboard) return;
                const t = (now - startedAt - k * STEP_MS) / DURATION_MS;
                if (t >= 1) {
                    restoreSize(fi);
                } else {
                    // t <= 0 是「这一站还没轮到」，也要让循环继续跑；
                    // 之前只在 t > 0 时继续，第一帧 t=0 会让循环立刻退出，动画整段丢失
                    pending = true;
                    if (t <= 0) return;
                    const eased = 1 - Math.pow(1 - t, 3);
                    ent.billboard.width = Math.max(1, Math.round(MARKER_SIZE * eased));
                    ent.billboard.height = Math.max(1, Math.round(MARKER_SIZE * eased));
                }
            });
            if (pending && !cityMode) {
                cityRevealRaf = requestAnimationFrame(tick);
            } else {
                cityRevealRaf = null;
                // 兜底：动画结束时还没长到正常尺寸的（包括上面那种一帧就退出、以及
                // 中途被切回聚合模式的情况），直接补回基准尺寸，绝不让标记停在看不见的尺寸
                indices.forEach(restoreSize);
                indices.forEach(fi => {
                    const ent = markerEntities[fi];
                    if (ent) ent.show = true;   // 落地就该看到的点，先点亮；下一帧遮挡判定会按真实几何再校正
                });
                // 收尾后再按当前相机重算一次可见性与标签：落地瞬间的时序差异
                // 不该让某个点/名字停在上一帧状态，等用户拖动才恢复
                markerOcclusionDirty = true;
                markerLabelDirty = true;
                pendingMarkerAudit = true;   // 动画结束后在真实渲染结果上体检一次
            }
        };
        cityRevealRaf = requestAnimationFrame(tick);
    }

    // ============ 标记自愈：实体状态正常、但画笔没上（点与名字一起消失）============
    // 症状：show=true、width/height 正常、位置合法、label.show=true，可 scene.pick 在它自己的
    // 屏幕位置上拾到的是地球 —— 也就是 Cesium 这一帧根本没画它，拖动/缩放后才恢复。
    // 做法：展开或重建后，用 pick 在真实渲染结果上逐个体检；确认"没被画出来"的实体重建一次
    // （remove + add，让位置/图标/标签全部由 Cesium 重新走一遍可视化流程）。
    // ⚠ 根因（2026-09-14 现场探测确认）：Cesium 的 disableDepthTestDistance 是靠顶点着色器里
    //   gl_Position.z = -gl_Position.w 把深度顶到近平面实现的，且只在顶点未被裁剪时执行；
    //   当标记**正好落在椭球面（h=0）**上时这个组合会失效 —— 同一坐标只要抬高一点点就正常。
    //   所以"总是画在最前"保留（地形也挡不住），改为一档档抬高直到能画出来：
    //   只动被这条边界情况命中的少数点，其余点保持 h=0，避免无谓的视差偏移。
    const MARKER_LIFT_STEPS = [120, 600, 2500];    // 自愈抬高档位（米）
    function auditMarkerRendering() {
        if (cityMode) return;                       // 聚合态下足迹点本来就是隐藏的
        if (cityRevealRaf) {                        // 正在播"聚合点散开"动画：等它播完再体检，避免误判
            pendingMarkerAudit = true;
            return;
        }
        const now = Cesium.JulianDate.now();
        let rebuilt = 0;
        let retry = false;
        let waiting = false;
        markerEntities.forEach((ent, i) => {
            if (!ent || !ent.show) return;
            const fp = FOOTPRINTS[i];
            if (!fp) return;
            const lifted = markerLift.get(i) || 0;
            const nextStep = MARKER_LIFT_STEPS.find(v => v > lifted);
            if (nextStep === undefined) return;     // 已经抬到最高一档仍画不出来，不再折腾
            const widthProp = ent.billboard && ent.billboard.width;
            const width = widthProp && widthProp.getValue ? widthProp.getValue(now) : widthProp;
            if (typeof width === 'number' && width < MARKER_SIZE * 0.6) {
                waiting = true;                     // 尺寸还在动画里，先不算它
                return;
            }
            const pos = ent.position && ent.position.getValue(now);
            if (!pos) return;
            const sp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos, labelScreen);
            if (!sp || sp.x < 0 || sp.y < 0 || sp.x > window.innerWidth || sp.y > window.innerHeight) return;
            const picked = viewer.scene.pick(new Cesium.Cartesian2(sp.x, sp.y));
            if (picked && picked.id === ent) return;   // 画出来了，正常
            if (picked && (markerEntities.indexOf(picked.id) >= 0 || cityMarkerEntities.indexOf(picked.id) >= 0)) {
                return;                                // 被另一个标记压住：属正常遮挡，不动它
            }
            // 没被画出来 → 抬高一点重建这个实体（下一次体检会再确认）
            markerLift.set(i, nextStep);
            const center = currentPositions[i] || { lng: fp.lng, lat: fp.lat };
            const fresh = viewer.entities.add({
                name: fp.name,
                position: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, nextStep),
                billboard: {
                    image: MARKER_URL,
                    width: MARKER_SIZE,
                    height: MARKER_SIZE,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                label: markerLabelGraphics(fp.name || '', MARKER_SIZE)
            });
            fresh.show = true;
            labelLayoutState.delete(ent);
            viewer.entities.remove(ent);
            markerEntities[i] = fresh;
            rebuilt++;
            retry = true;
        });
        if (rebuilt) {
            markerOcclusionDirty = true;
            markerLabelDirty = true;
            if (retry) pendingMarkerAudit = true;   // 下一帧再体检一次，必要时继续抬高
            console.warn('[footprint] 检测到 ' + rebuilt + ' 个足迹标记未被渲染，已抬高重建');
        } else if (waiting) {
            pendingMarkerAudit = true;              // 还有点在动，等停下来再看
        }
    }

    // 飞往城市：终点按足迹分布计算，落地瞬间自动展开该城市的足迹点。
    function flyToCity(ci) {
        if (cityFlightActive && cityFlightIndex === ci) return;   // 同一城市飞行进行中不重复起飞
        const target = cityFlightTarget(ci);
        if (!target) return;
        const duration = reduceMotion ? 0 : 1.8;
        if (cityFlightTimer !== null) {
            clearTimeout(cityFlightTimer);
            cityFlightTimer = null;
        }
        if (cityMoveEndHandler) {
            viewer.camera.moveEnd.removeEventListener(cityMoveEndHandler);
            cityMoveEndHandler = null;
        }
        cityFlightActive = true;
        cityFlightIndex = ci;
        if (duration > 0) {
            cityMoveEndHandler = finishCityFlight;
            viewer.camera.moveEnd.addEventListener(cityMoveEndHandler);
            cityFlightTimer = setTimeout(finishCityFlight, duration * 1000 + 600);
        }
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(target.lng, target.lat, target.height),
            duration: duration
        });
        if (duration <= 0) finishCityFlight();
    }

    function showCityCard(ci, triggerBtn) {
        const city = cityList[ci];
        if (!city) return;
        closeProvinceCards();   // 详情卡与省份卡片组互斥：打开城市卡就收起省份卡片
        pauseAutoRotate('city-card');   // 打开城市聚合卡：临时停转（关掉卡片按用户偏好自动恢复）
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        if (cityView.classList.contains('show')) closeCityView(false);
        hideMarkerTip();

        activeCityIndex = ci;
        cityCardTriggerBtn = triggerBtn || null;
        const fps = cityViewItems(ci);
        const photos = cityPhotoItems(ci);
        const latest = fps.map(fp => fp.createTime).filter(Boolean).sort().pop();
        const types = [...new Set(fps.map(fp => fp.footprintType).filter(Boolean))];
        cityCardTitle.textContent = city.city;
        // 容器层要回答的是「这里有多少」：两个数字比一句话更好扫读
        cityStatFootprints.textContent = String(fps.length);
        cityStatPhotos.textContent = String(photos.length);
        // 最近到访带上年份（旅行记录里年份是有意义的，之前挤进统计格被截掉了），
        // 和记录类型合成一行次级信息
        const descParts = [];
        if (latest) descParts.push('最近到访 ' + formatCityDate(latest).replace(/\s*\/\s*/, '.'));
        if (types.length) descParts.push(types.join('、'));
        cityCardDesc.textContent = descParts.join(' · ') || '这座城市的旅行足迹与照片收藏';
        // 封面按需加载，不做任何预取：曾试过「悬停城市标记即预热 + 预解码」，
        // 实测拖动一次扫过标记区就会打出 7 个封面图请求（和底图瓦片抢带宽/主线程），
        // 拖动明显变卡，所以退回按需加载。
        // 这里统一走 cardCover 那套：首字先顶上，图片加载成功后淡入，失败就停在首字。
        showCardCover(cityCardMedia, photos.length ? photos[0].url : '', city.city ? city.city.charAt(0) : '?');
        cityCard.classList.add('visible');
        setOverlayHidden(cityCard, false);
        flyToCity(ci);
    }

    function hideCityCard(returnFocus = true) {
        resumeAutoRotate('city-card');   // 城市卡关掉：按用户偏好恢复自转
        if (!cityCard.classList.contains('visible')) return;
        cityCard.classList.remove('visible');
        cityCard.classList.remove('is-revealed');
        setOverlayHidden(cityCard, true);
        const trigger = cityCardTriggerBtn;
        cityCardTriggerBtn = null;
        activeCityIndex = -1;
        if (returnFocus && trigger) trigger.focus();
    }

    document.getElementById('cityCardClose').addEventListener('click', () => hideCityCard());
    cityCardLocate.addEventListener('click', () => {
        if (activeCityIndex >= 0) flyToCity(activeCityIndex);
    });
    cityCardGallery.addEventListener('click', () => {
        if (activeCityIndex < 0) return;
        const ci = activeCityIndex;
        const trigger = cityCardTriggerBtn;
        hideCityCard(false);
        openCityView(ci, trigger);
    });

    // ================= 悬停名称（标注式引导线，跟随标记） =================

    // 悬停/键盘聚焦时：其他标记变暗、城市轮廓透明度降低，只有当前标记保持全亮，
    // 同时把聚焦的标记放大一点点。放大走 billboard.scale（Cesium 会把它乘到
    // 图块宽高上），与选中态 / 复原动画改的 width 互不覆盖，两个效果可以叠加。
    const MARKER_HOVER_SCALE = 1.16;

    // 标记明暗的唯一出口：悬停聚焦优先；其次看省份卡片组选中的城市；两者都没有就全亮。
    // 两者写两套颜色会互相覆盖（悬停结束把颜色刷回全亮、省份高亮就丢了）。
    function markerEmphasisColor(entity, focus) {
        const dim = Cesium.Color.WHITE.withAlpha(PROVINCE_MARKER_DIM_ALPHA);
        if (focus) return focus === entity ? Cesium.Color.WHITE : dim;
        if (provinceCardsActive) return provinceBrightEntities.has(entity) ? Cesium.Color.WHITE : dim;
        return Cesium.Color.WHITE;
    }

    function refreshMarkerColors() {
        markerEntities.forEach(ent => {
            if (ent && ent.billboard) ent.billboard.color = markerEmphasisColor(ent, focusedMarker);
        });
        cityMarkerEntities.forEach(ent => {
            if (ent && ent.billboard) ent.billboard.color = markerEmphasisColor(ent, focusedMarker);
        });
    }

    function setMarkerFocus(entity) {
        if (focusedMarker === entity) return;
        if (focusedMarker && focusedMarker.billboard) focusedMarker.billboard.scale = 1;
        focusedMarker = entity;
        if (entity && entity.billboard) entity.billboard.scale = MARKER_HOVER_SCALE;
        const outlineMat = Cesium.Color.WHITE.withAlpha(entity ? 0.2 : 0.4);
        cityOutlinePolylines.forEach(p => { if (p) p.material = outlineMat; });
        refreshMarkerColors();
    }

    function showMarkerTip(entity, text) {
        markerTipEntity = entity;
        markerTipName.textContent = text;
        markerTip.classList.add('show');
        setMarkerFocus(entity);
        updateMarkerTipPosition();
    }

    function hideMarkerTip() {
        markerTipEntity = null;
        hoveredMarkerKey = '';   // 气泡被别的入口收起后，指针再动一次可以重新弹出来
        markerTip.classList.remove('show');
        setMarkerFocus(null);
    }

    // 每帧把名称钉在标记旁边（标记随地球转动/底图切换而移动）
    function updateMarkerTipPosition() {
        if (!markerTipEntity) return;
        const ent = markerTipEntity;
        if (!ent) return;
        const pos = ent.position && ent.position.getValue(Cesium.JulianDate.now());
        if (!pos) return;
        // 标记转到地球背面时，隐藏悬停标注（与标记遮挡保持一致）
        const normal = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
        const toCamera = Cesium.Cartesian3.subtract(viewer.camera.positionWC, pos, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.dot(normal, toCamera) < 0) {
            hideMarkerTip();
            return;
        }
        const screenPos = pos && Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos);
        if (!screenPos) return;
        // 先按右侧布局测量；靠近屏幕右缘时镜像到标记左侧
        markerTip.classList.remove('left');
        const w = markerTip.offsetWidth;
        const h = markerTip.offsetHeight;
        const placeLeft = screenPos.x + 4 + w > window.innerWidth - 8;
        let x, y;
        if (placeLeft) {
            markerTip.classList.add('left');
            x = screenPos.x - 4 - markerTip.offsetWidth;
        } else {
            x = screenPos.x + 4;
        }
        x = Math.max(8, Math.min(x, window.innerWidth - markerTip.offsetWidth - 8));
        y = Math.max(8, Math.min(screenPos.y - h / 2, window.innerHeight - h - 8));
        markerTip.style.left = x + 'px';
        markerTip.style.top = y + 'px';
    }
    viewer.scene.postRender.addEventListener(updateMarkerTipPosition);

    // 标记可见性：转到地球背面（越过地平线）立即隐藏，转回正面再出现。
    // 与悬停标注同一套半球算法，行为可控且不依赖深度缓冲。
    // 判定只取决于「相机 ↔ 标记」的相对位置，所以相机没动就直接跳过：
    // postRender 每帧都跑（自转、昼夜光照需要连续渲染），静止浏览时这一层不必
    // 每帧做一遍 O(标记数) 的点乘与属性写入。
    const occNormal = new Cesium.Cartesian3();
    const occToCam = new Cesium.Cartesian3();
    const occCamPos = new Cesium.Cartesian3();
    const occCamDir = new Cesium.Cartesian3();
    function updateMarkerOcclusion() {
        const camera = viewer.camera;
        if (!markerOcclusionDirty &&
            Cesium.Cartesian3.equalsEpsilon(camera.positionWC, occCamPos, Cesium.Math.EPSILON6) &&
            Cesium.Cartesian3.equalsEpsilon(camera.directionWC, occCamDir, Cesium.Math.EPSILON6)) {
            return false;   // 相机与标记都没动：这一帧不需要重算（返回值供标签布局共用）
        }
        Cesium.Cartesian3.clone(camera.positionWC, occCamPos);
        Cesium.Cartesian3.clone(camera.directionWC, occCamDir);
        markerOcclusionDirty = false;
        const mode3D = viewer.scene.mode === Cesium.SceneMode.SCENE3D;
        const cam = camera.positionWC;
        const now = Cesium.JulianDate.now();   // 每帧一个时间对象，别在实体循环里反复取
        // 只在「值真的变了」时写 ent.show：Cesium 里这是属性变更，会走 definitionChanged。
        // 聚合态下所有足迹实体本来就被隐藏，逐帧重写等于每帧几十次无谓的属性变更。
        function setVisible(ent, want) {
            if (!want) {
                if (ent.show !== false) ent.show = false;
                return;
            }
            const p = ent.position && ent.position.getValue(now);
            if (!p) {
                if (ent.show !== false) ent.show = false;
                return;
            }
            if (!mode3D) {
                if (ent.show !== true) ent.show = true;
                return;
            }
            Cesium.Cartesian3.normalize(p, occNormal);
            Cesium.Cartesian3.subtract(cam, p, occToCam);
            const visible = Cesium.Cartesian3.dot(occNormal, occToCam) > 0;   // 越过地平线即隐藏
            if (ent.show !== visible) ent.show = visible;
        }
        cityMarkerEntities.forEach(ent => setVisible(ent, cityMode));
        markerEntities.forEach(ent => setVisible(ent, !cityMode));
        return true;
    }

    // ================= 地名标签的屏幕空间避让 =================
    // Cesium 的 Entity label 不做任何自动避让，重叠就是叠字。这里自己做一次贪心布局：
    // 每个标签先试「标记下方」，放不下就按 8 个方向逐个换位（第一圈贴标记，第二圈再外推一档），
    // 两圈都放不下才隐藏。优先级按「离视口中心近」—— 用户正在看的地方先保住标签。
    function estimateLabelWidth(text) {
        let w = 0;
        for (let i = 0; i < text.length; i++) {
            w += text.charCodeAt(i) > 0xff ? LABEL_FONT_PX : LABEL_FONT_PX * 0.56;
        }
        return w;
    }
    // 标签属性只在状态真的变化时写：pixelOffset 每次赋值都会走一遍 Cesium 的属性变更
    function hideEntityLabel(ent) {
        if (!ent || !ent.label) return;
        const st = labelLayoutState.get(ent);
        if (st && !st.show) return;
        labelLayoutState.set(ent, { show: false, x: 0, y: 0 });
        ent.label.show = false;
    }
    function placeEntityLabel(ent, x, y) {
        if (!ent || !ent.label) return;
        const st = labelLayoutState.get(ent);
        if (st && st.show && st.x === x && st.y === y) return;
        labelLayoutState.set(ent, { show: true, x: x, y: y });
        ent.label.pixelOffset = new Cesium.Cartesian2(x, y);
        ent.label.show = true;
    }
    function layoutMarkerLabels() {
        if (!SHOW_CITY_LABELS && !SHOW_FOOTPRINT_LABELS) return;
        // 谁该有标签：城市名只在「聚合态 + 自动显示中国轮廓」的层级出现
        // （整球视图画面保持干净），足迹名只在展开态出现。
        // 这里也是唯一"收回"标签的地方：条件不满足就把对应的标签全部收掉——
        // 缩放回整球时轮廓先在 updateIntroVisibility 里收起，接着由这里收名字。
        const cityLabelsOn = SHOW_CITY_LABELS && cityMode && boundaryVisible && cityLabelVisible;
        const footprintLabelsOn = SHOW_FOOTPRINT_LABELS && !cityMode;
        if (!cityLabelsOn) cityMarkerEntities.forEach(hideEntityLabel);
        if (!footprintLabelsOn) markerEntities.forEach(hideEntityLabel);
        if (!cityLabelsOn && !footprintLabelsOn) return;
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const centerX = viewW / 2;
        const centerY = viewH / 2;
        const now = Cesium.JulianDate.now();
        const items = [];

        function collect(entities, size, textOf, weightOf) {
            entities.forEach((ent, i) => {
                if (!ent || !ent.show || !ent.label) return;
                const text = textOf(i);
                if (!text) return;
                const pos = ent.position && ent.position.getValue(now);
                if (!pos) { hideEntityLabel(ent); return; }
                // 用返回值而不是复用对象：不同 Cesium 版本对 result 参数的支持不完全一致
                const sp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos, labelScreen);
                if (!sp || typeof sp.x !== 'number' || typeof sp.y !== 'number') {
                    hideEntityLabel(ent);
                    return;
                }
                const sx = sp.x;
                const sy = sp.y;
                // 明显在视口外的标记直接跳过，既不做避让也不改它的标签状态
                if (sx < -80 || sy < -80 || sx > viewW + 80 || sy > viewH + 80) return;
                items.push({
                    ent: ent,
                    size: size,
                    weight: weightOf ? weightOf(i) : 1,
                    x: sx,
                    y: sy,
                    dist: Math.abs(sx - centerX) + Math.abs(sy - centerY),
                    w: estimateLabelWidth(text) + LABEL_PAD * 2,
                    h: LABEL_LINE_HEIGHT + LABEL_PAD
                });
            });
        }
        if (cityLabelsOn) {
            collect(cityMarkerEntities, CITY_MARKER_SIZE,
                i => (cityList[i] ? cityList[i].city : ''),
                i => (cityList[i] && cityList[i].indices ? cityList[i].indices.length : 1));
        } else if (footprintLabelsOn) {
            collect(markerEntities, MARKER_SIZE, i => (FOOTPRINTS[i] ? FOOTPRINTS[i].name : ''), null);
        }

        // 标记本身也是障碍：文字不压在圆点上（既挡住点，也让人分不清文字属于哪个点）。
        // 做法就是把标记矩形直接当作"已占用"塞进同一个池子 ——
        // 候选位的碰撞检测一行都不用改，一处覆盖标记与标签两类障碍。
        const markerRects = items.map(item => {
            const r = item.size * 0.42 + 2;   // 视觉圆环半径 + 一点呼吸余量
            // own 记下这个圆点属于哪条 item：检测时要跳过自己的圆点，
            // 否则"贴着圆点写"会被自己的障碍物判成碰撞，标签只能越推越远
            return { own: item, x0: item.x - r, y0: item.y - r, x1: item.x + r, y1: item.y + r };
        });
        items.sort((a, b) => (a.dist - b.dist) || (b.weight - a.weight));
        if (items.length > LABEL_MAX) items.length = LABEL_MAX;   // 只排离视口中心最近的一批
        slotBlockRects.length = 0;
        markerRects.forEach(rect => slotBlockRects.push(rect));
        // 两级放置：
        // 第一遍严格避让「其它文字 + 其它圆点」；
        // 第一遍放不下的，第二遍退一步——只避让其它文字，允许压到别的圆点边上。
        // 理由：名字被挤掉等于这个点在画面上直接"消失"，而文字压住别人圆点的一角，
        // 两条信息都还在（被压的那个点自己也有名字）。
        function tryPlace(item, avoidMarkers) {
            const half = item.size * 0.42 + LABEL_GAP;
            // 候选位：8 个方向 × 3 圈。
            // 第一圈紧贴标记（下方优先，最接近"标签跟在点后面"的默认观感），
            // 后面两圈把同一组方向整体外推 —— 点挤在一起时宁可标签离点远一点，
            // 也不要整片点都变成没有名字的圆点。
            const stepX = item.w / 2 + half;
            const stepY = item.h / 2 + half;
            for (let t = 0; t < LABEL_SLOT_RINGS.length; t++) {
                const ring = LABEL_SLOT_RINGS[t];
                for (let d = 0; d < LABEL_SLOT_DIRS.length; d++) {
                    const dir = LABEL_SLOT_DIRS[d];
                    const cx = item.x + dir.x * stepX * ring;
                    const cy = item.y + dir.y * stepY * ring;
                    const left = cx - item.w / 2;
                    const top = cy - item.h / 2;
                    const x0 = left - LABEL_PAD;
                    const y0 = top - LABEL_PAD;
                    const x1 = left + item.w + LABEL_PAD;
                    const y1 = top + item.h + LABEL_PAD;
                    if (x0 < LABEL_MARGIN || y0 < LABEL_MARGIN || x1 > viewW - LABEL_MARGIN || y1 > viewH - LABEL_MARGIN) continue;
                    let clash = false;
                    for (let k = 0; k < slotBlockRects.length; k++) {
                        const o = slotBlockRects[k];
                        if (o.own === item) continue;   // 自己的圆点不算障碍
                        if (!avoidMarkers && o.own !== undefined) continue;   // 放宽：允许压到别的圆点
                        if (x0 < o.x1 && x1 > o.x0 && y0 < o.y1 && y1 > o.y0) { clash = true; break; }
                    }
                    if (clash) continue;
                    slotBlockRects.push({ x0: x0, y0: y0, x1: x1, y1: y1 });
                    placeEntityLabel(item.ent, dir.x * stepX * ring, dir.y * stepY * ring - item.h / 2);
                    return true;
                }
            }
            return false;
        }
        const deferredLabels = [];
        items.forEach(item => { if (!tryPlace(item, true)) deferredLabels.push(item); });
        deferredLabels.forEach(item => { if (!tryPlace(item, false)) hideEntityLabel(item.ent); });
    }

    // 遮挡判定与标签避让共用一个每帧入口：遮挡函数顺带回答「相机是否动过」，
    // 相机静止又没有模式变化时整段跳过。
    function updateMarkerOverlays() {
        const cameraMoved = updateMarkerOcclusion();
        if (!cameraMoved && !markerLabelDirty) return;
        markerLabelDirty = false;
        layoutMarkerLabels();
        if (pendingMarkerAudit) {
            pendingMarkerAudit = false;
            auditMarkerRendering();
        }
    }
    viewer.scene.postRender.addEventListener(updateMarkerOverlays);
    // 窗口尺寸变化后标签要重排（视口边界变了，但相机没动，光靠相机变化判定不会触发）
    window.addEventListener('resize', () => { markerLabelDirty = true; });

    const markerPickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 判断拾取到的是单个足迹还是城市标记
    function findPickedMarker(picked) {
        if (!picked || !picked.id) return null;
        const fi = markerEntities.indexOf(picked.id);
        if (fi >= 0) return { type: 'footprint', index: fi };
        const ci = cityMarkerEntities.indexOf(picked.id);
        if (ci >= 0) return { type: 'city', index: ci };
        return null;
    }

    // 单个足迹的悬停文案：名称 · 城市（无城市则只显示名称）
    function footprintTipText(fp) {
        return fp.city ? fp.name + ' · ' + fp.city : fp.name;
    }

    // 悬停：足迹显示名称，城市显示「城市 · N 个足迹」
    // 只认「圆点本身」：标签文字与圆点同属一个实体，Cesium 拾取会把文字也算命中，
    // 于是光标划过文字也会弹提示 + 放大。这里按屏幕距离再过滤一次 ——
    // 文字总是排在圆点之外，所以只要避开图块周围这一小圈就能把它们排除掉。
    // （点击不过滤：文字是手指更容易点中的目标，点它的效果和点圆点一致。）
    const markerHitScreen = new Cesium.Cartesian2();
    function pickMarkerUnderPointer(screenPos) {
        const found = findPickedMarker(viewer.scene.pick(screenPos));
        if (!found) return null;
        const ent = found.type === 'footprint' ? markerEntities[found.index] : cityMarkerEntities[found.index];
        const world = ent && ent.position && ent.position.getValue(Cesium.JulianDate.now());
        if (!world) return null;
        const sp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, world, markerHitScreen);
        if (!sp) return null;
        const radius = (found.type === 'footprint' ? MARKER_SIZE : CITY_MARKER_SIZE) * MARKER_HIT_SLOP;
        const dx = screenPos.x - sp.x;
        const dy = screenPos.y - sp.y;
        return (dx * dx + dy * dy <= radius * radius) ? found : null;
    }

    markerPickHandler.setInputAction((movement) => {
        const found = pickMarkerUnderPointer(movement.endPosition);
        // 光标是标记「可点」的第一层暗示（尺寸放大由 setMarkerFocus 负责）
        hoveredMarker = !!found;
        // 没落在标记上时再看一眼是不是可点击的省份（几何判定，内部节流）
        hoveredProvince = !found && provinceHoverAt(movement.endPosition);
        applyCanvasCursor();
        // 在同一个标记上滑动不必反复重设气泡：写文本 + 一次坐标换算 + 两次样式写，
        // 单次都很便宜，但指针事件每秒能来上百次。只有「指向的标记变了」才动 DOM。
        const hoverKey = found ? (found.type + ':' + found.index) : '';
        if (hoverKey === hoveredMarkerKey) return;
        hoveredMarkerKey = hoverKey;
        if (found && found.type === 'footprint') {
            showMarkerTip(markerEntities[found.index], footprintTipText(FOOTPRINTS[found.index]));
        } else if (found && found.type === 'city') {
            const city = cityList[found.index];
            showMarkerTip(cityMarkerEntities[found.index], city.city + ' · ' + city.indices.length + ' 个足迹');
        } else {
            hideMarkerTip();
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // 鼠标离开画布时收起名称气泡
    viewer.scene.canvas.addEventListener('mouseleave', () => {
        hideMarkerTip();
        hoveredMarker = false;
        hoveredProvince = false;
        applyCanvasCursor();
    });

    // 点击足迹打开详情卡；点击城市标记显示城市聚合卡；点击空白处关闭
    markerPickHandler.setInputAction((movement) => {
        const found = findPickedMarker(viewer.scene.pick(movement.position));
        if (found && found.type === 'footprint') {
            const fp = FOOTPRINTS[found.index];
            // 再点同一个标记 = 收起（照片环 + 足迹卡一起收）
            if (photoRingIsOpenFor(fp)) {
                hidePhotoRing();
                hideMarkerCard();
                return;
            }
            showMarkerCard(fp, found.index);
            showPhotoRing(fp, found.index);
            return;
        }
        if (found && found.type === 'city') {
            hidePhotoRing();
            showCityCard(found.index);
            return;
        }
        // 省份：门控（3D / 桌面端 / 中国轮廓已显示 / 城市聚合态）通过才判定；
        // 命中且该省有足迹 → 每个城市一张卡片 + 一条连线；该省没有足迹 → 什么都不做。
        if (provincePickingEnabled()) {
            const info = provinceAtScreenPoint(movement.position);
            if (info) {
                openProvinceCards(info.adcode);
                return;
            }
        }
        // 点空白：逐级退 —— 正在看放大的那张时，只收起放大图（环和卡片留着）；
        // 再点一次才收环，然后是省份卡片组 / 足迹卡 / 城市卡。
        if (photoRingViewing) {
            exitPhotoRingView();
            return;
        }
        hidePhotoRing();
        if (provinceCardsActive) {
            closeProvinceCards();
            return;
        }
        if (markerCard.classList.contains('visible')) {
            hideMarkerCard();
        } else if (cityCard.classList.contains('visible')) {
            hideCityCard();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // ================= 标记键盘可达（Tab 聚焦 → Enter 打开详情卡） =================
    // 每个标记对应一个屏幕外按钮；聚焦时在球面上亮出该标记名称，
    // 键盘激活后焦点移入详情卡，关闭时再回到标记按钮。
    // 照片环开着时这些按钮只是"屏幕外待命"（见 CSS 的 body.photo-ring-open 段）：
    // 焦点一旦落上去就立刻交回环里，免得键盘用户停在一个看不见的按钮上。
    function bounceFocusIntoPhotoRing() {
        if (!photoRingActive) return false;
        const item = photoRingEls && photoRingEls.items.length
            ? photoRingEls.items.find(el => !el.classList.contains('is-slot-hidden'))
            : null;
        if (!item || !item.isConnected) return false;
        item.focus();
        return true;
    }

    function buildMarkerFocusButtons() {
        markerFocusLayer.innerHTML = '';
        if (cityMode) {
                // 城市模式：聚焦显示「城市 · N 个足迹」，Enter 打开城市聚合卡
            cityList.forEach((city, ci) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'marker-focus-btn';
                const label = city.city + ' · ' + city.indices.length + ' 个足迹';
                btn.textContent = '查看' + label;
                btn.addEventListener('focus', () => {
                    if (bounceFocusIntoPhotoRing()) return;
                    showMarkerTip(cityMarkerEntities[ci], label);
                });
                btn.addEventListener('blur', hideMarkerTip);
                btn.addEventListener('click', (e) => {
                    showCityCard(ci, e.detail === 0 ? btn : null);
                });
                markerFocusLayer.appendChild(btn);
            });
            return;
        }
        // 展开模式：单个足迹，聚焦显示名称，Enter 打开详情卡
        FOOTPRINTS.forEach((fp, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'marker-focus-btn';
            btn.textContent = '查看' + fp.name + '足迹详情';
            btn.addEventListener('focus', () => {
                if (bounceFocusIntoPhotoRing()) return;
                showMarkerTip(markerEntities[i], footprintTipText(fp));
            });
            btn.addEventListener('blur', hideMarkerTip);
            btn.addEventListener('click', (e) => {
                showMarkerCard(fp, i);
                showPhotoRing(fp, i, btn);   // 键盘路径同样出照片环（与鼠标一致）
                if (e.detail === 0) {   // 键盘激活（detail=0），鼠标点击不会跳焦点
                    lastKeyboardMarkerBtn = btn;
                    // 焦点落在照片环的第一张上：环在 DOM 里位于卡片之前，
                    // 若把焦点放在卡片关闭按钮上，正向 Tab 就再也到不了环了。
                    const ringItem = photoRingActive && photoRingEls && photoRingEls.items.length
                        ? photoRingEls.items.find(item => !item.classList.contains('is-slot-hidden'))
                        : null;
                    if (ringItem) focusWhenVisible(ringItem);
                    else document.getElementById('markerCardClose').focus();
                }
            });
            markerFocusLayer.appendChild(btn);
        });
    }
    // 初始按钮由 applyMarkerMode(true) 在标记构建后生成

    // 从足迹详情卡进入“城市图片墙”：直接使用城市卡打开的那套全屏视图，
    // 并自动选中当前足迹；关闭后还原到原来的足迹详情卡。
    function openFootprintAlbum(fp, triggerEl) {
        if (!fp) return;
        const fpIndex = FOOTPRINTS.indexOf(fp);
        if (fpIndex < 0) return;
        const cityIndex = cityList.findIndex(city => city.indices.includes(fpIndex));
        if (cityIndex < 0) return;
        const tabIndex = cityList[cityIndex].indices.indexOf(fpIndex);
        if (tabIndex < 0) return;

        // 记录关闭后要还原的足迹卡
        cityViewRestoreCard = {
            fpIndex,
            trigger: triggerEl || null
        };
        openCityView(cityIndex, null);
        cityViewTabIndex = tabIndex;
        selectCityViewTab(tabIndex);
    }

    markerCardGallery.addEventListener('click', () => {
        if (activeFootprintIndex < 0) return;
        const fp = FOOTPRINTS[activeFootprintIndex];
        if (fp) openFootprintAlbum(fp, markerCardGallery);
    });

    // ================= 图片灯箱 =================
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxCount = document.getElementById('lightboxCount');
    const lightboxCaption = document.getElementById('lightboxCaption');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxStage = document.getElementById('lightboxStage');
    const lightboxSkeleton = document.getElementById('lightboxSkeleton');
    const lightboxError = document.getElementById('lightboxError');
    const lightboxRetry = document.getElementById('lightboxRetry');
    let lightboxFp = null;
    let lightboxIndex = 0;
    let lightboxTriggerBtn = null;

    function lightboxImages() {
        return lightboxFp ? cityWallImages(lightboxFp) : [];
    }

    function loadLightboxImage(url) {
        lightboxSkeleton.hidden = false;
        lightboxError.hidden = true;
        lightboxImg.hidden = false;
        lightboxImg.onload = () => { lightboxSkeleton.hidden = true; };
        lightboxImg.onerror = () => {
            lightboxSkeleton.hidden = true;
            lightboxImg.hidden = true;
            lightboxError.hidden = false;
        };
        lightboxImg.src = url;
    }

    function preloadLightboxNeighbors() {
        const imgs = lightboxImages();
        [lightboxIndex - 1, lightboxIndex + 1].forEach(i => {
            if (i >= 0 && i < imgs.length) {
                const pre = new Image();
                pre.src = imgs[i].url;
            }
        });
    }

    function renderLightboxImage() {
        const imgs = lightboxImages();
        const img = imgs[lightboxIndex];
        const single = imgs.length <= 1;
        lightboxPrev.hidden = single;
        lightboxNext.hidden = single;
        lightboxCount.textContent = (lightboxIndex + 1) + ' / ' + imgs.length;
        lightboxCaption.textContent = img.caption ||
            (lightboxFp.name + (lightboxFp.createTime ? ' · ' + formatLightboxDate(lightboxFp.createTime) : ''));
        loadLightboxImage(img.url);
        preloadLightboxNeighbors();
    }

    function openLightbox(fp, index, triggerBtn) {
        lightboxFp = fp;
        lightboxIndex = index;
        lightboxTriggerBtn = triggerBtn || null;
        lightbox.classList.add('show');
        setOverlayHidden(lightbox, false);
        document.getElementById('lightboxClose').focus();
        renderLightboxImage();
    }

    function closeLightbox(returnFocus = true) {
        lightbox.classList.remove('show');
        setOverlayHidden(lightbox, true);
        lightboxImg.onload = null;
        lightboxImg.onerror = null;
        lightboxImg.removeAttribute('src');
        if (returnFocus && lightboxTriggerBtn) {
            lightboxTriggerBtn.focus();   // 焦点还给触发它的图片按钮
        }
        lightboxTriggerBtn = null;
        lightboxFp = null;
    }

    function switchLightbox(delta) {
        const imgs = lightboxImages();
        if (imgs.length < 2) return;
        lightboxIndex = (lightboxIndex + delta + imgs.length) % imgs.length;
        renderLightboxImage();
    }

    lightboxPrev.addEventListener('click', () => switchLightbox(-1));
    lightboxNext.addEventListener('click', () => switchLightbox(1));
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
    lightboxRetry.addEventListener('click', () => {
        const imgs = lightboxImages();
        if (imgs[lightboxIndex]) loadLightboxImage(imgs[lightboxIndex].url);
    });
    // 点击灯箱背景（图片之外）关闭
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target === lightboxStage) closeLightbox();
    });
    // 触屏左右滑动切换
    let lightboxTouchX = null;
    lightbox.addEventListener('touchstart', (e) => {
        lightboxTouchX = e.touches[0].clientX;
    }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
        if (lightboxTouchX === null) return;
        const dx = e.changedTouches[0].clientX - lightboxTouchX;
        if (Math.abs(dx) > 40) switchLightbox(dx < 0 ? 1 : -1);
        lightboxTouchX = null;
    }, { passive: true });

    // ================= 城市足迹全屏视图（左侧足迹 Tab 卡片 + 右侧详情） =================
    const cityView = document.getElementById('cityView');
    const cityViewBack = document.getElementById('cityViewBack');
    const cityViewBackLabel = document.getElementById('cityViewBackLabel');
    const cityViewTitle = document.getElementById('cityViewTitle');
    const cityViewCityList = document.getElementById('cityViewCityList');
    const cityViewStats = document.getElementById('cityViewStats');
    const cityViewTimeline = document.getElementById('cityViewTimeline');
    const cityViewTimelineList = document.getElementById('cityViewTimelineList');
    const cityViewTimelineToggle = document.getElementById('cityViewTimelineToggle');
    const cityViewTimelineCount = document.getElementById('cityViewTimelineCount');
    const cityViewMeta = document.getElementById('cityViewMeta');
    const cityViewTickets = document.getElementById('cityViewTickets');
    const cityViewPrevCity = document.getElementById('cityViewPrevCity');
    const cityViewNextCity = document.getElementById('cityViewNextCity');
    const cityTabs = document.getElementById('cityTabs');
    const cityStage = document.getElementById('cityStage');
    let cityStageObserver = null;   // 手账照片墙滚动到底自动加载的观察器
    let cityViewCityIndex = -1;      // 当前城市（cityList 下标）
    let cityViewTabIndex = 0;        // 当前选中的足迹 Tab
    let cityViewTriggerBtn = null;   // 键盘触发时的返回焦点按钮
    let cityViewRestoreCard = null;  // 从足迹卡进入城市图片墙时，关闭后要还原的足迹卡
    let cityViewFromWall = false;    // 当前图片墙是否从城市卡片墙展开（返回时回到卡片墙）

    function cityViewFootprints() {
        const city = cityList[cityViewCityIndex];
        return city ? city.indices.map(i => FOOTPRINTS[i]).filter(Boolean) : [];
    }
    function cityWallImages(fp) {
        let gallery = fp && fp.galleryImages;
        if (typeof gallery === 'string') {
            try { gallery = JSON.parse(gallery); } catch (e) { gallery = []; }
        }
        const normalized = Array.isArray(gallery)
            ? gallery.map((item) => typeof item === 'string' ? { url: item, caption: '' } : item).filter(item => item && item.url)
            : [];
        return normalized.length ? normalized : (fp.image ? [{ url: fp.image, caption: '' }] : []);
    }

    function formatCityDate(value) {
        const match = String(value || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (!match) return String(value || '日期未知');
        return match[1] + ' / ' + String(match[2]).padStart(2, '0') + '.' + String(match[3]).padStart(2, '0');
    }

    // ================= 卡片封面（小城市卡与城市卡共用） =================
    // 三件事：
    // 1) 首字常驻做底，图片加载成功后淡入盖上去 —— 加载慢或失败都只是"还没盖上"，
    //    不会出现空白，也不会有"先空着再突然出现"的跳动；
    // 2) 封面走 new Image() 预加载 + 并发限流（同时 3 张），不和底图瓦片抢带宽；
    // 3) 失败延迟重试一次，仍失败就停在首字（小卡片按约定不放重试按钮）。
    const CARD_COVER_CONCURRENCY = 3;
    const CARD_COVER_RETRY_MS = 3000;          // 第一次失败后的静默重试延迟
    const CARD_COVER_FAIL_TTL_MS = 60000;      // 失败结论只记一分钟，过一会儿再点还会重新试
    const cardCoverQueue = [];
    const cardCoverResult = new Map();         // url -> { ok, at }
    const cardCoverRetried = new Set();        // url -> 已经重试过一次
    let cardCoverLoading = 0;
    let cardCoverSeq = 0;

    function cachedCardCover(url) {
        const hit = cardCoverResult.get(url);
        if (!hit) return null;
        if (hit.ok) return hit;
        return (Date.now() - hit.at < CARD_COVER_FAIL_TTL_MS) ? hit : null;
    }

    function drainCardCoverQueue() {
        while (cardCoverLoading < CARD_COVER_CONCURRENCY && cardCoverQueue.length) {
            const job = cardCoverQueue.shift();
            cardCoverLoading++;
            startCardCoverLoad(job);
        }
    }

    function startCardCoverLoad(job) {
        const release = () => {
            cardCoverLoading--;
            drainCardCoverQueue();
        };
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
            cardCoverResult.set(job.url, {
                ok: true,
                at: Date.now(),
                width: img.naturalWidth,
                height: img.naturalHeight
            });
            // 顺带回传图片原始尺寸：照片环要按实际宽高比排版（其余调用方忽略这个参数）
            job.done(true, { width: img.naturalWidth, height: img.naturalHeight });
            release();
        };
        img.onerror = () => {
            if (job.retry !== false && !cardCoverRetried.has(job.url)) {
                // 图床偶发 502 很常见：先放掉并发名额，延迟一段时间静默重试一次
                cardCoverRetried.add(job.url);
                release();
                window.setTimeout(() => {
                    cardCoverQueue.push(job);
                    drainCardCoverQueue();
                }, CARD_COVER_RETRY_MS);
                return;
            }
            cardCoverResult.set(job.url, { ok: false, at: Date.now() });
            job.done(false);
            release();
        };
        img.src = job.url;
    }

    function loadCardCoverImage(url, done, options) {
        const opts = options || {};
        const cached = opts.force ? null : cachedCardCover(url);
        if (cached) {
            // 命中缓存直接出结果，不重复请求；把图片原始尺寸一并带出去（照片环要用）。
            // 必须异步回调：调用方有可能在"元素创建之后、插入 DOM 之前"就调用这里
            // （照片环就是这样），同步回调会让它们的 isConnected 守卫把结果丢掉 ——
            // 表现就是"第一次打开图片正常，关掉再点同一个标记，一圈方框全空"。
            Promise.resolve().then(() => {
                done(!!cached.ok, cached.ok ? { width: cached.width, height: cached.height } : undefined);
            });
            return;
        }
        cardCoverQueue.push({ url: url, done: done, retry: opts.retry !== false });
        drainCardCoverQueue();
    }

    /**
     * 在媒体区里画好"首字 + 空的图片层"，返回一个待排队的加载请求（没有封面时返回 null）。
     *
     * <p>拆成"画结构"和"排队加载"两步，是为了让调用方按自己的顺序（比如展开动画的错峰顺序）
     * 决定谁先加载 —— 先飞出来的卡片先拿到封面。</p>
     */
    function renderCardCover(container, url, monogram) {
        if (!container) return null;
        const token = String(++cardCoverSeq);
        container.dataset.coverToken = token;
        container.innerHTML = '';
        const mono = document.createElement('span');
        mono.className = 'card-cover-monogram';
        mono.textContent = monogram || '?';
        container.appendChild(mono);
        if (!url) return null;   // 没有封面：就停在首字
        const photo = document.createElement('span');
        photo.className = 'card-cover-photo';
        container.appendChild(photo);
        return { url: url, container: container, token: token, photo: photo };
    }

    function enqueueCardCover(request) {
        if (!request || !request.photo) return;
        loadCardCoverImage(request.url, (ok) => {
            if (!ok) return;                                        // 失败：保持首字
            if (request.container.dataset.coverToken !== request.token) return;   // 已被新的封面取代
            if (!request.container.isConnected) return;             // 卡片已经收起来了
            request.photo.style.backgroundImage = 'url("' + request.url + '")';
            request.photo.classList.add('is-loaded');
        });
    }

    // 一步到位版：画结构 + 立刻排队（城市卡这种单张卡片用）
    function showCardCover(container, url, monogram) {
        enqueueCardCover(renderCardCover(container, url, monogram));
    }

    // 灯箱下方的时间日期：YYYY-MM-DD HH:MM（无时间部分时只显示日期）
    function formatLightboxDate(value) {
        const match = String(value || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
        if (!match) return String(value || '日期未知');
        const date = match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
        return match[4] ? date + ' ' + String(match[4]).padStart(2, '0') + ':' + match[5] : date;
    }

    function cleanupCityStageAutoLoad() {
        if (cityStageObserver) {
            cityStageObserver.disconnect();
            cityStageObserver = null;
        }
    }

    function renderCityStage(fp, photoLimit = 8, preserveScroll = false) {
        cleanupCityStageAutoLoad();
        const imgs = cityWallImages(fp);
        const prevScrollTop = preserveScroll ? cityStage.scrollTop : 0;
        const content = document.createElement('div');
        content.className = 'city-stage-content';
        content.style.setProperty('--extra-height', Math.max(0, Math.ceil((imgs.length - 4) / 4)) * 188 + 'px');

        const hero = document.createElement('button');
        hero.type = 'button';
        hero.className = 'city-fp-hero';
        hero.setAttribute('aria-label', fp.name + ' · 查看第 1 张照片');
        if (imgs[0]) hero.style.backgroundImage = 'url("' + imgs[0].url + '")';
        const heroBody = document.createElement('div');
        heroBody.className = 'city-fp-hero-body';
        const eyebrow = document.createElement('p');
        eyebrow.className = 'city-fp-eyebrow';
        eyebrow.textContent = 'Footprint · ' + (fp.footprintType || '旅行');
        const name = document.createElement('h3');
        name.className = 'city-fp-name';
        name.textContent = fp.name;
        const meta = document.createElement('p');
        meta.className = 'city-fp-meta';
        meta.textContent = [fp.city, fp.createTime, fp.address].filter(Boolean).join(' · ');
        heroBody.append(eyebrow, name, meta);
        hero.appendChild(heroBody);
        if (imgs[0]) {
            hero.addEventListener('click', () => openLightbox(fp, 0, hero));
            hero.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openLightbox(fp, 0, hero);
                }
            });
        }
        content.appendChild(hero);

        if (fp.description) {
            const desc = document.createElement('p');
            desc.className = 'city-fp-desc';
            desc.textContent = fp.description;
            content.appendChild(desc);
        }

        const wall = document.createElement('div');
        wall.className = 'city-fp-wall';
        if (imgs.length) {
            imgs.forEach((img, idx) => {
                const tile = document.createElement('button');
                tile.type = 'button';
                tile.className = 'city-wall-tile';
                if (idx >= 4) {
                    const extraIndex = idx - 4;
                    const extraColumn = extraIndex % 4;
                    const extraRow = Math.floor(extraIndex / 4);
                    tile.classList.add('city-wall-tile-extra');
                    tile.style.setProperty('--extra-left', (8 + extraColumn * 23) + '%');
                    tile.style.setProperty('--extra-top', (650 + extraRow * 188) + 'px');
                }
                tile.setAttribute('aria-label', fp.name + ' · 第 ' + (idx + 1) + ' 张');
                const photo = document.createElement('img');
                photo.loading = 'lazy';
                photo.src = img.url;
                photo.alt = img.caption || fp.name;
                tile.appendChild(photo);
                tile.addEventListener('click', () => openLightbox(fp, idx, tile));
                wall.appendChild(tile);
            });
            if (imgs.length > 5) {
                const overflowNote = document.createElement('span');
                overflowNote.className = 'city-wall-overflow-note';
                overflowNote.textContent = '共 ' + imgs.length + ' 张照片 · 主图与卡片均可点击放大';
                wall.appendChild(overflowNote);
            }
        } else {
            const empty = document.createElement('div');
            empty.className = 'city-wall-empty';
            empty.textContent = '暂无照片';
            wall.appendChild(empty);
        }
        content.appendChild(wall);

        const mapWall = document.createElement('div');
        mapWall.className = 'city-map-wall';
        const mapCanvas = document.createElement('div');
        mapCanvas.className = 'city-map-canvas';
        const mapRoute = document.createElement('span');
        mapRoute.className = 'city-map-route';
        const mapCore = document.createElement('div');
        mapCore.className = 'city-map-core';
        const mapCoreKicker = document.createElement('span');
        mapCoreKicker.className = 'city-map-core-kicker';
        mapCoreKicker.textContent = 'LOCATION MAP';
        const mapCoreTitle = document.createElement('strong');
        mapCoreTitle.textContent = fp.city || fp.name;
        const mapCoreMeta = document.createElement('small');
        mapCoreMeta.textContent = [fp.lat && fp.lat.toFixed ? fp.lat.toFixed(4) : '', fp.lng && fp.lng.toFixed ? fp.lng.toFixed(4) : ''].filter(Boolean).join('  /  ');
        mapCore.append(mapCoreKicker, mapCoreTitle, mapCoreMeta);
        mapCanvas.append(mapRoute, mapCore);
        const orbitSlots = [
            [4, 10], [25, 4], [61, 4], [83, 10],
            [4, 54], [25, 68], [61, 68], [83, 54]
        ];
        const extraCount = Math.max(0, imgs.length - orbitSlots.length);
        const extraRows = Math.ceil(extraCount / 5);
        mapCanvas.style.height = (900 + extraRows * 190) + 'px';
        imgs.forEach((img, idx) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'city-map-photo';
            const slot = orbitSlots[idx];
            if (slot) {
                card.style.left = slot[0] + '%';
                card.style.top = slot[1] + '%';
            } else {
                const extraIndex = idx - orbitSlots.length;
                card.style.left = (4 + (extraIndex % 5) * 21) + '%';
                card.style.top = (900 + Math.floor(extraIndex / 5) * 190) + 'px';
                card.classList.add('city-map-photo-extra');
            }
            const cardX = slot ? slot[0] : 4 + ((idx - orbitSlots.length) % 5) * 21;
            const cardY = slot ? slot[1] : 900;
            card.style.setProperty('--line-angle', Math.atan2(50 - cardY, 50 - cardX) * 180 / Math.PI + 'deg');
            card.setAttribute('aria-label', fp.name + ' · 地图照片 ' + (idx + 1));
            const connector = document.createElement('span');
            connector.className = 'city-map-connector';
            const pin = document.createElement('span');
            pin.className = 'city-map-pin';
            const photo = document.createElement('img');
            photo.loading = 'lazy';
            photo.src = img.url;
            photo.alt = img.caption || fp.name;
            card.append(connector, pin, photo);
            card.addEventListener('click', () => openLightbox(fp, idx, card));
            mapCanvas.appendChild(card);
        });
        mapWall.appendChild(mapCanvas);
        content.appendChild(mapWall);

        const journal = document.createElement('section');
        journal.className = 'city-journal-wall';
        const journalHead = document.createElement('header');
        journalHead.className = 'city-journal-head';
        const journalKicker = document.createElement('span');
        journalKicker.className = 'city-journal-kicker';
        journalKicker.textContent = 'TRAVEL JOURNAL';
        const journalTitle = document.createElement('h3');
        journalTitle.textContent = fp.name;
        const journalDate = document.createElement('time');
        journalDate.textContent = formatCityDate(fp.createTime);
        const journalCount = document.createElement('span');
        journalCount.className = 'city-journal-count';
        journalCount.textContent = imgs.length + ' 张照片';
        journalHead.append(journalKicker, journalTitle, journalDate, journalCount);
        journal.appendChild(journalHead);

        if (fp.description) {
            const journalDesc = document.createElement('p');
            journalDesc.className = 'city-journal-description';
            journalDesc.textContent = fp.description;
            journal.appendChild(journalDesc);
        }

        const journalGrid = document.createElement('div');
        journalGrid.className = 'city-journal-grid';
        const visibleImages = imgs.slice(0, Math.max(1, photoLimit));
        visibleImages.forEach((img, idx) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'city-journal-card';
            card.classList.add('is-loading');
            card.setAttribute('aria-label', fp.name + ' · 第 ' + (idx + 1) + ' 张');
            const photo = document.createElement('img');
            photo.loading = idx < 4 ? 'eager' : 'lazy';
            photo.src = img.url;
            photo.alt = img.caption || fp.name;
            card.appendChild(photo);
            photo.addEventListener('load', () => {
                card.classList.remove('is-loading', 'is-error');
            });
            photo.addEventListener('error', () => {
                card.classList.remove('is-loading');
                card.classList.add('is-error');
            });
            if (photo.complete) {
                if (photo.naturalWidth > 0) {
                    card.classList.remove('is-loading');
                } else {
                    card.classList.remove('is-loading');
                    card.classList.add('is-error');
                }
            }
            if (img.caption) {
                const caption = document.createElement('span');
                caption.className = 'city-journal-caption';
                caption.textContent = img.caption;
                card.appendChild(caption);
            }
            card.addEventListener('click', () => openLightbox(fp, idx, card));
            journalGrid.appendChild(card);
        });
        if (!imgs.length) {
            const empty = document.createElement('div');
            empty.className = 'city-journal-empty';
            empty.textContent = '暂无照片';
            journalGrid.appendChild(empty);
        }
        journal.appendChild(journalGrid);

        if (imgs.length > visibleImages.length) {
            // 滚动到此处附近时自动加载下一批，不再需要手动点击
            const sentinel = document.createElement('div');
            sentinel.className = 'city-journal-more city-journal-more-auto';
            sentinel.setAttribute('role', 'status');
            sentinel.textContent = '已加载 ' + visibleImages.length + ' / ' + imgs.length + ' 张 · 继续向下自动加载';
            journal.appendChild(sentinel);
        }
        content.appendChild(journal);

        cityStage.innerHTML = '';
        cityStage.appendChild(content);
        cityStage.scrollTop = preserveScroll ? prevScrollTop : 0;

        // 观察加载哨兵：靠近底部时再渲染下一批。
        // 延迟到下一帧再开始观察，避免刚设置 scrollTop=0 时误判为已到达底部。
        if (imgs.length > visibleImages.length && 'IntersectionObserver' in window) {
            const nextLimit = Math.min(visibleImages.length + 8, imgs.length);
            requestAnimationFrame(() => {
                const sentinel = cityStage.querySelector('.city-journal-more-auto');
                if (!sentinel || !sentinel.isConnected) return;
                cityStageObserver = new IntersectionObserver(entries => {
                    if (entries.some(entry => entry.isIntersecting)) {
                        cleanupCityStageAutoLoad();
                        renderCityStage(fp, nextLimit, true);
                    }
                }, {
                    root: cityStage,
                    rootMargin: '0px 0px 180px 0px',
                    threshold: 0.01
                });
                cityStageObserver.observe(sentinel);
            });
        }
    }

    function selectCityViewTab(i) {
        const fps = cityViewFootprints();
        if (!fps.length) return;
        cityViewTabIndex = Math.max(0, Math.min(i, fps.length - 1));
        [...cityTabs.querySelectorAll('.city-tab')].forEach((t, k) => {
            const active = k === cityViewTabIndex;
            t.classList.toggle('active', active);
            t.setAttribute('aria-selected', String(active));
        });
        // 时间线跟着高亮当前那一站
        if (cityViewTimelineList) {
            cityViewTimelineList.querySelectorAll('.city-view-timeline-item').forEach(el => {
                el.classList.toggle('is-active', el.dataset.tabIndex === String(cityViewTabIndex));
            });
        }
        renderCityStage(fps[cityViewTabIndex]);
    }

    // 到访时间线：把"第几次来、隔了多久"讲清楚。
    // 只有一次到访也显示（就一条"第 1 次"），否则用户会以为这个功能没生效
    // 「到访」和「看这座城市的票根」都不显示时，整条操作行收起来，别在标题下留一条空行
    function syncCityViewMeta() {
        if (!cityViewMeta) return;
        const hasTimeline = cityViewTimeline && !cityViewTimeline.hidden;
        const hasTickets = cityViewTickets && !cityViewTickets.hidden;
        cityViewMeta.hidden = !hasTimeline && !hasTickets;
    }

    // 手机端到访折成一颗胶囊，点开才展开那一排；桌面端这颗按钮由 CSS 隐藏
    function setCityViewTimelineExpanded(expanded) {
        if (!cityViewTimeline) return;
        cityViewTimeline.classList.toggle('is-expanded', !!expanded);
        if (!cityViewTimelineToggle) return;
        const count = cityViewTimelineList ? cityViewTimelineList.children.length : 0;
        cityViewTimelineToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        cityViewTimelineToggle.setAttribute('aria-label',
            (expanded ? '收起到访记录' : '展开到访记录') + '，共 ' + count + ' 次');
    }

    function renderCityViewTimeline(fps) {
        if (!cityViewTimeline || !cityViewTimelineList) return;
        cityViewTimelineList.innerHTML = '';
        const visits = fps
            .map((fp, i) => ({ fp, i, time: String(fp.createTime || '') }))
            .filter(visit => visit.time)
            .sort((a, b) => a.time.localeCompare(b.time));
        if (!visits.length) {
            cityViewTimeline.hidden = true;
            setCityViewTimelineExpanded(false);
            syncCityViewMeta();
            return;
        }
        visits.forEach((visit, n) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'city-view-timeline-item' + (visit.i === cityViewTabIndex ? ' is-active' : '');
            btn.dataset.tabIndex = String(visit.i);
            const order = document.createElement('b');
            order.textContent = '第 ' + (n + 1) + ' 次';
            const date = document.createElement('span');
            date.textContent = visit.time.slice(0, 10).replace(/-/g, '.');
            btn.append(order, date);
            if (n > 0) {
                const days = Math.round(
                    (new Date(visit.time).getTime() - new Date(visits[n - 1].time).getTime()) / 86400000
                );
                if (days >= 0) {
                    const gap = document.createElement('em');
                    gap.textContent = '隔 ' + days.toLocaleString('zh-CN') + ' 天';
                    btn.appendChild(gap);
                }
            }
            btn.setAttribute('aria-label',
                '第 ' + (n + 1) + ' 次到访 ' + visit.fp.name + '，' + date.textContent);
            btn.addEventListener('click', () => selectCityViewTab(visit.i));
            li.appendChild(btn);
            cityViewTimelineList.appendChild(li);
        });
        cityViewTimeline.hidden = false;
        if (cityViewTimelineCount) cityViewTimelineCount.textContent = String(visits.length);
        // 换城市时收起，避免上一个城市的展开状态残留
        setCityViewTimelineExpanded(false);
        syncCityViewMeta();
    }

    function renderCityView() {
        const fps = cityViewFootprints();
        cityTabs.innerHTML = '';
        cityStage.innerHTML = '';
        if (cityViewTimeline) cityViewTimeline.hidden = true;
        if (cityViewTimelineList) cityViewTimelineList.innerHTML = '';
        if (cityViewTickets) cityViewTickets.hidden = true;
        syncCityViewMeta();
        if (!fps.length) return;
        const city = cityList[cityViewCityIndex];
        const photoCount = fps.reduce((n, fp) => n + cityWallImages(fp).length, 0);
        cityViewTitle.textContent = city.city;
        cityViewStats.textContent = fps.length + ' 个足迹 · ' + photoCount + ' 张照片';
        // 这座城市有票根时，给一个键盘也能到达的入口（卡片上的徽章只能鼠标点）
        if (cityViewTickets) {
            const ticketCount = fps.reduce((n, fp) => n + (ticketImageUrl(fp.ticketImage) ? 1 : 0), 0);
            cityViewTickets.hidden = !ticketCount;
            cityViewTickets.textContent = ticketCount
                ? '看这座城市的 ' + ticketCount + ' 张票根'
                : '看这座城市的票根';
        }
        renderCityViewTimeline(fps);

        fps.forEach((fp, i) => {
            const imgs = cityWallImages(fp);
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'city-tab';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', 'false');
            tab.setAttribute('aria-label', fp.name + '，' + (imgs.length || 0) + ' 张照片');
            const order = document.createElement('span');
            order.className = 'city-tab-index';
            order.textContent = String(i + 1).padStart(2, '0');
            const thumbWrap = document.createElement('span');
            thumbWrap.className = 'city-tab-thumb';
            if (imgs[0]) {
                thumbWrap.classList.add('is-loading');
                const th = document.createElement('img');
                th.loading = 'lazy';
                th.src = imgs[0].url;
                th.alt = '';
                thumbWrap.appendChild(th);
                th.addEventListener('load', () => {
                    thumbWrap.classList.remove('is-loading', 'is-error');
                });
                th.addEventListener('error', () => {
                    thumbWrap.classList.remove('is-loading');
                    thumbWrap.classList.add('is-error');
                });
                if (th.complete) {
                    if (th.naturalWidth > 0) {
                        thumbWrap.classList.remove('is-loading');
                    } else {
                        thumbWrap.classList.remove('is-loading');
                        thumbWrap.classList.add('is-error');
                    }
                }
            } else {
                thumbWrap.classList.add('is-empty');
            }
            const info = document.createElement('span');
            info.className = 'city-tab-info';
            const tName = document.createElement('span');
            tName.className = 'city-tab-name';
            tName.textContent = fp.name;
            const tMeta = document.createElement('span');
            tMeta.className = 'city-tab-meta';
            const tDate = document.createElement('span');
            tDate.className = 'city-tab-date';
            tDate.textContent = formatCityDate(fp.createTime);
            const tPhotos = document.createElement('span');
            tPhotos.className = 'city-tab-photos';
            tPhotos.textContent = imgs.length ? imgs.length + ' 张照片' : '暂无照片';
            tMeta.append(tDate, tPhotos);
            info.append(tName, tMeta);
            tab.append(order, thumbWrap, info);
            tab.addEventListener('click', () => selectCityViewTab(i));
            cityTabs.appendChild(tab);
        });
        cityViewTabIndex = Math.min(cityViewTabIndex, fps.length - 1);
        selectCityViewTab(cityViewTabIndex);
    }

    function switchCityViewCity(delta) {
        if (cityList.length < 2) return;
        cityViewCityIndex = (cityViewCityIndex + delta + cityList.length) % cityList.length;
        cityViewTabIndex = 0;
        renderCityView();
    }

    // —— 顶部城市列表（下拉选择器）——
    function cityListMeta(ci) {
        const city = cityList[ci];
        if (!city) return { count: 0, photos: 0 };
        const photos = city.indices.reduce(
            (n, fi) => n + cityWallImages(FOOTPRINTS[fi]).length, 0
        );
        return { count: city.indices.length, photos };
    }

    function goToCityViewCity(ci) {
        if (!cityList[ci] || ci === cityViewCityIndex) return;
        cityViewCityIndex = ci;
        cityViewTabIndex = 0;
        renderCityView();
    }

    function renderCitySwitcher() {
        if (!cityViewCityList) return;
        cityViewCityList.innerHTML = '';
        cityList.forEach((city, ci) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'city-view-city-option' + (ci === cityViewCityIndex ? ' is-current' : '');
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', String(ci === cityViewCityIndex));
            const meta = cityListMeta(ci);
            const nameEl = document.createElement('span');
            nameEl.className = 'city-view-city-option-name';
            nameEl.textContent = city.city;
            const countEl = document.createElement('span');
            countEl.className = 'city-view-city-option-count';
            countEl.textContent = meta.count + ' 个足迹 · ' + meta.photos + ' 张照片';
            btn.append(nameEl, countEl);
            btn.addEventListener('click', () => {
                goToCityViewCity(ci);
                closeCitySwitcher();
            });
            cityViewCityList.appendChild(btn);
        });
    }

    function openCitySwitcher() {
        if (!cityViewCityList) return;
        renderCitySwitcher();
        cityViewCityList.hidden = false;
        cityViewTitle.setAttribute('aria-expanded', 'true');
        const current = cityViewCityList.querySelector('.is-current') || cityViewCityList.firstElementChild;
        if (current) current.focus();
    }

    function closeCitySwitcher(returnFocus = false) {
        if (!cityViewCityList || cityViewCityList.hidden) return;
        cityViewCityList.hidden = true;
        cityViewTitle.setAttribute('aria-expanded', 'false');
        if (returnFocus) cityViewTitle.focus();
    }

    function toggleCitySwitcher() {
        if (cityViewCityList && cityViewCityList.hidden) openCitySwitcher();
        else closeCitySwitcher(true);
    }

    // 关闭全屏视图，飞到该足迹在地球上的位置（不打开详情卡）
    function flyToCityFootprint(fp) {
        const idx = FOOTPRINTS.indexOf(fp);
        closeCityView(false);
        if (idx < 0) return;
        const pos = currentPositions[idx];
        if (pos) {
            const height = fp.zoomLevel
                ? (156543.03392 * Math.cos(Cesium.Math.toRadians(pos.lat))) / Math.pow(2, fp.zoomLevel) * 1000
                : 120000;
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, height),
                duration: 2.2
            });
        }
    }

    function openCityView(ci, triggerBtn) {
        if (!cityList[ci]) return;
        // 两级浏览：从卡片墙进入时保持卡片墙在下一层，返回按钮文案切换为“返回城市墙”
        const fromWall = !!(cityWall && cityWall.classList.contains('show'));
        cityViewFromWall = fromWall;
        if (fromWall) {
            if (cityViewBackLabel) cityViewBackLabel.textContent = '返回城市墙';
            cityViewBack.setAttribute('aria-label', '返回城市墙');
        } else {
            if (cityViewBackLabel) cityViewBackLabel.textContent = '返回地球';
            cityViewBack.setAttribute('aria-label', '返回地球');
        }
        // 城市图片墙为不透明全屏层，先暂停地球渲染循环，释放主线程/合成带宽
        setGlobeRenderLoop(false);
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        if (cityCard.classList.contains('visible')) hideCityCard(false);
        hideMarkerTip();
        cityViewCityIndex = ci;
        cityViewTabIndex = 0;
        cityViewTriggerBtn = triggerBtn || null;
        renderCityView();
        cityView.classList.add('show');
        setOverlayHidden(cityView, false);
        // 城市图片墙打开时直接隐藏顶部导航，不依赖相机事件（渲染循环暂停时相机事件不会触发）
        document.body.classList.add('city-view-open');
        // 触屏不自动回焦，避免“返回地球”出现焦点描边；
        // 注意 .show 刚加上时整层还是 visibility: hidden（离散过渡约在 130ms 后才翻转），
        // 此时直接 focus() 会被浏览器忽略，键盘用户会停在原来的按钮上，所以要等它真的可见
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            focusCityViewBackWhenVisible();
        }
    }

    let cityViewFocusRaf = 0;
    function focusCityViewBackWhenVisible() {
        cancelAnimationFrame(cityViewFocusRaf);
        const tick = () => {
            if (!cityView.classList.contains('show')) return;   // 已经关掉就别再抢焦点
            if (getComputedStyle(cityViewBack).visibility === 'hidden') {
                cityViewFocusRaf = requestAnimationFrame(tick);
                return;
            }
            cityViewBack.focus();
        };
        cityViewFocusRaf = requestAnimationFrame(tick);
    }

    function closeCityView(returnFocus = true) {
        cancelAnimationFrame(cityViewFocusRaf);
        const fromWall = cityViewFromWall;
        cityViewFromWall = false;
        if (lightbox.classList.contains('show')) closeLightbox(false);
        cityView.classList.remove('show');
        setOverlayHidden(cityView, true);
        document.body.classList.remove('city-view-open');
        // 回到卡片墙时地球仍暂停；只有真正回到地球才恢复渲染
        if (!fromWall || !(cityWall && cityWall.classList.contains('show'))) {
            setGlobeRenderLoop(true);
        }
        closeCitySwitcher();
        const restore = cityViewRestoreCard;
        cityViewRestoreCard = null;
        // 省份城市卡片：从卡片进相册前记录过，回到地球后原样重建（相机没动，不需要额外状态）
        const provinceRestore = provinceRestorePending;
        provinceRestorePending = null;
        if (provinceRestore && !fromWall && cityCardsEnabled()) {
            if (provinceRestore.mode === 'all') activateAllCityCards();
            else activateProvinceCards(provinceRestore.adcode);
        }
        if (returnFocus) {
            if (fromWall && cityWall && cityWall.classList.contains('show')) {
                // 等图片墙淡出后把焦点还给卡片墙的返回按钮
                setTimeout(() => {
                    if (cityWallBack && cityWallBack.isConnected &&
                        cityWall.classList.contains('show')) {
                        cityWallBack.focus();
                    }
                }, 280);
                return;
            }
            if (restore) {
                const fp = FOOTPRINTS[restore.fpIndex];
                if (fp) {
                    showMarkerCard(fp, restore.fpIndex);
                    const target = restore.trigger && restore.trigger.isConnected
                        ? restore.trigger
                        : markerCardGallery;
                    if (target) {
                        // 等卡片可见过渡结束后再回焦，避免焦点落在仍不可见的容器里
                        setTimeout(() => { if (target.isConnected) target.focus(); }, 480);
                    }
                }
            } else if (cityViewTriggerBtn) {
                cityViewTriggerBtn.focus();
                cityViewTriggerBtn = null;
            }
        }
    }

    cityViewBack.addEventListener('click', () => closeCityView());
    if (cityViewTimelineToggle) {
        cityViewTimelineToggle.addEventListener('click', () => {
            setCityViewTimelineExpanded(!cityViewTimeline.classList.contains('is-expanded'));
        });
    }
    cityViewTickets.addEventListener('click', () => {
        if (cityViewCityIndex >= 0) openTicketGalleryForCity(cityViewCityIndex);
    });
    cityViewPrevCity.addEventListener('click', () => switchCityViewCity(-1));
    cityViewNextCity.addEventListener('click', () => switchCityViewCity(1));
    cityView.addEventListener('click', (e) => {
        if (e.target === cityView) closeCityView();
    });
    // 城市名可点击：展开城市下拉列表
    cityViewTitle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCitySwitcher();
    });
    cityViewCityList.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
        if (cityView.classList.contains('show') &&
            cityViewCityList && !cityViewCityList.hidden &&
            !e.target.closest('.city-view-head')) {
            closeCitySwitcher();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (cityViewCityList && !cityViewCityList.hidden && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeCitySwitcher(true);
        }
    }, true);
    // Tab 列表内用 ↑ / ↓ 切换足迹
    cityTabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const fps = cityViewFootprints();
        if (fps.length < 2) return;
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        selectCityViewTab((cityViewTabIndex + d + fps.length) % fps.length);
        const tabs = [...cityTabs.querySelectorAll('.city-tab')];
        if (tabs[cityViewTabIndex]) tabs[cityViewTabIndex].focus();
    });

    // ================= 城市卡片墙（城市总览目录） =================
    // 与城市图片墙共用 FOOTPRINTS / cityList：卡片点击后直接进入现有 openCityView，
    // 不做重复的城市详情实现。卡片按“最近去过时间”倒序排列。
    const cityWall = document.getElementById('cityWall');
    const cityWallBtn = document.getElementById('cityWallBtn');
    const cityWallBack = document.getElementById('cityWallBack');
    const cityWallTitle = document.getElementById('cityWallTitle');
    const cityWallStats = document.getElementById('cityWallStats');
    const cityWallGrid = document.getElementById('cityWallGrid');
    const cityWallEmpty = document.getElementById('cityWallEmpty');
    const cityWallBody = document.getElementById('cityWallBody');
    const cityWallTimeCapsuleBtn = document.getElementById('cityWallTimeCapsuleBtn');
    const cityWallInsightBtn = document.getElementById('cityWallInsightBtn');
    const cityWallProvinceFilter = document.getElementById('cityWallProvinceFilter');
    // 只看某个省（从足迹洞察的省份排行点进来）；关闭卡片墙时自动清掉
    let cityWallProvinceFilterName = '';

    // 4 个创意功能的开关统一从后台 globe3d 设置读取（默认开启）
    function featureEnabled(key) {
        const value = footprintCfg && footprintCfg[key];
        return value !== false;
    }

    // 城市卡片封面缩略：独立使用后台“城市卡片墙图片”的 from→to→suffix 规则；
    // 三项都留空时回退到“标记点图片”的 from→to 规则，保持升级前的行为不变。
    function cityCardImageUrl(url) {
        if (!url || !footprintCfg) return url;
        const cityFrom = footprintCfg.cityWallImageFrom;
        const cityTo = footprintCfg.cityWallImageTo;
        const citySuffix = footprintCfg.cityWallImageSuffix;
        if (!cityFrom && !cityTo && !citySuffix) {
            // 独立规则未配置：完全沿用旧版的标记点 from→to 替换逻辑
            const from = footprintCfg.markerImageFrom;
            const to = footprintCfg.markerImageTo;
            if (from && to && String(url).includes(from)) {
                return String(url).split(from).join(to);
            }
            return url;
        }
        let out = String(url);
        if (cityFrom) out = out.split(cityFrom).join(cityTo || '');
        if (citySuffix && !out.endsWith(citySuffix)) out += citySuffix;
        return out;
    }

    // 移动端城市卡片墙每排数量：由后台 3D 地球设置注入，前端按 1-3 兜底
    const CITY_WALL_MOBILE_MIN = 1;
    const CITY_WALL_MOBILE_MAX = 3;
    function resolveMobileCityWallColumns() {
        const raw = Number(footprintCfg && footprintCfg.mobileCityWallColumns);
        if (!Number.isFinite(raw)) return 2;
        return Math.min(CITY_WALL_MOBILE_MAX, Math.max(CITY_WALL_MOBILE_MIN, Math.round(raw)));
    }

    // 地球渲染循环：票根墙需要透明背景透出地球，保持渲染；不透明全屏层打开时暂停
    function setGlobeRenderLoop(running) {
        if (!viewer) return;
        try {
            if (running && !viewer.useDefaultRenderLoop) {
                viewer.useDefaultRenderLoop = true;
            } else if (!running && viewer.useDefaultRenderLoop) {
                viewer.useDefaultRenderLoop = false;
            }
        } catch (e) { /* 暂停/恢复失败不影响页面功能 */ }
    }

    // 封面图限量解码队列：滚动时一次只解码少数图片，避免栅格线程被批量解码占满
    const CITY_WALL_COVER_CONCURRENCY = 3;   // 同时解码/加载的封面数
    const CITY_WALL_COVER_MARGIN = 700;      // 提前加载的距离（px）
    const cityWallCoverQueue = [];
    let cityWallCoverLoading = 0;
    let cityWallCoverObserver = null;
    let cityWallCoverDrainScheduled = false;

    function drainCityWallCoverQueue() {
        cityWallCoverDrainScheduled = false;
        while (cityWallCoverLoading < CITY_WALL_COVER_CONCURRENCY && cityWallCoverQueue.length) {
            const media = cityWallCoverQueue.shift();
            if (!media || !media.isConnected) continue;
            const img = media.querySelector('img.city-wall-card-cover');
            if (!img || !img.dataset.src || img.getAttribute('src')) continue;
            cityWallCoverLoading++;
            img.src = img.dataset.src;
        }
    }

    function scheduleCityWallCoverDrain() {
        if (cityWallCoverDrainScheduled) return;
        cityWallCoverDrainScheduled = true;
        requestAnimationFrame(drainCityWallCoverQueue);
    }

    function cityWallCoverFinished() {
        cityWallCoverLoading = Math.max(0, cityWallCoverLoading - 1);
        scheduleCityWallCoverDrain();
    }

    function stopCityWallCoverLoader() {
        if (cityWallCoverObserver) {
            cityWallCoverObserver.disconnect();
            cityWallCoverObserver = null;
        }
        cityWallCoverQueue.length = 0;
        cityWallCoverLoading = 0;
        cityWallCoverDrainScheduled = false;
    }

    function startCityWallCoverLoader() {
        stopCityWallCoverLoader();
        const pending = cityWallGrid.querySelectorAll('.city-wall-card-media.is-loading');
        if (!pending.length) return;
        // 不支持 IntersectionObserver 时回退为立即加载（与原生 lazy 行为相近）
        if (!('IntersectionObserver' in window) || !cityWallBody) {
            pending.forEach(media => {
                const img = media.querySelector('img.city-wall-card-cover');
                if (img && img.dataset.src) img.src = img.dataset.src;
            });
            return;
        }
        cityWallCoverObserver = new IntersectionObserver(entries => {
            let enqueued = false;
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const media = entry.target;
                if (media.dataset.coverQueued) return;
                media.dataset.coverQueued = '1';
                cityWallCoverQueue.push(media);
                enqueued = true;
            });
            if (enqueued) scheduleCityWallCoverDrain();
        }, {
            root: cityWallBody,
            rootMargin: '0px 0px ' + CITY_WALL_COVER_MARGIN + 'px 0px',
            threshold: 0.01
        });
        pending.forEach(media => cityWallCoverObserver.observe(media));
    }

    // ============ 卡片墙图片空闲预热 ============
    // 刷新后磁盘缓存里的图片仍要重新解码；滚动时再解码就会造成帧断。
    // 打开卡片墙后以低并发在后台把封面与轮播图全部解码，滚动时不再等待。
    const CITY_WALL_WARM_CONCURRENCY = 2;
    const CITY_WALL_WARM_MAX_IMAGES = 60;   // 防止超大城市列表过度预热
    const cityWallWarmQueue = [];
    let cityWallWarmLoading = 0;
    let cityWallWarmTimer = null;

    function drainCityWallWarmQueue() {
        cityWallWarmTimer = null;
        while (cityWallWarmLoading < CITY_WALL_WARM_CONCURRENCY && cityWallWarmQueue.length) {
            const img = cityWallWarmQueue.shift();
            if (!img || !img.isConnected || img.getAttribute('src')) continue;
            cityWallWarmLoading++;
            const done = () => {
                cityWallWarmLoading = Math.max(0, cityWallWarmLoading - 1);
                if (!cityWallWarmTimer) {
                    cityWallWarmTimer = setTimeout(drainCityWallWarmQueue, 0);
                }
            };
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            img.src = img.dataset.src;
        }
    }

    function stopCityWallWarmQueue() {
        if (cityWallWarmTimer) {
            clearTimeout(cityWallWarmTimer);
            cityWallWarmTimer = null;
        }
        cityWallWarmQueue.length = 0;
        cityWallWarmLoading = 0;
    }

    function startCityWallWarmQueue() {
        stopCityWallWarmQueue();
        const imgs = [...cityWallGrid.querySelectorAll(
            'img.city-wall-card-cover, img.city-wall-card-preview')]
            .filter(img => img.dataset.src && !img.getAttribute('src'));
        if (!imgs.length || imgs.length > CITY_WALL_WARM_MAX_IMAGES) return;
        cityWallWarmQueue.push(...imgs);
        drainCityWallWarmQueue();
    }

    // ============ PC 城市卡片悬停轮播（最多 3 张） ============
    const CITY_CARD_CAROUSEL_DELAY = 600;      // 悬停后多久开始
    const CITY_CARD_CAROUSEL_INTERVAL = 1800;  // 每张停留时长
    let cityCardCarouselCard = null;
    let cityCardCarouselTimer = null;
    let cityCardCarouselIndex = 0;
    let cityCardCarouselPauseUntil = 0;

    function loadCityCardPreview(img) {
        if (!img || !img.dataset.src || img.src) return;
        const probe = new Image();
        probe.onload = () => {
            if (!img.isConnected) return;
            img.src = img.dataset.src;
            img.classList.add('is-ready');
        };
        probe.onerror = () => {
            if (!img.isConnected) return;
            img.classList.add('is-error');
        };
        probe.src = img.dataset.src;
    }

    function stopCityCardCarousel() {
        if (cityCardCarouselTimer) {
            clearTimeout(cityCardCarouselTimer);
            cityCardCarouselTimer = null;
        }
        if (cityCardCarouselCard) {
            cityCardCarouselCard.classList.remove('is-carouseling');
            cityCardCarouselCard.querySelectorAll('.city-wall-card-preview').forEach(img => {
                img.classList.remove('is-active');
            });
        }
        cityCardCarouselCard = null;
        cityCardCarouselIndex = 0;
    }

    function stepCityCardCarousel() {
        if (Date.now() < cityCardCarouselPauseUntil) return;
        const card = cityCardCarouselCard;
        if (!card || !card.isConnected) {
            stopCityCardCarousel();
            return;
        }
        const imgs = [...card.querySelectorAll('.city-wall-card-cover, .city-wall-card-preview')]
            .filter(img => img.getAttribute('src') && !img.classList.contains('is-error'));
        if (imgs.length < 2) return;
        cityCardCarouselIndex = (cityCardCarouselIndex + 1) % imgs.length;
        imgs.forEach((img, i) => img.classList.toggle('is-active', i === cityCardCarouselIndex));
    }

    function startCityCardCarousel(card) {
        if (!featureEnabled('cityCardHoverCarousel')) return;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (cityCardCarouselCard === card && cityCardCarouselTimer) return;
        stopCityCardCarousel();
        cityCardCarouselCard = card;
        const boot = () => {
            if (!card.isConnected) {
                stopCityCardCarousel();
                return;
            }
            if (Date.now() < cityCardCarouselPauseUntil) {
                cityCardCarouselTimer = setTimeout(boot, 150);
                return;
            }
            // 真正开始轮播时才加载后续图片，一次只加载本卡 2 张
            card.querySelectorAll('.city-wall-card-preview').forEach(img => {
                if (!img.src && img.dataset.src) loadCityCardPreview(img);
            });
            card.classList.add('is-carouseling');
            const ready = [...card.querySelectorAll('.city-wall-card-cover, .city-wall-card-preview')]
                .filter(img => img.getAttribute('src') && !img.classList.contains('is-error'));
            if (ready.length) {
                ready.forEach((img, i) => img.classList.toggle('is-active', i === 0));
            }
            cityCardCarouselIndex = 0;
            cityCardCarouselTimer = setInterval(stepCityCardCarousel, CITY_CARD_CAROUSEL_INTERVAL);
        };
        cityCardCarouselTimer = setTimeout(boot, CITY_CARD_CAROUSEL_DELAY);
    }

    // 滚动时暂停轮播，避免与滚动卡顿叠加
    document.addEventListener('wheel', () => {
        cityCardCarouselPauseUntil = Date.now() + 350;
    }, { passive: true });
    document.addEventListener('touchmove', () => {
        cityCardCarouselPauseUntil = Date.now() + 350;
    }, { passive: true });

    function cityWallCardData(ci) {
        const fps = cityViewItems(ci);
        const photos = fps.reduce((n, fp) => n + cityWallImages(fp).length, 0);
        const tickets = fps.reduce((n, fp) => n + (ticketImageUrl(fp.ticketImage) ? 1 : 0), 0);
        const latest = fps.map(fp => fp.createTime).filter(Boolean).sort().pop() || '';
        // 封面/轮播预览：按最近足迹顺序，从足迹相册中取最多 3 张不重复照片；
        // 单足迹但相册有很多照片的城市也能获得轮播效果；都没有图片时卡片显示首字占位
        const previews = [];
        const previewsRaw = [];   // 与 previews 一一对应的原图地址（明信片出图用）
        const latestFirst = fps.slice().sort((a, b) =>
            String(b.createTime || '').localeCompare(String(a.createTime || '')));
        for (const fp of latestFirst) {
            const imgs = cityWallImages(fp);
            for (const img of imgs) {
                const url = cityCardImageUrl(img.url);
                if (!previews.includes(url)) {
                    previews.push(url);
                    previewsRaw.push(img.url);
                }
                if (previews.length >= 3) break;
            }
            if (previews.length >= 3) break;
        }
        const cover = previews[0] || '';
        const coverRaw = previewsRaw[0] || '';
        const province = fps.map(fp => fp.province).find(Boolean) || '';
        // 城市小结用：第一次到访 + 这座城市里走过的地方（按时间升序）
        const first = fps.map(fp => fp.createTime).filter(Boolean).sort()[0] || '';
        const places = fps
            .slice()
            .sort((a, b) => String(a.createTime || '').localeCompare(String(b.createTime || '')))
            .map(fp => fp.name)
            .filter(Boolean);
        return { count: fps.length, photos, tickets, latest, first, places, cover, coverRaw, province, previews };
    }

    // 「只看某个省」的开关：足迹洞察的省份排行点进来时用，只影响卡片墙这一层
    function renderCityWallProvinceFilter() {
        if (!cityWallProvinceFilter) return;
        cityWallProvinceFilter.hidden = !cityWallProvinceFilterName;
        if (!cityWallProvinceFilterName) return;
        cityWallProvinceFilter.textContent = '只看 ' + cityWallProvinceFilterName + ' ✕';
        cityWallProvinceFilter.setAttribute('aria-label',
            '清除筛选，显示全部城市（当前只看 ' + cityWallProvinceFilterName + '）');
    }

    function setCityWallProvinceFilter(name) {
        cityWallProvinceFilterName = name || '';
        renderCityWall();
        if (cityWallBody) cityWallBody.scrollTop = 0;
    }

    function cityWallCards() {
        const cards = cityList
            .map((city, ci) => ({
                ci,
                name: city.city,
                ...cityWallCardData(ci)
            }))
            .filter(card => !cityWallProvinceFilterName || card.province === cityWallProvinceFilterName);
        // 最近去过的城市排前面，无日期时按名称兜底，保持顺序稳定
        cards.sort((a, b) => {
            const byDate = String(b.latest || '').localeCompare(String(a.latest || ''));
            if (byDate) return byDate;
            return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
        });
        return cards;
    }

    function renderCityWall() {
        if (!cityWall) return;
        stopCityWallCoverLoader();
        stopCityWallWarmQueue();
        stopCityCardCarousel();
        const mobileColumns = resolveMobileCityWallColumns();
        const mobileView = window.matchMedia('(max-width: 820px)').matches;
        cityWall.style.setProperty('--city-wall-mobile-columns', String(mobileColumns));
        // 仅手机端多列（每排 2-3 个）时切换紧凑照片卡样式：图片放大、次要文字隐藏
        cityWall.classList.toggle('city-wall-multi', mobileView && mobileColumns > 1);
        const cards = cityWallCards();
        const cityCount = cards.length;
        const footprintTotal = cards.reduce((n, c) => n + c.count, 0);
        const photoTotal = cards.reduce((n, c) => n + c.photos, 0);
        const ticketTotal = cards.reduce((n, c) => n + c.tickets, 0);
        cityWallTitle.textContent = '城市卡片墙';
        cityWallStats.textContent = cityCount
            ? cityCount + ' 座城市 · ' + footprintTotal + ' 个足迹 · ' + photoTotal + ' 张照片' +
              (ticketTotal ? ' · ' + ticketTotal + ' 张票根' : '')
            : '每一座城市，都值得一张卡片';
        renderCityWallProvinceFilter();
        cityWallGrid.innerHTML = '';
        if (cityWallEmpty) cityWallEmpty.hidden = cityCount > 0;

        cards.forEach(card => {
            const wrap = document.createElement('div');
            wrap.className = 'city-wall-card-wrap';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'city-wall-card' + (card.cover ? '' : ' no-cover');
            btn.dataset.cityIndex = String(card.ci);
            btn.setAttribute('aria-label',
                card.name + (card.province ? '，' + card.province : '') + '，' +
                card.count + ' 个足迹' +
                (card.tickets ? '，' + card.tickets + ' 张票根' : '') + '，打开城市图片墙');

            const media = document.createElement('span');
            media.className = 'city-wall-card-media' + (card.cover ? ' is-loading' : '');
            // 首字占位常驻：封面未加载/加载失败时显示，加载完成后被封面淡入盖住
            const monogram = document.createElement('span');
            monogram.className = 'city-wall-card-monogram';
            monogram.textContent = card.name ? card.name.charAt(0) : '?';
            media.appendChild(monogram);
            if (card.cover) {
                const cover = document.createElement('img');
                cover.className = 'city-wall-card-cover';
                cover.decoding = 'async';
                cover.alt = '';
                cover.dataset.src = card.cover;
                cover.addEventListener('load', () => {
                    if (!cover.isConnected) return;   // 卡片墙已关闭时忽略迟到的解码结果
                    media.classList.remove('is-loading');
                    media.classList.add('is-loaded');
                    cityWallCoverFinished();
                });
                cover.addEventListener('error', () => {
                    if (!cover.isConnected) return;
                    media.classList.remove('is-loading');
                    media.classList.add('is-error');
                    cityWallCoverFinished();
                });
                media.appendChild(cover);
            }
            // 轮播后续图：不参与首图限量队列，hover 时再按需加载（最多共 3 张）
            if (card.previews.length > 1 && featureEnabled('cityCardHoverCarousel')) {
                card.previews.slice(1).forEach(url => {
                    const extra = document.createElement('img');
                    extra.className = 'city-wall-card-preview';
                    extra.decoding = 'async';
                    extra.alt = '';
                    extra.setAttribute('aria-hidden', 'true');
                    extra.dataset.src = url;
                    media.appendChild(extra);
                });
            }
            if (card.tickets) {
                const ticketBadge = document.createElement('span');
                ticketBadge.className = 'city-wall-card-tickets';
                ticketBadge.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-2a2.5 2.5 0 0 0 0-5z"/><path d="M13.5 7v2.8M13.5 14.2V17"/></svg>';
                ticketBadge.appendChild(document.createTextNode(card.tickets + ' 张票根'));
                media.appendChild(ticketBadge);
            }

            const body = document.createElement('span');
            body.className = 'city-wall-card-body';
            const eyebrow = document.createElement('span');
            eyebrow.className = 'city-wall-card-eyebrow';
            eyebrow.textContent = card.province || 'TRAVELED';
            const name = document.createElement('strong');
            name.className = 'city-wall-card-name';
            name.textContent = card.name;
            const meta = document.createElement('span');
            meta.className = 'city-wall-card-meta';
            // 桌面展示「足迹 · 照片」；手机端紧凑卡只留一行，显示足迹数（照片数信息量更低）
            meta.textContent = mobileView
                ? (card.count ? card.count + ' 个足迹' : '暂无足迹')
                : card.count + ' 个足迹 · ' + card.photos + ' 张照片';
            body.append(eyebrow, name, meta);
            if (card.latest) {
                const recent = document.createElement('span');
                recent.className = 'city-wall-card-recent';
                recent.textContent = '最近 ' + formatCityDate(card.latest);
                body.appendChild(recent);
            }

            btn.append(media, body);
            btn.addEventListener('click', (event) => {
                const ci = Number(btn.dataset.cityIndex);
                if (!cityList[ci]) return;
                // 点在"N 张票根"徽章上 = 只看这座城市的票根；点其它地方 = 打开城市图片墙
                if (event.target.closest('.city-wall-card-tickets')) {
                    openTicketGalleryForCity(ci);
                    return;
                }
                // 卡片墙保留在下一层，图片墙从上面展开，返回时回到卡片墙并保留滚动位置
                openCityView(ci, null);
            });
            // PC 悬停/键盘聚焦轮播
            btn.addEventListener('mouseenter', () => startCityCardCarousel(btn));
            btn.addEventListener('mouseleave', stopCityCardCarousel);
            btn.addEventListener('focusin', () => startCityCardCarousel(btn));
            btn.addEventListener('focusout', stopCityCardCarousel);
            wrap.appendChild(btn);
            // 明信片入口（独立按钮，避免按钮嵌套）
            if (featureEnabled('enablePostcard')) {
                const postcardBtn = document.createElement('button');
                postcardBtn.type = 'button';
                postcardBtn.className = 'city-wall-card-postcard';
                postcardBtn.textContent = '明信片';
                postcardBtn.setAttribute('aria-label', '为 ' + card.name + ' 生成旅行明信片');
                postcardBtn.addEventListener('click', () => {
                    const ci = Number(btn.dataset.cityIndex);
                    if (cityList[ci]) openPostcard(ci, postcardBtn);
                });
                wrap.appendChild(postcardBtn);
            }
            cityWallGrid.appendChild(wrap);
        });
        refreshCityWallFeatureActions();
        startCityWallCoverLoader();
        startCityWallWarmQueue();
    }

    function openCityWall() {
        if (!cityWall || cityWall.classList.contains('show')) return;
        // 卡片墙背景不透明，暂停地球渲染，避免其满帧率渲染抢走滚动所需资源
        setGlobeRenderLoop(false);
        if (lightbox.classList.contains('show')) closeLightbox(false);
        hidePhotoRing();
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        if (cityCard.classList.contains('visible')) hideCityCard(false);
        if (provinceCardsActive) closeProvinceCards();
        renderCityWall();
        cityWall.classList.add('show');
        setOverlayHidden(cityWall, false);
        document.body.classList.add('city-wall-open');
        // 与城市图片墙一致：触屏不自动聚焦，避免“返回地球”出现焦点描边
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            cityWallBack.focus();
        }
    }

    function closeCityWall(returnFocus = true) {
        if (!cityWall || !cityWall.classList.contains('show')) return;
        stopCityCardCarousel();
        cityWall.classList.remove('show');
        setOverlayHidden(cityWall, true);
        document.body.classList.remove('city-wall-open');
        // 关掉卡片墙就清掉省份筛选，下次进来看到的是全部城市
        cityWallProvinceFilterName = '';
        renderCityWallProvinceFilter();
        stopCityWallCoverLoader();
        stopCityWallWarmQueue();
        setGlobeRenderLoop(true);
        if (returnFocus) {
            const trigger = cityWallBtn;
            setTimeout(() => {
                if (trigger && trigger.isConnected &&
                    getComputedStyle(trigger).visibility !== 'hidden') {
                    trigger.focus();
                }
            }, 0);
        }
    }

    // ================= 创意功能入口与覆盖层 =================
    // 时间胶囊 / 足迹洞察 / 明信片预览都从城市卡片墙之上打开；
    // 城市卡片墙保持在下一层，关闭新层后回到卡片墙原滚动位置。

    function refreshCityWallFeatureActions() {
        if (cityWallTimeCapsuleBtn) {
            cityWallTimeCapsuleBtn.hidden =
                !featureEnabled('enableTimeCapsule') || timeCapsuleItems().length === 0;
        }
        if (cityWallInsightBtn) {
            cityWallInsightBtn.hidden = !featureEnabled('enableInsight');
        }
    }

    function focusCityWallTop() {
        setTimeout(() => {
            if (cityWallBack && cityWallBack.isConnected &&
                cityWall.classList.contains('show')) {
                cityWallBack.focus();
            }
        }, 260);
    }

    // ---------------- 去年今天 ----------------
    const timeCapsule = document.getElementById('timeCapsule');
    const timeCapsuleBack = document.getElementById('timeCapsuleBack');
    const timeCapsulePrev = document.getElementById('timeCapsulePrev');
    const timeCapsuleNext = document.getElementById('timeCapsuleNext');
    const timeCapsuleStats = document.getElementById('timeCapsuleStats');
    const timeCapsuleBody = document.getElementById('timeCapsuleBody');
    let timeCapsuleItemsCache = [];
    let timeCapsuleIndex = 0;

    function timeCapsuleItems() {
        const now = new Date();
        const today = String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
        return FOOTPRINTS
            .filter(fp => {
                const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fp.createTime || '');
                if (!m) return false;
                const year = Number(m[1]);
                const md = m[2] + '-' + m[3];
                return year < now.getFullYear() && md === today;
            })
            .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
    }

    function timeCapsuleTicketIndex(fp) {
        const items = ticketItemsFromFootprints();
        const byKey = fp.key ? items.findIndex(item => item.key === fp.key) : -1;
        return byKey >= 0 ? byKey : items.indexOf(fp);
    }

    function renderTimeCapsule() {
        const fp = timeCapsuleItemsCache[timeCapsuleIndex];
        timeCapsuleBody.innerHTML = '';
        timeCapsuleStats.textContent = timeCapsuleItemsCache.length
            ? timeCapsuleItemsCache.length + ' 条历史记录 · 第 ' + (timeCapsuleIndex + 1) + ' 条'
            : '';
        timeCapsulePrev.hidden = timeCapsuleItemsCache.length < 2;
        timeCapsuleNext.hidden = timeCapsuleItemsCache.length < 2;
        if (!fp) {
            timeCapsuleBody.textContent = '今天还没有属于过去的故事';
            return;
        }

        const article = document.createElement('article');
        article.className = 'capsule-card';
        const shot = document.createElement('div');
        shot.className = 'capsule-shot';
        const imgs = cityWallImages(fp);
        if (imgs.length) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = imgs[0].url;
            img.alt = fp.name;
            shot.appendChild(img);
        } else {
            shot.classList.add('no-image');
            shot.textContent = fp.name ? fp.name.charAt(0) : '?';
        }
        article.appendChild(shot);

        const info = document.createElement('div');
        info.className = 'capsule-info';
        const eyebrow = document.createElement('p');
        eyebrow.className = 'capsule-eyebrow';
        eyebrow.textContent = 'FOOTPRINT · ' + (fp.footprintType || '旅行');
        const name = document.createElement('h3');
        name.textContent = fp.name;
        const meta = document.createElement('p');
        meta.className = 'capsule-meta';
        meta.textContent = [fp.city, fp.province, formatCityDate(fp.createTime), fp.address]
            .filter(Boolean).join(' · ');
        const desc = document.createElement('p');
        desc.className = 'capsule-desc';
        desc.textContent = fp.description || '那一天的旅途，被留在了这里。';
        const actions = document.createElement('div');
        actions.className = 'capsule-actions';
        const galleryBtn = document.createElement('button');
        galleryBtn.type = 'button';
        galleryBtn.textContent = '打开图片墙';
        galleryBtn.addEventListener('click', () => {
            const fpIndex = FOOTPRINTS.indexOf(fp);
            const ci = fpIndex >= 0 ? cityList.findIndex(city => city.indices.includes(fpIndex)) : -1;
            closeTimeCapsule(false);
            if (ci >= 0) openCityView(ci, null);
        });
        actions.appendChild(galleryBtn);
        if (ticketImageUrl(fp.ticketImage)) {
            const ticketBtn = document.createElement('button');
            ticketBtn.type = 'button';
            ticketBtn.className = 'is-ticket';
            ticketBtn.textContent = '查看票根';
            ticketBtn.addEventListener('click', () => {
                const idx = timeCapsuleTicketIndex(fp);
                closeTimeCapsule(false);
                closeCityWall(false);
                if (idx >= 0) setTicketView(true, idx, false);
            });
            actions.appendChild(ticketBtn);
        }
        info.append(eyebrow, name, meta, desc, actions);
        article.appendChild(info);
        timeCapsuleBody.appendChild(article);
    }

    function openTimeCapsule() {
        if (!featureEnabled('enableTimeCapsule') || !timeCapsule) return;
        timeCapsuleItemsCache = timeCapsuleItems();
        if (!timeCapsuleItemsCache.length) return;
        timeCapsuleIndex = 0;
        renderTimeCapsule();
        timeCapsule.classList.add('show');
        setOverlayHidden(timeCapsule, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            timeCapsuleBack.focus();
        }
    }

    function closeTimeCapsule(returnFocus = true) {
        if (!timeCapsule || !timeCapsule.classList.contains('show')) return;
        timeCapsule.classList.remove('show');
        setOverlayHidden(timeCapsule, true);
        if (returnFocus) focusCityWallTop();
    }

    // ---------------- 足迹洞察 ----------------
    const insightView = document.getElementById('insightView');
    const insightBack = document.getElementById('insightBack');
    const insightDeck = document.getElementById('insightDeck');
    const insightDots = document.getElementById('insightDots');
    const insightPageCount = document.getElementById('insightPageCount');
    const insightPrevCard = document.getElementById('insightPrevCard');
    const insightNextCard = document.getElementById('insightNextCard');
    const insightTitleEl = document.getElementById('insightTitle');
    let insightCards = [];
    let insightCardIndex = 0;
    let insightSentenceVariant = 0;   // 概览那句总结的说法序号
    let insightYearIndex = 0;         // 年度回顾里选中的年份下标
    let insightSentenceCache = [];    // 概览的几句总结，换说法时只换文字、不重建卡片
    let insightTitleVariant = 0;      // 当前显示第几个称号
    let insightTitleCache = [];       // 已解锁的称号（按稀缺度排），换称号时在这份列表里循环
    const INSIGHT_TITLE_SLOTS = 13;   // 条件称号的总数，用来显示「已解锁 N / 13」

    function haversineKm(a, b) {
        const R = 6371;
        const rad = d => d * Math.PI / 180;
        const dLat = rad(b.lat - a.lat);
        const dLng = rad(b.lng - a.lng);
        const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
    }

    // ---- 洞察用的小工具 ----
    function insightSeasonOf(month) {
        if (month >= 3 && month <= 5) return '春';
        if (month >= 6 && month <= 8) return '夏';
        if (month >= 9 && month <= 11) return '秋';
        return '冬';
    }

    function insightMonthOf(fp) {
        const month = Number(String(fp.createTime || '').slice(5, 7));
        return month >= 1 && month <= 12 ? month : 0;
    }

    function insightSpotDate(fp) {
        return fp && fp.createTime ? String(fp.createTime).slice(0, 10).replace(/-/g, '.') : '—';
    }

    function insightKm(value) {
        const n = Math.round(Number(value) || 0);
        return n.toLocaleString('zh-CN');
    }

    function insightPlaceName(fp) {
        return (fp && (fp.city || fp.name)) || '某地';
    }

    // 时间维度：首次 / 最近、跨度、最常出发的月份、连续出行月、12 个月分布
    function insightTimeStats(fps) {
        const dated = fps
            .filter(fp => fp.createTime)
            .slice()
            .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
        if (!dated.length) return null;
        const first = dated[0];
        const last = dated[dated.length - 1];
        const firstTime = new Date(String(first.createTime) + 'T00:00:00').getTime();
        const lastTime = new Date(String(last.createTime) + 'T00:00:00').getTime();
        const spanDays = Number.isFinite(firstTime) && Number.isFinite(lastTime)
            ? Math.max(0, Math.round((lastTime - firstTime) / 86400000))
            : 0;
        const spanYears = Math.floor(spanDays / 365);
        const months = new Array(12).fill(0);
        const monthKeys = new Set();
        dated.forEach(fp => {
            const month = insightMonthOf(fp);
            if (!month) return;
            months[month - 1] += 1;
            const year = Number(String(fp.createTime).slice(0, 4)) || 0;
            monthKeys.add(year * 12 + (month - 1));
        });
        const topMonthCount = Math.max(...months);
        const topMonth = months.indexOf(topMonthCount) + 1;
        // 连续出行月：把「年 * 12 + 月」排成序列，找最长的一段相邻月份
        const keys = [...monthKeys].sort((a, b) => a - b);
        let streak = keys.length ? 1 : 0;
        let best = streak;
        for (let i = 1; i < keys.length; i++) {
            streak = keys[i] === keys[i - 1] + 1 ? streak + 1 : 1;
            best = Math.max(best, streak);
        }
        return {
            first,
            last,
            spanDays,
            spanYears,
            restDays: spanDays - spanYears * 365,
            months,
            topMonth,
            topMonthCount,
            monthCount: keys.length,
            monthStreak: best
        };
    }

    // 省份维度：每个省去过多少座城市、留下多少条足迹
    function insightProvinceStats(fps) {
        const map = new Map();
        fps.forEach(fp => {
            const name = String(fp.province || '').trim();
            if (!name) return;
            if (!map.has(name)) map.set(name, { name, footprints: 0, cities: new Set() });
            const item = map.get(name);
            item.footprints += 1;
            if (fp.city) item.cities.add(fp.city);
        });
        const list = [...map.values()]
            .map(item => ({ name: item.name, footprints: item.footprints, cities: item.cities.size }))
            .sort((a, b) => b.footprints - a.footprints ||
                b.cities - a.cities ||
                a.name.localeCompare(b.name, 'zh-Hans-CN'));
        return { list, total: list.length };
    }

    // 单段之最：按时间相邻的两条足迹算一段，取最长 / 最短 / 平均与四个方向极值
    function insightSegmentStats(fps) {
        const located = fps.filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng));
        const dated = located
            .filter(fp => fp.createTime)
            .slice()
            .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
        const segments = [];
        for (let i = 1; i < dated.length; i++) {
            const km = haversineKm(dated[i - 1], dated[i]);
            if (Number.isFinite(km)) segments.push({ from: dated[i - 1], to: dated[i], km });
        }
        const byKm = segments.slice().sort((a, b) => b.km - a.km);
        const byLat = located.slice().sort((a, b) => a.lat - b.lat);
        const byLng = located.slice().sort((a, b) => a.lng - b.lng);
        const totalKm = segments.reduce((sum, item) => sum + item.km, 0);
        return {
            count: segments.length,
            longest: byKm[0] || null,
            shortest: byKm[byKm.length - 1] || null,
            average: segments.length ? totalKm / segments.length : 0,
            totalKm,
            south: byLat[0] || null,
            north: byLat[byLat.length - 1] || null,
            west: byLng[0] || null,
            east: byLng[byLng.length - 1] || null
        };
    }

    // 类型维度：每种类型多少次，以及它最常出现在哪个季节
    function insightTypeStats(fps) {
        const map = new Map();
        fps.forEach(fp => {
            const name = String(fp.footprintType || '').trim() || '旅行';
            if (!map.has(name)) map.set(name, { name, count: 0, seasons: { 春: 0, 夏: 0, 秋: 0, 冬: 0 } });
            const item = map.get(name);
            item.count += 1;
            const month = insightMonthOf(fp);
            if (month) item.seasons[insightSeasonOf(month)] += 1;
        });
        const list = [...map.values()].map(item => {
            const top = Object.entries(item.seasons).sort((a, b) => b[1] - a[1])[0] || ['', 0];
            return {
                name: item.name,
                count: item.count,
                season: top[1] ? top[0] : '',
                seasonCount: top[1] || 0
            };
        }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
        return { list };
    }

    // 年度回顾：按年份聚合，倒序排列
    function insightYearStats(fps) {
        const map = new Map();
        fps.forEach(fp => {
            const year = String(fp.createTime || '').slice(0, 4);
            if (!/^\d{4}$/.test(year)) return;
            if (!map.has(year)) map.set(year, []);
            map.get(year).push(fp);
        });
        return [...map.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([year, items]) => {
                const dated = items
                    .filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng))
                    .slice()
                    .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
                let km = 0;
                for (let i = 1; i < dated.length; i++) km += haversineKm(dated[i - 1], dated[i]);
                const seasons = [...new Set(items
                    .map(fp => insightMonthOf(fp))
                    .filter(Boolean)
                    .map(insightSeasonOf))];
                return {
                    year,
                    footprints: items.length,
                    cities: new Set(items.map(fp => fp.city).filter(Boolean)).size,
                    provinces: [...new Set(items.map(fp => String(fp.province || '').trim()).filter(Boolean))],
                    photos: items.reduce((n, fp) => n + cityWallImages(fp).length, 0),
                    tickets: items.filter(fp => ticketImageUrl(fp.ticketImage)).length,
                    km: Math.round(km),
                    months: new Set(items.map(fp => String(fp.createTime || '').slice(5, 7)).filter(Boolean)).size,
                    seasons
                };
            });
    }

    // 票根收藏家的判定只有这一处：称号和徽章共用，免得同名两个门槛，
    // 出现「顶栏自称票根收藏家，下面那枚徽章却还灰着」
    function insightTicketCollectorDone(m) {
        return m.footprintCount > 0 && m.ticketCount * 2 >= m.footprintCount;
    }

    // 周末：createTime 被统一成 YYYY-MM-DD，小时已经丢了，只能算到「星期」这一层
    function insightIsWeekend(fp) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((fp && fp.createTime) || ''));
        if (!m) return false;
        const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
        return day === 0 || day === 6;
    }

    // 成就与称号共用的派生统计：只算一遍，两边都从这里取，免得口径漂移
    function insightDerived(segment) {
        const located = FOOTPRINTS.filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng));
        const byLat = located.slice().sort((a, b) => a.lat - b.lat);
        const byLng = located.slice().sort((a, b) => a.lng - b.lng);
        const maxCityVisits = cityList.reduce((max, city, ci) => Math.max(max, cityViewItems(ci).length), 0);
        let repeatCities = 0;
        cityList.forEach((city, ci) => {
            if (cityViewItems(ci).length >= 2) repeatCities += 1;
        });
        const ticketedCityKeys = new Set(FOOTPRINTS
            .filter(fp => ticketImageUrl(fp.ticketImage))
            .map(fp => cityKeyOf(fp)));
        return {
            north: byLat[byLat.length - 1] || null,
            south: byLat[0] || null,
            east: byLng[byLng.length - 1] || null,
            west: byLng[0] || null,
            // 只有一条数据时跨度按 0 算，免得「跨越 0.0 个纬度」也算点亮
            latSpan: byLat.length >= 2 ? byLat[byLat.length - 1].lat - byLat[0].lat : 0,
            lngSpan: byLng.length >= 2 ? byLng[byLng.length - 1].lng - byLng[0].lng : 0,
            yearCount: new Set(FOOTPRINTS
                .map(fp => String(fp.createTime || '').slice(0, 4))
                .filter(year => /^\d{4}$/.test(year))).size,
            seasonCount: new Set(FOOTPRINTS
                .map(fp => insightMonthOf(fp))
                .filter(Boolean)
                .map(insightSeasonOf)).size,
            maxCityVisits,
            repeatCities,
            photos: FOOTPRINTS.reduce((n, fp) => n + cityWallImages(fp).length, 0),
            weekendCount: FOOTPRINTS.filter(insightIsWeekend).length,
            // 画廊是「一条足迹带多张图」，所以这里比 cityWallImages 的 1 张兜底要严
            galleryCount: FOOTPRINTS.filter(fp => cityWallImages(fp).length >= 2).length,
            articleCount: FOOTPRINTS.filter(fp => String(fp.article || '').trim()).length,
            typeCount: new Set(FOOTPRINTS
                .map(fp => String(fp.footprintType || '').trim() || '旅行')).size,
            // 「一城一票」：所有城市都能翻出票根。城市太少不算数，免得点亮得太容易
            unticketedCities: cityList.filter(city => !ticketedCityKeys.has(city.key)).length,
            allCitiesTicketed: cityList.length >= 3 &&
                cityList.every(city => ticketedCityKeys.has(city.key)),
            longest: segment && segment.longest ? segment.longest.km : 0
        };
    }

    // 轻成就：全部用已有数据算，满足条件即点亮。
    // 未点亮的补一句 remaining（还差多少），显示在进度位置
    function insightAchievements(m, time, province, segment, stats) {
        const s = stats || insightDerived(segment);
        const ticketHalf = Math.ceil(m.footprintCount / 2);
        const ticketGap = Math.max(0, ticketHalf - m.ticketCount);
        return [
            {
                name: '跨省旅人',
                desc: '点亮 3 个以上省份',
                done: province.total >= 3,
                progress: province.total + ' 个省',
                remaining: '还差 ' + Math.max(0, 3 - province.total) + ' 个省'
            },
            {
                name: '疆域辽阔',
                desc: '到访 8 个省份以上',
                done: province.total >= 8,
                progress: province.total + ' 个省',
                remaining: '还差 ' + Math.max(0, 8 - province.total) + ' 个省'
            },
            {
                name: '南北纵贯',
                desc: '最北与最南相隔 8 度以上',
                done: s.latSpan >= 8,
                progress: s.latSpan ? s.latSpan.toFixed(1) + ' 度' : '暂无数据',
                remaining: s.latSpan ? '还差 ' + Math.max(0, 8 - s.latSpan).toFixed(1) + ' 度' : '暂无数据'
            },
            {
                name: '北境行者',
                desc: '最北的足迹在北纬 40° 以上',
                done: !!s.north && s.north.lat >= 40,
                progress: s.north ? '北纬 ' + s.north.lat.toFixed(1) + '°' : '暂无数据',
                remaining: s.north
                    ? '最北北纬 ' + s.north.lat.toFixed(1) + '°，还差 ' +
                        Math.max(0, 40 - s.north.lat).toFixed(1) + ' 度'
                    : '暂无数据'
            },
            {
                name: '经度猎手',
                desc: '最东与最西相隔 10 度以上',
                done: s.lngSpan >= 10,
                progress: s.lngSpan ? s.lngSpan.toFixed(1) + ' 度' : '暂无数据',
                remaining: s.lngSpan ? '还差 ' + Math.max(0, 10 - s.lngSpan).toFixed(1) + ' 度' : '暂无数据'
            },
            {
                name: '长途跋涉',
                desc: '单段行程超过 500 公里',
                done: s.longest >= 500,
                progress: s.longest ? insightKm(s.longest) + ' km' : '暂无数据',
                remaining: s.longest ? '还差 ' + insightKm(Math.max(0, 500 - s.longest)) + ' km' : '暂无数据'
            },
            {
                name: '千里单骑',
                desc: '单段行程超过 1000 公里',
                done: s.longest >= 1000,
                progress: s.longest ? insightKm(s.longest) + ' km' : '暂无数据',
                remaining: s.longest ? '还差 ' + insightKm(Math.max(0, 1000 - s.longest)) + ' km' : '暂无数据'
            },
            {
                name: '票根收藏家',
                desc: '一半以上的足迹有票根',
                done: insightTicketCollectorDone(m),
                progress: m.ticketCount + '/' + m.footprintCount,
                remaining: m.footprintCount ? '还差 ' + ticketGap + ' 张（要 ' + ticketHalf + ' 张）' : '暂无数据'
            },
            {
                name: '票根大户',
                desc: '累计票根 20 张以上',
                done: m.ticketCount >= 20,
                progress: m.ticketCount + ' 张',
                remaining: '还差 ' + Math.max(0, 20 - m.ticketCount) + ' 张'
            },
            {
                name: '跨年旅人',
                desc: '在两个以上年份出发',
                done: s.yearCount >= 2,
                progress: s.yearCount + ' 个年份',
                remaining: '还差 ' + Math.max(0, 2 - s.yearCount) + ' 个年份'
            },
            {
                name: '岁月留痕',
                desc: '记录跨度 3 年以上',
                done: !!time && time.spanYears >= 3,
                progress: time ? time.spanYears + ' 年' : '暂无数据',
                remaining: time ? '还差 ' + Math.max(0, 3 - time.spanYears) + ' 年' : '暂无数据'
            },
            {
                name: '同城三刷',
                desc: '同一座城市去过 3 次以上',
                done: s.maxCityVisits >= 3,
                progress: '最多 ' + s.maxCityVisits + ' 次',
                remaining: '最多 ' + s.maxCityVisits + ' 次，还差 ' + Math.max(0, 3 - s.maxCityVisits) + ' 次'
            },
            {
                name: '单城五刷',
                desc: '同一座城市去过 5 次以上',
                done: s.maxCityVisits >= 5,
                progress: '最多 ' + s.maxCityVisits + ' 次',
                remaining: '最多 ' + s.maxCityVisits + ' 次，还差 ' + Math.max(0, 5 - s.maxCityVisits) + ' 次'
            },
            {
                name: '回头客',
                desc: '有 5 座城市去过两次以上',
                done: s.repeatCities >= 5,
                progress: s.repeatCities + ' 座城市',
                remaining: '还差 ' + Math.max(0, 5 - s.repeatCities) + ' 座'
            },
            {
                name: '相册达人',
                desc: '累计收录 100 张以上照片',
                done: s.photos >= 100,
                progress: s.photos + ' 张',
                remaining: '还差 ' + Math.max(0, 100 - s.photos) + ' 张'
            },
            {
                name: '快门狂魔',
                desc: '累计收录 500 张以上照片',
                done: s.photos >= 500,
                progress: s.photos + ' 张',
                remaining: '还差 ' + Math.max(0, 500 - s.photos) + ' 张'
            },
            {
                name: '画廊主人',
                desc: '3 条足迹带多图画廊',
                done: s.galleryCount >= 3,
                progress: s.galleryCount + ' 条',
                remaining: '还差 ' + Math.max(0, 3 - s.galleryCount) + ' 条'
            },
            {
                name: '图文并茂',
                desc: '5 条足迹挂了文章链接',
                done: s.articleCount >= 5,
                progress: s.articleCount + ' 条',
                remaining: '还差 ' + Math.max(0, 5 - s.articleCount) + ' 条'
            },
            {
                name: '一城一票',
                desc: '每座城市都留下了票根',
                done: s.allCitiesTicketed,
                progress: '票根覆盖 ' + (cityList.length - s.unticketedCities) + '/' + cityList.length + ' 座城市',
                remaining: cityList.length < 3
                    ? '至少 3 座城市后解锁'
                    : '还有 ' + s.unticketedCities + ' 座城市没票根'
            },
            {
                name: '四季出行',
                desc: '春夏秋冬都出发过',
                done: s.seasonCount >= 4,
                progress: s.seasonCount + ' 个季节',
                remaining: '还差 ' + Math.max(0, 4 - s.seasonCount) + ' 个季节'
            },
            {
                name: '月度常客',
                desc: '累计在 10 个不同月份出发过',
                done: !!time && time.monthCount >= 10,
                progress: time ? time.monthCount + ' 个月份' : '暂无数据',
                remaining: time ? '还差 ' + Math.max(0, 10 - time.monthCount) + ' 个月份' : '暂无数据'
            },
            {
                name: '周末出走',
                desc: '5 次以上出发落在周末',
                done: s.weekendCount >= 5,
                progress: s.weekendCount + ' 次',
                remaining: '还差 ' + Math.max(0, 5 - s.weekendCount) + ' 次'
            },
            {
                name: '万里行者',
                desc: '累计里程 1 万公里以上',
                done: m.distanceKm >= 10000,
                progress: insightKm(m.distanceKm) + ' km',
                remaining: '还差 ' + insightKm(Math.max(0, 10000 - m.distanceKm)) + ' km'
            },
            {
                name: '主题收藏家',
                desc: '主题类型 5 种以上',
                done: s.typeCount >= 5,
                progress: s.typeCount + ' 种',
                remaining: '还差 ' + Math.max(0, 5 - s.typeCount) + ' 种'
            }
        ];
    }

    // 称号：把所有已解锁的收集出来（顺序 = 稀缺度，从难到易）。
    // 第一句默认显示，成就卡上的「换一个称号」就在这份列表里循环，所以不再只挑一句。
    function insightTitlesOf(m, time, province, segment, stats) {
        const s = stats || insightDerived(segment);
        const list = [];
        if (m.cityCount >= 30) list.push('百城 · 点亮 ' + m.cityCount + ' 座城市');
        if (m.distanceKm >= 10000) list.push('万里行者 · 约 ' + insightKm(m.distanceKm) + ' 公里');
        if (s.photos >= 500) list.push('快门收藏家 · 收下 ' + s.photos + ' 张照片');
        if (s.lngSpan >= 20) list.push('东西横穿者 · 跨越 ' + s.lngSpan.toFixed(1) + ' 个经度');
        if (s.latSpan >= 12) list.push('南北纵贯者 · 跨越 ' + s.latSpan.toFixed(1) + ' 个纬度');
        if (s.repeatCities >= 5) list.push('老地方收集者 · ' + s.repeatCities + ' 座城市去过两次以上');
        if (time && time.spanYears >= 3) list.push('常年旅人 · 记录横跨 ' + time.spanYears + ' 年');
        if (province.total >= 10) list.push('远行者 · 走过 ' + province.total + ' 个省份');
        if (province.total >= 8) list.push('疆域辽阔者 · 走过 ' + province.total + ' 个省份');
        if (insightTicketCollectorDone(m)) list.push('票根收藏家 · 攒下 ' + m.ticketCount + ' 张票根');
        if (m.cityCount >= 10) list.push('城市收集者 · 点亮 ' + m.cityCount + ' 座城市');
        if (s.weekendCount >= 10) list.push('周末出走者 · ' + s.weekendCount + ' 次出发落在周末');
        if (time && time.monthStreak >= 3) list.push('四季旅人 · 连续 ' + time.monthStreak + ' 个月出发');
        return list;
    }

    // 一句条件称号都没解锁时的兜底，不算进「N / 13」
    function insightFallbackTitle(m) {
        return '刚出发的旅人 · ' + m.footprintCount + ' 段旅程';
    }

    // 还是保留「给一个最贴切的」这个入口，给需要单句的地方用
    function insightTitleOf(m, time, province, segment, stats) {
        const list = insightTitlesOf(m, time, province, segment, stats);
        return list.length ? list[0] : insightFallbackTitle(m);
    }

    function insightMetrics() {
        const fps = FOOTPRINTS.filter(fp => fp.lat && fp.lng);
        const sorted = fps.slice().sort((a, b) =>
            String(a.createTime || '').localeCompare(String(b.createTime || '')));
        const distance = sorted.slice(1).reduce((sum, fp, i) =>
            sum + haversineKm(sorted[i], fp), 0);
        const months = fps.map(fp => Number(String(fp.createTime || '').slice(5, 7))).filter(Boolean);
        const seasonCount = { 春: 0, 夏: 0, 秋: 0, 冬: 0 };
        months.forEach(m => {
            if (m >= 3 && m <= 5) seasonCount['春']++;
            else if (m >= 6 && m <= 8) seasonCount['夏']++;
            else if (m >= 9 && m <= 11) seasonCount['秋']++;
            else seasonCount['冬']++;
        });
        const topSeason = Object.entries(seasonCount).sort((a, b) => b[1] - a[1])[0];
        const typeCount = {};
        fps.forEach(fp => {
            const t = fp.footprintType || '旅行';
            typeCount[t] = (typeCount[t] || 0) + 1;
        });
        const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
        const byLat = [...fps].sort((a, b) => a.lat - b.lat);
        const byLng = [...fps].sort((a, b) => a.lng - b.lng);
        return {
            footprintCount: FOOTPRINTS.length,
            cityCount: cityList.length,
            // 足迹洞察看的是全部数据：这里不能用 ticketItemsFromFootprints()，
            // 它认票根页的「只看某座城市」筛选，会把概览的票根数和票根收藏家一起算少
            ticketCount: FOOTPRINTS.filter(fp => ticketImageUrl(fp.ticketImage)).length,
            photoCount: FOOTPRINTS.reduce((n, fp) => n + cityWallImages(fp).length, 0),
            distanceKm: Math.round(distance),
            topSeason: topSeason && topSeason[1] ? topSeason[0] : '',
            topSeasonCount: topSeason ? topSeason[1] : 0,
            topType: topType && topType[1] ? topType[0] : '',
            topTypeCount: topType ? topType[1] : 0,
            south: byLat[0], north: byLat[byLat.length - 1],
            west: byLng[0], east: byLng[byLng.length - 1]
        };
    }

    // 概览卡的几句总结：数据是真的，语气留一点文艺。
    // 说法大致按「总览 → 节奏 → 地理 → 偏爱 → 距离 → 收藏 → 年份 → 称号」铺开，
    // 缺哪块数据就跳过哪句：「换一个说法」在数据齐全时能翻二十来次，数据少时也不会露出空话。
    // 第 1 句保持任何数据都成立，打开洞察时默认显示的就是它。
    function insightSentences(m, time, province, segment, extras = {}) {
        const years = extras.years || [];
        const title = extras.title || '';
        const longest = segment && segment.longest;
        const list = [];
        list.push('约 ' + m.footprintCount + ' 次出发、' + m.cityCount +
            ' 座城市，地图上的每一处坐标都是一个故事。');
        if (m.distanceKm) {
            list.push(m.cityCount + ' 座城市、约 ' + m.distanceKm.toLocaleString('zh-CN') +
                ' 公里的路，是你一步一步走出来的版图。');
        }
        list.push((m.topSeason ? '你似乎总在' + m.topSeason + '天收拾行囊，' : '你总在合适的时候出发，') +
            (m.topType ? '「' + m.topType + '」是你写得最多的一页。' : '每一程都值得被记住。'));

        // 节奏：平均多久出发一次。密一点说「熟练」，疏一点说「算数」
        if (time && m.footprintCount >= 3) {
            const gapDays = Math.round(time.spanDays / (m.footprintCount - 1));
            if (gapDays > 0) {
                list.push(m.footprintCount + ' 次出发散在 ' + time.monthCount + ' 个月里，平均每 ' + gapDays +
                    (gapDays <= 60
                        ? ' 天就收拾一次行李 —— 出发这件事，你早就做得很熟练。'
                        : ' 天才动身一回 —— 不算频繁，但每一次都算数。'));
            }
        }
        if (time && time.monthStreak >= 3) {
            list.push('最长的一段，你连着 ' + time.monthStreak +
                ' 个月都在路上 —— 那段时间，行李箱大概一直没收起来过。');
        }
        if (time && time.topMonthCount >= 2) {
            list.push(time.topMonth + ' 月是你的高发期，前后一共出发了 ' + time.topMonthCount +
                ' 次，那个月份的风，你大概最熟悉。');
        }
        if (m.topSeason && m.topSeasonCount >= 2) {
            list.push(m.topSeason + '季是你最常选中的时节，' + m.topSeasonCount + ' 次出发落在了那里。');
        }

        if (province && province.total) {
            list.push(province.total + ' 个省份里，' + province.list[0].name +
                '被你翻开的次数最多 —— 那里大概有值得反复抵达的理由。');
        }
        // 地理跨度：纬度看南北，经度看东西
        const latSpan = m.south && m.north ? Math.abs(m.north.lat - m.south.lat) : 0;
        if (latSpan >= 3) {
            list.push('从最南的 ' + insightPlaceName(m.south) + ' 到最北的 ' + insightPlaceName(m.north) +
                '，你把 ' + latSpan.toFixed(1) + ' 个纬度装进了自己的地图。');
        } else if (!province.total && m.south && m.north &&
            insightPlaceName(m.south) !== insightPlaceName(m.north)) {
            list.push('从 ' + insightPlaceName(m.south) + ' 到 ' + insightPlaceName(m.north) +
                '，世界在地图上被你慢慢点亮。');
        }
        if (m.west && m.east) {
            const lngSpan = Math.abs(m.east.lng - m.west.lng);
            if (lngSpan >= 3) {
                list.push('最东是 ' + insightPlaceName(m.east) + '，最西是 ' + insightPlaceName(m.west) +
                    '，中间隔着 ' + lngSpan.toFixed(1) + ' 个经度 —— 那是你横向丈量世界的方式。');
            }
        }

        // 偏爱：回去得最多的那座城市，以及所有被重复抵达过的城市
        let topCityName = '';
        let topCityVisits = 0;
        let repeatCities = 0;
        cityList.forEach((city, ci) => {
            const visits = cityViewItems(ci).length;
            if (visits >= 2) repeatCities += 1;
            if (visits > topCityVisits) {
                topCityVisits = visits;
                topCityName = city.city || '';
            }
        });
        if (topCityName && topCityVisits >= 2) {
            list.push('在 ' + m.cityCount + ' 座城市里，' + topCityName + ' 是你回去最多的地方（' +
                topCityVisits + ' 次），有些地方就是值得反复抵达。');
        }
        if (repeatCities >= 2) {
            list.push('有 ' + repeatCities + ' 座城市你去过两次以上，它们大概更像「老地方」。');
        }

        if (longest) {
            list.push('走得最远的一次，是从' + insightPlaceName(longest.from) + '到' +
                insightPlaceName(longest.to) + '，约 ' + insightKm(longest.km) + ' 公里。');
        }
        if (segment && segment.count >= 2 && segment.average > 0) {
            list.push('平均每一段约 ' + insightKm(segment.average) +
                ' 公里，步子不算大，但一直没有停下来过。');
        }

        // 收藏：照片和票根都有就合起来说，只有一样时只说那一样
        if (m.ticketCount && m.photoCount) {
            list.push(m.photoCount + ' 张照片、' + m.ticketCount +
                ' 张票根，你不仅出发，也把它们都妥帖地留了下来。');
        } else {
            list.push(m.ticketCount
                ? '你还留下了 ' + m.ticketCount + ' 张票根，每一次出发都被妥帖地收着。'
                : m.photoCount + ' 张照片被好好收着，' +
                    (m.photoCount > 1 ? '它们替你说着' : '它替你说着') + '当时的光线与心情。');
        }
        if (m.photoCount - m.footprintCount >= 2) {
            list.push('照片比足迹多出 ' + (m.photoCount - m.footprintCount) +
                ' 张 —— 有些地方，你显然舍不得只拍一张。');
        }

        if (time && time.spanDays > 0) {
            list.push('从 ' + insightSpotDate(time.first) + ' 到 ' + insightSpotDate(time.last) + '，' +
                (time.spanYears > 0
                    ? time.spanYears + ' 年 ' + time.restDays + ' 天'
                    : time.spanDays + ' 天') +
                '的光阴，被你拆成了 ' + time.monthCount + ' 个月的出发。');
        }
        if (years.length >= 2) {
            const busiest = years.reduce((best, item) =>
                item.footprints > best.footprints ? item : best, years[0]);
            list.push(busiest.year + ' 年是你出发最多的一年，一共 ' + busiest.footprints +
                ' 次，那一年你把地图铺得最开。');
        }
        if (title) {
            list.push('按现在的记录，你担得起「' + title + '」—— 这不是标签，是你自己走出来的。');
        }
        return list.length ? list : ['还没有足迹数据，出发后回来看看你的旅行洞察。'];
    }

    // ---- 洞察卡：数据 -> DOM ----
    function insightMetric(label, value, opts = {}) {
        return { label, value, hint: opts.hint || '', action: opts.action || null };
    }

    function insightMetricsDom(items, id) {
        const wrap = document.createElement('div');
        wrap.className = 'insight-metrics';
        if (id) wrap.id = id;
        items.forEach(item => {
            const node = document.createElement(item.action ? 'button' : 'div');
            node.className = 'insight-metric' + (item.action ? ' is-link' : '');
            if (item.action) {
                node.type = 'button';
                node.addEventListener('click', item.action);
            }
            const label = document.createElement('span');
            label.className = 'insight-metric-label';
            label.textContent = item.label;
            const value = document.createElement('strong');
            value.className = 'insight-metric-value';
            value.textContent = item.value;
            node.append(label, value);
            if (item.hint) {
                const hint = document.createElement('em');
                hint.className = 'insight-metric-hint';
                hint.textContent = item.hint;
                node.appendChild(hint);
            }
            wrap.appendChild(node);
        });
        return wrap;
    }

    // 12 个月分布条
    function insightMonthsDom(months) {
        const wrap = document.createElement('div');
        wrap.className = 'insight-months';
        wrap.setAttribute('aria-hidden', 'true');
        const max = Math.max(1, ...months);
        months.forEach((count, i) => {
            const col = document.createElement('div');
            col.className = 'insight-month' +
                (count && count === max ? ' is-top' : '') +
                (count ? '' : ' is-empty');
            col.title = (i + 1) + ' 月 · ' + count + ' 次';
            const bar = document.createElement('span');
            bar.className = 'insight-month-bar';
            bar.style.setProperty('--month-ratio', String(count / max));
            const label = document.createElement('em');
            label.textContent = String(i + 1);
            col.append(bar, label);
            wrap.appendChild(col);
        });
        return wrap;
    }

    function insightChipsDom(chips) {
        const wrap = document.createElement('div');
        wrap.className = 'insight-chips';
        chips.forEach(chip => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'insight-chip' + (chip.className ? ' ' + chip.className : '') +
                (chip.active ? ' is-active' : '');
            btn.textContent = chip.text;
            btn.setAttribute('aria-pressed', chip.active ? 'true' : 'false');
            btn.addEventListener('click', chip.onClick);
            wrap.appendChild(btn);
        });
        return wrap;
    }

    function insightBadgesDom(badges) {
        const wrap = document.createElement('div');
        wrap.className = 'insight-badges';
        badges.forEach(item => {
            const row = document.createElement('div');
            row.className = 'insight-badge' + (item.done ? ' is-earned' : ' is-locked');
            const mark = document.createElement('span');
            mark.className = 'insight-badge-mark';
            mark.textContent = item.done ? '✓' : '·';
            const text = document.createElement('span');
            text.className = 'insight-badge-text';
            const name = document.createElement('strong');
            name.textContent = item.name;
            const desc = document.createElement('em');
            // 已点亮的给结果值（12 个省），没点亮的给「还差多少」——
            // 只写 6/24 的话得自己算还差几张
            const detail = item.done ? item.progress : (item.remaining || item.progress);
            desc.textContent = item.desc + (detail ? ' · ' + detail : '');
            text.append(name, desc);
            row.append(mark, text);
            wrap.appendChild(row);
        });
        return wrap;
    }

    function insightCardDom(card) {
        const section = document.createElement('section');
        section.className = 'insight-card';
        section.dataset.cardId = card.id;
        section.setAttribute('role', 'tabpanel');
        const kicker = document.createElement('p');
        kicker.className = 'insight-kicker';
        kicker.textContent = card.kicker;
        const headline = document.createElement('h3');
        headline.className = 'insight-headline';
        if (card.headlineId) headline.id = card.headlineId;
        headline.textContent = card.headline;
        section.append(kicker, headline);
        if (card.note) {
            const note = document.createElement('p');
            note.className = 'insight-card-note';
            note.textContent = card.note;
            section.appendChild(note);
        }
        if (card.chips && card.chips.length) section.appendChild(insightChipsDom(card.chips));
        if (card.months) section.appendChild(insightMonthsDom(card.months));
        if (card.metrics && card.metrics.length) section.appendChild(insightMetricsDom(card.metrics, card.metricsId));
        if (card.badges && card.badges.length) section.appendChild(insightBadgesDom(card.badges));
        return section;
    }

    function insightYearHeadline(item) {
        return item.year + ' 年 · ' + item.footprints + ' 次出发、' + item.cities + ' 座城市' +
            (item.km ? '，约 ' + insightKm(item.km) + ' 公里' : '') + '。';
    }

    function insightYearMetrics(item) {
        return [
            insightMetric('足迹', item.footprints + ' 次'),
            insightMetric('城市', item.cities + ' 座'),
            insightMetric('省份', item.provinces.length + ' 个'),
            insightMetric('照片', item.photos + ' 张'),
            insightMetric('票根', item.tickets + ' 张'),
            insightMetric('估算里程', item.km ? insightKm(item.km) + ' km' : '—'),
            insightMetric('到访月份', item.months + ' 个月'),
            insightMetric('到访季节', item.seasons.join('、') || '—')
        ];
    }

    function refreshInsightYearCard(index) {
        const years = insightYearStats(FOOTPRINTS);
        if (!years.length) return;
        insightYearIndex = Math.max(0, Math.min(index, years.length - 1));
        const active = years[insightYearIndex];
        const headline = document.getElementById('insightYearHeadline');
        if (headline) headline.textContent = insightYearHeadline(active);
        const metrics = document.getElementById('insightYearMetrics');
        if (metrics) metrics.replaceWith(insightMetricsDom(insightYearMetrics(active), 'insightYearMetrics'));
        if (!insightDeck) return;
        [...insightDeck.querySelectorAll('.insight-year-chip')].forEach((chip, i) => {
            chip.classList.toggle('is-active', i === insightYearIndex);
            chip.setAttribute('aria-pressed', i === insightYearIndex ? 'true' : 'false');
        });
    }

    // 只换概览那句话，下面那张统计表保持原样：
    // 以前是整张卡重建，统计表会跟着重放一次淡入动画
    function swapInsightSentence() {
        if (!insightSentenceCache.length) return;
        insightSentenceVariant = (insightSentenceVariant + 1) % insightSentenceCache.length;
        const node = document.getElementById('insightOverviewHeadline');
        if (!node) return;
        node.classList.remove('is-swapping');
        void node.offsetWidth;   // 触发重排，让动画能重新播
        node.textContent = insightSentenceCache[insightSentenceVariant];
        node.classList.add('is-swapping');
    }

    // 换一个称号：只改成就卡那句和顶栏副标题，徽章表与卡片结构都不动。
    // 称号在两个地方同时出现，所以必须一起更新，不然顶栏和卡里会对不上
    function swapInsightTitle() {
        if (insightTitleCache.length < 2) return;
        insightTitleVariant = (insightTitleVariant + 1) % insightTitleCache.length;
        const next = insightTitleCache[insightTitleVariant];
        const node = document.getElementById('insightBadgeHeadline');
        if (node) {
            node.classList.remove('is-swapping');
            void node.offsetWidth;   // 触发重排，让动画能重新播
            node.textContent = '「' + next + '」';
            node.classList.add('is-swapping');
        }
        if (insightTitleEl) insightTitleEl.textContent = next;
    }

    // 点数字直达对应内容：票根墙 / 某座城市 / 某省
    function insightOpenTicketWall() {
        closeInsight(false);
        setTicketView(true);
    }

    function insightOpenCity(cityName) {
        const ci = cityList.findIndex(city => city.city === cityName);
        if (ci < 0) return;
        closeInsight(false);
        openCityView(ci, null);
    }

    function insightFilterProvince(name) {
        if (!name) return;
        closeInsight(false);
        setCityWallProvinceFilter(name);
    }

    function insightCardsData() {
        const m = insightMetrics();
        const time = insightTimeStats(FOOTPRINTS);
        const province = insightProvinceStats(FOOTPRINTS);
        const segment = insightSegmentStats(FOOTPRINTS);
        const type = insightTypeStats(FOOTPRINTS);
        const years = insightYearStats(FOOTPRINTS);
        const derived = insightDerived(segment);
        const badges = insightAchievements(m, time, province, segment, derived);
        const titles = insightTitlesOf(m, time, province, segment, derived);
        insightTitleCache = titles;
        if (insightTitleVariant >= titles.length) insightTitleVariant = 0;
        const title = titles.length
            ? titles[insightTitleVariant % titles.length]
            : insightFallbackTitle(m);
        if (!FOOTPRINTS.length) {
            return {
                title: '',
                cards: [{
                    id: 'empty',
                    kicker: 'TRAVEL SUMMARY',
                    headline: '还没有足迹数据，出发后回来看看你的旅行洞察。',
                    metrics: []
                }]
            };
        }
        const sentences = insightSentences(m, time, province, segment, { years, title });
        insightSentenceCache = sentences;
        if (insightSentenceVariant >= sentences.length) insightSentenceVariant = 0;
        const cards = [];

        // 1. 概览
        cards.push({
            id: 'overview',
            kicker: 'TRAVEL SUMMARY',
            headlineId: 'insightOverviewHeadline',
            headline: sentences[insightSentenceVariant % sentences.length],
            chips: [{
                text: '换一个说法',
                onClick: swapInsightSentence
            }],
            metrics: [
                insightMetric('足迹', m.footprintCount + ' 次', { action: () => closeInsight() }),
                insightMetric('城市', m.cityCount + ' 座', { action: () => closeInsight() }),
                insightMetric('票根', m.ticketCount + ' 张', { action: insightOpenTicketWall }),
                insightMetric('照片', m.photoCount + ' 张'),
                insightMetric('估算里程', m.distanceKm ? m.distanceKm.toLocaleString('zh-CN') + ' km' : '—'),
                insightMetric('出发季节', m.topSeason ? m.topSeason + '（' + m.topSeasonCount + ' 次）' : '—')
            ]
        });

        // 2. 时间
        if (time) {
            const spanText = time.spanYears > 0
                ? time.spanYears + ' 年 ' + time.restDays + ' 天'
                : time.spanDays + ' 天';
            cards.push({
                id: 'time',
                kicker: 'TIMELINE · 时间',
                headline: '第一次出发是在 ' + insightSpotDate(time.first) + ' 的' +
                    insightPlaceName(time.first) + '，最近一次停在 ' + insightSpotDate(time.last) + ' 的' +
                    insightPlaceName(time.last) + ' —— 这条路，你走了 ' + spanText + '。',
                months: time.months,
                metrics: [
                    insightMetric('首次出发', insightSpotDate(time.first), { hint: insightPlaceName(time.first) }),
                    insightMetric('最近一次', insightSpotDate(time.last), { hint: insightPlaceName(time.last) }),
                    insightMetric('最常出发的月份', time.topMonth + ' 月 · ' + time.topMonthCount + ' 次'),
                    insightMetric('出行过的月份', time.monthCount + ' 个月'),
                    insightMetric('最长连续出行', time.monthStreak + ' 个月'),
                    insightMetric('旅行跨度', spanText)
                ]
            });
        }

        // 3. 省份：点某个省 → 回到卡片墙并只看这个省
        if (province.total) {
            cards.push({
                id: 'province',
                kicker: 'PROVINCES · 省份',
                headline: province.total + ' 个省份、' + m.cityCount + ' 座城市，' +
                    province.list[0].name + '留下了你最多的脚印。',
                metrics: province.list.slice(0, 9).map(item => insightMetric(
                    item.name,
                    item.cities + ' 座城市 · ' + item.footprints + ' 个足迹',
                    { action: () => insightFilterProvince(item.name) }
                ))
            });
        }

        // 4. 距离与方位：点城市进对应图片墙
        if (segment.count) {
            const longest = segment.longest;
            const shortest = segment.shortest;
            cards.push({
                id: 'segment',
                kicker: 'DISTANCE · 距离',
                headline: '最长的一次远行，是从' + insightPlaceName(longest.from) + '到' +
                    insightPlaceName(longest.to) + '，约 ' + insightKm(longest.km) + ' 公里。',
                metrics: [
                    insightMetric('最长一段', insightKm(longest.km) + ' km', {
                        hint: insightPlaceName(longest.from) + ' → ' + insightPlaceName(longest.to),
                        action: () => insightOpenCity(longest.to.city)
                    }),
                    insightMetric('最短一段', insightKm(shortest.km) + ' km', {
                        hint: insightPlaceName(shortest.from) + ' → ' + insightPlaceName(shortest.to)
                    }),
                    insightMetric('平均每段', insightKm(segment.average) + ' km'),
                    insightMetric('累计里程', insightKm(segment.totalKm) + ' km'),
                    insightMetric('最北', insightPlaceName(segment.north), {
                        action: () => insightOpenCity(segment.north.city)
                    }),
                    insightMetric('最南', insightPlaceName(segment.south), {
                        action: () => insightOpenCity(segment.south.city)
                    }),
                    insightMetric('最东', insightPlaceName(segment.east), {
                        action: () => insightOpenCity(segment.east.city)
                    }),
                    insightMetric('最西', insightPlaceName(segment.west), {
                        action: () => insightOpenCity(segment.west.city)
                    })
                ]
            });
        }

        // 5. 类型与季节交叉
        if (type.list.length) {
            const top = type.list[0];
            cards.push({
                id: 'type',
                kicker: 'TYPES · 主题',
                headline: '「' + top.name + '」出现了 ' + top.count + ' 次' +
                    (top.season
                        ? '，' + top.season + '天的风里，你出发得最多。'
                        : '，是你写得最多的一页。'),
                metrics: type.list.slice(0, 9).map(item => insightMetric(
                    item.name,
                    item.count + ' 次',
                    { hint: item.season ? '多在' + item.season + '天（' + item.seasonCount + ' 次）' : '' }
                ))
            });
        }

        // 6. 年度回顾：卡内切换年份
        if (years.length) {
            if (insightYearIndex >= years.length) insightYearIndex = 0;
            const active = years[insightYearIndex];
            cards.push({
                id: 'year',
                kicker: 'YEAR IN REVIEW · 年度回顾',
                headlineId: 'insightYearHeadline',
                headline: insightYearHeadline(active),
                chips: years.map((item, i) => ({
                    text: item.year + ' 年',
                    className: 'insight-year-chip',
                    active: i === insightYearIndex,
                    onClick: () => refreshInsightYearCard(i)
                })),
                metricsId: 'insightYearMetrics',
                metrics: insightYearMetrics(active)
            });
        }

        // 7. 称号与轻成就
        if (badges.length) {
            cards.push({
                id: 'badge',
                kicker: 'ACHIEVEMENTS · 称号与成就',
                headlineId: 'insightBadgeHeadline',
                headline: '「' + title + '」',
                note: titles.length ? '已解锁 ' + titles.length + ' / ' + INSIGHT_TITLE_SLOTS + ' 个称号' : '',
                chips: titles.length > 1 ? [{ text: '换一个称号', onClick: swapInsightTitle }] : [],
                badges
            });
        }

        return { title, cards };
    }

    function renderInsightDots() {
        const single = insightCards.length < 2;
        if (insightDots) {
            insightDots.innerHTML = '';
            insightDots.hidden = single;
            insightCards.forEach((card, i) => {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = 'insight-dot' + (i === insightCardIndex ? ' is-active' : '');
                dot.setAttribute('role', 'tab');
                dot.setAttribute('aria-selected', i === insightCardIndex ? 'true' : 'false');
                dot.setAttribute('aria-label', '第 ' + (i + 1) + ' 张：' + card.kicker);
                dot.addEventListener('click', () => showInsightCard(i));
                insightDots.appendChild(dot);
            });
        }
        // 「3 / 7」：一眼看清在第几张、总共几张，点一下看下一张
        if (insightPageCount) {
            insightPageCount.hidden = single;
            insightPageCount.textContent = (insightCardIndex + 1) + ' / ' + insightCards.length;
            insightPageCount.setAttribute('aria-label',
                '第 ' + (insightCardIndex + 1) + ' 张，共 ' + insightCards.length + ' 张，点击看下一张');
        }
    }

    function showInsightCard(index) {
        if (!insightDeck || !insightCards.length) return;
        insightCardIndex = (index + insightCards.length) % insightCards.length;
        [...insightDeck.children].forEach((el, i) => {
            el.classList.toggle('is-active', i === insightCardIndex);
        });
        renderInsightDots();
        // 翻页后回到顶部，避免长卡片停在中间（真正滚动的是 feature-body）
        const scroller = insightView.querySelector('.feature-body');
        if (scroller && scroller.scrollTop) scroller.scrollTop = 0;
    }

    function renderInsight() {
        if (!insightDeck) return;
        const data = insightCardsData();
        insightCards = data.cards;
        if (insightTitleEl) insightTitleEl.textContent = data.title || '';
        insightDeck.innerHTML = '';
        insightCards.forEach(card => insightDeck.appendChild(insightCardDom(card)));
        if (insightCardIndex >= insightCards.length) insightCardIndex = 0;
        const single = insightCards.length < 2;
        if (insightPrevCard) insightPrevCard.hidden = single;
        if (insightNextCard) insightNextCard.hidden = single;
        showInsightCard(insightCardIndex);
    }

    function openInsight() {
        if (!featureEnabled('enableInsight') || !insightView) return;
        // 说法序号不重置：关掉再打开会接着上一句往下走，而不是每次都被拉回同一句
        insightCardIndex = 0;
        insightYearIndex = 0;
        renderInsight();
        insightView.classList.add('show');
        setOverlayHidden(insightView, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            insightBack.focus();
        }
    }

    function closeInsight(returnFocus = true) {
        if (!insightView || !insightView.classList.contains('show')) return;
        insightView.classList.remove('show');
        setOverlayHidden(insightView, true);
        if (returnFocus) focusCityWallTop();
    }

    // ---------------- 旅行明信片 ----------------
    const postcardPreview = document.getElementById('postcardPreview');
    const postcardBack = document.getElementById('postcardBack');
    const postcardTitle = document.getElementById('postcardTitle');
    const postcardPreviewImg = document.getElementById('postcardPreviewImg');
    const postcardDownload = document.getElementById('postcardDownload');
    const postcardShare = document.getElementById('postcardShare');
    const postcardStage = document.getElementById('postcardStage');
    const postcardStatus = document.getElementById('postcardStatus');
    const postcardRetry = document.getElementById('postcardRetry');
    let postcardCi = -1;
    let postcardBlobUrl = '';
    let postcardFileName = '旅行明信片.png';

    if (typeof CanvasRenderingContext2D !== 'undefined' &&
        !CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
            r = Math.min(r || 0, w / 2, h / 2);
            this.moveTo(x + r, y);
            this.arcTo(x + w, y, x + w, y + h, r);
            this.arcTo(x + w, y + h, x, y + h, r);
            this.arcTo(x, y + h, x, y, r);
            this.arcTo(x, y, x + w, y, r);
            this.closePath();
        };
    }

    function cityPostcardData(ci) {
        const city = cityList[ci];
        return {
            city: city ? city.city : '未知城市',
            province: '',
            ...cityWallCardData(ci)
        };
    }

    function loadPostcardImage(url) {
        return new Promise(resolve => {
            const img = new Image();
            // 强制走 CORS 模式：万一图片又跳到别的域名，加载会失败而不是悄悄把 canvas 污染掉
            // （canvas 一旦被污染，后面 toBlob 会直接抛 SecurityError，写信就整张出不来）
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = canvasSafeImageUrl(url);
        });
    }

    /**
     * 票根图可能放在别的域名（图床 / CDN，本地开发时页面域名和图片域名也常常不同）。
     * 跨域图既会被 CORS 拦掉，画进 canvas 之后也没法导出（toBlob 抛 SecurityError），
     * 所以跨域图统一走插件的同源代理 /footprints/image-proxy。
     */
    function canvasSafeImageUrl(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url, window.location.href);
            if (parsed.origin === window.location.origin) return url;
            return '/footprints/image-proxy?url=' + encodeURIComponent(parsed.href);
        } catch (e) {
            return url;
        }
    }

    // 城市小结：以真实照片为主角，讲"我和这座城市的关系"（第一次去 / 最近一次 / 走过的地方），
    // 不再是城市卡片墙那张卡的信息截图
    function postcardCanvas(data, image) {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1440;
        const ctx = canvas.getContext('2d');
        const ink = '#35423d';
        const muted = '#8b7865';
        const accent = '#9b704e';

        const bg = ctx.createLinearGradient(0, 0, 0, 1440);
        bg.addColorStop(0, '#e8e0d2');
        bg.addColorStop(1, '#d9cfbd');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 1080, 1440);
        ctx.strokeStyle = 'rgba(118,92,61,0.32)';
        ctx.lineWidth = 3;
        ctx.strokeRect(28, 28, 1024, 1384);

        ctx.fillStyle = accent;
        ctx.font = '600 30px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('CITY POSTCARD · 旅行明信片', 540, 118);

        const cityName = data.city || '';
        ctx.fillStyle = ink;
        ctx.font = cityName.length > 6
            ? '400 72px "PingFang SC", "Microsoft YaHei", serif'
            : '400 96px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText(cityName, 540, 216);

        const subline = [data.province, data.count ? data.count + ' 个足迹' : ''].filter(Boolean).join(' · ');
        if (subline) {
            ctx.fillStyle = muted;
            ctx.font = '30px "PingFang SC", "Microsoft YaHei", serif';
            ctx.fillText(subline, 540, 270);
        }

        // 真实照片当主角：cover 满铺 + clip，不垫底、不留白边
        const photoX = 42;
        const photoW = 996;
        const photoTop = 318;
        const photoH = 600;
        if (image) {
            const scale = Math.max(photoW / image.width, photoH / image.height);
            const dw = image.width * scale;
            const dh = image.height * scale;
            ctx.save();
            ctx.beginPath();
            ctx.rect(photoX, photoTop, photoW, photoH);
            ctx.clip();
            ctx.drawImage(image, photoX + (photoW - dw) / 2, photoTop + (photoH - dh) / 2, dw, dh);
            ctx.restore();
        } else {
            const g = ctx.createLinearGradient(photoX, photoTop, photoX + photoW, photoTop + photoH);
            g.addColorStop(0, '#cdbfa6');
            g.addColorStop(1, '#b09a7d');
            ctx.fillStyle = g;
            ctx.fillRect(photoX, photoTop, photoW, photoH);
            ctx.fillStyle = 'rgba(255,253,247,0.9)';
            ctx.font = '400 220px "Noto Serif SC", "Songti SC", serif';
            ctx.fillText((data.city || '?').charAt(0), 540, photoTop + photoH * 0.62);
        }

        // 第一次去 / 最近一次：这张小结真正多出来的信息
        ctx.fillStyle = muted;
        ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText('第一次去', 320, 1002);
        ctx.fillText('最近一次', 760, 1002);
        ctx.fillStyle = ink;
        ctx.font = '34px ui-monospace, Consolas, monospace';
        ctx.fillText(data.first ? formatCityDate(data.first) : '—', 320, 1050);
        ctx.fillText(data.latest ? formatCityDate(data.latest) : '—', 760, 1050);

        ctx.strokeStyle = 'rgba(118,92,61,0.24)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(140, 1104);
        ctx.lineTo(940, 1104);
        ctx.stroke();

        // 走过的地方：这座城市里到过的足迹名
        const places = (data.places || []).join(' · ');
        if (places) {
            ctx.fillStyle = muted;
            ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
            ctx.fillText('走过的地方', 540, 1154);
            ctx.fillStyle = ink;
            ctx.font = '30px "PingFang SC", "Microsoft YaHei", serif';
            wrapTicketLetterText(ctx, places, 860).slice(0, 2).forEach((line, i) => {
                ctx.fillText(line, 540, 1210 + i * 46);
            });
        }

        ctx.fillStyle = muted;
        ctx.font = '26px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText(
            data.count + ' 个足迹 · ' + data.photos + ' 张照片 · ' + data.tickets + ' 张票根',
            540, 1330
        );

        ctx.fillStyle = muted;
        ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText('旅行记忆 · Travel Memory', 540, 1380);
        return canvas;
    }

    function postcardToBlob(canvas) {
        return new Promise(resolve => {
            try {
                canvas.toBlob(blob => resolve(blob), 'image/png');
            } catch (e) {
                resolve(null);
            }
        });
    }

    // 明信片页三种状态：loading（骨架 + 文案）/ ready（出图 + 可下载）/ error（说明 + 重新生成）
    function setPostcardState(state) {
        if (postcardStage) {
            postcardStage.classList.toggle('is-loading', state === 'loading');
            postcardStage.classList.toggle('is-ready', state === 'ready');
            postcardStage.classList.toggle('is-error', state === 'error');
            postcardStage.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
        }
        if (postcardStatus) {
            postcardStatus.textContent = state === 'loading'
                ? '正在生成明信片…'
                : (state === 'error' ? '这张明信片没能生成，可能是城市照片取不到。' : '');
        }
        if (postcardRetry) postcardRetry.hidden = state !== 'error';
        if (postcardDownload) postcardDownload.disabled = state !== 'ready';
    }

    async function renderPostcardPreview() {
        if (postcardBlobUrl) URL.revokeObjectURL(postcardBlobUrl);
        const data = cityPostcardData(postcardCi);
        postcardTitle.textContent = data.city + ' · 旅行明信片';
        const city = cityList[postcardCi];
        data.province = city ? cityViewItems(postcardCi).map(fp => fp.province).find(Boolean) || '' : '';
        if (postcardShare) postcardShare.hidden = true;
        setPostcardState('loading');
        // 明信片是拿去下载/分享的成品图，用未经"缩略图替换规则"处理的原始地址；
        // 城市卡片墙继续用小图（cover），翻页才轻快
        const coverUrl = data.coverRaw || data.cover;
        const image = coverUrl ? await loadPostcardImage(coverUrl) : null;
        let canvas = postcardCanvas(data, image);
        let blob = await postcardToBlob(canvas);
        if (!blob) {
            canvas = postcardCanvas(data, null);
            blob = await postcardToBlob(canvas);
        }
        if (!blob) {
            setPostcardState('error');
            return;
        }
        postcardBlobUrl = URL.createObjectURL(blob);
        postcardPreviewImg.src = postcardBlobUrl;
        setPostcardState('ready');
        const ts = (data.latest || '').replace(/-/g, '');
        postcardFileName = data.city + '-' + (ts || 'postcard') + '-旅行明信片.png';
        postcardShare.hidden = !(
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [new File([blob], postcardFileName, { type: 'image/png' })] })
        );
    }

    async function openPostcard(ci, triggerBtn) {
        if (!featureEnabled('enablePostcard') || !cityList[ci] || !postcardPreview) return;
        postcardCi = ci;
        setPostcardState('loading');
        postcardPreviewImg.removeAttribute('src');
        postcardPreview.classList.add('show');
        setOverlayHidden(postcardPreview, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            postcardBack.focus();
        }
        await renderPostcardPreview();
    }

    function closePostcard(returnFocus = true) {
        if (!postcardPreview || !postcardPreview.classList.contains('show')) return;
        postcardPreview.classList.remove('show');
        setOverlayHidden(postcardPreview, true);
        postcardPreviewImg.removeAttribute('src');
        setPostcardState('loading');   // 下次打开从骨架态开始
        if (postcardBlobUrl) {
            URL.revokeObjectURL(postcardBlobUrl);
            postcardBlobUrl = '';
        }
        postcardCi = -1;
        if (returnFocus) focusCityWallTop();
    }

    function downloadPostcard() {
        if (!postcardBlobUrl) return;
        const a = document.createElement('a');
        a.href = postcardBlobUrl;
        a.download = postcardFileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    async function sharePostcard() {
        if (!postcardBlobUrl) return;
        const blob = await fetch(postcardBlobUrl).then(r => r.blob());
        const file = new File([blob], postcardFileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: postcardFileName });
            } catch (e) { /* 用户取消分享无需处理 */ }
        }
    }

    if (cityWallTimeCapsuleBtn) cityWallTimeCapsuleBtn.addEventListener('click', openTimeCapsule);
    if (cityWallInsightBtn) cityWallInsightBtn.addEventListener('click', openInsight);
    timeCapsuleBack.addEventListener('click', () => closeTimeCapsule());
    timeCapsulePrev.addEventListener('click', () => {
        if (timeCapsuleItemsCache.length < 2) return;
        timeCapsuleIndex = (timeCapsuleIndex - 1 + timeCapsuleItemsCache.length) % timeCapsuleItemsCache.length;
        renderTimeCapsule();
    });
    timeCapsuleNext.addEventListener('click', () => {
        if (timeCapsuleItemsCache.length < 2) return;
        timeCapsuleIndex = (timeCapsuleIndex + 1) % timeCapsuleItemsCache.length;
        renderTimeCapsule();
    });
    insightBack.addEventListener('click', () => closeInsight());
    if (insightPrevCard) insightPrevCard.addEventListener('click', () => showInsightCard(insightCardIndex - 1));
    if (insightNextCard) insightNextCard.addEventListener('click', () => showInsightCard(insightCardIndex + 1));
    if (insightPageCount) insightPageCount.addEventListener('click', () => showInsightCard(insightCardIndex + 1));
    // 洞察卡左右翻页也支持键盘
    document.addEventListener('keydown', event => {
        if (!insightView || !insightView.classList.contains('show')) return;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showInsightCard(insightCardIndex - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            showInsightCard(insightCardIndex + 1);
        }
    });
    postcardBack.addEventListener('click', () => closePostcard());
    postcardDownload.addEventListener('click', downloadPostcard);
    postcardShare.addEventListener('click', sharePostcard);
    postcardRetry.addEventListener('click', () => { renderPostcardPreview(); });
    [timeCapsule, insightView, postcardPreview].forEach(overlay => {
        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                if (overlay === timeCapsule) closeTimeCapsule();
                else if (overlay === insightView) closeInsight();
                else closePostcard();
            }
        });
    });

    cityWallBtn.addEventListener('click', openCityWall);
    cityWallBack.addEventListener('click', () => closeCityWall());
    if (cityWallProvinceFilter) {
        cityWallProvinceFilter.addEventListener('click', () => setCityWallProvinceFilter(''));
    }
    // 数据重新加载（如刷新直达）后，若卡片墙正处于打开状态则重建
    document.addEventListener('footprints:loaded', () => {
        if (cityWall && cityWall.classList.contains('show')) renderCityWall();
    });

    // ================= 加载足迹数据并重建标记 =================
    loadFootprintsFromJson().then(loaded => {
        if (applyFootprints(loaded)) {
            markerEntities.forEach(ent => viewer.entities.remove(ent));
            // 按当前底图坐标系重算标记坐标，并刷新状态栏足迹数（不重载瓦片，避免闪烁）
            if (currentBaseKey) {
                applyMarkerPositions(currentBaseKey);
                updateStatusText();
            }
            buildMarkers();
            buildCityMarkers();
            // 按当前视角恢复城市/展开模式（整球视图默认城市聚合）
            const h = viewer.camera.positionCartographic.height;
            applyMarkerMode(h > CITY_COLLAPSE_HEIGHT);
            pendingMarkerAudit = true;   // 重建后在真实渲染结果上体检一次
            if (cityFillEnabled) buildCityFills();   // 城市高亮开关开启时才随新数据重建
        }
        footprintsDataReady = true;
        updateIntroStats();
        document.dispatchEvent(new CustomEvent('footprints:loaded'));
    });

    // ================= 中国轮廓 GeoJSON =================
    // 使用阿里云 DataV 提供的公开中国边界数据（国内可访问）。
    // 该数据默认是 GCJ-02，与高德底图对齐；切到天地图（WGS84）时会有约 500 米偏移，
    // 国家尺度下基本不可见（城市级填充已做坐标转换，见 buildCityFills）。

    // ================= 城市淡色填充 =================
    // 给去过的城市罩一层淡色（城市级边界，clampToGround 贴合地形）。
    // 注意：clampToGround 的多边形不渲染 outline（GeoJSON 的 stroke/strokeWidth 会静默失效），
    // 所以边界轮廓单独提取环线，用贴合地面的折线绘制。
    // DataV 边界是 GCJ-02：高德底图直接使用；切到天地图（WGS84）底图时整体转换坐标与标记对齐。

    function loadCityBoundary(adcode) {
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
    function cityBoundaryToWgs84(geojson) {
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

    function clearCityFills() {
        cityFillDataSources.forEach(ds => viewer.dataSources.remove(ds));
        cityFillDataSources = [];
        cityOutlinePolylines = [];
        cityFillIndex = new Map();   // 换了底图/数据后会整体重建，索引与"换色"状态一并清掉
        cityFillHighlightAdcode = '';
        cityFillVisible = false;   // 下次构建时按当前相机高度重新决定显隐
    }

    function buildCityFills() {
        const buildId = ++cityFillBuildId;   // 防止上次异步加载残留
        clearCityFills();
        const fillColor = CITY_FILL_THEMES[CITY_FILL_THEME] || CITY_FILL_THEMES.amber;
        const item = currentBaseKey ? baseProviders[currentBaseKey] : null;
        const basemapIsGcj = !!(item && item.gcj);
        const seen = new Set();
        FOOTPRINTS.forEach(fp => {
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
                    viewer.dataSources.remove(ds);
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

                viewer.dataSources.add(ds);
                cityFillDataSources.push(ds);
                // 记下"这座城市的高亮面是哪些实体"：悬停卡片时要把它们从主题金色换成青蓝
                cityFillIndex.set(String(adcode), { entities: fillEntities });
            }).catch(e => {
                console.warn('城市边界加载失败 ' + adcode + ':', e);
            });
        });
    }

    // ---------- 城市高亮换色：金色 ⇄ 青蓝 ----------
    function cityFillBaseColor() {
        const theme = CITY_FILL_THEMES[CITY_FILL_THEME] || CITY_FILL_THEMES.amber;
        return Cesium.Color.fromCssColorString(theme.fill);
    }

    // 卡片 -> 该城市的 adcode（与 buildCityFills 的聚合键一致：取该城第一条足迹的 cityAdcode）
    function cityFillAdcodeOf(ci) {
        const city = cityList[ci];
        if (!city) return '';
        for (let i = 0; i < city.indices.length; i++) {
            const fp = FOOTPRINTS[city.indices[i]];
            if (fp && fp.cityAdcode) return String(fp.cityAdcode);
        }
        return '';
    }

    function paintCityFill(entry, highlight) {
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
    function applyCityFillHighlight(adcode) {
        const next = adcode ? String(adcode) : '';
        if (next === cityFillHighlightAdcode) return;
        const previous = cityFillIndex.get(cityFillHighlightAdcode);
        if (previous) paintCityFill(previous, false);
        cityFillHighlightAdcode = next;
        const entry = next ? cityFillIndex.get(next) : null;
        if (entry) paintCityFill(entry, true);
    }

    // ================= 照片环：点足迹标记后围绕标记铺开的多图预览 =================
    // 设计要点：
    // - 不取代足迹卡（卡片照旧从右侧滑入），环另外浮在标记周围；
    // - 整圈 360° 径向排布，固定 5 张，第 6 个角度位是「全部 N 张 ›」；
    // - 点某张 → 原地放大成窗口化查看器（不全屏），←/→ 切换、点大图或 Esc 退回；
    // - 点空白 = 一次全关；Esc = 逐级（查看模式 → 环 → 卡片）。

    function photoRingEnabled() {
        return !COARSE_POINTER && window.innerWidth > 820;
    }

    // 等到元素真的可见再聚焦：照片环整体从 visibility:hidden 过渡到 visible，
    // 立刻 focus() 会被浏览器忽略（与城市视图的返回按钮同一个问题）。
    function focusWhenVisible(el, tries) {
        if (!el || !el.isConnected) return;
        const attempt = tries || 0;
        if (getComputedStyle(el).visibility === 'hidden') {
            if (attempt > 20) return;
            requestAnimationFrame(() => focusWhenVisible(el, attempt + 1));
            return;
        }
        el.focus();
    }

    // 均匀采样：n > k 时取"含首末"的等距 k 张（n=12,k=5 → 0,3,6,8,11）
    function ringSampleIndexes(n, k) {
        if (n <= k) return Array.from({ length: n }, (_, i) => i);
        const set = new Set();
        for (let i = 0; i < k; i++) {
            set.add(Math.round((i * (n - 1)) / (k - 1)));
        }
        let cursor = 0;
        while (set.size < k && cursor < n) {
            set.add(cursor);
            cursor++;
        }
        return [...set].sort((a, b) => a - b);
    }

    function photoRingImages() {
        return photoRingFp ? cityWallImages(photoRingFp) : [];
    }

    // 足迹卡在屏幕上**真实**占据的矩形（把卡片当障碍物，避免环钻到卡片底下）。
    // 必须用 getBoundingClientRect()：静止态的足迹卡是 `top: 50% + transform: translateY(-50%)`，
    // 而 cardLayoutRect() 刻意只按定位属性推算（不读 transform），算出来的盒子比真实卡片
    // **低了半张卡高（约 235px）**。避让按那个盒子走，就会出现两种怪相：
    // 标记在卡片上方时以为"没压住"而铺整圈（圆的下半被卡片压住）、
    // 标记转到卡片后面时按"抬高"去躲（固定成上半圆，右侧照片仍被卡片压住）。
    function photoRingCardRect() {
        if (!markerCard || !markerCard.classList.contains('visible')) return null;
        const rect = markerCard.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) return null;
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    }

    // 屏幕坐标离视口边界的距离（在视口里就是 0）：用来决定照片环什么时候跟着标记淡出
    function photoRingEdgeDistance(p) {
        const dx = Math.max(0, -p.x, p.x - window.innerWidth);
        const dy = Math.max(0, -p.y, p.y - window.innerHeight);
        return Math.hypot(dx, dy);
    }

    function photoRingElements() {
        if (!photoRingEls) {
            const root = document.getElementById('photoRing');
            if (!root) return null;
            photoRingEls = {
                root: root, items: [], all: null,
                prev: null, next: null, counter: null, close: null,
                guide: null, guideLine: null, guideDot: null,
                dots: null, hint: null, viewer: null
            };
        }
        return photoRingEls;
    }

    // 悬停 / 聚焦某张缩略图时，画一条细线连回标记（照片绘制在它之上，所以线不会压住照片）
    function showPhotoRingGuide(el) {
        if (!photoRingActive || photoRingViewing || !el) return;
        const els = photoRingElements();
        if (!els || !els.guideLine) return;
        photoRingGuideEl = el;
        els.guideLine.classList.add('show');
        els.guideDot.classList.add('show');
        updatePhotoRingGuide();
    }

    function hidePhotoRingGuide() {
        photoRingGuideEl = null;
        const els = photoRingElements();
        if (!els) return;
        if (els.guideLine) els.guideLine.classList.remove('show');
        if (els.guideDot) els.guideDot.classList.remove('show');
    }

    function updatePhotoRingGuide() {
        if (!photoRingGuideEl) return;
        const els = photoRingElements();
        const lay = photoRingLayout;
        if (!els || !lay || !els.guideLine) return;
        const slot = els.items.indexOf(photoRingGuideEl);
        const entry = lay.bySlot ? lay.bySlot[slot] : null;
        const anchor = markerScreenPosition(photoRingIndex);
        if (!entry || !anchor) {
            hidePhotoRingGuide();
            return;
        }
        els.guideLine.setAttribute('x1', round1(anchor.x));
        els.guideLine.setAttribute('y1', round1(anchor.y));
        els.guideLine.setAttribute('x2', round1(entry.x));
        els.guideLine.setAttribute('y2', round1(entry.y));
        els.guideDot.setAttribute('cx', round1(anchor.x));
        els.guideDot.setAttribute('cy', round1(anchor.y));
    }

    // 图片装在子层 .photo-ring-photo 上，加载成功才淡入 —— 与卡片封面（.card-cover-photo）
    // 是同一套结构，骨架不会因为"加载失败"变形。
    function loadPhotoRingImage(el, url, force) {
        const token = photoRingToken;
        const photo = el.querySelector('.photo-ring-photo') || el;
        photo.classList.remove('is-loaded');
        if (photo.tagName === 'IMG') photo.removeAttribute('src');
        else photo.style.backgroundImage = 'none';
        el.classList.add('is-loading');
        el.classList.remove('is-error');
        loadCardCoverImage(url, (ok, natural) => {
            if (token !== photoRingToken || !el.isConnected) return;
            el.classList.remove('is-loading');
            if (!ok) {
                el.classList.add('is-error');
                console.warn('[足迹] 照片环图片加载失败：', url);
                // 失败后自动重试两次（绕过共享队列里那条 60s 的失败结论），仍失败就停在错误态
                const retryIn = (delay, left) => {
                    window.setTimeout(() => {
                        if (token !== photoRingToken || !el.isConnected ||
                            photo.classList.contains('is-loaded')) return;
                        if (left > 0) retryIn(delay * 2.5, left - 1);
                        loadPhotoRingImage(el, url, true);
                    }, delay);
                };
                retryIn(4000, 1);
                return;
            }
            if (natural && natural.width && natural.height) {
                el.dataset.natW = String(natural.width);
                el.dataset.natH = String(natural.height);
            }
            if (photo.tagName === 'IMG') photo.src = url;
            else photo.style.backgroundImage = 'url("' + url + '")';
            photo.classList.add('is-loaded');
            if (el === photoRingViewerEl) {
                // 查看模式的大图也按这张的实际宽高比定尺寸，并重新贴合标记
                photoRingViewerSize = photoRingViewerBoxOf(el);
                applyPhotoRingTransforms();
            } else {
                photoRingLayoutDirty = true;   // 环上这张的尺寸变了 → 下一帧重排
            }
        }, { force: !!force });
    }

    // 环上的照片按钮：缩略图与查看模式大图共用这套结构。
    // 用真正的 <img> 而不是 CSS 背景图：加载失败时 DOM 里能看见、控制台有告警，
    // 也能用 object-fit 精确按图片比例显示（背景图失败是完全无声的，和"还在加载"分不清）。
    function makeRingPhotoButton(className) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        const photo = document.createElement('img');
        photo.className = 'photo-ring-photo';
        photo.alt = '';
        photo.decoding = 'async';
        photo.draggable = false;
        btn.appendChild(photo);
        return btn;
    }

    function renderPhotoRing() {
        const els = photoRingElements();
        if (!els) return false;
        const images = photoRingImages();
        if (!images.length) return false;
        els.root.innerHTML = '';
        els.items = [];
        els.all = null;
        // 悬停引导线画在最底层（照片之后才创建，自然压在照片下面）
        const guide = document.createElementNS(SVG_NS, 'svg');
        guide.setAttribute('class', 'photo-ring-guide');
        guide.setAttribute('aria-hidden', 'true');
        const guideLine = document.createElementNS(SVG_NS, 'line');
        guideLine.setAttribute('class', 'photo-ring-guide-line');
        const guideDot = document.createElementNS(SVG_NS, 'circle');
        guideDot.setAttribute('class', 'photo-ring-guide-dot');
        guideDot.setAttribute('r', '2.5');
        guide.appendChild(guideLine);
        guide.appendChild(guideDot);
        els.root.appendChild(guide);
        els.guide = guide;
        els.guideLine = guideLine;
        els.guideDot = guideDot;

        photoRingSlots.forEach((imgIndex, slot) => {
            const btn = makeRingPhotoButton('photo-ring-item');
            btn.dataset.imgIndex = String(imgIndex);
            btn.setAttribute('aria-label', '第 ' + (imgIndex + 1) + ' 张图片，共 ' + images.length + ' 张');
            // 先入 DOM、再登记，最后才发起加载：任何同步/异步回调进来时
            // 元素都已经是连接的（isConnected 守卫不会误伤）
            els.root.appendChild(btn);
            els.items.push(btn);
            loadPhotoRingImage(btn, images[imgIndex].url);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 这张之前加载失败过：进查看模式时强制重取一次
                if (btn.classList.contains('is-error')) loadPhotoRingImage(btn, images[imgIndex].url, true);
                enterPhotoRingView(Number(btn.dataset.imgIndex));
            });
            // 悬停 / 键盘聚焦：画一条细线连回标记（离开、进入查看模式、标记在背面时自动收起）
            btn.addEventListener('pointerenter', () => showPhotoRingGuide(btn));
            btn.addEventListener('pointerleave', hidePhotoRingGuide);
            btn.addEventListener('focus', () => showPhotoRingGuide(btn));
            btn.addEventListener('blur', hidePhotoRingGuide);
        });

        // 查看模式的大图用**独立**元素：早先复用了被点的那张缩略图，于是左右翻图会把翻到的那张
        // 写进缩略图（关掉放大后缩略图就"变脸"了），还会把这个槽位的原始宽高覆盖成别的图、
        // 连带缩略图尺寸也错乱。现在缩略图永远只显示自己那张，大图有自己的一份 DOM。
        const viewer = makeRingPhotoButton('photo-ring-item is-viewer is-slot-hidden');
        viewer.setAttribute('aria-label', '查看中的图片');
        viewer.addEventListener('click', (e) => {
            e.stopPropagation();
            exitPhotoRingView();      // 点大图本身 = 退回照片环
        });
        els.root.appendChild(viewer);
        els.viewer = viewer;

        // 「看全部图片」不在这里放入口：右侧足迹卡上的「打开图片墙 · N」就是同一个去处，
        // 环上多一个胶囊只会占位置、还会和缩略图抢角度。
        const mkNav = (cls, label, delta) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'photo-ring-nav ' + cls;
            btn.setAttribute('aria-label', label);
            btn.textContent = delta < 0 ? '‹' : '›';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                switchPhotoRingView(delta);
            });
            els.root.appendChild(btn);
            return btn;
        };
        els.prev = mkNav('prev', '上一张图片', -1);
        els.next = mkNav('next', '下一张图片', 1);

        const counter = document.createElement('div');
        counter.className = 'photo-ring-counter';
        els.root.appendChild(counter);
        els.counter = counter;

        // 放大视图的位置指示：全量图片各一个点，环上那 5 个大一点、当前这张点亮。
        // （进查看模式时环上其余缩略图是 opacity:0 的"其余淡出"，所以"我在第几张、离环上那几张有多远"
        // 只能靠这条点带来说明。）
        if (images.length <= PHOTO_RING_DOT_LIMIT) {
            const dots = document.createElement('div');
            dots.className = 'photo-ring-dots';
            for (let i = 0; i < images.length; i++) {
                const dot = document.createElement('span');
                if (photoRingSlots.indexOf(i) >= 0) dot.className = 'is-in-ring';
                dots.appendChild(dot);
            }
            els.root.appendChild(dots);
            els.dots = dots;
        }
        // 环上只是均匀采样的 5 张：用一句话把"预览"和"全量"两个入口的关系说清
        const viewHint = document.createElement('div');
        viewHint.className = 'photo-ring-viewhint';
        if (images.length > photoRingSlots.length) {
            viewHint.textContent = '环上展示 ' + photoRingSlots.length + ' 张 · 全部 ' +
                images.length + ' 张在「图片墙」';
            viewHint.classList.add('has-hint');
        }
        els.root.appendChild(viewHint);
        els.hint = viewHint;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'photo-ring-close';
        closeBtn.setAttribute('aria-label', '关闭照片');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (photoRingViewing) exitPhotoRingView();
            else hidePhotoRing();
        });
        els.root.appendChild(closeBtn);
        els.close = closeBtn;
        return true;
    }

    // 环上各位置的屏幕矩形（位置 ± 每张自己的尺寸），加上整体平移量
    function photoRingRects(entries, dx, dy) {
        return entries.map(e => ({
            x: e.x - e.w / 2 + dx,
            y: e.y - e.h / 2 + dy,
            w: e.w,
            h: e.h
        }));
    }

    function photoRingRectsBBox(rects) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        rects.forEach(r => {
            minX = Math.min(minX, r.x);
            maxX = Math.max(maxX, r.x + r.w);
            minY = Math.min(minY, r.y);
            maxY = Math.max(maxY, r.y + r.h);
        });
        return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
    }

    // 环被卡片压住的面积：**逐张**算，不按包围盒 —— 半环是"弧"，包围盒的四角是空的，
    // 按包围盒判重叠会把"照片其实没碰到卡片"也算成压住，逼着整环离开标记。
    function photoRingOverlapArea(rects, card) {
        if (!card) return 0;
        let sum = 0;
        rects.forEach(r => { sum += overlapArea(r, card); });
        return sum;
    }

    // 清掉重叠所需的最小平移：四个方向各算一次，取位移最小的那个方向。
    // 同样只按"真的压住的照片"算，而不是按包围盒（否则会被空角落带着挪很远）。
    function photoRingPushVector(rects, card) {
        let left = 0, right = 0, up = 0, down = 0;
        rects.forEach(r => {
            if (overlapArea(r, card) <= 0) return;
            left = Math.max(left, r.x + r.w - card.x);
            right = Math.max(right, card.x + card.w - r.x);
            up = Math.max(up, r.y + r.h - card.y);
            down = Math.max(down, card.y + card.h - r.y);
        });
        const best = Math.min(left, right, up, down);
        if (!(best > 0)) return { dx: 0, dy: 0, dist: 0 };
        if (best === left) return { dx: -best, dy: 0, dist: best };
        if (best === right) return { dx: best, dy: 0, dist: best };
        if (best === up) return { dx: 0, dy: -best, dist: best };
        return { dx: 0, dy: best, dist: best };
    }

    // 两个朝向之间的夹角（0~π），用于"贴着上一帧朝向"的连续性偏好
    function photoRingAngleGap(a, b) {
        const twoPi = Math.PI * 2;
        const d = Math.abs(a - b) % twoPi;
        return d > Math.PI ? twoPi - d : d;
    }

    // 环形布局：{整圈 / 半环} × {5 张 / 减量 3 张} × 2 档尺寸 × 朝向，
    // 取"不压卡片、不出界"的最优解；降级档在 cost 里带小惩罚，所以正常情况下就是整圈 5 张。
    //
    // 半环的朝向**不写死成上下左右**：沿整圈按 PHOTO_RING_ARC_STEP_DEG 扫一遍，
    // 让弧线自己去找空位 —— 拖动地球让标记绕到卡片另一侧时，弧会跟着转过去，
    // 而不是固定成"上半圆/左半圆"（用户反馈的就是这个）。
    // 按图片实际宽高比等比装进一个盒子（保持比例；只在极端竖图/全景图时被上下限夹一下）
    function fitPhotoRingBox(natW, natH, maxW, maxH, minW, minH) {
        const w0 = Number(natW) > 0 ? Number(natW) : 4;
        const h0 = Number(natH) > 0 ? Number(natH) : 3;
        const fit = Math.min(maxW / w0, maxH / h0);
        return {
            w: Math.round(Math.min(maxW, Math.max(minW || 0, w0 * fit))),
            h: Math.round(Math.min(maxH, Math.max(minH || 0, h0 * fit)))
        };
    }

    // 某个槽位该渲染多大：按它自己那张图的原始宽高比；图片还没到手就用占位尺寸
    function photoRingSlotSize(slot) {
        const els = photoRingElements();
        const el = els && els.items[slot];
        const natW = el ? Number(el.dataset.natW) || 0 : 0;
        const natH = el ? Number(el.dataset.natH) || 0 : 0;
        if (!natW || !natH) return { w: PHOTO_RING_PLACEHOLDER_W, h: PHOTO_RING_PLACEHOLDER_H };
        return fitPhotoRingBox(natW, natH,
            PHOTO_RING_MAX_W, PHOTO_RING_MAX_H, PHOTO_RING_MIN_W, PHOTO_RING_MIN_H);
    }

    // 查看模式大图的尺寸：同一套"按实际宽高比装进盒子"的规则，盒子更大
    function photoRingViewerBoxOf(el) {
        const natW = el ? Number(el.dataset.natW) || 0 : 0;
        const natH = el ? Number(el.dataset.natH) || 0 : 0;
        if (!natW || !natH) return { w: PHOTO_RING_VIEW_MAX_W, h: Math.round(PHOTO_RING_VIEW_MAX_H * 0.75) };
        return fitPhotoRingBox(natW, natH, PHOTO_RING_VIEW_MAX_W, PHOTO_RING_VIEW_MAX_H, 0, 0);
    }

    function layoutPhotoRing(anchor) {
        const els = photoRingElements();
        if (!els || !anchor || !photoRingSlots.length) return;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const pad = 12;
        const card = photoRingCardRect();
        // 起始角：从视口中心指向标记（即"远离视口中心"的方向）
        const baseOut = Math.atan2(anchor.y - H / 2, anchor.x - W / 2);
        // 背向卡片的方向（卡片中心 → 标记）
        const away = card
            ? Math.atan2(anchor.y - (card.y + card.h / 2), anchor.x - (card.x + card.w / 2))
            : baseOut;
        // 整圈近似旋转对称：朝向只要几组"有语义"的（远离视口中心 / 背向卡片）
        const fullBases = [baseOut, baseOut + Math.PI / 2, baseOut - Math.PI / 2, baseOut + Math.PI];
        if (card) fullBases.push(away, away + Math.PI / 2, away - Math.PI / 2);
        // 半环：沿整圈连续扫描（5° 一档），让弧线自己去绕开卡片
        const halfBases = [];
        for (let deg = 0; deg < 360; deg += PHOTO_RING_ARC_STEP_DEG) halfBases.push(deg * Math.PI / 180);
        // 上一帧的朝向：多个朝向"同样干净"时（比如一圈都空着），环不会突然翻到另一边。
        // 首次（还没有上一帧）以"背向卡片"为基准 —— 否则会拿"远离视口中心"当基准，
        // 标记在右半边时那个方向正对着卡片，弧线会先朝卡片再绕开。
        const preferred = photoRingArcAngle === null ? away : photoRingArcAngle;
        // 每张缩略图按自己图片的实际宽高比；降级档只是把这一组尺寸整体等比缩小
        const baseSizes = photoRingSlots.map((_, slot) => photoRingSlotSize(slot));
        const variants = [
            { compact: false, scale: 1, base: PHOTO_RING_RADIUS },
            { compact: true, scale: PHOTO_RING_COMPACT_SCALE, base: PHOTO_RING_COMPACT_RADIUS }
        ];
        const modes = [];
        [false, true].forEach(half => {
            [false, true].forEach(reduced => modes.push({ half: half, reduced: reduced }));
        });
        let best = null;
        modes.forEach(mode => {
            // 减量档：只展示第 1/3/5 张（视觉上仍是散开的一圈），其余交给「全部 ›」
            const visible = mode.reduced ? [0, 2, 4].filter(i => i < photoRingSlots.length) : photoRingSlots.map((_, i) => i);
            const count = visible.length;
            // 只有 1 张也要算：单个位置同样是一条"环"。早先这里要求 >= 2，于是整条布局直接放弃，
            // 那张缩略图停在入场动画的终点（正好压在标记上），点开的大图也跟着没位置。
            if (!count) return;
            const span = mode.half ? Math.PI : Math.PI * 2;
            const bases = mode.half ? halfBases : fullBases;
            variants.forEach(variant => {
                const scaled = visible.map(slot => ({
                    w: Math.max(40, Math.round(baseSizes[slot].w * variant.scale)),
                    h: Math.max(30, Math.round(baseSizes[slot].h * variant.scale))
                }));
                const maxW = Math.max.apply(null, scaled.map(s => s.w));
                const maxH = Math.max.apply(null, scaled.map(s => s.h));
                // 半径按"位置数"自适应：位置越密角度越小，半径要撑开，否则相邻缩略图会贴在一起
                // （实测 6 个位置、半径 78 时只剩 2px 间隙）。
                // 注意用**半对角线**而不是宽度：缩略图是轴对齐的方块，斜向相邻时只保证"水平间距"
                // 不够（实测半环下会有一对斜向重叠），半对角线之和是"任意方向都不相交"的充分条件。
                const maxHalfDiag = Math.max.apply(null, scaled.map(s => Math.hypot(s.w / 2, s.h / 2)));
                // 只有一个位置时没有"相邻"要避（公式里 sin(π/1/2) 会是 0，半径直接爆掉），
                // 半径只保证这张自己不压住标记。
                const radius = count < 2
                    ? Math.max(variant.base, maxHalfDiag + 14)
                    : Math.max(variant.base, (2 * maxHalfDiag + 14) / (2 * Math.sin(span / count / 2)));
                bases.forEach(base => {
                    const step = span / count;
                    const start = mode.half ? base - span / 2 + step / 2 : base;
                    const entries = [];
                    for (let i = 0; i < count; i++) {
                        const angle = start + step * i;
                        entries.push({
                            angle: angle,
                            x: anchor.x + Math.cos(angle) * radius,
                            y: anchor.y + Math.sin(angle) * radius,
                            w: scaled[i].w,
                            h: scaled[i].h
                        });
                    }
                    // 1) 先把环整体挪进视口
                    const boxStart = photoRingRectsBBox(photoRingRects(entries, 0, 0));
                    let dx = 0;
                    let dy = 0;
                    if (boxStart.minX < pad) dx = pad - boxStart.minX;
                    if (boxStart.maxX + dx > W - pad) dx = Math.min(dx, W - pad - boxStart.maxX);
                    if (boxStart.minY < pad) dy = pad - boxStart.minY;
                    if (boxStart.maxY + dy > H - pad) dy = Math.min(dy, H - pad - boxStart.maxY);
                    const dxBeforePush = dx;
                    const dyBeforePush = dy;
                    // 2) 再避卡片：只按"真的被压住的照片"推（空角落不算），推完钳回视口
                    if (card) {
                        const push = photoRingPushVector(photoRingRects(entries, dx, dy), card);
                        if (push.dist > 0) {
                            const capped = Math.min(push.dist, PHOTO_RING_MAX_PUSH);
                            dx += push.dx / push.dist * capped;
                            dy += push.dy / push.dist * capped;
                        }
                        const boxPush = photoRingRectsBBox(photoRingRects(entries, dx, dy));
                        if (boxPush.maxX - boxPush.minX <= W - pad * 2) {
                            dx = clampNumber(dx, pad - boxPush.minX, W - pad - boxPush.maxX);
                        }
                        if (boxPush.maxY - boxPush.minY <= H - pad * 2) {
                            dy = clampNumber(dy, pad - boxPush.minY, H - pad - boxPush.maxY);
                        }
                    }
                    const rects = photoRingRects(entries, dx, dy);
                    const box = photoRingRectsBBox(rects);
                    const overflow = Math.max(0, pad - box.minX) + Math.max(0, box.maxX - (W - pad)) +
                        Math.max(0, pad - box.minY) + Math.max(0, box.maxY - (H - pad));
                    const overlap = photoRingOverlapArea(rects, card);
                    // 推距要计价（0.12/px）：否则"整圈硬推"因为降级惩罚更低，会一直赢过"半环绕行"，
                    // 表现就是环被整体推走、不再围绕标记。现在 40px 推距 ≈ 4.8 分，已经比"半环"的 3 分
                    // 更贵 —— 能半环就半环；只有当半环也压住卡片时，才用更长的推距去换"照片不被挡住"。
                    // 朝向连续性只给很轻的权重（0.4 × 夹角）：只在"同样干净"的朝向之间做取舍。
                    const pushUsed = Math.hypot(dx - dxBeforePush, dy - dyBeforePush);
                    const edgePushUsed = Math.min(Math.hypot(dxBeforePush, dyBeforePush), PHOTO_RING_EDGE_SHIFT_LIMIT);
                    const cost = overlap * 2 + overflow * 40 + (variant.compact ? 1 : 0) +
                        (mode.half ? 3 : 0) + (mode.reduced ? 6 : 0) + pushUsed * 0.12 +
                        edgePushUsed * PHOTO_RING_EDGE_PUSH_COST +
                        photoRingAngleGap(base, preferred) * 0.4;
                    if (!best || cost < best.cost) {
                        const bySlot = {};
                        visible.forEach((slot, k) => {
                            bySlot[slot] = {
                                angle: entries[k].angle,
                                x: entries[k].x + dx,
                                y: entries[k].y + dy,
                                w: scaled[k].w,
                                h: scaled[k].h
                            };
                        });
                        best = {
                            cost: cost,
                            base: base,
                            maxW: maxW,
                            maxH: maxH,
                            compact: variant.compact,
                            half: mode.half,
                            reduced: mode.reduced,
                            visible: visible,
                            bySlot: bySlot
                        };
                    }
                });
            });
        });
        if (!best) return;
        photoRingLayout = best;
        photoRingArcAngle = best.base;
        els.root.classList.toggle('is-compact', best.compact);
        els.root.classList.toggle('is-reduced', !!best.reduced);
        els.root.classList.toggle('is-half', !!best.half);
        applyPhotoRingTransforms();
    }

    // 查看模式大图的中心：沿"被点那张的角度"外移，再钳进视口
    function photoRingViewerCenter() {
        if (!photoRingViewerEl) return null;
        const anchor = markerScreenPosition(photoRingIndex);
        if (!anchor) return null;
        const box = photoRingViewerSize || photoRingViewerBoxOf(photoRingViewerEl);
        const halfW = box.w / 2;
        const halfH = box.h / 2;
        const pad = 16;
        // 角度在进入查看模式时就固定下来，之后即使布局换成降级档也不会让大图乱跳
        // 外移距离按大图**自己的半对角线**来定：固定 130px 是按 76×54 的缩略图定下的，
        // 现在大图最大 480×340，130px 会让大图直接盖住标记（只有一张图片时最明显）。
        const radius = Math.max(PHOTO_RING_VIEW_RADIUS, Math.hypot(halfW, halfH) + 24);
        let cx = anchor.x + Math.cos(photoRingViewerAngle) * radius;
        let cy = anchor.y + Math.sin(photoRingViewerAngle) * radius;
        cx = clampNumber(cx, pad + halfW, Math.max(pad + halfW, window.innerWidth - pad - halfW));
        cy = clampNumber(cy, pad + halfH, Math.max(pad + halfH, window.innerHeight - pad - halfH));
        // 钳进视口之后可能又盖回标记上：沿"移动最少"的那条轴把大图推到标记之外
        // （推不进就保持钳制后的位置，别把大图挤出屏幕）
        if (anchor.x > cx - halfW && anchor.x < cx + halfW && anchor.y > cy - halfH && anchor.y < cy + halfH) {
            const moveLeft = halfW - (anchor.x - cx);
            const moveRight = halfW - (cx - anchor.x);
            const moveUp = halfH - (anchor.y - cy);
            const moveDown = halfH - (cy - anchor.y);
            const move = Math.min(moveLeft, moveRight, moveUp, moveDown);
            let nx = cx;
            let ny = cy;
            if (move === moveLeft) nx = anchor.x + halfW + 12;
            else if (move === moveRight) nx = anchor.x - halfW - 12;
            else if (move === moveUp) ny = anchor.y + halfH + 12;
            else ny = anchor.y - halfH - 12;
            nx = clampNumber(nx, pad + halfW, Math.max(pad + halfW, window.innerWidth - pad - halfW));
            ny = clampNumber(ny, pad + halfH, Math.max(pad + halfH, window.innerHeight - pad - halfH));
            if (nx + halfW <= anchor.x || nx - halfW >= anchor.x || ny + halfH <= anchor.y || ny - halfH >= anchor.y) {
                cx = nx;
                cy = ny;
            }
        }
        return { x: cx, y: cy };
    }

    function applyPhotoRingTransforms() {
        const els = photoRingElements();
        const lay = photoRingLayout;
        if (!els || !lay) return;
        const viewerCenter = photoRingViewing ? photoRingViewerCenter() : null;
        els.items.forEach((el, i) => {
            const entry = lay.bySlot[i];
            if (!entry) {
                el.classList.add('is-slot-hidden');   // 减量档：这一张不进环（仍可由「全部 ›」看到）
                return;
            }
            el.classList.remove('is-slot-hidden');
            if (photoRingViewing) {
                el.classList.add('is-dim');
            } else {
                el.classList.remove('is-dim');
            }
            // 尺寸由这一张自己的图片宽高比决定
            el.style.width = entry.w + 'px';
            el.style.height = entry.h + 'px';
            el.style.transform = 'translate3d(' + snapDevicePx(entry.x - entry.w / 2) + 'px,' +
                snapDevicePx(entry.y - entry.h / 2) + 'px,0)';
        });
        // 大图（独立元素）自己摆到查看位置
        if (viewerCenter && els.viewer && photoRingViewerEl === els.viewer) {
            const box = photoRingViewerSize || photoRingViewerBoxOf(els.viewer);
            els.viewer.classList.remove('is-slot-hidden');
            els.viewer.style.width = box.w + 'px';
            els.viewer.style.height = box.h + 'px';
            els.viewer.style.transform = 'translate3d(' +
                snapDevicePx(viewerCenter.x - box.w / 2) + 'px,' +
                snapDevicePx(viewerCenter.y - box.h / 2) + 'px,0)';
        }
        // 查看模式的三个控件围绕大图摆放
        if (viewerCenter) {
            const set = (el, x, y) => {
                if (el) el.style.transform = 'translate3d(' + snapDevicePx(x) + 'px,' + snapDevicePx(y) + 'px,0)';
            };
            const box = photoRingViewerSize || { w: PHOTO_RING_VIEW_MAX_W, h: PHOTO_RING_VIEW_MAX_H };
            set(els.prev, viewerCenter.x - box.w / 2 - 40, viewerCenter.y - 15);
            set(els.next, viewerCenter.x + box.w / 2 + 10, viewerCenter.y - 15);
            // 关闭按钮挂在图片**右上角圆角的外侧**，并沿 45° 对角线摆放（像挂在角上的徽章）：
            // 中心落在角点斜向外 PHOTO_RING_CLOSE_OFFSET 处，内角略微压住圆角。
            // 只斜向摆放、不旋转按钮本身 —— 旋转 45° 会把「×」转成「+」。
            const closeDiag = PHOTO_RING_CLOSE_OFFSET / Math.SQRT2;
            set(els.close,
                clampNumber(viewerCenter.x + box.w / 2 + closeDiag - PHOTO_RING_CLOSE_SIZE / 2,
                    4, Math.max(4, window.innerWidth - PHOTO_RING_CLOSE_SIZE - 4)),
                clampNumber(viewerCenter.y - box.h / 2 - closeDiag - PHOTO_RING_CLOSE_SIZE / 2,
                    4, Math.max(4, window.innerHeight - PHOTO_RING_CLOSE_SIZE - 4)));
            if (els.counter) {
                const cw = els.counter.offsetWidth || 70;
                set(els.counter, viewerCenter.x - cw / 2, viewerCenter.y + box.h / 2 + 10);
            }
            if (els.dots) {
                const dw = els.dots.offsetWidth || 80;
                set(els.dots, viewerCenter.x - dw / 2, viewerCenter.y + box.h / 2 + 38);
            }
            if (els.hint) {
                const hw = els.hint.offsetWidth || 0;
                set(els.hint, viewerCenter.x - hw / 2, viewerCenter.y + box.h / 2 + 54);
            }
        }
    }

    // 每帧跟随标记：只在环打开时工作，标记转到背面就整体淡出（保留状态）
    // 环的相机变化判定单独一套缓存 —— 与省份卡片共用会让先调用的那个把变化"吃掉"。
    const photoRingCamPos = new Cesium.Cartesian3();
    const photoRingCamDir = new Cesium.Cartesian3();
    let photoRingCamReady = false;
    function photoRingCameraMoved() {
        const camera = viewer.camera;
        if (photoRingCamReady &&
            Cesium.Cartesian3.equalsEpsilon(camera.positionWC, photoRingCamPos, Cesium.Math.EPSILON6) &&
            Cesium.Cartesian3.equalsEpsilon(camera.directionWC, photoRingCamDir, Cesium.Math.EPSILON6)) {
            return false;
        }
        Cesium.Cartesian3.clone(camera.positionWC, photoRingCamPos);
        Cesium.Cartesian3.clone(camera.directionWC, photoRingCamDir);
        photoRingCamReady = true;
        return true;
    }

    function updatePhotoRingPosition() {
        if (!photoRingActive) return;
        const els = photoRingElements();
        if (!els) return;
        const anchor = markerScreenPosition(photoRingIndex);
        if (!anchor) {
            els.root.classList.add('is-hidden');
            els.root.style.removeProperty('--photo-ring-fade');
            els.root.classList.remove('is-edge-faded');
            return;
        }
        els.root.classList.remove('is-hidden');
        // 相机没动、也没有图片刚加载完（尺寸变了）→ 整段跳过：
        // 布局内部有几十组候选评估，静止浏览时不该每帧都跑
        if (!photoRingLayoutDirty && !photoRingCameraMoved()) return;
        photoRingLayoutDirty = false;
        // 锚点滑出视口就不再需要"围绕标记"的布局了 —— 整环跟着淡出（和"转到地球背面就淡出"
        // 同一套语言），拖回来反向淡入；布局与状态全部保留，不用重新点标记。
        const outside = photoRingEdgeDistance(anchor);
        const fade = 1 - Math.min(1, outside / PHOTO_RING_EDGE_FADE_PX);
        els.root.style.setProperty('--photo-ring-fade', fade.toFixed(3));
        els.root.classList.toggle('is-edge-faded', fade < 0.5);
        if (fade <= 0) return;   // 完全出屏：不再重排（相机一动又会回到这里重算）
        if (performance.now() < photoRingEntranceUntil) return;   // 入场动画期间不改写 transform
        layoutPhotoRing(anchor);
        updatePhotoRingGuide();   // 悬停中的那张要跟着标记走
    }
    viewer.scene.postRender.addEventListener(updatePhotoRingPosition);

    function startPhotoRingEntrance(anchor) {
        const els = photoRingElements();
        if (!els) return;
        const moving = els.items.slice();
        moving.forEach(el => {
            el.style.transition = 'none';
            const w = el.offsetWidth || PHOTO_RING_PLACEHOLDER_W;
            const h = el.offsetHeight || PHOTO_RING_PLACEHOLDER_H;
            el.style.transform = 'translate3d(' + snapDevicePx(anchor.x - w / 2) + 'px,' +
                snapDevicePx(anchor.y - h / 2) + 'px,0) scale(0.86)';
        });
        void els.root.offsetWidth;   // 把"起点态"钉住，否则浏览器会把两帧合并
        moving.forEach((el, i) => {
            el.style.transition = 'transform ' + (PHOTO_RING_FLY_MS / 1000) +
                's cubic-bezier(0.16, 1, 0.3, 1) ' + (i * PHOTO_RING_STAGGER_MS) + 'ms';
        });
        requestAnimationFrame(() => {
            layoutPhotoRing(anchor);
            window.setTimeout(() => {
                moving.forEach(el => { el.style.transition = ''; });
                // 入场动画期间足迹卡还在缩放/平移（getBoundingClientRect 会略小），
                // 动画落定后再排一次，避让用的是卡片的真实静止矩形
                photoRingLayoutDirty = true;
            }, PHOTO_RING_FLY_MS + moving.length * PHOTO_RING_STAGGER_MS + 60);
        });
    }

    function showPhotoRing(fp, index, triggerBtn) {
        if (!photoRingEnabled() || !fp) return false;
        const images = cityWallImages(fp);
        if (!images.length) {
            hidePhotoRing();
            return false;
        }
        hidePhotoRing();           // 换一条足迹：先收掉旧的（也自增世代号，让旧回调作废）
        photoRingToken++;
        photoRingFp = fp;
        photoRingIndex = index;
        photoRingSlots = ringSampleIndexes(images.length, PHOTO_RING_COUNT);
        photoRingActive = true;
        photoRingViewing = false;
        photoRingViewerEl = null;
        photoRingViewIndex = photoRingSlots.length ? photoRingSlots[0] : 0;
        photoRingTriggerBtn = triggerBtn || null;
        if (!renderPhotoRing()) {
            hidePhotoRing();
            return false;
        }
        const els = photoRingElements();
        els.root.setAttribute('aria-label', (fp.name || '足迹') + ' · ' + images.length + ' 张图片');
        els.root.setAttribute('aria-hidden', 'false');
        els.root.classList.remove('is-viewing', 'is-hidden');
        els.root.classList.add('show');
        // 环打开期间：标记键盘按钮保持"屏幕外待命"（见 CSS 里的 body.photo-ring-open 规则）
        document.body.classList.add('photo-ring-open');

        const anchor = markerScreenPosition(index) ||
            { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        layoutPhotoRing(anchor);
        const total = photoRingSlots.length;
        photoRingEntranceUntil = reduceMotion ? 0 : performance.now() + PHOTO_RING_FLY_MS + total * PHOTO_RING_STAGGER_MS + 60;
        if (!reduceMotion) startPhotoRingEntrance(anchor);
        // 键盘开卡 → 关卡的焦点还原可能把焦点留在屏幕外的标记按钮上。环一打开就把它接进环里：
        // 否则之后按 ←/→ 这类按键会让那个按钮以 :focus-visible 的形态弹到左下角、盖在照片上。
        if (markerFocusLayer.contains(document.activeElement)) {
            const firstItem = els.items.find(item => !item.classList.contains('is-slot-hidden'));
            if (firstItem) focusWhenVisible(firstItem);
        }
        pauseAutoRotate('photo-ring');
        return true;
    }

    function hidePhotoRing(returnFocus) {
        if (!photoRingActive && !photoRingLayout) return;
        photoRingToken++;
        photoRingActive = false;
        photoRingViewing = false;
        photoRingViewerEl = null;
        photoRingGuideEl = null;
        photoRingViewerSize = null;
        photoRingLayoutDirty = false;
        photoRingEntranceUntil = 0;
        photoRingLayout = null;
        photoRingArcAngle = null;
        photoRingFp = null;
        photoRingIndex = -1;
        photoRingSlots = [];
        const els = photoRingElements();
        document.body.classList.remove('photo-ring-open');
        if (els) {
            els.root.classList.remove('show', 'is-hidden', 'is-viewing', 'is-compact');
            els.root.classList.remove('is-edge-faded');
            els.root.style.removeProperty('--photo-ring-fade');
            els.root.setAttribute('aria-hidden', 'true');
            els.root.innerHTML = '';
            els.items = [];
            els.all = null;
            els.prev = null;
            els.next = null;
            els.counter = null;
            els.close = null;
            els.guide = null;
            els.guideLine = null;
            els.guideDot = null;
            els.dots = null;
            els.hint = null;
            els.viewer = null;
        }
        resumeAutoRotate('photo-ring');
        const trigger = photoRingTriggerBtn;
        photoRingTriggerBtn = null;
        if (returnFocus && trigger && trigger.isConnected) trigger.focus();
    }

    // 同一标记再点一次 = 收起（环 + 卡片由调用方一起收）
    function photoRingIsOpenFor(fp) {
        return photoRingActive && photoRingFp === fp;
    }

    function enterPhotoRingView(imgIndex) {
        if (!photoRingActive) return;
        const els = photoRingElements();
        if (!els || !els.viewer) return;
        const slot = photoRingSlots.indexOf(imgIndex);
        const slotEl = slot >= 0 ? els.items[slot] : els.items[0];
        photoRingViewing = true;
        photoRingViewerEl = els.viewer;
        photoRingViewIndex = imgIndex;
        // 记住这张在环上的角度：之后布局换成降级档、或标记移动，大图都沿这个方向外移
        const entry = slot >= 0 && photoRingLayout && photoRingLayout.bySlot[slot]
            ? photoRingLayout.bySlot[slot] : null;
        if (entry) photoRingViewerAngle = entry.angle;
        // 先按被点槽位那张估个尺寸，等目标图加载完再按它的实际宽高比重算
        photoRingViewerSize = slotEl ? photoRingViewerBoxOf(slotEl) : null;
        hidePhotoRingGuide();
        els.root.classList.add('is-viewing');
        // 从被点的缩略图位置"飞"出来：先把大图钉在缩略图原位（不参与过渡），
        // 下一帧再交给 applyPhotoRingTransforms 移到查看位置
        if (entry) {
            // 先把它显示出来再钉位置：display:none → block 的那一帧是没有过渡的，
            // 必须在可见状态下量一次，之后的位移才会走过渡动画
            els.viewer.classList.remove('is-slot-hidden');
            els.viewer.style.transition = 'none';
            els.viewer.style.width = entry.w + 'px';
            els.viewer.style.height = entry.h + 'px';
            els.viewer.style.transform = 'translate3d(' + snapDevicePx(entry.x - entry.w / 2) + 'px,' +
                snapDevicePx(entry.y - entry.h / 2) + 'px,0)';
            void els.viewer.offsetWidth;
            els.viewer.style.transition = '';
        }
        renderPhotoRingViewImage();
        applyPhotoRingTransforms();
        // 缩略图这时都是 is-dim（opacity 0），焦点留在上面就等于落在看不见的按钮上
        if (document.activeElement && els.root.contains(document.activeElement)) {
            els.viewer.focus();
        }
    }

    function renderPhotoRingViewImage() {
        const images = photoRingImages();
        const img = images[photoRingViewIndex];
        if (!img || !photoRingViewerEl) return;
        loadPhotoRingImage(photoRingViewerEl, img.url);
        const els = photoRingElements();
        if (els && els.counter) {
            els.counter.textContent = '第 ' + (photoRingViewIndex + 1) + ' 张 · 共 ' + images.length + ' 张';
        }
        if (els && els.dots) {
            Array.prototype.forEach.call(els.dots.children, (dot, i) => {
                dot.classList.toggle('is-current', i === photoRingViewIndex);
            });
        }
        [photoRingViewIndex - 1, photoRingViewIndex + 1].forEach(i => {
            if (i >= 0 && i < images.length) {
                const pre = new Image();
                pre.src = images[i].url;
            }
        });
    }

    function exitPhotoRingView() {
        if (!photoRingViewing) return;
        const els = photoRingElements();
        const viewer = els ? els.viewer : null;
        const hadFocus = !!viewer && document.activeElement === viewer;
        photoRingViewing = false;
        photoRingViewerSize = null;
        photoRingViewerEl = null;
        if (viewer) {
            viewer.classList.add('is-slot-hidden');
            viewer.style.removeProperty('width');
            viewer.style.removeProperty('height');
        }
        if (els) els.root.classList.remove('is-viewing');
        const anchor = markerScreenPosition(photoRingIndex);
        if (anchor) layoutPhotoRing(anchor);
        // 键盘焦点跟着回到环上：优先回到当前这张对应的槽位
        if (hadFocus && els) {
            const slot = photoRingSlots.indexOf(photoRingViewIndex);
            const back = (slot >= 0 && els.items[slot])
                || els.items.find(item => !item.classList.contains('is-slot-hidden'));
            if (back) back.focus();
        }
    }

    function switchPhotoRingView(delta) {
        const images = photoRingImages();
        if (!photoRingViewing || images.length < 2) return;
        photoRingViewIndex = (photoRingViewIndex + delta + images.length) % images.length;
        renderPhotoRingViewImage();
    }

    // ================= 票根墙 =================
    // 票根是独立于足迹封面和图片墙的单图资源：一条足迹最多对应一张票根。
    const ticketGallery = document.getElementById('ticketGallery');
    const ticketGalleryBtn = document.getElementById('ticketGalleryBtn');
    const ticketGalleryBack = document.getElementById('ticketGalleryBack');
    const ticketGalleryEmpty = document.getElementById('ticketGalleryEmpty');
    const ticketGalleryStats = document.getElementById('ticketGalleryStats');
    const ticketLightbox = ticketGallery;
    const ticketWallet = document.getElementById('ticketWallet');
    const ticketGalleryHint = document.getElementById('ticketGalleryHint');
    const ticketStrip = document.getElementById('ticketStrip');
    const ticketStripScroller = document.getElementById('ticketStripScroller');
    const ticketStripProgress = document.getElementById('ticketStripProgress');
    const ticketStripHint = document.getElementById('ticketStripHint');
    const ticketMetaPanel = document.getElementById('ticketMetaPanel');
    const ticketLightboxLoading = document.getElementById('ticketGalleryLoading');
    const ticketLightboxError = document.getElementById('ticketGalleryError');
    const ticketLightboxTitle = document.getElementById('ticketGalleryTitle');
    const ticketLightboxPinyin = document.getElementById('ticketGalleryPinyin');
    const ticketLightboxEnglish = document.getElementById('ticketGalleryEnglish');
    const ticketLightboxSubtitle = document.getElementById('ticketGallerySubtitle');
    const ticketLightboxDetails = document.getElementById('ticketGalleryDetails');
    const ticketLightboxDescription = document.getElementById('ticketGalleryDescription');
    const ticketLightboxCount = document.getElementById('ticketGalleryPosition');
    const ticketLightboxRetry = document.getElementById('ticketGalleryRetry');
    const ticketPassportBtn = document.getElementById('ticketPassportBtn');
    const ticketPassportCount = document.getElementById('ticketPassportCount');
    const ticketPassport = document.getElementById('ticketPassport');
    const ticketPassportBack = document.getElementById('ticketPassportBack');
    const ticketPassportGrid = document.getElementById('ticketPassportGrid');
    const ticketPassportStats = document.getElementById('ticketPassportStats');
    const ticketPassportReset = document.getElementById('ticketPassportReset');
    const ticketStampBadge = document.getElementById('ticketStampBadge');
    const ticketOracleBtn = document.getElementById('ticketOracleBtn');
    const ticketOracle = document.getElementById('ticketOracle');
    const ticketOracleBack = document.getElementById('ticketOracleBack');
    const ticketOracleCard = document.getElementById('ticketOracleCard');
    const ticketOracleStats = document.getElementById('ticketOracleStats');
    const ticketOracleInspiration = document.getElementById('ticketOracleInspiration');
    const ticketOracleView = document.getElementById('ticketOracleView');
    const ticketOracleAgain = document.getElementById('ticketOracleAgain');
    const ticketOracleClose = document.getElementById('ticketOracleClose');
    const ticketLetterBtn = document.getElementById('ticketLetterBtn');
    const ticketLetter = document.getElementById('ticketLetter');
    const ticketLetterBack = document.getElementById('ticketLetterBack');
    const ticketLetterTitle = document.getElementById('ticketLetterTitle');
    const ticketLetterImg = document.getElementById('ticketLetterImg');
    const ticketLetterStage = document.getElementById('ticketLetterStage');
    const ticketLetterStatus = document.getElementById('ticketLetterStatus');
    const ticketLetterRetry = document.getElementById('ticketLetterRetry');
    const ticketLetterCaption = document.getElementById('ticketLetterCaption');
    const ticketLetterDownload = document.getElementById('ticketLetterDownload');
    const ticketLetterShare = document.getElementById('ticketLetterShare');
    const ticketViewModes = document.getElementById('ticketViewModes');
    const ticketCityFilterChip = document.getElementById('ticketCityFilter');
    const ticketModeArchiveBtn = document.getElementById('ticketModeArchiveBtn');
    const ticketModeReplayBtn = document.getElementById('ticketModeReplayBtn');
    const ticketReplayView = document.getElementById('ticketReplayView');
    const ticketReplayCard = document.getElementById('ticketReplayCard');
    const ticketReplaySubtitle = document.getElementById('ticketReplaySubtitle');
    const ticketReplayCityBadge = document.getElementById('ticketReplayCityBadge');
    const ticketReplayRoute = document.getElementById('ticketReplayRoute');
    const ticketReplayDistance = document.getElementById('ticketReplayDistance');
    const ticketReplayTotal = document.getElementById('ticketReplayTotal');
    const ticketReplayProgressText = document.getElementById('ticketReplayProgressText');
    const ticketReplayEta = document.getElementById('ticketReplayEta');
    const ticketReplayBarInner = document.getElementById('ticketReplayBarInner');
    const ticketReplayPrev = document.getElementById('ticketReplayPrev');
    const ticketReplayPlay = document.getElementById('ticketReplayPlay');
    const ticketReplayNext = document.getElementById('ticketReplayNext');
    const ticketReplayExit = document.getElementById('ticketReplayExit');
    const ticketReplaySpeed = document.getElementById('ticketReplaySpeed');
    const ticketReplayOpen = document.getElementById('ticketReplayOpen');
    const ticketReplayFlight = document.getElementById('ticketReplayFlight');
    const ticketReplayFlightLabel = document.getElementById('ticketReplayFlightLabel');
    const ticketReplayFlightFrom = document.getElementById('ticketReplayFlightFrom');
    const ticketReplayFlightCity = document.getElementById('ticketReplayFlightCity');
    const ticketReplayFlightKm = document.getElementById('ticketReplayFlightKm');
    const ticketReplayEnd = document.getElementById('ticketReplayEnd');
    const ticketReplayEndRange = document.getElementById('ticketReplayEndRange');
    const ticketReplayEndTickets = document.getElementById('ticketReplayEndTickets');
    const ticketReplayEndCities = document.getElementById('ticketReplayEndCities');
    const ticketReplayEndKm = document.getElementById('ticketReplayEndKm');
    const ticketReplayEndSpan = document.getElementById('ticketReplayEndSpan');
    const ticketReplayEndNote = document.getElementById('ticketReplayEndNote');
    const ticketReplayAgain = document.getElementById('ticketReplayAgain');
    const ticketReplayCloseEnd = document.getElementById('ticketReplayCloseEnd');
    let ticketItems = [];
    let ticketIndex = 0;
    let ticketTrigger = null;
    let walletItems = [];      // 票夹中的票根元素 [{ fp, img }]
    const ticketImagePool = new Map();   // 已成功加载的票根图 → img，重复打开直接复用，避免重复请求
    let wheelLocked = false;   // 滚轮切换节流
    let walletTouchX = null;   // 触摸滑动起点
    let walletSwiped = false;  // 滑动后抑制随后的 click，避免一次滑动触发两次切换
    let stripScrollTimer = null;   // 横向长串滚轮停稳后的吸附计时
    let stripDrag = null;          // 横向长串拖拽状态
    // 后台“票根切换样式”：fan = 票夹叠放；strip = 横向长串浏览
    const ticketStripMode = !!(footprintCfg && footprintCfg.ticketGalleryStyle === 'strip');

    // 票根页创意功能：护照集章 + 时间有色（阶段 A）
    const TICKET_PASSPORT_STORAGE_KEY = 'footprint-ticket-passport-v1';
    const TICKET_STAMP_DWELL_MS = 1500;
    let ticketPassportRecords = [];
    let ticketStampTimer = null;
    let ticketStampIndex = -1;
    let ticketViewMode = 'archive';   // archive | replay
    let ticketCityFilter = '';        // 只看某座城市的票根（从城市卡片的票根徽章进来时设置）
    let ticketCityFilterName = '';
    let ticketOracleTimer = null;
    let ticketOracleCandidate = null;
    let ticketOracleLastIndex = -1;
    let ticketLetterFp = null;
    let ticketLetterBlobUrl = '';
    let ticketLetterFileName = '';
    let ticketLetterRenderToken = 0;   // 明信片渲染令牌：关闭浮层后丢弃未完成的渲染结果
    let ticketReplayItems = [];
    let ticketReplayPoints = [];
    let ticketReplayIndex = 0;
    let ticketReplayPlaying = false;
    let ticketReplayFlying = false;
    let ticketReplayTimer = null;
    let ticketReplayGeneration = 0;
    let ticketReplayEntryIndex = 0;              // 进入放映时的票根，退出后回到这一张
    let ticketReplayResumeIndex = -1;            // 切回票夹后，重走再进来接着播的位置
    let ticketReplayPausedByOverlay = false;     // 浮层（护照/抽票/明信片）暂停放映的标记
    let ticketReplaySpeedValue = 1;              // 播放倍速：1 或 2
    const TICKET_REPLAY_DWELL_MS = 4200;

    function ticketFeatureOn(key) {
        return !!(footprintCfg && footprintCfg[key] === true);
    }

    function ticketStampId(fp) {
        if (!fp) return '';
        const raw = fp.key ||
            ticketImageUrl(fp.ticketImage) ||
            [fp.name, fp.ticketNo, fp.ticketDate || fp.createTime].filter(Boolean).join('|');
        return String(raw || '').trim() || String(fp.name || '未知票根').trim();
    }

    function loadTicketPassport() {
        try {
            const parsed = JSON.parse(localStorage.getItem(TICKET_PASSPORT_STORAGE_KEY));
            ticketPassportRecords = Array.isArray(parsed) ? parsed.filter(r => r && r.id) : [];
        } catch (e) {
            ticketPassportRecords = [];
        }
    }

    // 打开护照时按当前票根列表清理失效记录：
    // 既避免 localStorage 只增不减，也避免删掉再重建的票根（identifier 相同）直接带上旧章。
    // 票根列表为空时不清理，防止数据还没加载完就误删整本护照。
    function pruneTicketPassport() {
        if (!ticketItems.length || !ticketPassportRecords.length) return false;
        const valid = new Set(ticketItems.map(ticketStampId).filter(Boolean));
        const kept = ticketPassportRecords.filter(record => valid.has(record.id));
        if (kept.length === ticketPassportRecords.length) return false;
        ticketPassportRecords = kept;
        persistTicketPassport();
        return true;
    }

    function persistTicketPassport() {
        try {
            localStorage.setItem(TICKET_PASSPORT_STORAGE_KEY, JSON.stringify(ticketPassportRecords));
        } catch (e) {
            /* 隐私模式/存储满时静默失败，不影响票根浏览 */
        }
    }

    function isTicketStamped(fp) {
        if (!fp) return false;
        const id = ticketStampId(fp);
        return ticketPassportRecords.some(record => record.id === id);
    }

    function clearTicketStampTimer() {
        if (ticketStampTimer) {
            clearTimeout(ticketStampTimer);
            ticketStampTimer = null;
        }
        ticketStampIndex = -1;
    }

    function stampTicket(fp) {
        if (!fp || !ticketFeatureOn('enableTicketPassport') || isTicketStamped(fp)) return;
        ticketPassportRecords.push({
            id: ticketStampId(fp),
            stampedAt: new Date().toISOString()
        });
        persistTicketPassport();
        updateTicketPassportButton();
        updateTicketStampBadge(fp, true);
    }

    function updateTicketPassportButton() {
        if (!ticketPassportBtn || !ticketPassportCount) return;
        const enabled = ticketFeatureOn('enableTicketPassport');
        ticketPassportBtn.hidden = !enabled || ticketItems.length === 0;
        if (!enabled) return;
        const stamped = ticketItems.filter(fp => isTicketStamped(fp)).length;
        ticketPassportCount.textContent = stamped + '/' + ticketItems.length;
    }

    function updateTicketLetterAction(fp) {
        if (!ticketLetterBtn) return;
        ticketLetterBtn.hidden = !ticketFeatureOn('enableTicketLetter') || !fp;
    }

    function updateTicketModeButtons() {
        if (!ticketViewModes) return;
        const replayEnabled = ticketFeatureOn('enableTicketJourneyReplay') &&
            ticketItems.filter(ticketHasCoordinate).length >= 2;
        ticketViewModes.hidden = !replayEnabled;
        if (!replayEnabled) return;
        // 只剩重走一个模式：顶部就是「票夹 / 重走」两段切换器（方案 §10）
        if (ticketModeArchiveBtn) ticketModeArchiveBtn.hidden = false;
        if (ticketModeReplayBtn) ticketModeReplayBtn.hidden = false;
        const active = ticketViewMode === 'replay' ? 'replay' : 'archive';
        if (ticketModeArchiveBtn) ticketModeArchiveBtn.classList.toggle('is-active', active === 'archive');
        if (ticketModeReplayBtn) ticketModeReplayBtn.classList.toggle('is-active', active === 'replay');
    }

    // 城市筛选：从城市卡片的票根徽章进来时，票根页只看这座城市
    function renderTicketCityFilter() {
        if (!ticketCityFilterChip) return;
        ticketCityFilterChip.hidden = !ticketCityFilter;
        if (!ticketCityFilter) return;
        ticketCityFilterChip.textContent = '只看 ' + ticketCityFilterName + ' ✕';
        ticketCityFilterChip.setAttribute('aria-label',
            '清除筛选，显示全部城市的票根（当前只看 ' + ticketCityFilterName + '）');
    }

    function resetTicketCityFilter() {
        ticketCityFilter = '';
        ticketCityFilterName = '';
        renderTicketCityFilter();
    }

    // 票根页是透明背景、刻意透出背后的 3D 地球；而卡片墙 / 城市图片墙是不透明浮层。
    // 从它们上面打开票根页时如果不把这层收起来，背景就会一直是那张卡片墙。
    // 这里只做「临时隐藏」：不改它们的 .show、不动滚动位置，关掉票根页时原样放回。
    let ticketUnderlayLayers = [];
    let ticketUnderlayFocus = null;

    function setTicketBackLabel(text) {
        if (!ticketGalleryBack) return;
        ticketGalleryBack.setAttribute('aria-label', text);
        const label = ticketGalleryBack.querySelector('span');
        if (label) label.textContent = text;
    }

    function hideTicketUnderlay() {
        const layers = [];
        if (cityView && cityView.classList.contains('show')) layers.push(cityView);
        if (cityWall && cityWall.classList.contains('show')) layers.push(cityWall);
        if (!layers.length) return;
        ticketUnderlayLayers = layers;
        ticketUnderlayFocus = layers.some(el => el.contains(document.activeElement))
            ? document.activeElement
            : null;
        layers.forEach(el => {
            el.classList.add('is-ticket-underlay');
            setOverlayHidden(el, true);   // 收起期间键盘和读屏都到不了它
        });
        document.body.classList.add('ticket-underlay-hidden');
        // 这两层打开时都会暂停地球渲染（省性能），票根页要透出地球，这里恢复渲染
        setGlobeRenderLoop(true);
        setTicketBackLabel('返回城市卡片');
    }

    function restoreTicketUnderlay() {
        const layers = ticketUnderlayLayers;
        ticketUnderlayLayers = [];
        if (!layers.length) {
            ticketUnderlayFocus = null;
            return;
        }
        layers.forEach(el => {
            el.classList.remove('is-ticket-underlay');
            setOverlayHidden(el, false);
        });
        document.body.classList.remove('ticket-underlay-hidden');
        // 不透明浮层重新盖住地球，继续暂停渲染（与 openCityWall / openCityView 一致）
        setGlobeRenderLoop(false);
        setTicketBackLabel('返回地球');
    }

    function openTicketGalleryForCity(ci) {
        const city = cityList[ci];
        if (!city || !city.key) return;
        ticketCityFilter = city.key;
        ticketCityFilterName = city.city;
        setTicketView(true);            // 打开时会按筛选重建 ticketItems
        updateTicketFeatureButtons();
    }

    // 城市筛选只属于票夹视图：切到重走、打开抽票/护照时先清掉，
    // 否则这些按 ticketItems 取数据的入口会莫名只剩一座城市
    function ensureTicketCityFilterCleared() {
        if (!ticketCityFilter) return;
        resetTicketCityFilter();
        ticketItems = ticketItemsFromFootprints();
        ticketIndex = 0;
        buildTicketWallet();
        renderTicketWallet();
    }

    function updateTicketFeatureButtons() {
        updateTicketPassportButton();
        updateTicketModeButtons();
        renderTicketCityFilter();
        if (ticketOracleBtn) {
            ticketOracleBtn.hidden = !ticketFeatureOn('enableTicketOracle') || ticketItems.length === 0;
        }
        updateTicketLetterAction(ticketItems[ticketIndex]);
    }

    function updateTicketStampBadge(fp, animate) {
        if (!ticketStampBadge) return;
        const stamped = ticketFeatureOn('enableTicketPassport') && isTicketStamped(fp);
        ticketStampBadge.hidden = !stamped;
        if (!stamped) return;
        const meta = ticketMeta(fp);
        ticketStampBadge.textContent = '已检票 · ' + (fp.city || meta.route || '') +
            (meta.date ? ' · ' + meta.date : '');
        if (animate) {
            ticketStampBadge.classList.remove('is-stale');
            void ticketStampBadge.offsetWidth;
        } else {
            ticketStampBadge.classList.add('is-stale');
        }
    }

    function startTicketStampDwell(fp) {
        clearTicketStampTimer();
        if (!ticketFeatureOn('enableTicketPassport') || ticketViewMode !== 'archive') return;
        if (isTicketStamped(fp)) return;
        ticketStampIndex = ticketIndex;
        ticketStampTimer = setTimeout(() => {
            ticketStampTimer = null;
            if (ticketGallery.classList.contains('show') &&
                ticketViewMode === 'archive' &&
                ticketIndex === ticketStampIndex &&
                ticketItems[ticketIndex] === fp &&
                !isTicketStamped(fp)) {
                stampTicket(fp);
            }
        }, TICKET_STAMP_DWELL_MS);
    }

    function renderTicketPassport() {
        if (!ticketPassportGrid || !ticketPassportStats) return;
        if (pruneTicketPassport()) updateTicketPassportButton();
        const ordered = ticketItems.slice().sort(compareTicketByTime);
        ticketPassportGrid.innerHTML = '';
        ordered.forEach(fp => {
            const stamped = isTicketStamped(fp);
            const cell = document.createElement('div');
            cell.className = 'ticket-passport-cell' + (stamped ? '' : ' is-missing');
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = ticketImageUrl(fp.ticketImage);
            img.alt = '';
            const status = document.createElement('span');
            status.className = 'ticket-passport-cell-status';
            status.textContent = stamped ? '已检票' : '未检票';
            const title = document.createElement('span');
            title.className = 'ticket-passport-cell-title';
            title.textContent = [fp.name || fp.ticketTitle, fp.city].filter(Boolean).join(' · ');
            cell.append(img, status, title);
            ticketPassportGrid.appendChild(cell);
        });
        const stamped = ordered.filter(fp => isTicketStamped(fp)).length;
        ticketPassportStats.textContent = stamped + ' / ' + ordered.length + ' 已集章' +
            (stamped === ordered.length && ordered.length ? ' · 全站抵达' : '');
        if (ticketPassportReset) {
            ticketPassportReset.hidden = ordered.length === 0;
        }
    }

    function openTicketPassport() {
        if (!ticketFeatureOn('enableTicketPassport') || !ticketItems.length || !ticketPassport) return;
        ensureTicketCityFilterCleared();
        clearTicketStampTimer();
        pauseTicketReplayForOverlay();
        renderTicketPassport();
        ticketPassport.classList.add('show');
        setOverlayHidden(ticketPassport, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
            ticketPassportBack) {
            ticketPassportBack.focus();
        }
    }

    function closeTicketPassport(returnFocus = true) {
        if (!ticketPassport || !ticketPassport.classList.contains('show')) return;
        ticketPassport.classList.remove('show');
        setOverlayHidden(ticketPassport, true);
        if (returnFocus && ticketPassportBtn && !ticketPassportBtn.hidden) {
            ticketPassportBtn.focus();
        }
        startTicketStampDwell(ticketItems[ticketIndex]);
        resumeTicketReplayFromOverlay();
    }

    // 时间有色：按票根日期月份决定页面氛围（阶段 A）
    function ticketSeasonKey(fp) {
        const raw = String((fp && (fp.ticketDate || fp.createTime)) || '');
        const match = /^(\d{4})[-/.](\d{1,2})/.exec(raw);
        if (!match) return '';
        const month = Number(match[2]);
        if (month >= 3 && month <= 5) return 'spring';
        if (month >= 6 && month <= 8) return 'summer';
        if (month >= 9 && month <= 11) return 'autumn';
        return 'winter';
    }

    function applyTicketSeason(fp) {
        if (!ticketGallery) return;
        // 时间有色只改文字强调色（CSS 变量 --season-accent），不碰背景、票根图与地球
        const season = fp ? ticketSeasonKey(fp) : '';
        if (season && ticketFeatureOn('enableTicketSeasonLight')) {
            ticketGallery.dataset.season = season;
        } else {
            ticketGallery.removeAttribute('data-season');
        }
    }

    function resetTicketSeason() {
        if (ticketGallery) {
            ticketGallery.removeAttribute('data-season');
        }
    }


    // ================= 命运抽票（阶段 B） =================
    function ticketOracleBackFace() {
        if (!ticketOracleCard) return;
        ticketOracleCard.classList.remove('is-back');
        void ticketOracleCard.offsetWidth;
        ticketOracleCard.classList.add('is-back');
        ticketOracleCard.innerHTML = '';
        if (ticketOracleStats) {
            ticketOracleStats.textContent = '正在翻找一张票…';
        }
        if (ticketOracleInspiration) ticketOracleInspiration.textContent = '';
        if (ticketOracleView) ticketOracleView.disabled = true;
    }

    function ticketOracleShowCandidate(fp) {
        if (!ticketOracleCard || !fp) return;
        ticketOracleCard.classList.remove('is-back', 'is-shuffling');
        ticketOracleCard.innerHTML = '';
        const img = document.createElement('img');
        img.alt = fp.ticketTitle || fp.name || '票根';
        img.referrerPolicy = 'no-referrer';
        img.src = ticketImageUrl(fp.ticketImage);
        img.onerror = () => {
            ticketOracleCard.innerHTML = '<span style="padding:20px;color:#6e5945;">这张票根暂时打不开<br>但它仍是一段旅程</span>';
        };
        ticketOracleCard.appendChild(img);
        const meta = ticketMeta(fp);
        if (ticketOracleStats) {
            ticketOracleStats.textContent = (fp.city || meta.route || '未知城市') +
                (meta.date ? ' · ' + meta.date : '') +
                (fp.name ? ' · ' + fp.name : '');
        }
        if (ticketOracleInspiration) {
            ticketOracleInspiration.textContent = nextTicketStopSuggestion();
        }
        if (ticketOracleView) ticketOracleView.disabled = false;
    }

    function nextTicketStopSuggestion() {
        // 与城市聚合同一套键：adcode 优先，避免同一座城市因为写法不同被当成"没去过"
        const ticketCities = new Set(ticketItems.map(cityKeyOf).filter(Boolean));
        const candidates = [];
        FOOTPRINTS.forEach(fp => {
            if (ticketImageUrl(fp.ticketImage) || !fp.city) return;
            const key = cityKeyOf(fp);
            if (!key || ticketCities.has(key) || candidates.includes(fp.city)) return;
            candidates.push(fp.city);
        });
        if (candidates.length) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            return '下一站，或许可以去「' + pick + '」看看。';
        }
        const fallbacks = [
            '把去过的城市再走一遍也不错，下一张票根正在等你。',
            '旅行的下一站不在地图上，而在你的心里。',
            '所有出发都是回家，只是路线不同。'
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    function ticketOracleShuffle() {
        clearTimeout(ticketOracleTimer);
        ticketOracleCandidate = null;
        ticketOracleBackFace();
        if (ticketOracleCard) ticketOracleCard.classList.add('is-shuffling');
        if (ticketOracleAgain) ticketOracleAgain.disabled = true;
        let steps = 0;
        const tick = () => {
            steps++;
            if (steps >= 7) {
                if (ticketOracleCard) ticketOracleCard.classList.remove('is-shuffling');
                const pickable = ticketItems.length > 1;
                let idx = ticketOracleLastIndex;
                while (pickable && idx === ticketOracleLastIndex) {
                    idx = Math.floor(Math.random() * ticketItems.length);
                }
                // 只有一张票根时不会进入上面的循环，idx 会停在 -1（对应 undefined），
                // 结果卡片一直停在背面、按钮永远不可用；这里兜底到第一张。
                if (idx < 0 || !ticketItems[idx]) idx = 0;
                ticketOracleLastIndex = idx;
                ticketOracleCandidate = ticketItems[idx];
                ticketOracleShowCandidate(ticketOracleCandidate);
                if (ticketOracleAgain) ticketOracleAgain.disabled = false;
                return;
            }
            ticketOracleTimer = setTimeout(tick, 130);
        };
        ticketOracleTimer = setTimeout(tick, 130);
    }

    function openTicketOracle() {
        if (!ticketFeatureOn('enableTicketOracle') || !ticketItems.length || !ticketOracle) return;
        ensureTicketCityFilterCleared();
        clearTicketStampTimer();
        pauseTicketReplayForOverlay();
        ticketOracle.classList.add('show');
        setOverlayHidden(ticketOracle, false);
        ticketOracleShuffle();
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
            ticketOracleBack) {
            ticketOracleBack.focus();
        }
    }

    function closeTicketOracle(returnFocus = true) {
        if (!ticketOracle || !ticketOracle.classList.contains('show')) return;
        clearTimeout(ticketOracleTimer);
        ticketOracleTimer = null;
        ticketOracleCandidate = null;
        ticketOracle.classList.remove('show');
        setOverlayHidden(ticketOracle, true);
        if (returnFocus && ticketOracleBtn && !ticketOracleBtn.hidden) {
            ticketOracleBtn.focus();
        }
        startTicketStampDwell(ticketItems[ticketIndex]);
        resumeTicketReplayFromOverlay();
    }

    function openOracleTicketInArchive() {
        if (!ticketOracleCandidate) return;
        const idx = ticketItems.indexOf(ticketOracleCandidate);
        closeTicketOracle(false);
        if (idx < 0) return;
        // 抽票浮层里点「查看这张票」：先回到票夹，再定位到这张票
        if (ticketViewMode !== 'archive') setTicketViewMode('archive');
        ticketIndex = idx;
        buildTicketWallet();
        renderTicketWallet();
        if (ticketStripMode) {
            requestAnimationFrame(() => {
                centerStripItem(ticketIndex, false);
                positionStripArchive();
            });
        }
    }

    // 重走里点「查看这张票」：回到票夹并定位到当前这一站
    function openReplayTicketInArchive() {
        const fp = ticketReplayPoints[ticketReplayIndex];
        if (!fp) return;
        const idx = ticketItems.indexOf(fp);
        if (idx < 0) return;
        if (ticketViewMode !== 'archive') setTicketViewMode('archive');
        ticketIndex = idx;
        buildTicketWallet();
        renderTicketWallet();
        if (ticketStripMode) {
            requestAnimationFrame(() => {
                centerStripItem(ticketIndex, false);
                positionStripArchive();
            });
        }
    }

    // ================= 未寄出的明信片（阶段 B） =================
    function wrapTicketLetterText(ctx, text, maxWidth) {
        const lines = [];
        String(text || '').split('\n').forEach(paragraph => {
            let line = '';
            paragraph.split('').forEach(ch => {
                const test = line + ch;
                if (ctx.measureText(test).width > maxWidth && line) {
                    lines.push(line);
                    line = ch;
                } else {
                    line = test;
                }
            });
            if (line) lines.push(line);
        });
        return lines;
    }

    function ticketLetterCanvas(fp, image) {
        const meta = ticketMeta(fp);
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 1280;
        const ctx = canvas.getContext('2d');
        const cream = '#f3eee2';
        const ink = '#35423d';
        const muted = '#8b7865';
        const accent = '#9b704e';
        const bg = ctx.createLinearGradient(0, 0, 0, 1280);
        bg.addColorStop(0, '#e8e0d2');
        bg.addColorStop(1, '#d6cbb8');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 900, 1280);
        ctx.strokeStyle = 'rgba(118,92,61,0.34)';
        ctx.lineWidth = 3;
        ctx.strokeRect(24, 24, 852, 1232);

        ctx.fillStyle = accent;
        ctx.font = '600 24px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('A LETTER FROM A TICKET', 450, 78);
        ctx.fillStyle = ink;
        ctx.font = '400 44px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
        ctx.fillText('未寄出的明信片', 450, 132);

        // 票根图直接贴在纸面上：不垫白卡、不加粗边框，按内容宽度铺满，
        // 高度由图片自身比例决定；下面的正文起点跟着图高浮动，长图短图都不会顶到文字。
        const shotX = 40;
        const shotW = 820;
        const shotTop = 168;
        const shotMaxH = 520;
        let shotBottom = shotTop + 360;
        if (image) {
            const scale = Math.min(shotW / image.width, shotMaxH / image.height);
            const dw = image.width * scale;
            const dh = image.height * scale;
            const dx = shotX + (shotW - dw) / 2;
            ctx.drawImage(image, dx, shotTop, dw, dh);
            shotBottom = shotTop + dh;
        } else {
            ctx.fillStyle = '#e4dccd';
            ctx.fillRect(shotX, shotTop, shotW, shotBottom - shotTop);
            ctx.fillStyle = muted;
            ctx.font = '400 150px "Noto Serif SC", "Songti SC", serif';
            ctx.textAlign = 'center';
            ctx.fillText((fp.city || '?').charAt(0), 450, shotTop + 260);
        }
        // 图下小字：城市 · 日期 · 票根名
        ctx.fillStyle = muted;
        ctx.font = '400 24px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
        ctx.textAlign = 'center';
        ctx.fillText(
            [fp.city || meta.route, meta.date, fp.name || meta.title].filter(Boolean).join(' · '),
            450,
            shotBottom + 44
        );

        // 信件正文
        const desc = String(fp.description || '').trim();
        const noText = meta.no ? '，编号是 ' + meta.no : '';
        const typeText = fp.ticketType ? '；那是一段关于「' + fp.ticketType + '」的旅程' : '';
        const descText = desc ? ' 我还记得：' + (desc.length > 80 ? desc.slice(0, 80) + '…' : desc) : '';
        const letter =
            '致许多年后的自己：\n' +
            '这一张票根，写于' + (meta.date || '某一天') + '的' + (fp.city || meta.route || '远方') + '。\n' +
            '那时候的旅程叫「' + (meta.title || '一次出发') + '」' + noText + typeText + '。' +
            descText + '当时没有说出口的话，都留在这张纸里了。\n' +
            '—— 一张票根，代替当时的我寄出。';
        ctx.fillStyle = ink;
        ctx.font = '400 30px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
        ctx.textAlign = 'left';
        const lines = wrapTicketLetterText(ctx, letter, 760);
        const lineHeight = 46;
        const startY = shotBottom + 106;
        // 正文行数按剩余高度算：图高变化时不会把落款挤出去
        const maxLines = Math.max(4, Math.floor((1224 - startY) / lineHeight));
        lines.slice(0, maxLines).forEach((line, i) => {
            ctx.fillText(line, 70, startY + i * lineHeight);
        });

        ctx.textAlign = 'right';
        ctx.fillStyle = muted;
        ctx.font = '26px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText('旅行记忆 · 票根收藏', 852, 1245);
        return canvas;
    }

    // 写信页三种状态：loading（骨架 + 文案）/ ready（出图 + 可下载）/ error（说明 + 重新生成）
    function setTicketLetterState(state) {
        if (ticketLetterStage) {
            ticketLetterStage.classList.toggle('is-loading', state === 'loading');
            ticketLetterStage.classList.toggle('is-ready', state === 'ready');
            ticketLetterStage.classList.toggle('is-error', state === 'error');
            ticketLetterStage.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
        }
        if (ticketLetterStatus) {
            ticketLetterStatus.textContent = state === 'loading'
                ? '正在写这封信…'
                : (state === 'error' ? '这封信没能生成，可能是票根图取不到。' : '');
        }
        if (ticketLetterRetry) ticketLetterRetry.hidden = state !== 'error';
        if (ticketLetterDownload) ticketLetterDownload.disabled = state !== 'ready';
    }

    async function renderTicketLetter() {
        const fp = ticketLetterFp;
        if (!fp) return;
        // 渲染是异步的（图片 + 两次 toBlob）：关闭浮层或换票后本次结果作废，
        // 否则会把 blob URL 和 src 写回已关闭的浮层，并漏掉一次 revokeObjectURL
        const token = ++ticketLetterRenderToken;
        if (ticketLetterBlobUrl) URL.revokeObjectURL(ticketLetterBlobUrl);
        ticketLetterBlobUrl = '';
        if (ticketLetterShare) ticketLetterShare.hidden = true;
        setTicketLetterState('loading');
        const image = await loadPostcardImage(ticketImageUrl(fp.ticketImage));
        if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
        let canvas = ticketLetterCanvas(fp, image);
        let blob = await postcardToBlob(canvas);
        if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
        if (!blob) {
            canvas = ticketLetterCanvas(fp, null);
            blob = await postcardToBlob(canvas);
        }
        if (!blob) {
            setTicketLetterState('error');
            return;
        }
        if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
        ticketLetterBlobUrl = URL.createObjectURL(blob);
        ticketLetterImg.src = ticketLetterBlobUrl;
        setTicketLetterState('ready');
        const ts = String(fp.ticketDate || fp.createTime || '').replace(/-/g, '');
        ticketLetterFileName = (fp.city || '票根') + '-' + (ts || 'letter') + '-未寄出的明信片.png';
        ticketLetterShare.hidden = !(
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [new File([blob], ticketLetterFileName, { type: 'image/png' })] })
        );
    }

    async function openTicketLetter(fp) {
        if (!ticketFeatureOn('enableTicketLetter') || !fp || !ticketLetter) return;
        clearTicketStampTimer();
        pauseTicketReplayForOverlay();
        ticketLetterFp = fp;
        if (ticketLetterTitle) {
            ticketLetterTitle.textContent = (fp.city ? fp.city + ' · ' : '') + '未寄出的明信片';
        }
        const meta = ticketMeta(fp);
        if (ticketLetterCaption) {
            ticketLetterCaption.textContent = [
                '由「' + (fp.name || meta.title || '这张票根') + '」写成',
                fp.city || meta.route,
                meta.date
            ].filter(Boolean).join(' · ');
        }
        if (ticketLetterImg) {
            ticketLetterImg.alt = (fp.city || '票根') + ' 的未寄出的明信片';
        }
        setTicketLetterState('loading');
        ticketLetterImg.removeAttribute('src');
        ticketLetter.classList.add('show');
        setOverlayHidden(ticketLetter, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
            ticketLetterBack) {
            ticketLetterBack.focus();
        }
        await renderTicketLetter();
    }

    function closeTicketLetter(returnFocus = true) {
        if (!ticketLetter || !ticketLetter.classList.contains('show')) return;
        ticketLetterRenderToken++;   // 作废仍在进行中的渲染
        ticketLetter.classList.remove('show');
        setOverlayHidden(ticketLetter, true);
        ticketLetterImg.removeAttribute('src');
        setTicketLetterState('loading');   // 下次打开从骨架态开始
        if (ticketLetterBlobUrl) {
            URL.revokeObjectURL(ticketLetterBlobUrl);
            ticketLetterBlobUrl = '';
        }
        ticketLetterFp = null;
        if (returnFocus && ticketLetterBtn && !ticketLetterBtn.hidden) {
            ticketLetterBtn.focus();
        }
        startTicketStampDwell(ticketItems[ticketIndex]);
        resumeTicketReplayFromOverlay();
    }

    function downloadTicketLetter() {
        if (!ticketLetterBlobUrl) return;
        const a = document.createElement('a');
        a.href = ticketLetterBlobUrl;
        a.download = ticketLetterFileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    async function shareTicketLetter() {
        if (!ticketLetterBlobUrl) return;
        const blob = await fetch(ticketLetterBlobUrl).then(r => r.blob());
        const file = new File([blob], ticketLetterFileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: ticketLetterFileName });
            } catch (e) { /* 用户取消分享无需处理 */ }
        }
    }

    // ================= 票根排序与坐标工具（重走 / 护照共用） =================
    function sortedTicketItems() {
        return ticketItems.slice().sort(compareTicketByTime);
    }

    function ticketTimeKey(fp) {
        return String((fp && (fp.ticketDate || fp.createTime)) || '');
    }

    function ticketNameKey(fp) {
        return String((fp && (fp.name || fp.ticketTitle)) || '');
    }

    // 全局统一的时间线排序：ticketDate || createTime 升序；
    // 两个字段都缺失的票排到最后（空串 localeCompare 最小，直接字符串比较会把它排到最前）；
    // 同值按名称、key 兜底，保证重走/护照各功能顺序一致。
    function compareTicketByTime(a, b) {
        const ka = ticketTimeKey(a);
        const kb = ticketTimeKey(b);
        if (!ka && kb) return 1;
        if (ka && !kb) return -1;
        const byDate = ka.localeCompare(kb);
        if (byDate) return byDate;
        const byName = ticketNameKey(a).localeCompare(ticketNameKey(b), 'zh-Hans-CN');
        if (byName) return byName;
        return String((a && a.key) || '').localeCompare(String((b && b.key) || ''));
    }

    function ticketHasCoordinate(fp) {
        if (!fp) return false;
        const rawLng = fp.lng;
        const rawLat = fp.lat;
        // 空值不能走 Number()：Number(null) / Number('') 都是 0，会被误判成有效坐标
        if (rawLng === '' || rawLng == null || rawLat === '' || rawLat == null) return false;
        const lng = Number(rawLng);
        const lat = Number(rawLat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
        // (0, 0) 是后台表单未填写坐标时的默认值，视为没有定位
        return !(lng === 0 && lat === 0);
    }

    // 同城判定：优先比 adcode，没有 adcode 才比城市名；
    // 两边都得有值，否则城市为空的票根会被误判成“同一城市”，整场放映一次都不飞。
    function isSameTicketCity(a, b) {
        const codeA = String((a && a.cityAdcode) || '').trim();
        const codeB = String((b && b.cityAdcode) || '').trim();
        if (codeA && codeB) return codeA === codeB;
        const cityA = String((a && a.city) || '').trim();
        const cityB = String((b && b.city) || '').trim();
        return !!cityA && cityA === cityB;
    }

    // ================= 重走一遍（阶段 D） =================
    function updateTicketReplayPlayButton() {
        if (ticketReplayPlay) {
            ticketReplayPlay.textContent = ticketReplayPlaying ? '暂停' : '继续';
        }
    }

    function updateTicketReplaySpeedButton() {
        if (!ticketReplaySpeed) return;
        ticketReplaySpeed.textContent = ticketReplaySpeedValue + '×';
        ticketReplaySpeed.setAttribute('aria-label', '播放速度，当前 ' + ticketReplaySpeedValue + ' 倍速');
        ticketReplaySpeed.classList.toggle('is-on', ticketReplaySpeedValue > 1);
    }

    function toggleTicketReplaySpeed() {
        ticketReplaySpeedValue = ticketReplaySpeedValue > 1 ? 1 : 2;
        updateTicketReplaySpeedButton();
        // 正在放映就按新倍速重排下一段（当前停留重新计时，不跳站）
        if (ticketReplayPlaying) scheduleNextTicketReplay();
        if (ticketReplayEta) ticketReplayEta.textContent = ticketReplayRemainingText();
    }

    // 剩余时间：按「停留 + 飞行 + 落卡停顿」的整段估算，同城/缺坐标的段会更快，所以标「约」
    function ticketReplayRemainingText() {
        const len = ticketReplayPoints.length;
        const left = Math.max(0, len - 1 - ticketReplayIndex);
        if (!left) return '';
        const perStopMs = (TICKET_REPLAY_DWELL_MS + 2300 + 480) / ticketReplaySpeedValue;
        const seconds = Math.round(left * perStopMs / 1000);
        return '剩余约 ' + (seconds >= 90 ? Math.round(seconds / 60) + ' 分钟' : seconds + ' 秒');
    }

    function ticketReplayFlyTo(fp, duration, onDone) {
        if (!fp || !ticketHasCoordinate(fp)) {
            // 没有坐标时不飞：仍回调，避免调用方把 ticketReplayFlying 卡在 true
            if (onDone) onDone();
            return;
        }
        const target = Cesium.Cartesian3.fromDegrees(Number(fp.lng), Number(fp.lat), 150000);
        const dur = reduceMotion ? 0 : Math.max(0, duration || 0);
        if (dur <= 0) {
            viewer.camera.flyTo({ destination: target, duration: 0 });
            if (onDone) onDone();
            return;
        }
        viewer.camera.flyTo({
            destination: target,
            duration: dur,
            complete: onDone || undefined,
            cancel: onDone || undefined
        });
    }

    // 相机飞行是异步的：暂停/改站/退出时必须显式取消，
    // 否则镜头会继续飞向已经放弃的目标（票夹已经回来了，地球还在动）
    function cancelTicketReplayFlight() {
        try {
            viewer.camera.cancelFlight();
        } catch (e) {
            /* 相机未在飞行或场景尚未就绪时忽略 */
        }
    }

    function ticketReplayShowStop(index, animate) {
        const points = ticketReplayPoints;
        if (!points.length) return;
        const len = points.length;
        ticketReplayIndex = Math.max(0, Math.min(index, len - 1));
        const fp = points[ticketReplayIndex];
        // 放映期间不改写票夹游标；退出时由 clearTicketReplay 复位到进入前的票根

        ticketReplayCard.classList.remove('is-arriving', 'is-missing');
        ticketReplayCard.innerHTML = '';
        const img = document.createElement('img');
        img.alt = fp.ticketTitle || fp.name || '票根';
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.onerror = () => {
            ticketReplayCard.classList.add('is-missing');
            ticketReplayCard.textContent = (fp.city || fp.name || '?').charAt(0);
        };
        img.src = ticketImageUrl(fp.ticketImage);
        ticketReplayCard.appendChild(img);
        if (animate) {
            void ticketReplayCard.offsetWidth;
            ticketReplayCard.classList.add('is-arriving');
        }

        const meta = ticketMeta(fp);
        ticketReplaySubtitle.textContent = [fp.name || meta.title, fp.city || meta.route, meta.date]
            .filter(Boolean).join(' · ');
        // 时间有色：氛围色跟随当前放映到的那一张票根
        applyTicketSeason(fp);
        // 第二行拆成「状态文字 + 里程数字」两块：数字单独给强调色与等宽数字，移动中更醒目
        let routeText;
        let distanceText = '';
        if (ticketReplayIndex === 0) {
            routeText = ticketHasCoordinate(fp) ? '旅程起点' : '旅程起点 · 这张票根没有定位';
        } else {
            const prev = points[ticketReplayIndex - 1];
            const sameCity = isSameTicketCity(prev, fp);
            const noCoord = !ticketHasCoordinate(prev) || !ticketHasCoordinate(fp);
            if (noCoord) {
                routeText = '上一站无法定位，原地淡入下一张';
            } else if (sameCity) {
                routeText = '与上一站同一城市，原地停留';
            } else {
                routeText = '沿着上一站的方向继续';
                distanceText = '距上一站 ' + Math.round(haversineKm(prev, fp)).toLocaleString('zh-CN') + ' km';
            }
        }
        ticketReplayRoute.textContent = routeText;
        if (ticketReplayDistance) {
            ticketReplayDistance.textContent = distanceText;
        }
        // 同城角标：这座城市在本次重走里有多张票根时，标出这是第几张
        if (ticketReplayCityBadge) {
            const key = cityKeyOf(fp);
            let badge = '';
            if (key) {
                const group = ticketReplayPoints.filter(item => cityKeyOf(item) === key);
                if (group.length > 1) {
                    const position = group.indexOf(fp) + 1;
                    badge = (String(fp.city || '').trim() || '同城') + ' · 同城 ' + position + '/' + group.length;
                }
            }
            ticketReplayCityBadge.textContent = badge;
            ticketReplayCityBadge.hidden = !badge;
        }
        const totalKm = ticketReplayKilometers(ticketReplayIndex);
        ticketReplayProgressText.textContent = (ticketReplayIndex + 1) + ' / ' + len;
        // 累计里程和「距上一站」放在同一行，进度区只留进度与剩余时间
        if (ticketReplayTotal) {
            ticketReplayTotal.textContent = totalKm > 0
                ? '累计 ' + Math.round(totalKm).toLocaleString('zh-CN') + ' km'
                : '';
        }
        if (ticketReplayEta) {
            ticketReplayEta.textContent = ticketReplayRemainingText();
        }
        if (ticketReplayBarInner) {
            /* 进度条走 transform: scaleX，别动 width（宽度动画会触发重排） */
            ticketReplayBarInner.style.transform = 'scaleX(' + ((ticketReplayIndex + 1) / len) + ')';
        }
        // 预加载下一张，避免飞行落地后才开始解码
        const next = points[ticketReplayIndex + 1];
        if (next) {
            const pre = new Image();
            pre.src = ticketImageUrl(next.ticketImage);
        }
    }

    // 从第一张票根累加到第 upTo 张的直线估算里程。
    // 缺坐标的段和「同城段」都跳过：界面上这两类段也不显示里程，累计口径保持一致
    function ticketReplayKilometers(upTo) {
        const points = ticketReplayPoints;
        const end = Math.min(upTo, points.length - 1);
        let km = 0;
        for (let i = 1; i <= end; i++) {
            const from = points[i - 1];
            const to = points[i];
            if (!ticketHasCoordinate(from) || !ticketHasCoordinate(to)) continue;
            if (isSameTicketCity(from, to)) continue;
            km += haversineKm(from, to);
        }
        return km;
    }

    function ticketReplayShowFlight(from, to, kmValue, flightSeconds) {
        if (!ticketReplayFlight) return;
        if (ticketReplayView) ticketReplayView.classList.add('is-flying');
        // 进度条动画时长跟着实际飞行时长走（变速时同步）
        ticketReplayFlight.style.setProperty('--flight-duration', (flightSeconds || 2.3) + 's');
        const km = kmValue ? Math.round(kmValue).toLocaleString('zh-CN') + ' km' : '';
        ticketReplayFlightLabel.textContent = '正在飞往';
        if (ticketReplayFlightFrom) {
            ticketReplayFlightFrom.textContent = (from && (from.city || from.name)) || '上一站';
        }
        ticketReplayFlightCity.textContent = to.city || to.name || '下一站';
        ticketReplayFlightKm.textContent = km ? '约 ' + km + ' · 直线估算' : '';
        // 每次起飞都重放一次进度条：先摘掉 is-on 再强制重排
        ticketReplayFlight.classList.remove('is-on');
        void ticketReplayFlight.offsetWidth;
        ticketReplayFlight.classList.add('is-on');
        ticketReplayFlight.setAttribute('aria-hidden', 'false');
        // 底部影院条同步跟着走：状态行说去哪个城市，里程行显示这一段
        if (ticketReplayRoute) {
            ticketReplayRoute.textContent = '正在飞往 ' + (to.city || to.name || '下一站');
        }
        if (ticketReplayDistance) {
            ticketReplayDistance.textContent = km ? '约 ' + km : '';
        }
    }

    function ticketReplayHideFlight() {
        if (ticketReplayFlight) {
            ticketReplayFlight.classList.remove('is-on');
            ticketReplayFlight.setAttribute('aria-hidden', 'true');
        }
        if (ticketReplayView) ticketReplayView.classList.remove('is-flying');
    }

    // 票根放大 / 收起：只有用户明确点票根才会放大（方案 A）
    function ticketReplaySetZoom(zoom) {
        if (!ticketReplayView || !ticketReplayCard) return;
        ticketReplayView.classList.toggle('is-focused', !!zoom);
        ticketReplayCard.setAttribute('aria-expanded', zoom ? 'true' : 'false');
        ticketReplayCard.setAttribute('aria-label', zoom ? '收起票根' : '放大票根');
    }

    function toggleTicketReplayZoom() {
        if (ticketViewMode !== 'replay' || !ticketReplayCard) return;
        // 飞行途中卡片是淡出的，这时不允许（键盘）触发放大
        if (ticketReplayView.classList.contains('is-flying')) return;
        const zoomed = ticketReplayView.classList.contains('is-focused');
        if (zoomed) {
            ticketReplaySetZoom(false);
            return;
        }
        // 点票根的意思就是「停下来让我看清这张」：正在放映就先暂停
        if (ticketReplayPlaying) pauseTicketReplay();
        ticketReplaySetZoom(true);
    }

    function scheduleNextTicketReplay() {
        clearTimeout(ticketReplayTimer);
        ticketReplayTimer = null;
        if (!ticketReplayPlaying || ticketViewMode !== 'replay') return;
        const gen = ticketReplayGeneration;
        const rate = ticketReplaySpeedValue;
        ticketReplayTimer = setTimeout(() => {
            if (gen !== ticketReplayGeneration || !ticketReplayPlaying || ticketReplayFlying) return;
            const points = ticketReplayPoints;
            const next = ticketReplayIndex + 1;
            if (next >= points.length) {
                finishTicketReplay();
                return;
            }
            const from = points[ticketReplayIndex];
            const to = points[next];
            const sameCity = isSameTicketCity(from, to);
            const noCoord = !ticketHasCoordinate(from) || !ticketHasCoordinate(to);
            if (sameCity || noCoord) {
                ticketReplayTimer = setTimeout(() => {
                    if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                    ticketReplayHideFlight();
                    ticketReplayShowStop(next, true);
                    scheduleNextTicketReplay();
                }, 520 / rate);
            } else {
                const km = haversineKm(from, to);
                const flightSeconds = 2.3 / rate;
                ticketReplayFlying = true;
                ticketReplayShowFlight(from, to, km, flightSeconds);
                ticketReplayFlyTo(to, flightSeconds, () => {
                    if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                    ticketReplayFlying = false;
                    ticketReplayTimer = setTimeout(() => {
                        if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                        ticketReplayHideFlight();
                        ticketReplayShowStop(next, true);
                        scheduleNextTicketReplay();
                    }, 480 / rate);
                });
            }
        }, TICKET_REPLAY_DWELL_MS / rate);
    }

    function pauseTicketReplay() {
        if (!ticketReplayPlaying) return;
        ticketReplayGeneration++;
        ticketReplayPlaying = false;
        clearTimeout(ticketReplayTimer);
        ticketReplayTimer = null;
        ticketReplayFlying = false;
        cancelTicketReplayFlight();
        ticketReplayHideFlight();
        // 方案 A：暂停只冻结当前画面，不再把票根搬到画面中央
        if (ticketReplayView) ticketReplayView.classList.add('is-paused');
        updateTicketReplayPlayButton();
    }

    function resumeTicketReplay() {
        if (ticketReplayPlaying || !ticketReplayPoints.length || ticketViewMode !== 'replay') return;
        if (!ticketReplayEnd.hidden) return;
        ticketReplayGeneration++;
        ticketReplayPlaying = true;
        updateTicketReplayPlayButton();
        if (ticketReplayView) ticketReplayView.classList.remove('is-paused');
        ticketReplaySetZoom(false);
        ticketReplayShowStop(ticketReplayIndex, false);
        scheduleNextTicketReplay();
    }

    // 抽票/护照/明信片浮层打开时暂停放映，关闭后接着播，不丢播放位置
    function pauseTicketReplayForOverlay() {
        if (ticketViewMode !== 'replay' || !ticketReplayPlaying) return;
        ticketReplayPausedByOverlay = true;
        pauseTicketReplay();
    }

    function resumeTicketReplayFromOverlay() {
        if (!ticketReplayPausedByOverlay) return;
        ticketReplayPausedByOverlay = false;
        if (ticketViewMode !== 'replay' || !ticketGallery.classList.contains('show')) return;
        if (!ticketReplayEnd.hidden) return;
        resumeTicketReplay();
    }

    // 手动上一站/下一站：卡片立即切换，同时把镜头带到这一站（缺坐标时保持原地）
    function ticketReplayFlyToStop(index) {
        const fp = ticketReplayPoints[index];
        if (!ticketHasCoordinate(fp)) return;
        ticketReplayFlyTo(fp, 1.4, null);
    }

    function stepTicketReplay(delta) {
        if (!ticketReplayPoints.length || !ticketReplayEnd.hidden) return;
        const wasPlaying = ticketReplayPlaying;
        pauseTicketReplay();
        const len = ticketReplayPoints.length;
        const next = (ticketReplayIndex + delta + len) % len;
        // 播放中不重复触发落卡动画：紧接着的 resume 会重绘当前卡片
        ticketReplayShowStop(next, !wasPlaying);
        ticketReplayFlyToStop(next);
        if (wasPlaying) resumeTicketReplay();
    }

    function finishTicketReplay() {
        if (!ticketReplayEnd) return;
        ticketReplayGeneration++;
        ticketReplayPlaying = false;
        clearTimeout(ticketReplayTimer);
        ticketReplayTimer = null;
        ticketReplayFlying = false;
        ticketReplayHideFlight();
        updateTicketReplayPlayButton();
        const points = ticketReplayPoints;
        const km = ticketReplayKilometers(points.length - 1);
        const cities = new Set(points.map(fp => fp.city).filter(Boolean));
        const first = points[0];
        const last = points[points.length - 1];
        const stamp = fp => {
            const raw = String(fp.ticketDate || fp.createTime || '').slice(0, 10);
            return raw ? raw.replace(/-/g, '.') : '';
        };
        const yearOf = fp => Number(String(fp.ticketDate || fp.createTime || '').slice(0, 4));
        const yearA = yearOf(first);
        const yearB = yearOf(last);
        if (ticketReplayEndRange) {
            const from = stamp(first);
            const to = stamp(last);
            ticketReplayEndRange.textContent = (from && to && from !== to) ? from + ' → ' + to : (from || '');
        }
        if (ticketReplayEndTickets) ticketReplayEndTickets.textContent = String(points.length);
        if (ticketReplayEndCities) ticketReplayEndCities.textContent = cities.size ? String(cities.size) : '—';
        if (ticketReplayEndKm) ticketReplayEndKm.textContent = Math.round(km).toLocaleString('zh-CN');
        if (ticketReplayEndSpan) {
            ticketReplayEndSpan.textContent = (yearA && yearB && yearB >= yearA)
                ? String(yearB - yearA + 1)
                : '—';
        }
        // 重走只放映「带票根图」的足迹，这里说明一下总数，免得用户以为别的足迹丢了
        if (ticketReplayEndNote) {
            const withoutTicket = Math.max(0, FOOTPRINTS.length - ticketItems.length);
            ticketReplayEndNote.textContent = withoutTicket
                ? '重走只放映有票根图的足迹，另有 ' + withoutTicket + ' 个足迹未附票根'
                : '';
            ticketReplayEndNote.hidden = !withoutTicket;
        }
        ticketReplayEnd.hidden = false;
        if (ticketReplayView) ticketReplayView.classList.add('is-ended');
        ticketReplayResumeIndex = 0;   // 已播完：下次进重走从头开始，而不是停在终点卡
    }

    function startTicketReplay(startIndex = 0) {
        if (!ticketReplayPoints.length) return;
        ticketReplayGeneration++;
        ticketReplayPlaying = true;
        ticketReplayFlying = false;
        const len = ticketReplayPoints.length;
        const start = Math.max(0, Math.min(Number(startIndex) || 0, len - 1));
        ticketReplayIndex = start;
        if (ticketReplayEnd) ticketReplayEnd.hidden = true;
        ticketReplayHideFlight();
        if (ticketReplayView) {
            ticketReplayView.classList.remove('is-focused', 'is-flying', 'is-paused', 'is-ended');
        }
        ticketReplaySetZoom(false);
        pauseAutoRotate('replay');   // 放映期间暂停自转，退出放映时按用户偏好恢复
        ticketReplayShowStop(start, true);
        if (ticketHasCoordinate(ticketReplayPoints[start])) {
            ticketReplayFlyTo(ticketReplayPoints[start], 0.001, null);
        }
        scheduleNextTicketReplay();
        updateTicketReplayPlayButton();
    }

    // 至少两张带经纬度的票根才能放映（入口按钮与进入校验共用同一条件）
    function canEnterTicketReplay() {
        return !!ticketReplayView && ticketItems.filter(ticketHasCoordinate).length >= 2;
    }

    function enterTicketReplay() {
        if (!ticketReplayView) return;
        ticketReplayItems = sortedTicketItems();
        ticketReplayPoints = ticketReplayItems;
        if (!canEnterTicketReplay()) return;
        updateTicketReplaySpeedButton();
        // 只在真正进入放映时记录一次当前票根，退出时复位
        ticketReplayEntryIndex = ticketIndex;
        ticketGallery.classList.add('is-replay-mode');
        ticketReplayView.hidden = false;
        // 从票夹切回来时接着上次的站继续播（-1 表示从头开始）
        startTicketReplay(ticketReplayResumeIndex);
        updateTicketModeButtons();
    }

    function clearTicketReplay() {
        const wasReplay = ticketViewMode === 'replay';
        ticketReplayGeneration++;
        ticketReplayPlaying = false;
        ticketReplayFlying = false;
        clearTimeout(ticketReplayTimer);
        ticketReplayTimer = null;
        cancelTicketReplayFlight();
        ticketReplayHideFlight();
        if (ticketReplayEnd) ticketReplayEnd.hidden = true;
        if (ticketReplayView) ticketReplayView.hidden = true;
        if (ticketReplayView) ticketReplayView.classList.remove('is-focused', 'is-flying', 'is-paused', 'is-ended');
        ticketReplaySetZoom(false);
        if (ticketGallery) ticketGallery.classList.remove('is-replay-mode');
        // 回到进入放映前的票根，不停留在最后看过的那一张；
        // 只有真的在放映中才复位，避免之后切模式时把票夹游标拽回旧位置
        if (wasReplay) {
            // 记下播到哪一站：切回票夹再进来能接着播
            ticketReplayResumeIndex = ticketReplayIndex;
            if (ticketItems[ticketReplayEntryIndex]) ticketIndex = ticketReplayEntryIndex;
        }
        ticketReplayPausedByOverlay = false;
        resumeAutoRotate('replay');   // 退出放映：按用户偏好恢复自转
        updateTicketReplayPlayButton();
    }

    function setTicketViewMode(mode) {
        if (mode === ticketViewMode) return;
        ensureTicketCityFilterCleared();
        clearTicketReplay();
        if (mode === 'replay') {
            // 先校验再改状态：不满足条件时保持票夹视图，避免模式卡在 replay
            if (!canEnterTicketReplay()) {
                ticketViewMode = 'archive';
                updateTicketModeButtons();
                return;
            }
            ticketViewMode = 'replay';
            clearTicketStampTimer();
            enterTicketReplay();
        } else {
            ticketViewMode = 'archive';
            clearTicketStampTimer();
            if (ticketItems[ticketIndex]) {
                applyTicketSeason(ticketItems[ticketIndex]);
            }
            renderTicketWallet();
            // 退出放映后把横向长串重新居中到入口票根，避免字幕与卷轴错位
            if (ticketStripMode) {
                requestAnimationFrame(() => {
                    centerStripItem(ticketIndex, false);
                    positionStripArchive();
                });
            }
            updateTicketModeButtons();
            startTicketStampDwell(ticketItems[ticketIndex]);
            // 从重走回到票夹：自动旋转开着时同样把视角收回整个地球
            restoreGlobeViewForAutoRotate();
        }
    }

    function ticketEscape(value) {
        return String(value || '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    }

    function ticketImageUrl(value) {
        // Halo 附件字段在不同版本/配置下可能返回 URL 字符串、对象或单元素数组。
        if (Array.isArray(value)) value = value.find(item => ticketImageUrl(item)) || '';
        if (value && typeof value === 'object') {
            value = value.url || value.src || value.thumbnail || value.path || value.spec?.url || '';
        }
        const url = String(value || '').trim();
        if (/^https?:\/\//i.test(url)) return url;
        if (/^\/\//.test(url)) return window.location.protocol + url;
        if (/^\//.test(url)) return url;
        return '';
    }

    function ticketDate(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
        return match ? match[1] + '.' + match[2] + '.' + match[3] : raw;
    }

    function ticketItemsFromFootprints() {
        return FOOTPRINTS.filter(fp =>
            ticketImageUrl(fp.ticketImage) &&
            (!ticketCityFilter || cityKeyOf(fp) === ticketCityFilter));
    }

    function ticketMeta(fp) {
        return {
            title: fp.name || fp.ticketTitle || '未命名足迹',
            subtitle: '',
            date: ticketDate(fp.ticketDate || fp.createTime),
            route: fp.city || '',
            province: fp.province || '',
            no: fp.ticketNo || '',
            type: fp.ticketType || fp.footprintType || '',
            description: fp.description || ''
        };
    }

    // 后台按行政区划代码记录城市/省份；前端据此补上不带声调的拼音。
    // 映射表由 district-pinyin.js 注入到 window.FOOTPRINT_PINYIN。
    function ticketPinyin(adcode) {
        if (!adcode || !window.FOOTPRINT_PINYIN) return '';
        const key = String(adcode || '').replace(/\.0+$/, '').padStart(6, '0');
        return window.FOOTPRINT_PINYIN[key] || '';
    }

    // 通过 /footprints?view=tickets 查询参数可直接进入票根页；
    // 打开/关闭时同步地址，浏览器前进/后退也能切换。
    function isTicketsView() {
        return new URLSearchParams(window.location.search).get('view') === 'tickets';
    }
    // 触屏设备上自动聚焦会触发 :focus-visible 描边，让“返回地球”看起来多了一圈边框；
    // 因此只在非触屏（键盘/鼠标）环境自动回焦，触屏交给用户自然操作。
    function focusTicketGalleryControl() {
        if (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) return;
        // 刷新后直接进入票根页时还没有用户交互（userActivation），
        // 此时自动聚焦会让“返回地球”带出 :focus-visible 描边，因此跳过。
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
        if (ticketGalleryBack) ticketGalleryBack.focus();
    }
    function setTicketView(open, targetIndex, startRotation) {
        if (!ticketGallery) return;
        if (open) {
            // 票根页只属于 3D 地球：2D 下进来（直接访问、前进后退等）先切回 3D 再开
            forceGlobeForTickets();
            if (ticketViewMode !== 'archive') {
                clearTicketReplay();
                ticketViewMode = 'archive';
            }
            ticketReplayResumeIndex = -1;   // 重新打开票根页时，重走从头开始
            // 打开票根前自动收起可能开着的足迹详情卡 / 城市聚合卡
            if (markerCard && markerCard.classList.contains('visible')) hideMarkerCard();
            if (cityCard && cityCard.classList.contains('visible')) hideCityCard(false);
            if (provinceCardsActive) closeProvinceCards();
            provinceRestorePending = null;   // 进票根册是另一条浏览线，不再恢复省份卡片组
            // 卡片墙 / 城市图片墙是不透明浮层：先收起来，票根页才能透出背后的地球
            hideTicketUnderlay();
            ticketItems = ticketItemsFromFootprints();
            loadTicketPassport();
            updateTicketFeatureButtons();
            ticketGalleryEmpty.hidden = ticketItems.length > 0;
            const cities = new Set(ticketItems.map(fp => fp.city).filter(Boolean));
            const latest = ticketItems.map(fp => ticketDate(fp.ticketDate || fp.createTime)).filter(Boolean)[0] || '';
            ticketGalleryStats.textContent = ticketItems.length
                ? ticketItems.length + ' 张票根 · ' + (cities.size || '多个') + ' 个目的地' + (latest ? ' · 最近 ' + latest : '')
                : '收集每一次出发的凭证';
            ticketGallery.classList.add('show');
            setOverlayHidden(ticketGallery, false);
            document.body.classList.add('ticket-gallery-open');
            // 打开票根页时把地址同步为 ?view=tickets，便于分享/直达
            if (!isTicketsView()) history.pushState({ ticketGallery: true }, '', window.location.pathname + '?view=tickets');
            // 打开票根页：地球作为背景。从足迹卡进入时（startRotation === false）明确要求不自转；
            // 其余入口跟随用户偏好 —— 不再无条件打开，否则用户手动关掉的自转会被这个入口重新打开。
            if (startRotation === false) pauseAutoRotate('ticket-view');
            else resumeAutoRotate('ticket-view');
            if (ticketItems.length) {
                ticketIndex = targetIndex == null
                    ? 0
                    : Math.max(0, Math.min(targetIndex, ticketItems.length - 1));
                buildTicketWallet();
                renderTicketWallet();
                if (ticketStripMode) {
                    requestAnimationFrame(() => {
                        centerStripItem(ticketIndex, false);
                        positionStripArchive();
                    });
                }
                focusTicketGalleryControl();
            } else {
                resetTicketSeason();
                ticketWallet.hidden = true;
                ticketStrip.hidden = true;
                ticketStripHint.hidden = true;
                document.body.classList.remove('ticket-strip-active');
                focusTicketGalleryControl();
            }
        } else {
            // 关闭票根页时浮层会跟着关闭，这时不要再去恢复放映
            ticketReplayPausedByOverlay = false;
            resumeAutoRotate('ticket-view');   // 票根页的临时停转到此结束
            if (ticketPassport && ticketPassport.classList.contains('show')) closeTicketPassport(false);
            if (ticketOracle && ticketOracle.classList.contains('show')) closeTicketOracle(false);
            if (ticketLetter && ticketLetter.classList.contains('show')) closeTicketLetter(false);
            if (ticketViewMode !== 'archive') {
                clearTicketReplay();
                ticketViewMode = 'archive';
            }
            // 返回地球：自动旋转开着时，把重走留下的近地面视角收回整个地球
            restoreGlobeViewForAutoRotate();
            // 先把焦点移出票根容器，再标记 aria-hidden，避免无障碍警告
            if (ticketGallery.contains(document.activeElement)) {
                document.activeElement.blur();
            }
            const pendingFocus = ticketTrigger || ticketUnderlayFocus ||
                document.getElementById('ticketGalleryBtn');
            clearTicketStampTimer();
            resetTicketSeason();
            resetTicketCityFilter();   // 关掉票根页就清掉城市筛选，下次进来是全部票根
            // 把卡片墙 / 城市图片墙原样放回来（只恢复显隐，滚动位置一直是它自己的）
            restoreTicketUnderlay();
            ticketGallery.classList.remove('show');
            setOverlayHidden(ticketGallery, true);
            document.body.classList.remove('ticket-gallery-open');
            document.body.classList.remove('ticket-strip-active');
            ticketStripHint.hidden = true;
            // 关闭后还原地址，避免刷新又回到票根页
            if (isTicketsView()) history.replaceState({}, '', window.location.pathname);
            if (pendingFocus) {
                // 等导航栏恢复可见后再回焦，避免焦点落在隐藏元素上
                setTimeout(() => {
                    if (pendingFocus && pendingFocus.isConnected &&
                        getComputedStyle(pendingFocus).visibility !== 'hidden') {
                        pendingFocus.focus({ preventScroll: true });
                    }
                }, 80);
            }
        }
    }

    // 创建一张票根图片；两种展示样式共用加载/失败处理
    function createTicketImage(fp, i, className) {
        const originalUrl = ticketImageUrl(fp.ticketImage);
        // 同一张票根已成功加载过：直接复用原 img 元素，避免再次发起图片请求
        const pooled = originalUrl ? ticketImagePool.get(originalUrl) : null;
        if (pooled) {
            pooled.className = className;
            pooled.alt = fp.ticketTitle || fp.name || '';
            pooled.dataset.index = String(i);
            pooled.referrerPolicy = 'no-referrer';
            pooled.decoding = 'async';
            pooled.classList.add('is-loaded');
            pooled.classList.remove('is-error');
            return pooled;
        }

        const img = document.createElement('img');
        img.className = className;
        img.alt = fp.ticketTitle || fp.name || '';
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.dataset.index = String(i);
        let triedHttps = false;
        img.onload = () => {
            img.classList.add('is-loaded');
            if (originalUrl) ticketImagePool.set(originalUrl, img);
            if (i === ticketIndex) {
                ticketLightboxLoading.hidden = true;
                ticketLightboxError.hidden = true;
            }
            // 长串样式：图片实际尺寸就绪后再补左右留白并让当前票根保持居中
            if (ticketStripMode) {
                updateStripPadding();
                requestAnimationFrame(() => {
                    centerStripItem(ticketIndex, false);
                    positionStripArchive();
                });
            }
        };
        img.onerror = () => {
            // HTTPS 页面会拦截 HTTP 图片；同一域名通常可直接升级为 HTTPS。
            if (!triedHttps && window.location.protocol === 'https:' && /^http:\/\//i.test(originalUrl)) {
                triedHttps = true;
                img.src = originalUrl.replace(/^http:\/\//i, 'https://');
                return;
            }
            img.classList.add('is-error');
            if (i === ticketIndex) {
                ticketLightboxLoading.hidden = true;
                ticketLightboxError.hidden = false;
            }
        };
        img.src = originalUrl;
        return img;
    }

    // 按后台配置构建票夹或横向长串
    function buildTicketWallet() {
        // 保留已加载图片：下次打开时直接从 ticketImagePool 复用，不重新发请求
        walletItems = [];
        ticketGalleryHint.hidden = true;
        ticketStripProgress.hidden = true;
        ticketStripHint.hidden = true;
        document.body.classList.remove('ticket-strip-active');
        if (ticketStripMode) {
            const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
            ticketWallet.hidden = true;
            ticketStrip.hidden = false;
            ticketStripProgress.hidden = ticketItems.length < 2;
            ticketStripHint.hidden = ticketItems.length < 2;
            if (ticketItems.length) {
                document.body.classList.add('ticket-strip-active');
                // 移动端没有鼠标，改用滑动提示；桌面端隐藏顶部提示
                ticketGalleryHint.textContent = isTouch
                    ? '左右滑动切换票根'
                    : '滚动鼠标或拖动查看票根';
                ticketGalleryHint.hidden = !isTouch || ticketItems.length < 2;
            } else {
                ticketGalleryHint.hidden = true;
            }
            buildTicketStrip();
        } else {
            ticketWallet.hidden = false;
            ticketStrip.hidden = true;
            buildFanWallet();
        }
    }

    // 票夹：把每张票根叠成一层，第一张完整展示，后面的从边缘露出一条边。
    function buildFanWallet() {
        ticketWallet.innerHTML = '';
        walletItems = ticketItems.map((fp, i) => {
            const img = createTicketImage(fp, i, 'ticket-wallet-item');
            ticketWallet.appendChild(img);
            return { fp, img };
        });
        const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
        ticketGalleryHint.textContent = isTouch ? '左右滑动切换票根' : '点击票根或滚动鼠标切换';
        ticketGalleryHint.hidden = ticketItems.length < 2;
    }

    // 横向长串：所有票根排成一行，通过滚动/拖拽切换
    function buildTicketStrip() {
        ticketStripScroller.innerHTML = '';
        ticketStripScroller.scrollLeft = 0;
        walletItems = ticketItems.map((fp, i) => {
            const img = createTicketImage(fp, i, 'ticket-strip-item');
            ticketStripScroller.appendChild(img);
            return { fp, img };
        });
        updateStripPadding();
    }

    function renderTicketMeta(fp) {
        const meta = ticketMeta(fp);
        const titleText = ticketLightboxTitle.querySelector('.ticket-meta-title-text');
        if (titleText) titleText.textContent = meta.title;
        else ticketLightboxTitle.textContent = meta.title;
        ticketLightboxEnglish.textContent = fp.ticketEnglish || fp.ticketTitle || '';
        ticketLightboxEnglish.hidden = !ticketLightboxEnglish.textContent;
        if (ticketLightboxPinyin) {
            const cityPinyin = ticketPinyin(fp.cityAdcode);
            const provincePinyin = ticketPinyin(fp.provinceAdcode);
            const pinyinText = cityPinyin && provincePinyin && cityPinyin !== provincePinyin
                ? cityPinyin + ', ' + provincePinyin
                : (cityPinyin || provincePinyin || '');
            ticketLightboxPinyin.textContent = pinyinText;
            ticketLightboxPinyin.hidden = !pinyinText;
        }
        ticketLightboxSubtitle.textContent = '';
        ticketLightboxSubtitle.hidden = true;
        ticketLightboxDescription.textContent = meta.description || '风吹洱海，云落苍山，生活在别处，也在此刻。';
        ticketLightboxDescription.hidden = false;
        ticketLightboxDetails.innerHTML = [
            ['城市', meta.route, 'route', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>'],
            ['省份', meta.province, 'province', ''],
            ['日期', meta.date, 'date', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17"/></svg>'],
            ['票号', meta.no, 'no', '']
        ].filter(item => item[1]).map(item => '<div class="ticket-meta-field ticket-meta-field-' + item[2] + '">' + item[3] + '<dt>' + ticketEscape(item[0]) + '</dt><dd>' + ticketEscape(item[1]) + '</dd></div>').join('');
        ticketLightboxCount.textContent = (ticketIndex + 1) + ' / ' + ticketItems.length;
    }

    function renderTicketWallet() {
        const fp = ticketItems[ticketIndex];
        if (!fp) return;
        applyTicketSeason(fp);
        renderTicketMeta(fp);
        updateTicketStampBadge(fp, false);
        updateTicketLetterAction(fp);
        startTicketStampDwell(fp);
        if (ticketStripMode) {
            renderStripWallet();
        } else {
            renderFanWallet();
        }
        updateTicketFeatureButtons();
    }

    function renderFanWallet() {
        walletItems.forEach((item, i) => {
            const img = item.img;
            const active = i === ticketIndex;
            img.classList.toggle('is-active', active);
            img.classList.toggle('is-behind', !active);
            img.setAttribute('aria-label', (i + 1) + ' / ' + walletItems.length + ' ' + (item.fp.ticketTitle || item.fp.name || '票根'));
            if (active) {
                img.style.transform = '';
                img.style.zIndex = '10';
                img.tabIndex = -1;
                // 未加载完成且未失败时显示加载提示；加载完或失败后隐藏
                ticketLightboxLoading.hidden = img.classList.contains('is-loaded') || img.classList.contains('is-error');
                ticketLightboxError.hidden = !img.classList.contains('is-error');
            } else {
                const distance = Math.abs(i - ticketIndex);
                const k = Math.min(distance, 5);
                const dir = i < ticketIndex ? -1 : 1;
                const dx = dir * (8 + k * 4);
                // 移动端保留扇形折叠（第2张约1.7°、后续最大2.8°），配合限高不戳出顶部
                const deg = window.matchMedia('(max-width: 900px)').matches
                    ? dir * Math.min(2.8, 0.6 + k * 1.1)
                    : dir * Math.min(1.2, 0.4 + k * 0.4);
                img.style.transform = 'translate(' + dx + 'px, 0) rotate(' + deg + 'deg)';
                img.style.zIndex = String(10 - distance);
                img.tabIndex = 0;
            }
        });
    }

    function renderStripWallet() {
        walletItems.forEach((item, i) => {
            const img = item.img;
            const active = i === ticketIndex;
            img.classList.toggle('is-active', active);
            img.setAttribute('aria-label', (i + 1) + ' / ' + walletItems.length + ' ' + (item.fp.ticketTitle || item.fp.name || '票根'));
            img.tabIndex = active ? -1 : 0;
        });
        const current = walletItems[ticketIndex] && walletItems[ticketIndex].img;
        ticketLightboxLoading.hidden = !current || current.classList.contains('is-loaded') || current.classList.contains('is-error');
        ticketLightboxError.hidden = !current || !current.classList.contains('is-error');
        renderStripProgress();
    }

    // 字幕下方的极简指示线：亮点在线上随当前票根位置移动，其余部分保持低透明度
    function renderStripProgress() {
        if (!ticketStripMode || !ticketStripProgress) return;
        const rail = ticketStripProgress.querySelector('.ticket-progress-rail');
        if (!rail) return;
        const total = ticketItems.length;
        rail.innerHTML = '';
        for (let i = 0; i < total; i++) {
            const segment = document.createElement('button');
            segment.type = 'button';
            segment.className = 'ticket-progress-segment' + (i === ticketIndex ? ' is-current' : '');
            segment.dataset.index = String(i);
            segment.setAttribute('aria-label', '查看第 ' + (i + 1) + ' 张票根');
            segment.setAttribute('aria-current', i === ticketIndex ? 'true' : 'false');
            rail.appendChild(segment);
        }
    }

    function openTicketLightbox(index, trigger) {
        ticketItems = ticketItemsFromFootprints();
        ticketIndex = Math.max(0, Math.min(index, ticketItems.length - 1));
        ticketTrigger = trigger || null;
        buildTicketWallet();
        renderTicketWallet();
        if (ticketStripMode) {
            requestAnimationFrame(() => {
                centerStripItem(ticketIndex, false);
                positionStripArchive();
            });
        }
        focusTicketGalleryControl();
    }

    function closeTicketLightbox(returnFocus = true) {
        if (!ticketLightbox) return;
        // 保留已加载图片供下次复用，避免每次打开票根都重新请求
        walletItems = [];
        setTicketView(false);
        if (returnFocus && ticketTrigger) ticketTrigger.focus();
        ticketTrigger = null;
    }

    function switchTicket(delta) {
        if (ticketItems.length < 2) return;
        ticketIndex = (ticketIndex + delta + ticketItems.length) % ticketItems.length;
        renderTicketWallet();
        if (ticketStripMode) centerStripItem(ticketIndex, true);
    }

    // ================= 横向长串：定位 / 吸附 / 拖拽 =================
    function stripViewportCenter() {
        const rect = ticketStripScroller.getBoundingClientRect();
        return rect.left + ticketStripScroller.clientWidth / 2;
    }

    function stripItemCenter(el) {
        const rect = el.getBoundingClientRect();
        return rect.left + rect.width / 2;
    }

    // 给首尾两张留出“能滚到居中”的左右留白：
    // 视口过宽时若不补白，中间票根的左右邻图永远无法滚到正中央，吸附会弹回中间。
    function updateStripPadding() {
        if (!ticketStripScroller.clientWidth || !ticketStripScroller.firstElementChild) return;
        const itemWidth = ticketStripScroller.firstElementChild.offsetWidth;
        if (!itemWidth) return;
        const pad = Math.max(0, Math.floor((ticketStripScroller.clientWidth - itemWidth) / 2));
        ticketStripScroller.style.paddingLeft = pad + 'px';
        ticketStripScroller.style.paddingRight = pad + 'px';
    }

    function nearestStripIndex() {
        const viewportCenter = stripViewportCenter();
        let best = 0;
        let bestDist = Infinity;
        walletItems.forEach((item, i) => {
            const el = item.img;
            if (!el || !el.offsetWidth) return;
            const dist = Math.abs(stripItemCenter(el) - viewportCenter);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        });
        return best;
    }

    function centerStripItem(index, smooth) {
        const item = walletItems[index];
        if (!item || !item.img || !ticketStripScroller.clientWidth) return;
        const el = item.img;
        const delta = stripItemCenter(el) - stripViewportCenter();
        const target = Math.max(0, ticketStripScroller.scrollLeft + delta);
        ticketStripScroller.scrollTo({
            left: target,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    function snapStrip() {
        if (!ticketStripMode || ticketItems.length < 2) return;
        const idx = nearestStripIndex();
        if (idx === ticketIndex) return;
        // 只在真正切换到另一张票根时，把新票根平滑吸附到视口正中央
        ticketIndex = idx;
        renderTicketWallet();
        centerStripItem(idx, true);
    }

    // 方案 1：票据档案页垫在当前票根下，只从票根下缘露出一截
    let stripArchiveRaf = null;
    function positionStripArchive() {
        if (!ticketStripMode || !ticketGallery.classList.contains('show')) return;
        // 字幕式元信息使用正常文档流，始终排在当前票根下方。
        ticketMetaPanel.style.position = '';
        ticketMetaPanel.style.left = '';
        ticketMetaPanel.style.top = '';
        ticketMetaPanel.style.zIndex = '';
        ticketStripScroller.style.marginBottom = '';
        ticketStripScroller.style.zIndex = '';
    }

    function reloadTicket(index) {
        const item = walletItems[index];
        if (!item) return;
        const img = item.img;
        img.classList.remove('is-loaded', 'is-error');
        if (index === ticketIndex) {
            ticketLightboxLoading.hidden = false;
            ticketLightboxError.hidden = true;
        }
        img.src = ticketImageUrl(item.fp.ticketImage);
    }

    ticketGalleryBtn.addEventListener('click', () => setTicketView(true));
    ticketGalleryBack.addEventListener('click', () => setTicketView(false));
    ticketModeArchiveBtn.addEventListener('click', () => setTicketViewMode('archive'));
    ticketModeReplayBtn.addEventListener('click', () => setTicketViewMode('replay'));
    ticketReplayPrev.addEventListener('click', () => stepTicketReplay(-1));
    ticketReplayNext.addEventListener('click', () => stepTicketReplay(1));
    // 票根本体：点一下停下并放大，再点收起；键盘 Enter / 空格同样可用
    ticketReplayCard.addEventListener('click', toggleTicketReplayZoom);
    ticketReplayCard.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
            ev.preventDefault();
            toggleTicketReplayZoom();
        }
    });
    ticketReplaySpeed.addEventListener('click', toggleTicketReplaySpeed);
    ticketReplayOpen.addEventListener('click', openReplayTicketInArchive);
    // 清除城市筛选：回到全部票根
    ticketCityFilterChip.addEventListener('click', () => {
        resetTicketCityFilter();
        ticketItems = ticketItemsFromFootprints();
        ticketIndex = 0;
        buildTicketWallet();
        renderTicketWallet();
        updateTicketFeatureButtons();
    });
    ticketReplayPlay.addEventListener('click', () => {
        if (ticketReplayPlaying) pauseTicketReplay();
        else resumeTicketReplay();
    });
    ticketReplayExit.addEventListener('click', () => setTicketViewMode('archive'));
    ticketReplayAgain.addEventListener('click', () => startTicketReplay());
    ticketReplayCloseEnd.addEventListener('click', () => setTicketViewMode('archive'));
    ticketPassportBtn.addEventListener('click', openTicketPassport);
    ticketPassportBack.addEventListener('click', () => closeTicketPassport());
    ticketOracleBtn.addEventListener('click', openTicketOracle);
    ticketOracleBack.addEventListener('click', () => closeTicketOracle());
    ticketOracleAgain.addEventListener('click', ticketOracleShuffle);
    ticketOracleClose.addEventListener('click', () => closeTicketOracle());
    ticketOracleView.addEventListener('click', openOracleTicketInArchive);
    ticketLetterBtn.addEventListener('click', () => {
        const fp = ticketItems[ticketIndex];
        if (fp) openTicketLetter(fp);
    });
    ticketLetterBack.addEventListener('click', () => closeTicketLetter());
    ticketLetterDownload.addEventListener('click', downloadTicketLetter);
    ticketLetterShare.addEventListener('click', shareTicketLetter);
    ticketLetterRetry.addEventListener('click', () => { renderTicketLetter(); });
    ticketPassportReset.addEventListener('click', () => {
        if (!window.confirm('确定清除这台设备上的全部集章记录吗？')) return;
        ticketPassportRecords = [];
        persistTicketPassport();
        if (ticketPassport.classList.contains('show')) renderTicketPassport();
        updateTicketPassportButton();
        updateTicketStampBadge(ticketItems[ticketIndex], false);
    });
    [ticketPassport, ticketOracle, ticketLetter].forEach(overlay => {
        if (!overlay) return;
        overlay.addEventListener('click', event => {
            if (event.target !== overlay) return;
            if (overlay === ticketPassport) closeTicketPassport();
            else if (overlay === ticketOracle) closeTicketOracle();
            else closeTicketLetter();
        });
    });
    ticketLightboxRetry.addEventListener('click', () => reloadTicket(ticketIndex));
    ticketStripProgress.querySelector('.ticket-progress-rail').addEventListener('click', event => {
        const segment = event.target.closest('.ticket-progress-segment');
        if (!segment) return;
        const index = Number(segment.dataset.index);
        if (Number.isInteger(index)) {
            ticketIndex = index;
            renderTicketWallet();
            centerStripItem(ticketIndex, true);
        }
    });
    // 点露出的边缘 → 翻到前面；点当前票根 → 转到下一张
    ticketWallet.addEventListener('click', event => {
        if (walletSwiped) {
            walletSwiped = false;
            return;
        }
        const img = event.target.closest('.ticket-wallet-item');
        if (!img) return;
        const index = Number(img.dataset.index);
        if (index === ticketIndex) {
            switchTicket(1);
        } else {
            ticketIndex = index;
            renderTicketWallet();
        }
    });
    // 鼠标滚轮切换
    ticketWallet.addEventListener('wheel', event => {
        if (ticketItems.length < 2 || wheelLocked) return;
        event.preventDefault();
        wheelLocked = true;
        switchTicket(event.deltaY > 0 ? 1 : -1);
        setTimeout(() => { wheelLocked = false; }, 320);
    }, { passive: false });
    // 触摸滑动切换（只在票根区域上滑动时切换，信息区滑动不切换）
    ticketWallet.addEventListener('touchstart', event => {
        walletTouchX = event.touches[0].clientX;
    }, { passive: true });
    ticketWallet.addEventListener('touchend', event => {
        if (walletTouchX === null) return;
        const dx = event.changedTouches[0].clientX - walletTouchX;
        walletTouchX = null;
        if (Math.abs(dx) > 40) {
            walletSwiped = true;
            switchTicket(dx < 0 ? 1 : -1);
            setTimeout(() => { walletSwiped = false; }, 400);
        }
    }, { passive: true });

    // 横向长串：鼠标滚轮（纵向滚动映射为横向）、拖拽滑动、停稳后吸附居中
    ticketStripScroller.addEventListener('wheel', event => {
        if (!ticketStripMode || ticketItems.length < 2) return;
        event.preventDefault();
        const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        ticketStripScroller.scrollLeft += delta;
        clearTimeout(stripScrollTimer);
        stripScrollTimer = setTimeout(snapStrip, 160);
    }, { passive: false });

    ticketStripScroller.addEventListener('pointerdown', event => {
        if (!ticketStripMode || ticketItems.length < 2) return;
        // 触屏交给浏览器原生滚动 + scroll-snap，手感更顺滑；手动拖拽只用于鼠标
        if (event.pointerType !== 'mouse') return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        stripDrag = {
            id: event.pointerId,
            startX: event.clientX,
            startLeft: ticketStripScroller.scrollLeft,
            moved: false
        };
        ticketStripScroller.classList.add('dragging');
        try {
            ticketStripScroller.setPointerCapture(event.pointerId);
        } catch (e) {
            /* 忽略捕获失败 */
        }
    });
    ticketStripScroller.addEventListener('pointermove', event => {
        if (!stripDrag || stripDrag.id !== event.pointerId) return;
        const dx = event.clientX - stripDrag.startX;
        if (Math.abs(dx) > 5) stripDrag.moved = true;
        ticketStripScroller.scrollLeft = stripDrag.startLeft - dx;
    });
    function endStripDrag(event) {
        if (!stripDrag || stripDrag.id !== event.pointerId) return;
        const wasMoved = stripDrag.moved;
        stripDrag = null;
        ticketStripScroller.classList.remove('dragging');
        if (wasMoved) snapStrip();
    }
    ticketStripScroller.addEventListener('pointerup', endStripDrag);
    ticketStripScroller.addEventListener('pointercancel', endStripDrag);
    // 横条滚动时让档案页跟随当前主票根移动
    ticketStripScroller.addEventListener('scroll', () => {
        if (!ticketStripMode || !ticketGallery.classList.contains('show')) return;
        clearTimeout(stripScrollTimer);
        stripScrollTimer = setTimeout(snapStrip, 180);
        if (stripArchiveRaf) return;
        stripArchiveRaf = requestAnimationFrame(() => {
            stripArchiveRaf = null;
            positionStripArchive();
        });
    }, { passive: true });
    window.addEventListener('resize', () => {
        if (!ticketStripMode || !ticketGallery.classList.contains('show') || ticketItems.length < 2) return;
        updateStripPadding();
        requestAnimationFrame(() => {
            centerStripItem(ticketIndex, false);
            positionStripArchive();
        });
    });

    // 票根页背景点击：票夹里点空白 = 返回地球（原有设计）。
    // 重走时不能沿用：重走层是 pointer-events: none 的点击穿透层，点空白会打到这里，
    // 于是"点一下地球"就误退到地球并丢掉正在放的那一段。
    ticketLightbox.addEventListener('click', event => {
        if (event.target !== ticketLightbox) return;
        if (ticketViewMode === 'replay') {
            // 重走里点空白：只在放大状态下收回票根，其它什么都不做
            if (ticketReplayView && ticketReplayView.classList.contains('is-focused')) {
                ticketReplaySetZoom(false);
            }
            return;
        }
        closeTicketLightbox();
    });
    document.addEventListener('keydown', event => {
        if (ticketOracle && ticketOracle.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketOracle();
            return;
        }
        if (ticketLetter && ticketLetter.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketLetter();
            return;
        }
        if (ticketPassport && ticketPassport.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketPassport();
            return;
        }
        if (ticketGallery.classList.contains('show') && ticketViewMode === 'replay') {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                stepTicketReplay(event.key === 'ArrowRight' ? 1 : -1);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                // 分层关闭：先收回放大的票根，再退出重走
                if (ticketReplayView && ticketReplayView.classList.contains('is-focused')) {
                    ticketReplaySetZoom(false);
                    return;
                }
                setTicketViewMode('archive');
                return;
            }
        }
        if (ticketLightbox.classList.contains('show')) {
            if (event.key === 'ArrowLeft') { event.preventDefault(); switchTicket(-1); }
            if (event.key === 'ArrowRight') { event.preventDefault(); switchTicket(1); }
            if (event.key === 'Escape') { event.preventDefault(); closeTicketLightbox(); }
            return;
        }
        if (ticketGallery.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            setTicketView(false);
        }
    });
    // 页面切到后台时停止放映：后台标签页会节流定时器，回来容易一次跳好几站
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden || ticketViewMode !== 'replay') return;
        if (!ticketGallery.classList.contains('show')) return;
        pauseTicketReplay();
    });
    document.addEventListener('footprints:loaded', () => {
        if (ticketGallery.classList.contains('show')) {
            ticketItems = ticketItemsFromFootprints();
            ticketIndex = 0;
            buildTicketWallet();
            renderTicketWallet();
            if (ticketStripMode) {
                requestAnimationFrame(() => {
                    centerStripItem(ticketIndex, false);
                    positionStripArchive();
                });
            }
        }
    });
    // 浏览器前进/后退：按 ?view=tickets 参数在票根页与地球页之间切换
    window.addEventListener('popstate', () => {
        setTicketView(isTicketsView());
    });
    // 直接访问 /footprints?view=tickets 时打开票根页（数据就绪后再打开，避免空状态闪烁）
    if (isTicketsView()) {
        document.addEventListener('footprints:loaded', () => {
            if (!ticketGallery.classList.contains('show')) setTicketView(true);
        }, { once: true });
    }

    const chinaDataSource = Cesium.GeoJsonDataSource.load(
        '/plugins/footprint/assets/static/data/china-full.json',
        {
            fill: Cesium.Color.PALETURQUOISE.withAlpha(0) // 填充颜色（设为透明）
        }
    );

    chinaDataSource.then(dataSource => {
        chinaBoundarySource = dataSource;
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
        provinceEntityMap = new Map();
        provinceMaterialSnapshot = new Map();
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
        viewer.dataSources.add(dataSource);
    }).catch(error => {
        console.error('加载中国轮廓数据失败:', error);
    });

    // 初始构建城市淡色填充（足迹数据加载完成后会重建）
    if (cityFillEnabled) buildCityFills();

    // ================= 省份城市卡片（点击省份 → 每个有足迹的城市各一张小卡片 + 抛物线） =================
    // 设计要点：
    // - 省份面的填充是 alpha=0（Cesium 的拾取通道会直接丢弃这类片元），命中判定只能走几何计算；
    // - 每个有足迹的城市各出一张卡 + 一条线，卡片按各自标记的屏幕位置分左右两侧、错开排布；
    // - 相机完全不动；线画在屏幕空间的 SVG 上，随地球转动与卡片拖动实时跟随；
    // - 拖拽过的不再参与自动排版，再点一次该省份时重新排版。

    function provinceElements() {
        if (!provinceEls) {
            provinceEls = {
                svg: document.getElementById('leaderOverlay'),
                label: document.getElementById('provinceLabel'),
                layer: document.getElementById('provinceCardLayer')
            };
        }
        return provinceEls;
    }

    function provinceCardsEnabled() {
        return window.innerWidth >= PROVINCE_CARD_MIN_WIDTH;
    }

    // 卡片列到左右边缘的留白：不贴着屏幕边，宽屏再多让一点
    function provinceSideInset() {
        return Math.max(PROVINCE_SIDE_INSET_MIN, Math.round(window.innerWidth * PROVINCE_SIDE_INSET_RATIO));
    }

    // 展开城市卡片的前置条件：桌面端 + 3D 场景 + 城市聚合态（这一层才有城市标记可连）
    function cityCardsEnabled() {
        if (!provinceCardsEnabled()) return false;
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return false;
        return cityMode;
    }

    // 省份可点还多一条：中国轮廓已经显示（放大到国内范围）
    function provincePickingEnabled() {
        return cityCardsEnabled() && boundaryVisible;
    }

    // ---------- 省份边界索引（几何判定用） ----------
    function loadProvinceIndex() {
        if (!provinceIndexPromise) {
            provinceIndexPromise = fetch(PROVINCE_GEOJSON_URL, { referrerPolicy: 'no-referrer' })
                .then(res => {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(geojson => {
                    provinceIndex = buildProvinceIndex(geojson);
                    return provinceIndex;
                })
                .catch(e => {
                    provinceIndexPromise = null;   // 失败允许下次重试
                    console.warn('省份边界索引导入失败：', e);
                    return null;
                });
        }
        return provinceIndexPromise;
    }

    function buildProvinceIndex(geojson) {
        const index = new Map();
        const features = (geojson && geojson.features) || [];
        features.forEach(feature => {
            const props = (feature && feature.properties) || {};
            const adcode = String(props.adcode || '').trim();
            const geometry = feature && feature.geometry;
            // 只收省级编码（6 位纯数字）；南海诸岛那个空名分区（100000_JD）直接排除
            if (!geometry || !/^\d{6}$/.test(adcode)) return;
            const polygons = ringSetsOfGeometry(geometry);
            if (!polygons.length) return;
            index.set(adcode, {
                adcode: adcode,
                name: String(props.name || ''),
                center: Array.isArray(props.center) ? props.center : null,
                bbox: bboxOfPolygons(polygons),
                polygons: polygons
            });
        });
        return index;
    }

    // Polygon / MultiPolygon → [{ outer, holes }]，坐标摊平成 [lng, lat, ...] 的 Float64Array
    function ringSetsOfGeometry(geometry) {
        const type = geometry.type;
        const coords = geometry.coordinates || [];
        const polygons = type === 'Polygon' ? [coords] : (type === 'MultiPolygon' ? coords : []);
        const out = [];
        polygons.forEach(rings => {
            if (!Array.isArray(rings) || !rings.length) return;
            const outer = flattenRing(rings[0]);
            if (!outer || outer.length < 6) return;
            const holes = [];
            for (let i = 1; i < rings.length; i++) {
                const hole = flattenRing(rings[i]);
                if (hole && hole.length >= 6) holes.push(hole);
            }
            out.push({ outer: outer, holes: holes });
        });
        return out;
    }

    function flattenRing(ring) {
        if (!Array.isArray(ring) || !ring.length) return null;
        const flat = new Float64Array(ring.length * 2);
        for (let i = 0; i < ring.length; i++) {
            const point = ring[i];
            if (!Array.isArray(point)) return null;
            flat[i * 2] = Number(point[0]);
            flat[i * 2 + 1] = Number(point[1]);
        }
        return flat;
    }

    function bboxOfPolygons(polygons) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        polygons.forEach(set => {
            const ring = set.outer;
            for (let i = 0; i < ring.length; i += 2) {
                const lng = ring[i];
                const lat = ring[i + 1];
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            }
        });
        return [minLng, minLat, maxLng, maxLat];
    }

    // 射线法：环是闭合折线，首尾点重复与否都不影响结果
    function pointInRing(lng, lat, ring) {
        let inside = false;
        const count = ring.length / 2;
        for (let i = 0, j = count - 1; i < count; j = i++) {
            const xi = ring[i * 2], yi = ring[i * 2 + 1];
            const xj = ring[j * 2], yj = ring[j * 2 + 1];
            if ((yi > lat) !== (yj > lat) &&
                lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    function pointInProvince(lng, lat) {
        if (!provinceIndex) return null;
        for (const info of provinceIndex.values()) {
            const b = info.bbox;
            if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
            for (let i = 0; i < info.polygons.length; i++) {
                const set = info.polygons[i];
                if (!pointInRing(lng, lat, set.outer)) continue;
                let inHole = false;
                for (let h = 0; h < set.holes.length; h++) {
                    if (pointInRing(lng, lat, set.holes[h])) { inHole = true; break; }
                }
                if (!inHole) return info;
            }
        }
        return null;
    }

    function provinceAdcodeOfEntity(entity) {
        const props = entity && entity.properties;
        if (!props) return '';
        const raw = props.adcode;
        if (!raw) return '';
        const value = typeof raw.getValue === 'function' ? raw.getValue(Cesium.JulianDate.now()) : raw;
        return value ? String(value) : '';
    }

    // 省级编码直接命中；城市级编码（城市高亮图层的面）按前两位反推省级编码
    function provinceInfoByAdcode(adcode, allowCity) {
        if (!provinceIndex || !adcode) return null;
        const direct = provinceIndex.get(String(adcode));
        if (direct) return direct;
        if (allowCity && /^\d{6}$/.test(String(adcode))) {
            return provinceIndex.get(String(adcode).slice(0, 2) + '0000') || null;
        }
        return null;
    }

    function provinceAtScreenPoint(point) {
        // 1) 省界描边（alpha=1 的折线）与城市高亮的面都能被 scene.pick 命中，命中就直接给答案
        const picked = viewer.scene.pick(point);
        if (picked && picked.id) {
            const hit = provinceInfoByAdcode(provinceAdcodeOfEntity(picked.id), true);
            if (hit) return hit;
        }
        // 2) 省面本体（alpha=0）拾取不到，退回几何判定：屏幕坐标 → 椭球交点 → 经纬度
        const cartesian = viewer.camera.pickEllipsoid(point, viewer.scene.globe.ellipsoid);
        if (!cartesian) return null;
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        return pointInProvince(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude));
    }

    let provinceHoverCheckedAt = 0;
    let provinceHoverCached = false;
    function provinceHoverAt(point) {
        const now = performance.now();
        if (now - provinceHoverCheckedAt < 100) return provinceHoverCached;   // 节流到约 10 次/秒
        provinceHoverCheckedAt = now;
        provinceHoverCached = false;
        if (!provincePickingEnabled()) return false;
        provinceHoverCached = !!provinceAtScreenPoint(point);
        return provinceHoverCached;
    }

    // ---------- 省份 → 城市 ----------
    function normalizeProvinceName(value) {
        return String(value || '')
            .replace(/\s/g, '')
            .replace(/(省|市)$/, '')
            .replace(/特别行政区$/, '')
            .replace(/自治区$/, '')
            .replace(/(维吾尔|壮族|回族|藏族)$/, '');
    }

    // 优先 adcode 精确匹配；老数据缺 adcode 时才退回省名归一化匹配
    function provinceCitiesOf(adcode, name) {
        const exact = [];
        const byName = [];
        const targetName = normalizeProvinceName(name);
        cityList.forEach((city, ci) => {
            const fp = FOOTPRINTS[city.indices[0]];
            if (!fp) return;
            if (fp.provinceAdcode) {
                if (String(fp.provinceAdcode) === String(adcode)) exact.push(ci);
                return;
            }
            if (targetName && normalizeProvinceName(fp.province) === targetName) byName.push(ci);
        });
        return exact.length ? exact : byName;
    }

    // 选中省份时要保亮的标记实体（城市聚合标记 + 这些城市的足迹标记）
    function collectProvinceBrightEntities(cities) {
        const set = new Set();
        cities.forEach(ci => {
            const marker = cityMarkerEntities[ci];
            if (marker) set.add(marker);
            const city = cityList[ci];
            if (!city) return;
            city.indices.forEach(fi => {
                const ent = markerEntities[fi];
                if (ent) set.add(ent);
            });
        });
        return set;
    }

    // ---------- 省份高亮（材质改写 + 记录原值还原） ----------
    function applyProvinceHighlight(adcode) {
        const next = adcode ? String(adcode) : '';
        if (next === provinceHighlightAdcode) return;
        if (provinceMaterialSnapshot) {
            provinceMaterialSnapshot.forEach((saved, entity) => {
                if (entity.polygon && saved.fill) entity.polygon.material = saved.fill;
                if (entity.polyline && saved.stroke) entity.polyline.material = saved.stroke;
                if (entity.polyline && saved.width) entity.polyline.width = saved.width;
            });
        }
        provinceHighlightAdcode = next;
        if (!next || !provinceEntityMap) return;
        const entities = provinceEntityMap.get(next);
        if (!entities || !entities.length) return;
        // 每个实体单独赋新材质：所有实体最初共享同一个材质实例，改实例等于全省份一起变
        const fill = Cesium.Color.fromCssColorString(PROVINCE_HL_FILL);
        const stroke = Cesium.Color.fromCssColorString(PROVINCE_HL_STROKE);
        entities.forEach(entity => {
            if (entity.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(fill);
            if (entity.polyline) {
                entity.polyline.material = new Cesium.ColorMaterialProperty(stroke);
                entity.polyline.width = PROVINCE_HL_STROKE_WIDTH;
            }
        });
    }

    // ---------- 打开 / 关闭 ----------
    // 点击入口：再点同一个省 = 重新排版（把拖拽过的卡片放回自动布局），收起交给点空白 / Esc
    function openProvinceCards(adcode) {
        if (provinceCardsActive && provinceCardsAdcode === String(adcode) && provinceCardsMode === 'province') {
            relayoutProvinceCards();
            return true;
        }
        return activateProvinceCards(adcode);
    }

    function activateProvinceCards(adcode) {
        if (!provinceCardsEnabled()) return false;
        if (!provinceIndex) {
            loadProvinceIndex().then(() => { provinceLayoutDirty = true; });
            return false;
        }
        const info = provinceInfoByAdcode(adcode, false) || provinceIndex.get(String(adcode));
        if (!info) return false;
        const cities = provinceCitiesOf(info.adcode, info.name);
        if (!cities.length) return false;   // 无足迹的省份：什么都不做（也不关闭已打开的卡片）
        return activateCityCards({
            mode: 'province',
            adcode: info.adcode,
            cities: cities,
            labelText: info.name + ' · ' + cities.length + ' 座城市',
            labelWorld: provinceLabelWorldFromInfo(info)
        });
    }

    // 通用入口：一次性展开一组城市的卡片与连线。
    // 省份点击、导航栏「全部城市」都走这里，未来别的入口也复用同一套布局 / 避让 / 连线。
    function activateCityCards(config) {
        if (!provinceCardsEnabled()) return false;
        const cities = (config && config.cities) || [];
        if (!cities.length) return false;

        hidePhotoRing();                    // 省份卡片组与照片环互斥
        closeProvinceCards();               // 换组前先清掉上一组（含高亮与卡片）
        // 关键：新的一组立刻接管这一层。上面的 closeProvinceCards() 会排一个
        // "退场动画结束后清空 DOM" 的定时器，世代号不自增的话，它 320ms 后会把
        // 刚画好的新卡片一起清掉（表现为"点另一个省：卡片闪一下就没了，之后再也点不出来"）。
        provinceCardsToken++;
        provinceRestorePending = null;
        // 省份卡片组与详情卡互斥
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        if (cityCard && cityCard.classList.contains('visible')) hideCityCard(false);

        provinceCardsActive = true;
        provinceCardsMode = config.mode || 'province';
        provinceCardsAdcode = config.adcode || '';
        provinceCitiesSet = new Set(cities);
        provinceBrightEntities = collectProvinceBrightEntities(cities);
        provinceLabelText = config.labelText || '';
        provinceLabelWorld = config.labelWorld || null;

        buildProvinceCardDom(cities);
        if (config.adcode) applyProvinceHighlight(config.adcode);
        refreshMarkerColors();
        pauseAutoRotate('province-cards');
        document.body.classList.add('card-open');
        measureProvinceCards();
        provinceLayoutDirty = true;
        layoutProvinceCards();                       // 先算出落点，卡片此刻还不可见
        // 打开的同时把卡片层暴露给读屏（层里是 role=button 的卡片）
        const layerEl = provinceElements().layer;
        if (layerEl) {
            layerEl.setAttribute('aria-label', provinceLabelText || '城市卡片');
            layerEl.setAttribute('aria-hidden', 'false');
        }
        hideProvinceHint();                          // 用户已经会点了，提示可以退场
        const entranceMs = planProvinceEntrance(provinceCardsItems);
        provinceEntranceUntil = reduceMotion ? 0 : performance.now() + entranceMs;
        startProvinceCardsFly(provinceCardsItems);   // A：卡片从自己的标记飞出来
        startProvinceLinesGrow();                    // B：线与卡片共用同一套错峰
        startProvinceMarkerPulse(provinceCardsItems); // C：起点脉冲（仅「全部城市」）
        startProvinceCoverLoads(provinceCardsItems); // 封面按入场顺序排队（并发限流）
        syncProvinceAllBtn();
        return true;
    }

    // 封面加载跟着展开顺序走：先飞出来的卡片先排队，避免 16 张卡同时开火抢带宽。
    function startProvinceCoverLoads(items) {
        items
            .slice()
            .sort((a, b) => (a.cardDelay || 0) - (b.cardDelay || 0))
            .forEach(item => enqueueCardCover(item.coverRequest));
    }

    // ---------- 展开动画 ----------
    // 错峰顺序：单省按"到城市群中心的距离"由内向外推开；全部城市按经度西→东扫过去。
    // 卡片多时自动压缩步长，总错峰不超过 PROVINCE_STAGGER_MAX_MS。
    function planProvinceEntrance(items) {
        if (!items.length) return 0;
        const step = items.length > 1
            ? Math.min(PROVINCE_STAGGER_STEP_MS, PROVINCE_STAGGER_MAX_MS / (items.length - 1))
            : 0;
        let centerX = 0;
        let centerY = 0;
        let counted = 0;
        items.forEach(item => {
            if (!item.anchor) return;
            centerX += item.anchor.x;
            centerY += item.anchor.y;
            counted++;
        });
        if (counted) {
            centerX /= counted;
            centerY /= counted;
        }
        const allMode = provinceCardsMode === 'all';
        const ordered = items.slice().sort((a, b) => provinceEntranceKey(a, centerX, centerY, allMode) -
            provinceEntranceKey(b, centerX, centerY, allMode));
        ordered.forEach((item, index) => {
            item.staggerDelay = index * step;
            item.lineDelay = item.staggerDelay;
            item.cardDelay = item.staggerDelay + PROVINCE_CARD_LEAD_MS;
        });
        let total = 0;
        items.forEach(item => {
            total = Math.max(total,
                (item.lineDelay || 0) + PROVINCE_LINE_GROW_MS,
                (item.cardDelay || 0) + PROVINCE_CARD_FLY_MS);
        });
        return total + 120;
    }

    function provinceEntranceKey(item, centerX, centerY, allMode) {
        if (allMode) {
            // 西→东：像一道波从西边扫到东边，正好对上"全国铺开"的语义
            const center = cityList[item.ci] ? cityCenter(cityList[item.ci]) : null;
            return center && Number.isFinite(center.lng) ? center.lng : 0;
        }
        // 单省：由内向外推开，同一条边上的卡片按离标记群中心的远近依次出现
        if (!item.anchor) return Number.MAX_VALUE;
        return Math.hypot(item.anchor.x - centerX, item.anchor.y - centerY);
    }

    // 卡片入场：从自己那个城市标记的位置（略缩小）滑到布局算出的落点。
    // 先把"起点态"钉在样式上再切终点态，否则浏览器会把两帧合并、变成原地淡入。
    function startProvinceCardsFly(items) {
        const els = provinceElements();
        const flying = [];
        items.forEach(item => {
            const el = item.el;
            if (!el) return;
            el.classList.remove('is-flying');
            el.style.transitionDelay = '';
            if (reduceMotion || !item.anchor) {
                // 减弱动效、或卡片对应的标记在背面：直接落到最终位置（背面那批由 is-hidden 负责隐藏）
                el.style.transform = 'translate3d(' + Math.round(item.x) + 'px,' + Math.round(item.y) + 'px,0)';
                el.style.opacity = '';
                el.classList.add('show');
                return;
            }
            el.style.transition = 'none';
            el.style.transform = 'translate3d(' + snapDevicePx(item.anchor.x) + 'px,' +
                snapDevicePx(item.anchor.y) + 'px,0) scale(0.82)';
            el.style.opacity = '0';
            flying.push(item);
        });
        if (!flying.length) return;
        void (els.layer && els.layer.offsetWidth);   // 落一次样式计算，把起点态钉住
        flying.forEach(item => {
            const el = item.el;
            el.classList.add('is-flying');
            el.style.transition = '';
            el.style.transitionDelay = Math.round(item.cardDelay || 0) + 'ms';
            el.style.transform = 'translate3d(' + snapDevicePx(item.x) + 'px,' +
                snapDevicePx(item.y) + 'px,0)';
            el.style.opacity = '';
            el.classList.add('show');
        });
        // 飞完就摘掉过渡与延迟：之后相机转动带来的重排、拖拽都要立刻跟手
        let totalMs = 0;
        flying.forEach(item => {
            totalMs = Math.max(totalMs, (item.cardDelay || 0) + PROVINCE_CARD_FLY_MS);
        });
        window.setTimeout(() => {
            flying.forEach(item => {
                if (!item.el) return;
                item.el.style.transitionDelay = '';
                item.el.classList.remove('is-flying');
            });
        }, totalMs + 80);
    }

    // 起点"引爆"：标记在一个短脉冲里鼓一下，再回到基准尺寸。
    // 只在「全部城市」模式做 —— 省份模式下标记已经因为省份高亮而全亮，再动容易和悬停强调混淆。
    function startProvinceMarkerPulse(items) {
        if (reduceMotion || provinceCardsMode !== 'all') return;
        const targets = items.filter(item => item.anchor && cityMarkerEntities[item.ci]);
        if (!targets.length) return;
        const startedAt = performance.now();
        let finishAt = 0;
        targets.forEach(item => {
            finishAt = Math.max(finishAt, (item.lineDelay || 0) + PROVINCE_PULSE_MS);
        });
        const tick = (now) => {
            if (!provinceCardsActive) {
                provincePulseRaf = null;
                return;
            }
            const elapsed = now - startedAt;
            let pending = false;
            targets.forEach(item => {
                const ent = cityMarkerEntities[item.ci];
                if (!ent || !ent.billboard) return;
                if (focusedMarker === ent) return;   // 正在被悬停聚焦的标记交给 hover 逻辑
                const local = elapsed - (item.lineDelay || 0);
                if (local >= PROVINCE_PULSE_MS) {
                    if (ent.billboard.scale !== 1) ent.billboard.scale = 1;
                    return;
                }
                pending = true;
                if (local < 0) return;
                const k = local / PROVINCE_PULSE_MS;
                ent.billboard.scale = 1 + 0.26 * Math.sin(Math.PI * k);
            });
            if (pending && elapsed < finishAt + 400) {
                provincePulseRaf = requestAnimationFrame(tick);
            } else {
                provincePulseRaf = null;
            }
        };
        if (provincePulseRaf) cancelAnimationFrame(provincePulseRaf);
        provincePulseRaf = requestAnimationFrame(tick);
    }

    // 一键展开：所有去过的城市各一张卡片 + 一条连线
    function activateAllCityCards() {
        if (!cityCardsEnabled()) return false;
        const cities = cityList.map((city, ci) => ci);
        if (!cities.length) return false;
        const open = () => activateCityCards({
            mode: 'all',
            adcode: '',
            cities: cities,
            labelText: '全部城市 · ' + cities.length + ' 座',
            labelWorld: allCitiesLabelWorld()
        });
        // 相机还没放大到能看见中国轮廓（或者整球视图下城市挤成一团）时，
        // 先自动飞到"能看见轮廓、城市也散得开"的层级，落地后再展开卡片。
        if (!boundaryVisible) {
            provinceAllFlight = true;
            syncProvinceAllBtn();
            flyToChinaForCityCards(open);
            return true;
        }
        return open();
    }

    // 自动缩放：终点取一个"轮廓可见 + 城市聚合态"的高度（9.5e6 > h > 1.5e6）
    function flyToChinaForCityCards(done) {
        const duration = reduceMotion ? 0 : PROVINCE_ALL_FLY_DURATION;
        const finish = () => {
            if (provinceAllFlightHandler) {
                viewer.camera.moveEnd.removeEventListener(provinceAllFlightHandler);
                provinceAllFlightHandler = null;
            }
            if (provinceAllFlightTimer !== null) {
                clearTimeout(provinceAllFlightTimer);
                provinceAllFlightTimer = null;
            }
            if (!provinceAllFlight) return;   // 飞行途中已被取消
            provinceAllFlight = false;
            if (cityCardsEnabled()) done();
            syncProvinceAllBtn();
        };
        if (provinceAllFlightTimer !== null) {
            clearTimeout(provinceAllFlightTimer);
            provinceAllFlightTimer = null;
        }
        if (duration > 0) {
            provinceAllFlightHandler = finish;
            viewer.camera.moveEnd.addEventListener(provinceAllFlightHandler);
            provinceAllFlightTimer = setTimeout(finish, duration * 1000 + 700);   // moveEnd 没来时的兜底
        }
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                PROVINCE_ALL_FLY_LNG, PROVINCE_ALL_FLY_LAT, PROVINCE_ALL_FLY_HEIGHT),
            duration: duration
        });
        if (duration <= 0) finish();
    }

    function cancelAllCityFlight() {
        if (!provinceAllFlight) return;
        provinceAllFlight = false;
        if (provinceAllFlightHandler) {
            viewer.camera.moveEnd.removeEventListener(provinceAllFlightHandler);
            provinceAllFlightHandler = null;
        }
        if (provinceAllFlightTimer !== null) {
            clearTimeout(provinceAllFlightTimer);
            provinceAllFlightTimer = null;
        }
        syncProvinceAllBtn();
    }

    // 全部城市标注的落点：所有城市中心的世界坐标平均值
    function allCitiesLabelWorld() {
        let lng = 0;
        let lat = 0;
        let count = 0;
        cityList.forEach(city => {
            const center = cityCenter(city);
            if (!center || !Number.isFinite(center.lng) || !Number.isFinite(center.lat)) return;
            lng += center.lng;
            lat += center.lat;
            count++;
        });
        if (!count) return null;
        return Cesium.Cartesian3.fromDegrees(lng / count, lat / count, 0);
    }

    function closeProvinceCards() {
        cancelAllCityFlight();   // 收起整组时，还没落地的"自动缩放"也要停掉
        if (!provinceCardsActive && !provinceCardsItems.length) return;
        if (provinceCardClickTimer) {   // 收起时顺带取消还没落地的单/双击判定
            clearTimeout(provinceCardClickTimer);
            provinceCardClickTimer = null;
        }
        // 退场动画要用到这批元素，先留个副本；世代号保证收尾不会清掉"期间新开的一组"
        const exiting = provinceCardsItems.slice();
        const token = ++provinceCardsToken;
        // 收起时把入场动画的收尾状态一并清掉：脉冲停掉、被脉冲鼓起来的标记还回基准尺寸
        provinceEntranceUntil = 0;
        if (provincePulseRaf) {
            cancelAnimationFrame(provincePulseRaf);
            provincePulseRaf = null;
        }
        provinceCardsItems.forEach(item => {
            const ent = cityMarkerEntities[item.ci];
            if (ent && ent.billboard && focusedMarker !== ent && ent.billboard.scale !== 1) {
                ent.billboard.scale = 1;
            }
        });
        // 收起前先还掉"卡片悬停把某座城市标记提亮"的临时状态，
        // 否则那个标记会一直停在放大/全亮的样子
        if (focusedMarker && provinceCardsItems.some(item => cityMarkerEntities[item.ci] === focusedMarker)) {
            setMarkerFocus(null);
        }
        provinceCardsActive = false;
        provinceCardsMode = 'province';
        provinceCardsAdcode = '';
        provinceCitiesSet = new Set();
        provinceBrightEntities = new Set();
        provinceFocusItem = null;
        applyCityFillHighlight('');   // 城市高亮还原成主题金色
        provinceDragState = null;
        provinceCardsItems = [];
        provinceLabelText = '';
        provinceLabelWorld = null;
        const els = provinceElements();
        if (els.layer) {
            els.layer.setAttribute('aria-hidden', 'true');   // 关着就把整层从读屏里撤掉
        }
        if (els.svg) {
            // 悬停状态下关掉整组时，"其余线压暗"的整层状态要一起还原，
            // 否则下一次打开卡片组会一上来就是全暗的
            els.svg.classList.remove('has-focus');
        }
        // 有元素就播退场（卡片缩回自己的标记、连线向标记收回），没有或减弱动效时直接清
        if (!reduceMotion && exiting.length) {
            animateProvinceCardsExit(exiting, token);
        } else {
            if (els.layer) els.layer.innerHTML = '';
            if (els.svg) els.svg.innerHTML = '';
        }
        if (els.label) {
            els.label.classList.remove('show');
            els.label.textContent = '';
        }
        applyProvinceHighlight('');
        refreshMarkerColors();
        // 详情卡还开着时不要抢它的 card-open（右下角浮动按钮的让位状态由详情卡决定）
        const markerCardEl = document.getElementById('markerCard');
        const cityCardEl = document.getElementById('cityCard');
        const detailOpen = (markerCardEl && markerCardEl.classList.contains('visible')) ||
            (cityCardEl && cityCardEl.classList.contains('visible'));
        if (!detailOpen) document.body.classList.remove('card-open');
        resumeAutoRotate('province-cards');
        syncProvinceAllBtn();
    }

    // 收起动画：卡片缩回自己那个标记并淡出，连线向标记端收回（dash 反着走一遍）。
    // 用世代号做守卫 —— 动画没结束就点了别的省时，不能再把新的一组清掉。
    function animateProvinceCardsExit(items, token) {
        const els = provinceElements();
        items.forEach(item => {
            const el = item.el;
            if (el) {
                el.style.pointerEvents = 'none';   // 退场途中不再响应点击
                el.style.transition = 'transform 0.28s ease, opacity 0.24s ease';
                el.style.transitionDelay = '0ms';
                const backX = item.anchor ? item.anchor.x : item.x;
                const backY = item.anchor ? item.anchor.y : item.y;
                el.style.transform = 'translate3d(' + snapDevicePx(backX) + 'px,' +
                    snapDevicePx(backY) + 'px,0) scale(0.88)';
                el.style.opacity = '0';
            }
            [item.pathBase, item.path].forEach(p => {
                if (!p) return;
                let len = 0;
                try { len = p.getTotalLength ? p.getTotalLength() : 0; } catch (e) { len = 0; }
                if (!len || !Number.isFinite(len)) return;
                p.style.transition = 'stroke-dashoffset 0.26s ease';
                p.style.strokeDasharray = len + 'px';
                p.style.strokeDashoffset = len + 'px';
            });
            if (item.dot) {
                item.dot.style.transition = 'opacity 0.24s ease';
                item.dot.style.opacity = '0';
            }
        });
        window.setTimeout(() => {
            if (token !== provinceCardsToken) return;   // 期间已经开了新的一组，别误清
            if (provinceCardsItems.length) return;      // 双保险：层里已经有新内容，绝不碰
            if (els.layer) els.layer.innerHTML = '';
            if (els.svg) els.svg.innerHTML = '';
        }, 320);
    }

    // 再点一次同一个省 = 重新排版（解开拖拽过的卡片，让它们回到自动布局）
    function relayoutProvinceCards() {
        if (!provinceCardsActive || !provinceCardsItems.length) return;
        provinceCardsItems.forEach(item => {
            item.locked = false;
            if (item.el) item.el.classList.add('is-flying');   // 借入场飞行态的过渡，位移不硬跳
        });
        provinceLayoutDirty = true;
        layoutProvinceCards();
        window.setTimeout(() => {
            provinceCardsItems.forEach(item => {
                if (item.el) item.el.classList.remove('is-flying');
            });
        }, 420);
    }

    // ---------- 一次性提示：告诉首次放大到国内范围的用户"省份可以点" ----------
    // 只在桌面端、本次会话第一次出现中国轮廓时展示，6 秒后自动退场；
    // 用户一旦点开卡片组就立刻收起（说明他已经会了）。
    const PROVINCE_HINT_MS = 6000;
    function maybeShowProvinceHint() {
        if (provinceHintShown || !provinceCardsEnabled()) return;
        provinceHintShown = true;
        const el = document.getElementById('provinceHint');
        if (!el) return;
        el.classList.add('show');
        if (provinceHintTimer) clearTimeout(provinceHintTimer);
        provinceHintTimer = window.setTimeout(hideProvinceHint, PROVINCE_HINT_MS);
    }

    function hideProvinceHint() {
        if (provinceHintTimer) {
            clearTimeout(provinceHintTimer);
            provinceHintTimer = null;
        }
        const el = document.getElementById('provinceHint');
        if (el) el.classList.remove('show');
    }

    function provinceLabelWorldFromInfo(info) {
        // 标注落在省份中心：优先用 DataV 的 center（人工校正过，多岛屿省份不会被拉偏），
        // 没有 center 时退回几何包围盒中心。
        let lng = null;
        let lat = null;
        if (info.center && info.center.length >= 2) {
            lng = Number(info.center[0]);
            lat = Number(info.center[1]);
        } else if (info.bbox) {
            lng = (info.bbox[0] + info.bbox[2]) / 2;
            lat = (info.bbox[1] + info.bbox[3]) / 2;
        }
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return Cesium.Cartesian3.fromDegrees(lng, lat, 0);
    }

    // ---------- 卡片 DOM ----------
    function provinceCardViewModel(ci) {
        const city = cityList[ci] || {};
        const fps = cityViewItems(ci);
        const photos = cityPhotoItems(ci);
        const latest = fps.map(fp => fp.createTime).filter(Boolean).sort().pop();
        return {
            name: city.city || '未命名城市',
            count: fps.length,
            photos: photos.length,
            cover: photos.length ? photos[0].url : '',
            latest: latest ? formatCityDate(latest).replace(/\s*\/\s*/, '.') : ''
        };
    }

    function buildProvinceCardDom(cities) {
        const els = provinceElements();
        if (!els.layer || !els.svg) return;
        els.layer.innerHTML = '';
        els.svg.innerHTML = '';
        const defs = document.createElementNS(SVG_NS, 'defs');
        els.svg.appendChild(defs);

        provinceCardsItems = cities.map((ci, index) => {
            const view = provinceCardViewModel(ci);

            // ---- 卡片本体：封面 + 城市名 + 数量 + 最近到访，没有按钮，整卡可点 ----
            const el = document.createElement('div');
            el.className = 'prop-city-card';
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
            el.setAttribute('aria-label', view.name + '，' + view.count + ' 条足迹，进入城市相册');
            const media = document.createElement('div');
            media.className = 'prop-card-media';
            // 先只画"首字 + 空图片层"，封面等布局与错峰顺序定了再排队加载：
            // 这样先飞出来的卡片先拿到图（见 activateCityCards 里的 startProvinceCoverLoads）
            const coverRequest = renderCardCover(media, view.cover, view.name ? view.name.charAt(0) : '?');
            const body = document.createElement('div');
            body.className = 'prop-card-body';
            const title = document.createElement('h3');
            title.className = 'prop-card-title';
            title.textContent = view.name;
            const stats = document.createElement('p');
            stats.className = 'prop-card-stats';
            const countBold = document.createElement('b');
            countBold.textContent = String(view.count);
            const photoBold = document.createElement('b');
            photoBold.textContent = String(view.photos);
            stats.appendChild(countBold);
            stats.appendChild(document.createTextNode(' 足迹 · '));
            stats.appendChild(photoBold);
            stats.appendChild(document.createTextNode(' 照片'));
            const date = document.createElement('p');
            date.className = 'prop-card-date';
            date.textContent = view.latest ? '最近到访 ' + view.latest : '还没有记录时间';
            body.appendChild(title);
            body.appendChild(stats);
            body.appendChild(date);
            el.appendChild(media);
            el.appendChild(body);
            els.layer.appendChild(el);

            // ---- 连线：一条抛物线 + 起点圆点（颜色走每条线自己的青蓝渐变） ----
            const gradId = 'prop-leader-grad-' + index;
            const grad = document.createElementNS(SVG_NS, 'linearGradient');
            grad.setAttribute('id', gradId);
            grad.setAttribute('gradientUnits', 'userSpaceOnUse');
            ['x1', 'y1', 'x2', 'y2'].forEach(attr => grad.setAttribute(attr, '0'));
            const stopFrom = document.createElementNS(SVG_NS, 'stop');
            stopFrom.setAttribute('offset', '0%');
            stopFrom.setAttribute('stop-color', PROVINCE_LINE_FROM);
            const stopTo = document.createElementNS(SVG_NS, 'stop');
            stopTo.setAttribute('offset', '100%');
            stopTo.setAttribute('stop-color', PROVINCE_LINE_TO);
            grad.appendChild(stopFrom);
            grad.appendChild(stopTo);
            defs.appendChild(grad);

            const group = document.createElementNS(SVG_NS, 'g');
            group.setAttribute('class', 'prop-leader-group');
            // 深色描边打底：浅色底图上靠它把线"垫"出来，深色底图上几乎看不见
            const pathBase = document.createElementNS(SVG_NS, 'path');
            pathBase.setAttribute('class', 'prop-leader-base');
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('class', 'prop-leader');
            path.setAttribute('stroke', 'url(#' + gradId + ')');
            const dot = document.createElementNS(SVG_NS, 'circle');
            dot.setAttribute('class', 'prop-leader-dot');
            dot.setAttribute('r', String(PROVINCE_LINE_DOT_R));
            group.appendChild(pathBase);
            group.appendChild(path);
            group.appendChild(dot);
            els.svg.appendChild(group);

            const item = {
                ci: ci,
                el: el,
                group: group,
                pathBase: pathBase,
                path: path,
                dot: dot,
                grad: grad,
                coverRequest: coverRequest,
                x: 0, y: 0,
                w: PROVINCE_CARD_WIDTH, h: PROVINCE_CARD_HEIGHT,
                edge: 'right',
                locked: false, anchor: null
            };
            attachProvinceCardDrag(item);
            el.addEventListener('pointerenter', () => setProvinceCardFocus(item, true));
            el.addEventListener('pointerleave', () => {
                // 键盘焦点还在卡片上时不移除高亮（鼠标移开不该把 Tab 选中的线也熄掉）
                if (document.activeElement !== el) setProvinceCardFocus(item, false);
            });
            el.addEventListener('focus', () => setProvinceCardFocus(item, true));
            el.addEventListener('blur', () => {
                if (!el.matches(':hover')) setProvinceCardFocus(item, false);
            });
            // 这里不加 .show：卡片要保持不可见，等布局算出落点后由入场动画统一放飞
            return item;
        });
    }

    // 悬停 / 键盘聚焦某张卡片：自己的连线拉满、其余连线压暗（对比才是重点），
    // 起点圆点放大并呼吸，同时把对应的城市标记一起提亮放大 ——
    // 复用悬停标记那套视觉语言，让「卡片 ↔ 连线 ↔ 标记」串成一条链。
    function setProvinceCardFocus(item, on) {
        if (!item || !item.el) return;
        // 转到地球背面（或还没定位）的卡片不接受强调：它的线本来就是隐藏的，
        // 若被键盘 Tab 聚焦点亮，会出现"没有卡片却有一条高亮线"的怪状态。
        if (on && item.visible === false) return;
        const els = provinceElements();
        item.el.style.zIndex = on ? '120' : String(10 + (item.layoutIndex || 0));
        provinceFocusItem = on ? item : (provinceFocusItem === item ? null : provinceFocusItem);
        item.group.classList.toggle('is-active', on);
        if (item.path) item.path.classList.toggle('is-active', on);
        if (item.dot) {
            item.dot.classList.toggle('is-active', on);
            item.dot.setAttribute('r', String(on ? PROVINCE_LINE_DOT_R_ACTIVE : PROVINCE_LINE_DOT_R));
        }
        if (els.svg) els.svg.classList.toggle('has-focus', on);
        const marker = cityMarkerEntities[item.ci];
        if (!on) {
            if (marker && focusedMarker === marker) setMarkerFocus(null);   // 会按当前状态把颜色刷回去
            else refreshMarkerColors();
            applyCityFillHighlight('');   // 城市高亮还回主题金色
            return;
        }
        // 只有「全部城市」模式才额外强调"是哪座城"：把该城市的**城市高亮填充**（主题金色）
        // 换成省份同款青蓝，并把它自己的标记放大、其余标记压暗。
        // 省份模式下省份轮廓已经把这一片标出来了，悬停只强调连线，不动球面上的任何高亮。
        if (provinceCardsMode !== 'all') return;
        if (marker) setMarkerFocus(marker);
        refreshMarkerColors();
        applyCityFillHighlight(cityFillAdcodeOf(item.ci));
    }

    // 卡片高度由内容决定（写死高度会把信息裁掉），所以布局前先量一次真实尺寸；
    // 只在建组与 resize 时量，避免每帧读 offsetHeight 触发强制布局。
    function measureProvinceCards() {
        provinceCardsItems.forEach(item => {
            if (!item.el) return;
            item.w = item.el.offsetWidth || PROVINCE_CARD_WIDTH;
            item.h = item.el.offsetHeight || PROVINCE_CARD_HEIGHT;
        });
    }

    // ---------- 布局：就近边优先（上下左右都能放）+ 沿边错开 + 互相避让 ----------
    function clampNumber(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    // 坐标对齐到「设备像素」而不是 CSS 像素：
    // 显示器开了 125% / 150% 缩放时（devicePixelRatio = 1.25 / 1.5），
    // 整数 CSS 像素映射过去仍是小数设备像素，落在半格上的卡片文字就是糊的。
    // 对齐后每张卡都落在整格上，文字栅格化才稳定清晰。
    function snapDevicePx(value) {
        const dpr = window.devicePixelRatio || 1;
        return Math.round(value * dpr) / dpr;
    }

    const PROVINCE_EDGES = ['left', 'right', 'top', 'bottom'];
    const PROVINCE_EDGE_SIDE_BIAS = 0.05;   // 上下与左右同样近时优先左右（沿用原来的观感）
    const PROVINCE_LAYOUT_STEPS = 12;       // 沿边搜索的最大步数
    const PROVINCE_CLUSTER_PAD = 26;        // 标记簇包围盒的外扩，卡片尽量别压住标记群
    // 「中央留空区」：可用区中间按这两比例留出一块不放卡片的地方 ——
    // 卡片只贴四边，别漂在地球中央（那里是标记群、省名标注和视觉重心）。
    // 真排不下时宁可叠在边上，也不会摆进这块区域。
    const PROVINCE_CORE_KEEPOUT_X = 0.26;
    const PROVINCE_CORE_KEEPOUT_Y = 0.22;

    function provinceSafeArea(W, H) {
        const insetX = provinceSideInset();
        return {
            left: insetX,
            right: Math.max(insetX + 140, W - insetX),
            top: PROVINCE_SAFE_TOP,
            bottom: Math.max(PROVINCE_SAFE_TOP + 200, H - PROVINCE_SAFE_BOTTOM)
        };
    }

    function rectsOverlap(a, b) {
        return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }

    function overlapArea(a, b) {
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return (w > 0 && h > 0) ? w * h : 0;
    }

    function markerClusterRect(items) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        items.forEach(item => {
            minX = Math.min(minX, item.anchor.x);
            maxX = Math.max(maxX, item.anchor.x);
            minY = Math.min(minY, item.anchor.y);
            maxY = Math.max(maxY, item.anchor.y);
        });
        return {
            x: minX - PROVINCE_CLUSTER_PAD,
            y: minY - PROVINCE_CLUSTER_PAD,
            w: (maxX - minX) + PROVINCE_CLUSTER_PAD * 2,
            h: (maxY - minY) + PROVINCE_CLUSTER_PAD * 2
        };
    }

    // 标记到最近那条边的「相对距离」：越小说明越贴那条边
    function provinceEdgeAffinity(item, area, spanX, spanY) {
        const a = item.anchor;
        return Math.min(
            (a.x - area.left) / spanX,
            (area.right - a.x) / spanX,
            (a.y - area.top) / spanY,
            (area.bottom - a.y) / spanY
        );
    }

    // 一次布局：为一张卡片挑位置。按「就近边 → 沿边逐步外扩」搜索，
    // 先满足不与已有卡片重叠，再尽量少压住标记群，最后才是离自己标记最近。
    function pickProvinceCardSpot(item, area, spanX, spanY, cluster, placed, gap) {
        const w = item.w;
        const h = item.h;
        const a = item.anchor;
        const stagger = PROVINCE_CARD_STAGGER[item.layoutIndex % PROVINCE_CARD_STAGGER.length];
        const score = {
            left: (a.x - area.left) / spanX,
            right: (area.right - a.x) / spanX,
            top: (a.y - area.top) / spanY + PROVINCE_EDGE_SIDE_BIAS,
            bottom: (area.bottom - a.y) / spanY + PROVINCE_EDGE_SIDE_BIAS * 2
        };
        const edges = PROVINCE_EDGES.slice().sort((e1, e2) => score[e1] - score[e2]);
        // 中央留空区（可用区正中那一块）：任何方向都不往这里摆卡片
        const core = {
            x: area.left + spanX * PROVINCE_CORE_KEEPOUT_X,
            y: area.top + spanY * PROVINCE_CORE_KEEPOUT_Y,
            w: spanX * (1 - PROVINCE_CORE_KEEPOUT_X * 2),
            h: spanY * (1 - PROVINCE_CORE_KEEPOUT_Y * 2)
        };

        let best = null;
        edges.forEach((edge, edgeRank) => {
            // 沿边外扩时优先朝屏幕中心那一侧，卡片整体更聚拢、不会甩到角落
            const towardCenter = (edge === 'left' || edge === 'right')
                ? Math.sign((area.top + area.bottom) / 2 - a.y)
                : Math.sign((area.left + area.right) / 2 - a.x);
            for (let k = 0; k <= PROVINCE_LAYOUT_STEPS; k++) {
                const steps = k === 0 ? [0] : [k, -k];
                for (let s = 0; s < steps.length; s++) {
                    const step = steps[s];
                    const x = edge === 'left' ? area.left + stagger
                        : edge === 'right' ? area.right - w - stagger
                            : a.x - w / 2 + step * (w + gap);
                    const y = edge === 'top' ? area.top + stagger
                        : edge === 'bottom' ? area.bottom - h - stagger
                            : a.y - h / 2 + step * (h + gap);
                    if (x < area.left || y < area.top || x + w > area.right || y + h > area.bottom) continue;
                    const rect = { x: x, y: y, w: w, h: h };
                    if (rectsOverlap(rect, core)) continue;   // 中央留空：宁可换方向、换格，也不摆到画面中间
                    const padded = { x: x - gap, y: y - gap, w: w + gap * 2, h: h + gap * 2 };
                    let blocked = false;
                    for (let p = 0; p < placed.length; p++) {
                        if (rectsOverlap(padded, placed[p])) { blocked = true; break; }
                    }
                    if (blocked) continue;
                    let cost = Math.abs(step) * 70 + edgeRank * 30;
                    if (towardCenter && step * towardCenter < 0) cost += 8;
                    if (cluster) cost += 900 * (overlapArea(rect, cluster) / (w * h));
                    if (!best || cost < best.cost) best = { x: x, y: y, edge: edge, cost: cost };
                }
            }
        });
        if (best) return best;

        // 四条边都排满了：在**外圈**做一次粗网格扫描（跳过中央留空区）。
        // 同时记两个候选：完全不压别人的空位；以及"压得最少"的位置 ——
        // 后者是"实在排不下就叠加"的实现，挑压得最少的能避免几张卡挤成一坨。
        const stepX = Math.max(40, Math.round(w / 2));
        const stepY = Math.max(30, Math.round(h / 2));
        let gridBest = null;
        let gridSoft = null;
        for (let gy = area.top; gy + h <= area.bottom; gy += stepY) {
            for (let gx = area.left; gx + w <= area.right; gx += stepX) {
                const rect = { x: gx, y: gy, w: w, h: h };
                if (rectsOverlap(rect, core)) continue;
                const padded = { x: gx - gap, y: gy - gap, w: w + gap * 2, h: h + gap * 2 };
                let overlapSum = 0;
                for (let p = 0; p < placed.length; p++) {
                    if (rectsOverlap(padded, placed[p])) overlapSum += overlapArea(rect, placed[p]);
                }
                const d = Math.hypot(gx + w / 2 - a.x, gy + h / 2 - a.y);
                if (!overlapSum) {
                    if (!gridBest || d < gridBest.d) gridBest = { x: gx, y: gy, edge: edges[0], d: d };
                } else if (!gridSoft || overlapSum < gridSoft.overlap) {
                    gridSoft = { x: gx, y: gy, edge: edges[0], d: d, overlap: overlapSum };
                }
            }
        }
        if (gridBest) return { x: gridBest.x, y: gridBest.y, edge: gridBest.edge, cost: Infinity };
        if (gridSoft) return { x: gridSoft.x, y: gridSoft.y, edge: gridSoft.edge, cost: Infinity };

        // 最后兜底：真的没地方了，就落在首选方向（允许压住别的卡片），保证卡片不丢
        const edge = edges[0];
        const x = edge === 'left' ? area.left + stagger
            : edge === 'right' ? area.right - w - stagger
                : clampNumber(a.x - w / 2, area.left, Math.max(area.left, area.right - w));
        const y = edge === 'top' ? area.top + stagger
            : edge === 'bottom' ? area.bottom - h - stagger
                : clampNumber(a.y - h / 2, area.top, Math.max(area.top, area.bottom - h));
        return { x: x, y: y, edge: edge, cost: Infinity };
    }

    function layoutProvinceCards() {
        provinceLayoutDirty = false;
        if (!provinceCardsActive || !provinceCardsItems.length) return;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const area = provinceSafeArea(W, H);
        const spanX = Math.max(1, area.right - area.left);
        const spanY = Math.max(1, area.bottom - area.top);
        // 卡片多时只把同侧间距收紧一点（12 → 8），卡片本身尺寸不变；
        // 再密就交给"就近边外扩 → 网格兜底 → 堆叠"这套机制。
        const gap = provinceCardsItems.length > PROVINCE_CARD_DENSE_LIMIT ? 8 : PROVINCE_CARD_GAP;

        // 1) 锚点：每张卡跟着自己那座城市的标记
        const active = [];
        provinceCardsItems.forEach((item, index) => {
            item.layoutIndex = index;
            item.anchor = cityMarkerScreenPosition(item.ci);
            if (item.anchor) active.push(item);
        });

        // 2) 标记群包围盒 + 已经拖拽定位的卡片（它们位置固定，先占位当障碍）
        const cluster = active.length ? markerClusterRect(active) : null;
        const placed = [];
        provinceCardsItems.forEach(item => {
            if (item.locked && item.anchor) {
                placed.push({ x: item.x, y: item.y, w: item.w, h: item.h });
            }
        });

        // 3) 最贴边的先排：它可选的方向最少，先把位置占住
        active
            .slice()
            .sort((a, b) => provinceEdgeAffinity(a, area, spanX, spanY) -
                provinceEdgeAffinity(b, area, spanX, spanY))
            .forEach(item => {
                const spot = pickProvinceCardSpot(item, area, spanX, spanY, cluster, placed, gap);
                item.x = spot.x;
                item.y = spot.y;
                item.edge = spot.edge;
                placed.push({ x: spot.x, y: spot.y, w: item.w, h: item.h });
                applyProvinceCardBox(item);
            });

        // 4) 转到地球背面（没有屏幕坐标）的卡片保持原位，只由连线层负责淡出
        provinceCardsItems.forEach(item => {
            if (!item.anchor) applyProvinceCardBox(item);
        });

        updateProvinceLeaderLines();
        updateProvinceLabelPosition();
    }

    function applyProvinceCardBox(item) {
        const el = item.el;
        if (!el) return;
        el.style.transform = 'translate3d(' + snapDevicePx(item.x) + 'px,' + snapDevicePx(item.y) + 'px,0)';
        el.style.zIndex = String(10 + (item.layoutIndex || 0));
    }

    // 城市聚合标记的屏幕坐标；转到地球背面或数据缺失时返回 null
    function cityMarkerScreenPosition(ci) {
        const ent = cityMarkerEntities[ci];
        if (!ent) return null;
        const pos = ent.position && ent.position.getValue(Cesium.JulianDate.now());
        if (!pos) return null;
        const normal = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
        const toCamera = Cesium.Cartesian3.subtract(viewer.camera.positionWC, pos, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.dot(normal, toCamera) < 0) return null;
        const screen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos);
        return screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
    }

    // ---------- 连线与省名标注 ----------
    function round1(value) {
        return Math.round(value * 10) / 10;
    }

    // 连线落点：卡片中心朝自己的标记方向，与卡片边框的交点。
    // 这样卡片无论放在上下左右哪条边，线都钉在朝向标记的那一边上（拐角处也能自然落在角上）。
    function provinceCardAnchorPoint(item) {
        const cx = item.x + item.w / 2;
        const cy = item.y + item.h / 2;
        const dx = item.anchor.x - cx;
        const dy = item.anchor.y - cy;
        if (!dx && !dy) return { x: cx, y: cy };
        const scaleX = dx === 0 ? Infinity : (item.w / 2) / Math.abs(dx);
        const scaleY = dy === 0 ? Infinity : (item.h / 2) / Math.abs(dy);
        const k = Math.min(scaleX, scaleY);
        return { x: cx + dx * k, y: cy + dy * k };
    }

    function updateProvinceLeaderLines() {
        if (!provinceCardsItems.length) return;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const viewCenterX = W / 2;
        const viewCenterY = H / 2;
        // 同一条边上的线按顺序递增弧度，形成扇面（每条边各自扇开）
        const edgeTotals = { left: 0, right: 0, top: 0, bottom: 0 };
        const edgeSeen = { left: 0, right: 0, top: 0, bottom: 0 };
        provinceCardsItems.forEach(item => {
            edgeTotals[item.edge || 'right'] = (edgeTotals[item.edge || 'right'] || 0) + 1;
        });

        provinceCardsItems.forEach(item => {
            const anchor = item.anchor;
            const visible = provinceCardsActive && !!anchor;
            item.visible = visible;
            // 隐藏要同时落到 <g> 与三个子元素上：
            // 之前只给 <g> 加了类，但没有任何规则匹配 g.is-hidden，所以卡片转到地球背面
            // 之后线会孤零零留在屏幕上 —— 现在三条规则一起生效，谁也漏不掉。
            item.group.classList.toggle('is-hidden', !visible);
            item.pathBase.classList.toggle('is-hidden', !visible);
            item.path.classList.toggle('is-hidden', !visible);
            item.dot.classList.toggle('is-hidden', !visible);
            item.el.classList.toggle('is-hidden', !visible);
            // 不可见的卡片不该被 Tab 聚焦（否则焦点会落到看不见的卡片上）
            const tabIndex = visible ? 0 : -1;
            if (item.el.tabIndex !== tabIndex) item.el.tabIndex = tabIndex;
            if (!visible) {
                // 刚被转走的这张如果正被悬停/聚焦：连同"其余线压暗"的整层状态一起还原
                if (provinceFocusItem === item) setProvinceCardFocus(item, false);
                return;
            }

            const edge = item.edge || 'right';
            const fanIndex = edgeSeen[edge]++;
            // 终点：卡片朝向自己标记的那条边上的交点
            const end = provinceCardAnchorPoint(item);
            const endX = end.x;
            const endY = end.y;
            const dx = endX - anchor.x;
            const dy = endY - anchor.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            // 起点：直接从城市标记圆点的中心出发
            const startX = anchor.x;
            const startY = anchor.y;

            // 控制点 = 弦中点沿垂直方向偏移；方向统一取「远离视口中心」的那一侧，
            // 保证同一侧的线朝同一个方向鼓出，不会互相穿插成结。
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;
            let px = -uy;
            let py = ux;
            const outX = midX + px * 120 - viewCenterX;
            const outY = midY + py * 120 - viewCenterY;
            const inX = midX - px * 120 - viewCenterX;
            const inY = midY - py * 120 - viewCenterY;
            if (outX * outX + outY * outY < inX * inX + inY * inY) {
                px = -px;
                py = -py;
            }
            const fan = PROVINCE_LINE_FAN[0] + (PROVINCE_LINE_FAN[1] - PROVINCE_LINE_FAN[0]) *
                (fanIndex / Math.max(1, edgeTotals[edge] - 1));
            const ctrlX = midX + px * len * fan;
            const ctrlY = midY + py * len * fan;

            const d = 'M' + round1(startX) + ' ' + round1(startY) +
                ' Q' + round1(ctrlX) + ' ' + round1(ctrlY) +
                ' ' + round1(endX) + ' ' + round1(endY);
            item.pathBase.setAttribute('d', d);   // 深色底与亮线共用同一条路径
            item.path.setAttribute('d', d);
            item.dot.setAttribute('cx', round1(startX));
            item.dot.setAttribute('cy', round1(startY));
            item.grad.setAttribute('x1', round1(startX));
            item.grad.setAttribute('y1', round1(startY));
            item.grad.setAttribute('x2', round1(endX));
            item.grad.setAttribute('y2', round1(endY));
        });
    }

    const provinceLabelNormal = new Cesium.Cartesian3();
    const provinceLabelToCam = new Cesium.Cartesian3();
    function updateProvinceLabelPosition() {
        const els = provinceElements();
        if (!els.label) return;
        if (!provinceCardsActive || !provinceLabelWorld) {
            els.label.classList.remove('show');
            return;
        }
        Cesium.Cartesian3.normalize(provinceLabelWorld, provinceLabelNormal);
        Cesium.Cartesian3.subtract(viewer.camera.positionWC, provinceLabelWorld, provinceLabelToCam);
        if (Cesium.Cartesian3.dot(provinceLabelNormal, provinceLabelToCam) < 0) {
            els.label.classList.remove('show');   // 省份中心转到地球背面
            return;
        }
        const screen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, provinceLabelWorld);
        if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
            els.label.classList.remove('show');
            return;
        }
        if (els.label.textContent !== provinceLabelText) els.label.textContent = provinceLabelText;
        els.label.style.left = snapDevicePx(screen.x) + 'px';
        els.label.style.top = snapDevicePx(screen.y - 18) + 'px';
        els.label.classList.add('show');
    }

    // 每帧只在「相机真的动了 / 布局脏 / 正在拖拽」时更新，静止浏览时整段跳过
    const provinceCamPos = new Cesium.Cartesian3();
    const provinceCamDir = new Cesium.Cartesian3();
    let provinceCamReady = false;
    function provinceCameraMoved() {
        const camera = viewer.camera;
        if (provinceCamReady &&
            Cesium.Cartesian3.equalsEpsilon(camera.positionWC, provinceCamPos, Cesium.Math.EPSILON6) &&
            Cesium.Cartesian3.equalsEpsilon(camera.directionWC, provinceCamDir, Cesium.Math.EPSILON6)) {
            return false;
        }
        Cesium.Cartesian3.clone(camera.positionWC, provinceCamPos);
        Cesium.Cartesian3.clone(camera.directionWC, provinceCamDir);
        provinceCamReady = true;
        return true;
    }

    function updateProvinceOverlays() {
        if (!provinceCardsActive) return;
        if (provinceDragState) {
            // 拖拽中卡片位置由指针决定，只刷新连线与标注
            updateProvinceLeaderLines();
            updateProvinceLabelPosition();
            return;
        }
        if (performance.now() < provinceEntranceUntil) {
            // 入场动画期间锁住重排：卡片的 transform 归动画管（改写会打断过渡），
            // 线的铺开用的是"整段 dash"，路径长度一变就会出现断口。锚点仍按当前相机刷新。
            // 只在相机真的动了时才刷新 —— 展开瞬间相机通常静止，每帧刷 16 组坐标+32 次属性写是白费。
            if (provinceCameraMoved()) {
                provinceCardsItems.forEach(item => {
                    item.anchor = cityMarkerScreenPosition(item.ci);
                });
                updateProvinceLeaderLines();
                updateProvinceLabelPosition();
            }
            return;
        }
        if (!provinceCameraMoved() && !provinceLayoutDirty) return;
        layoutProvinceCards();
    }
    viewer.scene.postRender.addEventListener(updateProvinceOverlays);

    // “拉出来”的生长动画：线沿自身长度铺开；动画结束后清掉 dash，
    // 否则线随地球移动、长度变化时会出现断口。
    function startProvinceLinesGrow() {
        if (reduceMotion) return;
        provinceCardsItems.forEach(item => {
            // 深色底描边必须和亮线一起铺开：只给亮线做 dash 动画的话，
            // 底层会整条先出现（就是"先看到一条纯黑的线"），亮线再慢慢盖上去。
            const paths = [item.pathBase, item.path].filter(Boolean);
            const path = item.path;
            if (!path || typeof path.getTotalLength !== 'function' || !paths.length) return;
            let length = 0;
            try { length = path.getTotalLength(); } catch (e) { length = 0; }
            if (!length || !Number.isFinite(length)) return;
            const delay = Math.round(item.lineDelay || 0);
            paths.forEach(p => {
                p.style.transition = 'none';
                p.style.strokeDasharray = length + 'px';
                p.style.strokeDashoffset = length + 'px';
            });
            requestAnimationFrame(() => {
                paths.forEach(p => {
                    p.style.transition = 'stroke-dashoffset ' + (PROVINCE_LINE_GROW_MS / 1000) +
                        's cubic-bezier(0.16, 1, 0.3, 1) ' + delay + 'ms';
                    p.style.strokeDashoffset = '0px';
                });
                window.setTimeout(() => {
                    paths.forEach(p => {
                        p.style.transition = '';
                        p.style.strokeDasharray = '';
                        p.style.strokeDashoffset = '';
                    });
                }, PROVINCE_LINE_GROW_MS + delay + 120);
            });
        });
    }

    // ---------- 拖拽 / 点击 ----------
    function applyProvinceDragPosition(item, clientX, clientY, grabX, grabY) {
        const w = item.w || PROVINCE_CARD_WIDTH;
        const h = item.h || PROVINCE_CARD_HEIGHT;
        item.x = clampNumber(clientX - grabX, 8, Math.max(8, window.innerWidth - w - 8));
        item.y = clampNumber(clientY - grabY, 8, Math.max(8, window.innerHeight - h - 8));
        applyProvinceCardBox(item);
    }

    function attachProvinceCardDrag(item) {
        const el = item.el;
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const rect = el.getBoundingClientRect();
            provinceDragState = {
                item: item,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                grabX: e.clientX - rect.left,
                grabY: e.clientY - rect.top,
                moved: false
            };
            try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略：拿不到指针捕获也能拖 */ }
            e.preventDefault();
        });
        el.addEventListener('pointermove', (e) => {
            const state = provinceDragState;
            if (!state || state.item !== item || state.pointerId !== e.pointerId) return;
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            if (!state.moved && Math.hypot(dx, dy) < 4) return;   // 4px 以内算点击，不算拖拽
            state.moved = true;
            item.locked = true;   // 拖过的卡片不再被自动排版移动
            el.classList.add('is-dragging');
            applyProvinceDragPosition(item, e.clientX, e.clientY, state.grabX, state.grabY);
            updateProvinceLeaderLines();
            e.preventDefault();
        });
        const finish = (e) => {
            const state = provinceDragState;
            if (!state || state.item !== item) return;
            provinceDragState = null;
            el.classList.remove('is-dragging');
            try { el.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放或从未捕获 */ }
            // 单击延迟 180ms 再执行：给"双击打开单城市卡"留出判定窗口
            if (!state.moved) {
                if (provinceCardClickTimer) clearTimeout(provinceCardClickTimer);
                provinceCardClickTimer = window.setTimeout(() => {
                    provinceCardClickTimer = null;
                    openProvinceCityAlbum(item.ci);
                }, 180);
            }
        };
        el.addEventListener('pointerup', finish);
        el.addEventListener('pointercancel', finish);
        // 双击 = 打开单城市卡（大玻璃卡）：形成「小卡 → 大卡 → 相册」的层次
        el.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (provinceCardClickTimer) {
                clearTimeout(provinceCardClickTimer);
                provinceCardClickTimer = null;
            }
            openProvinceCityCard(item.ci);
        });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            e.preventDefault();
            openProvinceCityAlbum(item.ci);
        });
    }

    // 打开单城市卡（大卡）。showCityCard 内部会收起省份卡片组（两者互斥），
    // 收起走的是退场动画，所以视觉上是"小卡缩回、大卡从标记方向展开"。
    function openProvinceCityCard(ci) {
        if (!cityList[ci]) return;
        showCityCard(ci);
    }

    // 点卡片 = 进该城市的相册；返回地球后原样恢复这组卡片与连线
    function openProvinceCityAlbum(ci) {
        if (!cityList[ci]) return;
        const adcode = provinceCardsAdcode;
        const mode = provinceCardsMode;
        closeProvinceCards();
        provinceRestorePending = mode === 'all'
            ? { mode: 'all' }
            : (adcode ? { mode: 'province', adcode: adcode } : null);
        openCityView(ci, null);
    }

    // ---------- 导航栏「全部城市」入口 ----------
    function provinceAllBtnEl() {
        if (!provinceAllBtnCache) provinceAllBtnCache = document.getElementById('provinceAllBtn');
        return provinceAllBtnCache;
    }

    function syncProvinceAllBtn() {
        const btn = provinceAllBtnEl();
        if (!btn) return;
        // 自动缩放期间也算"已按下"：用户点了立刻有反馈，落地后无缝变成展开态
        const on = provinceAllFlight || (provinceCardsActive && provinceCardsMode === 'all');
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    }

    // 可用态：只有「3D + 桌面端 + 城市聚合态」时才可点（每帧调用，只在翻转时写 DOM）
    function syncProvinceAllAvailability() {
        const btn = provinceAllBtnEl();
        if (!btn) return;
        const enabled = cityCardsEnabled();
        if (provinceAllAvailable === enabled) return;
        provinceAllAvailable = enabled;
        btn.disabled = !enabled;
    }

    // 再点一次收起，和省份卡片是同一套开关语义
    function toggleAllCityCards() {
        if (provinceAllFlight) return true;   // 正在飞过去，忽略重复点击
        if (provinceCardsActive && provinceCardsMode === 'all') {
            closeProvinceCards();
            return true;
        }
        return activateAllCityCards();
    }

    (function wireProvinceAllBtn() {
        const btn = provinceAllBtnEl();
        if (!btn) return;
        btn.addEventListener('click', () => toggleAllCityCards());
        syncProvinceAllBtn();
        syncProvinceAllAvailability();
    })();

    // 视口变化：重排；窄屏直接整组收起（门控与样式断点一致）
    window.addEventListener('resize', () => {
        if (!provinceCardsActive) return;
        if (!provinceCardsEnabled()) {
            closeProvinceCards();
            return;
        }
        measureProvinceCards();
        provinceLayoutDirty = true;
    });

    // 足迹数据重载后：省市对应关系可能变了，收起已打开的卡片组
    document.addEventListener('footprints:loaded', () => {
        if (provinceCardsActive) closeProvinceCards();
        hidePhotoRing();   // 数据重载后照片可能已变，收起照片环
    });

    loadProvinceIndex();   // 提前取一次边界数据，首次点击省份时不必等网络

    // ================= 恢复上次视图状态 =================
    // 刷新后保持上次的 2D/3D 模式（直接恢复，不做展开动画，避免 3D 闪一下）；
    // 带 ?view=tickets 进来时 startIn2D() 为 false，即保持 3D 并把票根页正常显示出来
    try {
        if (startIn2D() && !amapMode) {
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
