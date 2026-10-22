/**
 * 足迹标记与详情卡。
 *
 * 三部分共享同一批标记实体与详情卡状态：
 *   - 标记点：图标绘制、构建/重建、城市聚合与单足迹展开、随底图坐标系重算位置；
 *   - 详情卡：足迹卡与城市聚合卡的内容填充、入场方向、显隐与焦点管理；
 *   - 悬停与键盘：悬停气泡 / 引导线、遮挡重算、地名标签避让、键盘可达。
 *
 * 矩形工具见 modules/geometry.js；封面加载队列见 modules/city-view.js。
 */

import { COARSE_POINTER } from './env.js';
import { PROVINCE_MARKER_DIM_ALPHA } from './province-style.js';
import { gcj02ToWgs84, wgs84ToGcj02 } from './coordinate.js';
import {
    cityWallImages,
    loadCardCoverImage,
    formatCityDate,
    openCityView,
    closeCityView,
    openCityViewAtFootprint,
    showCardCover,
    cityView
} from './city-view.js';
import {
    hidePhotoRing,
    showPhotoRing,
    photoRingIsOpenFor,
    isPhotoRingActive,
    isPhotoRingViewing,
    firstVisibleRingItem,
    focusWhenVisible,
    exitPhotoRingView,
    switchPhotoRingView
} from './photo-ring.js';
import {
    isProvinceCardsActive,
    closeProvinceCards,
    provinceBrightEntitySet,
    setHoveredProvince,
    provinceHoverAt,
    provincePickingEnabled,
    provinceAtScreenPoint,
    openProvinceCards
} from './province-cards.js';
import { pauseAutoRotate, resumeAutoRotate, applyCanvasCursor, setHoveredMarker } from './auto-rotate.js';
import {
    ticketImageUrl,
    ticketDate,
    ticketItemsFromFootprints,
    setTicketView,
    openTicketGalleryForCity
} from './ticket-gallery.js';
import { closeLightbox } from './lightbox.js';
import { outlinePolylines } from './city-fill.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints               () => Footprint[]      可变数据用取值函数
 * @param d.viewer                   () => Cesium.Viewer
 * @param d.baseProviders            () => Record<string, provider>
 * @param d.footprintCfg             () => object
 * @param d.reduceMotion             () => boolean
 * @param d.boundaryVisible          () => boolean
 * @param d.cityLabelVisible         () => boolean
 * @param d.applyScreenSpaceError    () => void
 */
export function setupMarkers(d) {
    deps = d;
}

// 详情卡（足迹卡 / 城市聚合卡）：整球视图（标题卡出现）时自动收起；初始化完成前不触发
let detailCardsReady = false;
// 城市聚合状态（提前声明，updateIntroVisibility 会读取）
let cityList = [];            // [{ city, indices: [足迹下标] }]，按数据顺序
let cityMarkerEntities = [];  // 城市标记实体
export const CITY_EXPAND_HEIGHT = 1500000;    // 相机低于此高度时展开为单个足迹
export const CITY_COLLAPSE_HEIGHT = 1800000;  // 高于此高度时聚合为城市标记
export const CITY_VIEW_HEIGHT = 600000;       // 点击城市后的落地高度：低于展开阈值，落到城市尺度（足够近，同城足迹点也能拉开）
let cityMode = true;
// 程序化“飞往城市”的飞行状态：飞行期间抑制高度阈值自动切换，
// 落地后再统一把聚合标记展开为该城市的足迹点，避免用户手动补一次缩放。
let cityFlightActive = false;
let cityFlightIndex = -1;
let cityFlightTimer = null;
let cityMoveEndHandler = null;
let cityRevealRaf = null;
let focusedMarker = null;        // 当前聚焦（悬停/键盘选中）的标记，null 表示无
let markerOcclusionDirty = true; // 标记遮挡需要重算（相机或标记位置变化时置位）
let markerLabelDirty = true;     // 地名标签需要重排（标记或标签显隐变化时置位）
let pendingMarkerAudit = false;  // 需要在真实渲染结果上体检一次标记（展开/重建后）
// 地名标签的布局状态（提前声明：buildMarkers / buildCityMarkers 会和标记一起重建）
const labelLayoutState = new Map();       // ent -> { show, x, y }，避免重复写 Cesium 属性
const slotBlockRects = [];                // 本帧已占用的矩形（标记 + 已放下的标签），逐帧清空复用
const labelScreen = new Cesium.Cartesian2();
const markerLift = new Map();             // 下标 -> 渲染抬高米数（自愈用，不影响数据坐标）

