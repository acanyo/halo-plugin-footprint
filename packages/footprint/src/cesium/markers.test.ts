import { describe, expect, it } from 'vitest';
import { cityKeyOf, createFootprintMarkers, groupByCity } from './markers';
import type { Footprint } from '../types/footprint';

/**
 * 最小的 Cesium 桩：只需记录传给 entities.add 的位置。
 * Cartesian3.fromDegrees 原样返回入参，便于断言经纬度。
 */
function fakeViewer() {
  const added: Array<{ position: { lng: number; lat: number } }> = [];
  (globalThis as unknown as { window: unknown }).window = {
    Cesium: {
      Cartesian3: { fromDegrees: (lng: number, lat: number) => ({ lng, lat }) },
      VerticalOrigin: { CENTER: 0 },
    },
  };
  return {
    added,
    entities: {
      add(o: { position: { lng: number; lat: number } }) {
        added.push(o);
        return o;
      },
    },
  };
}

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

/**
 * 坐标换算方向。
 *
 * 这里出错不报任何异常，只是所有标记整体偏移约 500 米——正是最难发现的那类 bug。
 * 我在迁移时第一版就写反了（写成「底图是 gcj02 就调 wgs84ToGcj02」），
 * 结果同源时多偏一次、异源时完全不转，两种底图下都错。
 */
describe('坐标换算方向', () => {
  const hangzhou = fp({ longitude: 120.15, latitude: 30.28 });

  it('高德底图：足迹本就是 GCJ-02，直接用原坐标', () => {
    const viewer = fakeViewer();
    createFootprintMarkers(viewer, [hangzhou], 'gcj02');
    const pos = viewer.added[0].position;
    expect(pos.lng).toBeCloseTo(120.15, 9);
    expect(pos.lat).toBeCloseTo(30.28, 9);
  });

  it('天地图底图：需从 GCJ-02 转回 WGS84，经度应变小', () => {
    const viewer = fakeViewer();
    createFootprintMarkers(viewer, [hangzhou], 'wgs84');
    const pos = viewer.added[0].position;
    // 杭州的 GCJ-02 偏移为 Δlng +0.0047 / Δlat -0.0023，转回去方向相反
    expect(pos.lng).toBeLessThan(120.15);
    expect(pos.lat).toBeGreaterThan(30.28);
    expect(Math.abs(pos.lng - 120.15)).toBeGreaterThan(0.002);
  });

  it('两种底图下的位置必须不同，否则说明有一侧没转', () => {
    const a = fakeViewer();
    const b = fakeViewer();
    createFootprintMarkers(a, [hangzhou], 'gcj02');
    createFootprintMarkers(b, [hangzhou], 'wgs84');
    expect(a.added[0].position.lng).not.toBeCloseTo(b.added[0].position.lng, 6);
  });
});
