import { describe, expect, it } from 'vitest';
import { computeStats } from './stats';
import type { Footprint } from '../types/footprint';

const fp = (over: Partial<Footprint['spec']>): Footprint => ({
  metadata: { name: Math.random().toString(36) },
  spec: { name: 'x', longitude: 120, latitude: 30, ...over },
});

describe('computeStats', () => {
  it('空数组返回全零', () => {
    const s = computeStats([]);
    expect(s.total).toBe(0);
    expect(s.provinces).toBe(0);
    expect(s.cities).toBe(0);
    expect(s.categories.every((c) => c.visited === 0)).toBe(true);
  });

  it('同省多条足迹只算一个省', () => {
    const s = computeStats([
      fp({ provinceAdcode: '330000' }),
      fp({ provinceAdcode: '330000' }),
      fp({ provinceAdcode: '330000' }),
    ]);
    expect(s.total).toBe(3);
    expect(s.provinces).toBe(1);
    expect(s.categories.find((c) => c.label === '省份')?.visited).toBe(1);
  });

  it('按 adcode 前两位归类', () => {
    const s = computeStats([
      fp({ provinceAdcode: '110000' }), // 北京 → 直辖市
      fp({ provinceAdcode: '500000' }), // 重庆 → 直辖市
      fp({ provinceAdcode: '450000' }), // 广西 → 自治区
      fp({ provinceAdcode: '810000' }), // 香港 → 特区
      fp({ provinceAdcode: '330000' }), // 浙江 → 省份
    ]);
    expect(s.categories.find((c) => c.label === '直辖市')?.visited).toBe(2);
    expect(s.categories.find((c) => c.label === '自治区')?.visited).toBe(1);
    expect(s.categories.find((c) => c.label === '特区')?.visited).toBe(1);
    expect(s.categories.find((c) => c.label === '省份')?.visited).toBe(1);
  });

  it('城市按 cityAdcode 去重', () => {
    const s = computeStats([
      fp({ cityAdcode: '330100' }),
      fp({ cityAdcode: '330100' }),
      fp({ cityAdcode: '330200' }),
    ]);
    expect(s.cities).toBe(2);
  });

  it('缺省份编码的足迹不参与省级统计，但仍计入总数', () => {
    const s = computeStats([fp({}), fp({ provinceAdcode: '330000' })]);
    expect(s.total).toBe(2);
    expect(s.provinces).toBe(1);
  });

  it('各分类的总数与行政区划实际数量一致', () => {
    const s = computeStats([]);
    expect(s.categories.map((c) => [c.label, c.total])).toEqual([
      ['直辖市', 4],
      ['自治区', 5],
      ['特区', 2],
      ['省份', 23],
    ]);
  });
});
