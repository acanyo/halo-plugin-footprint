import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    setInsightDeps, haversineKm, insightSeasonOf, insightMonthOf, insightSpotDate,
    insightIsWeekend, insightTimeStats, insightProvinceStats, insightSegmentStats,
    insightTypeStats, insightYearStats, insightTicketCollectorDone, insightDerived,
    insightAchievements, insightTitlesOf, insightTitleOf, insightMetrics
} from '../../../main/frontend/travel-memory/modules/footprints-insight.js';

const BJ = { lat: 39.9042, lng: 116.4074 };
const SH = { lat: 31.2304, lng: 121.4737 };

function fp(over) {
    return { name: '', city: '', province: '', createTime: '', images: [], ticketImage: '', ...over };
}

// 按 city 字段聚合城市；图片取 fp.images，票根有值即算
function injectDeps(footprints) {
    const keys = [...new Set(footprints.map(f => f.city).filter(Boolean))];
    setInsightDeps({
        footprints: () => footprints,
        cityList: () => keys.map(key => ({ key })),
        cityViewItems: (ci) => footprints.filter(f => f.city === keys[ci]),
        cityWallImages: (f) => f.images || [],
        ticketImageUrl: (v) => v || '',
        cityKeyOf: (f) => f.city
    });
}

beforeEach(() => injectDeps([]));

test('haversineKm：北京—上海约 1067 km', () => {
    const km = haversineKm(BJ, SH);
    assert.ok(km > 1050 && km < 1080, `${km}`);
    assert.equal(haversineKm(BJ, BJ), 0);
});

test('季节、月份、日期与周末', () => {
    assert.deepEqual([1, 2, 3, 5, 6, 8, 9, 11, 12].map(insightSeasonOf),
        ['冬', '冬', '春', '春', '夏', '夏', '秋', '秋', '冬']);
    assert.equal(insightMonthOf({ createTime: '2024-07-15' }), 7);
    assert.equal(insightMonthOf({ createTime: '2024-13-01' }), 0);
    assert.equal(insightMonthOf({}), 0);
    assert.equal(insightSpotDate({ createTime: '2024-07-15' }), '2024.07.15');
    assert.equal(insightSpotDate(null), '—');
    assert.equal(insightIsWeekend({ createTime: '2024-06-01' }), true);    // 周六
    assert.equal(insightIsWeekend({ createTime: '2024-06-03' }), false);   // 周一
    assert.equal(insightIsWeekend({ createTime: 'bad' }), false);
});

test('insightTimeStats：跨度、最常月份、跨年的连续月', () => {
    assert.equal(insightTimeStats([fp({})]), null);
    const t = insightTimeStats([
        fp({ createTime: '2022-11-03' }),
        fp({ createTime: '2022-12-20' }),
        fp({ createTime: '2023-01-05' }),
        fp({ createTime: '2023-01-25' }),
        fp({ createTime: '2023-06-01' }),
        fp({})
    ]);
    assert.equal(t.first.createTime, '2022-11-03');
    assert.equal(t.last.createTime, '2023-06-01');
    assert.equal(t.spanDays, 210);
    assert.equal(t.spanYears, 0);
    assert.equal(t.topMonth, 1);
    assert.equal(t.topMonthCount, 2);
    assert.equal(t.monthCount, 4);
    assert.equal(t.monthStreak, 3);   // 2022-11 → 2022-12 → 2023-01 跨年也算连续
});

test('insightProvinceStats：按足迹数、城市数、名称排序', () => {
    const p = insightProvinceStats([
        fp({ province: '浙江', city: '杭州' }),
        fp({ province: '浙江', city: '宁波' }),
        fp({ province: '江苏', city: '南京' }),
        fp({ province: '江苏', city: '南京' }),
        fp({ province: '上海', city: '上海' }),
        fp({ province: ' ' })
    ]);
    assert.equal(p.total, 3);
    assert.deepEqual(p.list.map(x => [x.name, x.footprints, x.cities]),
        [['浙江', 2, 2], ['江苏', 2, 1], ['上海', 1, 1]]);
});

test('insightSegmentStats：按时间相邻成段，四至取极值', () => {
    const s = insightSegmentStats([
        fp({ ...BJ, name: '北京', createTime: '2024-01-01' }),
        fp({ ...SH, name: '上海', createTime: '2024-02-01' }),
        fp({ lat: 22.5431, lng: 114.0579, name: '深圳', createTime: '2024-03-01' }),
        fp({ lat: NaN, lng: 1, name: '坏数据', createTime: '2024-04-01' })
    ]);
    assert.equal(s.count, 2);
    assert.equal(s.longest.to.name, '深圳');
    assert.equal(s.north.name, '北京');
    assert.equal(s.south.name, '深圳');
    assert.equal(s.east.name, '上海');
    assert.equal(s.west.name, '深圳');
    assert.ok(Math.abs(s.average - s.totalKm / 2) < 1e-9);
    assert.deepEqual(insightSegmentStats([]).longest, null);
});

