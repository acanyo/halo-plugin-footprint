/**
 * 足迹洞察的统计口径（纯计算，不碰 DOM）。
 *
 * 这里都是「给定足迹数据算出一个数字/一句话」的函数，原先散落在
 * travel-memory/index.js 的洞察区块里。抽出来的两个理由：
 * 1) 口径密集且容易错（季节、月份连续、区县编码、称号门槛），单独拿出来才方便核对；
 * 2) 它们和洞察卡片的 DOM 渲染混在一起时，改样式和改口径会互相干扰。
 *
 * 依赖注入说明：FOOTPRINTS / cityList 是主文件里的 let，刷新数据时会整体重建，
 * 所以这里全部通过取值函数读取，不缓存快照 —— 缓存下来会变成僵尸数据。
 * 这与 modules/lightbox.js、modules/tdt-terrain.js 的约定一致。
 */

let deps = null;

/**
 * @param d.footprints      () => Footprint[]       全部足迹
 * @param d.cityList        () => [{key, ...}]      城市聚合列表
 * @param d.cityViewItems   (ci) => Footprint[]     某座城市下的足迹
 * @param d.cityWallImages  (fp) => [{url}]         一条足迹的图片列表
 * @param d.ticketImageUrl  (value) => string       票根图片地址
 * @param d.cityKeyOf       (fp) => string          足迹所属城市的聚合键
 */
export function setInsightDeps(d) {
    deps = d;
}

export function haversineKm(a, b) {
    const R = 6371;
    const rad = d => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}

// ---- 洞察用的小工具 ----
export function insightSeasonOf(month) {
    if (month >= 3 && month <= 5) return '春';
    if (month >= 6 && month <= 8) return '夏';
    if (month >= 9 && month <= 11) return '秋';
    return '冬';
}

export function insightMonthOf(fp) {
    const month = Number(String(fp.createTime || '').slice(5, 7));
    return month >= 1 && month <= 12 ? month : 0;
}

export function insightSpotDate(fp) {
    return fp && fp.createTime ? String(fp.createTime).slice(0, 10).replace(/-/g, '.') : '—';
}

export function insightKm(value) {
    const n = Math.round(Number(value) || 0);
    return n.toLocaleString('zh-CN');
}

export function insightPlaceName(fp) {
    return (fp && (fp.city || fp.name)) || '某地';
}

// 时间维度：首次 / 最近、跨度、最常出发的月份、连续出行月、12 个月分布
export function insightTimeStats(fps) {
    const dated = fps
        .filter(fp => fp.createTime)
        .slice()
        .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
    if (!dated.length) return null;
    const first = dated[0];
    const last = dated[dated.length - 1];
    const firstTime = new Date(String(first.createTime) + 'T00:00:00').getTime();
    const lastTime = new Date(String(last.createTime) + 'T00:00:00').getTime();
    const spanDays = Number.isFinite(firstTime) && Number.isFinite(lastTime)
        ? Math.max(0, Math.round((lastTime - firstTime) / 86400000))
        : 0;
    const spanYears = Math.floor(spanDays / 365);
    const months = new Array(12).fill(0);
    const monthKeys = new Set();
    dated.forEach(fp => {
        const month = insightMonthOf(fp);
        if (!month) return;
        months[month - 1] += 1;
        const year = Number(String(fp.createTime).slice(0, 4)) || 0;
        monthKeys.add(year * 12 + (month - 1));
    });
    const topMonthCount = Math.max(...months);
    const topMonth = months.indexOf(topMonthCount) + 1;
    // 连续出行月：把「年 * 12 + 月」排成序列，找最长的一段相邻月份
    const keys = [...monthKeys].sort((a, b) => a - b);
    let streak = keys.length ? 1 : 0;
    let best = streak;
    for (let i = 1; i < keys.length; i++) {
        streak = keys[i] === keys[i - 1] + 1 ? streak + 1 : 1;
        best = Math.max(best, streak);
    }
    return {
        first,
        last,
        spanDays,
        spanYears,
        restDays: spanDays - spanYears * 365,
        months,
        topMonth,
        topMonthCount,
        monthCount: keys.length,
        monthStreak: best
    };
}

