/**
 * 照片环的环形布局。
 *
 * 点足迹标记后，若干张缩略图围绕标记铺开。难点不在画圆，而在**找一个不挡事的朝向**：
 * 环要避开详情卡，又要尽量留在视口内，还不能为了塞进视口把整圈推得太远
 * （推过头标记就跑到照片圈外面去了）。
 *
 * 原实现把这套评分和 DOM 操作混在一起，无法验证。这里抽成纯函数：
 * 输入锚点、障碍物、视口，输出每张图的位置与整体平移量。
 *
 * 设计要点逐条迁自原注释：
 * - 沿整圈按固定步长扫描朝向，不写死「上半圆/左半圆」；
 * - 屏幕边缘和卡片一样是真的障碍物，为塞进视口做的整体平移要计价；
 * - 平移代价**封顶**，否则布局会为了省推距去选更小的降级档，照片无故缩小。
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RingItem {
  width: number;
  height: number;
}

export interface RingLayoutOptions {
  /** 锚点（标记）在视口中的坐标 */
  anchor: { x: number; y: number };
  items: RingItem[];
  viewport: { width: number; height: number };
  /** 需要避开的矩形，通常是详情卡 */
  obstacles?: Rect[];
  /** 环半径下限，实际按位置数自适应撑开 */
  radius?: number;
}

export interface RingPlacement {
  /** 相对视口的中心坐标 */
  x: number;
  y: number;
}

export interface RingLayoutResult {
  placements: RingPlacement[];
  /** 为塞进视口对整圈施加的平移 */
  shift: { x: number; y: number };
  /** 实际采用的半径 */
  radius: number;
  /** 采用的降级档缩放，1 表示未降级 */
  scale: number;
}

/** 扫描步长（度）。5° 是「看不出台阶」与「每帧评估量」的折中。 */
const ARC_STEP_DEG = 5;

/**
 * 缩略图铺开的弧跨度（度）。
 *
 * **不是均分整圈**：均分 360° 时无论怎么旋转，总有一半缩略图落在障碍物那侧，
 * 避让完全失效（实测 5 张里 4 张压在详情卡上）。原实现是把图铺在一段半环上，
 * 再沿整圈扫描这段弧的朝向去找空位——「半环朝向的扫描步长」说的就是这件事。
 */
const ARC_SPAN_DEG = 170;

/** 空间不足时的降级：整体等比缩小 */
const COMPACT_SCALE = 0.82;

/** 平移计价系数 */
const EDGE_PUSH_COST = 0.04;

/**
 * 平移量计价上限。超过这个量之后不再「越推越贵」——
 * 否则布局会为了省推距而去选更小的降级档，表现为照片无故缩小。
 */
const EDGE_SHIFT_LIMIT = 150;

const DEFAULT_RADIUS = 78;
const COMPACT_RADIUS = 66;

function rectOf(center: RingPlacement, item: RingItem): Rect {
  return {
    left: center.x - item.width / 2,
    top: center.y - item.height / 2,
    right: center.x + item.width / 2,
    bottom: center.y + item.height / 2,
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 超出视口的面积 */
function outsideArea(r: Rect, vp: { width: number; height: number }): number {
  const total = (r.right - r.left) * (r.bottom - r.top);
  const inside = overlapArea(r, { left: 0, top: 0, right: vp.width, bottom: vp.height });
  return total - inside;
}

/**
 * 让一组矩形尽量落回视口所需的平移。
 *
 * 必须先求整组的包围盒再整体推。逐个矩形累加 dx 是错的：当一个要右推、
 * 另一个要左推时，后写的会覆盖前面的结论，贴边时平移量算不对。
 */
function shiftToFit(rects: Rect[], vp: { width: number; height: number }) {
  if (!rects.length) return { x: 0, y: 0 };
  const box = rects.reduce(
    (acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  );

  let dx = 0;
  let dy = 0;
  // 比视口还宽/高时推不进去，居中即可，不要来回拉扯
  if (box.right - box.left <= vp.width) {
    if (box.left < 0) dx = -box.left;
    else if (box.right > vp.width) dx = vp.width - box.right;
  }
  if (box.bottom - box.top <= vp.height) {
    if (box.top < 0) dy = -box.top;
    else if (box.bottom > vp.height) dy = vp.height - box.bottom;
  }
  return { x: dx, y: dy };
}

function evaluate(
  startDeg: number,
  radius: number,
  scale: number,
  opts: RingLayoutOptions
): { cost: number; result: RingLayoutResult } {
  const { anchor, items, viewport, obstacles = [] } = opts;
  const n = items.length;
  // 在弧跨度内均分；只有一张时放在弧中点
  const stepDeg = n > 1 ? ARC_SPAN_DEG / (n - 1) : 0;
  const offsetDeg = n > 1 ? 0 : ARC_SPAN_DEG / 2;

  const scaled = items.map((it) => ({ width: it.width * scale, height: it.height * scale }));
  const raw: RingPlacement[] = scaled.map((_, i) => {
    const rad = ((startDeg + offsetDeg + i * stepDeg) * Math.PI) / 180;
    return { x: anchor.x + Math.cos(rad) * radius, y: anchor.y + Math.sin(rad) * radius };
  });

  const rects = raw.map((p, i) => rectOf(p, scaled[i]));
  const shift = shiftToFit(rects, viewport);
  const moved = raw.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y }));
  const movedRects = moved.map((p, i) => rectOf(p, scaled[i]));

  let cost = 0;
  for (const r of movedRects) {
    // 超出视口按面积计价
    cost += outsideArea(r, viewport);
    // 压住障碍物（详情卡）按面积计价
    for (const ob of obstacles) cost += overlapArea(r, ob) * 2;
  }
  // 整体平移计价，封顶
  const shiftLen = Math.min(Math.hypot(shift.x, shift.y), EDGE_SHIFT_LIMIT);
  cost += shiftLen * shiftLen * EDGE_PUSH_COST;
  // 降级档本身有代价，否则总会选最小的
  cost += (1 - scale) * 20000;

  return { cost, result: { placements: moved, shift, radius, scale } };
}

export function layoutRing(opts: RingLayoutOptions): RingLayoutResult {
  const baseRadius = opts.radius ?? DEFAULT_RADIUS;
  // 半径按位置数自适应撑开：张数多时圆周要够长，否则相邻缩略图会叠在一起
  const maxItem = Math.max(...opts.items.map((i) => Math.max(i.width, i.height)), 1);
  // 弧长需容纳所有缩略图：arcLen = radius * spanRad，故 radius ≥ n*maxItem / spanRad
  const spanRad = (ARC_SPAN_DEG * Math.PI) / 180;
  const needed = (opts.items.length * maxItem) / spanRad;

  let best: { cost: number; result: RingLayoutResult } | null = null;
  for (const [radius, scale] of [
    [Math.max(baseRadius, needed), 1],
    [Math.max(COMPACT_RADIUS, needed * COMPACT_SCALE), COMPACT_SCALE],
  ] as const) {
    for (let deg = 0; deg < 360; deg += ARC_STEP_DEG) {
      const candidate = evaluate(deg, radius, scale, opts);
      if (!best || candidate.cost < best.cost) best = candidate;
    }
  }
  return best!.result;
}

/** 照片环仅在桌面宽屏启用：触屏没有悬停语境，窄屏也铺不开 */
export function ringEnabled(width: number, coarsePointer: boolean): boolean {
  return !coarsePointer && width > 820;
}
