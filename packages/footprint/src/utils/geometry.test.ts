import { describe, expect, it } from 'vitest';
import { arcControlPoint, easeOutCubic, quadraticBezier, sampleBezier } from './geometry';

describe('quadraticBezier', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 50, y: 100 };
  const p2 = { x: 100, y: 0 };

  it('t=0 落在起点，t=1 落在终点', () => {
    expect(quadraticBezier(0, p0, p1, p2)).toEqual(p0);
    expect(quadraticBezier(1, p0, p1, p2)).toEqual(p2);
  });

  it('t=0.5 落在标准位置', () => {
    // 二次贝塞尔中点 = (p0 + 2*p1 + p2) / 4
    const m = quadraticBezier(0.5, p0, p1, p2);
    expect(m.x).toBeCloseTo((0 + 2 * 50 + 100) / 4);
    expect(m.y).toBeCloseTo((0 + 2 * 100 + 0) / 4);
  });

  it('三点共线时退化为直线', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 5, y: 5 };
    const c = { x: 10, y: 10 };
    const m = quadraticBezier(0.5, a, b, c);
    expect(m.x).toBeCloseTo(5);
    expect(m.y).toBeCloseTo(5);
  });
});

describe('easeOutCubic', () => {
  it('端点为 0 和 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('前段快后段慢', () => {
    // 缓出：前半程走过的比例应大于一半
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('单调递增', () => {
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.1) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('arcControlPoint', () => {
  it('lift=0 时控制点即中点，曲线退化为直线', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const c = arcControlPoint(a, b, 0);
    expect(c).toEqual({ x: 50, y: 0 });
  });

  it('抬升高度与两点距离成正比', () => {
    const short = arcControlPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.25);
    const long = arcControlPoint({ x: 0, y: 0 }, { x: 400, y: 0 }, 0.25);
    expect(Math.abs(long.y)).toBeCloseTo(Math.abs(short.y) * 4);
  });

  it('两点重合时返回该点，不产生 NaN', () => {
    const c = arcControlPoint({ x: 7, y: 7 }, { x: 7, y: 7 });
    expect(c).toEqual({ x: 7, y: 7 });
    expect(Number.isNaN(c.x)).toBe(false);
  });
});

describe('sampleBezier', () => {
  it('采样点数为 segments + 1，含首尾', () => {
    const pts = sampleBezier({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, 8);
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[8]).toEqual({ x: 10, y: 0 });
  });
});