// 省份维度：每个省去过多少座城市、留下多少条足迹
export function insightProvinceStats(fps) {
    const map = new Map();
    fps.forEach(fp => {
        const name = String(fp.province || '').trim();
        if (!name) return;
        if (!map.has(name)) map.set(name, { name, footprints: 0, cities: new Set() });
        const item = map.get(name);
        item.footprints += 1;
        if (fp.city) item.cities.add(fp.city);
    });
    const list = [...map.values()]
        .map(item => ({ name: item.name, footprints: item.footprints, cities: item.cities.size }))
        .sort((a, b) => b.footprints - a.footprints ||
            b.cities - a.cities ||
            a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return { list, total: list.length };
}

// 单段之最：按时间相邻的两条足迹算一段，取最长 / 最短 / 平均与四个方向极值
export function insightSegmentStats(fps) {
    const located = fps.filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng));
    const dated = located
        .filter(fp => fp.createTime)
        .slice()
        .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
    const segments = [];
    for (let i = 1; i < dated.length; i++) {
        const km = haversineKm(dated[i - 1], dated[i]);
        if (Number.isFinite(km)) segments.push({ from: dated[i - 1], to: dated[i], km });
    }
    const byKm = segments.slice().sort((a, b) => b.km - a.km);
    const byLat = located.slice().sort((a, b) => a.lat - b.lat);
    const byLng = located.slice().sort((a, b) => a.lng - b.lng);
    const totalKm = segments.reduce((sum, item) => sum + item.km, 0);
    return {
        count: segments.length,
        longest: byKm[0] || null,
        shortest: byKm[byKm.length - 1] || null,
        average: segments.length ? totalKm / segments.length : 0,
        totalKm,
        south: byLat[0] || null,
        north: byLat[byLat.length - 1] || null,
        west: byLng[0] || null,
        east: byLng[byLng.length - 1] || null
    };
}

// 类型维度：每种类型多少次，以及它最常出现在哪个季节
export function insightTypeStats(fps) {
    const map = new Map();
    fps.forEach(fp => {
        const name = String(fp.footprintType || '').trim() || '旅行';
        if (!map.has(name)) map.set(name, { name, count: 0, seasons: { 春: 0, 夏: 0, 秋: 0, 冬: 0 } });
        const item = map.get(name);
        item.count += 1;
        const month = insightMonthOf(fp);
        if (month) item.seasons[insightSeasonOf(month)] += 1;
    });
    const list = [...map.values()].map(item => {
        const top = Object.entries(item.seasons).sort((a, b) => b[1] - a[1])[0] || ['', 0];
        return {
            name: item.name,
            count: item.count,
            season: top[1] ? top[0] : '',
            seasonCount: top[1] || 0
        };
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return { list };
}

// 年度回顾：按年份聚合，倒序排列
export function insightYearStats(fps) {
    const map = new Map();
    fps.forEach(fp => {
        const year = String(fp.createTime || '').slice(0, 4);
        if (!/^\d{4}$/.test(year)) return;
        if (!map.has(year)) map.set(year, []);
        map.get(year).push(fp);
    });
    return [...map.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([year, items]) => {
            const dated = items
                .filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng))
                .slice()
                .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
            let km = 0;
            for (let i = 1; i < dated.length; i++) km += haversineKm(dated[i - 1], dated[i]);
            const seasons = [...new Set(items
                .map(fp => insightMonthOf(fp))
                .filter(Boolean)
                .map(insightSeasonOf))];
            return {
                year,
                footprints: items.length,
                cities: new Set(items.map(fp => fp.city).filter(Boolean)).size,
                provinces: [...new Set(items.map(fp => String(fp.province || '').trim()).filter(Boolean))],
                photos: items.reduce((n, fp) => n + deps.cityWallImages(fp).length, 0),
                tickets: items.filter(fp => deps.ticketImageUrl(fp.ticketImage)).length,
                km: Math.round(km),
                months: new Set(items.map(fp => String(fp.createTime || '').slice(5, 7)).filter(Boolean)).size,
                seasons
            };
        });
}

