import { describe, expect, it } from 'vitest';
import { estimateTextWidth, layoutLabels, type LabelCandidate } from './label-layout';

const vp = { width: 1200, height: 800 };
const at = (x: number, y: number, text = '杭州'): LabelCandidate => ({
  x,
  y,
  text,
  markerSize: 26,
});

/**
 * 避让是纯几何计算，从 labels.ts 拆出来正是为了能这样测——
 * 原实现把它和 Cesium 实体操作混在一起，无法单独验证。
 */
describe('estimateTextWidth', () => {
  it('中文按一个字号宽估算', () => {
    expect(estimateTextWidth('杭州', 12)).toBeCloseTo(24);
  });

  it('西文按 0.55 倍估算', () => {
    expect(estimateTextWidth('ab', 12)).toBeCloseTo(13.2);
  });

  it('中西混排分别计算', () => {
    expect(estimateTextWidth('杭a', 12)).toBeCloseTo(12 + 6.6);
  });

  it('空串宽度为 0', () => {
    expect(estimateTextWidth('', 12)).toBe(0);
  });
});

describe('layoutLabels', () => {
  it('孤立标签能放在第一候选位', () => {
    const [p] = layoutLabels([at(600, 400)], vp);
    expect(p.offset).not.toBeNull();
  });

  it('两个重叠的标签不会被放在同一位置', () => {
    const [a, b] = layoutLabels([at(600, 400), at(600, 400)], vp);
    expect(a.offset).not.toBeNull();
    expect(b.offset).not.toBeNull();
    expect(b.offset).not.toEqual(a.offset);
  });

  it('挤满时会外推到更远的圈，而不是直接放弃', () => {
    // 注意：第一圈的相邻候选位本身就会互相重叠（标签半宽 15px，而相邻方向
    // 在半径 15 处的间距只有约 10px），所以一圈装不下 8 个。这里要验证的
    // 不是「能放几个」，而是「放不下时会用更远的圈」。
    const candidates = Array.from({ length: 9 }, () => at(600, 400));
    const result = layoutLabels(candidates, vp);
    const placed = result.filter((r) => r.offset !== null);

    expect(placed.length).toBeGreaterThan(1);

    // 至少出现两种不同的半径，说明确实外推了
    const radii = new Set(
      placed.map((p) => Math.round(Math.hypot(p.offset!.x, p.offset!.y)))
    );
    expect(radii.size).toBeGreaterThan(1);
  });

  it('贴近视口边缘时不会把标签放到视口外', () => {
    const [p] = layoutLabels([at(5, 5)], vp);
    if (p.offset) {
      const w = estimateTextWidth('杭州') / 2;
      expect(5 + p.offset.x - w).toBeGreaterThanOrEqual(0);
      expect(5 + p.offset.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('实在放不下时返回 null 表示这一帧隐藏', () => {
    // 极窄视口 + 长文本，任何候选位都越界
    const result = layoutLabels([at(10, 10, '非常非常非常长的地名名称')], {
      width: 40,
      height: 40,
    });
    expect(result[0].offset).toBeNull();
  });

  it('按传入顺序贪心放置，先来的优先占位', () => {
    const result = layoutLabels([at(600, 400, '先'), at(600, 400, '后')], vp);
    // 第一个拿到的一定是第一候选位（正上方）
    expect(result[0].offset).toEqual({ x: 0, y: expect.any(Number) });
  });
});
