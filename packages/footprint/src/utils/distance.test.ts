import { describe, expect, it } from 'vitest';
import { haversineKm, journeyStats, sortByTime } from './distance';
import type { Footprint } from '../types/footprint';

const fp = (over: Partial<Footprint['spec']>): Footprint => ({
  metadata: { name: Math.random().toString(36) },
  spec: { name: 'x', longitude: 120, latitude: 30, ...over },
});

describe('haversineKm', () => {
  it('同一点距离为 0', () => {
    expect(haversineKm({ lat: 30, lng: 120 }, { lat: 30, lng: 120 })).toBe(0);
  });

  it('北京到上海约 1067 km', () => {
    const d = haversineKm({ lat: 39.9042, lng: 116.4074 }, { lat: 31.2304, lng: 121.4737 });
    expect(d).toBeGreaterThan(1050);
    expect(d).toBeLessThan(1085);
  });

  it('赤道上一度约 111 km', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
  });

  it('对称：A→B 与 B→A 相同', () => {
    const a = { lat: 30, lng: 120 };
    const b = { lat: 40, lng: 116 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it('跨 180 度经线不会算成绕地球一圈', () => {
    const d = haversineKm({ lat: 0, lng: 179 }, { lat: 0, lng: -179 });
    expect(d).toBeLessThan(250);
  });
});

describe('sortByTime', () => {
  it('按时间升序', () => {
    const list = sortByTime([
      fp({ name: 'b', createTime: '2025-05-01' }),
      fp({ name: 'a', createTime: '2025-01-01' }),
    ]);
    expect(list.map((f) => f.spec.name)).toEqual(['a', 'b']);
  });

  it('无时间的排最后', () => {
    const list = sortByTime([fp({ name: 'x' }), fp({ name: 'a', createTime: '2025-01-01' })]);
    expect(list.map((f) => f.spec.name)).toEqual(['a', 'x']);
  });

  it('不修改原数组', () => {
    const input = [fp({ name: 'b', createTime: '2025-05-01' }), fp({ name: 'a', createTime: '2025-01-01' })];
    const copy = [...input];
    sortByTime(input);
    expect(input).toEqual(copy);
  });
});

describe('journeyStats', () => {
  it('空输入全为零', () => {
    const s = journeyStats([]);
    expect(s).toEqual({ totalKm: 0, stops: 0, cities: 0, spanDays: 0, legs: [] });
  });

  it('单站没有航段', () => {
    const s = journeyStats([fp({ createTime: '2025-01-01' })]);
    expect(s.stops).toBe(1);
    expect(s.legs).toEqual([]);
    expect(s.totalKm).toBe(0);
  });

  it('航段数为站点数减一，总里程为各段之和', () => {
    const s = journeyStats([
      fp({ latitude: 39.9, longitude: 116.4, createTime: '2025-01-01' }),
      fp({ latitude: 31.2, longitude: 121.5, createTime: '2025-02-01' }),
      fp({ latitude: 23.1, longitude: 113.3, createTime: '2025-03-01' }),
    ]);
    expect(s.legs).toHaveLength(2);
    expect(s.totalKm).toBeCloseTo(s.legs[0] + s.legs[1], 6);
  });

  it('里程按时间顺序而非输入顺序计算', () => {
    const a = fp({ latitude: 39.9, longitude: 116.4, createTime: '2025-01-01' });
    const b = fp({ latitude: 31.2, longitude: 121.5, createTime: '2025-02-01' });
    expect(journeyStats([a, b]).totalKm).toBeCloseTo(journeyStats([b, a]).totalKm, 6);
  });

  it('城市按 adcode 去重', () => {
    const s = journeyStats([
      fp({ cityAdcode: '330100', createTime: '2025-01-01' }),
      fp({ cityAdcode: '330100', createTime: '2025-02-01' }),
      fp({ cityAdcode: '110100', createTime: '2025-03-01' }),
    ]);
    expect(s.cities).toBe(2);
  });

  it('时间跨度按首尾计算', () => {
    const s = journeyStats([
      fp({ createTime: '2025-01-01T00:00:00Z' }),
      fp({ createTime: '2025-01-11T00:00:00Z' }),
    ]);
    expect(s.spanDays).toBe(10);
  });

  it('时间无效时跨度为 0 而非 NaN', () => {
    const s = journeyStats([fp({ createTime: '坏日期' }), fp({ createTime: '也坏' })]);
    expect(s.spanDays).toBe(0);
    expect(Number.isNaN(s.spanDays)).toBe(false);
  });
});
