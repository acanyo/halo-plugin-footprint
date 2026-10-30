/**
 * 页内容组装：一本书 / 一本相册各有哪些页、每页画什么。
 */

import { state } from './state.js';
import { api, formatMonth, formatDate } from './utils.js';
import {
    assignPageSides,
    BOOK_ALBUM_PER_PAGE,
    TOC_CITY_ROW_H,
    TOC_POINT_ROW_H
} from './typography.js';
import { collectPhotos } from './album.js';
import { PAGE_ROWS } from './book-rig.js';

// ---------------- 页内容组装 ----------------

export function bookPageSpecs(book) {
    // 页序按真实书本排：左页是偶数页，右页是奇数页
    var pages = [];
    pages.push({
        // 封面内侧那页：照片 + 省名 + 统计。城市名单搬到对面的「目录」去了，
        // 免得同一串名字在一个跨页里印两遍。
        kind: 'cover', title: book.name, subtitle: '', kicker: book.yearRange || '',
        image: null, photo: book.cover,
        stats: [
            { value: book.cityCount, label: '座城市' },
            { value: book.photoCount, label: '张照片' }
        ],
        headLeft: book.name, headRight: book.name
    });
    // 目录：城市 → 该城市下面的**足迹点**。这是"真目录"的样子：
    // 城市行 = 序号 + 城市名 + 点线 + 页码区间；足迹点行缩进排在它下面。
    // 和后面的城市章节页不再重复：章节页是"带日期与张数的可点列表"，
    // 目录是"索引 + 每个足迹点落在第几页"。
    // 相册页序：扉页算第 1 页，之后每 BOOK_ALBUM_PER_PAGE 张照片一页，
    // 所以第 i 张照片在 1 + floor(i / 每页张数) 页（0 基）。
    // ⚠️ 城市内容和省份内容现在是**同一本书**（见文件末尾 buildCityBlock），
    // 页码是连续的：先排封面 / 目录 / 城市章节，再一座城一座城地排
    // 「扉页 + 照片页 + 尾页」。所以页码必须等页排完才知道 —— 这里先占位，
    // 最后用 fillTocPageNumbers() 按实际下标回填。
    var TOC_POINTS_MAX = 8;            // 单座城市最多列几个足迹点，多了折成一行
    var TOC_PAGE_BUDGET = 356;         // 目录页竖向可用高度（逻辑 px）
    var cityBlocks = [];
    book.cities.forEach(function (city, ci) {
        var block = {
            city: city,
            cityIndex: ci,
            items: [],                          // 每个足迹点：标题 / 描述 / 自己的照片
            photos: collectPhotos(city),
            firstPage: 0, lastPage: 0,      // 由 fillTocPageNumbers 回填（0 基页号）
            points: []
        };
        var photoIndex = 0;
        (city.items || []).forEach(function (fp) {
            var urls = [];
            try {
                urls = (api() ? api().cityWallImages(fp) : [])
                    .map(function (im) { return im && im.url; })
                    .filter(Boolean);
            } catch (e) { urls = []; }
            var item = {
                name: fp && fp.name ? String(fp.name) : '未命名足迹',
                time: fp && fp.createTime ? formatDate(fp.createTime) : '',
                address: fp && fp.address ? String(fp.address) : '',
                desc: fp && fp.description ? String(fp.description) : '',
                shots: urls.map(function (url, k) {
                    return {
                        url: url,
                        time: fp && fp.createTime ? String(fp.createTime) : '',
                        no: photoIndex + k + 1
                    };
                }),
                pageIndex: 0
            };
            photoIndex += Math.max(1, urls.length);
            block.items.push(item);
            block.points.push({
                name: fp && fp.name ? String(fp.name) : '未命名足迹',
                time: fp && fp.createTime ? formatDate(fp.createTime) : '',
                item: item
            });
        });
        cityBlocks.push(block);
    });
    // 一页放不下就把城市块分到下一页（一个城市的块不拆开）
    var tocPages = [];
    var acc = [];
    var used = 0;
    cityBlocks.forEach(function (block) {
        var shown = block.points.slice(0, TOC_POINTS_MAX);
        var extra = block.points.length > shown.length ? 1 : 0;
        var blockH = TOC_CITY_ROW_H + (shown.length + extra) * TOC_POINT_ROW_H;
        if (acc.length && used + blockH > TOC_PAGE_BUDGET) { tocPages.push(acc); acc = []; used = 0; }
        acc.push({ block: block, shown: shown });
        used += blockH;
    });
    if (acc.length) tocPages.push(acc);
    var tocPage = pages.length;           // 「目录」第一页的下标（面包屑里省那段翻到它）
    tocPages.forEach(function (list) {
        var rows = [];
        list.forEach(function (item) {
            item.block.tocRows = item.block.tocRows || [];
            rows.push({
                kind: 'city',
                no: String(item.block.cityIndex + 1).padStart(2, '0'),
                name: item.block.city.name,
                right: '',                       // 页码区间由 fillTocPageNumbers 回填
                city: item.block.city,
                block: item.block,
                pageIndex: 0
            });
            item.block.tocRows.push(rows[rows.length - 1]);
            item.shown.forEach(function (point) {
                rows.push({
                    kind: 'point',
                    name: point.name,
                    sub: point.time,
                    right: '',                   // 同上
                    city: item.block.city,
                    block: item.block,
                    pointItem: point.item,       // 指向这个足迹点自己那一页
                    pageIndex: 0
                });
                item.block.tocRows.push(rows[rows.length - 1]);
            });
            var hidden = item.block.points.length - item.shown.length;
            if (hidden > 0) {
                rows.push({
                    kind: 'point', name: '…另有 ' + hidden + ' 个足迹点',
                    sub: '', right: '', city: item.block.city,
                    block: item.block, pageIndex: 0
                });
                item.block.tocRows.push(rows[rows.length - 1]);
            }
        });
        pages.push({
            kind: 'contents', title: book.name,
            cities: book.cities,
            rows: rows,
            note: '共 ' + book.cityCount + ' 座城市，' + book.photoCount + ' 张照片',
            headLeft: book.name, headRight: book.name
        });
    });
    var chunk = PAGE_ROWS;
    var chaptersPage = pages.length;      // 「城市章节」第一页的下标（面包屑里省那段要翻到它）
    for (var i = 0; i < book.cities.length || i === 0; i += chunk) {
        var slice = book.cities.slice(i, i + chunk);
        if (!slice.length) break;
        pages.push({
            eyebrow: '城市章节', title: book.name,
            cities: slice,
            rows: slice.map(function (city, k) {
                return {
                    no: String(i + k + 1).padStart(2, '0'),
                    name: city.name,
                    sub: city.latestTime ? formatMonth(city.latestTime) : '时间未记录',
                    right: city.photoCount + ' 张'
                };
            }),
            headLeft: book.name, headRight: book.name
        });
    }
    // ===== 每座城市的内容**就排在这本书里**（扉页 + 照片页），不另换一套页集 =====
    // 这是用户要的：点目录不该像"刷新"一样换内容，页码也不该重置。
    // 所以这里把每个城市块接在城市章节之后，页码一路排下去；点目录时只是翻页。
    cityBlocks.forEach(function (block) {
        var photos = block.photos;
        var times = photos.map(function (p) { return p.time; }).filter(Boolean).sort();
        var rangeText = times.length
            ? (formatMonth(times[0]) +
                (times.length > 1 && formatMonth(times[times.length - 1]) !== formatMonth(times[0])
                    ? ' – ' + formatMonth(times[times.length - 1]) : ''))
            : (block.city.latestTime ? formatMonth(block.city.latestTime) : '');
        block.firstPage = pages.length;          // 扉页的下标
        pages.push({
            kind: 'title', title: block.city.name, range: rangeText, kicker: book.name,
            statsLine: '共 ' + photos.length + ' 张照片',
            photo: photos.length ? photos[0].url : '', image: null,
            headLeft: book.name, headRight: block.city.name,
            city: block.city, cityPage: block.firstPage
        });
        // 每个足迹点：**自己一页**（标题 + 描述 + 卷首图），照片按点分组排在它后面
        block.items.forEach(function (item) {
            item.pageIndex = pages.length;
            pages.push({
                kind: 'spot', title: item.name, kicker: block.city.name,
                spotName: item.name,             // 面包屑用：这个点自己的名字
                desc: item.desc, date: item.time, address: item.address,
                statsLine: item.shots.length
                    ? '共 ' + item.shots.length + ' 张照片' : '这条足迹没有照片',
                photo: item.shots.length ? item.shots[0].url : '', image: null,
                headLeft: book.name, headRight: block.city.name,
                city: block.city, cityPage: block.firstPage
            });
            for (var pi = 0; pi < item.shots.length || pi === 0; pi += BOOK_ALBUM_PER_PAGE) {
                var shotSlice = item.shots.slice(pi, pi + BOOK_ALBUM_PER_PAGE);
                if (!shotSlice.length) break;
                pages.push({
                    kind: 'photo', title: block.city.name,
                    // 照片页也带上所在足迹点的名字：否则「点在点页上显示、
                    // 一翻到它的照片就消失」，同一个点内部来回翻会一直抖
                    spotName: item.name,
                    photoTotal: item.shots.length,
                    shots: shotSlice,
                    headLeft: book.name, headRight: block.city.name,
                    city: block.city, cityPage: block.firstPage
                });
            }
        });
        block.lastPage = pages.length - 1;       // 这座城市最后一张照片页
    });
    // 尾页：一行总数 + 出处。一页就把这本书收住了。
    pages.push({
        kind: 'colophon',
        headline: book.cityCount + ' 座城市，' + book.photoCount + ' 张照片',
        lines: ['《' + book.name + '》', todayCn() + '整理'],
        headLeft: book.name, headRight: book.name
    });
    return finishPageSpecs(fillTocPageNumbers(pages, cityBlocks), chaptersPage, tocPage);
}

