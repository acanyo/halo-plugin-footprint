/**
 * 2D 路线绘制用的几何与缓动。
 *
 * 迁移自 footprint.js 的连线动画。抽成纯函数后可独立测试——
 * 原实现里这些和 canvas 绘制、requestAnimationFrame 循环混在一个闭包里。
 */

export interface Point {
  x: number;
  y: number;
}

/** 二次贝塞尔曲线上 t∈[0,1] 处的点 */
export function quadraticBezier(t: number, p0: Point, p1: Point, p2: Point): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/** 缓出三次方。动画末段减速，视觉上比线性自然。 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * 两点之间的抛物线控制点。
 *
 * 控制点取中点再沿垂直方向抬起，抬起高度与两点距离成正比——
 * 这样短距离连线是浅弧、长距离是高弧，观感一致。
 *
 * @param lift 抬升系数，0 为直线
 */
export function arcControlPoint(a: Point, b: Point, lift = 0.25): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: mx, y: my };
  // 垂直方向单位向量（逆时针 90°）
  return {
    x: mx + (-dy / len) * len * lift,
    y: my + (dx / len) * len * lift,
  };
}

/** 在曲线上均匀采样若干点，用于逐段描边 */
export function sampleBezier(p0: Point, p1: Point, p2: Point, segments: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    out.push(quadraticBezier(i / segments, p0, p1, p2));
  }
  return out;
}
