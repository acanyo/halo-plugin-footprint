import { describe, expect, it } from 'vitest';
import { gcj02ToWgs84, outOfChina, wgs84ToGcj02 } from './coordinate';

/**
 * 坐标转换一旦出偏差，地图上所有标记会整体偏移几十到几百米，
 * 而且不会有任何报错——只能靠测试锁住数值。
 *
 * 基准值取自迁移前的 travel-memory.js 实现，用于保证迁移是逐字等价的。
 */
describe('WGS84 ↔ GCJ-02', () => {
  it('境外坐标原样返回，不做偏移加密', () => {
    expect(outOfChina(139.767, 35.681)).toBe(true); // 东京
    expect(wgs84ToGcj02(139.767, 35.681)).toEqual({ lng: 139.767, lat: 35.681 });
    expect(gcj02ToWgs84(139.767, 35.681)).toEqual({ lng: 139.767, lat: 35.681 });
  });

  it('境内坐标判定正确', () => {
    expect(outOfChina(120.15, 30.28)).toBe(false); // 杭州
    expect(outOfChina(116.397, 39.908)).toBe(false); // 北京
  });

  // 黄金值直接取自迁移前的 travel-memory.js 实现，用于证明本次迁移逐字等价。
  // 注意纬度偏移的方向随地点变化（杭州为负、北京为正），不能想当然地断言符号。
  it.each([
    ['杭州', 120.15, 30.28, 120.1547094727907, 30.277680670674574],
    ['北京', 116.397, 39.908, 116.40324337854781, 39.90940335390724],
    ['广州', 113.264, 23.129, 113.26932932111345, 23.12632308350773],
    ['乌鲁木齐', 87.617, 43.792, 87.61984844859727, 43.79322441979298],
  ])('%s 的 WGS84→GCJ-02 结果与原实现完全一致', (_name, lng, lat, expLng, expLat) => {
    const g = wgs84ToGcj02(lng as number, lat as number);
    expect(g.lng).toBeCloseTo(expLng as number, 12);
    expect(g.lat).toBeCloseTo(expLat as number, 12);
  });

  it('往返转换可逆，误差在亚米级（<1e-5 度 ≈ 1.1 米）', () => {
    const cases: Array<[number, number]> = [
      [120.15, 30.28], // 杭州
      [116.397, 39.908], // 北京
      [113.264, 23.129], // 广州
      [87.617, 43.792], // 乌鲁木齐，靠近西部边界
    ];
    for (const [lng, lat] of cases) {
      const g = wgs84ToGcj02(lng, lat);
      const back = gcj02ToWgs84(g.lng, g.lat);
      expect(Math.abs(back.lng - lng)).toBeLessThan(1e-5);
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-5);
    }
  });

  it('边界外侧不转换，边界内侧转换', () => {
    // outOfChina 的阈值：lng 72.004~137.8347, lat 0.8293~55.8271
    expect(wgs84ToGcj02(72.0, 30)).toEqual({ lng: 72.0, lat: 30 });
    expect(wgs84ToGcj02(72.01, 30).lng).not.toBe(72.01);
  });
});