export function albumPageSpecs(book, city) {
    var photos = state.photoList || [];
    // 时间范围：这叠照片里最早 / 最晚的两条记录（题记那句先不做，见 todo）
    var times = photos.map(function (p) { return p.time; })
        .filter(Boolean).sort();
    var rangeText = times.length
        ? (formatMonth(times[0]) + (times.length > 1 && formatMonth(times[times.length - 1]) !== formatMonth(times[0])
            ? ' – ' + formatMonth(times[times.length - 1]) : ''))
        : (city.latestTime ? formatMonth(city.latestTime) : '');
    // 第 0 页是城市扉页：城市名 + 时间范围 + 卷首图 + 照片数（纯排版页）
    var pages = [{
        kind: 'title',
        kicker: book.name,
        title: city.name,
        range: rangeText,
        statsLine: '共 ' + photos.length + ' 张照片',
        photo: photos.length ? photos[0].url : '',
        image: null,
        headLeft: book.name, headRight: city.name
    }];
    // 照片页：一页 BOOK_ALBUM_PER_PAGE 张（默认 2），一跨四张 —— 翻页次数减半
    for (var i = 0; i < photos.length || i === 0; i += BOOK_ALBUM_PER_PAGE) {
        var slice = photos.slice(i, i + BOOK_ALBUM_PER_PAGE);
        if (!slice.length) break;
        pages.push({
            kind: 'photo',
            title: city.name,
            photoTotal: photos.length,
            shots: slice.map(function (item, k) {
                return { url: item.url, time: item.time || '', no: i + k + 1 };
            }),
            headLeft: book.name, headRight: city.name
        });
    }
    pages.push({
        kind: 'colophon',
        headline: photos.length + ' 张照片',
        lines: ['《' + city.name + '》旅行相册',
            rangeText ? '记录于 ' + rangeText : '',
            todayCn() + '整理'].filter(Boolean),
        headLeft: book.name, headRight: city.name
    });
    return finishPageSpecs(pages);
}