// 票根收藏家的判定只有这一处：称号和徽章共用，免得同名两个门槛，
// 出现「顶栏自称票根收藏家，下面那枚徽章却还灰着」
export function insightTicketCollectorDone(m) {
    return m.footprintCount > 0 && m.ticketCount * 2 >= m.footprintCount;
}

// 周末：createTime 被统一成 YYYY-MM-DD，小时已经丢了，只能算到「星期」这一层
export function insightIsWeekend(fp) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((fp && fp.createTime) || ''));
    if (!m) return false;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
    return day === 0 || day === 6;
}

// 成就与称号共用的派生统计：只算一遍，两边都从这里取，免得口径漂移
export function insightDerived(segment) {
    // 取值函数在数据刷新后会指向新数组，所以一次计算里只取一次，避免中途拿到半新半旧的数据
    const all = deps.footprints();
    const cities = deps.cityList();
    const located = all.filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng));
    const byLat = located.slice().sort((a, b) => a.lat - b.lat);
    const byLng = located.slice().sort((a, b) => a.lng - b.lng);
    const maxCityVisits = cities.reduce((max, city, ci) => Math.max(max, deps.cityViewItems(ci).length), 0);
    let repeatCities = 0;
    cities.forEach((city, ci) => {
        if (deps.cityViewItems(ci).length >= 2) repeatCities += 1;
    });
    const ticketedCityKeys = new Set(all
        .filter(fp => deps.ticketImageUrl(fp.ticketImage))
        .map(fp => deps.cityKeyOf(fp)));
    return {
        north: byLat[byLat.length - 1] || null,
        south: byLat[0] || null,
        east: byLng[byLng.length - 1] || null,
        west: byLng[0] || null,
        // 只有一条数据时跨度按 0 算，免得「跨越 0.0 个纬度」也算点亮
        latSpan: byLat.length >= 2 ? byLat[byLat.length - 1].lat - byLat[0].lat : 0,
        lngSpan: byLng.length >= 2 ? byLng[byLng.length - 1].lng - byLng[0].lng : 0,
        yearCount: new Set(all
            .map(fp => String(fp.createTime || '').slice(0, 4))
            .filter(year => /^\d{4}$/.test(year))).size,
        seasonCount: new Set(all
            .map(fp => insightMonthOf(fp))
            .filter(Boolean)
            .map(insightSeasonOf)).size,
        maxCityVisits,
        repeatCities,
        photos: all.reduce((n, fp) => n + deps.cityWallImages(fp).length, 0),
        weekendCount: all.filter(insightIsWeekend).length,
        // 画廊是「一条足迹带多张图」，所以这里比 cityWallImages 的 1 张兜底要严
        galleryCount: all.filter(fp => deps.cityWallImages(fp).length >= 2).length,
        articleCount: all.filter(fp => String(fp.article || '').trim()).length,
        typeCount: new Set(all
            .map(fp => String(fp.footprintType || '').trim() || '旅行')).size,
        // 「一城一票」：所有城市都能翻出票根。城市太少不算数，免得点亮得太容易
        unticketedCities: cities.filter(city => !ticketedCityKeys.has(city.key)).length,
        allCitiesTicketed: cities.length >= 3 &&
            cities.every(city => ticketedCityKeys.has(city.key)),
        longest: segment && segment.longest ? segment.longest.km : 0
    };
}

