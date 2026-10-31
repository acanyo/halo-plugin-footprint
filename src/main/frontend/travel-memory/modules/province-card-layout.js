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

// 「全部城市」沿用未合并上游之前的环带定位：卡片只在四边由外向内分层，
// 外圈占满后才向内补位；每个卡位带固定但不同的错落偏移，不排成规则网格。
const ALL_CITY_RING_DEPTH_LIMIT = 4;
const ALL_CITY_RING_DEPTH_GAP = 18;
const ALL_CITY_RING_JITTER = [0, 18, 7, 29, 12, 24, 4, 34, 16, 27, 10, 31, 21];
const ALL_CITY_RING_GAP_JITTER = [0, 22, 9, 28, 13, 24, 4, 19, 30, 11];
const ALL_CITY_LAYOUT_FALLBACK_GAP = 4;
const ALL_CITY_MARKER_KEEPOUT = 12;
const ALL_CITY_SIDE_INSET_MIN = 24;
const ALL_CITY_SIDE_INSET_RATIO = 0.025;
const ALL_CITY_SAFE_TOP = 56;
const ALL_CITY_SAFE_BOTTOM = 96;

export function provinceSafeArea(W, H) {
    const insetX = provinceSideInset();
    return {
        left: insetX,
        right: Math.max(insetX + 140, W - insetX),
        top: PROVINCE_SAFE_TOP,
        bottom: Math.max(PROVINCE_SAFE_TOP + 200, H - PROVINCE_SAFE_BOTTOM)
    };
}