// 一叠页的收尾：标左右页 + 排页码。
// 封面内侧那页不排页码；扉页（frontispiece）照真书惯例也不排。
// 目录页码回填：页排完之后才知道每座城市的扉页/最后一张照片页落在第几页，
// 这时再写回目录的「第 x–y 页」和每个足迹点的页码，以及点它该翻到哪一跨。
// 页码用**这本书自己的页号**（1 基），跨页号 = floor(页下标 / 2)。
function fillTocPageNumbers(pages, blocks) {
    blocks.forEach(function (block) {
        (block.tocRows || []).forEach(function (row) {
            if (row.kind === 'city') {
                row.right = '第 ' + (block.firstPage + 1) + '–' + (block.lastPage + 1) + ' 页';
                row.pageIndex = block.firstPage;
            } else if (row.pointItem) {
                // 足迹点行现在指向**这个点自己的那一页**（标题 + 描述）
                row.pageIndex = row.pointItem.pageIndex || block.firstPage;
                row.right = '第 ' + (row.pageIndex + 1) + ' 页';
            } else {
                row.pageIndex = block.firstPage;      // "…另有 N 个" 折行 → 落在扉页
            }
            row.spread = Math.floor(row.pageIndex / 2);
            row.city = block.city;
        });
        block.tocRows = null;
    });
    return pages;
}

// chaptersPage：可选。带上之后，每一页都知道"城市章节"在第几页 ——
// 面包屑里省那一段点下去就能**翻页过去**（和城市段一样），而不是重载页集硬切。
function finishPageSpecs(pages, chaptersPage, tocPage) {
    assignPageSides(pages);
    pages.forEach(function (spec, index) {
        if (chaptersPage !== undefined) spec.chaptersPage = chaptersPage;
        if (tocPage !== undefined) spec.tocPage = tocPage;
        // 只跳过封面内侧那页；城市扉页（title）以前也不排页码，
        // 用户反馈"城市旅行记忆那页下面没有页码"，所以现在照排。
        if (index === 0) return;
        spec.pageNo = index + 1;
    });
    return pages;
}

// 尾页那行「整理时间」照书里的日期口径写法（2026 年 9 月 28 日），
// 不用 2026.09.28 —— 那个点号看着像文件名，不像一本书的末页
function todayCn() {
    var d = new Date();
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}