// 轻成就：全部用已有数据算，满足条件即点亮。
// 未点亮的补一句 remaining（还差多少），显示在进度位置
export function insightAchievements(m, time, province, segment, stats) {
    const s = stats || insightDerived(segment);
    const ticketHalf = Math.ceil(m.footprintCount / 2);
    const ticketGap = Math.max(0, ticketHalf - m.ticketCount);
    return [
        {
            name: '跨省旅人',
            desc: '点亮 3 个以上省份',
            done: province.total >= 3,
            progress: province.total + ' 个省',
            remaining: '还差 ' + Math.max(0, 3 - province.total) + ' 个省'
        },
        {
            name: '疆域辽阔',
            desc: '到访 8 个省份以上',
            done: province.total >= 8,
            progress: province.total + ' 个省',
            remaining: '还差 ' + Math.max(0, 8 - province.total) + ' 个省'
        },
        {
            name: '南北纵贯',
            desc: '最北与最南相隔 8 度以上',
            done: s.latSpan >= 8,
            progress: s.latSpan ? s.latSpan.toFixed(1) + ' 度' : '暂无数据',
            remaining: s.latSpan ? '还差 ' + Math.max(0, 8 - s.latSpan).toFixed(1) + ' 度' : '暂无数据'
        },
        {
            name: '北境行者',
            desc: '最北的足迹在北纬 40° 以上',
            done: !!s.north && s.north.lat >= 40,
            progress: s.north ? '北纬 ' + s.north.lat.toFixed(1) + '°' : '暂无数据',
            remaining: s.north
                ? '最北北纬 ' + s.north.lat.toFixed(1) + '°，还差 ' +
                    Math.max(0, 40 - s.north.lat).toFixed(1) + ' 度'
                : '暂无数据'
        },
        {
            name: '经度猎手',
            desc: '最东与最西相隔 10 度以上',
            done: s.lngSpan >= 10,
            progress: s.lngSpan ? s.lngSpan.toFixed(1) + ' 度' : '暂无数据',
            remaining: s.lngSpan ? '还差 ' + Math.max(0, 10 - s.lngSpan).toFixed(1) + ' 度' : '暂无数据'
        },
        {
            name: '长途跋涉',
            desc: '单段行程超过 500 公里',
            done: s.longest >= 500,
            progress: s.longest ? insightKm(s.longest) + ' km' : '暂无数据',
            remaining: s.longest ? '还差 ' + insightKm(Math.max(0, 500 - s.longest)) + ' km' : '暂无数据'
        },
        {
            name: '千里单骑',
            desc: '单段行程超过 1000 公里',
            done: s.longest >= 1000,
            progress: s.longest ? insightKm(s.longest) + ' km' : '暂无数据',
            remaining: s.longest ? '还差 ' + insightKm(Math.max(0, 1000 - s.longest)) + ' km' : '暂无数据'
        },
        {
            name: '票根收藏家',
            desc: '一半以上的足迹有票根',
            done: insightTicketCollectorDone(m),
            progress: m.ticketCount + '/' + m.footprintCount,
            remaining: m.footprintCount ? '还差 ' + ticketGap + ' 张（要 ' + ticketHalf + ' 张）' : '暂无数据'
        },
        {
            name: '票根大户',
            desc: '累计票根 20 张以上',
            done: m.ticketCount >= 20,
            progress: m.ticketCount + ' 张',
            remaining: '还差 ' + Math.max(0, 20 - m.ticketCount) + ' 张'
        },
        {
            name: '跨年旅人',
            desc: '在两个以上年份出发',
            done: s.yearCount >= 2,
            progress: s.yearCount + ' 个年份',
            remaining: '还差 ' + Math.max(0, 2 - s.yearCount) + ' 个年份'
        },
        {
            name: '岁月留痕',
            desc: '记录跨度 3 年以上',
            done: !!time && time.spanYears >= 3,
            progress: time ? time.spanYears + ' 年' : '暂无数据',
            remaining: time ? '还差 ' + Math.max(0, 3 - time.spanYears) + ' 年' : '暂无数据'
        },
        {
            name: '同城三刷',
            desc: '同一座城市去过 3 次以上',
            done: s.maxCityVisits >= 3,
            progress: '最多 ' + s.maxCityVisits + ' 次',
            remaining: '最多 ' + s.maxCityVisits + ' 次，还差 ' + Math.max(0, 3 - s.maxCityVisits) + ' 次'
        },
        {
            name: '单城五刷',
            desc: '同一座城市去过 5 次以上',
            done: s.maxCityVisits >= 5,
            progress: '最多 ' + s.maxCityVisits + ' 次',
            remaining: '最多 ' + s.maxCityVisits + ' 次，还差 ' + Math.max(0, 5 - s.maxCityVisits) + ' 次'
        },
        {
            name: '回头客',
            desc: '有 5 座城市去过两次以上',
            done: s.repeatCities >= 5,
            progress: s.repeatCities + ' 座城市',
            remaining: '还差 ' + Math.max(0, 5 - s.repeatCities) + ' 座'
        },
        {
            name: '相册达人',
            desc: '累计收录 100 张以上照片',
            done: s.photos >= 100,
            progress: s.photos + ' 张',
            remaining: '还差 ' + Math.max(0, 100 - s.photos) + ' 张'
        },
        {
            name: '快门狂魔',
            desc: '累计收录 500 张以上照片',
            done: s.photos >= 500,
            progress: s.photos + ' 张',
            remaining: '还差 ' + Math.max(0, 500 - s.photos) + ' 张'
        },
        {
            name: '画廊主人',
            desc: '3 条足迹带多图画廊',
            done: s.galleryCount >= 3,
            progress: s.galleryCount + ' 条',
            remaining: '还差 ' + Math.max(0, 3 - s.galleryCount) + ' 条'
        },
        {
            name: '图文并茂',
            desc: '5 条足迹挂了文章链接',
            done: s.articleCount >= 5,
            progress: s.articleCount + ' 条',
            remaining: '还差 ' + Math.max(0, 5 - s.articleCount) + ' 条'
        },
        {
            name: '一城一票',
            desc: '每座城市都留下了票根',
            done: s.allCitiesTicketed,
            progress: '票根覆盖 ' + (deps.cityList().length - s.unticketedCities) + '/' + deps.cityList().length + ' 座城市',
            remaining: deps.cityList().length < 3
                ? '至少 3 座城市后解锁'
                : '还有 ' + s.unticketedCities + ' 座城市没票根'
        },
        {
            name: '四季出行',
            desc: '春夏秋冬都出发过',
            done: s.seasonCount >= 4,
            progress: s.seasonCount + ' 个季节',
            remaining: '还差 ' + Math.max(0, 4 - s.seasonCount) + ' 个季节'
        },
        {
            name: '月度常客',
            desc: '累计在 10 个不同月份出发过',
            done: !!time && time.monthCount >= 10,
            progress: time ? time.monthCount + ' 个月份' : '暂无数据',
            remaining: time ? '还差 ' + Math.max(0, 10 - time.monthCount) + ' 个月份' : '暂无数据'
        },
        {
            name: '周末出走',
            desc: '5 次以上出发落在周末',
            done: s.weekendCount >= 5,
            progress: s.weekendCount + ' 次',
            remaining: '还差 ' + Math.max(0, 5 - s.weekendCount) + ' 次'
        },
        {
            name: '万里行者',
            desc: '累计里程 1 万公里以上',
            done: m.distanceKm >= 10000,
            progress: insightKm(m.distanceKm) + ' km',
            remaining: '还差 ' + insightKm(Math.max(0, 10000 - m.distanceKm)) + ' km'
        },
        {
            name: '主题收藏家',
            desc: '主题类型 5 种以上',
            done: s.typeCount >= 5,
            progress: s.typeCount + ' 种',
            remaining: '还差 ' + Math.max(0, 5 - s.typeCount) + ' 种'
        }
    ];
}

