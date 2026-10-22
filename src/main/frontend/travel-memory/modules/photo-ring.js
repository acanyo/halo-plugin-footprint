/**
 * 照片环：点足迹标记后围绕标记铺开的多图预览。
 *
 * 设计要点：
 * - 不取代足迹卡（卡片照旧从右侧滑入），环另外浮在标记周围；
 * - 整圈 360° 径向排布，固定 5 张，第 6 个角度位是「全部 N 张 ›」；
 * - 点某张 → 原地放大成窗口化查看器（不全屏），←/→ 切换、点大图或 Esc 退回；
 * - 点空白 = 一次全关；Esc = 逐级（查看模式 → 环 → 卡片）。
 *
 * 布局算法（环形排布/避让/装盒）见 modules/geometry.js，这里只负责状态与 DOM。
 *
 * 依赖注入：viewer / 足迹卡 / 标记层等由主文件注入；所有会变的足迹数据
 * 走取值函数，不缓存快照。
 */

import { COARSE_POINTER, SVG_NS } from './env.js';
import {
    clampNumber,
    round1,
    snapDevicePx,
    ringSampleIndexes,
    fitBox,
    offsetCenteredRects,
    rectsBBox,
    totalOverlapArea,
    pushVector,
    angleGap
} from './geometry.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.viewer                 () => Cesium.Viewer
 * @param d.markerCard             () => HTMLElement
 * @param d.markerFocusLayer       () => HTMLElement
 * @param d.reduceMotion           () => boolean
 * @param d.cityWallImages         (fp) => [{url, caption}]
 * @param d.loadCardCoverImage     (url) => Promise
 * @param d.markerScreenPosition   (index) => {x, y} | null
 * @param d.cardLayoutRect         (card) => {left, top, width, height} | null
 * @param d.pauseAutoRotate / d.resumeAutoRotate  (reason) => void
 */
