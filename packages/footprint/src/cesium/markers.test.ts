import { describe, expect, it } from 'vitest';
import { cityKeyOf, groupByCity } from './markers';
import type { Footprint } from '../types/footprint';

const fp = (over: Partial<Footprint['spec']>): Footprint => ({
  metadata: { name: 'x' },
  spec: { name: 'x', longitude: 120, latitude: 30, ...over },
});

/**
 * 城市聚合键被卡片墙、城市视图、重走同城判定、明信片统计四处共用，
 * 改动会同时影响那四处，因此单独锁住。
 */
describe('cityKeyOf', () => {
  it('优先用 adcode', () => {
    expect(cityKeyOf(fp({ city: '大理市', cityAdcode: '532900' }))).toBe('532900');
  });

  it('adcode 缺失时退回城市名', () => {
    expect(cityKeyOf(fp({ city: '杭州市' }))).toBe('杭州市');
  });

  it('同一 adcode 下城市名写法不同仍算同一座城', () => {
    const a = cityKeyOf(fp({ city: '大理市', cityAdcode: '532900' }));
    const b = cityKeyOf(fp({ city: '大理白族自治州', cityAdcode: '532900' }));
    expect(a).toBe(b);
  });

  it('空值安全', () => {
    expect(cityKeyOf(null)).toBe('');
    expect(cityKeyOf(undefined)).toBe('');
    expect(cityKeyOf(fp({}))).toBe('');
  });

  it('前后空白被裁掉，避免 " 杭州" 与 "杭州" 分成两组', () => {
    expect(cityKeyOf(fp({ city: '  杭州市  ' }))).toBe('杭州市');
  });
});

describe('groupByCity', () => {
  it('按聚合键分组', () => {
    const groups = groupByCity([
      fp({ city: '杭州市', cityAdcode: '330100' }),
      fp({ city: '杭州市', cityAdcode: '330100' }),
      fp({ city: '北京市', cityAdcode: '110100' }),
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get('330100')?.items).toHaveLength(2);
  });

  it('展示名取组内出现次数最多的写法', () => {
    const groups = groupByCity([
      fp({ city: '大理白族自治州', cityAdcode: '532900' }),
      fp({ city: '大理市', cityAdcode: '532900' }),
      fp({ city: '大理市', cityAdcode: '532900' }),
    ]);
    expect(groups.get('532900')?.name).toBe('大理市');
  });

  it('没有城市信息的足迹被跳过，不会产生空键分组', () => {
    const groups = groupByCity([fp({}), fp({ city: '杭州市' })]);
    expect(groups.size).toBe(1);
    expect(groups.has('')).toBe(false);
  });

  it('只有 adcode 没有城市名时，展示名回退为键本身', () => {
    const groups = groupByCity([fp({ cityAdcode: '330100' })]);
    expect(groups.get('330100')?.name).toBe('330100');
  });
});