// 称号：把所有已解锁的收集出来（顺序 = 稀缺度，从难到易）。
// 第一句默认显示，成就卡上的「换一个称号」就在这份列表里循环，所以不再只挑一句。
export function insightTitlesOf(m, time, province, segment, stats) {
    const s = stats || insightDerived(segment);
    const list = [];
    if (m.cityCount >= 30) list.push('百城 · 点亮 ' + m.cityCount + ' 座城市');
    if (m.distanceKm >= 10000) list.push('万里行者 · 约 ' + insightKm(m.distanceKm) + ' 公里');
    if (s.photos >= 500) list.push('快门收藏家 · 收下 ' + s.photos + ' 张照片');
    if (s.lngSpan >= 20) list.push('东西横穿者 · 跨越 ' + s.lngSpan.toFixed(1) + ' 个经度');
    if (s.latSpan >= 12) list.push('南北纵贯者 · 跨越 ' + s.latSpan.toFixed(1) + ' 个纬度');
    if (s.repeatCities >= 5) list.push('老地方收集者 · ' + s.repeatCities + ' 座城市去过两次以上');
    if (time && time.spanYears >= 3) list.push('常年旅人 · 记录横跨 ' + time.spanYears + ' 年');
    if (province.total >= 10) list.push('远行者 · 走过 ' + province.total + ' 个省份');
    if (province.total >= 8) list.push('疆域辽阔者 · 走过 ' + province.total + ' 个省份');
    if (insightTicketCollectorDone(m)) list.push('票根收藏家 · 攒下 ' + m.ticketCount + ' 张票根');
    if (m.cityCount >= 10) list.push('城市收集者 · 点亮 ' + m.cityCount + ' 座城市');
    if (s.weekendCount >= 10) list.push('周末出走者 · ' + s.weekendCount + ' 次出发落在周末');
    if (time && time.monthStreak >= 3) list.push('四季旅人 · 连续 ' + time.monthStreak + ' 个月出发');
    return list;
}