function allCitySafeArea(W, H) {
    const insetX = Math.max(
        ALL_CITY_SIDE_INSET_MIN,
        Math.round(W * ALL_CITY_SIDE_INSET_RATIO)
    );
    return {
        left: insetX,
        right: Math.max(insetX + 140, W - insetX),
        top: ALL_CITY_SAFE_TOP,
        bottom: Math.max(ALL_CITY_SAFE_TOP + 200, H - ALL_CITY_SAFE_BOTTOM)
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

function allCityRingJitter(item, depth, edgeIndex, salt, values) {
    const seed = (item.layoutIndex || 0) * 7 + depth * 5 + edgeIndex * 3 + salt;
    return values[seed % values.length];
}

function allCitySignedDrift(item, depth, edgeIndex, salt, scale = 0.62) {
    const value = allCityRingJitter(item, depth, edgeIndex, salt, ALL_CITY_RING_JITTER);
    return (value % 2 === 0 ? -1 : 1) * value * scale;
}

function allCityEdgeIndex(edge) {
    return { left: 0, right: 1, top: 2, bottom: 3 }[edge] || 0;
}

function allCityRingTrackValues(item, edge, area, placed, gap, depth, edgeIndex) {
    const vertical = edge === 'left' || edge === 'right';
    const start = vertical ? area.top : area.left;
    const end = vertical ? area.bottom : area.right;
    const size = vertical ? item.h : item.w;
    const anchorCoord = vertical ? item.anchor.y : item.anchor.x;
    const maxStart = end - size;
    const values = [];
    const add = value => {
        if (Number.isFinite(value) && value >= start - 0.5 && value <= maxStart + 0.5) {
            values.push(value);
        }
    };
    const edgeJitter = allCityRingJitter(
        item, depth, edgeIndex, 1, ALL_CITY_RING_JITTER
    ) * 0.62;
    add(start + edgeJitter);
    add(maxStart - edgeJitter);
    add(clampNumber(anchorCoord - size / 2, start, maxStart));

    let cursor = start + edgeJitter;
    for (let step = 0; cursor <= maxStart + 0.5 && step < 16; step++) {
        add(cursor);
        const breath = allCityRingJitter(
            item, depth, edgeIndex, step + 3, ALL_CITY_RING_GAP_JITTER
        );
        cursor += size + gap + breath;
    }

    cursor = maxStart - edgeJitter;
    for (let step = 0; cursor >= start - 0.5 && step < 16; step++) {
        add(cursor);
        const breath = allCityRingJitter(
            item, depth, edgeIndex, step + 7, ALL_CITY_RING_GAP_JITTER
        );
        cursor -= size + gap + breath;
    }

    placed.forEach((rect, index) => {
        const cardStart = vertical ? rect.y : rect.x;
        const cardSize = vertical ? rect.h : rect.w;
        const localJitter = allCityRingJitter(
            item, depth, edgeIndex, index + 11, ALL_CITY_RING_JITTER
        ) * 0.28;
        add(cardStart + cardSize + gap + localJitter);
        add(cardStart - size - gap - localJitter);
    });

    values.sort((a, b) => a - b);
    const unique = [];
    values.forEach(value => {
        if (!unique.length || Math.abs(unique[unique.length - 1] - value) > 1) {
            unique.push(value);
        }
    });
    return unique;
}

function allCityRingCandidates(item, area, placed, gap) {
    const candidates = [];
    const edges = [
        { name: 'left', vertical: true },
        { name: 'right', vertical: true },
        { name: 'top', vertical: false },
        { name: 'bottom', vertical: false }
    ];
    edges.forEach((edge, edgeIndex) => {
        const depthPitch = (edge.vertical ? item.w : item.h) +
            gap + ALL_CITY_RING_DEPTH_GAP;
        const along = allCityRingTrackValues(
            item, edge.name, area, placed, gap, 0, edgeIndex
        );
        for (let depth = 0; depth <= ALL_CITY_RING_DEPTH_LIMIT; depth++) {
            const values = depth === 0
                ? along
                : allCityRingTrackValues(
                    item, edge.name, area, placed, gap, depth, edgeIndex
                );
            const depthJitter = allCityRingJitter(
                item, depth, edgeIndex, 2, ALL_CITY_RING_JITTER
            ) * 0.38;
            values.forEach(position => {
                let x;
                let y;
                if (edge.name === 'left') {
                    x = area.left + depth * depthPitch + depthJitter;
                    y = position;
                } else if (edge.name === 'right') {
                    x = area.right - item.w - depth * depthPitch - depthJitter;
                    y = position;
                } else if (edge.name === 'top') {
                    x = position;
                    y = area.top + depth * depthPitch + depthJitter;
                } else {
                    x = position;
                    y = area.bottom - item.h - depth * depthPitch - depthJitter;
                }
                x += allCitySignedDrift(item, depth, edgeIndex, 17);
                y += allCitySignedDrift(item, depth, edgeIndex, 19);
                if (x < area.left - 0.5 || y < area.top - 0.5 ||
                    x + item.w > area.right + 0.5 || y + item.h > area.bottom + 0.5) {
                    return;
                }
                candidates.push({ x, y, depth, edge: edge.name });
            });
        }
    });
    return candidates;
}

function allCityNearestEdge(rect, area) {
    let edge = 'left';
    let distance = rect.x - area.left;
    [
        ['right', area.right - (rect.x + rect.w)],
        ['top', rect.y - area.top],
        ['bottom', area.bottom - (rect.y + rect.h)]
    ].forEach(([name, value]) => {
        if (value < distance) {
            edge = name;
            distance = value;
        }
    });
    return { edge, distance: Math.max(0, distance) };
}

function allCityRectContainsMarker(rect, anchors) {
    return anchors.some(anchor =>
        anchor.x >= rect.x - ALL_CITY_MARKER_KEEPOUT &&
        anchor.x <= rect.x + rect.w + ALL_CITY_MARKER_KEEPOUT &&
        anchor.y >= rect.y - ALL_CITY_MARKER_KEEPOUT &&
        anchor.y <= rect.y + rect.h + ALL_CITY_MARKER_KEEPOUT
    );
}

function allCitySpotCost(rect, item, area, cluster, core, candidate) {
    const edge = allCityNearestEdge(rect, area);
    const markerDistance = Math.hypot(
        rect.x + rect.w / 2 - item.anchor.x,
        rect.y + rect.h / 2 - item.anchor.y
    );
    const areaSize = rect.w * rect.h;
    const clusterRatio = cluster ? overlapArea(rect, cluster) / areaSize : 0;
    const coreRatio = overlapArea(rect, core) / areaSize;
    return candidate.depth * 2600 +
        edge.distance * 1.4 +
        markerDistance * 0.32 +
        clusterRatio * 300 +
        coreRatio * 360;
}

function pickAllCityCardSpot(item, area, spanX, spanY, cluster, placed, gap, anchors) {
    const w = item.w;
    const h = item.h;
    const core = {
        x: area.left + spanX * PROVINCE_CORE_KEEPOUT_X,
        y: area.top + spanY * PROVINCE_CORE_KEEPOUT_Y,
        w: spanX * (1 - PROVINCE_CORE_KEEPOUT_X * 2),
        h: spanY * (1 - PROVINCE_CORE_KEEPOUT_Y * 2)
    };
    const candidates = allCityRingCandidates(item, area, placed, gap);
    const emptyAt = (candidate, gapUsed, avoidMarkers) => {
        const rect = { x: candidate.x, y: candidate.y, w, h };
        if (avoidMarkers && allCityRectContainsMarker(rect, anchors)) return null;
        const padded = {
            x: rect.x - gapUsed,
            y: rect.y - gapUsed,
            w: rect.w + gapUsed * 2,
            h: rect.h + gapUsed * 2
        };
        return placed.some(other => rectsOverlap(padded, other)) ? null : rect;
    };
    const attempts = [
        { gapUsed: gap, avoidMarkers: true },
        { gapUsed: Math.min(gap, ALL_CITY_LAYOUT_FALLBACK_GAP), avoidMarkers: true },
        { gapUsed: 0, avoidMarkers: true },
        { gapUsed: 0, avoidMarkers: false }
    ];
    for (const mode of attempts) {
        let best = null;
        candidates.forEach(candidate => {
            const rect = emptyAt(candidate, mode.gapUsed, mode.avoidMarkers);
            if (!rect) return;
            const edge = allCityNearestEdge(rect, area);
            const cost = allCitySpotCost(rect, item, area, cluster, core, candidate);
            if (!best || cost < best.cost) {
                best = { x: rect.x, y: rect.y, edge: edge.edge, cost };
            }
        });
        if (best) return best;
    }

    let leastOverlap = null;
    let leastOverlapArea = Infinity;
    candidates.forEach(candidate => {
        const rect = { x: candidate.x, y: candidate.y, w, h };
        const overlapSum = placed.reduce((sum, other) => sum + overlapArea(rect, other), 0);
        if (overlapSum < leastOverlapArea) {
            leastOverlapArea = overlapSum;
            const edge = allCityNearestEdge(rect, area);
            leastOverlap = { x: rect.x, y: rect.y, edge: edge.edge, cost: Infinity };
        }
    });
    return leastOverlap || {
        x: area.left,
        y: area.top,
        edge: 'left',
        cost: Infinity
    };
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
function allCityRingSlotTrack(start, end, size, gap, seed) {
    const length = end - start;
    const count = Math.max(1, Math.floor((length + gap) / (size + gap)));
    if (count === 1) return [start];
    const minSpan = count * size + (count - 1) * gap;
    const slack = Math.max(0, length - minSpan);
    const startOffset = Math.min(
        slack * 0.35,
        ALL_CITY_RING_JITTER[seed % ALL_CITY_RING_JITTER.length] * 0.65
    );
    let remaining = Math.max(0, slack - startOffset);
    const weights = [];
    for (let i = 0; i < count - 1; i++) {
        weights.push(1 + ALL_CITY_RING_GAP_JITTER[
            (seed + i * 3) % ALL_CITY_RING_GAP_JITTER.length
        ]);
    }
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    const extras = weights.map(value => Math.floor(remaining * value / weightSum));
    let extraLeft = remaining - extras.reduce((sum, value) => sum + value, 0);
    for (let i = 0; extraLeft > 0; i = (i + 1) % extras.length) {
        extras[i] += 1;
        extraLeft -= 1;
    }

    const values = [];
    let cursor = start + startOffset;
    for (let step = 0; step < count; step++) {
        values.push(cursor);
        cursor += size + gap + (extras[step] || 0);
    }
    return values;
}

function reflowAllCityRingLayout(area, items, lockedRects, gap, anchors) {
    if (!items.length) return null;
    const maxW = Math.max(...items.map(item => item.w));
    const maxH = Math.max(...items.map(item => item.h));
    const edges = [
        { name: 'left', vertical: true },
        { name: 'right', vertical: true },
        { name: 'top', vertical: false },
        { name: 'bottom', vertical: false }
    ];
    const slots = [];
    edges.forEach((edge, edgeIndex) => {
        const size = edge.vertical ? maxH : maxW;
        const start = edge.vertical ? area.top : area.left;
        const end = edge.vertical ? area.bottom : area.right;
        const depthPitch = (edge.vertical ? maxW : maxH) +
            gap + ALL_CITY_RING_DEPTH_GAP;
        for (let depth = 0; depth <= ALL_CITY_RING_DEPTH_LIMIT; depth++) {
            const track = allCityRingSlotTrack(
                start, end, size, gap, edgeIndex * 17 + depth * 7
            );
            track.forEach((position, trackIndex) => {
                const depthJitter = ALL_CITY_RING_JITTER[
                    (edgeIndex * 5 + depth * 3 + trackIndex) % ALL_CITY_RING_JITTER.length
                ] * 0.2;
                let x;
                let y;
                if (edge.name === 'left') {
                    x = area.left + depth * depthPitch + depthJitter;
                    y = position;
                } else if (edge.name === 'right') {
                    x = area.right - maxW - depth * depthPitch - depthJitter;
                    y = position;
                } else if (edge.name === 'top') {
                    x = position;
                    y = area.top + depth * depthPitch + depthJitter;
                } else {
                    x = position;
                    y = area.bottom - maxH - depth * depthPitch - depthJitter;
                }
                if (x < area.left - 0.5 || y < area.top - 0.5 ||
                    x + maxW > area.right + 0.5 || y + maxH > area.bottom + 0.5) {
                    return;
                }
                slots.push({ x, y, w: maxW, h: maxH, depth, edge: edge.name });
            });
        }
    });

    const attempts = [
        { gapUsed: gap, avoidMarkers: true },
        { gapUsed: Math.min(gap, ALL_CITY_LAYOUT_FALLBACK_GAP), avoidMarkers: true },
        { gapUsed: 0, avoidMarkers: true },
        { gapUsed: 0, avoidMarkers: false }
    ];
    const centerX = (area.left + area.right) / 2;
    const centerY = (area.top + area.bottom) / 2;
    slots.forEach(slot => {
        slot.angle = Math.atan2(
            slot.y + slot.h / 2 - centerY,
            slot.x + slot.w / 2 - centerX
        );
    });

    let selected = null;
    for (const mode of attempts) {
        const usable = slots.filter(slot => {
            const cell = {
                x: slot.x - mode.gapUsed,
                y: slot.y - mode.gapUsed,
                w: slot.w + mode.gapUsed * 2,
                h: slot.h + mode.gapUsed * 2
            };
            return !lockedRects.some(rect => rectsOverlap(cell, rect)) &&
                !(mode.avoidMarkers && allCityRectContainsMarker(slot, anchors));
        });
        const orders = [
            (a, b) => a.depth - b.depth || a.angle - b.angle,
            (a, b) => a.depth - b.depth || b.angle - a.angle,
            (a, b) => a.depth - b.depth || a.x - b.x || a.y - b.y,
            (a, b) => a.depth - b.depth || a.y - b.y || a.x - b.x
        ];
        for (const order of orders) {
            const picked = [];
            for (const slot of usable.slice().sort(order)) {
                if (picked.length >= items.length) break;
                const cell = {
                    x: slot.x - mode.gapUsed,
                    y: slot.y - mode.gapUsed,
                    w: slot.w + mode.gapUsed * 2,
                    h: slot.h + mode.gapUsed * 2
                };
                if (!picked.some(other => rectsOverlap(cell, other))) picked.push(slot);
            }
            if (picked.length >= items.length) {
                selected = picked;
                break;
            }
        }
        if (selected) break;
    }
    if (!selected) return null;

    const pairs = [];
    items.forEach(item => {
        selected.forEach(slot => {
            const edgeIndex = allCityEdgeIndex(slot.edge);
            const x = slot.x + (slot.w - item.w) / 2 +
                allCitySignedDrift(item, slot.depth, edgeIndex, 23, 0.34);
            const y = slot.y + (slot.h - item.h) / 2 +
                allCitySignedDrift(item, slot.depth, edgeIndex, 29, 0.34);
            pairs.push({
                item,
                slot,
                x,
                y,
                distance: Math.hypot(
                    x + item.w / 2 - item.anchor.x,
                    y + item.h / 2 - item.anchor.y
                )
            });
        });
    });
    pairs.sort((a, b) => a.distance - b.distance);
    const assigned = new Map();
    const usedSlots = new Set();
    pairs.forEach(pair => {
        if (assigned.has(pair.item) || usedSlots.has(pair.slot)) return;
        assigned.set(pair.item, { x: pair.x, y: pair.y, edge: pair.slot.edge });
        usedSlots.add(pair.slot);
    });
    return assigned.size === items.length ? assigned : null;
}

function arrangeAllCityCards(items, anchorOf, placeCard) {
    const area = allCitySafeArea(window.innerWidth, window.innerHeight);
    const spanX = Math.max(1, area.right - area.left);
    const spanY = Math.max(1, area.bottom - area.top);
    const gap = items.length > PROVINCE_CARD_DENSE_LIMIT ? 8 : PROVINCE_CARD_GAP;
    const active = [];
    items.forEach((item, index) => {
        item.layoutIndex = index;
        item.anchor = anchorOf(item.ci);
        if (item.anchor) active.push(item);
    });
    const cluster = active.length ? markerClusterRect(active) : null;
    const lockedItems = active.filter(item => item.locked);
    const lockedRects = lockedItems.map(item => ({
        x: item.x, y: item.y, w: item.w, h: item.h
    }));
    const placed = lockedRects.slice();
    const unlockedActive = active.filter(item => !item.locked);
    const anchors = active.map(item => item.anchor);
    let needsRingReflow = false;
    unlockedActive
        .slice()
        .sort((a, b) => provinceEdgeAffinity(a, area, spanX, spanY) -
            provinceEdgeAffinity(b, area, spanX, spanY))
        .forEach(item => {
            const spot = pickAllCityCardSpot(
                item, area, spanX, spanY, cluster, placed, gap, anchors
            );
            if (!Number.isFinite(spot.cost)) needsRingReflow = true;
            item.x = spot.x;
            item.y = spot.y;
            item.edge = spot.edge;
            placed.push({ x: spot.x, y: spot.y, w: item.w, h: item.h });
        });

    if (needsRingReflow) {
        const reflowed = reflowAllCityRingLayout(
            area, unlockedActive, lockedRects, gap, anchors
        );
        if (reflowed) {
            reflowed.forEach((spot, item) => {
                item.x = spot.x;
                item.y = spot.y;
                item.edge = spot.edge;
            });
        }
    }
    unlockedActive.forEach(placeCard);
    items.forEach(item => {
        if (!item.anchor) placeCard(item);
    });
}

export function arrangeProvinceCards(items, anchorOf, placeCard, mode = 'province') {
    if (mode === 'all') {
        arrangeAllCityCards(items, anchorOf, placeCard);
        return;
    }
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
