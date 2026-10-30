/**
 * 数据聚合：把足迹按省份聚成一本本书、按城市聚成章节。
 */

import { api } from './utils.js';

// ---------------- 数据聚合 ----------------

// 省 -> 书。分组键优先用 provinceAdcode，省名只作为兜底与展示，
// 因为 province 是后台可自由编辑的文本（"云南" / "云南省" 会裂成两本书）。
export function buildBookList() {
    var d = api();
    if (!d) return [];
    var footprints = d.footprints() || [];
    var groups = new Map();

    footprints.forEach(function (fp) {
        var raw = String(fp.province || '').trim();
        var normalized = d.normalizeProvinceName(raw) || raw;
        if (!normalized) return;
        var adcode = String(fp.provinceAdcode || '').trim();
        var key = adcode || normalized;
        if (!groups.has(key)) {
            groups.set(key, { key: key, adcode: adcode, names: new Map(), items: [] });
        }
        var group = groups.get(key);
        if (adcode && !group.adcode) group.adcode = adcode;
        group.items.push(fp);
        group.names.set(normalized, (group.names.get(normalized) || 0) + 1);
    });

    var books = [];
    groups.forEach(function (group) {
        // 省名取组内出现最多的写法
        var name = '';
        var best = 0;
        group.names.forEach(function (count, candidate) {
            if (count > best) { best = count; name = candidate; }
        });

        // 一律按 createTime 倒序（决策 3 / 14 都基于这个顺序）
        var items = group.items.slice().sort(descByTime);

        var photoCount = 0;
        items.forEach(function (fp) { photoCount += d.cityWallImages(fp).length; });

        // 封面：该省最新的、真的有图的那条足迹的第一张图（画廊优先、主图兜底）
        var cover = firstImageOf(d, items);

        books.push({
            key: group.key,
            name: name,
            adcode: group.adcode,
            cities: buildCityList(d, items),
            cityCount: 0,
            photoCount: photoCount,
            latestTime: items.length ? String(items[0].createTime || '') : '',
            yearRange: yearRangeOf(items),
            cover: cover,
            items: items
        });
    });

    books.forEach(function (book) { book.cityCount = book.cities.length; });
    // 封面顶部那行：这本书收了哪几年，「2019」或「2019–2025」
    books.sort(function (a, b) {
        return String(b.latestTime || '').localeCompare(String(a.latestTime || '')) ||
            String(a.name).localeCompare(String(b.name), 'zh-CN');
    });
    return books;
}

function descByTime(a, b) {
    return String(b.createTime || '').localeCompare(String(a.createTime || ''));
}

function firstImageOf(d, items) {
    for (var i = 0; i < items.length; i++) {
        var images = d.cityWallImages(items[i]);
        if (images.length && images[0] && images[0].url) return images[0].url;
    }
    return '';
}

function buildCityList(d, items) {
    var groups = new Map();
    items.forEach(function (fp) {
        var key = d.cityKeyOf(fp) || String(fp.city || '').trim();
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { key: key, names: new Map(), items: [] });
        var group = groups.get(key);
        group.items.push(fp);
        var label = String(fp.city || '').trim() || '未分类';
        group.names.set(label, (group.names.get(label) || 0) + 1);
    });

    var cities = [];
    groups.forEach(function (group) {
        var name = '';
        var best = 0;
        group.names.forEach(function (count, candidate) {
            if (count > best) { best = count; name = candidate; }
        });
        var list = group.items.slice().sort(descByTime);
        var photoCount = 0;
        list.forEach(function (fp) { photoCount += d.cityWallImages(fp).length; });
        cities.push({
            key: group.key,
            name: name,
            count: list.length,
            photoCount: photoCount,
            latestTime: list.length ? String(list[0].createTime || '') : '',
            cover: firstImageOf(d, list),
            items: list
        });
    });

    cities.sort(function (a, b) {
        return String(b.latestTime || '').localeCompare(String(a.latestTime || '')) ||
            String(a.name).localeCompare(String(b.name), 'zh-CN');
    });
    return cities;
}


// 一组足迹的年份范围：「2023」或「2019–2025」；没有日期时为空串
function yearRangeOf(items) {
    var years = items
        .map(function (fp) { return Number(String(fp.createTime || '').slice(0, 4)); })
        .filter(function (y) { return y > 1900; });
    if (!years.length) return '';
    var min = Math.min.apply(null, years);
    var max = Math.max.apply(null, years);
    return min === max ? String(min) : min + '–' + max;
}