// 一句条件称号都没解锁时的兜底，不算进「N / 13」
export function insightFallbackTitle(m) {
    return '刚出发的旅人 · ' + m.footprintCount + ' 段旅程';
}

// 还是保留「给一个最贴切的」这个入口，给需要单句的地方用
export function insightTitleOf(m, time, province, segment, stats) {
    const list = insightTitlesOf(m, time, province, segment, stats);
    return list.length ? list[0] : insightFallbackTitle(m);
}

export function insightMetrics() {
    const all = deps.footprints();
    const cities = deps.cityList();
    const fps = all.filter(fp => fp.lat && fp.lng);
    const sorted = fps.slice().sort((a, b) =>
        String(a.createTime || '').localeCompare(String(b.createTime || '')));
    const distance = sorted.slice(1).reduce((sum, fp, i) =>
        sum + haversineKm(sorted[i], fp), 0);
    const months = fps.map(fp => Number(String(fp.createTime || '').slice(5, 7))).filter(Boolean);
    const seasonCount = { 春: 0, 夏: 0, 秋: 0, 冬: 0 };
    months.forEach(m => {
        if (m >= 3 && m <= 5) seasonCount['春']++;
        else if (m >= 6 && m <= 8) seasonCount['夏']++;
        else if (m >= 9 && m <= 11) seasonCount['秋']++;
        else seasonCount['冬']++;
    });
    const topSeason = Object.entries(seasonCount).sort((a, b) => b[1] - a[1])[0];
    const typeCount = {};
    fps.forEach(fp => {
        const t = fp.footprintType || '旅行';
        typeCount[t] = (typeCount[t] || 0) + 1;
    });
    const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
    const byLat = [...fps].sort((a, b) => a.lat - b.lat);
    const byLng = [...fps].sort((a, b) => a.lng - b.lng);
    return {
        footprintCount: all.length,
        cityCount: cities.length,
        // 足迹洞察看的是全部数据：这里不能用 ticketItemsFromFootprints()，
        // 它认票根页的「只看某座城市」筛选，会把概览的票根数和票根收藏家一起算少
        ticketCount: all.filter(fp => deps.ticketImageUrl(fp.ticketImage)).length,
        photoCount: all.reduce((n, fp) => n + deps.cityWallImages(fp).length, 0),
        distanceKm: Math.round(distance),
        topSeason: topSeason && topSeason[1] ? topSeason[0] : '',
        topSeasonCount: topSeason ? topSeason[1] : 0,
        topType: topType && topType[1] ? topType[0] : '',
        topTypeCount: topType ? topType[1] : 0,
        south: byLat[0], north: byLat[byLat.length - 1],
        west: byLng[0], east: byLng[byLng.length - 1]
    };
}

