/**
 * 省份城市卡片的沿边布局算法：就近边优先（上下左右都能放）+ 沿边错开 + 互相避让。
 *
 * 从 province-cards.js 拆出。这里只做计算：输入卡片的锚点与尺寸、可用区、
 * 已占位矩形，输出落点；不读写卡片组状态。真正写 DOM 的那一步由调用方以 placeCard 传入。
 */

import { clampNumber, overlapArea } from './geometry.js';

// 超过这个数量只压缩「同侧间距」，卡片尺寸保持不变 ——
// 同一个城市无论从省份进来还是从「全部城市」进来，都必须长得一模一样。
const PROVINCE_CARD_DENSE_LIMIT = 6;
const PROVINCE_CARD_GAP = 12;               // 同侧卡片最小间距（紧凑档减半）
// 同一条边上卡片的阶梯缩进：四档循环，避免排成一条笔直的队列
const PROVINCE_CARD_STAGGER = [0, 18, 36, 54];
const PROVINCE_SAFE_TOP = 88;               // 顶部导航 64 + 留白
const PROVINCE_SAFE_BOTTOM = 96;            // 底部留白
// 自动排版时离屏幕左右边缘的距离：不贴边，随视口宽度加大
const PROVINCE_SIDE_INSET_MIN = 76;
const PROVINCE_SIDE_INSET_RATIO = 0.07;

// 卡片列到左右边缘的留白：不贴着屏幕边，宽屏再多让一点
function provinceSideInset() {
    return Math.max(PROVINCE_SIDE_INSET_MIN, Math.round(window.innerWidth * PROVINCE_SIDE_INSET_RATIO));
}

// ---------- 布局：就近边优先（上下左右都能放）+ 沿边错开 + 互相避让 ----------

// 坐标对齐到「设备像素」而不是 CSS 像素：
// 显示器开了 125% / 150% 缩放时（devicePixelRatio = 1.25 / 1.5），
// 整数 CSS 像素映射过去仍是小数设备像素，落在半格上的卡片文字就是糊的。
// 对齐后每张卡都落在整格上，文字栅格化才稳定清晰。

const PROVINCE_EDGES = ['left', 'right', 'top', 'bottom'];
const PROVINCE_EDGE_SIDE_BIAS = 0.05;   // 上下与左右同样近时优先左右（沿用原来的观感）
const PROVINCE_LAYOUT_STEPS = 12;       // 沿边搜索的最大步数
const PROVINCE_CLUSTER_PAD = 26;        // 标记簇包围盒的外扩，卡片尽量别压住标记群
// 「中央留空区」：可用区中间按这两比例留出一块不放卡片的地方 ——
// 卡片只贴四边，别漂在地球中央（那里是标记群、省名标注和视觉重心）。
// 真排不下时宁可叠在边上，也不会摆进这块区域。
const PROVINCE_CORE_KEEPOUT_X = 0.26;
const PROVINCE_CORE_KEEPOUT_Y = 0.22;

export function provinceSafeArea(W, H) {
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

export function markerClusterRect(items) {
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
export function provinceEdgeAffinity(item, area, spanX, spanY) {
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
export function pickProvinceCardSpot(item, area, spanX, spanY, cluster, placed, gap) {
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

/**
 * 一次完整排版：刷新每张卡的锚点，再按「最贴边先排」逐张挑落点并放上去。
 * 拖拽过（locked）的卡片保持原位，只当障碍；转到地球背面的卡片保持原位。
 * @param items     卡片组（直接改 item.anchor / x / y / edge / layoutIndex）
 * @param anchorOf  (ci) => 标记屏幕坐标 | null
 * @param placeCard (item) => void，把卡片放到 item.x / item.y
 */
export function arrangeProvinceCards(items, anchorOf, placeCard) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const area = provinceSafeArea(W, H);
    const spanX = Math.max(1, area.right - area.left);
    const spanY = Math.max(1, area.bottom - area.top);
    // 卡片多时只把同侧间距收紧一点（12 → 8），卡片本身尺寸不变；
    // 再密就交给"就近边外扩 → 网格兜底 → 堆叠"这套机制。
    const gap = items.length > PROVINCE_CARD_DENSE_LIMIT ? 8 : PROVINCE_CARD_GAP;

    // 1) 锚点：每张卡跟着自己那座城市的标记
    const active = [];
    items.forEach((item, index) => {
        item.layoutIndex = index;
        item.anchor = anchorOf(item.ci);
        if (item.anchor) active.push(item);
    });

    // 2) 标记群包围盒 + 已经拖拽定位的卡片（它们位置固定，先占位当障碍）
    const cluster = active.length ? markerClusterRect(active) : null;
    const placed = [];
    items.forEach(item => {
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
            placeCard(item);
        });

    // 4) 转到地球背面（没有屏幕坐标）的卡片保持原位，只由连线层负责淡出
    items.forEach(item => {
        if (!item.anchor) placeCard(item);
    });
}