let markerEntities = [];
let currentPositions = [];

// 标记悬停气泡与键盘焦点层（提前声明：applyMarkerMode 初始化时就会用到）
export const markerTip = document.getElementById('markerTip');
const markerTipName = document.getElementById('markerTipName');
export const markerFocusLayer = document.getElementById('markerFocusLayer');
let markerTipEntity = null;
let lastKeyboardMarkerBtn = null;
let hoveredMarkerKey = '';   // 当前气泡对应的标记（类型:下标），用于跳过同一标记上的重复设置

function cityMarkerUrl(count) {
    // 绘制统一走 markerIconUrl（与足迹标记共用同一套命中层，见文件下方标记点一节）
    return markerIconUrl('city', CITY_MARKER_REF_SIZE / CITY_MARKER_SIZE, count);
}

// 城市中心 = 该城市所有足迹在“当前底图坐标系”下的平均位置
export function cityCenter(city) {
    let lng = 0, lat = 0, n = 0;
    city.indices.forEach(i => {
        const p = currentPositions[i];
        if (p) { lng += p.lng; lat += p.lat; n++; }
    });
    return n ? { lng: lng / n, lat: lat / n } : null;
}

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
export function applyMarkerPositions(key) {
    const item = deps.baseProviders()[key];
    const basemapIsGcj = !!(item && item.gcj);
    currentPositions = deps.footprints().map(fp => footprintToBasemap(fp, basemapIsGcj));
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
    const raw = String(deps.footprintCfg().globeLabels || 'all').trim().toLowerCase();
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
export function buildMarkers() {
    labelLayoutState.clear();
    markerEntities = deps.footprints().map((fp, i) => {
        const pos = currentPositions[i] || { lng: fp.lng, lat: fp.lat };
        return deps.viewer().entities.add({
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
export function cityKeyOf(fp) {
    if (!fp) return '';
    const code = String(fp.cityAdcode || '').trim();
    if (code) return code;
    return String(fp.city || '').trim();
}

export function buildCityMarkers() {
    // 先按聚合键分组，再决定显示用的城市名（取该组里出现次数最多的写法）
    const groups = new Map();
    deps.footprints().forEach((fp, i) => {
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
    cityMarkerEntities.forEach(ent => deps.viewer().entities.remove(ent));
    labelLayoutState.clear();
    cityMarkerEntities = cityList.map(city => {
        const center = cityCenter(city);
        return deps.viewer().entities.add({
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
export function applyMarkerMode(city) {
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
    if (!city && isProvinceCardsActive()) closeProvinceCards();
}


// ================= 标记交互：悬停显示名称，点击打开详情卡 =================
export const markerCard = document.getElementById('markerCard');
const markerCardMedia = document.getElementById('markerCardMedia');
const markerCardTitle = document.getElementById('markerCardTitle');
const markerCardMeta = document.getElementById('markerCardMeta');
const markerCardAddr = document.getElementById('markerCardAddr');
const markerCardAddrRow = document.getElementById('markerCardAddrRow');
const markerCardDesc = document.getElementById('markerCardDesc');
const markerCardActions = markerCard.querySelector('.marker-card-actions');
const markerCardTicket = document.getElementById('markerCardTicket');
export const markerCardGallery = document.getElementById('markerCardGallery');
const markerCardGalleryLabel = document.getElementById('markerCardGalleryLabel');
const markerCardStamp = document.getElementById('markerCardStamp');
export const cityCard = document.getElementById('cityCard');
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
export function setOverlayHidden(el, hidden) {
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

export function hideMarkerCard() {
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
    if (deps.reduceMotion()) {
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
            const f = deps.footprints()[activeFootprintIndex];
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
export function cardLayoutRect(card) {
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
export function markerScreenPosition(index) {
    const ent = markerEntities[index];
    if (!ent || ent.show === false) return null;
    if (!ent.billboard || ent.billboard.show === false) return null;
    const pos = ent.position && ent.position.getValue(Cesium.JulianDate.now());
    if (!pos) return null;
    // 与悬停标注同一套半球判定：转到地球背面的标记没有可参照的屏幕位置
    const normal = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
    const toCamera = Cesium.Cartesian3.subtract(deps.viewer().camera.positionWC, pos, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.dot(normal, toCamera) < 0) return null;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, pos);
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

export function showMarkerCard(fp, index) {
    hideCityCard(false);
    closeProvinceCards();   // 详情卡与省份卡片组互斥：打开详情卡就收起省份卡片
    pauseAutoRotate('card');   // 打开足迹详情卡：临时停转（关掉卡片按用户偏好自动恢复）
    activeFootprintIndex = index;
    markerCardTitle.textContent = fp.name;
    markerCardAddr.textContent = fp.address || '';
    // 地址为空时连图标一起收起（编辑窗里地址是必填的，这里只是兜底）
    if (markerCardAddrRow) markerCardAddrRow.hidden = !(fp.address || '').trim();
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
    const fp = deps.footprints()[activeFootprintIndex];
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
export function cityViewItems(ci) {
    const city = cityList[ci];
    return city ? city.indices.map(i => deps.footprints()[i]).filter(Boolean) : [];
}

export function cityPhotoItems(ci) {
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
export function finishCityFlight() {
    if (cityFlightTimer !== null) {
        clearTimeout(cityFlightTimer);
        cityFlightTimer = null;
    }
    if (cityMoveEndHandler) {
        deps.viewer().camera.moveEnd.removeEventListener(cityMoveEndHandler);
        cityMoveEndHandler = null;
    }
    cityFlightActive = false;
    const ci = cityFlightIndex;
    cityFlightIndex = -1;
    if (ci < 0) return;
    const h = deps.viewer().camera.positionCartographic.height;
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
    if (alreadyExpanded || deps.reduceMotion()) {
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
        const fp = deps.footprints()[i];
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
        const sp = Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, pos, labelScreen);
        if (!sp || sp.x < 0 || sp.y < 0 || sp.x > window.innerWidth || sp.y > window.innerHeight) return;
        const picked = deps.viewer().scene.pick(new Cesium.Cartesian2(sp.x, sp.y));
        if (picked && picked.id === ent) return;   // 画出来了，正常
        if (picked && (markerEntities.indexOf(picked.id) >= 0 || cityMarkerEntities.indexOf(picked.id) >= 0)) {
            return;                                // 被另一个标记压住：属正常遮挡，不动它
        }
        // 没被画出来 → 抬高一点重建这个实体（下一次体检会再确认）
        markerLift.set(i, nextStep);
        const center = currentPositions[i] || { lng: fp.lng, lat: fp.lat };
        const fresh = deps.viewer().entities.add({
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
        deps.viewer().entities.remove(ent);
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
    const duration = deps.reduceMotion() ? 0 : 1.8;
    if (cityFlightTimer !== null) {
        clearTimeout(cityFlightTimer);
        cityFlightTimer = null;
    }
    if (cityMoveEndHandler) {
        deps.viewer().camera.moveEnd.removeEventListener(cityMoveEndHandler);
        cityMoveEndHandler = null;
    }
    cityFlightActive = true;
    cityFlightIndex = ci;
    if (duration > 0) {
        cityMoveEndHandler = finishCityFlight;
        deps.viewer().camera.moveEnd.addEventListener(cityMoveEndHandler);
        cityFlightTimer = setTimeout(finishCityFlight, duration * 1000 + 600);
    }
    deps.viewer().camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(target.lng, target.lat, target.height),
        duration: duration
    });
    if (duration <= 0) finishCityFlight();
}

export function showCityCard(ci, triggerBtn) {
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

export function hideCityCard(returnFocus = true) {
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
    if (isProvinceCardsActive()) return provinceBrightEntitySet().has(entity) ? Cesium.Color.WHITE : dim;
    return Cesium.Color.WHITE;
}

export function refreshMarkerColors() {
    markerEntities.forEach(ent => {
        if (ent && ent.billboard) ent.billboard.color = markerEmphasisColor(ent, focusedMarker);
    });
    cityMarkerEntities.forEach(ent => {
        if (ent && ent.billboard) ent.billboard.color = markerEmphasisColor(ent, focusedMarker);
    });
}

export function setMarkerFocus(entity) {
    if (focusedMarker === entity) return;
    if (focusedMarker && focusedMarker.billboard) focusedMarker.billboard.scale = 1;
    focusedMarker = entity;
    if (entity && entity.billboard) entity.billboard.scale = MARKER_HOVER_SCALE;
    const outlineMat = Cesium.Color.WHITE.withAlpha(entity ? 0.2 : 0.4);
    outlinePolylines().forEach(p => { if (p) p.material = outlineMat; });
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
    const toCamera = Cesium.Cartesian3.subtract(deps.viewer().camera.positionWC, pos, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.dot(normal, toCamera) < 0) {
        hideMarkerTip();
        return;
    }
    const screenPos = pos && Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, pos);
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
    const camera = deps.viewer().camera;
    if (!markerOcclusionDirty &&
        Cesium.Cartesian3.equalsEpsilon(camera.positionWC, occCamPos, Cesium.Math.EPSILON6) &&
        Cesium.Cartesian3.equalsEpsilon(camera.directionWC, occCamDir, Cesium.Math.EPSILON6)) {
        return false;   // 相机与标记都没动：这一帧不需要重算（返回值供标签布局共用）
    }
    Cesium.Cartesian3.clone(camera.positionWC, occCamPos);
    Cesium.Cartesian3.clone(camera.directionWC, occCamDir);
    markerOcclusionDirty = false;
    const mode3D = deps.viewer().scene.mode === Cesium.SceneMode.SCENE3D;
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
    const cityLabelsOn = SHOW_CITY_LABELS && cityMode && deps.boundaryVisible() && deps.cityLabelVisible();
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
            const sp = Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, pos, labelScreen);
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
        collect(markerEntities, MARKER_SIZE, i => (deps.footprints()[i] ? deps.footprints()[i].name : ''), null);
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
// 窗口尺寸变化后标签要重排（视口边界变了，但相机没动，光靠相机变化判定不会触发）
window.addEventListener('resize', () => { markerLabelDirty = true; });

const markerPickHandler = new Cesium.ScreenSpaceEventHandler(deps.viewer().scene.canvas);

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
    const found = findPickedMarker(deps.viewer().scene.pick(screenPos));
    if (!found) return null;
    const ent = found.type === 'footprint' ? markerEntities[found.index] : cityMarkerEntities[found.index];
    const world = ent && ent.position && ent.position.getValue(Cesium.JulianDate.now());
    if (!world) return null;
    const sp = Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, world, markerHitScreen);
    if (!sp) return null;
    const radius = (found.type === 'footprint' ? MARKER_SIZE : CITY_MARKER_SIZE) * MARKER_HIT_SLOP;
    const dx = screenPos.x - sp.x;
    const dy = screenPos.y - sp.y;
    return (dx * dx + dy * dy <= radius * radius) ? found : null;
}

markerPickHandler.setInputAction((movement) => {
    const found = pickMarkerUnderPointer(movement.endPosition);
    // 光标是标记「可点」的第一层暗示（尺寸放大由 setMarkerFocus 负责）
    setHoveredMarker(!!found);
    // 没落在标记上时再看一眼是不是可点击的省份（几何判定，内部节流）
    setHoveredProvince(!found && provinceHoverAt(movement.endPosition));
    applyCanvasCursor();
    // 在同一个标记上滑动不必反复重设气泡：写文本 + 一次坐标换算 + 两次样式写，
    // 单次都很便宜，但指针事件每秒能来上百次。只有「指向的标记变了」才动 DOM。
    const hoverKey = found ? (found.type + ':' + found.index) : '';
    if (hoverKey === hoveredMarkerKey) return;
    hoveredMarkerKey = hoverKey;
    if (found && found.type === 'footprint') {
        showMarkerTip(markerEntities[found.index], footprintTipText(deps.footprints()[found.index]));
    } else if (found && found.type === 'city') {
        const city = cityList[found.index];
        showMarkerTip(cityMarkerEntities[found.index], city.city + ' · ' + city.indices.length + ' 个足迹');
    } else {
        hideMarkerTip();
    }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

// 鼠标离开画布时收起名称气泡
deps.viewer().scene.canvas.addEventListener('mouseleave', () => {
    hideMarkerTip();
    setHoveredMarker(false);
    setHoveredProvince(false);
    applyCanvasCursor();
});

// 点击足迹打开详情卡；点击城市标记显示城市聚合卡；点击空白处关闭
markerPickHandler.setInputAction((movement) => {
    const found = findPickedMarker(deps.viewer().scene.pick(movement.position));
    if (found && found.type === 'footprint') {
        const fp = deps.footprints()[found.index];
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
    if (isPhotoRingViewing()) {
        exitPhotoRingView();
        return;
    }
    hidePhotoRing();
    if (isProvinceCardsActive()) {
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
    if (!isPhotoRingActive()) return false;
    const item = firstVisibleRingItem();
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
    deps.footprints().forEach((fp, i) => {
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
                const ringItem = isPhotoRingActive() ? firstVisibleRingItem() : null;
                if (ringItem) focusWhenVisible(ringItem);
                else document.getElementById('markerCardClose').focus();
            }
        });
        markerFocusLayer.appendChild(btn);
    });
}
// 初始按钮由 applyMarkerMode(true) 在标记构建后生成

// 从足迹详情卡进入“城市图片墙”：实现见 modules/city-view.js。
// 找城市、找 tab、记录关闭后要还原的足迹卡，都在那边统一处理。
const openFootprintAlbum = openCityViewAtFootprint;

markerCardGallery.addEventListener('click', () => {
    if (activeFootprintIndex < 0) return;
    const fp = deps.footprints()[activeFootprintIndex];
    if (fp) openFootprintAlbum(fp, markerCardGallery);
});

/** 当前标记实体（重建后数组会整体替换，所以用取值函数）。 */
export function markerEntityList() {
    return markerEntities;
}

export function cityMarkerEntityList() {
    return cityMarkerEntities;
}

export function cityListSnapshot() {
    return cityList;
}

export function isCityMode() {
    return cityMode;
}

export function isCityFlightActive() {
    return cityFlightActive;
}

export function focusedMarkerEntity() {
    return focusedMarker;
}

export function currentPositionList() {
    return currentPositions;
}

/** 详情卡是否已就绪（标题卡据此决定要不要自动收起卡片）。 */
export function areDetailCardsReady() {
    return detailCardsReady;
}

/** 回到整球视图时收起详情卡（标题卡会与卡片重叠）。 */
export function hideDetailCardsForIntro() {
    if (markerCard.classList.contains('visible')) hideMarkerCard();
    if (cityCard.classList.contains('visible')) hideCityCard(false);
}

/** 初始构建：先按空数据建一次，数据到位后会再重建。 */
export function initMarkers() {
    buildMarkers();
    buildCityMarkers();
    applyMarkerMode(true);   // 初始整球视图：城市聚合
}

/** 清空全部标记实体（重建前调用）。 */
export function removeAllMarkers() {
    markerEntities.forEach(ent => deps.viewer().entities.remove(ent));
}

/** 足迹数据重建后：按当前视角恢复模式并排一次体检。 */
export function rebuildMarkerModeFromCamera() {
    const h = deps.viewer().camera.positionCartographic.height;
    applyMarkerMode(h > CITY_COLLAPSE_HEIGHT);
    pendingMarkerAudit = true;
}

/** 高度阈值驱动的模式切换（updateIntroVisibility 每帧调用）。 */
export function syncMarkerModeByHeight(cameraHeight) {
    if (cityFlightActive) return;
    if (cityMode && cameraHeight < CITY_EXPAND_HEIGHT) {
        applyMarkerMode(false);
    } else if (!cityMode && cameraHeight > CITY_COLLAPSE_HEIGHT) {
        applyMarkerMode(true);
    }
}


/**
 * 绑定与相机帧同步的悬停/标签更新。必须在 setupMarkers 之后调用一次。
 */
export function initMarkersOverlay() {
    deps.viewer().scene.postRender.addEventListener(updateMarkerTipPosition);
    deps.viewer().scene.postRender.addEventListener(updateMarkerOverlays);
}