// 概览卡的几句总结：数据是真的，语气留一点文艺。
// 说法大致按「总览 → 节奏 → 地理 → 偏爱 → 距离 → 收藏 → 年份 → 称号」铺开，
// 缺哪块数据就跳过哪句：「换一个说法」在数据齐全时能翻二十来次，数据少时也不会露出空话。
// 第 1 句保持任何数据都成立，打开洞察时默认显示的就是它。
export function insightSentences(m, time, province, segment, extras = {}) {
    const years = extras.years || [];
    const title = extras.title || '';
    const longest = segment && segment.longest;
    const list = [];
    list.push('约 ' + m.footprintCount + ' 次出发、' + m.cityCount +
        ' 座城市，地图上的每一处坐标都是一个故事。');
    if (m.distanceKm) {
        list.push(m.cityCount + ' 座城市、约 ' + m.distanceKm.toLocaleString('zh-CN') +
            ' 公里的路，是你一步一步走出来的版图。');
    }
    list.push((m.topSeason ? '你似乎总在' + m.topSeason + '天收拾行囊，' : '你总在合适的时候出发，') +
        (m.topType ? '「' + m.topType + '」是你写得最多的一页。' : '每一程都值得被记住。'));

    // 节奏：平均多久出发一次。密一点说「熟练」，疏一点说「算数」
    if (time && m.footprintCount >= 3) {
        const gapDays = Math.round(time.spanDays / (m.footprintCount - 1));
        if (gapDays > 0) {
            list.push(m.footprintCount + ' 次出发散在 ' + time.monthCount + ' 个月里，平均每 ' + gapDays +
                (gapDays <= 60
                    ? ' 天就收拾一次行李 —— 出发这件事，你早就做得很熟练。'
                    : ' 天才动身一回 —— 不算频繁，但每一次都算数。'));
        }
    }
    if (time && time.monthStreak >= 3) {
        list.push('最长的一段，你连着 ' + time.monthStreak +
            ' 个月都在路上 —— 那段时间，行李箱大概一直没收起来过。');
    }
    if (time && time.topMonthCount >= 2) {
        list.push(time.topMonth + ' 月是你的高发期，前后一共出发了 ' + time.topMonthCount +
            ' 次，那个月份的风，你大概最熟悉。');
    }
    if (m.topSeason && m.topSeasonCount >= 2) {
        list.push(m.topSeason + '季是你最常选中的时节，' + m.topSeasonCount + ' 次出发落在了那里。');
    }

    if (province && province.total) {
        list.push(province.total + ' 个省份里，' + province.list[0].name +
            '被你翻开的次数最多 —— 那里大概有值得反复抵达的理由。');
    }
    // 地理跨度：纬度看南北，经度看东西
    const latSpan = m.south && m.north ? Math.abs(m.north.lat - m.south.lat) : 0;
    if (latSpan >= 3) {
        list.push('从最南的 ' + insightPlaceName(m.south) + ' 到最北的 ' + insightPlaceName(m.north) +
            '，你把 ' + latSpan.toFixed(1) + ' 个纬度装进了自己的地图。');
    } else if (!province.total && m.south && m.north &&
        insightPlaceName(m.south) !== insightPlaceName(m.north)) {
        list.push('从 ' + insightPlaceName(m.south) + ' 到 ' + insightPlaceName(m.north) +
            '，世界在地图上被你慢慢点亮。');
    }
    if (m.west && m.east) {
        const lngSpan = Math.abs(m.east.lng - m.west.lng);
        if (lngSpan >= 3) {
            list.push('最东是 ' + insightPlaceName(m.east) + '，最西是 ' + insightPlaceName(m.west) +
                '，中间隔着 ' + lngSpan.toFixed(1) + ' 个经度 —— 那是你横向丈量世界的方式。');
        }
    }

    // 偏爱：回去得最多的那座城市，以及所有被重复抵达过的城市
    let topCityName = '';
    let topCityVisits = 0;
    let repeatCities = 0;
    const cities = deps.cityList();
    cities.forEach((city, ci) => {
        const visits = deps.cityViewItems(ci).length;
        if (visits >= 2) repeatCities += 1;
        if (visits > topCityVisits) {
            topCityVisits = visits;
            topCityName = city.city || '';
        }
    });
    if (topCityName && topCityVisits >= 2) {
        list.push('在 ' + m.cityCount + ' 座城市里，' + topCityName + ' 是你回去最多的地方（' +
            topCityVisits + ' 次），有些地方就是值得反复抵达。');
    }
    if (repeatCities >= 2) {
        list.push('有 ' + repeatCities + ' 座城市你去过两次以上，它们大概更像「老地方」。');
    }

    if (longest) {
        list.push('走得最远的一次，是从' + insightPlaceName(longest.from) + '到' +
            insightPlaceName(longest.to) + '，约 ' + insightKm(longest.km) + ' 公里。');
    }
    if (segment && segment.count >= 2 && segment.average > 0) {
        list.push('平均每一段约 ' + insightKm(segment.average) +
            ' 公里，步子不算大，但一直没有停下来过。');
    }

    // 收藏：照片和票根都有就合起来说，只有一样时只说那一样
    if (m.ticketCount && m.photoCount) {
        list.push(m.photoCount + ' 张照片、' + m.ticketCount +
            ' 张票根，你不仅出发，也把它们都妥帖地留了下来。');
    } else {
        list.push(m.ticketCount
            ? '你还留下了 ' + m.ticketCount + ' 张票根，每一次出发都被妥帖地收着。'
            : m.photoCount + ' 张照片被好好收着，' +
                (m.photoCount > 1 ? '它们替你说着' : '它替你说着') + '当时的光线与心情。');
    }
    if (m.photoCount - m.footprintCount >= 2) {
        list.push('照片比足迹多出 ' + (m.photoCount - m.footprintCount) +
            ' 张 —— 有些地方，你显然舍不得只拍一张。');
    }

    if (time && time.spanDays > 0) {
        list.push('从 ' + insightSpotDate(time.first) + ' 到 ' + insightSpotDate(time.last) + '，' +
            (time.spanYears > 0
                ? time.spanYears + ' 年 ' + time.restDays + ' 天'
                : time.spanDays + ' 天') +
            '的光阴，被你拆成了 ' + time.monthCount + ' 个月的出发。');
    }
    if (years.length >= 2) {
        const busiest = years.reduce((best, item) =>
            item.footprints > best.footprints ? item : best, years[0]);
        list.push(busiest.year + ' 年是你出发最多的一年，一共 ' + busiest.footprints +
            ' 次，那一年你把地图铺得最开。');
    }
    if (title) {
        list.push('按现在的记录，你担得起「' + title + '」—— 这不是标签，是你自己走出来的。');
    }
    return list.length ? list : ['还没有足迹数据，出发后回来看看你的旅行洞察。'];
}
