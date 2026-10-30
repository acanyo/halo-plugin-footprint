/**
 * 标记的指针交互：悬停显示名称（只认圆点本身）、点击打开详情卡 / 照片环 / 省份卡片、点空白逐级退。
 *
 * 从 markers.js 拆出。标记实体与悬停气泡仍归 markers.js，卡片归 marker-detail-card.js；
 * 本模块只把 Cesium 的拾取事件翻译成对它们的调用。
 */

import {
    hidePhotoRing,
    showPhotoRing,
    photoRingIsOpenFor,
    isPhotoRingViewing,
    exitPhotoRingView
} from './photo-ring.js';
import {
    isProvinceCardsActive,
    closeProvinceCards,
    setHoveredProvince,
    provinceHoverAt,
    provincePickingEnabled,
    provinceAtScreenPoint,
    openProvinceCards
} from './province-cards.js';
import { applyCanvasCursor, setHoveredMarker } from './auto-rotate.js';
import { MARKER_SIZE, CITY_MARKER_SIZE } from './marker-icons.js';
import {
    markerEntityList,
    cityMarkerEntityList,
    cityListSnapshot,
    showMarkerTip,
    hideMarkerTip,
    claimHoveredMarkerKey,
    footprintTipText
} from './markers.js';
import {
    markerCard,
    cityCard,
    showMarkerCard,
    hideMarkerCard,
    showCityCard,
    hideCityCard
} from './marker-detail-card.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints               () => Footprint[]
 * @param d.viewer                   () => Cesium.Viewer
 */
export function setupMarkerInput(d) {
    deps = d;
}

// 悬停命中半径系数：覆盖到标记图块，但够不到紧挨着的标签文字
// （文字距圆心的距离是 图块半径×0.42 + 间隙，这里取 0.55 留出安全余量）
const MARKER_HIT_SLOP = 0.55;

// 拾取处理器：模块顶层不能碰 viewer（deps 尚未注入），initMarkersInput 时创建
let markerPickHandler = null;

// 判断拾取到的是单个足迹还是城市标记
function findPickedMarker(picked) {
    if (!picked || !picked.id) return null;
    const fi = markerEntityList().indexOf(picked.id);
    if (fi >= 0) return { type: 'footprint', index: fi };
    const ci = cityMarkerEntityList().indexOf(picked.id);
    if (ci >= 0) return { type: 'city', index: ci };
    return null;
}

// 悬停：足迹显示名称，城市显示「城市 · N 个足迹」
//
// 不用 scene.pick：它每次都要额外渲染一遍拾取帧再同步 readPixels，GPU 管线会停下来等。
// 鼠标移动事件一秒能来上百次，拖动地球时尤其密集——实测拖拽期间主线程有 4.5 秒耗在这里，
// 掉帧主要就是它。改成屏幕空间命中：把当前可见的标记投影到屏幕，取离指针最近、且落在
// 圆点半径内的那个。只认「圆点本身」这条规则不变（文字排在圆点之外，不会被算进来）；
// 点击仍走 scene.pick，点文字也算点中，且一次点击只拾取一次，不影响帧率。
const markerHitScreen = new Cesium.Cartesian2();
function nearestMarkerInList(list, type, screenPos, now, size, best) {
    const scene = deps.viewer().scene;
    for (let i = 0; i < list.length; i++) {
        const ent = list[i];
        // 隐藏的（转到背面 / 不属于当前层级）与入场动画里还没长出来的都不算
        if (!ent || ent.show === false || !ent.billboard) continue;
        const width = ent.billboard.width && ent.billboard.width.getValue(now);
        if (!(width > 0)) continue;
        const world = ent.position && ent.position.getValue(now);
        if (!world) continue;
        const sp = Cesium.SceneTransforms.worldToWindowCoordinates(scene, world, markerHitScreen);
        if (!sp) continue;
        const radius = size * MARKER_HIT_SLOP;
        const dx = screenPos.x - sp.x;
        const dy = screenPos.y - sp.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= radius * radius && d2 < best.d2) {
            best.d2 = d2;
            best.found = { type, index: i };
        }
    }
}
function pickMarkerUnderPointer(screenPos) {
    const now = Cesium.JulianDate.now();
    const best = { d2: Infinity, found: null };
    nearestMarkerInList(markerEntityList(), 'footprint', screenPos, now, MARKER_SIZE, best);
    nearestMarkerInList(cityMarkerEntityList(), 'city', screenPos, now, CITY_MARKER_SIZE, best);
    return best.found;
}

/**
 * 绑定标记拾取与悬停交互。必须在 setupMarkers 之后调用一次。
 */
export function initMarkersInput() {
    markerPickHandler = new Cesium.ScreenSpaceEventHandler(deps.viewer().scene.canvas);
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
        if (!claimHoveredMarkerKey(hoverKey)) return;
        if (found && found.type === 'footprint') {
            showMarkerTip(markerEntityList()[found.index], footprintTipText(deps.footprints()[found.index]));
        } else if (found && found.type === 'city') {
            const city = cityListSnapshot()[found.index];
            showMarkerTip(cityMarkerEntityList()[found.index], city.city + '，' + city.indices.length + ' 条足迹');
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
            const info = provinceAtScreenPoint(movement.position, true);
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
}
