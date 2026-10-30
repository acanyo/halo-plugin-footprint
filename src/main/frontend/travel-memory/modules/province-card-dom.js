/**
 * 省份城市卡片的 DOM：单张卡片 + 一条连线（抛物线 + 起点圆点 + 渐变）的建立，
 * 卡片定位，以及每帧按锚点刷新连线几何与省名标注。
 *
 * 从 province-cards.js 拆出。卡片组的开关状态仍归 province-cards.js 管，
 * 这里需要的状态都由调用方以参数传进来（卡片列表、是否打开、被转走时的回调）。
 */

import { SVG_NS } from './env.js';
import { round1, snapDevicePx } from './geometry.js';

export const PROVINCE_CARD_WIDTH = 244;            // 横版卡片默认档（与 CSS .prop-city-card 宽度一致）
export const PROVINCE_CARD_HEIGHT = 96;

// 连线走「地图标注引线」那套画法：一条细线 + 底下压一层很淡的纸色描边（浅色影像上保底）。
// 颜色由 CSS 决定（.prop-leader-stop-from / -to，淡墨到弱墨），这里只建渐变结构。
const PROVINCE_LINE_FAN = [0.10, 0.18];     // 弧度收敛：更像标注引线，不再像数据流
export const PROVINCE_LINE_DOT_R = 3;              // 起点圆点：标注红实心 + 纸色细环
export const PROVINCE_LINE_DOT_R_ACTIVE = 4;

/**
 * 建一张卡片与它的连线节点，分别挂进卡片层与连线 SVG。
 * 卡片保持不可见（不加 .show），等布局算出落点后由入场动画统一放飞。
 *
 * @param view             provinceCardViewModel 的结果
 * @param index            卡片序号（渐变 id 用）
 * @param els              卡片层与连线层：els.layer / els.svg
 * @param defs             连线 SVG 里的 <defs>
 * @param renderCardCover  (media, url, monogram) => 封面加载请求
 */
export function createProvinceCardNodes(view, index, els, defs, renderCardCover) {
    // ---- 卡片本体：封面 + 城市名 + 数量 + 最近到访，没有按钮，整卡可点 ----
    const el = document.createElement('div');
    el.className = 'prop-city-card';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.setAttribute('aria-label', view.name + '，' + view.count + ' 条足迹，进入城市相册');
    el.title = '单击进入相册，双击打开城市卡';
    const media = document.createElement('div');
    media.className = 'prop-card-media';
    // 先只画"首字 + 空图片层"，封面等布局与错峰顺序定了再排队加载：
    // 这样先飞出来的卡片先拿到图（见 activateCityCards 里的 startProvinceCoverLoads）
    const coverRequest = renderCardCover(media, view.cover, view.name ? view.name.charAt(0) : '?');
    // 悬停/聚焦时才浮出来的提示：卡片没有按钮，整卡可点，得让人知道能点、以及双击的层次。
    // 盖在封面区上（左边 40%），那里没有文字，不会挡住城市名/统计/日期。
    const hint = document.createElement('span');
    hint.className = 'prop-card-hint';
    const hintMain = document.createElement('em');
    hintMain.textContent = '点击进入相册';
    const hintSub = document.createElement('small');
    hintSub.textContent = '双击看城市卡';
    hint.appendChild(hintMain);
    hint.appendChild(hintSub);
    media.appendChild(hint);
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
    stats.appendChild(document.createTextNode(' 条足迹，'));
    stats.appendChild(photoBold);
    stats.appendChild(document.createTextNode(' 张照片'));
    const date = document.createElement('p');
    date.className = 'prop-card-date';
    date.textContent = view.latest ? '最近到访 ' + view.latest : '还没有记录时间';
    body.appendChild(title);
    body.appendChild(stats);
    body.appendChild(date);
    el.appendChild(media);
    el.appendChild(body);
    els.layer.appendChild(el);

    // ---- 连线：一条抛物线 + 起点圆点（颜色走每条线自己的渐变，色值见 province-cards.css） ----
    const gradId = 'prop-leader-grad-' + index;
    const grad = document.createElementNS(SVG_NS, 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    ['x1', 'y1', 'x2', 'y2'].forEach(attr => grad.setAttribute(attr, '0'));
    const stopFrom = document.createElementNS(SVG_NS, 'stop');
    stopFrom.setAttribute('offset', '0%');
    stopFrom.setAttribute('class', 'prop-leader-stop-from');
    const stopTo = document.createElementNS(SVG_NS, 'stop');
    stopTo.setAttribute('offset', '100%');
    stopTo.setAttribute('class', 'prop-leader-stop-to');
    grad.appendChild(stopFrom);
    grad.appendChild(stopTo);
    defs.appendChild(grad);

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'prop-leader-group');
    // 纸色描边打底：浅色底图上靠它把线"垫"出来，深色底图上几乎看不见
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

    return { el, group, pathBase, path, dot, grad, coverRequest };
}

// 把卡片放到 item.x / item.y（对齐到设备像素），层级按布局顺序
export function applyProvinceCardBox(item) {
    const el = item.el;
    if (!el) return;
    el.style.transform = 'translate3d(' + snapDevicePx(item.x) + 'px,' + snapDevicePx(item.y) + 'px,0)';
    el.style.zIndex = String(10 + (item.layoutIndex || 0));
}

// ---------- 连线与省名标注 ----------

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

/**
 * 按每张卡片当前的锚点与落点重画连线；转到地球背面的卡片连同连线一起隐藏。
 * @param items     卡片组
 * @param active    卡片组是否打开
 * @param onHidden  (item) => void，某张卡片这一帧被转走时调用（用来还原悬停强调）
 */
export function drawProvinceLeaderLines(items, active, onHidden) {
    if (!items.length) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const viewCenterX = W / 2;
    const viewCenterY = H / 2;
    // 同一条边上的线按顺序递增弧度，形成扇面（每条边各自扇开）
    const edgeTotals = { left: 0, right: 0, top: 0, bottom: 0 };
    const edgeSeen = { left: 0, right: 0, top: 0, bottom: 0 };
    items.forEach(item => {
        edgeTotals[item.edge || 'right'] = (edgeTotals[item.edge || 'right'] || 0) + 1;
    });

    items.forEach(item => {
        const anchor = item.anchor;
        const visible = active && !!anchor;
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
            if (onHidden) onHidden(item);
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

// 省名标注：钉在省份中心的屏幕位置上；中心转到地球背面时收起
const provinceLabelNormal = new Cesium.Cartesian3();
const provinceLabelToCam = new Cesium.Cartesian3();
export function placeProvinceLabel(labelEl, active, text, world, viewer) {
    if (!labelEl) return;
    if (!active || !world) {
        labelEl.classList.remove('show');
        return;
    }
    Cesium.Cartesian3.normalize(world, provinceLabelNormal);
    Cesium.Cartesian3.subtract(viewer.camera.positionWC, world, provinceLabelToCam);
    if (Cesium.Cartesian3.dot(provinceLabelNormal, provinceLabelToCam) < 0) {
        labelEl.classList.remove('show');   // 省份中心转到地球背面
        return;
    }
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, world);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
        labelEl.classList.remove('show');
        return;
    }
    if (labelEl.textContent !== text) labelEl.textContent = text;
    labelEl.style.left = snapDevicePx(screen.x) + 'px';
    labelEl.style.top = snapDevicePx(screen.y - 18) + 'px';
    labelEl.classList.add('show');
}
