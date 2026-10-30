/**
 * 测绘手簿式的数据写法：坐标写成度分、日期跨度写成年月。
 *
 * 纯函数，不碰 DOM。首屏、卡片、洞察都用同一套写法，免得同一个坐标在三处写成三个样子。
 */

/** 把十进制度数写成「30°15′」：度取整，分四舍五入；分进位到 60 时进一度。 */
function degMin(value) {
    const abs = Math.abs(value);
    let deg = Math.floor(abs);
    let min = Math.round((abs - deg) * 60);
    if (min === 60) {
        deg += 1;
        min = 0;
    }
    return deg + '°' + String(min).padStart(2, '0') + '′';
}

/** 纬度：北纬 / 南纬，例如「北纬 45°48′」。 */
export function formatLatitude(lat) {
    if (!Number.isFinite(lat)) return '';
    return (lat >= 0 ? '北纬 ' : '南纬 ') + degMin(lat);
}

/** 经度：东经 / 西经，例如「东经 126°32′」。 */
export function formatLongitude(lng) {
    if (!Number.isFinite(lng)) return '';
    return (lng >= 0 ? '东经 ' : '西经 ') + degMin(lng);
}

/** 一组 YYYY-MM-DD 日期的跨度：「2019 年 3 月至今」/「2019 年 3 月 到 2025 年 12 月」/ 只有一天时写那一天所在月。 */
export function formatDateSpan(dates, today = new Date()) {
    const sorted = dates.filter((d) => /^\d{4}-\d{2}/.test(d)).sort();
    if (!sorted.length) return '';
    const ym = (d) => {
        const [y, m] = d.split('-');
        return Number(y) + ' 年 ' + Number(m) + ' 月';
    };
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first.slice(0, 7) === last.slice(0, 7)) return ym(first);
    // 最近一次在 90 天内，就写「至今」：手簿上的记录还在继续
    const lastTime = new Date(last + 'T00:00:00').getTime();
    if (Number.isFinite(lastTime) && today.getTime() - lastTime < 90 * 86400000) return ym(first) + '至今';
    return ym(first) + ' 到 ' + ym(last);
}
