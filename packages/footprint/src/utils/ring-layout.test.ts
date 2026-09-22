import { describe, expect, it } from 'vitest';
import { layoutRing, ringEnabled, type Rect } from './ring-layout';

const vp = { width: 1440, height: 900 };
const items = (n: number, w = 160, h = 120) => Array.from({ length: n }, () => ({ width: w, height: h }));

const boundsOf = (r: { placements: { x: number; y: number }[] }, w = 160, h = 120): Rect => ({
  left: Math.min(...r.placements.map((p) => p.x - w / 2)),
  top: Math.min(...r.placements.map((p) => p.y - h / 2)),
  right: Math.max(...r.placements.map((p) => p.x + w / 2)),
  bottom: Math.max(...r.placements.map((p) => p.y + h / 2)),
});

describe('ringEnabled', () => {
  it('触屏一律不启用', () => {
    expect(ringEnabled(1920, true)).toBe(false);
  });
  it('窄屏不启用', () => {
    expect(ringEnabled(800, false)).toBe(false);
  });
  it('桌面宽屏启用', () => {
    expect(ringEnabled(1280, false)).toBe(true);
  });
});

describe('layoutRing', () => {
  it('位置数与传入张数一致', () => {
    const r = layoutRing({ anchor: { x: 720, y: 450 }, items: items(6), viewport: vp });
    expect(r.placements).toHaveLength(6);
  });

  it('视口中央且无障碍时不需要平移', () => {
    const r = layoutRing({ anchor: { x: 720, y: 450 }, items: items(5), viewport: vp });
    expect(Math.hypot(r.shift.x, r.shift.y)).toBeLessThan(1);
  });

  it('所有缩略图都落在视口内', () => {
    const r = layoutRing({ anchor: { x: 720, y: 450 }, items: items(5), viewport: vp });
    const b = boundsOf(r);
    expect(b.left).toBeGreaterThanOrEqual(-1);
    expect(b.top).toBeGreaterThanOrEqual(-1);
    expect(b.right).toBeLessThanOrEqual(vp.width + 1);
    expect(b.bottom).toBeLessThanOrEqual(vp.height + 1);
  });

  it('锚点贴近边缘时缩略图仍全部落在视口内', () => {
    // 注意断言的是结果而非手段：布局可以靠旋转弧朝向解决，也可以靠整体平移。
    // 实测贴左边缘时它会选择把弧转向右侧（shift 为 0），这比平移更优——
    // 断言「必须平移」会把更好的解判成失败。
    const r = layoutRing({ anchor: { x: 60, y: 450 }, items: items(5), viewport: vp });
    const b = boundsOf(r);
    expect(b.left).toBeGreaterThanOrEqual(-1);
    expect(b.right).toBeLessThanOrEqual(vp.width + 1);
  });

  it('平移量不会超过计价上限太多，避免标记跑到照片圈外', () => {
    // 原实现的教训：不封顶时贴边会免费平移两百多像素，标记就落在圈外了
    const r = layoutRing({ anchor: { x: 10, y: 10 }, items: items(5), viewport: vp });
    expect(Math.hypot(r.shift.x, r.shift.y)).toBeLessThan(400);
  });

  it('存在障碍物时环会转到另一侧', () => {
    // 详情卡占住右半屏
    const card: Rect = { left: 760, top: 200, right: 1200, bottom: 700 };
    const withCard = layoutRing({
      anchor: { x: 720, y: 450 },
      items: items(5),
      viewport: vp,
      obstacles: [card],
    });
    // 压在卡片上的缩略图应尽可能少
    const overlapping = withCard.placements.filter(
      (p) => p.x + 80 > card.left && p.x - 80 < card.right && p.y + 60 > card.top && p.y - 60 < card.bottom
    );
    expect(overlapping.length).toBeLessThanOrEqual(2);
  });

  it('张数多时半径会撑开，避免相邻缩略图重叠', () => {
    const few = layoutRing({ anchor: { x: 720, y: 450 }, items: items(3), viewport: vp });
    const many = layoutRing({ anchor: { x: 720, y: 450 }, items: items(12), viewport: vp });
    expect(many.radius).toBeGreaterThan(few.radius);
  });

  it('空间够时不降级', () => {
    const r = layoutRing({ anchor: { x: 720, y: 450 }, items: items(4), viewport: vp });
    expect(r.scale).toBe(1);
  });

  it('单张也能布局，不抛错', () => {
    const r = layoutRing({ anchor: { x: 720, y: 450 }, items: items(1), viewport: vp });
    expect(r.placements).toHaveLength(1);
  });
});
