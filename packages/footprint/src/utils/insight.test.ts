import { beforeEach, describe, expect, it } from 'vitest';
import { buildInsights, monthOf, seasonOf, timeCapsuleItems } from './insight';
import { addStamp, drawOracle, hasStamp, loadStamps, passportProgress, resetStamps, stampIdOf } from './passport';
import type { Footprint } from '../types/footprint';

let seq = 0;
const fp = (over: Partial<Footprint['spec']>, name = `fp-${seq++}`): Footprint => ({
  metadata: { name },
  spec: { name: 'x', longitude: 120, latitude: 30, ...over },
});

describe('seasonOf', () => {
  it.each([
    [3, '春'], [5, '春'], [6, '夏'], [8, '夏'],
    [9, '秋'], [11, '秋'], [12, '冬'], [1, '冬'], [2, '冬'],
  ])('%i 月是%s', (m, s) => expect(seasonOf(m as number)).toBe(s));
});

describe('monthOf', () => {
  it('截字符串而非 Date 解析，避免时区把月底推到上个月', () => {
    expect(monthOf(fp({ createTime: '2025-03-31T23:00:00Z' }))).toBe(3);
  });
  it('无效时间返回 0', () => {
    expect(monthOf(fp({}))).toBe(0);
    expect(monthOf(fp({ createTime: '坏' }))).toBe(0);
  });
});

describe('timeCapsuleItems', () => {
  const now = new Date('2026-04-12T08:00:00Z');

  it('只取同月同日且往年的足迹', () => {
    const items = timeCapsuleItems(
      [
        fp({ createTime: '2025-04-12T10:00:00Z' }),
        fp({ createTime: '2024-04-12T10:00:00Z' }),
        fp({ createTime: '2026-04-12T10:00:00Z' }), // 今年，排除
        fp({ createTime: '2025-04-13T10:00:00Z' }), // 不同日，排除
      ],
      now
    );
    expect(items).toHaveLength(2);
  });

  it('按时间倒序，最近的一年在前', () => {
    const items = timeCapsuleItems(
      [fp({ createTime: '2023-04-12' }), fp({ createTime: '2025-04-12' })],
      now
    );
    expect(items[0].spec.createTime).toBe('2025-04-12');
  });

  it('没有匹配时返回空数组', () => {
    expect(timeCapsuleItems([fp({ createTime: '2025-01-01' })], now)).toEqual([]);
  });
});

describe('buildInsights', () => {
  it('空数据不产出任何洞察', () => {
    expect(buildInsights([])).toEqual([]);
  });

  it('只有一条足迹时不出现「去得最多」和「最远跨越」', () => {
    const keys = buildInsights([fp({ city: '杭州市', createTime: '2025-04-12' })]).map((i) => i.key);
    expect(keys).not.toContain('city');
    expect(keys).not.toContain('leg');
  });

  it('有数据才出现对应洞察，不产出空洞的 0 值卡片', () => {
    const insights = buildInsights([
      fp({ city: '杭州市', cityAdcode: '330100', latitude: 30.2, longitude: 120.2, createTime: '2025-04-12' }),
      fp({ city: '杭州市', cityAdcode: '330100', latitude: 30.3, longitude: 120.3, createTime: '2025-06-20' }),
      fp({ city: '北京市', cityAdcode: '110100', latitude: 39.9, longitude: 116.4, createTime: '2025-09-05' }),
    ]);
    const keys = insights.map((i) => i.key);
    expect(keys).toContain('distance');
    expect(keys).toContain('city');
    expect(keys).toContain('leg');
    insights.forEach((i) => {
      expect(i.value).not.toBe('0');
      expect(i.value).not.toBe('');
    });
  });

  it('去得最多的城市按 adcode 聚合', () => {
    const insights = buildInsights([
      fp({ city: '大理市', cityAdcode: '532900', createTime: '2025-01-01' }),
      fp({ city: '大理白族自治州', cityAdcode: '532900', createTime: '2025-02-01' }),
      fp({ city: '北京市', cityAdcode: '110100', createTime: '2025-03-01' }),
    ]);
    const city = insights.find((i) => i.key === 'city');
    expect(city?.detail).toBe('2 次');
  });
});

describe('护照集章', () => {
  beforeEach(() => resetStamps());

  it('盖章后可查询，重复盖不产生新记录', () => {
    expect(addStamp('a')).toBe(true);
    expect(addStamp('a')).toBe(false);
    expect(hasStamp('a')).toBe(true);
    expect(loadStamps()).toHaveLength(1);
  });

  it('空 id 不记录', () => {
    expect(addStamp('')).toBe(false);
    expect(loadStamps()).toHaveLength(0);
  });

  it('标识优先用 metadata.name，换图不会丢章', () => {
    const a = fp({ name: '西湖', ticketImage: '/a.jpg' }, 'fp-stable');
    const b = fp({ name: '西湖', ticketImage: '/b.jpg' }, 'fp-stable');
    expect(stampIdOf(a)).toBe(stampIdOf(b));
  });

  it('集齐后 complete 为真', () => {
    const tickets = [fp({}, 't1'), fp({}, 't2')];
    expect(passportProgress(tickets).complete).toBe(false);
    addStamp('t1');
    addStamp('t2');
    const p = passportProgress(tickets);
    expect(p).toEqual({ collected: 2, total: 2, complete: true });
  });

  it('没有票根时不算集齐', () => {
    expect(passportProgress([]).complete).toBe(false);
  });
});

describe('命运抽票', () => {
  it('没有票根时返回 null', () => {
    expect(drawOracle([], []).picked).toBeNull();
  });

  it('从票根中抽取，灵感来自未收录票根的城市', () => {
    const tickets = [fp({ city: '杭州市', ticketImage: '/a.jpg' })];
    const all = [...tickets, fp({ city: '成都市' }), fp({ city: '西安市' })];
    const r = drawOracle(tickets, all, () => 0);
    expect(r.picked).toBe(tickets[0]);
    expect(['成都市', '西安市']).toContain(r.inspiration);
    expect(r.inspiration).not.toBe('杭州市');
  });

  it('所有城市都有票根时灵感为空而非报错', () => {
    const tickets = [fp({ city: '杭州市', ticketImage: '/a.jpg' })];
    expect(drawOracle(tickets, tickets, () => 0).inspiration).toBe('');
  });
});