export function setupPhotoRing(d) {
    deps = d;
}

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
export function focusWhenVisible(el, tries) {
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

function photoRingImages() {
    return photoRingFp ? deps.cityWallImages(photoRingFp) : [];
}

// 足迹卡在屏幕上**真实**占据的矩形（把卡片当障碍物，避免环钻到卡片底下）。
// 必须用 getBoundingClientRect()：静止态的足迹卡是 `top: 50% + transform: translateY(-50%)`，
// 而 deps.cardLayoutRect() 刻意只按定位属性推算（不读 transform），算出来的盒子比真实卡片
// **低了半张卡高（约 235px）**。避让按那个盒子走，就会出现两种怪相：
// 标记在卡片上方时以为"没压住"而铺整圈（圆的下半被卡片压住）、
// 标记转到卡片后面时按"抬高"去躲（固定成上半圆，右侧照片仍被卡片压住）。
function photoRingCardRect() {
    if (!deps.markerCard() || !deps.markerCard().classList.contains('visible')) return null;
    const rect = deps.markerCard().getBoundingClientRect();
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
    const anchor = deps.markerScreenPosition(photoRingIndex);
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
    deps.loadCardCoverImage(url, (ok, natural) => {
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


// 环被卡片压住的面积：**逐张**算，不按包围盒 —— 半环是"弧"，包围盒的四角是空的，
// 按包围盒判重叠会把"照片其实没碰到卡片"也算成压住，逼着整环离开标记。

// 清掉重叠所需的最小平移：四个方向各算一次，取位移最小的那个方向。
// 同样只按"真的压住的照片"算，而不是按包围盒（否则会被空角落带着挪很远）。

// 两个朝向之间的夹角（0~π），用于"贴着上一帧朝向"的连续性偏好

// 环形布局：{整圈 / 半环} × {5 张 / 减量 3 张} × 2 档尺寸 × 朝向，
// 取"不压卡片、不出界"的最优解；降级档在 cost 里带小惩罚，所以正常情况下就是整圈 5 张。
//
// 半环的朝向**不写死成上下左右**：沿整圈按 PHOTO_RING_ARC_STEP_DEG 扫一遍，
// 让弧线自己去找空位 —— 拖动地球让标记绕到卡片另一侧时，弧会跟着转过去，
// 而不是固定成"上半圆/左半圆"（用户反馈的就是这个）。
// 按图片实际宽高比等比装进一个盒子（保持比例；只在极端竖图/全景图时被上下限夹一下）

// 某个槽位该渲染多大：按它自己那张图的原始宽高比；图片还没到手就用占位尺寸
function photoRingSlotSize(slot) {
    const els = photoRingElements();
    const el = els && els.items[slot];
    const natW = el ? Number(el.dataset.natW) || 0 : 0;
    const natH = el ? Number(el.dataset.natH) || 0 : 0;
    if (!natW || !natH) return { w: PHOTO_RING_PLACEHOLDER_W, h: PHOTO_RING_PLACEHOLDER_H };
    return fitBox(natW, natH,
        PHOTO_RING_MAX_W, PHOTO_RING_MAX_H, PHOTO_RING_MIN_W, PHOTO_RING_MIN_H);
}

// 查看模式大图的尺寸：同一套"按实际宽高比装进盒子"的规则，盒子更大
function photoRingViewerBoxOf(el) {
    const natW = el ? Number(el.dataset.natW) || 0 : 0;
    const natH = el ? Number(el.dataset.natH) || 0 : 0;
    if (!natW || !natH) return { w: PHOTO_RING_VIEW_MAX_W, h: Math.round(PHOTO_RING_VIEW_MAX_H * 0.75) };
    return fitBox(natW, natH, PHOTO_RING_VIEW_MAX_W, PHOTO_RING_VIEW_MAX_H, 0, 0);
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
                const boxStart = rectsBBox(offsetCenteredRects(entries, 0, 0));
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
                    const push = pushVector(offsetCenteredRects(entries, dx, dy), card);
                    if (push.dist > 0) {
                        const capped = Math.min(push.dist, PHOTO_RING_MAX_PUSH);
                        dx += push.dx / push.dist * capped;
                        dy += push.dy / push.dist * capped;
                    }
                    const boxPush = rectsBBox(offsetCenteredRects(entries, dx, dy));
                    if (boxPush.maxX - boxPush.minX <= W - pad * 2) {
                        dx = clampNumber(dx, pad - boxPush.minX, W - pad - boxPush.maxX);
                    }
                    if (boxPush.maxY - boxPush.minY <= H - pad * 2) {
                        dy = clampNumber(dy, pad - boxPush.minY, H - pad - boxPush.maxY);
                    }
                }
                const rects = offsetCenteredRects(entries, dx, dy);
                const box = rectsBBox(rects);
                const overflow = Math.max(0, pad - box.minX) + Math.max(0, box.maxX - (W - pad)) +
                    Math.max(0, pad - box.minY) + Math.max(0, box.maxY - (H - pad));
                const overlap = totalOverlapArea(rects, card);
                // 推距要计价（0.12/px）：否则"整圈硬推"因为降级惩罚更低，会一直赢过"半环绕行"，
                // 表现就是环被整体推走、不再围绕标记。现在 40px 推距 ≈ 4.8 分，已经比"半环"的 3 分
                // 更贵 —— 能半环就半环；只有当半环也压住卡片时，才用更长的推距去换"照片不被挡住"。
                // 朝向连续性只给很轻的权重（0.4 × 夹角）：只在"同样干净"的朝向之间做取舍。
                const pushUsed = Math.hypot(dx - dxBeforePush, dy - dyBeforePush);
                const edgePushUsed = Math.min(Math.hypot(dxBeforePush, dyBeforePush), PHOTO_RING_EDGE_SHIFT_LIMIT);
                const cost = overlap * 2 + overflow * 40 + (variant.compact ? 1 : 0) +
                    (mode.half ? 3 : 0) + (mode.reduced ? 6 : 0) + pushUsed * 0.12 +
                    edgePushUsed * PHOTO_RING_EDGE_PUSH_COST +
                    angleGap(base, preferred) * 0.4;
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
    const anchor = deps.markerScreenPosition(photoRingIndex);
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
    const camera = deps.viewer().camera;
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
    const anchor = deps.markerScreenPosition(photoRingIndex);
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

export function showPhotoRing(fp, index, triggerBtn) {
    if (!photoRingEnabled() || !fp) return false;
    const images = deps.cityWallImages(fp);
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

    const anchor = deps.markerScreenPosition(index) ||
        { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    layoutPhotoRing(anchor);
    const total = photoRingSlots.length;
    photoRingEntranceUntil = deps.reduceMotion() ? 0 : performance.now() + PHOTO_RING_FLY_MS + total * PHOTO_RING_STAGGER_MS + 60;
    if (!deps.reduceMotion()) startPhotoRingEntrance(anchor);
    // 键盘开卡 → 关卡的焦点还原可能把焦点留在屏幕外的标记按钮上。环一打开就把它接进环里：
    // 否则之后按 ←/→ 这类按键会让那个按钮以 :focus-visible 的形态弹到左下角、盖在照片上。
    if (deps.markerFocusLayer().contains(document.activeElement)) {
        const firstItem = els.items.find(item => !item.classList.contains('is-slot-hidden'));
        if (firstItem) focusWhenVisible(firstItem);
    }
    deps.pauseAutoRotate('photo-ring');
    return true;
}

export function hidePhotoRing(returnFocus) {
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
    deps.resumeAutoRotate('photo-ring');
    const trigger = photoRingTriggerBtn;
    photoRingTriggerBtn = null;
    if (returnFocus && trigger && trigger.isConnected) trigger.focus();
}

// 同一标记再点一次 = 收起（环 + 卡片由调用方一起收）
export function photoRingIsOpenFor(fp) {
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

export function exitPhotoRingView() {
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
    const anchor = deps.markerScreenPosition(photoRingIndex);
    if (anchor) layoutPhotoRing(anchor);
    // 键盘焦点跟着回到环上：优先回到当前这张对应的槽位
    if (hadFocus && els) {
        const slot = photoRingSlots.indexOf(photoRingViewIndex);
        const back = (slot >= 0 && els.items[slot])
            || els.items.find(item => !item.classList.contains('is-slot-hidden'));
        if (back) back.focus();
    }
}

export function switchPhotoRingView(delta) {
    const images = photoRingImages();
    if (!photoRingViewing || images.length < 2) return;
    photoRingViewIndex = (photoRingViewIndex + delta + images.length) % images.length;
    renderPhotoRingViewImage();
}

/** 环是否展开（主文件的 Esc / 点击空白等逐级退逻辑要读）。 */
export function isPhotoRingActive() {
    return photoRingActive;
}

/** 是否处在「查看模式」（放大看某一张）。 */
export function isPhotoRingViewing() {
    return photoRingViewing;
}

/** 环上第一张可见缩略图；键盘焦点归还时用。 */
export function firstVisibleRingItem() {
    return photoRingEls && photoRingEls.items.length
        ? photoRingEls.items.find(el => !el.classList.contains('is-slot-hidden')) || null
        : null;
}



/**
 * 绑定与相机帧同步的更新回调。必须在 setupPhotoRing 之后调用一次。
 */
export function initPhotoRing() {
    deps.viewer().scene.postRender.addEventListener(updatePhotoRingPosition);
}
