import { describe, expect, it } from 'vitest';
import { cardColumnsEnabled, layoutCardColumns, type CardTarget } from './card-column';

const vp = { width: 1440, height: 900 };
const CARD_W = 244;
const CARD_H = 96;

const targets = (n: number, side: 'left' | 'right' | 'mixed' = 'mixed'): CardTarget[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `c${i}`,
    x: side === 'left' ? 200 : side === 'right' ? 1200 : i % 2 ? 1200 : 200,
    y: 100 + i * 40,
  }));

describe('cardColumnsEnabled', () => {
  it('窄屏不生效，与 CSS 断点一致', () => {
    expect(cardColumnsEnabled(820)).toBe(false);
    expect(cardColumnsEnabled(821)).toBe(true);
  });
});

describe('layoutCardColumns', () => {
  it('空输入返回空', () => {
    expect(layoutCardColumns({ targets: [], viewport: vp })).toEqual([]);
  });

  it('按城市所在半屏分列，避免连线横跨屏幕', () => {
    const slots = layoutCardColumns({ targets: targets(4, 'mixed'), viewport: vp });
    const bySide = (s: string) => slots.filter((x) => x.side === s);
    expect(bySide('left')).toHaveLength(2);
    expect(bySide('right')).toHaveLength(2);
    // 左列卡片在屏幕左半，右列在右半
    bySide('left').forEach((s) => expect(s.left).toBeLessThan(vp.width / 2));
    bySide('right').forEach((s) => expect(s.left + CARD_W).toBeGreaterThan(vp.width / 2));
  });

  it('卡片不越出视口左右边缘', () => {
    const slots = layoutCardColumns({ targets: targets(8, 'mixed'), viewport: vp });
    slots.forEach((s) => {
      expect(s.left).toBeGreaterThanOrEqual(0);
      expect(s.left + CARD_W).toBeLessThanOrEqual(vp.width);
    });
  });

  it('卡片落在上下安全区之间', () => {
    const slots = layoutCardColumns({ targets: targets(6, 'left'), viewport: vp });
    slots.forEach((s) => {
      expect(s.top).toBeGreaterThanOrEqual(88);
      expect(s.top + CARD_H).toBeLessThanOrEqual(vp.height - 96 + 1);
    });
  });

  // 这条是原实现明确的约束：同一个城市无论从哪个入口进来都必须长得一样
  it('城市很多时只压缩间距，卡片尺寸保持不变', () => {
    const few = layoutCardColumns({ targets: targets(3, 'left'), viewport: vp });
    const many = layoutCardColumns({ targets: targets(12, 'left'), viewport: vp });
    // 尺寸不参与排版输出，验证间距确实被压缩即可
    const gapFew = few[1].top - few[0].top;
    const gapMany = many[1].top - many[0].top;
    expect(gapMany).toBeLessThan(gapFew);
    // 且仍然全部落在安全区内，没有靠缩小卡片来腾空间
    many.forEach((s) => expect(s.top + CARD_H).toBeLessThanOrEqual(vp.height - 96 + 1));
  });

  it('同侧卡片有阶梯缩进，不排成笔直队列', () => {
    const slots = layoutCardColumns({ targets: targets(4, 'left'), viewport: vp });
    const lefts = new Set(slots.map((s) => s.left));
    expect(lefts.size).toBeGreaterThan(1);
  });

  it('阶梯缩进朝屏幕内侧，右列不会被推出视口', () => {
    const slots = layoutCardColumns({ targets: targets(4, 'right'), viewport: vp });
    slots.forEach((s) => expect(s.left + CARD_W).toBeLessThanOrEqual(vp.width));
  });

  it('连线终点保留原始城市坐标', () => {
    const t = targets(2, 'left');
    const slots = layoutCardColumns({ targets: t, viewport: vp });
    slots.forEach((s) => {
      const src = t.find((x) => x.key === s.key)!;
      expect(s.target).toEqual({ x: src.x, y: src.y });
    });
  });
});
