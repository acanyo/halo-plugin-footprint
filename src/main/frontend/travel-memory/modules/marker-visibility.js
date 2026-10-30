/**
 * 标记的屏幕空间处理：背面遮挡（越过地平线即隐藏）与常驻地名的标签避让。
 *
 * 从 markers.js 拆出。两件事都是 postRender 每帧入口里调用的纯布局：
 * 标记实体与模式由 markers.js 以参数传入，本模块只持有标签布局自己的缓存。
 */

import { MARKER_SIZE, CITY_MARKER_SIZE } from './marker-icons.js';

// 地名标签的布局状态：buildMarkers / buildCityMarkers 重建标记时一起清（见 resetMarkerLabelLayout）
const labelLayoutState = new Map();       // ent -> { show, x, y }，避免重复写 Cesium 属性
const slotBlockRects = [];                // 本帧已占用的矩形（标记 + 已放下的标签），逐帧清空复用
const labelScreen = new Cesium.Cartesian2();

// ================= 常驻地名（标注层） =================
// 底图选「无字」时画面上没有任何地名，只靠悬停显示名称：触屏根本没有 hover，
// 桌面上也要逐个去碰运气。这里给已有的标记实体挂一个 label ——
// 实体本身已经处理好了「模式切换 / 转到背面隐藏」，标签跟着实体走即可，
// 既不新增实体，也不影响点击拾取。层级与标记一致：聚合态标城市，展开态标足迹。
// 标注模式（off / city / all）：setupMarkers 时按后台配置赋值（见 setGlobeLabelMode）
let globeLabelMode = 'all';

/** 地名标注模式由后台配置决定；setupMarkers 注入后调用一次。 */
export function setGlobeLabelMode(mode) {
    globeLabelMode = mode;
}

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

/**
 * 预热地名用到的字形。
 *
 * Cesium 的标签按「单个字」栅格化并缓存（每个字一次 canvas 绘制 + getImageData + 距离场计算），
 * 缓存挂在标签集合上，第一次真正显示某个字时才做。地名里几乎全是汉字、互不重复，
 * 实测第一次飞到展开层级时一帧里要栅格化约 200 个字形，主线程多出一百多毫秒——
 * 就是「飞下去时顿一下」。这里在地球铺完瓦片后的空闲时间里，用一个藏在地球背面、
 * 透明度为 0 的临时标签把所有地名的字过一遍：字形进了缓存，之后显示就只是排版。
 * 分批做，每批一帧，不和首屏抢时间。
 *
 * @param viewer  Cesium.Viewer
 * @param texts   要预热的文本（地名 / 足迹名）
 */
export function prewarmLabelGlyphs(viewer, texts) {
    const chars = [...new Set(texts.join(''))].filter(ch => ch.trim());
    if (!chars.length) return;
    const BATCH = 40;   // 一帧栅格化的字数，约 20ms
    const ghost = viewer.entities.add({
        // 放在地球中心：永远在相机看不见的位置，也不会挡住拾取
        position: Cesium.Cartesian3.ZERO,
        label: {
            text: '',
            font: LABEL_FONT,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.TRANSPARENT,
            outlineColor: Cesium.Color.TRANSPARENT,
            outlineWidth: 2.5,
            // 字形缓存的键 = 字 + 字体 + 竖直对齐，必须和真实标签（markerLabelGraphics）一致
            verticalOrigin: Cesium.VerticalOrigin.TOP
        }
    });
    let i = 0;
    const step = () => {
        if (i >= chars.length) {
            viewer.entities.remove(ghost);
            return;
        }
        ghost.label.text = chars.slice(i, i + BATCH).join('');
        i += BATCH;
        const next = () => requestAnimationFrame(step);
        if ('requestIdleCallback' in window) window.requestIdleCallback(next, { timeout: 500 });
        else setTimeout(next, 16);
    };
    step();
}

export function markerLabelGraphics(text, markerSize) {
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

/** 标记整批重建时清空标签状态缓存（缓存以实体为键，旧实体已经没用了）。 */
export function resetMarkerLabelLayout() {
    labelLayoutState.clear();
}

/** 单个实体被替换时（自愈重建）丢掉它的缓存。 */
export function forgetMarkerLabel(ent) {
    labelLayoutState.delete(ent);
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
/**
 * @param force          标记位置 / 模式变过（markers.js 的 markerOcclusionDirty）：即使相机没动也要重算
 * @param viewer         () => Cesium.Viewer
 * @param cityMode       当前是否城市聚合态
 * @param cityEntities   城市标记实体
 * @param markerEntities 足迹标记实体
 * @returns 是否重算了（相机动过或被强制）；标签布局据此决定要不要重排
 */
export function updateMarkerOcclusion(force, viewer, cityMode, cityEntities, markerEntities) {
    const camera = viewer().camera;
    if (!force &&
        Cesium.Cartesian3.equalsEpsilon(camera.positionWC, occCamPos, Cesium.Math.EPSILON6) &&
        Cesium.Cartesian3.equalsEpsilon(camera.directionWC, occCamDir, Cesium.Math.EPSILON6)) {
        return false;   // 相机与标记都没动：这一帧不需要重算（返回值供标签布局共用）
    }
    Cesium.Cartesian3.clone(camera.positionWC, occCamPos);
    Cesium.Cartesian3.clone(camera.directionWC, occCamDir);
    const mode3D = viewer().scene.mode === Cesium.SceneMode.SCENE3D;
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
    cityEntities.forEach(ent => setVisible(ent, cityMode));
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
/**
 * 一次标签避让布局。
 * @param ctx.viewer / ctx.footprints / ctx.boundaryVisible / ctx.cityLabelVisible  取值函数
 * @param ctx.cityMode / ctx.cityEntities / ctx.markerEntities / ctx.cityList       当前标记状态
 */
export function layoutMarkerLabels(ctx) {
    const { viewer, footprints, boundaryVisible, cityLabelVisible, cityMode, cityEntities, markerEntities, cityList } = ctx;
    if (globeLabelMode === 'off') return;
    // 谁该有标签：城市名只在「聚合态 + 自动显示中国轮廓」的层级出现
    // （整球视图画面保持干净），足迹名只在展开态出现。
    // 这里也是唯一"收回"标签的地方：条件不满足就把对应的标签全部收掉——
    // 缩放回整球时轮廓先在 updateIntroVisibility 里收起，接着由这里收名字。
    const cityLabelsOn = globeLabelMode !== 'off' && cityMode && boundaryVisible() && cityLabelVisible();
    const footprintLabelsOn = globeLabelMode === 'all' && !cityMode;
    if (!cityLabelsOn) cityEntities.forEach(hideEntityLabel);
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
            const sp = Cesium.SceneTransforms.worldToWindowCoordinates(viewer().scene, pos, labelScreen);
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
        collect(cityEntities, CITY_MARKER_SIZE,
            i => (cityList[i] ? cityList[i].city : ''),
            i => (cityList[i] && cityList[i].indices ? cityList[i].indices.length : 1));
    } else if (footprintLabelsOn) {
        collect(markerEntities, MARKER_SIZE, i => (footprints()[i] ? footprints()[i].name : ''), null);
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