test('insightTypeStats：空类型记为旅行，带最常季节', () => {
    const { list } = insightTypeStats([
        fp({ footprintType: '美食', createTime: '2024-07-01' }),
        fp({ footprintType: '美食', createTime: '2024-08-01' }),
        fp({ footprintType: '美食', createTime: '2024-01-01' }),
        fp({ createTime: '' })
    ]);
    assert.deepEqual(list[0], { name: '美食', count: 3, season: '夏', seasonCount: 2 });
    assert.deepEqual(list[1], { name: '旅行', count: 1, season: '', seasonCount: 0 });
});

test('insightYearStats：按年倒序，照片与票根走注入', () => {
    const data = [
        fp({ ...BJ, city: '北京', province: '北京', createTime: '2023-05-01', images: [1, 2], ticketImage: 't' }),
        fp({ ...SH, city: '上海', province: '上海', createTime: '2023-10-01' }),
        fp({ city: '北京', createTime: '2024-01-01', images: [1] }),
        fp({ createTime: 'xxxx' })
    ];
    injectDeps(data);
    const years = insightYearStats(data);
    assert.deepEqual(years.map(y => y.year), ['2024', '2023']);
    const y23 = years[1];
    assert.equal(y23.footprints, 2);
    assert.equal(y23.cities, 2);
    assert.equal(y23.photos, 2);
    assert.equal(y23.tickets, 1);
    assert.ok(y23.km > 1050 && y23.km < 1080);
    assert.deepEqual(y23.seasons, ['春', '秋']);
});

test('票根收藏家门槛：恰好一半即达成', () => {
    assert.equal(insightTicketCollectorDone({ footprintCount: 4, ticketCount: 2 }), true);
    assert.equal(insightTicketCollectorDone({ footprintCount: 5, ticketCount: 2 }), false);
    assert.equal(insightTicketCollectorDone({ footprintCount: 0, ticketCount: 0 }), false);
});

test('成就与称号共用同一份派生统计', () => {
    const data = [
        fp({ ...BJ, city: '北京', province: '北京', createTime: '2020-03-07', ticketImage: 't' }),
        fp({ ...SH, city: '上海', province: '上海', createTime: '2021-07-10', ticketImage: 't' }),
        fp({ lat: 22.5431, lng: 114.0579, city: '深圳', province: '广东', createTime: '2023-10-14', ticketImage: 't' }),
        fp({ ...BJ, city: '北京', province: '北京', createTime: '2023-11-04' })
    ];
    injectDeps(data);
    const m = insightMetrics();
    assert.equal(m.footprintCount, 4);
    assert.equal(m.cityCount, 3);
    assert.equal(m.ticketCount, 3);
    const time = insightTimeStats(data);
    const province = insightProvinceStats(data);
    const segment = insightSegmentStats(data);
    const derived = insightDerived(segment);
    assert.equal(derived.yearCount, 3);
    assert.equal(derived.seasonCount, 3);
    assert.equal(derived.repeatCities, 1);
    assert.equal(derived.weekendCount, 4);
    assert.equal(derived.allCitiesTicketed, true);

    const achievements = Object.fromEntries(
        insightAchievements(m, time, province, segment, derived).map(a => [a.name, a]));
    assert.equal(achievements['跨省旅人'].done, true);
    assert.equal(achievements['千里单骑'].done, true);
    assert.equal(achievements['票根收藏家'].done, true);
    assert.equal(achievements['岁月留痕'].done, true);
    assert.equal(achievements['一城一票'].done, true);
    assert.equal(achievements['四季出行'].done, false);
    assert.equal(achievements['四季出行'].remaining, '还差 1 个季节');

    const titles = insightTitlesOf(m, time, province, segment, derived);
    assert.ok(titles.some(t => t.startsWith('票根收藏家')));
    assert.ok(titles.some(t => t.startsWith('常年旅人')));
    assert.equal(insightTitleOf(m, time, province, segment, derived), titles[0]);
});

test('什么都没解锁时给兜底称号', () => {
    const data = [fp({ city: '北京', createTime: '2024-01-03' })];
    injectDeps(data);
    const m = insightMetrics();
    const title = insightTitleOf(m, insightTimeStats(data), insightProvinceStats(data), insightSegmentStats(data));
    assert.equal(title, '刚出发的旅人 · 1 段旅程');
});
