/* ==========================================================================
   世界这本书（memory-shelf.js）

   主题：把「去过的省份」做成书架上的一本本布面精装书，翻开看城市章节，再进旅行相册。
   三层共用一个全屏覆盖层：书架（Three.js 真实书体）-> 城市章节（DOM 纸张）-> 旅行相册（DOM 翻页）。

   依赖：
   - travel-memory.js 暴露的 window.FootprintMemoryData（只读取值函数，见该文件末尾）；
   - 懒加载的 three.js（static/vendor/three/three.min.js，UMD 全局 THREE）。

   边界：
   - 只在桌面端出现入口（非触摸 + 宽度 > 820），与省份城市卡片 / 照片环同惯例；
   - 不复制任何第三方仓库源码，书体几何、程序化纹理、动画时间线均为本项目自写。
   ========================================================================== */

(function () {
    'use strict';

    // ---------------- 常量 ----------------

    var ENTRY_MIN_WIDTH = 821;            // 与 PROVINCE_CARD_MIN_WIDTH / photo-ring 的门控一致
    var ALBUM_PER_PAGE = 1;               // 每页照片数（左右对开 => 一屏 2 张）
    var LONG_PRESS_MS = 180;              // 长按多久进入「旋转书本」模式
    var ROTATE_LIMIT = 65;                // 书本左右旋转上限（度）
    var OPEN_ANIM_MS = 1080;              // 抬起 -> 推近 -> 翻封面的总时长

    // 书脊布面色：青蓝 / 赭红 / 亚麻 / 橄榄绿 / 芥末金 / 深胡桃，冷暖交替
    // [封面布色, 书页边色, 烫金墨色, 点缀色]
    var BOOK_COLORS = [
        ['#3d7285', '#e9e2cf', '#f3ecd7', '#8fb9c6'],
        ['#a4523a', '#ece5d1', '#f6efdb', '#c98f76'],
        ['#d5c5a0', '#efe9d8', '#513d28', '#b5a077'],
        ['#67754a', '#eae3ce', '#f2ecd8', '#93a37a'],
        ['#a07938', '#ece5d1', '#faf4e0', '#c9a75e'],
        ['#5c4a37', '#e9e1cd', '#f0e7d0', '#8c7455']
    ];

    // 烫金用的金属色，与上面六组布面一一对应。
    // **不能**复用 BOOK_COLORS 里的第三项：那一项是「印在布上的墨色」，
    // 大多数接近白的米色；而金属的颜色就取自反照率，近白的金属反射出来
    // 是抛光银 —— 烫金会整片变银。这里另给一组真正的金色。
    // （色值保持不变：让"金字看不清"的不是颜色，是下面材质里的 metalness ——
    //   高金属度在这间屋子里反射不到足够的光，会把亮金渲成一片中暗调。）
    var FOIL_COLORS = [
        '#c9a24a',   // 青蓝布 -> 暖金
        '#d8b268',   // 赭红布 -> 亮金
        '#8f6f33',   // 亚麻布（浅）-> 深金 / 古铜
        '#c6a850',   // 橄榄绿 -> 暖金
        '#dcbd76',   // 芥末金 -> 浅金
        '#c8a257'    // 深胡桃 -> 暖金
    ];

    // ==========================================================================
    // 房间配色（照 complete-shelf 的 applyBookTheme）
    // --------------------------------------------------------------------------
    // 参考实现里每本书都带一整套 palette：墙直接刷成书的布色（Codex 那本是深蓝
    // 墙、Cursor 是黄绿墙），地面、木架、主光、补光、轮廓光、雾全部跟着换，
    // 所以翻到下一本时"换的不是一本书，是整间屋子"。
    //
    // 我们的底板是浅色书房（纸色 + 木色，前台信息板压深墨字），不能直接照抄
    // 那套饱和墙色，否则顶栏和提示文字立刻糊在深墙上。这里改成**把布色按固定
    // 比例调进纸色**：
    //     wall  = 纸色 66% + 布色 34%      floor = 纸色 78% + 布色 22%
    //     wood  = 木色 86% + 布色 14%      light/fill 也都沾一点布色
    // 比例是算出来的、不是挑出来的，所以六套配色一定在同一个明度区间里，
    // 深色墨字（--ms-ink #2f2a24）压在墙上始终是对比度足够的浅底。
    // ==========================================================================
    var ROOM_BASE = {
        paper: '#f4eddd',       // 墙的底：暖白纸
        // 地的底。**必须比纸页明显深**：之前地面渲染出来是 240 亮度、书页是 238，
        // 两者几乎同色，用户看到的就是"书页和地面糊在一起"。
        // 参考实现的地面（#d8c8aa）本来就比墙（#e9dfcb）深一档，这里按同一个关系再压深，
        // 渲染后大约 190，和纸页（≈238）、墙（≈208）都拉得开。
        floorPaper: '#d2c4a6',
        wood: '#c9a877',        // 木架亮部
        woodDark: '#8a6a3c',    // 木架暗部（前缘压条 / 立柱 / 背挡）
        light: '#fff3dd',       // 暖主光
        fill: '#dfe7ea'         // 冷补光
    };

    function hexToRgb(hex) {
        var value = String(hex).replace('#', '');
        if (value.length === 3) {
            value = value.charAt(0) + value.charAt(0) + value.charAt(1) +
                value.charAt(1) + value.charAt(2) + value.charAt(2);
        }
        var num = parseInt(value, 16);
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    // 两色线性插值，返回 #rrggbb 字符串。
    function mixHex(from, to, t) {
        var a = hexToRgb(from);
        var b = hexToRgb(to);
        var mix = function (x, y) { return Math.round(x + (y - x) * t); };
        return '#' + [mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b)].map(function (value) {
            return ('0' + value.toString(16)).slice(-2);
        }).join('');
    }

    // 感知亮度（0~1）。用来判断"这组配色的烫金比布亮还是比布暗" ——
    // 烫金该怎么渲染完全取决于这个（见 buildRig 里 foilMaterial 那段）。
    function hexLum(hex) {
        var c = hexToRgb(hex);
        return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    }

    // 第 index 本书对应的屋子配色。除了布色，其余全部由 ROOM_BASE 混出来，
    // 保证六套配色的明度关系一致（换书时不会忽明忽暗）。
    function roomTint(index, key) {
        var total = BOOK_COLORS.length;
        var fabric = BOOK_COLORS[((index % total) + total) % total][0];
        var foil = FOIL_COLORS[((index % total) + total) % total];
        switch (key) {
            case 'wall': return mixHex(ROOM_BASE.paper, fabric, 0.34);
            case 'floor': return mixHex(ROOM_BASE.floorPaper, fabric, 0.34);
            case 'wood': return mixHex(ROOM_BASE.wood, fabric, 0.14);
            case 'woodDark': return mixHex(ROOM_BASE.woodDark, fabric, 0.18);
            case 'light': return mixHex(ROOM_BASE.light, fabric, 0.10);
            case 'fill': return mixHex(ROOM_BASE.fill, fabric, 0.18);
            case 'fog': return mixHex(ROOM_BASE.paper, fabric, 0.30);
            case 'rim': return foil;
            // 信息板/纸张用的两个色：面板强调色与分隔金线，跟着书走
            case 'accent': return mixHex('#9b704e', fabric, 0.45);
            case 'gold': return foil;
            default: return fabric;
        }
    }

    // three 现在由页面里的 importmap + module 脚本装好并挂到 window.THREE，
    // 这里只负责「等它出现」——不再自己插 <script> 去拉 UMD 版。
    var THREE_WAIT_TRIES = 200;     // 200 × 50ms = 10 秒

    // ---------------- 状态 ----------------

    var state = {
        level: 'shelf',        // shelf | chapters | album
        mode: 'shelf',         // shelf(在书架上) | book(已经翻开成三维书本)
        // 显式五态（照参考实现 shelf → opening → inspection → reading → closing）。
        // 行为不变，只是把原来散在 mode / level / opening / closing 里的状态收敛成
        // 一个字段，便于在边缘场景（快速连点、抛飞、中途反向拖拽）判断当前处于哪一态。
        phase: 'shelf',
        bookLevel: 'chapters', // book 模式下的层级：chapters | album
        bookPages: [],
        bookTextures: [],
        bookSpread: 0,
        pageTurn: null,        // { forward, p, target, dragging, next }
        bookDrag: null,
        bookEnterAt: 0,
        bookOpen: 0,           // 封面的掀开程度 0..1
        openTarget: 0,         // 封面目标开合度：点击/拖拽决定
        coverHover: false,
        coverDrag: null,
        orbit: null,
        // 检视态的相机：绕书旋转 / 平移 / 缩放（规格要求背景可 orbit、pan、zoom）
        view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
        photoList: [],
        books: [],
        active: 0,
        province: null,
        city: null,
        photos: [],
        page: 0,
        paging: false,
        opening: false,
        bookRotation: null,    // null = 未在旋转；数值 = 当前角度（度）
        suppressClickUntil: 0,
        wheelAt: 0,
        turning: false,
        photoIndex: 0,
        timers: {}
    };

    var els = {};
    var shelf = null;          // Three.js 运行时上下文
    var threePromise = null;
    var renderer3d = null;
    var version = '';
    var reduceMotion = false;
    var preheated = false;
    var maxAnisotropy = 4;      // 渲染器就绪后取硬件上限，用于页面贴图

    // ---------------- 纸尘（照 complete-shelf 的 addDust） ----------------
    // 棚里飘的一点浮尘。它给的是：110 个点、种子随机分布在一个长方体里、
    // 暖褐色、size 0.014、透明度 0.3、不写深度；动画只有极慢的自转与上下浮动。
    // 纵向按"相对书心"换算（它的书心 y≈1.45，我的 ≈0.15，减 1.30）。
    function addDust(THREE, scene) {
        var count = 110;
        var positions = new Float32Array(count * 3);
        var seed = 20260728;
        var random = function () {          // 与它同款的确定性随机，保证每次布局一致
            seed = (seed * 1831565813 + 1) >>> 0;
            var t = seed;
            t = Math.imul(t ^ (t >>> 15), 1 | t);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        for (var i = 0; i < count; i++) {
            positions[i * 3] = (random() - 0.5) * 14;
            positions[i * 3 + 1] = (0.7 + random() * 4.7) - 1.3;
            positions[i * 3 + 2] = -1.7 + random() * 4;
        }
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        var material = new THREE.PointsMaterial({
            color: 0xc3a97b,
            size: 0.014,
            transparent: true,
            opacity: 0.3,
            depthWrite: false
        });
        var dust = new THREE.Points(geometry, material);
        dust.name = 'paper-dust';
        scene.add(dust);
        return dust;
    }

    function updateDust(dust, elapsed) {
        if (!dust || reduceMotion) return;
        dust.rotation.y = elapsed * 0.012;
        dust.position.y = Math.sin(elapsed * 0.17) * 0.025;
    }

    // ---------------- 小工具 ----------------

    function $(id) { return document.getElementById(id); }

    function api() { return window.FootprintMemoryData || null; }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 2026-03-05 -> 2026 年 3 月
    function formatMonth(value) {
        var m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
        if (!m) return '';
        return m[1] + ' 年 ' + Number(m[2]) + ' 月';
    }

    // 2026-03-05 -> 2026.03.05
    function formatDate(value) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
        if (!m) return formatMonth(value) || '时间未记录';
        return m[1] + '.' + m[2] + '.' + m[3];
    }

    // ---------------- 内页版式：左右页分家 ----------------
    // 一页的版心边距。side 由页序奇偶决定（见 assignPageSides）：
    // 左页的订口在右边、右页的订口在左边，所以内侧比外侧多 PAGE_GUTTER_EXTRA。
    // side 缺省（'center'）时退回对称版心 —— 书脊/封底那些独立贴图也走这条。
    function pageMargins(side) {
        if (side !== 'left' && side !== 'right') {
            return { left: PAGE_MARGIN.left, right: PAGE_MARGIN.right,
                     top: PAGE_MARGIN.top, bottom: PAGE_MARGIN.bottom };
        }
        var outer = Math.min(PAGE_MARGIN.left, PAGE_MARGIN.right);
        var inner = Math.max(PAGE_MARGIN.left, PAGE_MARGIN.right) + PAGE_GUTTER_EXTRA;
        return side === 'right'
            ? { left: inner, right: outer, top: PAGE_MARGIN.top, bottom: PAGE_MARGIN.bottom }
            : { left: outer, right: inner, top: PAGE_MARGIN.top, bottom: PAGE_MARGIN.bottom };
    }

    // 给一叠页按奇偶标上左右：第 2s 页在左（含封面内侧那页）、第 1+2s 页在右。
    // 书眉与页码都靠它决定"往哪一侧对齐"（真书是外侧对齐）。
    function assignPageSides(pages) {
        pages.forEach(function (spec, index) {
            spec.side = index % 2 === 0 ? 'left' : 'right';
        });
        return pages;
    }

    function palette(index) {
        return BOOK_COLORS[((index % BOOK_COLORS.length) + BOOK_COLORS.length) % BOOK_COLORS.length];
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function lerp(from, to, t) {
        return from + (to - from) * t;
    }

    function smoothstep(t) {
        var v = clamp(t, 0, 1);
        return v * v * (3 - 2 * v);
    }

    function nameSizeClass(name) {
        var len = String(name || '').length;
        if (len > 7) return ' extra-long';
        if (len > 4) return ' long';
        return '';
    }

    function clearTimer(key) {
        if (state.timers[key]) {
            clearTimeout(state.timers[key]);
            state.timers[key] = 0;
        }
    }

    function setTimer(key, fn, ms) {
        clearTimer(key);
        state.timers[key] = setTimeout(fn, ms);
    }

    function enabled() {
        if (window.matchMedia('(pointer: coarse)').matches) return false;
        if ('ontouchstart' in window && window.matchMedia('(hover: none)').matches) return false;
        return window.innerWidth >= ENTRY_MIN_WIDTH;
    }

    // ---------------- 数据聚合 ----------------

    // 省 -> 书。分组键优先用 provinceAdcode，省名只作为兜底与展示，
    // 因为 province 是后台可自由编辑的文本（"云南" / "云南省" 会裂成两本书）。
    function buildBookList() {
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
                cover: cover,
                items: items
            });
        });

        books.forEach(function (book) { book.cityCount = book.cities.length; });
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

    // ---------------- three.js 懒加载 ----------------

    function ensureThree() {
        if (window.THREE) return Promise.resolve(window.THREE);
        if (threePromise) return threePromise;
        threePromise = new Promise(function (resolve, reject) {
            var tries = 0;
            var timer = setInterval(function () {
                if (window.THREE) {
                    clearInterval(timer);
                    resolve(window.THREE);
                    return;
                }
                if (++tries > THREE_WAIT_TRIES) {
                    clearInterval(timer);
                    reject(new Error('three 模块加载超时'));
                }
            }, 50);
        });
        // 失败后允许下次重试，不然一次网络抖动就永久降级到 CSS 书架
        threePromise.catch(function () { threePromise = null; });
        return threePromise;
    }

    function preheat() {
        if (preheated) return;
        preheated = true;
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(function () { ensureThree().catch(function () {}); }, { timeout: 3000 });
        } else {
            setTimeout(function () { ensureThree().catch(function () {}); }, 1200);
        }
    }

    // 各本书封面用的那张照片先拉下来：省份信息页上的照片是异步解码的，
    // 第一次翻开书时往往还没到，那一页看起来就是"空的"。
    // 书架一建好就可以开始，等用户点开书时通常已经在缓存里了。
    function preloadCoverPhotos() {
        var d = api();
        if (!d || !d.cityCardImageUrl || !d.canvasSafeImageUrl) return;
        (state.books || []).forEach(function (item) {
            if (!item.cover) return;
            var url = d.cityCardImageUrl(item.cover) || item.cover;
            var safe = d.canvasSafeImageUrl(url);
            if (safe) loadImage(safe).catch(function () { /* 慢图床失败就在翻页时再试 */ });
        });
    }

    // ---------------- 程序化纹理 ----------------

    var clothCache = new Map();      // 布色 -> { map, bump }，6 组配色最多 6 份

    function makeCanvas(w, h) {
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        return canvas;
    }

    // 布面：底色 + 经纬织纹 + 细颗粒。albedo 与 bump 一次生成，按色缓存复用。
    function clothTextures(THREE, hex) {
        if (clothCache.has(hex)) return clothCache.get(hex);

        var size = 256;
        // 布纹用「经 + 纬 + 斜」三道正弦叠出来的高度场，再推法线和粗糙度 ——
        // 这是 complete-shelf 的 clothSurfaceMaps 的做法。我原来是每 3px 一条
        // 横线加一条竖线的**硬网格**，近看就是纱窗/马赛克，塑料感就是从这儿来的。
        var height = new Float32Array(size * size);
        var phase = ((hex.charCodeAt(1) || 0) % 19) * 0.23;   // 用颜色当种子，同一块布稳定
        for (var hy = 0; hy < size; hy++) {
            for (var hx = 0; hx < size; hx++) {
                var warp = Math.sin((hx + phase) * Math.PI * 0.52);
                var weft = Math.sin((hy - phase) * Math.PI * 0.41);
                var cross = Math.sin((hx + hy + phase) * Math.PI * 0.19);
                height[hy * size + hx] = 0.5 + warp * 0.18 + weft * 0.15 + cross * 0.045;
            }
        }
        var base = new THREE.Color(hex);

        // 反照率：布色 × 高度场的微弱明暗（不是画线，是让经纬本身有色差）
        var albedo = makeCanvas(size, size);
        var a = albedo.getContext('2d');
        var albedoImage = a.createImageData(size, size);
        for (var ai = 0; ai < size * size; ai++) {
            var k = 0.93 + height[ai] * 0.15;
            albedoImage.data[ai * 4] = Math.max(0, Math.min(255, Math.round(base.r * 255 * k)));
            albedoImage.data[ai * 4 + 1] = Math.max(0, Math.min(255, Math.round(base.g * 255 * k)));
            albedoImage.data[ai * 4 + 2] = Math.max(0, Math.min(255, Math.round(base.b * 255 * k)));
            albedoImage.data[ai * 4 + 3] = 255;
        }
        a.putImageData(albedoImage, 0, 0);
        // 一点点绒毛/杂质，避免过于规整
        for (var n = 0; n < 2200; n++) {
            a.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
            a.fillRect(Math.random() * size, Math.random() * size, 1, 1);
        }

        // 高度图本身当 bump 用
        var bump = makeCanvas(size, size);
        var b = bump.getContext('2d');
        var bumpImage = b.createImageData(size, size);
        for (var bi = 0; bi < size * size; bi++) {
            var bv = Math.round(height[bi] * 255);
            bumpImage.data[bi * 4] = bumpImage.data[bi * 4 + 1] = bumpImage.data[bi * 4 + 2] = bv;
            bumpImage.data[bi * 4 + 3] = 255;
        }
        b.putImageData(bumpImage, 0, 0);

        // 法线：对高度场求梯度（和参考一样的两点差分）
        var normalCanvas = makeCanvas(size, size);
        var nctx = normalCanvas.getContext('2d');
        var dst = nctx.createImageData(size, size);
        var at = function (x, y) {
            return height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
        };
        for (var ny = 0; ny < size; ny++) {
            for (var nx = 0; nx < size; nx++) {
                var ddx = (at(nx + 1, ny) - at(nx - 1, ny)) * 1.5;
                var ddy = (at(nx, ny + 1) - at(nx, ny - 1)) * 1.5;
                var len = Math.sqrt(ddx * ddx + ddy * ddy + 1);
                var o = (ny * size + nx) * 4;
                dst.data[o] = Math.round((-ddx / len * 0.5 + 0.5) * 255);
                dst.data[o + 1] = Math.round((-ddy / len * 0.5 + 0.5) * 255);
                dst.data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
                dst.data[o + 3] = 255;
            }
        }
        nctx.putImageData(dst, 0, 0);

        // 粗糙度：跟着高度走 —— 布面明暗不均匀的关键，塑料没有这一项
        var roughCanvas = makeCanvas(size, size);
        var rctx = roughCanvas.getContext('2d');
        var rd = rctx.createImageData(size, size);
        for (var ri = 0; ri < size * size; ri++) {
            var v = Math.round(188 + height[ri] * 56);
            rd.data[ri * 4] = rd.data[ri * 4 + 1] = rd.data[ri * 4 + 2] = v;
            rd.data[ri * 4 + 3] = 255;
        }
        rctx.putImageData(rd, 0, 0);

        var result = {
            map: new THREE.CanvasTexture(albedo),
            bump: new THREE.CanvasTexture(bump),
            normal: new THREE.CanvasTexture(normalCanvas),
            roughness: new THREE.CanvasTexture(roughCanvas)
        };
        result.normal.wrapS = result.normal.wrapT = THREE.RepeatWrapping;
        result.roughness.wrapS = result.roughness.wrapT = THREE.RepeatWrapping;
        result.map.colorSpace = THREE.SRGBColorSpace;
        result.map.wrapS = result.map.wrapT = THREE.RepeatWrapping;
        result.bump.wrapS = result.bump.wrapT = THREE.RepeatWrapping;
        result.map.anisotropy = 8;
        result.bump.anisotropy = 8;
        result.normal.anisotropy = 8;
        result.roughness.anisotropy = 8;
        // 织纹要够密：书在检视态会放大到 3 倍以上，1 倍多的重复会把
        // 每根经纬线拉成粗格子，整块封板看起来像马赛克
        result.map.repeat.set(5, 8);
        result.bump.repeat.copy(result.map.repeat);
        result.normal.repeat.copy(result.map.repeat);
        result.roughness.repeat.copy(result.map.repeat);
        clothCache.set(hex, result);
        return result;
    }

    // 书封：布面底 + 烫金细框 + 书名 + 封面照片 + 底部元信息。
    // 单独拆出一个「重绘」函数：封面照片是异步加载的，加载完要在同一张 canvas 上重画一次。
    // foilOnly=true 时只在**透明底**上画出烫金部分（画成白色，颜色交给材质），
    // 用于单独一层金属烫金网格；false 时是完整的布面封面。
    // ==========================================================================
    // A1 · 统一的排版规范（模块级：页面、书脊、封底这些"有文字的画布"共用一套）
    // --------------------------------------------------------------------------
    // M    = 版心边距（逻辑坐标 400×564 下）
    // TYPE = 字阶：书名 / 章节名 / 照片页标题 / 正文 / 图注 / 书眉页码 / 序号
    //        + 封面页专用的大号几档（display / subName / label / eyebrow / tiny）
    // 放在这里而不是 paintPage 里面：书脊与封底贴图的绘制函数也要用同一套，
    // 放函数里它们取不到（这会直接抛 ReferenceError，整个书架起不来）。
    // ==========================================================================
    var PAGE_MARGIN = { left: 26, right: 26, top: 46, bottom: 40 };
    // 小字用的黑体栈（内页的图注 / 日期 / 标签 / 书眉 / 页码）。见 TYPE 里的说明：
    // 宋体细横在缩小采样后发灰，小字必须走黑体才清楚。
    var SANS = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", ' +
        '"Source Han Sans SC", "Hiragino Sans GB", sans-serif';
    // 订口（内侧）比外缘再多留的宽度：翻开之后文字不会挤进书脊那道暗角里。
    // 左右页由**页序的奇偶**决定（第 2s 页在左、第 1+2s 页在右），见 assignPageSides()。
    var PAGE_GUTTER_EXTRA = 9;
    // 3D 相册每页放几张照片（一个跨页两页 → 一跨 4 张，翻页次数减半）。
    // ⚠️ DOM 版相册另有 ALBUM_PER_PAGE（那个按每页 1 张，用户明确要求过），两套互不影响。
    var BOOK_ALBUM_PER_PAGE = 2;
    // 目录页的行高（逻辑 px）：城市行高、它下面的足迹点行矮。
    // 这两个数 **paintPage 和 bookPageSpecs 都要用**（一个画、一个分页），
    // 必须放模块级 —— 放进 bookPageSpecs 里 paintPage 取不到，会直接抛 ReferenceError，
    // 整本书都画不出来。
    var TOC_CITY_ROW_H = 34;
    var TOC_POINT_ROW_H = 22;
    // 封面内侧那页（书摊开时永远在左半）内容要往订口方向收多少：
    // 翻过去的纸比封面小一圈，外缘本来就露出一条封面内侧（参考实现也是），
    // 把内容让开这么宽之后，翻页之后正好被纸盖住 —— 露出来的只有空白纸边。
    // 0.186 世界单位 ≈ 页宽的 12.5% ≈ 400 逻辑 px × 0.125 ≈ 50，留到 60 更稳。
    var COVER_OUTER_SAFE = 60;
    var TYPE = {
        book: '700 34px "Songti SC", "SimSun", serif',
        head: '600 21px "Songti SC", "SimSun", serif',
        title: '600 25px "Songti SC", "SimSun", serif',
        // ⚠️ 小字一律走**黑体**（微软雅黑 / 苹方），不要用宋体：
        // 宋体的横是发丝级的细线，页面在屏幕上只有约 500px 高、贴图要经 mipmap
        // 缩小 2.8 倍，细横一缩就发灰 —— 用户反复反馈的"文字不清晰"就是这个，
        // 不是分辨率不够（2.5 倍贴图余量充足）。中文书也本来就是
        // 正文宋体、图注/标签黑体的排法。
        // 字号保持原样（用户明确要求别再放大），只换字体 + 加粗：
        // 清晰度靠"黑体 + 更重的字重"，不靠字号。
        body: '600 17px ' + SANS,
        meta: '600 15px ' + SANS,
        folio: '600 16px ' + SANS,
        index: '700 18px ' + SANS,
        eyebrow: '700 13px ' + SANS,
        display: '600 42px "Songti SC", "SimSun", serif',
        subName: '600 28px "Songti SC", serif',
        // 最小一档保持 14px（上上轮定的大小），只加粗 + 换黑体
        tiny: '600 14px ' + SANS,
        label: '700 14px ' + SANS,
        // 封面底部那两行元信息（城市数/照片数、时间）。
        // ⚠️ 这里**不能**用 Georgia 之类的西文衬线打头：那会让数字命中西文字体、
        // 中文落到宋体，两套字体在**同一行**里的基线落点不同 —— 看起来就是
        // "数字偏下、没和文字对齐"。统一走 CJK 字体，数字与中文出自同一套字形。
        coverMeta: '500 19px "Songti SC", "SimSun", serif',
        coverMetaSmall: '500 15px "Songti SC", "SimSun", serif',
        // 封面元信息里的**西文段**（数字、字母、半角符号）：保留 Georgia 的观感，
        // 但绘制时按"对齐到中文基线"做微调 —— 见 drawMixedLine
        coverMetaLatin: '500 19px Georgia, "Times New Roman", serif',
        coverMetaLatinSmall: '500 15px Georgia, "Times New Roman", serif'
    };

    // 封面元信息的西文基线微调（px，负数=把数字往上抬）。
    // 两套字体在同一个 em 盒里的字形落点不同：同一行里数字会比中文低一截，
    // 所以给西文段单独一个偏移。控制台里也能调：
    //     window.FOOTPRINT_META_LATIN_SHIFT = -4   // 然后重开一次书架即生效
    var META_LATIN_SHIFT = -3;

    // 把一行中英文混排的文字切成"西文段 / 中文段"
    function mixedRuns(text, latinFont, cjkFont) {
        var runs = [];
        var current = null;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            var isCjk = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch);
            if (!current || current.latin === isCjk) {
                current = { text: ch, latin: !isCjk, font: isCjk ? cjkFont : latinFont };
                runs.push(current);
            } else {
                current.text += ch;
            }
        }
        return runs;
    }

    // 在 canvas 上居中画一行中西混排文字：西文段用西文字体并**单独加基线偏移**，
    // 中文段用中文字体原位画 —— 这样既有西文数字的形，数字又与中文齐平。
    function drawMixedLine(ctx, runs, centerX, y, alpha) {
        var shift = (typeof window.FOOTPRINT_META_LATIN_SHIFT === 'number')
            ? window.FOOTPRINT_META_LATIN_SHIFT : META_LATIN_SHIFT;
        var total = 0;
        runs.forEach(function (run) {
            ctx.font = run.font;
            total += ctx.measureText(run.text).width;
        });
        var x = centerX - total / 2;
        var prevAlpha = ctx.globalAlpha;
        if (alpha !== undefined) ctx.globalAlpha = alpha;
        ctx.textAlign = 'left';
        runs.forEach(function (run) {
            ctx.font = run.font;
            ctx.fillText(run.text, x, y + (run.latin ? shift : 0));
            x += ctx.measureText(run.text).width;
        });
        ctx.globalAlpha = prevAlpha;
        ctx.textAlign = 'center';
    }

    function paintCover(canvas, book, index, foilOnly) {
        // 逻辑坐标固定 384×576，画布可以是它的整数倍。
        // 参考实现的封面/烫金都是 768 的，我们原来是 384 —— 贴到 1.5×2.2 的书面上
        // 就是"糊"，近看立刻露馅（这正是"模型不够真实"里最直接的一条）。
        var w = 384;
        var h = 576;
        var ctx = canvas.getContext('2d');
        ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
        var colors = palette(index);
        ctx.clearRect(0, 0, w, h);

        if (!foilOnly) {
            ctx.fillStyle = colors[0];
            ctx.fillRect(0, 0, w, h);

            // 布纹（比 3D 贴图更淡，避免远景摩尔纹）
            for (var y = 0; y < h; y += 3) {
                ctx.fillStyle = 'rgba(255,255,255,0.028)';
                ctx.fillRect(0, y, w, 1);
            }
            for (var x = 0; x < w; x += 3) {
                ctx.fillStyle = 'rgba(0,0,0,0.03)';
                ctx.fillRect(x, 0, 1, h);
            }
        }

        // 烫金细框
        ctx.strokeStyle = foilOnly ? '#ffffff' : colors[2];
        // 框线原来只有 1.5px、透明度 0.55，投到封面上是一道很细的暗线；
        // 现在加粗提亮，才是"烫金细框"而不是"黑边"。
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2.4;
        ctx.strokeRect(22.5, 22.5, w - 45, h - 45);
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 0.9;
        ctx.strokeRect(19, 19, w - 38, h - 38);
        ctx.globalAlpha = 1;

        // 顶部小字
        ctx.fillStyle = foilOnly ? '#ffffff' : colors[2];
        ctx.globalAlpha = 0.86;
        ctx.font = '600 15px "Songti SC", "SimSun", serif';
        ctx.textAlign = 'center';
        ctx.fillText('旅 行 手 册', w / 2, 66);
        ctx.globalAlpha = 0.4;
        ctx.fillRect(w / 2 - 34, 80, 68, 1);
        ctx.globalAlpha = 1;

        // 书名（按字数自适应 + 逐字换行）
        var chars = String(book.name || '').split('');
        var titleSize = chars.length > 7 ? 42 : chars.length > 4 ? 52 : 62;
        ctx.font = '600 ' + titleSize + 'px "Songti SC", "SimSun", serif';
        ctx.fillStyle = foilOnly ? '#ffffff' : colors[2];
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lines = chars.length > 4 ? 2 : 1;
        var perLine = Math.ceil(chars.length / lines);
        for (var li = 0; li < lines; li++) {
            var text = chars.slice(li * perLine, (li + 1) * perLine).join('');
            if (!text) continue;
            ctx.fillText(text, w / 2, 132 + li * (titleSize + 10));
        }

        // 副标题：紧贴在书名下方，再往下才是照片位
        var titleBlockBottom = 132 + lines * (titleSize + 10);
        ctx.globalAlpha = 0.6;
        ctx.font = '500 15px "Songti SC", "SimSun", serif';
        ctx.fillText('私人旅行纪念册', w / 2, titleBlockBottom - 4);
        ctx.globalAlpha = 1;

        var photoTop = titleBlockBottom + 22;
        var photoHeight = h - photoTop - 108;

        // 照片位（未加载完成时先留一块布色底）；烫金层只画它外圈的金边
        if (!foilOnly) {
            ctx.save();
            roundRect(ctx, 40, photoTop, w - 80, photoHeight, 4);
            ctx.clip();
            ctx.fillStyle = 'rgba(0,0,0,0.16)';
            ctx.fillRect(40, photoTop, w - 80, photoHeight);
            if (book._coverImage) {
                drawCover(ctx, book._coverImage, 40, photoTop, w - 80, photoHeight);
            }
            ctx.restore();
        }
        ctx.strokeStyle = foilOnly ? '#ffffff' : colors[2];
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.strokeRect(40.5, photoTop + 0.5, w - 81, photoHeight - 1);
        ctx.globalAlpha = 1;

        // 底部元信息（城市数 / 照片数 / 时间）：**不烫金**，是印在布面上的小字 ——
        // 真实精装书的这一栏本来就是印上去的版权/印次信息，不是烫金。
        // 之前它在布面层和烫金层各画了一遍（金层又描一道），所以看着"又糊又像金"。
        // 现在只在布面这层画（foilOnly 直接跳过），并换成"数字用西文衬线 + 中文用宋体"
        // 的两段式排版：数字字距略开、标签更小更淡，中间压一条细线分隔。
        if (!foilOnly) {
            // 排版保持原来的两行（上一版我拆成三行，反而把版面弄乱了）。
            // 只做两件事：① 不在烫金层里画（现在这栏是印在布面上的字）；
            // ② 字体换成"数字走西文衬线、中文走宋体"的一套真实字体栈。
            ctx.fillStyle = colors[2];
            ctx.textBaseline = 'alphabetic';
            // 数字走 Georgia（西文衬线的观感）、中文走宋体，西文段单独做基线偏移，
            // 这样数字不再比中文低一截（见 drawMixedLine）
            drawMixedLine(ctx,
                mixedRuns(book.cityCount + ' 座城市 · ' + book.photoCount + ' 张照片',
                    TYPE.coverMetaLatin, TYPE.coverMeta),
                w / 2, h - 60, 0.9);
            drawMixedLine(ctx,
                mixedRuns(formatMonth(book.latestTime) || '时间未记录',
                    TYPE.coverMetaLatinSmall, TYPE.coverMetaSmall),
                w / 2, h - 34, 0.66);
            ctx.globalAlpha = 1;
        }

    }

    function coverTexture(THREE, book, index) {
        var canvas = makeCanvas(768, 1152);
        paintCover(canvas, book, index);
        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 16;      // 封面是斜看的，细字/金线靠它才不糊
        texture._canvas = canvas;
        // 封面照片到位后重画，不重建贴图
        texture._repaint = function () {
            paintCover(canvas, book, index);
            texture.needsUpdate = true;
        };
        return texture;
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // 把照片按「覆盖」方式画进指定矩形（保持比例，裁掉多余）
    function drawCover(ctx, image, dx, dy, dw, dh) {
        var iw = image.naturalWidth || image.width;
        var ih = image.naturalHeight || image.height;
        if (!iw || !ih) return;
        var scale = Math.max(dw / iw, dh / ih);
        var sw = dw / scale;
        var sh = dh / scale;
        var sx = (iw - sw) / 2;
        var sy = (ih - sh) / 2;
        ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    // 书脊：竖排书名 + 序号
    function spineTexture(THREE, book, index) {
        // 同上：逻辑坐标 96×576，画布按倍率放大（参考实现书脊贴图是 384 宽）
        var w = 96;
        var h = 576;
        var canvas = makeCanvas(384, 1152);
        var ctx = canvas.getContext('2d');
        ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
        var colors = palette(index);

        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, w, h);
        for (var y = 0; y < h; y += 3) {
            ctx.fillStyle = 'rgba(255,255,255,0.03)';
            ctx.fillRect(0, y, w, 1);
        }

        // 横向明暗渐变 —— 这是"书脊像不像参考"的关键一步。
        // complete-shelf 的书脊贴图最外层就是从 0 到 1 的一条渐变：
        // 两侧压暗、靠前 1/4 处一条亮带。书脊轮廓虽然是平的，靠这条渐变
        // 才读得出「中间鼓起来」的圆弧感。我之前完全没有它，于是书脊就是
        // 一块死平的布板。
        var shade = ctx.createLinearGradient(0, 0, w, 0);
        // 书脊的圆弧明暗。用户连提两轮"中间还是少一段、不够宽"：
        // 根因是我这条渐变**不对称** —— 亮峰压在左边 18%~45%，中段和右侧偏暗，
        // 看过去就像中间断了一截。真实圆脊是"中线最亮、往两侧对称衰减"，
        // 所以改成中间一条很宽的平台，两侧再压深。
        shade.addColorStop(0, 'rgba(0,0,0,0.34)');
        shade.addColorStop(0.06, 'rgba(0,0,0,0.10)');
        shade.addColorStop(0.16, 'rgba(255,255,255,0.10)');
        shade.addColorStop(0.32, 'rgba(255,255,255,0.17)');
        shade.addColorStop(0.5, 'rgba(255,255,255,0.19)');
        shade.addColorStop(0.68, 'rgba(255,255,255,0.17)');
        shade.addColorStop(0.84, 'rgba(255,255,255,0.10)');
        shade.addColorStop(0.94, 'rgba(0,0,0,0.10)');
        shade.addColorStop(1, 'rgba(0,0,0,0.30)');
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, w, h);

        // 布面纤维：几百根短的经纬线头。**这是"书脊上有没有凹凸"的关键**——
        // 参考实现的 makeSpineTexture 就是画这个（线宽 0.45~1.15、alpha 0.018~0.056）。
        // 之前我只画了每 3px 一条的横线，量出来高频能量只有 0.1~0.7，等于一片平布，
        // 所以"序号到省份名称之间"那一整段看不到任何纹理。
        var seed = 1;
        var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        for (var f = 0; f < 1100; f++) {
            var fx = rnd() * w;
            var fy = rnd() * h;
            var vertical = rnd() > 0.42;
            ctx.strokeStyle = rnd() > 0.5
                ? 'rgba(255,255,255,' + (0.05 + rnd() * 0.075).toFixed(3) + ')'
                : 'rgba(0,0,0,' + (0.05 + rnd() * 0.06).toFixed(3) + ')';
            ctx.lineWidth = 0.5 + rnd() * 0.8;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(vertical ? fx + (rnd() - 0.5) * 0.9 : fx + 1.5 + rnd() * 5,
                       vertical ? fy + 1.5 + rnd() * 6 : fy + (rnd() - 0.5) * 0.9);
            ctx.stroke();
        }

        // 底部压暗（照参考：0.82 到 1 的一条渐变）
        var bottomShade = ctx.createLinearGradient(0, h * 0.82, 0, h);
        bottomShade.addColorStop(0, 'rgba(0,0,0,0)');
        bottomShade.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = bottomShade;
        ctx.fillRect(0, h * 0.82, w, h * 0.18);

        // **这里不再画任何字**。书脊上的序号/书名/框线全部只画在烫金层里，
        // 否则布面上那层"白字"会和金层叠在一起 —— 用户看到的"白色和金色
        // 两套字体"就是这个：金层描一遍、布面又描一遍，金边外面露出一圈白。

        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 16;      // 书脊竖排书名同样容易糊
        return texture;
    }

    // 书脊烫金层：透明底 + 白色字，交给材质上金色
    function spineFoilTexture(THREE, book, index) {
        var w = 96;
        var h = 576;
        var canvas = makeCanvas(384, 1152);
        var ctx = canvas.getContext('2d');
        ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.5;
        // 书脊整圈烫金框（和 spineTexture 同一套坐标）
        ctx.globalAlpha = 0.62;
        ctx.lineWidth = 1.8;
        ctx.strokeRect(7, 13, w - 14, h - 26);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.82;
        ctx.font = '600 20px "Songti SC", serif';
        ctx.fillText(String(index + 1).padStart(2, '0'), w / 2, 62);
        ctx.globalAlpha = 1;
        var chars = String(book.name || '').split('');
        var available = h - 190;
        // 与布面层不再重复：这里**是唯一**画书脊文字的地方
        var step = Math.min(64, available / Math.max(1, chars.length));
        var size = Math.min(46, step * 0.8);
        ctx.font = '600 ' + size + 'px "Songti SC", "SimSun", serif';
        var startY = h / 2 - (chars.length - 1) * step / 2;
        for (var i = 0; i < chars.length; i++) ctx.fillText(chars[i], w / 2, startY + i * step);
        ctx.globalAlpha = 0.6;
        ctx.font = TYPE.tiny;
        ctx.fillText('旅行记忆', w / 2, h - 64);
        ctx.globalAlpha = 1;
        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 16;
        return texture;
    }

    // 封底：一块布面 + 一枚小的烫金印记，和正面区分开
    function backCoverTexture(THREE, book, index) {
        var w = 384;
        var h = 576;
        var canvas = makeCanvas(w, h);
        var ctx = canvas.getContext('2d');
        var colors = palette(index);
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, w, h);
        for (var y = 0; y < h; y += 3) {
            ctx.fillStyle = 'rgba(255,255,255,0.028)';
            ctx.fillRect(0, y, w, 1);
        }
        ctx.strokeStyle = colors[2];
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(30.5, 30.5, w - 61, h - 61);
        ctx.globalAlpha = 1;
        // 下部一枚小印记
        ctx.fillStyle = colors[2];
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(w / 2, h - 96, 15, 0, Math.PI * 2);
        ctx.strokeStyle = colors[2];
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = '600 13px "Songti SC", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('旅', w / 2, h - 95);
        ctx.globalAlpha = 0.55;
        ctx.font = TYPE.tiny;
        // 封底同一行也走混排绘制，和封面保持一致（偏移按字号等比缩小）
        ctx.globalAlpha = 1;
        drawMixedLine(ctx,
            mixedRuns(book.cityCount + ' 座城市 · ' + book.photoCount + ' 张照片',
                TYPE.coverMetaLatinSmall, TYPE.tiny),
            w / 2, h - 60, 0.55);
        ctx.globalAlpha = 1;
        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        return texture;
    }

    // 书口：细密横向纸纹
    var pageEdgeCache = null;

    function pageEdgeTexture(THREE) {
        if (pageEdgeCache) return pageEdgeCache;
        // 分辨率提到 192×768（参考实现书口贴图是 512×2048）：
        // 书口那块只有 0.3 个世界单位宽，贴图糊一点就全平了。
        var w = 192;
        var h = 768;
        var canvas = makeCanvas(w, h);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#efe8d8';
        ctx.fillRect(0, 0, w, h);
        // 纸边细线要"数得出来"。
        // 原来是每 2px 一根、纹理再 repeat 4 次 —— 等于上千根挤在书口上，
        // 渲染出来就是一片均匀的糊色（正对书口时尤其明显）。
        // 现在每 6px 一根、不再重复，约 40 根，并穿插几根更深的"订口"，
        // 近看是一条条纸页，远看是纸口质感。
        for (var y = 0; y < h; y += 18) {
            var sig = (y / 18) % 7 === 3;
            ctx.fillStyle = sig ? 'rgba(96,82,62,0.5)' : 'rgba(126,112,90,0.32)';
            ctx.fillRect(0, y, w, sig ? 4 : 2);
            ctx.fillStyle = 'rgba(255,251,242,0.45)';
            ctx.fillRect(0, y + (sig ? 4 : 2), w, 2);
        }
        pageEdgeCache = new THREE.CanvasTexture(canvas);
        pageEdgeCache.colorSpace = THREE.SRGBColorSpace;
        pageEdgeCache.wrapS = pageEdgeCache.wrapT = THREE.RepeatWrapping;
        pageEdgeCache.repeat.set(1, 1);
        return pageEdgeCache;
    }

    // 木架：横向木纹（反照率 / 粗糙度 / 法线）
    var woodCache = null;
    // 书脚接触阴影用的软椭圆贴图（中心淡黑、边缘透明），和 reference 的接触阴影同一思路
    var contactShadowCache = null;
    function contactShadowMaterial(THREE) {
        if (contactShadowCache) return contactShadowCache;
        var size = 128;
        var canvas = makeCanvas(size, size);
        var ctx = canvas.getContext('2d');
        var grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        // 淡淡的就好：0.34 的浓度在亮色板面上看着像"贴了一块"。现在 0.2 起
        grad.addColorStop(0, 'rgba(60,44,26,0.2)');
        grad.addColorStop(0.45, 'rgba(60,44,26,0.11)');
        grad.addColorStop(0.78, 'rgba(60,44,26,0.03)');
        grad.addColorStop(1, 'rgba(60,44,26,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        contactShadowCache = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            opacity: 0.9
        });
        return contactShadowCache;
    }

    // 木架贴图：反照率 + 粗糙度 + 法线三张。
    // 原来只有 256×64 的一张色图（比封面贴图低一个数量级），所以近看就是"刷了漆的板子"。
    // 现在按木头的成因画：底色随长度缓慢明暗 → 顺纹曲线 → 木节 → 顺纹高光，
    // 再由高度场推粗糙度和法线（和书脊布面那套做法一样）。
    function woodMaps(THREE) {
        if (woodCache) return woodCache;
        var w = 1024;
        var h = 256;
        var canvas = makeCanvas(w, h);
        var ctx = canvas.getContext('2d');

        var seed = 20260924;
        var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

        // 底色：暖棕色，沿长度方向做几段明暗（像不同木料拼板）
        ctx.fillStyle = '#9c7137';
        ctx.fillRect(0, 0, w, h);
        for (var b = 0; b < 7; b++) {
            var bx = (b / 7) * w;
            var bw = w / 7;
            ctx.fillStyle = 'rgba(' + (150 + Math.round(rnd() * 40)) + ',' +
                (105 + Math.round(rnd() * 26)) + ',' + (50 + Math.round(rnd() * 22)) + ',0.35)';
            ctx.fillRect(bx, 0, bw, h);
        }

        // 高度场：顺纹为主，叠一点宽年轮
        var height = new Float32Array(w * h);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var grain = Math.sin((y + Math.sin(x * 0.008) * 6) * 0.55);
                var ring = Math.sin((y * 0.14 + x * 0.004));
                height[y * w + x] = 0.5 + grain * 0.16 + ring * 0.06;
            }
        }

        // 顺纹线条：细长、颜色深浅相间
        for (var i = 0; i < 320; i++) {
            var gy = rnd() * h;
            var dark = rnd() > 0.45;
            ctx.strokeStyle = dark
                ? 'rgba(58,38,14,' + (0.06 + rnd() * 0.16).toFixed(3) + ')'
                : 'rgba(255,238,206,' + (0.05 + rnd() * 0.14).toFixed(3) + ')';
            ctx.lineWidth = 0.6 + rnd() * 2.2;
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.bezierCurveTo(w * 0.28, gy + (rnd() - 0.5) * 7,
                w * 0.72, gy + (rnd() - 0.5) * 7, w, gy + (rnd() - 0.5) * 3);
            ctx.stroke();
        }

        // 木节：几个同心椭圆
        for (var k = 0; k < 3; k++) {
            var kx = rnd() * w, ky = rnd() * h;
            for (var ring2 = 5; ring2 >= 1; ring2--) {
                ctx.strokeStyle = ring2 % 2
                    ? 'rgba(62,40,16,' + (0.10 + 0.03 * ring2).toFixed(3) + ')'
                    : 'rgba(214,178,124,0.16)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.ellipse(kx, ky, ring2 * 7, ring2 * 4.2, 0.3, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // 顺纹高光带（板面靠上一条更亮、更"油"的地方）
        var sheenBand = ctx.createLinearGradient(0, 0, 0, h);
        sheenBand.addColorStop(0, 'rgba(255,240,212,0.14)');
        sheenBand.addColorStop(0.42, 'rgba(255,240,212,0.03)');
        sheenBand.addColorStop(1, 'rgba(46,28,8,0.16)');
        ctx.fillStyle = sheenBand;
        ctx.fillRect(0, 0, w, h);

        var map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.anisotropy = 8;

        // 粗糙度：木纹深的地方更粗糙
        var roughCanvas = makeCanvas(w, h);
        var rctx = roughCanvas.getContext('2d');
        var rd = rctx.createImageData(w, h);
        for (var ri = 0; ri < w * h; ri++) {
            var v = Math.round(196 + (0.5 - Math.abs(height[ri] - 0.5)) * 90);
            rd.data[ri * 4] = rd.data[ri * 4 + 1] = rd.data[ri * 4 + 2] = v;
            rd.data[ri * 4 + 3] = 255;
        }
        rctx.putImageData(rd, 0, 0);
        var roughness = new THREE.CanvasTexture(roughCanvas);
        roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
        roughness.anisotropy = 8;

        // 法线：从高度场求梯度
        var normalCanvas = makeCanvas(w, h);
        var nctx = normalCanvas.getContext('2d');
        var nd = nctx.createImageData(w, h);
        var at = function (x, y) {
            return height[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
        };
        for (var ny = 0; ny < h; ny++) {
            for (var nx = 0; nx < w; nx++) {
                var dx = (at(nx + 1, ny) - at(nx - 1, ny)) * 1.2;
                var dy = (at(nx, ny + 1) - at(nx, ny - 1)) * 1.2;
                var len = Math.sqrt(dx * dx + dy * dy + 1);
                var o = (ny * w + nx) * 4;
                nd.data[o] = Math.round((-dx / len * 0.5 + 0.5) * 255);
                nd.data[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
                nd.data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
                nd.data[o + 3] = 255;
            }
        }
        nctx.putImageData(nd, 0, 0);
        var normal = new THREE.CanvasTexture(normalCanvas);
        normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
        normal.anisotropy = 8;

        woodCache = { map: map, roughness: roughness, normal: normal };
        return woodCache;
    }

    // ---------------- 书体几何 ----------------

    // 圆角矩形**平面**（照参考实现的 createRoundedPlaneGeometry）。
    // ---------------------------------------------------------------------------

    // 封面图案层、烫金层、环衬都用它：参考里这些贴面全是圆角的，
    // 用方角平面盖在圆角封板上，四个角会露出一点点没被盖住的边。
    function roundedPlaneGeometry(THREE, width, height, radius) {
        var halfW = width * 0.5;
        var halfH = height * 0.5;
        var corner = Math.min(radius, halfW, halfH);
        var shape = new THREE.Shape();
        shape.moveTo(-halfW + corner, -halfH);
        shape.lineTo(halfW - corner, -halfH);
        shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + corner);
        shape.lineTo(halfW, halfH - corner);
        shape.quadraticCurveTo(halfW, halfH, halfW - corner, halfH);
        shape.lineTo(-halfW + corner, halfH);
        shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - corner);
        shape.lineTo(-halfW, -halfH + corner);
        shape.quadraticCurveTo(-halfW, -halfH, -halfW + corner, -halfH);
        var geometry = new THREE.ShapeGeometry(shape, 8);
        var position = geometry.getAttribute('position');
        var uv = new Float32Array(position.count * 2);
        for (var i = 0; i < position.count; i++) {
            uv[i * 2] = (position.getX(i) + halfW) / width;
            uv[i * 2 + 1] = (position.getY(i) + halfH) / height;
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geometry.computeVertexNormals();
        return geometry;
    }

    var BOOK_W = 1.5;
    // 参考七本的平均尺度（用来定比例尺与兜底尺寸）
    var REF_W = 1.029;
    var REF_H = 1.56;
    var REF_T = 0.263;
    // 参考实现七本书**各有各的宽高厚**（照抄它的 BOOKS）：
    //     codex 1.02×1.58×0.26 / claude 1.10×1.46×0.29 / cursor 0.92×1.52×0.22 /
    //     antigravity 1.08×1.68×0.25 / figma 1.00×1.48×0.30 / framer 0.96×1.57×0.24 /
    //     xcode 1.12×1.63×0.28
    // 宽高比 0.605~0.753。我们按索引轮着用，相邻两本比例不同 —— 整排书才会像
    // 参考那样有节奏，而不是一排一模一样的方块。（尺寸按比例尺放大，构造常数不变，
    // 这一点和参考一致：它的封板/书脊/包边是绝对尺寸，不随书的宽高变。）
    var BOOK_SIZES = [
        [1.02, 1.58, 0.26],
        [1.10, 1.46, 0.29],
        [0.92, 1.52, 0.22],
        [1.08, 1.68, 0.25],
        [1.00, 1.48, 0.30],
        [0.96, 1.57, 0.24],
        [1.12, 1.63, 0.28]
    ];
    // ==========================================================================
    // 书体构造：**把参考实现的绝对尺寸按同一个比例尺放大**
    // --------------------------------------------------------------------------
    // complete-shelf 的七本书是 1.02~1.12 宽 × 1.46~1.68 高（平均 1.08 × 1.59），
    // 它把全部构造细节写死在这个尺度上：
    //     封板 0.032、书脊宽 0.082、书脊板 0.014、书芯 0.27、
    //     页比封面窄 0.074 / 矮 0.068、封面图案内缩 0.007、环衬内缩 0.045、
    //     包边 0.018、封板圆角 0.0045、合页沟宽 0.012 / 距书脊 0.038
    // 我们的书是 1.5 × 2.2（宽高比 0.682，正好落在它七本的区间里），
    // 所以把这些常数**乘同一个比例尺**（1.5 / 1.08 ≈ 1.39）—— 之前是直接照抄
    // 那些绝对值，等于"书放大了、细节没跟着放大"，封板/书脊/包边全都偏薄，
    // 立体感和参考差一截。
    // 唯一**故意不跟**的是书脊板厚：用户两轮反馈原尺寸太薄，这里保持加厚后的 0.026。
    // ==========================================================================
    var REF_SCALE = BOOK_W / REF_W;             // ≈ 1.458
    // 兜底尺寸 = 参考七本的平均值 × 比例尺（没指定尺寸的书用它）
    var BOOK_H = REF_H * REF_SCALE;
    var BOOK_T = REF_T * REF_SCALE;             // 书芯厚度（不含封板）
    var BOARD_T = 0.032 * REF_SCALE;            // 封板厚度
    var SPINE_W = 0.082 * REF_SCALE;            // 书脊宽度
    var SPINE_BOARD = 0.026;                    // 书脊板厚（用户要求：比参考厚）
    var PAGE_DEPTH = BOOK_T - 0.026 * REF_SCALE;
    // 书页比封面小多少（参考：宽 0.074 / 高 0.068，形成"封面外伸"）
    var PAGE_INSET_W = 0.074 * REF_SCALE;
    // 上下留边（封面比页高的那圈）比参考再收一点：参考 0.068 是在它 1.56 高的书上，
    // 我们的书在画面里更高，同样的比例换算出来"上下的纸边离封面太远"很明显。
    var PAGE_INSET_H = 0.05 * REF_SCALE;
    // 封板四角圆角（参考 coverRadius 0.0045）
    var COVER_RADIUS = 0.0045 * REF_SCALE;
    // 封面图案层相对封板的内缩（参考 coverArtInset 0.007）与环衬内缩（0.045）
    var ART_INSET = 0.007 * REF_SCALE;
    var ENDPAPER_INSET = 0.045 * REF_SCALE;
    // 合页沟（hinge groove）：宽 0.012、距书脊 0.038（参考值 × 比例尺）
    var GROOVE_W = 0.012 * REF_SCALE;
    var GROOVE_X = 0.038 * REF_SCALE;
    // 封面内侧的包边（turn-in）宽度。它是**封面边缘**与**内侧纸页边缘**之间
    // 那圈布边的宽度，两处必须用同一个值，否则中间会露出一道封面图案。
    var TURN_IN = 0.018 * REF_SCALE;
    var PLANK_TOP = -1.16;          // 木板顶面高度：所有书都按这个高度「落座」
    // 搁板厚度。参考的 walnut-shelf 是 0.28（书高 1.46 → 板厚约占 19%），
    // 我原来只有 0.2（书高 2.2 → 只占 9%），板子明显偏薄、没有"木搁板"的份量。
    // 对齐到参考的绝对值 0.28。
    var PLANK_H = 0.28;

    // 精装书封板：只有外侧两角是圆角，靠书脊那一侧保持直角 —— 真实硬壳书就是这样。
    // 用 Shape + ExtrudeGeometry 挤出，自带一圈小倒角，边缘能吃到光，比纯 Box 真实得多。
    function boardGeometry(THREE, width, height, depth, radius) {
        var x0 = -width / 2;
        var x1 = width / 2;
        var y0 = -height / 2;
        var y1 = height / 2;
        var shape = new THREE.Shape();
        shape.moveTo(x0, y0);
        shape.lineTo(x1 - radius, y0);
        shape.quadraticCurveTo(x1, y0, x1, y0 + radius);
        shape.lineTo(x1, y1 - radius);
        shape.quadraticCurveTo(x1, y1, x1 - radius, y1);
        shape.lineTo(x0, y1);
        shape.lineTo(x0, y0);

        // **不要倒角**。
        // 之前用的是 bevelEnabled + bevelSize 0.01（后来收到 0.004），会在封板
        // 四周形成一圈朝上/朝外的斜面。这圈斜面的法线已经转过 45°，主光（左上前方）
        // 打不到，渲染出来就是沿着封面**上边和右边**的一条暗线；翻开后封板内侧
        // 同样的倒角又出现在左上/下边 —— 和无头浏览器里量到的完全一致：
        // 上边缘内侧 1~2px 处亮度从 226 掉到 133，而左边缘只有一圈高光(207)。
        // 0.004 × (600px/1.5单位) ≈ 1.6px，正好就是那条线的宽度。
        // 参考实现是"圆角盒"，但它的圆角是**连续曲面**；挤出几何的倒角是**一个平面**，
        // 这个平面就是那条黑线。这里直接改成直角边：封板四面干净，靠圆角轮廓
        // （shape 里的 radius）保留硬壳书的外形。
        // 边缘改成**分段圆边**（不是以前那个单段平面倒角）。
        // 参考实现用的是 RoundedBoxGeometry —— 封板四周是一圈连续曲面：
        // 光扫过去是渐变的亮边，所以整块封面看起来有厚度、有起伏。
        // 我们之前因为单段倒角会形成一条死黑边而直接改成直角，结果封面四周
        // 是硬 90° 边、整体就是一块平板。这里用 3 段、圆角半径取板厚的 12%，
        // 既得到参考那种圆边，又不会出现那条平面倒角的暗线。
        var edgeRound = Math.min(depth * 0.12, 0.006);
        var geometry = new THREE.ExtrudeGeometry(shape, {
            depth: Math.max(0.001, depth - edgeRound * 2),
            bevelEnabled: true,
            bevelSegments: 3,
            bevelSize: edgeRound,
            bevelThickness: edgeRound,
            curveSegments: 8
        });
        geometry.translate(0, 0, -depth / 2);
        remapBoardUV(geometry, width, height);
        return geometry;
    }

    // 书页块：照 complete-shelf 的 createPageBlockGeometry —— 圆角 + **靠书脊收腰**。
    // 直角盒子近看就是一块方砖，边缘一点过渡都没有；真实书芯在订口那头是被
    // 压紧的（|z| 变小），书口那头才是蓬开的。这两点一加，"一叠纸"的感觉才出来。
    function pageBlockGeometry(THREE, width, height, depth, radius) {
        var x0 = -width / 2;
        var x1 = width / 2;
        var y0 = -height / 2;
        var y1 = height / 2;
        var shape = new THREE.Shape();
        shape.moveTo(x0 + radius, y0);
        shape.lineTo(x1 - radius, y0);
        shape.quadraticCurveTo(x1, y0, x1, y0 + radius);
        shape.lineTo(x1, y1 - radius);
        shape.quadraticCurveTo(x1, y1, x1 - radius, y1);
        shape.lineTo(x0 + radius, y1);
        shape.quadraticCurveTo(x0, y1, x0, y1 - radius);
        shape.lineTo(x0, y0 + radius);
        shape.quadraticCurveTo(x0, y0, x0 + radius, y0);

        // 同样不要倒角：书页块四周的斜面也会在上下/左右边形成一条暗带。
        var geometry = new THREE.ExtrudeGeometry(shape, {
            depth: depth,
            bevelEnabled: false,
            curveSegments: 6
        });
        geometry.translate(0, 0, -depth / 2);

        var position = geometry.attributes.position;
        for (var i = 0; i < position.count; i++) {
            var x = position.getX(i);
            var z = position.getZ(i);
            var nx = Math.max(0, Math.min(1, (x + width / 2) / width));
            var gp = Math.max(0, Math.min(1, nx / 0.16));
            var ease = gp * gp * (3 - 2 * gp);
            var pinch = (1 - ease) * 0.012;          // 订口处最多收 0.012
            position.setZ(i, (z >= 0 ? 1 : -1) * Math.max(0, Math.abs(z) - pinch));
        }
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        remapBoardUV(geometry, width, height);
        return geometry;
    }

    // ExtrudeGeometry 的正面 UV 直接取的是 Shape 的坐标（不是 0..1），
    // 直接贴封面图会只取到左上角一小块。这里把正面/背面的 UV 归一化回 0..1。
    function remapBoardUV(geometry, width, height) {
        var position = geometry.attributes.position;
        var uv = geometry.attributes.uv;
        if (!position || !uv || !geometry.groups) return;
        geometry.groups.forEach(function (group) {
            if (group.materialIndex !== 0) return;      // 0 = 正/背面，1 = 侧边
            for (var i = group.start; i < group.start + group.count; i++) {
                uv.setXY(i,
                    (position.getX(i) + width / 2) / width,
                    (position.getY(i) + height / 2) / height);
            }
        });
        uv.needsUpdate = true;
    }



    function buildRig(THREE, book, index) {
        var colors = palette(index);
        var cloth = clothTextures(THREE, colors[0]);
        // 这一本自己的尺寸（照参考七本的比例轮换）；构造常数（封板/书脊/包边/
        // 印刷层内缩…）是绝对尺寸，不跟着书变大变小 —— 参考也是这么做的。
        var profile = BOOK_SIZES[index % BOOK_SIZES.length];
        var w = (book.size ? book.size.w : profile[0]) * REF_SCALE;
        var h = (book.size ? book.size.h : profile[1]) * REF_SCALE;
        var t = (book.size ? book.size.t : profile[2]) * REF_SCALE;
        var pageDepth = t - 0.026 * REF_SCALE;
        // 下面整段书体构造全是照模块常量写的；这里用**同名局部量把它们遮住**，
        // 于是同一段代码就自动按"这一本自己的尺寸"来建 —— 不用逐行改，
        // 也不会漏掉某处仍用着默认尺寸。
        var BOOK_W = w;
        var BOOK_H = h;
        var BOOK_T = t;
        var PAGE_DEPTH = pageDepth;
        // 书页块前表面（块厚 = 页芯厚 - 0.03×比例尺），书签带和叶叠都要用它
        var PAGE_BLOCK_FRONT = (pageDepth - 0.03 * REF_SCALE) / 2;

        // 照 complete-shelf 用 MeshPhysicalMaterial：法线 + 粗糙度贴图 + sheen。
        // sheen 是织物那种柔软的高光，是「布面」和「塑料板」的分界线。
        var boardMaterial = new THREE.MeshPhysicalMaterial({
            map: cloth.map,
            normalMap: cloth.normal,
            normalScale: new THREE.Vector2(0.34, 0.34),
            roughnessMap: cloth.roughness,
            roughness: 0.96,
            metalness: 0.02,
            bumpMap: cloth.bump,
            bumpScale: 0.0045,
            sheen: 0.34,
            sheenRoughness: 0.76,
            sheenColor: new THREE.Color(colors[3])
        });
        var pageMaterial = new THREE.MeshStandardMaterial({
            map: pageEdgeTexture(THREE),
            roughness: 0.95,
            metalness: 0,
            side: THREE.DoubleSide
        });

        var root = new THREE.Group();

        // 后封板
        var backBoard = new THREE.Mesh(
            // 圆角必须和前封板**同一个值**：之前这里是 0.05、前封是 0.009，
            // 后封看起来比前封圆得多。参考实现两块板共用同一个 coverGeometry。
            // 几何换成 three examples 的 RoundedBoxGeometry（vendor 原样文件，
            // 挂到 window.THREE 上），与参考实现用的是同一个类。
            // 取不到（加载顺序/旧缓存）就退回原来的挤出圆角几何，不会因此挂掉。
            (window.THREE_RoundedBoxGeometry
                ? new window.THREE_RoundedBoxGeometry(BOOK_W, BOOK_H, BOARD_T, 2, COVER_RADIUS)
                : boardGeometry(THREE, BOOK_W, BOOK_H, BOARD_T, COVER_RADIUS)),
            boardMaterial
        );
        // 封板包在书芯**外面**：内表面正好是 -BOOK_T/2
        backBoard.position.set(0, 0, -(BOOK_T / 2 + BOARD_T / 2));
        backBoard.castShadow = true;
        backBoard.receiveShadow = true;
        root.add(backBoard);

        // 封板与书脊之间的「书脊沟」（hinge groove）——complete-shelf 在前封和后封
        // 各贴一条 0.012 宽的窄条，颜色是布色 ×0.42，正好在合页的位置。
        // 硬壳书翻开时这里会凹下去一道，是精装本最容易被认出来的一条细节，
        // 我们之前完全没有。
        // 书脊沟（hinge groove）这两片薄贴片**撤掉了**。
        // 参考实现里确实有 frontGroove / backGroove，但我这版试了两轮都不对：
        // 先是变成封面左侧一条突兀的黑线（用户第一轮反馈），改成布面 + 渐变遮罩
        // 之后又出现了位置不对的黑条（alphaMap 取的是绿通道，那张渐变是纯黑的，
        // 结果是整片透明，反而让别处的暗边显出来）。合页那点凹痕靠书脊贴图上的
        // 明暗渐变 + 封板的圆角倒角已经能读出来，不再单独加片。

        // 书页块：比封板小一圈，形成硬壳书特有的「封面外伸」；
        // 外露的上下 + 书口三面是书口纸纹
        // 块要明显薄于书腔：叶叠在它的前后两面之外，不然会插进块里显穿模。
        var pageBlock = new THREE.Mesh(
            // 块比书芯略薄：叶叠在它前后两面之外，留出拱形外鼓的净空。
            // 圆角 + 订口收腰，见 pageBlockGeometry。
            // 尺寸与圆角照参考的 createPageBlockGeometry(pageWidth, pageHeight,
            // pageDepth, pageRadius)：页比封面窄 PAGE_INSET_W、矮 PAGE_INSET_H，
            // 圆角是它的 pageRadius(0.0025)×比例尺 —— 之前我们用 0.016 的圆角，
            // 相当于把一叠纸做成了圆角砖。
            pageBlockGeometry(THREE, BOOK_W - PAGE_INSET_W, BOOK_H - PAGE_INSET_H,
                PAGE_DEPTH - 0.03 * REF_SCALE, 0.0025 * REF_SCALE),
            pageMaterial
        );
        pageBlock.position.set(0.02, 0, 0);
        pageBlock.castShadow = true;
        root.add(pageBlock);

        // ===== 书口 / 天头 / 地脚：三块**独立纸边平面**（照参考的 foreEdge + edge）=====
        // 之前这里试过一版又撤掉了：那一版用的是"铺满整面"的平面，比页块的面还大，
        // 于是从上面看会看到一圈台阶、像贴纸。参考实现的这三块是**内缩**的：
        //   书口   pageDepth*0.94 × (pageHeight - 0.028)
        //   天/地  (pageWidth - 0.035) × pageDepth*0.94
        // 都比页块对应的面小一圈，只贴在面外侧 2mm —— 所以不会有台阶，
        // 反而把"一叠纸"分层做出来了（页块那三面的纸纹还在，正好当底色）。
        var pageEdgeTex = pageEdgeTexture(THREE);
        var edgeMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            map: pageEdgeTex,
            bumpMap: pageEdgeTex,
            bumpScale: 0.002,
            roughness: 0.93,
            metalness: 0,
            sheen: 0.02,
            sheenRoughness: 1,
            side: THREE.DoubleSide
        });
        var pageW_ = BOOK_W - PAGE_INSET_W;
        var pageH_ = BOOK_H - PAGE_INSET_H;
        // **页块实际厚度**（比页芯薄 0.03×比例尺）。纸边层的厚度必须按它算：
        // 之前用 PAGE_DEPTH（页芯厚）算，纸边层比页块还厚 2cm 多 ——
        // 用户看到的就是"书口那条纸边比里面的页还宽"。
        var blockDepth_ = PAGE_DEPTH - 0.03 * REF_SCALE;
        var foreEdge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), edgeMaterial);
        foreEdge.scale.set(blockDepth_ * 0.94, pageH_ - 0.012 * REF_SCALE, 1);
        foreEdge.rotation.y = Math.PI * 0.5;
        // 位置要盖住**最外面那层纸**：叶是从书脊挂出来的，它的书口边在
        // spineX + pageW，比页块的书口面还远一点点。之前按页块算，纸边层反而
        // 落在叶的里面 —— 侧着看就是"纸边离书页很远、中间一条缝"。
        var foreEdgeX = Math.max(pageBlock.position.x + pageW_ * 0.5,
            (-BOOK_W / 2 + SPINE_W * 0.62) + pageW_) + 0.001;
        foreEdge.position.set(foreEdgeX, 0, 0);
        foreEdge.receiveShadow = true;
        root.add(foreEdge);
        [-1, 1].forEach(function (direction) {
            var edge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), edgeMaterial);
            edge.scale.set(pageW_ - 0.02 * REF_SCALE, blockDepth_ * 0.94, 1);
            edge.rotation.x = direction > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
            // 天地两面同理，横向取页块中心与叶中心的中点，保证盖住两层纸
            // 上下纸边贴着页顶/页底（只抬 1mm），不再悬在离页 2mm 的地方
            edge.position.set((pageBlock.position.x + ((-BOOK_W / 2 + SPINE_W * 0.62) + pageW_ * 0.5)) * 0.5,
                direction * (pageH_ * 0.5 + 0.001), 0);
            edge.receiveShadow = true;
            root.add(edge);
        });

        // 真正解决"下缘发黑"的是环境贴图
        // （见 buildStudioEnvironment），纸边的细线则靠纹理本身画清楚 —— 见
        // pageEdgeTexture()。所以这三块平面撤掉。

        // 堵头布：完全照 complete-shelf 的构法 —— 圆柱轴向绕 X 转 90°，
        // 也就是**顺着书的厚度方向（Z）**，长度取书厚的一小段，位置贴书脊。
        // 从正面看它就是书脊两端的一个小圆点，而不是一条横贯整本书的彩带。
        // 堵头布：参考是一条**织纹圆柱**（细密的纵向条纹 + 一点绒感），
        // 不是一根纯色塑料棒。条纹画在贴图的 u 方向 —— 圆柱的 u 是绕圈方向，
        // v 是轴方向，所以条纹是"沿着轴的一道道"，正是堵头布的织法。
        var bandCanvas = makeCanvas(64, 8);
        var bctx = bandCanvas.getContext('2d');
        bctx.fillStyle = colors[3];
        bctx.fillRect(0, 0, 64, 8);
        for (var bi = 0; bi < 64; bi += 2) {
            bctx.fillStyle = bi % 4 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.16)';
            bctx.fillRect(bi, 0, 1, 8);
        }
        var bandTexture = new THREE.CanvasTexture(bandCanvas);
        bandTexture.colorSpace = THREE.SRGBColorSpace;
        bandTexture.wrapS = bandTexture.wrapT = THREE.RepeatWrapping;
        bandTexture.repeat.set(6, 1);
        var headbandMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: bandTexture,
            roughness: 0.78,
            metalness: 0
        });
        // 完全照 complete-shelf 的四组数：
        //   长度 = pageDepth × 0.88
        //   x    = -pageWidth/2 + 0.046      ← 以**页宽**为基准，不是封面宽
        //   y    = ±(pageHeight/2 - 0.004)   ← 以**页高**为基准，不是书高
        // 之前 y 用的是 BOOK_H/2，比页高多了 0.034 —— 正好把它顶到内衬与书页的
        // 覆盖范围之外，于是整个圆柱都露在外面。
        // 堵头布贴着**书页块**的上下沿，所以尺寸跟着页走（见 REF_SCALE 那一段）
        var hbPageW = BOOK_W - PAGE_INSET_W;
        var hbPageH = BOOK_H - PAGE_INSET_H;
        var headbandLength = PAGE_DEPTH * 0.88;
        var headbandX = -hbPageW * 0.5 + 0.046;
        [-1, 1].forEach(function (sign) {
            // 用户反馈"下边那个圆柱离书脊太近、也放大一点"：
            // 半径 0.012 → 0.016，离书脊再让开 0.014（x 从 +0.046 到 +0.060）。
            var band = new THREE.Mesh(
                new THREE.CylinderGeometry(0.016, 0.016, headbandLength, 14), headbandMaterial);
            band.rotation.x = Math.PI * 0.5;
            band.position.set(headbandX + 0.014, sign * (hbPageH / 2 - 0.004), 0);
            root.add(band);
        });

        // 书脊：照 complete-shelf —— 薄板（0.014）贴在封面**之外**，
        // 而且深度是「书芯 + 封板×1.88」，把上下封板的边一起包进去。
        // 这样书的轮廓才是精装书那种「书脊把两块板夹住」的样子。
        var spine = new THREE.Mesh(
            // 参考用的是 RoundedBoxGeometry(spineBoardThickness, height-0.012,
            //   depth + board*1.88, 1, spineRadius=0.0015)，**且不旋转** ——
            // RBG 的轴本来就对：x = 薄边、y = 高、z = 书的厚度方向。
            // 所以参数顺序与它逐字一致，并去掉原来的 -90° 旋转。
            // （取不到 RBG 时退回原来的"挤出 + 转 -90°"写法，不会因此挂掉。）
            (window.THREE_RoundedBoxGeometry
                ? new window.THREE_RoundedBoxGeometry(SPINE_BOARD, BOOK_H - 0.012,
                    BOOK_T + BOARD_T * 1.88, 1, 0.0015)
                : boardGeometry(THREE, BOOK_T + BOARD_T * 1.88, BOOK_H - 0.012,
                    SPINE_BOARD, 0.0015)),
            new THREE.MeshPhysicalMaterial({
                map: spineTexture(THREE, book, index),
                normalMap: cloth.normal,
                // 凸起感要明显：法线 + bump 都比封面那套大得多（封面 0.28/0.0035）。
                // 书脊在货架视角只有七八十像素宽，强度不够就完全看不出来。
                normalScale: new THREE.Vector2(0.9, 0.9),
                roughnessMap: cloth.roughness,
                bumpMap: cloth.bump,
                bumpScale: 0.012,
                roughness: 0.9,
                metalness: 0.02,
                sheen: 0.32,
                sheenRoughness: 0.76,
                sheenColor: new THREE.Color(colors[3])
            })
        );
        // 只对**退回的挤出几何**需要把轴转过去：挤出轴原本是 z，要转到 x。
        // 用 **-90°** 而不是 +90°：
        // remapBoardUV 只归一化了"正面"那组 UV，反过来的那面字是镜像的；
        // -90° 正好让标了 UV 的 +z 面朝外（书脊外侧），书名才不会反着读。
        // 用 RBG 时它已经是 x = 薄边，再转就错了 —— 所以按有没有 RBG 分别设。
        // 两种配置下贴图朝向一致（u 沿 +z、v 沿 +y），书脊书名不需要重画。
        spine.rotation.y = window.THREE_RoundedBoxGeometry ? 0 : -Math.PI / 2;
        spine.position.set(-BOOK_W / 2 - SPINE_BOARD * 0.35, 0, 0);
        spine.castShadow = true;
        root.add(spine);

        // 书脊内衬：照 complete-shelf —— 书脊里侧的一层「衬纸」，
        // 尺寸 spineWidth*0.68 × (高−0.056) × (pageDepth−0.008)，
        // 位置在 -width/2 + spineWidth*0.38。书本摊开时，书脊里那一层厚度靠它显示。
        var spineLining = new THREE.Mesh(
            // 内衬要**看得见厚度**：加宽到书脊宽的 0.9（原来 0.68 太窄），
            // 并用比书页更暖更深一档的纸色，才能和右边的书页拉开对比。
            new THREE.BoxGeometry(SPINE_W * 0.9, BOOK_H - 0.056, Math.max(0.045, PAGE_DEPTH - 0.008)),
            new THREE.MeshStandardMaterial({ color: '#e6d8bd', roughness: 0.95, metalness: 0 })
        );
        spineLining.position.set(-BOOK_W / 2 + SPINE_W * 0.38, 0, 0);
        root.add(spineLining);

        // 书口订口分层：complete-shelf 在书口有 6 道「订口」细条，
        // 书合上时从侧面看就是一叠分层的纸，而不是一整块。
        var signatureMaterial = new THREE.MeshStandardMaterial({
            color: '#d9c9a8', roughness: 0.95, metalness: 0
        });
        for (var si = 0; si < 6; si++) {
            var signature = new THREE.Mesh(
                new THREE.BoxGeometry(0.0035, 0.00135, PAGE_DEPTH * 0.91), signatureMaterial);
            signature.position.set(
                0.018 * REF_SCALE + (BOOK_W - PAGE_INSET_W) * 0.5 + 0.001,
                -(BOOK_H - PAGE_INSET_H) * 0.5 + ((si + 1) / 7) * (BOOK_H - PAGE_INSET_H),
                0);
            root.add(signature);
        }

        // 书签带：完全照 complete-shelf 的摆法 ——
        //   尺寸 0.034 × pageHeight*0.76 × 0.002
        //   位置 x = -pageWidth/2 + 0.09，y = -pageHeight*0.17，z = pageDepth/2 + 0.003
        //   再带一点点侧倾 rotation.z = ±0.014
        // 它是躺在**整叠纸的最前**、从中间往下垂的，不是贴在后封上。
        var rw = BOOK_W - PAGE_INSET_W;
        var rh = BOOK_H - PAGE_INSET_H;
        var ribbonLength = rh * 0.76;
        var ribbon = new THREE.Mesh(
            new THREE.BoxGeometry(0.034, ribbonLength, 0.002),
            new THREE.MeshStandardMaterial({ color: colors[3], roughness: 0.62, metalness: 0.04 })
        );
        // z 要落在**整叠纸的最后面**（书页块正前方），不能夹在中间：
        // 夹在中间的话，翻过几页就会从书页里露出上半段 —— 用户看到的就是
        // 「第 7 页露出一点、第 9 页全露出来」。放在最后面，无论翻到第几页，
        // 它都被所有页盖住，只有垂出书底的那一截露着，这才是书签该有的样子。
        ribbon.position.set(-rw * 0.5 + 0.09 * REF_SCALE, -rh * 0.17,
            PAGE_BLOCK_FRONT + 0.0025);
        ribbon.rotation.z = 0.014;
        root.add(ribbon);
        // （书签带末端那截斜切口按用户要求撤掉了，恢复成平口的一根带子。）

        // 书脚接触阴影：脚下的一小块软椭圆，让书"坐"在板上而不是飘着。
        // 之前删掉的那版是"比书还大的一块半透明黑贴片"，铺在书后看着像黑背景；
        // 正确做法是只在落地那一小块、很淡。
        var contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactShadowMaterial(THREE));
        contact.rotation.x = -Math.PI / 2;
        // 书的占地：x 方向是书厚（含两块封板），z 方向是书宽
        contact.scale.set((BOOK_T + BOARD_T * 1.9) * 2.2, BOOK_W * 1.5, 1);
        // 根节点的原点是书的中心，往下 BOOK_H/2 就是板面（缩放会自动跟着走）
        contact.position.set(0, -(BOOK_H / 2) + 0.003, 0);
        root.add(contact);

        // 这里原来还有三片「翻页时扇一下」的薄纸。那是早期没有真正的叶结构时的
        // 临时做法，现在叶本身就是逐张可翻的，这三片纯属多余 —— 而且它们会被
        // 转到近 170° 卡在那里，变成一张斜插进整本书的黄条纹纸。
        // 前封板：挂在书脊处的 pivot 上，旋转 pivot 即可「翻开」
        var coverPivot = new THREE.Group();
        // 前封板同样包在书芯外面：枢轴定在书芯前表面
        coverPivot.position.set(-BOOK_W / 2, 0, BOOK_T / 2 + BOARD_T / 2);
        root.add(coverPivot);

        var coverTextureRef = coverTexture(THREE, book, index);
        // 封面上的印刷图案（照 complete-shelf 的 coverArt）：**印在布上**，
        // 所以布面那套法线/粗糙度/织纹要一起带上来，再补一点点 clearcoat
        // （印刷墨层的光泽）。我原来是 MeshStandardMaterial + 只有 bumpMap，
        // 于是封面看着像一层光滑塑料贴纸 —— 用户说的"纯布面不够真实"就是它。
        // ⚠️ 但印刷层的织纹扰动必须**比布面本身轻**：布板那层 normalScale 0.34 /
        // bumpScale 0.0045 是对的，照搬到印字这层，细笔画会被经纬纹打碎，
        // 远看就是"糊"。这里压到 0.1 / 0.0015，并去掉那层 clearcoat（0.06 的
        // 清漆在斜看时是一层薄高光，正压在字上）。
        var coverMaterial = new THREE.MeshPhysicalMaterial({
            map: coverTextureRef,
            normalMap: cloth.normal,
            normalScale: new THREE.Vector2(0.1, 0.1),
            roughnessMap: cloth.roughness,
            bumpMap: cloth.bump,
            bumpScale: 0.0015,
            roughness: 0.92,
            metalness: 0.035,
            clearcoat: 0,
            // 印刷层的 sheen（柔和高光）比纯布面那层再低一档：它是盖在字上的
            // 一层薄雾，越高越把细笔画冲淡
            sheen: 0.14,
            sheenRoughness: 0.78,
            sheenColor: new THREE.Color(colors[3])
        });
        // 封板 = **纯布面**，封面图案另做一层贴在它外面 —— 照参考实现的结构
        // （它也是 cloth 的 frontCover + 单独的 coverPlane 印刷层）。
        // 之前是把封面贴图直接给封板的两个大面，于是**封板内侧也是封面图案**，
        // 通过纸叠和封板之间那条缝就能看见（用户报的"后封里面也能看到图片"）。
        var frontBoard = new THREE.Mesh(
            // 与后封板同一个类（three examples 的 RoundedBoxGeometry）
            (window.THREE_RoundedBoxGeometry
                ? new window.THREE_RoundedBoxGeometry(BOOK_W, BOOK_H, BOARD_T, 2, COVER_RADIUS)
                : boardGeometry(THREE, BOOK_W, BOOK_H, BOARD_T, COVER_RADIUS)),
            boardMaterial
        );
        frontBoard.position.set(BOOK_W / 2, 0, 0);
        frontBoard.castShadow = true;
        frontBoard.receiveShadow = true;
        coverPivot.add(frontBoard);

        // 封面印刷层（对应参考的 coverPlane / coverSurfaceGeometry）：
        // 尺寸在封板基础上内缩 ART_INSET，圆角取 0.0035×比例尺，和参考一致。
        var coverSurfaceGeometry = roundedPlaneGeometry(
            THREE, BOOK_W - ART_INSET, BOOK_H - ART_INSET, 0.0035 * REF_SCALE);
        var frontArt = new THREE.Mesh(coverSurfaceGeometry, coverMaterial);
        // 台阶高度照参考：封面印刷层在 board*0.55（比封板外表面高出 5% 板厚）
        frontArt.position.set(BOOK_W / 2, 0, BOARD_T * 0.55);
        coverPivot.add(frontArt);

        // ---- 烫金独立层（照 complete-shelf：alphaMap + 高金属度 + polygonOffset）----
        // 画在贴图里的金色不会反光，只有做成独立金属网格才有压印烫金的感觉。
        var foilCanvas = makeCanvas(768, 1152);
        paintCover(foilCanvas, book, index, true);
        var foilTexture = new THREE.CanvasTexture(foilCanvas);
        foilTexture.colorSpace = THREE.SRGBColorSpace;
        foilTexture.anisotropy = 16;      // 烫金细字同理
        // 烫金该"亮"还是该"暗"，取决于它相对布色是亮还是暗 —— 这也是这次
        // "封面字看不清"的正解：
        //   · 金比布**亮**（深布那五组）：高金属度在这间屋子里反射不到足够的
        //     光，会把亮金渲成一片中暗调，字只比布亮一点点（实测对比度 47~62）。
        //     把金属度降到 0.32 让 baseColor 重新当反照率用、再补一点自发光，
        //     亮金才真的亮起来。
        //   · 金比布**暗**（第 3 组：#8f6f33 深铜金配 #d5c5a0 浅亚麻）：
        //     它本来就是靠"深字压浅布"读出来的，保持金属度、不要自发光 ——
        //     一起改成亮金反而会把这两本弄糊（实测 149 → 78）。
        var foilHex = FOIL_COLORS[index % FOIL_COLORS.length];
        var foilIsBright = hexLum(foilHex) > hexLum(colors[0]);
        var foilTune = foilIsBright
            ? { metalness: 0.32, roughness: 0.24, emissiveIntensity: 0.14 }
            : { metalness: 0.9, roughness: 0.2, emissiveIntensity: 0 };
        var foilMaterial = new THREE.MeshPhysicalMaterial({
            color: foilHex,
            map: foilTexture,
            alphaMap: foilTexture,
            // 烫金要**压印出来**才有厚度：参考给烫金层单独烘了一张 emboss 图当
            // bumpMap（bumpScale 0.016）。我们之前只贴了颜色，于是书名/图案是
            // 平的 —— 这也是"封面整体不够凹凸"的一半原因。这里直接拿烫金图当
            // 高度图（金线处凸、空白处凹）。
            bumpMap: foilTexture,
            bumpScale: 0.014,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            // 见上面 foilTune 的说明：亮金配深布要降金属度 + 一点自发光，
            // 深铜金配浅布保持金属度（靠深字压浅布读出来）。
            roughness: foilTune.roughness,
            metalness: foilTune.metalness,
            emissive: new THREE.Color(foilHex),
            emissiveIntensity: foilTune.emissiveIntensity,
            clearcoat: 0.18,
            clearcoatRoughness: 0.12
        });
        var frontFoil = new THREE.Mesh(
            roundedPlaneGeometry(THREE, BOOK_W - ART_INSET, BOOK_H - ART_INSET,
                0.0035 * REF_SCALE), foilMaterial);
        // 烫金再往外一层：board*0.605
        frontFoil.position.set(BOOK_W / 2, 0, BOARD_T * 0.605);
        coverPivot.add(frontFoil);

        // ---- 合页沟（hinge groove）----
        // 参考实现前封/后封各一条：宽 0.012、距书脊 0.038、颜色 = 布色 ×0.42，
        // 带布面凹凸。精装书翻开时合页处凹下去的那道痕，是"这是本硬壳书"最直接的
        // 信号。以前撤掉是因为当时用的是纯黑材质，看着像一条突兀的黑线；
        // 这次照参考用"布色压暗"，位置也照它的 0.038×比例尺。
        // ===== 合页沟：要读成"凹进去"，不能是一块硬边深色条 =====
        // 之前那版是平色条 + 两条肩线，侧着看还是一张纸。这版改成**渐变沟**：
        //   · alphaMap：中间最实、两侧渐隐 → 看不出硬边
        //   · bumpMap：中间凹、两侧微微起坡 → 主光扫过去有"暗-亮"的滚动
        // 就是参考那条 `frontGroove/backGroove` 的做法，只是把它的平色换成了渐变，
        // 照参考原样：**平色**深色条（布色 ×0.42）+ 布面凹凸，不用渐变也不用几何
        // （前两版我自己发明的"渐变沟""凸起几何脊"全部撤掉）。
        // 参考的 frontGroove 就是一条 flat quad，位置在 board*0.655，
        // 也就是比封面印刷层(0.55)、烫金层(0.605)再往外一层 —— **四层台阶**。
        var grooveMaterial = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(colors[0]).multiplyScalar(0.42),
            bumpMap: cloth.bump,
            bumpScale: 0.006,
            roughness: 0.9,
            metalness: 0,
            transparent: true,
            side: THREE.DoubleSide
        });
        var frontGroove = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1), grooveMaterial);
        frontGroove.scale.set(GROOVE_W, BOOK_H * 0.94, 1);
        frontGroove.position.set(GROOVE_X, 0, BOARD_T * 0.655);
        coverPivot.add(frontGroove);

        // 书脊烫金层：贴在书脊外表面
        var spineFoilTex = spineFoilTexture(THREE, book, index);
        var spineFoilMaterial = new THREE.MeshPhysicalMaterial({
            color: foilHex,
            map: spineFoilTex,
            alphaMap: spineFoilTex,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            // 书脊烫金同前封（见 foilTune）：竖排书名才不会在深布上糊成一片
            roughness: foilTune.roughness,
            metalness: foilTune.metalness,
            emissive: new THREE.Color(foilHex),
            emissiveIntensity: foilTune.emissiveIntensity,
            side: THREE.DoubleSide
        });
        var spineFoil = new THREE.Mesh(
            new THREE.PlaneGeometry(BOOK_T + BOARD_T * 1.82, BOOK_H - 0.018), spineFoilMaterial);
        spineFoil.rotation.y = -Math.PI * 0.5;
        spineFoil.position.set(-BOOK_W / 2 - SPINE_BOARD * 0.35 - SPINE_BOARD * 0.5 - 0.001, 0, 0);
        root.add(spineFoil);

        // 封底图案：贴在后封板外表面
        // （同样是**独立一层**，封板本身保持纯布面；圆角与内缩都照参考的
        //   coverSurfaceGeometry：宽高各内缩 ART_INSET、圆角 0.0035×比例尺）
        var backArt = new THREE.Mesh(
            roundedPlaneGeometry(THREE, BOOK_W - ART_INSET, BOOK_H - ART_INSET,
                0.0035 * REF_SCALE),
            new THREE.MeshStandardMaterial({
                map: backCoverTexture(THREE, book, index), roughness: 0.92, metalness: 0.02
            })
        );
        // 后封同构：印刷层 -board*0.55、烫金 -board*0.605（照参考的台阶高度）
        backArt.position.set(0, 0, -(BOOK_T / 2 + BOARD_T / 2 + BOARD_T * 0.55));
        backArt.rotation.y = Math.PI;
        root.add(backArt);

        // 后封的合页沟（照参考的 backGroove：位置在书脊侧 0.038×比例尺处）
        var backGroove = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1), grooveMaterial);
        backGroove.scale.set(GROOVE_W, BOOK_H * 0.94, 1);
        backGroove.position.set(-BOOK_W / 2 + GROOVE_X, 0,
            -(BOOK_T / 2 + BOARD_T / 2 + BOARD_T * 0.535));
        backGroove.rotation.y = Math.PI;
        root.add(backGroove);

        // 这里原来有一片「环衬」，和书本模式加进去的内侧扉页几乎共面，
        // 两者会 z-fighting —— 表现就是合上封面时有一条东西「穿进第一页里」。
        // 内侧那一层统一交给 insideMesh，这里不再重复。

        // 封面内侧的 turn-ins：照 complete-shelf —— 布面向内折进去的那一圈边。
        // 四条窄条（头 / 脚 / 书脊侧 / 书口侧）贴在封板内表面，宽度取 0.018。
        // 有了它，翻开封面看到的内侧才像「布边包住纸板」，而不是一块平的布。
        var turnInDepth = 0.002;
        [
            [BOOK_W * 0.5, BOOK_H * 0.5 - TURN_IN * 0.56, BOOK_W - TURN_IN * 0.7, TURN_IN],
            [BOOK_W * 0.5, -BOOK_H * 0.5 + TURN_IN * 0.56, BOOK_W - TURN_IN * 0.7, TURN_IN],
            [TURN_IN * 0.56, 0, TURN_IN, BOOK_H - TURN_IN * 2.2],
            [BOOK_W - TURN_IN * 0.56, 0, TURN_IN, BOOK_H - TURN_IN * 2.2]
        ].forEach(function (def) {
            var strip = new THREE.Mesh(
                new THREE.BoxGeometry(def[2], def[3], turnInDepth), boardMaterial);
            strip.position.set(def[0], def[1], -BOARD_T / 2 - turnInDepth / 2);
            // 包边条**不参与投影**。无头浏览器量出来：翻开封面后，内侧的上/下/左
            // 各有一条 4~5px、亮度只有 72~89 的暗带（书页是 237~241）。那就是这四条
            // 2mm 厚的窄条：它们贴在封板内表面、又比封板更靠近光源，被封板自己的
            // 阴影整条吃掉。关掉 castShadow/receiveShadow，它们就回到和封板同样的布色。
            strip.castShadow = false;
            strip.receiveShadow = false;
            coverPivot.add(strip);
        });

        return {
            root: root,
            coverPivot: coverPivot,
            frontBoard: frontBoard,
            coverTexture: coverTextureRef,
            contact: contact,
            book: book,
            index: index,
            // 这一本自己的尺寸与由它推出的站位（书架布局、摊开对位、
            // 叶叠的起止位置都从这里取，别再读模块常量）
            dims: {
                width: w,
                height: h,
                depth: t,
                pageDepth: pageDepth,
                pageW: w - PAGE_INSET_W,
                pageH: h - PAGE_INSET_H,
                spineX: -w / 2 + SPINE_W * 0.65,
                board: BOARD_T,
                pageBlockFront: PAGE_BLOCK_FRONT,
                leafRestFront: t / 2 - 0.006,
                leafRestBack: PAGE_BLOCK_FRONT + 0.005,
                leafRestStep: LEAF_REST_STEP
            },
            target: new THREE.Vector3(),
            targetRotationY: 0,
            targetScale: 1,
            visible: true
        };
    }

    function disposeRig(rig) {
        rig.disposed = true;
        rig.__book = null;
        rig.root.traverse(function (object) {
            if (object.geometry) object.geometry.dispose();
            var materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(function (material) {
                if (!material) return;
                // 共享纹理（布面 / 书口 / 木架）不能在这里释放，只释放每本书独有的封面贴图
                if (material.map && material.map === rig.coverTexture) material.map.dispose();
                material.dispose();
            });
        });
    }

    // ---------------- 书架场景 ----------------

    function stageSize() {
        var stage = els.stage;
        if (!stage) return { width: 1, height: 1 };
        var rect = stage.getBoundingClientRect();
        // **必须取整**。ResizeObserver 报的是小数（1439.97…），
        // 而初始化时可能是整数 1440；差这不到 1 像素，渲染结果整体平移一点点，
        // 于是两次截图只在所有高对比边缘上出现差异 —— 看上去就像画面里多出
        // 「一圈」东西。取整之后两种状态用的画布尺寸完全一致，就不会再漂。
        return {
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height))
        };
    }

    // 书架布局一律用「世界坐标」算：书排在世界空间的 X 轴上，
    // 屏幕像素只在算可视宽度和拖拽换算时出现一次，避免两套单位混用。
    var CAMERA_Z = 7.4;
    var CAMERA_FOV = 32;
    // 相邻两本书的书脊中心距。原来 0.78 对 0.34 的书厚来说太松了（书与书之间空出
    // 比书本身还宽的缝），现在压到 1.3 倍书厚，读起来才像真正排在架上。
    var SHELF_GAP = 0.44;
    // 换书 / 重排的时间线时长。所有书架位姿都按"归一化进度 p"求值，
    // 所以这段时间里无论掉不掉帧，末帧都精确落在目标上（见 startRigTimeline）。
    // ② 一次切换的"节拍"：卡片落位、内容分层结束、房间换色、书本滑到位，
    // 全都收在 0.45s 左右 —— 原来这四处分别是 0.34 / 0.52 / 0.50 / 0.52s，
    // 各走各的，读起来是"几件事同时发生"而不是一个连贯的手势。
    var SHELF_MOVE_MS = 450;
    // 沉下去的深度。书本模式里搁板是藏起来的，所以这里必须沉到**画面下缘之外**
    // （书高 2.2 + 余量），否则"藏起来"那一下会看见书凭空消失；
    // 书架模式下则只需要沉到搁板下面，板子会替我们挡住剩下的行程。
    var SINK_DEPTH = 2.9;
    // ② 点书列中间那本时整排要平移好几格：时长按**跨了几格**给，并封顶。
    // 原来是所有人共用 450ms —— 点第 5 本时它要挪 5 格，等于 5 倍速，糊成一道影。
    var SHELF_MOVE_MAX_MS = 900;       // 单次重排的时长上限
    var SHELF_MOVE_PER_STEP_MS = 90;   // 每多跨一格加多少
    // ③ 被点中的那本走"前面那条道"：途中朝镜头偏一点、略微放大，落位时收回 ——
    // 让它成为这一下的主角，其他书的整体平移退成背景（也顺带杜绝任何穿插）
    var LANE_Z = 0.26;
    var LANE_SCALE = 0.04;
    // ① 退场那几本"就地沉下去"占整段时长的比例：沉完再在隐藏状态下滑到新位置。
    // 原来是瞬移 + 直接隐藏 —— 用户看到的是"好几本一起凭空消失"。
    var SINK_PHASE = 0.45;
    // ④ 从板后升上来的那几本按位次错开，读起来是"一排书依次归位"而不是一堵墙升上来
    var SEAM_RISE_STAGGER = 40;
    // 展开书本时，书列退场的时间线时长（照参考实现把整排书架推出画面）。
    var BOOK_RETREAT_MS = 620;

    // 房间尺寸（照 complete-shelf 的 addRoom 换算）。**必须放模块级**：
    // 房间在 initShelf 里搭，但检视态的相机限位（别钻到地板下面）也要读它，
    // 放在函数里就会在每帧抛 ReferenceError，整个画面直接冻住。
    var ROOM_FLOOR_Y = PLANK_TOP - 0.49;
    var ROOM_WALL_W = 34;
    var ROOM_WALL_H = 16;
    var ROOM_WALL_Z = -3.6;
    var ROOM_WALL_DROP = 1.48;      // 墙下沿低于地面的深度（照参考）
    // 房间的另外三面（正面墙 + 左右侧墙）与侧墙的横向位置。
    // 参考实现只有一面背墙：转到侧面，墙就"到头了"，看着不像房间的一角，
    // 而像一个能绕出去的缺口。补齐四面、且每面都朝内，四个角就接上了 ——
    // 而且因为都是单面，相机绕到墙外时那一面会被背面剔除自动让开，
    // 从任何角度看过去，背后那几面墙和它们的角都还在。
    var ROOM_FRONT_Z = 9.0;
    var ROOM_SIDE_X = 12.0;
    var ROOM_WALL_Y = ROOM_FLOOR_Y + ROOM_WALL_H / 2 - ROOM_WALL_DROP;

    function shelfLayout() {
        var size = stageSize();
        var aspect = size.width / Math.max(1, size.height);
        var halfHeight = Math.tan(CAMERA_FOV / 2 * Math.PI / 180) * CAMERA_Z;
        var halfWidth = halfHeight * aspect;
        // 信息板现在是**浮在舞台上**的，不能再把它当成舞台外的东西。
        // 精选书必须整体落在它的右边缘之外，否则会被面板盖住半个封面。
        var panelPx = 0;
        if (!document.getElementById('memoryShelf').classList.contains('book-mode')) {
            // 左侧占用 = 信息卡与省份书脊轨**两条里更靠右的那条**的右边缘
            // （原来只量卡宽，加了书脊轨之后书就可能压到轨道上）
            var stageLeft = els.stage ? els.stage.getBoundingClientRect().left : 0;
            [document.querySelector('.ms-info'), document.getElementById('msRail')]
                .forEach(function (node) {
                    if (!node) return;
                    panelPx = Math.max(panelPx, node.getBoundingClientRect().right - stageLeft);
                });
        }
        var panelWorld = (panelPx / Math.max(1, size.width)) * 2 * halfWidth;
        var activeHalfWidth = BOOK_W / 2 * 1.14;
        // 精选书默认摆在**画面正中**（世界 x = 0），而不是贴着信息板摆 ——
        // 之前是从面板右缘起算，虽然算出来没压住，但只留了 20px 余量，看着就是
        // 被面板顶住了。只有当窗口窄到面板真的会盖上来时，才把它往右推。
        var activeX = Math.max(0,
            -halfWidth + panelWorld + activeHalfWidth + 0.2);
        // 第一本书脊的中心：从当前书的右边缘再留一点点缝，别按整本书宽去推
        var activeHalf = activeHalfWidth;
        // 精选书和书列之间要留出比书列内部更大的缝：它是「从架上抽出来」的那本
        var spineStart = activeX + activeHalf + 0.36 + BOOK_T / 2;
        var capacity = Math.max(1, Math.floor((halfWidth - spineStart) / SHELF_GAP));
        return {
            gap: SHELF_GAP,
            capacity: capacity,
            activeX: activeX,
            spineStart: spineStart,
            halfWidth: halfWidth,
            pxPerWorld: size.width / Math.max(0.001, halfWidth * 2)   // 拖拽时把像素位移换算成世界位移
        };
    }

    // 手搭一个"小摄影棚"烘成环境贴图（IBL）。
    // 参考实现用的是 three 自带的 RoomEnvironment + scene.environment，
    // 强度 0.72；我们的 three 是 r160（没有 environmentIntensity），
    // 所以把 0.72 这一档直接乘进环境场景的发光值里。
    function buildStudioEnvironment(THREE, renderer) {
        if (typeof THREE.PMREMGenerator !== 'function') return null;
        var pmrem = null;
        try {
            pmrem = new THREE.PMREMGenerator(renderer);
            var room = new THREE.Scene();
            var unit = new THREE.BoxGeometry(1, 1, 1);
            var LEVEL = 0.72;                  // = 参考实现的 scene.environmentIntensity
            var panel = function (w, h, d, color, intensity, x, y, z, backSide) {
                var mesh = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({
                    color: new THREE.Color(color).multiplyScalar(intensity * LEVEL),
                    side: backSide ? THREE.BackSide : THREE.FrontSide
                }));
                mesh.scale.set(w, h, d);
                mesh.position.set(x, y, z);
                room.add(mesh);
                return mesh;
            };
            // 房间外壳：**要亮**。这是"下缘发黑"的关键 —— three 的 RoomEnvironment
            // 是一间很亮的房间，朝下的面靠环境下半球（也就是那面亮地板/墙）拿到光；
            // 我一开始把外壳做成深褐色，于是朝下的面几乎只能拿到半球光的地面色，
            // 看上去就是一条黑边。现在按真实摄影棚的浅色环境来。
            panel(26, 14, 26, 0xcbbfae, 0.78, 0, 0.4, 0, true);
            // 一块专门朝上的大反光地板，把光从底下反回来
            panel(16, 0.4, 16, 0xd8cdbb, 1.1, 0, -4.6, 0);
            // 顶部主灯（暖白）
            panel(7, 0.5, 7, 0xfff1da, 3.2, 0, 5.4, 0);
            // 左侧大柔光板：方向与场景里那盏 softKey 一致
            panel(0.5, 5.4, 6.4, 0xffe8c2, 2.6, -5.4, 1.6, 1.4);
            // 右侧冷补光
            panel(0.5, 4.2, 5.2, 0xd8e3e7, 1.5, 5.4, 1.2, 1.2);
            // 背后一条暖光，把书从背景里托出来
            panel(9, 3.4, 0.5, 0xd8a866, 1.1, 0, 0.8, -6.2);
            var target = pmrem.fromScene(room, 0.04);
            return target ? target.texture : null;
        } catch (e) {
            console.warn('世界这本书：环境贴图构建失败，退回纯灯光', e);
            return null;
        } finally {
            if (pmrem) pmrem.dispose();
        }
    }

    function initShelf() {
        var THREE = window.THREE;
        if (!THREE || !els.stage) return false;

        var size = stageSize();
        renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer3d.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
        renderer3d.setSize(size.width, size.height, false);
        renderer3d.outputColorSpace = THREE.SRGBColorSpace;
        renderer3d.toneMapping = THREE.ACESFilmicToneMapping;
        renderer3d.toneMappingExposure = 1.16;
        renderer3d.shadowMap.enabled = true;
        renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;
        maxAnisotropy = renderer3d.capabilities.getMaxAnisotropy() || 4;

        els.canvas = renderer3d.domElement;
        els.canvas.className = 'ms-canvas';
        els.canvas.setAttribute('aria-hidden', 'true');
        els.stage.insertBefore(els.canvas, els.stage.firstChild);
        // 画布起来之后，DOM 那层"脚下阴影"必须收掉：它是没有 3D 地面时的权宜
        // 之计，现在画布本身已经有地面和投影，那团模糊的褐色留在画面里就是
        // "墙上浮着一块脏东西"（它排在画布之后，是盖在 3D 画面上的）。
        els.stage.classList.add('has-canvas');

        var scene = new THREE.Scene();
        // 环境贴图（IBL）——这是"背光面发黑"的根因。
        // complete-shelf 用 RoomEnvironment + PMREM 给 scene.environment，
        // 强度 0.72。没有环境贴图时，凡是背着主光的面（正好是书页块的**下缘**
        // 和**书口**）只能拿到半球光那一点点，翻动书本、改变俯仰角时就会
        // 一会儿亮一会儿黑——用户看到的就是那两条边"会变黑"。
        // 我们的 three 是 r160，没有 scene.environmentIntensity，
        // 所以把 0.72 这一档直接烘进环境场景里。
        scene.environment = buildStudioEnvironment(THREE, renderer3d);
        // 雾照它来：很淡的暖色，把远处往墙面色上带一点，别让边缘死黑
        scene.fog = new THREE.FogExp2(0xe9dfcb, 0.027);
        var camera = new THREE.PerspectiveCamera(32, size.width / size.height, 0.1, 40);
        camera.position.set(0, 0.42, 7.4);
        camera.lookAt(0, 0.3, 0);

        // ================= 布光：照 complete-shelf 的摄影棚灯组 =================
        // 它一共 7 盏：一盏半球光 + 两盏方向光 + **五盏面光**。
        // 书看起来像"棚拍"而不是"CG"，主要靠那几盏面光——
        // 大面积柔光给出布面的柔和过渡，暖色 rim 专门擦亮烫金，
        // 冷色 backFill 把书从背景里分离出来，spineRake 单独扫书脊。
        //
        // 位置是按"相对书本中心"换算过来的：它的书心在 y≈1.45，我的在 y≈0.15，
        // 所以每盏灯统一减去 1.30 的纵向偏移。
        var BOOK_CENTER_Y = 0.15;
        // 半球光留个引用：它的天色/地色也参与"按书换色"（照参考实现的
        // roomLights.hemisphere.color / groundColor）。
        var hemi = new THREE.HemisphereLight(0xfff8e8, 0x5b4030, 0.56);
        scene.add(hemi);

        var key = new THREE.DirectionalLight(0xffe8c2, 1.42);
        key.position.set(-4.6, 7.4 - 1.3, 5.8);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        // 视锥照 complete-shelf 的 ±6 / bottom -1.5：光从上方来，只需要盖住书架那一条。
        // 之前我放到 ±9，同样 2048 的阴影图摊到 18 个世界单位上，每个纹素大一倍多，
        // 书页块**下缘**和**书口**这两面几乎与光线平行，最先出现自阴影痤疮 ——
        // 看上去就是那两条边发黑、有斑。收紧视锥就是把阴影分辨率翻倍。
        key.shadow.camera.left = -6;
        key.shadow.camera.right = 6;
        key.shadow.camera.top = 6;
        key.shadow.camera.bottom = -1.5;
        key.shadow.camera.near = 1;
        key.shadow.camera.far = 20;
        // 注意 shadow.bias 的符号：**负值会加重自阴影（acne）**，正值才是往外推。
        // 之前照抄参考实现的 -0.00018，结果封板那几条"侧边"（很薄的斜面）
        // 全被自己遮住：无头浏览器量到翻开后封面侧边只有 47 亮度，
        // 而同一块布在正面是 100~150。正负一对调，边缘立刻回到正常亮度。
        key.shadow.bias = 0.0002;
        key.shadow.normalBias = 0.02;
        key.shadow.radius = 3.5;
        scene.add(key);

        // 面光组：用 try 包住 —— 万一运行环境没有 RectAreaLightUniformsLib，
        // 也不该把整个书架拖垮，退化成方向光/环境光一样能看。
        try {
            // 大面积柔光（布面的主光）
            var softKey = new THREE.RectAreaLight(0xffe8c2, 5.4, 4.8, 5.6);
            softKey.position.set(-3.2, 5.5 - 1.3, 4.6);
            softKey.lookAt(0, BOOK_CENTER_Y, 0);
            scene.add(softKey);
            // 冷补光（方向光，压住过曝）
            var fill = new THREE.DirectionalLight(0xd8e3e7, 0.3);
            fill.position.set(5.5, 3.6 - 1.3, 4.2);
            scene.add(fill);
            // 暖金色轮廓光：专门擦烫金，让它有金属高光
            var rim = new THREE.RectAreaLight(0xd5a45e, 3.45, 1.6, 4.8);
            rim.position.set(3.8, 3.6 - 1.3, -2.1);
            rim.lookAt(-0.2, BOOK_CENTER_Y, 0);
            scene.add(rim);
            // 背后冷光：把书从背景里托出来
            var backFill = new THREE.RectAreaLight(0xd8e3e7, 2.7, 3.8, 4.8);
            backFill.position.set(-1.8, 2.9 - 1.3, -4.5);
            backFill.lookAt(-0.1, BOOK_CENTER_Y, 0);
            scene.add(backFill);
            // 窄条光，专门扫书脊
            var spineRake = new THREE.RectAreaLight(0xffe8c2, 1.9, 0.9, 4.6);
            spineRake.position.set(-4.6, 3.2 - 1.3, 1.1);
            spineRake.lookAt(-0.55, BOOK_CENTER_Y, 0);
            scene.add(spineRake);
            // 扫纸面
            var pageRake = new THREE.RectAreaLight(0xfff7e7, 2.15, 1.15, 3.8);
            pageRake.position.set(4.2, 4.8 - 1.3, 3.1);
            pageRake.lookAt(0.65, BOOK_CENTER_Y + 0.1, 0);
            scene.add(pageRake);
        } catch (e) {
            console.warn('面光源不可用（缺少 RectAreaLight 支持），退回基础布光：', e);
            scene.add(new THREE.AmbientLight(0xffffff, 0.5));
            var fallbackFill = new THREE.DirectionalLight(0xffffff, 0.5);
            fallbackFill.position.set(0.6, 1.2, 6);
            scene.add(fallbackFill);
        }

        // ================= 【A 档 · 1】房间：地台 + 背板墙（照 complete-shelf 的 addRoom） =================
        // 上一版这里是"一面 30×18 的渐变背板（带拼板缝 + 灰泥颗粒）+ 两片往内倾
        // 22° 的侧墙"，**但没有地面**。没有地面就没有墙地交线，整块背景读起来只
        // 是一片渐变 —— 用户说的"展开书本后一点墙面的样子都看不出来"就是它。
        //
        // 参考实现的房间其实极简（index.html / addRoom）：一块 30×20 的地板 +
        // 一面 28×14 的**纯色**背墙，木架贴在墙前面。空间感全部来自"墙地交线 +
        // 木架接地 + 灯光衰减"，不来自贴图。这里就照它搭，只按我们的画幅换算尺寸：
        //   - 地面 40×26，一直铺到镜头脚下；高度 = 搁板下沿再往下 0.49
        //     （参考是 shelfBoardTop - 0.49，我这里 PLANK_TOP 就是"搁板顶面"）；
        //   - 背墙 34×16，中心在 z = -3.6，下沿伸到地面以下 1.48，
        //     所以墙地接缝处不会漏出背景色；
        //   - 两者都是纯色 PBR（墙 roughness 1、地 0.92），颜色跟着选中的省份走
        //     （applyRoomTheme），换一本就是换一间屋子。
        var roomFloorMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(roomTint(0, 'floor')), roughness: 0.92, metalness: 0
        });
        var roomFloor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomFloorMaterial);
        roomFloor.scale.set(40, 26, 1);
        roomFloor.rotation.x = -Math.PI / 2;
        // 稍微往前放一点：后缘要压在墙脚之下，前缘要越过镜头
        roomFloor.position.set(0, ROOM_FLOOR_Y, 0.6);
        roomFloor.receiveShadow = true;
        scene.add(roomFloor);

        var roomWallMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(roomTint(0, 'wall')), roughness: 1, metalness: 0
        });
        var roomWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomWallMaterial);
        roomWall.scale.set(ROOM_WALL_W, ROOM_WALL_H, 1);
        roomWall.position.set(0, ROOM_WALL_Y, ROOM_WALL_Z);
        roomWall.receiveShadow = true;
        scene.add(roomWall);

        // 正面墙（相机在书本前时它落在身后，不参与画面；绕到背面时它就是背景）
        var roomFrontWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomWallMaterial);
        roomFrontWall.scale.set(ROOM_WALL_W, ROOM_WALL_H, 1);
        roomFrontWall.position.set(0, ROOM_WALL_Y, ROOM_FRONT_Z);
        roomFrontWall.rotation.y = Math.PI;          // 法线朝 -z，朝向房间内侧
        roomFrontWall.receiveShadow = true;
        scene.add(roomFrontWall);

        // 左右侧墙：从背墙一直连到正面墙，四个角因此严丝合缝
        var roomSideWalls = [];
        [-1, 1].forEach(function (side) {
            var wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomWallMaterial);
            wall.scale.set(ROOM_FRONT_Z - ROOM_WALL_Z, ROOM_WALL_H, 1);
            wall.position.set(side * ROOM_SIDE_X, ROOM_WALL_Y,
                (ROOM_WALL_Z + ROOM_FRONT_Z) / 2);
            wall.rotation.y = -side * Math.PI / 2;   // 法线朝房间内侧
            wall.receiveShadow = true;
            scene.add(wall);
            roomSideWalls.push(wall);
        });

        // ================= 【A 档 · 2】木架：新木纹 + 前缘压条 =================
        // 顶面高度固定为 PLANK_TOP，所有书都按这个高度「落座」，不会插进木板里。
        var wood = woodMaps(THREE);
        var plankMaterial = new THREE.MeshStandardMaterial({
            map: wood.map,
            roughnessMap: wood.roughness,
            normalMap: wood.normal,
            normalScale: new THREE.Vector2(0.5, 0.5),
            roughness: 0.88,
            metalness: 0
        });
        wood.map.repeat.set(5, 1);
        wood.roughness.repeat.copy(wood.map.repeat);
        wood.normal.repeat.copy(wood.map.repeat);
        // 深一档的胡桃色：前缘压条、立柱、背挡都用它（照参考的 walnutDark）
        var woodDarkMaterial = new THREE.MeshStandardMaterial({
            map: wood.map,
            roughnessMap: wood.roughness,
            normalMap: wood.normal,
            normalScale: new THREE.Vector2(0.5, 0.5),
            color: 0x8a6a3c,
            roughness: 0.9,
            metalness: 0
        });
        var plank = new THREE.Mesh(
            // 进深 1.6 → 2.0：书立着时在 z 上要占整本书的宽度（1.5×0.9 ≈ 1.35），
            // 1.6 的板子放不下，前排会探出板沿；加深后前后都留出余量，
            // 也给背挡腾出"仍在板面上"的位置。
            new THREE.BoxGeometry(20, PLANK_H, 2.0),
            plankMaterial
        );
        plank.position.set(0, PLANK_TOP - PLANK_H / 2, 0.12);
        plank.receiveShadow = true;
        scene.add(plank);

        // 前缘压条：照 complete-shelf 的 walnut-shelf-lip —— 一条比板面略宽、
        // 更深色的**矩形**窄条压在搁板下前沿。
        // （上一版我自创了一根牛鼻圆边：既不是参考的样子，而且摊开书之后它
        // 还留在画面底部，就是用户说的"书本展开后底部还有木条"。）
        var plankLip = new THREE.Mesh(
            new THREE.BoxGeometry(20.05, 0.075, 2.06),
            woodDarkMaterial
        );
        plankLip.position.set(0, PLANK_TOP - PLANK_H + 0.02, 0.12);
        plankLip.receiveShadow = true;
        scene.add(plankLip);

        // 这里原来照 complete-shelf 铺了一条"板面接触阴影"（19×1.5 的 αMap 平面）。
        // 实测在亮色场景里它就是"木板上多了一层阴影"，所以撤掉：
        // 板的接地感交给每本书脚下那小块椭圆阴影就够了。

        // 书架的**立柱**与**背挡**（照它 hero 场景的 walnut-upright / back-rail）：
        // 这两样才是"一整排书架"的样子 —— 我之前的"两侧墙"是斜的摄影棚墙，
        // 不是书架的侧板。
        var uprights = [];
        [-1, 1].forEach(function (side) {
            var upright = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 3.6, 0.78), woodDarkMaterial);
            // 立柱底端落在搁板底面（和参考一样是"撑到板底"，不是浮在板面上）
            upright.position.set(side * 8.35, PLANK_TOP + 1.6, -0.28);
            upright.receiveShadow = true;
            scene.add(upright);
            uprights.push(upright);
        });
        // 背挡（照参考实现的 walnut-back-rail）。
        // 上一版我把它删了 —— 那是错的：它本来该在，问题只是位置。
        // 现在书排的进深已经压平（见 layoutShelf：z = 0.12 - ordered*0.03），
        // 书后背最深 ≈ -0.63；板子加深到 2.0 后，后缘在 -0.91，
        // 所以横挡放在 z = -0.80（前脸 -0.73）既在板面上、又和书留 0.1 净空。
        var backRail = new THREE.Mesh(
            new THREE.BoxGeometry(16.5, 0.17, 0.14), woodDarkMaterial);
        backRail.position.set(0, PLANK_TOP + 0.21, -0.80);
        scene.add(backRail);
        // ================= 【A 档 · 3】书房道具（照用户所选 1+2）=================
        // 位置都是**按相机可见范围算过**的：fov 32 / 相机 z=7.4 时，
        // 书架深度（z≈0）可见横向约 ±3.9，墙面（z=-3.6）约 ±5.8。
        // 所以：墙面高处、以及搁板**前方**的地面看得见；
        // 搁板右端（x≈6~8）其实已经在画面之外 —— 原方案 2 就改成前景右下。
        // 上方墙面：暗木画框 + 一张纸面（挂在书架线上方，不在书后面）
        // （壁灯按用户选择 B 去掉了：只留画框，墙面更干净；那盏暖光也一并去掉）
        var wallFrame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.78, 0.055), woodDarkMaterial);
        wallFrame.position.set(2.7, 2.15, -3.56);
        wallFrame.receiveShadow = true;
        scene.add(wallFrame);
        var framePaper = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.62),
            new THREE.MeshStandardMaterial({ color: '#f6f0e2', roughness: 0.95, metalness: 0 }));
        framePaper.position.set(2.7, 2.15, -3.52);
        scene.add(framePaper);

        // （地面上的三本平放书 + 落地小台灯按用户要求整组去掉；只留墙面上的画框与壁灯。
        //   相应的那盏暖光也一并去掉，避免"没有来源的光"。）

        var dust = addDust(THREE, scene);

        var rigs = state.books.map(function (book, index) { return buildRig(THREE, book, index); });
        rigs.forEach(function (rig) { scene.add(rig.root); });

        shelf = {
            THREE: THREE,
            scene: scene,
            plank: plank,
            plankLip: plankLip,
            backRail: backRail,
            uprights: uprights,
            dust: dust,
            camera: camera,
            rigs: rigs,
            raycaster: new THREE.Raycaster(),
            pointer: new THREE.Vector2(-2, -2),
            clock: new THREE.Clock(),
            startedAt: performance.now(),
            frame: 0,
            // 真正"画出来"的帧数（首帧要编译着色器，可能几百毫秒）。
            // 「正在装订书架…」占位必须等到它涨上来才能收（见 whenShelfPainted）。
            painted: 0,
            hoverIndex: -1,
            disposed: false,
            resizeObserver: null,
            // 房间里参与"按省份换色"的东西（照参考实现的 roomMaterials/roomLights）。
            // 灯光分组：warm = 主光那一路，cool = 冷补光那一路，rim = 擦烫金的轮廓光。
            room: {
                floor: roomFloorMaterial,
                wall: roomWallMaterial,
                wood: plankMaterial,
                woodDark: woodDarkMaterial,
                fog: scene.fog,
                hemi: hemi,
                warm: [key, softKey, spineRake, pageRake].filter(Boolean),
                cool: [fill, backFill].filter(Boolean),
                rim: [rim].filter(Boolean)
            }
        };

        // 建好就先把当前这本的屋子刷上（不过渡，避免开场从 0 号色滑到当前色）
        applyRoomTheme(state.active, true);
        layoutShelf(true);
        startAnimation();

        if ('ResizeObserver' in window) {
            shelf.resizeObserver = new ResizeObserver(function () { resizeShelf(); });
            shelf.resizeObserver.observe(els.stage);
        }
        return true;
    }

    function resizeShelf() {
        if (!shelf || shelf.disposed) return;
        var size = stageSize();
        renderer3d.setSize(size.width, size.height, false);
        shelf.camera.aspect = size.width / size.height;
        shelf.camera.updateProjectionMatrix();
        // ⚠️ setSize 会重建画布的后端缓冲并把它**清空**，而 ResizeObserver 的回调
        // 跑在同一帧的 rAF **之后**（渲染循环那一步已经画完了）—— 于是这一帧合成
        // 上屏的就是那张被清空的画布：透明的，露出底下 #memoryShelf 的米色背景，
        // 看上去就是"屏幕闪一下"。实测这一帧内的事件顺序正是
        // raf → attr(width/height 变了) → raf → attr …：每帧闪一次。
        // 舞台尺寸只变一次时（书架 ↔ 书本模式）只有 1 帧闪，看不出来；顶栏收窄
        // 做成 0.45s 过渡后尺寸连续变，就变成连闪三十来帧。
        // 这里补一帧渲染，把刚清空的缓冲在同一次回调里填回去。
        // 只 render 不 tick：tick 会推进动画时钟（updateBookTurn 吃 delta），
        // 一帧推两次会让翻页速度翻倍。
        renderer3d.render(shelf.scene, shelf.camera);
        // 只用补间更新目标：信息板缩回/展开会让舞台连续变宽变窄，
        // 这里要是即时吸附，就会把书「啪」地按到新位置，过渡全废
        layoutShelf(false);
    }

    // 给一本书起一段**确定的时间线**：起点 = 它此刻实际在哪儿，终点 = rig.target*。
    // 之后每一帧都按 p = (now - t0) / dur 求值，而不是"每帧往前挪一点"，
    // 所以帧率不影响结果，p = 1 时精确落在目标上（首末帧对齐）。
    //
    // seam = true 表示这本书是从书架另一头绕过来的（排位跳了半圈以上）。
    // 沿路插值会让它横穿整个画面 —— 参考实现遇到这种情况是**在看不见的时候瞬移**
    // （updateShelfLayout 里的 wrappedAcrossSeam：直接把 x 写成目标、opacity 归零）。
    // 这里同样处理：立刻落到新位姿，同时让它沉在搁板下面，再从容升起。
    // 「从板后升上来」这类入场的延迟（ms）：等刚让位的那本把精选位腾开再升。
    // 不然两本书会在同一个横坐标上叠着，看着就是"新的一本出现得太快、穿模"。
    var SEAM_RISE_DELAY = 160;

    function startRigTimeline(rig, now, duration, seam, delay, lane) {
        if (!rig || !rig.target) return;
        var sink = rig.sink || 0;
        var teleported = false;
        var sinkPhase = 0;
        if (seam && rig.sinkTarget < 0.5) {
            // 入场（从板后升上来）：瞬移到目标位姿再藏起来，然后原地升起
            sink = 1;
            rig.root.position.copy(rig.target);
            rig.root.rotation.y = rig.targetRotationY;
            rig.root.scale.setScalar(rig.targetScale);
            rig.root.visible = false;
            teleported = true;
        } else if (seam) {
            // ① 退场（跨半圈去书列尾端，目标在容量之外）：**就地沉下去**，
            // 沉完再在隐藏状态下滑到新位置 —— 不瞬移、不凭空消失。
            sinkPhase = SINK_PHASE;
        }
        rig.fromPose = {
            x: rig.root.position.x,
            // ⚠️ y 这里必须分两种情况，混在一起会出大问题：
            //   · 没被瞬移的书：root.position.y 里**已经含**着当前的下沉量，
            //     要先用 + sink*SINK_DEPTH 还原成基础位姿，否则下沉量算两遍；
            //   · seam 那条路刚刚 position.copy(rig.target)，y 已经是目标位姿、
            //     不含下沉量。这时再加一次，就等于把"升上来"整段抵消掉 ——
            //     tick 里 y 会恒等于目标值，那本书变成**凭空出现**在精选位
            //     （正好压在还没滑走的上一本身上："上一本出现得太快、穿模"）。
            y: teleported ? rig.root.position.y : rig.root.position.y + sink * SINK_DEPTH,
            z: rig.root.position.z,
            rotX: rig.root.rotation.x,
            rotY: rig.root.rotation.y,
            scale: rig.root.scale.x,
            sink: sink
        };
        rig.sink = sink;
        rig.animT0 = now + (delay || 0);
        rig.animDur = duration;
        rig.sinkPhase = sinkPhase;
        rig.lane = lane || 0;
        // 入场/退场都走 ease-in-out：默认那套 1-(1-p)³ 是"起步最快"，
        // 用在"升起"上是啪地弹出来，用在"沉下去"上是咣地掉下去。
        rig.animEase = seam ? 'rise' : '';
    }

    function rigProgress(rig, now) {
        return rigEase(rig, rigRawProgress(rig, now));
    }

    // 原始进度（0..1，**未缓动**）：相位切分（先沉后移）必须切在时间轴上，
    // 切在缓动后的进度上会被缓动曲线带偏。
    function rigRawProgress(rig, now) {
        if (!rig || !rig.animDur) return 1;
        var p = (now - rig.animT0) / rig.animDur;
        if (p <= 0) return 0;
        if (p >= 1) return 1;
        return p;
    }

    // 时间线求值：默认 ease-out（1-(1-p)³，起步快、收尾稳，和参考的 damp 手感接近
    // 但**有确定终点**）；'rise' 用 ease-in-out（从板后升起 / 就地沉下都走它）。
    function rigEase(rig, p) {
        if (rig.animEase === 'rise') {
            return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        }
        return 1 - Math.pow(1 - p, 3);
    }

    // 把每本书摆到自己的位置：当前书居中偏左（左上是信息板，右侧留给书列）。
    // 所有位姿都只是"目标"；真正的动画由 startRigTimeline + tick 里的求值完成。
    function layoutShelf(instant) {
        if (!shelf) return;
        if (state.mode === 'book') {
            // 书本模式下书架整排都收起来了：翻页这对按钮和中间的计数都不露头
            if (els.prev) els.prev.hidden = true;
            if (els.next) els.next.hidden = true;
            syncPageCount(false);
            return;
        }
        var layout = shelfLayout();
        var total = shelf.rigs.length;
        if (!total) return;

        var now = performance.now();
        var duration = (instant || reduceMotion) ? 0 : SHELF_MOVE_MS;
        var activeX = layout.activeX;
        var spineStart = layout.spineStart;
        shelf.rigs.forEach(function (rig, index) {
            // 每本书高度不同（BOOK_SIZES），"站在板面上"要按各自的半高算
            var half = (rig.dims ? rig.dims.height : BOOK_H) / 2;
            // 书脚接触阴影只在"书在架上"的时候出现：抽出来 / 摊开后那块阴影要收掉，
            // 否则会留在板上变成一块没来由的暗斑。
            if (rig.contact) rig.contact.visible = (state.mode === 'shelf' && !state.opening);
            // 排位：当前那本在精选位（-1），书列从它右边 0 起。**同一套坐标**才能
            // 判断一本书是从精选位掉回书列尾端（-1 → total-2，跨了半圈以上）。
            var slot = index === state.active
                ? -1
                : (index - state.active - 1 + total) % total;
            var oldSlot = rig.slot;
            var seam = oldSlot !== undefined && Math.abs(slot - oldSlot) > total * 0.5;
            rig.slot = slot;
            // ② 这一本要挪几格 → 决定它自己的时长（封顶）。跨半圈那种（seam）
            // 不算距离：它们要么就地沉下去、要么原地升起，都是"原地"的动作。
            var stepCount = seam || oldSlot === undefined ? 1 : Math.abs(slot - oldSlot);
            var rigDur = duration
                ? Math.min(SHELF_MOVE_MAX_MS,
                    SHELF_MOVE_MS + SHELF_MOVE_PER_STEP_MS * Math.max(0, stepCount - 1))
                : 0;
            var sinkTarget;

            if (index === state.active) {
                // **就地翻开**：点开的那一瞬间不再"抽出来"（不放大、不往前抬）。
                // 之前 state.opening 时会把这本书放大到 1.24、往前 0.95、抬高 0.18，
                // 用户看到的就是"点一下先猛地放大一次"，然后摊开时又放大一次。
                // 现在只在原地转身面对读者，尺寸和位置都保持书架态；
                // 真正的放大交给摊开之后的 settle 阶段（而且幅度更小）。
                var activeScale = 1.14;
                rig.targetScale = activeScale;
                rig.target.set(
                    activeX,
                    PLANK_TOP + half * activeScale,
                    // 精选书也往板里收一点（原来 0.35）：书立着时前后各占 0.855，
                    // 站在 0.35 会探出板沿；0.15 正好整本落在加深后的板面内。
                    0.15
                );
                rig.targetRotationY = state.bookRotation === null
                    ? (state.opening ? 0 : 0.16)
                    : (state.bookRotation * Math.PI / 180);
                sinkTarget = 0;
            } else {
                var beyond = slot >= layout.capacity;
                // 尺度随排位递减：越靠后越矮越小，一眼看出先后
                var scale = Math.max(0.78, 0.93 - slot * 0.025);
                // 原来这里有一项"高低错落"（每本抬 0~0.088），书一多、每本的
                // 高度又不同，看起来就是"这一排书底部没对齐"。整排压平：
                // 统一落到板面上，高矮差别只由各自的真实高度给。
                // 高低错落已按用户要求去掉（值恒为 0，保留变量供下面复用）
                var stagger = 0;
                rig.targetScale = scale;
                rig.target.set(
                    spineStart + slot * layout.gap,
                    PLANK_TOP + half * scale + stagger,
                    // 进深方向只留很小的错落（原来是每本退 0.1）。
                    // 退到后面时，书的后背会伸到搁板外、还会撞上背挡 ——
                    // 用户看到的「书本开口朝后的位置穿进横杠」就是这么来的。
                    // 参考实现的一排书基本站在同一进深上，这里也压平。
                    0.12 - slot * 0.03
                );
                // 侧身立着露出书脊，并按序号微调倾角，避免整排像复制粘贴
                rig.targetRotationY = (84 + ((index % 3) - 1) * 1.1) * Math.PI / 180;
                // 一屏放不下的书**不是瞬间隐藏**，而是沉到搁板下面去 ——
                // 板子是实心的，从板后消失/升起读起来就是"挪到下一层架子上"，
                // 循环翻到那一头时也不会出现"唰地一下没了"。
                sinkTarget = beyond ? 1 : 0;
            }
            rig.sinkTarget = sinkTarget;
            rig.visible = sinkTarget < 0.5;
            // ④ 只有"从板后升上来"的那种 seam（入场，sinkTarget=0）需要延迟，
            // 而且按位次错开：slot 越小离精选位越近，先归位。
            // 退场那种（sinkTarget=1）不等，直接就地往下沉。duration=0
            // （instant / reduceMotion）时两者都不需要。
            var riseDelay = (seam && sinkTarget < 0.5 && rigDur)
                ? SEAM_RISE_DELAY + Math.max(0, slot) * SEAM_RISE_STAGGER
                : 0;
            // ③ 被点中的那本（从书列里挪 2 格以上过来）走"前面那条道"
            var lane = (index === state.active && !seam && stepCount >= 2) ? 1 : 0;
            startRigTimeline(rig, now, rigDur, seam, riseDelay, lane);
        });

        // 分页按钮 / 上一本下一本只在**书架**这一层有用：书已经摊开在手上时
        // 它们必须收掉（之前只判 state.level，书本模式里 level 还停在 'shelf'，
        // 于是右边那颗「›」一直挂在那里）。
        var shelfLevel = state.level === 'shelf' && state.mode === 'shelf';
        if (els.prev) els.prev.hidden = !shelfLevel;
        if (els.next) els.next.hidden = !shelfLevel;
        syncPageCount(shelfLevel);
    }

    // 顶栏那对箭头中间的「第几 / 共几本」。它们一次翻**一屏**（见 pageStep），
    // 只看箭头本身会以为它在乱跳 —— 有这行数字，"1/11 → 6/11 → 11/11 → 5/11"
    // 的规律就自己说清楚了。字号和颜色压到最淡，不跟标题抢视线。
    function syncPageCount(show) {
        var count = els.pageCount;
        if (!count) return;
        var total = state.books.length;
        if (!show || !total) {
            count.hidden = true;
            return;
        }
        count.hidden = false;
        count.textContent = (state.active + 1) + ' / ' + total;
    }

    // 顶栏那对箭头一次翻**一屏**：精选书右边排不下的那几本（沉到搁板下面）
    // 一次换上来。一次一本已经有滚轮、←/→ 方向键、左侧书脊轨三条路，
    // 不需要第四处；真正没有替代品的是"跳到后面那一屏"。
    function pageStep() {
        if (!shelf || state.mode !== 'shelf') return 1;
        var total = state.books.length;
        var cap = Math.max(1, shelfLayout().capacity);
        // 一屏就装得下时"翻一屏"会原地打转（加完再对总数取模还是自己），退回一本
        if (total < 2 || cap >= total - 1) return 1;
        return cap;
    }

    // 长按拖动旋转当前这本：跟手的角度**不走时间线**（手指到哪儿书到哪儿），
    // 同时把这段补间的起点一起改掉，免得松手后从旧角度重新插一遍。
    function applyActiveRotation() {
        if (!shelf || state.mode !== 'shelf') return;
        var rig = shelf.rigs[state.active];
        if (!rig || !rig.target) return;
        var angle = state.bookRotation === null
            ? 0.16
            : (state.bookRotation * Math.PI / 180);
        rig.targetRotationY = angle;
        if (rig.fromPose) rig.fromPose.rotY = angle;
        rig.animDur = 0;
        rig.root.rotation.y = angle;
    }

    // ---------------- 按省份换屋子（照 complete-shelf 的 applyBookTheme / updateTheme） ----------------
    // 参考实现换书时把 roomMaterials（地、墙、木架、接触阴影）、roomLights（7 盏灯）
    // 和 scene.fog 一起 lerp 到新书的 palette，所以过渡看起来是"整间屋子换了光"，
    // 而不是"书换了个颜色"。这里做同一件事，只把调色板换成 roomTint 算出来的浅色系。
    var ROOM_THEME_KEYS = ['wall', 'floor', 'wood', 'woodDark', 'light', 'fill', 'rim', 'fog'];
    var roomTheme = { index: -1, target: {}, moving: false };

    // 信息板/背景这些 DOM 侧也跟着走：只改几个 CSS 变量，纸张与墨色不动，
    // 所以对比度不受影响（3D 里是"墙"，DOM 里是"面板的底色与强调色"）。
    function syncPanelTheme(index) {
        if (!els.root || !els.root.style) return;
        var style = els.root.style;
        style.setProperty('--ms-room-wall', roomTint(index, 'wall'));
        style.setProperty('--ms-room-floor', roomTint(index, 'floor'));
        style.setProperty('--ms-accent', roomTint(index, 'accent'));
        style.setProperty('--ms-gold', roomTint(index, 'gold'));
    }

    function snapRoomTheme() {
        if (!shelf || !shelf.room) return;
        var room = shelf.room;
        var target = roomTheme.target;
        var copy = function (material, color) {
            if (material && material.color && color) material.color.copy(color);
        };
        copy(room.floor, target.floor);
        copy(room.wall, target.wall);
        copy(room.wood, target.wood);
        copy(room.woodDark, target.woodDark);
        copy(room.fog, target.fog);
        room.warm.forEach(function (light) { copy(light, target.light); });
        room.cool.forEach(function (light) { copy(light, target.fill); });
        room.rim.forEach(function (light) { copy(light, target.rim); });
        if (room.hemi) {
            copy(room.hemi, target.light);
            if (room.hemi.groundColor && target.woodDark) room.hemi.groundColor.copy(target.woodDark);
        }
        roomTheme.moving = false;
    }

    function applyRoomTheme(index, instant) {
        if (!shelf || !shelf.room) return;
        var THREE = shelf.THREE;
        if (index === roomTheme.index && !instant) return;
        roomTheme.index = index;
        ROOM_THEME_KEYS.forEach(function (key) {
            if (!roomTheme.target[key]) roomTheme.target[key] = new THREE.Color();
            roomTheme.target[key].set(roomTint(index, key));
        });
        syncPanelTheme(index);
        if (instant || reduceMotion) snapRoomTheme();
        else roomTheme.moving = true;
    }

    function updateRoomTheme(delta) {
        if (!roomTheme.moving || !shelf || !shelf.room) return;
        var room = shelf.room;
        var target = roomTheme.target;
        // 5.5 是参考实现 updateTheme 里的收敛速度
        var amount = 1 - Math.exp(-delta * 5.5);
        var largestGap = 0;
        var ease = function (material, color) {
            if (!material || !material.color || !color) return;
            var current = material.color;
            largestGap = Math.max(largestGap,
                Math.abs(current.r - color.r) + Math.abs(current.g - color.g) +
                Math.abs(current.b - color.b));
            current.lerp(color, amount);
        };
        ease(room.floor, target.floor);
        ease(room.wall, target.wall);
        ease(room.wood, target.wood);
        ease(room.woodDark, target.woodDark);
        ease(room.fog, target.fog);
        room.warm.forEach(function (light) { ease(light, target.light); });
        room.cool.forEach(function (light) { ease(light, target.fill); });
        room.rim.forEach(function (light) { ease(light, target.rim); });
        ease(room.hemi, target.light);
        if (room.hemi && room.hemi.groundColor && target.woodDark) {
            ease({ color: room.hemi.groundColor }, target.woodDark);
        }
        // 收敛到位就吸附到精确目标：这样过渡的首末帧都是确定值，不会留一丝残差
        if (largestGap < 0.004) snapRoomTheme();
    }

    function startAnimation() {
        if (!shelf) return;
        var THREE = shelf.THREE;

        function frame() {
            if (!shelf || shelf.disposed) return;
            // 整个渲染循环包一层：任何一帧里抛异常都会让 requestAnimationFrame
            // 不再续期，整个 3D 场景就永久冻住 —— 必须保证循环能活下去。
            try {
                tick();
            } catch (error) {
                console.warn('书架渲染帧出错（已跳过该帧）：', error);
            }
            if (shelf && !shelf.disposed) shelf.frame = requestAnimationFrame(frame);
        }

        function tick() {
            var delta = Math.min(0.05, shelf.clock.getDelta());
            var now = performance.now();
            updateDust(shelf.dust, (now - shelf.startedAt) / 1000);
            // 屋子配色也跟着帧走：换省份时墙、地、木架、灯一起过渡到新一套
            updateRoomTheme(delta);

            if (state.mode === 'book') updateBookTurn(delta);

            // 书本入场：从「刚掀开一条缝」的角度落到摊平，避免书架上那本书
            // 翻开一半之后直接硬切成另一本书
            if (state.mode === 'book' && book) {
                if (updateClosing()) {
                    // 合书动画进行中：本帧的摆放已经由它接管，直接进入渲染
                } else {
                // 每帧重算一遍适配比例：信息板缩回/展开时画幅在变宽变窄，
                // 书要跟着重新贴合，不能只在入场那一次算死
                // 封面翻开过一半就进入 reading（参考把 reading 与 inspection 分开）
                setPhase(state.bookOpen >= 0.5 ? 'reading' : 'inspection');
                var fit = fitBookScale();
                var view = state.view;
                var eased = 1;
                if (state.bookEnterAt) {
                    // 900ms 的 ease-in-out：起步和落位都慢，中间快，最不容易看成「切换」
                    var t = Math.min(1, (performance.now() - state.bookEnterAt) / 900);
                    eased = t < 0.5
                        ? 4 * t * t * t
                        : 1 - Math.pow(-2 * t + 2, 3) / 2;
                }
                var from = state.bookFrom || {
                    x: 0, y: BOOK_INSPECT_Y, z: BOOK_Z, scale: fit, rotX: BOOK_PITCH, rotY: 0
                };
                // 尺寸、倾角、位置**全部从当时的实际值插到目标值**，
                // 不再用「从 0.88 倍长到 1 倍」这种写法，避免交接瞬间跳一下
                var bookScale = lerp(from.scale, fit, eased);
                book.group.scale.setScalar(bookScale);
                // 书**自己不再吃视角**：画面上看到的角度变化全部由相机绕它运动产生
                // （原来把 yaw/pitch 加在书上，屋子纹丝不动，看着就是"书在转、背景是贴纸"）
                book.group.rotation.y = lerp(from.rotY, 0, eased);
                book.group.rotation.x = lerp(from.rotX, BOOK_PITCH, eased);
                // 摊开后让**整本书的中心**落在画面正中（不是书脊）。
                // openCenterX 是封面摊平时实测的包围盒中心；没有它（老数据）就
                // 退回按书脊估的旧算法。
                var openCenterX = typeof book.openCenterX === 'number'
                    ? book.openCenterX
                    : (book.dims ? book.dims.spineX : -0.75);
                var centerX = -openCenterX * bookScale;
                book.group.position.set(
                    lerp(from.x, centerX, eased),
                    // 落位高度：抬到 BOOK_INSPECT_Y（比原来高 0.73），离地更远
                    lerp(from.y, BOOK_INSPECT_Y, eased),
                    lerp(from.z, BOOK_Z, eased)
                );
                // ===== 检视态机位：绕书心的轨道（orbit / pan / zoom 全在相机上）=====
                // 相机一动，墙面的明暗、地板的透视、书本的轮廓全都跟着变 ——
                // 这才是"整间屋子跟着书一起转"，而不是只转一本书。
                // 视觉中心已经在世界 x = 0（上面那步就是把它挪过来的），
                // 相机盯着 0 + 平移量即可
                var focusX = view.panX;
                var focusY = BOOK_INSPECT_Y + view.panY;
                var focusZ = BOOK_Z;
                // 滚轮缩放 = 相机拉近拉远（过去是缩书本模型）
                var dist = INSPECT_DIST / clamp(view.zoom, 0.35, 3);
                // 俯仰限位放在**角度**上、而不是像之前那样去夹相机高度：
                // 夹高度会把 x/z 留在"按原角度算"的位置上，等于把相机硬拽近，
                // 用户看到的就是"从下面看的时候自动放大"。夹角度则半径不变。
                var minPitch = Math.max(-1.1,
                    Math.asin(clamp((ROOM_FLOOR_Y + 0.3 - focusY) / dist, -1, 1)));
                var pitch = clamp(view.pitch, minPitch, INSPECT_PITCH_MAX);
                var flat = Math.cos(pitch) * dist;
                // 注意这个**负号**：左右拖动时"看起来在转"的是被看的物体，不是相机。
                // 往右拖 = 相机绕到左边去 = 书朝右边转（和改前的「转书」以及
                // three 的 OrbitControls 是同一个方向）。少这个负号，手感就是反的。
                var orbitX = focusX - Math.sin(view.yaw) * flat;
                var orbitY = focusY + Math.sin(pitch) * dist;
                var orbitZ = focusZ + Math.cos(view.yaw) * flat;
                if (eased >= 1) {
                    camPlan.pos.x = orbitX;
                    camPlan.pos.y = orbitY;
                    camPlan.pos.z = orbitZ;
                    camPlan.target.x = focusX;
                    camPlan.target.y = focusY;
                    camPlan.target.z = focusZ;
                } else {
                    // 入场那一秒：从书架机位滑到检视机位（首尾都精确）
                    camPlan.pos.x = lerp(0, orbitX, eased);
                    camPlan.pos.y = lerp(0.42, orbitY, eased);
                    camPlan.pos.z = lerp(CAMERA_Z, orbitZ, eased);
                    camPlan.target.x = lerp(0, focusX, eased);
                    camPlan.target.y = lerp(0.3, focusY, eased);
                    camPlan.target.z = lerp(0, focusZ, eased);
                }
                }
            }
            shelf.rigs.forEach(function (rig, index) {
                // 位姿一律由时间线求值：p = 0 就是上一帧的实际位姿（首帧不跳），
                // p = 1 就是 layoutShelf 给的精确目标（末帧不留残差）。
                // ① 相位切分：退场那几本要在时间轴上"先沉、后移"。切分必须切在
                // **原始**进度上（切缓动后的进度会被曲线带偏），所以这里分别算出
                // sinkP（管下沉）和 moveP（管位移/旋转/缩放）。
                var raw = rigRawProgress(rig, now);
                var p = rigEase(rig, raw);
                var sinkP = p;
                var moveP = p;
                if (rig.sinkPhase > 0 && rig.sinkPhase < 1) {
                    var ph = rig.sinkPhase;
                    sinkP = rigEase(rig, clamp(raw / ph, 0, 1));
                    moveP = rigEase(rig, clamp((raw - ph) / (1 - ph), 0, 1));
                }
                var from = rig.fromPose || {
                    x: rig.target.x, y: rig.target.y, z: rig.target.z,
                    rotX: 0, rotY: rig.targetRotationY, scale: rig.targetScale, sink: 0
                };
                if (state.mode === 'book') {
                    // 当前这本由上面的书本逻辑驱动；其余的书按同一条时间线退场
                    // （沉到画面下缘之外 —— 书本模式里搁板是藏起来的，没人替它们挡）
                    if (book && rig === book.rig) return;
                    var bookSink = lerp(from.sink, 1, p);
                    rig.sink = bookSink;
                    rig.root.position.set(
                        lerp(from.x, rig.target.x, p),
                        lerp(from.y, rig.target.y, p) - bookSink * SINK_DEPTH,
                        lerp(from.z, rig.target.z, p)
                    );
                    rig.root.rotation.x = lerp(from.rotX, 0, p);
                    rig.root.rotation.y = lerp(from.rotY, rig.targetRotationY, p);
                    rig.root.scale.setScalar(lerp(from.scale, rig.targetScale, p));
                    rig.root.visible = bookSink < 0.999;
                    return;
                }
                // 悬停抬升是**叠加**在时间线之外的：它由指针驱动，不是过渡，
                // 所以单独用一个阻尼量（0..1），不去污染上面那段确定性插值。
                var hovering = !reduceMotion && index === shelf.hoverIndex && index !== state.active;
                var hover = THREE.MathUtils.damp(rig.hover || 0, hovering ? 1 : 0, 12, delta);
                rig.hover = hover;
                // 沉下去 / 升上来：一段行程里包含"从板后消失"和"从板后出现"
                var sink = lerp(from.sink, rig.sinkTarget === undefined ? 0 : rig.sinkTarget, sinkP);
                rig.sink = sink;
                // ③ 被点中的那本：途中朝镜头偏一点、略微放大，落位时收回
                var bump = rig.lane ? Math.sin(Math.PI * moveP) : 0;
                rig.root.position.set(
                    lerp(from.x, rig.target.x, moveP),
                    lerp(from.y, rig.target.y, moveP) - sink * SINK_DEPTH,
                    lerp(from.z, rig.target.z, moveP) + hover * 0.3 + bump * LANE_Z
                );
                // 俯仰也必须回到 0：书本模式会把 rotation.x 拨到 BOOK_PITCH，
                // 而这一行以前没有，于是退出后那本书永远斜着 —— 既包括关掉之后，
                // 也包括「选中下一本之后，上一本在书列里仍是斜的」。
                rig.root.rotation.x = lerp(from.rotX, 0, moveP);
                rig.root.rotation.y = lerp(from.rotY, rig.targetRotationY, moveP);
                rig.root.scale.setScalar(lerp(from.scale, rig.targetScale, moveP) * (1 + bump * LANE_SCALE));
                // 完全沉下去之后才摘掉：p = 1 时它已经在画面/搁板之外，
                // 这一下 visible = false 不会看见任何东西"啪"地消失。
                rig.root.visible = sink < 0.999;
                if (rig.contact) {
                    rig.contact.visible = !state.opening && sink < 0.5;
                }
                var openTarget = (state.opening && index === state.active) ? -1.92 : 0;
                rig.coverPivot.rotation.y = THREE.MathUtils.damp(rig.coverPivot.rotation.y, openTarget, 7, delta);
            });

            // 书架态：棚位固定（摊开前后同一个 z，避免"点一下立马放大"）。
            // 书本态与合书过程：机位由上面算好的 camPlan 决定。
            if (state.mode !== 'book') {
                camPlan.pos.x = 0;
                camPlan.pos.y = 0.42;
                camPlan.pos.z = CAMERA_Z;
                camPlan.target.x = 0;
                camPlan.target.y = 0.3;
                camPlan.target.z = 0;
            }
            // 相机只按计划赋值，不再每帧 damp 追目标（阻尼只逼近不相等，
            // 会让"最后一帧还在动"，也就没有确定的首末帧）
            shelf.camera.position.set(camPlan.pos.x, camPlan.pos.y, camPlan.pos.z);
            shelf.camera.lookAt(camPlan.target.x, camPlan.target.y, camPlan.target.z);

            renderer3d.render(shelf.scene, shelf.camera);
            // 记一帧"已经画到画布上"。注意计数器放在 render 之后：
            // 首帧的 render 里要编译所有着色器（慢机器几百毫秒），
            // 这一步过去之后，画布上才真的有内容。
            shelf.painted += 1;
        }
        shelf.frame = requestAnimationFrame(frame);
    }

    function disposeShelf() {
        if (!shelf) return;
        shelf.disposed = true;
        // 屋子配色是模块级状态：场景销毁了就把它的"当前值"一并作废，
        // 下次重建（从章节页返回书架）会按那时的选中省份重新刷一遍
        roomTheme.moving = false;
        roomTheme.index = -1;
        if (shelf.frame) cancelAnimationFrame(shelf.frame);
        if (shelf.resizeObserver) shelf.resizeObserver.disconnect();
        shelf.rigs.forEach(disposeRig);
        if (renderer3d) {
            renderer3d.dispose();
            if (renderer3d.domElement && renderer3d.domElement.parentNode) {
                renderer3d.domElement.parentNode.removeChild(renderer3d.domElement);
            }
        }
        renderer3d = null;
        shelf = null;
        els.canvas = null;
        // 书体本身没独立对象了（就是 rig.root），它的释放由 disposeRig 负责
        book = null;
        (state.bookTextures || []).forEach(function (texture) {
            if (texture && texture.dispose) texture.dispose();
        });
        state.bookTextures = [];
        state.bookPages = [];
        state.bookSpread = 0;
        state.pageTurn = null;
    }

    // 拾取：射线打在所有书体上，返回命中的书本下标
    function pickBookIndex(event) {
        if (!shelf) return -1;
        var rect = els.stage.getBoundingClientRect();
        shelf.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        shelf.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        shelf.raycaster.setFromCamera(shelf.pointer, shelf.camera);
        // 正在沉下去（沉到一半）的书已经被搁板挡住大半，不该还能点中：
        // 「看不见却能点」比「点不到」更让人困惑。
        var roots = shelf.rigs.filter(function (rig) {
            return rig.root.visible && (rig.sink || 0) < 0.5;
        })
            .map(function (rig) { return rig.root; });
        var hits = shelf.raycaster.intersectObjects(roots, true);
        if (!hits.length) return -1;
        var node = hits[0].object;
        while (node && node.parent) {
            var found = shelf.rigs.findIndex(function (rig) { return rig.root === node; });
            if (found >= 0) return found;
            node = node.parent;
        }
        return -1;
    }

    // ---------------- 封面照片（异步） ----------------

    var imageCache = new Map();      // url -> Promise<Image>

    function loadImage(url) {
        if (imageCache.has(url)) return imageCache.get(url);
        var promise = new Promise(function (resolve, reject) {
            var image = new Image();
            image.onload = function () { resolve(image); };
            image.onerror = function () { reject(new Error('封面照片加载失败')); };
            image.src = url;
        });
        // 失败的不要缓存，下次切回来还能重试
        promise.catch(function () { imageCache.delete(url); });
        imageCache.set(url, promise);
        return promise;
    }

    // 跨域图不能直接画进 canvas（会污染画布，WebGL 贴图会直接失败），
    // 统一走旅行页的同源代理 canvasSafeImageUrl。
    function attachCoverPhoto(rig) {
        // 快速翻书时不要每本都去拉封面：等同源代理那 260ms 内没人再翻，才取当前这本。
        // 同源代理对慢图床有 15 秒超时，少发无谓请求也顺带少几次 502。
        clearTimer('cover');
        setTimer('cover', function () { loadCoverPhoto(rig); }, 260);
    }

    function loadCoverPhoto(rig) {
        if (!rig || !rig.book || !rig.book.cover || !rig.coverTexture) return;
        if (rig.disposed) return;
        var d = api();
        if (!d) return;
        // 走城记那套缩略规则再进 canvas：原图动辄 1MB 以上，而封面贴图只有 384px 宽，
        // 用缩略既和城市卡片墙口径一致，也避免慢图把同源代理拖到超时（代理 15 秒就 502）。
        var thumb = d.cityCardImageUrl(rig.book.cover) || rig.book.cover;
        var safe = d.canvasSafeImageUrl(thumb);
        if (!safe) return;
        loadImage(safe).then(function (image) {
            if (rig.disposed) return;
            rig.book._coverImage = image;
            if (rig.coverTexture._repaint) rig.coverTexture._repaint();
        }).catch(function () {
            // 拿不到照片就停在布面 + 烫金书名，不影响翻书
            // 标记一下"这张封面不用等了"：否则「正在装订书架…」会白等满 2.5 秒
            rig.coverSettled = true;
        });
    }

    // ---------------- L1 书架：DOM ----------------

    function bgStyle(url) {
        if (!url) return '';
        return " style='background-image:url(" + JSON.stringify(String(url)) + ")'";
    }

    // ---------------- 左侧竖栏（A 档：顶部竖排词标 + 省份书脊轨）----------------
    // 由后台设置 shelfLeftRail 决定：both / rail / wordmark / none。
    // 书脊轨是**导航**：点一条即 setActive，和滚轮、←/→ 共用同一套逻辑；
    // 词标是纯装饰（竖排"旅行记忆 · TRAVEL LIBRARY"）。两者纵向分工，不重叠。
    function leftRailMode() {
        var cfg = window.FOOTPRINT_CONFIG || {};
        var mode = cfg.shelfLeftRail || 'both';
        return ['both', 'rail', 'wordmark', 'none'].indexOf(mode) >= 0 ? mode : 'both';
    }

    function renderLeftRail() {
        var host = els.stage;
        if (!host) return;
        var old = $('msRail');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var mode = leftRailMode();
        if (els.root) els.root.classList.toggle('has-rail', mode !== 'none' && mode !== 'wordmark');
        if (mode === 'none') return;
        var html = '';
        if (mode === 'both' || mode === 'wordmark') {
            html += '<div class="ms-rail-word" aria-hidden="true"><span>旅行记忆 · TRAVEL LIBRARY</span></div>';
        }
        if (mode === 'both' || mode === 'rail') {
            // ③ 紧凑模式：书超过 16 本时只显示省名首字（hover/聚焦仍是全名），
            // 否则 30+ 条竖排全名会挤成长条、且一屏放不下太多
            var compact = state.books.length > 16;
            html += '<div class="ms-rail-list" role="tablist" aria-label="省份书脊">' +
                state.books.map(function (item, index) {
                    return '<button class="ms-rail-item' + (index === state.active ? ' active' : '') +
                        '" type="button" role="tab" aria-selected="' + (index === state.active) + '" ' +
                        'data-ms-rail="' + index + '" title="' + esc(item.name) + '" ' +
                        'aria-label="' + esc(item.name) + '">' +
                        esc(compact ? item.name.charAt(0) : item.name) + '</button>';
                }).join('') +
                '</div>';
        }
        host.insertAdjacentHTML('beforeend',
            '<div class="ms-rail' + (state.books.length > 16 ? ' is-compact' : '') +
            '" id="msRail">' + html + '</div>');
        var rail = $('msRail');
        if (!rail) return;
        rail.querySelectorAll('[data-ms-rail]').forEach(function (node) {
            node.addEventListener('click', function (event) {
                event.stopPropagation();
                setActive(Number(node.getAttribute('data-ms-rail')));
            });
        });
        // ① 滚轮冲突：列表自己还能滚时把事件消化掉，否则它会冒泡到舞台 ——
        // 变成"边滚列表边切省份"（11 本时几乎撞不到，34 个省级行政区必然撞上）
        var list = rail.querySelector('.ms-rail-list');
        if (list) {
            list.addEventListener('wheel', function (event) {
                if (list.scrollHeight > list.clientHeight + 1) event.stopPropagation();
            }, { passive: true });
        }
        syncLeftRailScroll();
        syncInfoCardPosition();
    }

    // ② 可滚提示：列表真的溢出时才加 is-scrollable，由 CSS 在上下加渐隐遮罩
    // （不加滚动条，保持左栏干净；不溢出时不留任何痕迹）
    function syncLeftRailScroll() {
        var rail = $('msRail');
        if (!rail) return;
        var list = rail.querySelector('.ms-rail-list');
        if (!list) return;
        list.classList.toggle('is-scrollable', list.scrollHeight > list.clientHeight + 2);
    }

    // 当前这本换了就更新书脊轨高亮（不重建 DOM，避免连点时闪烁）
    function syncLeftRail() {
        var rail = $('msRail');
        if (!rail) return;
        rail.querySelectorAll('[data-ms-rail]').forEach(function (node) {
            var on = Number(node.getAttribute('data-ms-rail')) === state.active;
            node.classList.toggle('active', on);
            node.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        syncInfoCardPosition();
    }

    // 卡片跟着"选中的那条书脊"上下移动：把卡片竖直中心对到该条目的中心，
    // 再夹在舞台内（上留 16px、下留 16px），差值写成 --ms-card-y；
    // CSS 上给 margin-top 加了 transition，所以切换时是滑过去的。
    function syncInfoCardPosition() {
        var card = document.querySelector('.ms-info');
        var rail = $('msRail');
        if (!card || !rail || !els.stage) return;
        var item = rail.querySelector('.ms-rail-item.active');
        // ⚠️ 变量必须写在**不会被替换的祖先**（#memoryShelf）上：
        // updateInfo() 每次都会把卡片整个 outerHTML 换掉，写在卡片自己身上的
        // inline 变量会随旧元素一起消失 —— 那正是"先滑到位、又立刻闪回顶部"的原因。
        var root = els.root;
        if (!root) return;
        if (!item) { root.style.removeProperty('--ms-card-y'); return; }
        var stageRect = els.stage.getBoundingClientRect();
        var itemRect = item.getBoundingClientRect();
        var cardRect = card.getBoundingClientRect();
        var itemCenter = itemRect.top + itemRect.height / 2 - stageRect.top;
        var minTop = 16;
        var maxTop = Math.max(minTop, stageRect.height - cardRect.height - 16);
        // 卡片的**竖直中心**对准选中那条书脊的**竖直中心**（用户要的"高度居中
        // 对准"）。只有一种情况允许对不准：卡片会顶出舞台上/下沿时，夹回去 ——
        // 也就是末几本会停在舞台底沿附近、不再继续下移。这是用户明确接受的
        // "到了视口边缘可以不对准"。
        // ⚠️ 别再人为收窄行程（试过 ±110px）：11 条书脊跨 540px，±110px 只够
        // 盖住前两条，第 3 本往后全钉死在同一高度 —— 那正是"从第 3 本开始就不
        // 往下走了"。限制只能来自"别越出舞台"这一条。
        var target = itemCenter - cardRect.height / 2;
        target = Math.max(minTop, Math.min(maxTop, target));
        root.style.setProperty('--ms-card-y', target.toFixed(1) + 'px');
    }

    function infoHtml(book) {
        if (!book) return '';
        return '<aside class="ms-info" id="msInfo">' + infoInnerHtml(book) + '</aside>';
    }

    // 卡片内容（不含外壳）。外壳单独一层是有原因的：切换省份时只换 innerHTML，
    // 让 <aside class="ms-info"> 这个元素**留下来**。位置靠 CSS 过渡（translate）
    // 驱动，而过渡只挂在"一直存在的元素"上才会跑 —— 换掉元素等于把卡片的位置
    // 瞬移过去（之前用 outerHTML 时就是这样：实测切换瞬间卡片已经在目标高度上，
    // 那段 margin-top 过渡从来没跑过）。
    function infoInnerHtml(book) {
        if (!book) return '';
        var dateText = book.latestTime ? formatDate(book.latestTime) : '时间未记录';
        // A1/面板改造：城市做成标签（比"威海市 · 青岛市 · 泰安市"好扫），超过 6 个收成 +N。
        // 原来那段"长按拖动…"的操作说明整段去掉 —— 舞台底部已有同样的提示，重复且是噪声。
        var shown = book.cities.slice(0, 6);
        var rest = book.cities.length - shown.length;
        var chips = shown.map(function (city) {
            return '<li>' + esc(city.name) + '</li>';
        }).join('') + (rest > 0 ? '<li class="more">+' + rest + '</li>' : '');
        // （缩略带按用户要求去掉：卡片保持"扣掉照片也就是一张藏书票"的干净样子）
        return (
            // ④ 大号水印序号：本书在书架里的位次，压在卡片一角当装饰
            '<span class="ms-info-wm" aria-hidden="true">' +
                String(state.active + 1).padStart(2, '0') + '</span>' +
            '<span class="ms-info-seal" aria-hidden="true">' + esc(book.name.charAt(0)) + '</span>' +
            '<span class="ms-info-count">第 ' + (state.active + 1) + ' / ' + state.books.length + ' 本</span>' +
            '<h3 class="ms-info-name' + nameSizeClass(book.name) + '">' + esc(book.name) + '</h3>' +
            '<div class="ms-info-rule" aria-hidden="true"></div>' +
            '<div class="ms-info-stats">' +
              '<span><b>' + book.cityCount + '</b>座城市</span>' +
              '<span><b>' + book.photoCount + '</b>张照片</span>' +
            '</div>' +
            '<div class="ms-info-date">最近到访<strong>' + esc(dateText) + '</strong></div>' +
            (book.cities.length ? '<ul class="ms-info-cities">' + chips + '</ul>' : ''));
    }

    // 交叉淡入用的"幽灵"（旧卡的克隆体）：**同一时刻只允许存在一张**。
    // 每次切换都克隆一张、各自带一个移除定时器，70ms 连点六下就会叠出四张
    // 半透明旧卡，而且它们停在各自当时的高度上，看起来是一道拖影。
    var infoGhost = null;
    var infoGhostTimer = 0;

    function updateInfo() {
        var info = $('msInfo');
        if (!info) return;
        // 没有数据时**绝对不能**把 outerHTML 换成空串：那等于把信息板整个从
        // .ms-scene 里删掉，网格只剩一个孩子，舞台就会掉到第一列（372px）里，
        // 于是「页面闪一下、msStage 被拉伸、书的位置也不对了」。
        if (!state.books[state.active]) return;
        if (reduceMotion) {
            info.innerHTML = infoInnerHtml(state.books[state.active]);
            syncInfoCardPosition();          // 重渲染后按当前书脊重新对齐
            return;
        }
        // ④ 真·交叉淡入：先把现在这张卡克隆一份、钉在原地当"幽灵"，
        // 卡片本体立刻换成新内容并在原处淡入；幽灵留在原处淡出。
        // 这样换内容时没有"旧卡淡出 → 空档 → 新卡淡入"的空窗（之前 .leaving
        // 那版会先白一下），过渡是一条不断档的叠化。
        if (infoGhost && infoGhost.parentNode) infoGhost.parentNode.removeChild(infoGhost);
        clearTimeout(infoGhostTimer);
        var rect = info.getBoundingClientRect();
        var ghost = info.cloneNode(true);
        ghost.removeAttribute('id');
        ghost.classList.add('ms-info-ghost');
        ghost.style.position = 'fixed';
        ghost.style.left = rect.left + 'px';
        ghost.style.top = rect.top + 'px';
        ghost.style.width = rect.width + 'px';
        ghost.style.margin = '0';
        // 卡片的竖直位置现在由 translate 驱动（见 CSS .ms-info），而 top 已经把
        // 它算进去了 —— 幽灵必须把自己的 translate 清掉，否则整张卡会再偏一次。
        ghost.style.translate = 'none';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '5';
        // 挂在 #memoryShelf 里而不是 <body>：卡片的纸色来自 --ms-room-wall /
        // --ms-room-floor（这两个变量定义在 #memoryShelf 上），挂到 body 上
        // 变量取不到 → 幽灵会变成一张没有底色的空框。
        (els.root || document.body).appendChild(ghost);
        infoGhost = ghost;
        // 幽灵是临时物：动画跑完（220ms）就撤，绝不留在页面上
        infoGhostTimer = setTimeout(function () {
            if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
            if (infoGhost === ghost) infoGhost = null;
        }, 260);
        // 只换内容、不换外壳：卡片元素留下来，位置过渡才有东西可挂
        info.innerHTML = infoInnerHtml(state.books[state.active]);
        syncInfoCardPosition();              // 重渲染后按当前书脊重新对齐
    }

    // 「正在装订书架…」什么时候才能收？
    // ------------------------------------------------------------------
    // 之前是 initShelf() 一返回就淡掉 —— 但那一秒只是把 GPU 资源建好了，
    // 画布上还是空的：首帧 render 要编译所有着色器（慢机器上几百毫秒），
    // 于是用户看到的正是"文字已经没了、书还没出来"。
    // 现在等两件事都齐了才收：
    //   ① shelf.painted >= 3 —— 画布上真的连出三帧画面（首帧编译、次帧起画）；
    //   ② 当前这本的封面照片有着落 —— 拿到图了，或者这本本来就没有照片，
    //      或者等满 2.5 秒（图床慢不该把占位卡死，缺席的封面会自己补上）。
    // 标签页切到后台时 rAF 会停，这时"再等一会儿"而不是直接放弃，
    // 免得后台转一圈回来，占位早没了、画面却还是空的。
    function whenShelfPainted(done) {
        var waited = 0;
        var step = function () {
            if (!shelf || shelf.disposed) { done(); return; }
            if (document.hidden) {                       // 后台不记账，等回到前台再说
                waited = 0;
                setTimeout(step, 120);
                return;
            }
            var rig = shelf.rigs[state.active];
            var painted = shelf.painted >= 3;
            var coverSettled = !rig || !rig.book || !rig.book.cover ||
                !!rig.book._coverImage || rig.coverSettled === true || waited > 2500;
            if (painted && coverSettled) { done(); return; }
            waited += 60;
            setTimeout(step, 60);
        };
        step();
    }

    function renderShelfStage() {
        var book = state.books[state.active];
        // 书架的说明文案必须在这里补上：open() 里先写的是「正在整理…」的占位，
        // 而 renderShelfStage 以前没有覆盖它 —— 于是第一次打开之后，
        // 顶栏那句占位文字会一直留在那里，直到你点开一本书再退回来才变。
        setHeader('世界这本书', '滚轮或 ←/→ 选省份，点开当前的书进入城市章节。',
            [{ label: '世界这本书' }]);
        els.body.innerHTML =
            '<div class="ms-scene">' +
              // 信息板必须始终占着第一个格子：哪怕没有数据也要留一个空壳，
              // 否则舞台会掉进第一列（372px），版面直接被拉歪
              (infoHtml(book) || '<aside class="ms-info" id="msInfo"></aside>') +
              '<section class="ms-stage" id="msStage" tabindex="0" role="group" ' +
                'aria-label="书架：滚轮或左右方向键切换省份，点击当前的书翻开">' +
                '<div class="ms-floor" aria-hidden="true"></div>' +
                // 舞台右缘那颗浮动「›」已撤掉：它和顶栏那对 ‹ › 几乎在同一列、
                // 显隐条件也一样，看着就是同一对按钮被拆成两处（用户反馈"冲突"）。
                // 翻屏统一由顶栏那对负责，见 pageStep()。
                // 书架层底部原来写着「滚轮或 ←/→ 浏览书架，点一下当前的书翻开」，
                // 和顶栏副标题那句是同一件事，重复。按用户要求去掉可见文案。
                // 元素留成空壳：书本模式下它要被改成「拖动空白处转动整间屋子…」
                // （那句顶栏没有替代品，顶栏副标题在书本模式是收起的）。
                '<div class="ms-stage-hint"></div>' +
              '</section>' +
              '<div class="ms-building" id="msBuilding"><span>正在装订书架…</span></div>' +
            '</div>';
        els.stage = $('msStage');
        // 竖栏必须在 **stage 重建之后**再插进去：放在函数开头时 els.stage 还指向
        // 上一轮那个已被替换掉的节点，轨道插进去就跟着那个节点一起被丢掉了
        // （用户刷新后"看不到效果"就是这个原因）。
        renderLeftRail();

        // 建场（WebGL 初始化 + 十一本书的全部贴图）是几秒级的**同步**活儿，
        // 直接在这里跑会把「正在装订书架…」一起阻塞掉 —— 用户看到的只是一块空白。
        // 所以先用两帧把占位文字画出来，再开工，做完把占位淡掉。
        var build = function () {
            var ready = false;
            try {
                ready = initShelf();
            } catch (error) {
                console.warn('书架 WebGL 初始化失败：', error);
                ready = false;
            }
            if (!ready) {
                renderFallbackShelf();
                return;
            }
            var rig = shelf.rigs[state.active];
            if (rig) attachCoverPhoto(rig);
            bindStage();
            // 占位一直留到"书架 + 书本"真的画在画布上（见 whenShelfPainted）
            whenShelfPainted(function () {
                var building = $('msBuilding');
                if (!building) return;
                building.classList.add('is-done');
                setTimeout(function () {
                    if (building.parentNode) building.parentNode.removeChild(building);
                }, reduceMotion ? 0 : 260);
            });
        };
        if (reduceMotion) {
            build();
        } else {
            requestAnimationFrame(function () { requestAnimationFrame(build); });
        }
    }

    // ---------------- L1 书架：交互 ----------------


    // ---- 显式五态：状态切换都从这里走（顺带挂一个只读全局量便于排查）----
    var SHELF_PHASES = ['shelf', 'opening', 'inspection', 'reading', 'closing'];
    function setPhase(next) {
        if (SHELF_PHASES.indexOf(next) < 0 || state.phase === next) return;
        state.phase = next;
        try { window.__footprintPhase = next; } catch (e) { /* 忽略 */ }
    }
    function setActive(index) {
        if (state.opening) return;
        // ③ 只在书架态可用。阅读态点左缘的省名会把**底下那本**悄悄换掉：实测
        // 摊开的是"山东"、点一下"浙江"，书一个字没变、bookMode 还是 true，但底层
        // 已切到浙江 —— 按 Esc 回书架，看到的书和你刚才翻开的那本对不上。
        // （方向键那条路是安全的：keydown 里 state.mode === 'book' 的分支会先返回，
        // 把左右键让给翻页；舞台滚轮在书本模式下也只缩放。）
        // ⚠️ 判据用 state.mode 而不是 state.phase：exitBookMode() 和 close() 都会
        // 复位 mode，而 close() **不复位 phase** —— 阅读中途关掉覆盖层再打开，
        // phase 可能还停在 reading，用 phase 做守卫会把正常的书架点击一起挡掉。
        if (state.mode !== 'shelf') return;
        var total = state.books.length;
        if (!total) return;
        var next = ((index % total) + total) % total;
        var changed = next !== state.active;
        // ⑤ 方向感：把"这次是往书脊轨的哪一头走"写进 --ms-dir（1 = 往下，-1 = 往上），
        // 进场/退场的竖直位移按它取正负 —— 动作本身就能"说出"你在往哪翻，
        // 而不是不管上翻下翻都从左边滑进来、一律往上退。索引顺序就是书脊轨的
        // 上下顺序，所以比较索引即可（10 → 0 这种回绕也会正确读成"往上走"）。
        if (changed && els.root) {
            els.root.style.setProperty('--ms-dir', next > state.active ? '1' : '-1');
        }
        state.active = next;
        if (changed) playCue('navigate');
        state.bookRotation = null;
        // 这里必须是「非即时」：点了右侧某一本，它要转着滑到中间去，而不是瞬移
        layoutShelf(false);
        syncLeftRail();
        // 整间屋子跟着换色（墙、地、木架、灯、雾 + 信息板的强调色）
        if (changed) applyRoomTheme(next);
        if (changed) updateInfo();
        if (shelf && shelf.rigs[next]) {
            attachCoverPhoto(shelf.rigs[next]);
        } else if (!shelf && state.level === 'shelf') {
            renderFallbackShelf();      // CSS 回退模式没有 WebGL 状态，直接重排卡片
        }
    }

    function openActiveBook() {
        var book = state.books[state.active];
        if (!book || state.opening) return;
        state.opening = true;
        setPhase('opening');
        playCue('select');
        // 这一秒是"把书抽出来 + 封面掀开"的过程，里面那两页（省份信息 / 城市列表）
        // 现在就贴好，动画里就能看到内容，而不是两张白纸
        prepareBookPages(book);
        // 左侧信息板**立刻**开始缩回，不等那一秒的"抽出来"动画跑完。
        // 这个类原来是在 loadBookPages 里加的（也就是动画结束时），于是信息板
        // 要等书完全摊开才开始让位。提前到这里，点下去就和抽书同时收。
        if (els.root) els.root.classList.add('book-mode');
        // 同样交给补间：先把书抬到中间、镜头推近、封面翻开，再切章节页
        layoutShelf(false);
        setTimer('open', function () {
            state.opening = false;
            if (!els.root || !els.root.classList.contains('show')) return;
            openChapters(book);
        }, reduceMotion ? 0 : OPEN_ANIM_MS);
    }

    // 已翻开的书上点一下：命中右页某一行 → 进相册。
    // 这里**不再**把「点左页」当成返回上一级：翻页本来就是拖拽/方向键，
    // 手一抖点在左边那叠纸上就会被弹回城市章节，还会顺带闪一下书架。
    // 返回改由顶栏那个「‹ 返回城市章节」按钮和 Esc 负责。
    function onBookClick(event) {
        // 封面不接受点击开合：翻书只用拖拽（用户明确要求去掉点击效果）。
        // 合着的时候点在书上什么都不做，避免误触把书打开。
        if (state.bookOpen < 0.85) return;
        var hit = pickRowHit(event);
        if (hit) {
            // 用命中的那一页去找城市（可能是左页的城市章节，也可能是右页的目录）。
            // 目录行自带 city + spread（足迹点行能直接跳到相册里对应的那一跨），
            // 城市章节页的行没有这两个字段，就按行号回到它的城市分片。
            var row = hit.spec.rows && hit.spec.rows[hit.index];
            var city = (row && row.city) || (hit.spec.cities && hit.spec.cities[hit.index]);
            // 城市内容已经排在同一本书里，所以这里是**翻页过去**，不是换一套页集
            // （用户要的：不刷新、页码不重置）。row.pageIndex 是那一页在本书里的下标。
            if (row && row.pageIndex !== undefined) { turnToPage(row.pageIndex); return; }
            if (city) openAlbum(state.province, city, row && row.spread);
            return;
        }
    }

    // 拖拽起点落在左页还是右页：决定这次翻页是往前还是往回
    // 指针是不是落在书本本体上（含封面、书脊、书页块）：只有落在书本之外
    // 才允许用拖拽移动整本书，否则「拖了但没有页可翻」会莫名其妙把书拖走。
    function bookHitTest(event) {
        if (!book || !shelf) return false;
        var rect = els.stage.getBoundingClientRect();
        var pointer = new shelf.THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        shelf.raycaster.setFromCamera(pointer, shelf.camera);
        return shelf.raycaster.intersectObject(book.group, true).length > 0;
    }

    function bookPageSide(event) {
        if (!book || !shelf) return '';
        var rect = els.stage.getBoundingClientRect();
        var pointer = new shelf.THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        shelf.raycaster.setFromCamera(pointer, shelf.camera);
        var meshes = [];
        book.leaves.forEach(function (leaf) { meshes.push(leaf.front.mesh, leaf.back.mesh); });
        if (book.insideMesh) meshes.push(book.insideMesh);
        var hits = shelf.raycaster.intersectObjects(meshes, false);
        if (!hits.length) return '';
        // 掀开的封面（内侧扉页）算左页，拖它就是把封面合回去
        if (book.insideMesh && hits[0].object === book.insideMesh) return 'left';
        var hit = book.leaves.find(function (leaf) {
            return leaf.front.mesh === hits[0].object || leaf.back.mesh === hits[0].object;
        });
        if (!hit) return '';
        // 这片叶翻到什么程度，决定它现在算左页还是右页
        return hit.pivot.rotation.y > -1.2 ? 'right' : 'left';
    }

    function bindStage() {
        var stage = els.stage;
        if (!stage) return;

        var pointerId = null;
        var startX = 0;
        var moved = false;
        var mode = null;              // pending(可能旋转) | book(旋转中) | shelf(拖动书架)
        var holdTimer = 0;
        var rotationDistance = 150;

        function clearHold() {
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
        }

        function beginRotation() {
            // 长按旋转当前这本：保留
            if (pointerId === null || mode !== 'pending') return;
            clearHold();
            mode = 'book';
            moved = true;
            state.bookRotation = 0;
            try { stage.setPointerCapture(pointerId); } catch (e) { /* 忽略 */ }
            stage.classList.add('rotating');
            // 走时间线：从「微侧身」转到正对读者是一段过渡，不是瞬移
            layoutShelf(false);
        }

        function finish(event) {
            if (state.mode === 'book') {
                // 松手/取消：光标从「抓取」回到「五指张开」
                stage.classList.remove('page-dragging');
                if (state.orbit) {
                    state.orbit = null;
                    try {
                        if (event && stage.hasPointerCapture(event.pointerId)) {
                            stage.releasePointerCapture(event.pointerId);
                        }
                    } catch (e) { /* 忽略 */ }
                    return;
                }
                if (state.coverDrag) {
                    var cover = state.coverDrag;
                    state.coverDrag = null;
                    try {
                        if (event && stage.hasPointerCapture(event.pointerId)) {
                            stage.releasePointerCapture(event.pointerId);
                        }
                    } catch (e) { /* 忽略 */ }
                    // 拖过一半就定在那一侧；几乎没动就当成点击，切换开合
                    // 拖过一半就定在那一侧；**没怎么动就保持原样**。
                    // 之前这里把「没拖动」当成点击来切换开合，于是封面一被点
                    // 就自动开/关，而且合上之后左边那块空位置还能点出封面来。
                    state.openTarget = cover.moved ? (cover.p > 0.5 ? 1 : 0) : state.openTarget;
                    state.suppressClickUntil = performance.now() + 260;
                    return;
                }
                var drag = state.bookDrag;
                if (!drag) return;
                state.bookDrag = null;
                try {
                    if (stage.hasPointerCapture(event && event.pointerId)) {
                        stage.releasePointerCapture(event.pointerId);
                    }
                } catch (e) { /* 忽略 */ }
                if (drag.turning || state.pageTurn) {
                    var turn = state.pageTurn;
                    // 照 complete-shelf：看**拖到过的最远处**（peak），拖过 0.18 就翻过去。
                    // 只看松手那一刻的 p 的话，「拖出去又收回来」会被判成没翻，
                    // 手感上就是「我明明拖了它却弹回来」。
                    settlePageTurn(!!turn && (drag.peak || 0) >= 0.18);
                }
                // 只有真的拖动了才吃掉随后的 click；单纯点一下要留给「点城市行进相册」
                if (drag.moved) state.suppressClickUntil = performance.now() + 260;
                return;
            }
            clearHold();
            if (pointerId === null || (event && event.pointerId !== pointerId)) return;
            try {
                if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
            } catch (e) { /* 忽略 */ }

            if (mode === 'book') {
                state.suppressClickUntil = performance.now() + 220;
                state.bookRotation = null;
                pointerId = null;
                mode = null;
                stage.classList.remove('rotating');
                layoutShelf(true);
                return;
            }
            if (mode === 'pending') { pointerId = null; mode = null; return; }

            // 书架上的拖动**不再切换书**（用户要求去掉）。这里只保留
            // 「拖动过就不触发点击」这一条，避免误点。
            if (moved) state.suppressClickUntil = performance.now() + 180;
            pointerId = null;
            mode = null;
            stage.classList.remove('dragging');
            layoutShelf(false);
        }

        stage.addEventListener('pointerdown', function (event) {
            if (event.button !== undefined && event.button !== 0) return;
            // 舞台里的 DOM 按钮（复位视角）必须在这里放行：
            // 下面几条分支都会 setPointerCapture，而指针被舞台捕获之后，
            // 随后的 click 会派发给捕获者（舞台）而不是按钮 —— 按钮的
            // click 监听永远收不到事件。放行等于让浏览器按常规派发 click。
            if (event.target && event.target.closest && event.target.closest('.ms-view-reset')) return;
            if (state.mode === 'book') {
                if (!bookHitTest(event)) {
                    // 只有书本之外才允许移动整本书：绕它旋转（按住 Shift 改成平移）
                    state.orbit = {
                        startX: event.clientX, startY: event.clientY,
                        yaw: state.view.yaw, pitch: state.view.pitch,
                        panX: state.view.panX, panY: state.view.panY,
                        pan: !!event.shiftKey
                    };
                    try { stage.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
                    return;
                }
                var side = bookPageSide(event);
                var closed = state.bookOpen < 0.5;
                // 合着时拖封面 = 掀开；翻开后停在第 0 跨页时拖内侧封面 = 合回去
                if (closed || (side === 'left' && state.bookSpread === 0 && !state.pageTurn)) {
                    state.coverDrag = { startX: event.clientX, p: state.bookOpen, moved: false };
                    playCue('select');
                    stage.classList.add('page-dragging');
                    try { stage.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
                    return;
                }
                // 上一次翻页还没落完位（松手后的自动落页 / 点一下之后的弹回）：
                // 立刻把它收尾，别让它挡住这一次新的拖拽。
                // 不加这一步，连点两下想快速翻页时第二次按下去会被「已经有一页在翻」
                // 挡掉 —— 手感就是「点完书页之后马上拖，拖不动」。
                settleTurnNow();
                if (state.bookOpen < 0.85) return;
                if (!side) {
                    // 落在书本上但不在任何一页上（书脊、书页块、封面外沿）：
                    // 记一次「什么都不做」的拖拽，既不动书也不翻页，只用来吃掉随后的 click
                    state.bookDrag = {
                        startX: event.clientX, startY: event.clientY,
                        forward: false, moved: false, turning: false
                    };
                    return;
                }
                // 无论这次能不能翻（比如这本只有一跨页），都要先把拖拽记下来：
                // 否则 pointerup 会因为拿不到 bookDrag 而提前返回，后面的 click
                // 就没被抑制，一次拖拽会被当成「点了右页的城市行」直接进相册。
                state.bookDrag = {
                    startX: event.clientX,
                    startY: event.clientY,
                    // 方向**不在这里定**：照参考实现，往左拖 = 往后翻、往右拖 = 往前翻（把左边
                    // 那页拉回来），跟手按在哪一页无关。等到第一次真的移动了，再按位移的
                    // 符号起翻页 —— 这样在右页往右拖也能把左页翻回来（双向）。
                    forward: null,
                    moved: false,
                    peak: 0,
                    turning: false
                };
                stage.classList.add('page-dragging');
                try { stage.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
                return;
            }
            if (state.opening) return;
            // 用显式 phase 收口边界：正在抽出/合书时不接受新的点选，
            // 免得快速连点把"选中哪一本"和动画搅在一起（待办 6 收尾的收益点）
            if (state.phase === 'opening' || state.phase === 'closing') return;
            pointerId = event.pointerId;
            startX = event.clientX;
            moved = false;
            var pressedActive = pickBookIndex(event) === state.active;
            mode = pressedActive ? 'pending' : 'shelf';
            rotationDistance = 150;
            if (pressedActive) holdTimer = setTimeout(beginRotation, LONG_PRESS_MS);
        });

        stage.addEventListener('pointermove', function (event) {
            if (state.mode === 'book') {
                if (state.orbit) {
                    var o = state.orbit;
                    var rectO = stage.getBoundingClientRect();
                    var dxO = event.clientX - o.startX;
                    var dyO = event.clientY - o.startY;
                    if (o.pan) {
                        state.view.panX = o.panX + dxO / Math.max(1, rectO.width) * 3.2;
                        state.view.panY = o.panY - dyO / Math.max(1, rectO.height) * 2.2;
                    } else {
                        // 左右**不设限**（和 OrbitControls 一样可以一直转下去）
                        state.view.yaw = o.yaw + dxO * 0.006;
                        // 上下先按"能用"的范围存着，真正的下限在渲染帧里按
                        // 当前缩放距离精算（见 tick 里的 minPitch）
                        state.view.pitch = clamp(o.pitch + dyO * 0.004, -1.1, INSPECT_PITCH_MAX);
                    }
                    return;
                }
                if (state.coverDrag) {
                    var cd = state.coverDrag;
                    var dxC = event.clientX - cd.startX;
                    if (Math.abs(dxC) > 4) cd.moved = true;
                    // 合着时向左拖是掀开，翻开时向右拖是合上 —— 同一个公式都成立
                    // 一次约半屏的拖动才走完整个开合：之前是 0.22 屏，
                    // 拖一点点封面就翻到底，手感太急
                    var spanC = Math.max(280, stage.getBoundingClientRect().width * 0.5);
                    cd.p = clamp(cd.p - dxC / spanC, 0, 1);
                    return;
                }
                if (!state.bookDrag) {
                    // 悬停：书还合着时把鼠标压上去，封面裂开一线
                    state.coverHover = state.bookOpen < 0.5 && !!bookPageSide(event);
                    return;
                }
                var drag = state.bookDrag;
                if (!drag) return;
                var dxBook = event.clientX - drag.startX;
                var dyBook = event.clientY - drag.startY;
                if (Math.abs(dxBook) > 4) drag.moved = true;
                // 拖得越快纸拱得越高；纵向偏差变成纸的扭转
                var dt = Math.max(16, performance.now() - (drag.lastAt || performance.now()));
                var speed = Math.abs(dxBook - (drag.lastDx || 0)) / dt;
                drag.lastAt = performance.now();
                drag.lastDx = dxBook;
                // 第一次移动才定方向：位移向左 ⇒ 往后翻（forward）
                if (!drag.turning) {
                    if (Math.abs(dxBook) < 6) return;        // 太小的抖动先不算
                    drag.forward = dxBook < 0;
                    drag.turning = beginPageTurn(drag.forward);
                    if (!drag.turning) return;               // 那一头没有可翻的页
                }
                // 走完一整次翻页需要的指针行程。照 complete-shelf 取 ~150px：
                // 原来是舞台宽度的 34%（宽屏上 490px），手指/鼠标动了纸却几乎没动，
                // 读起来就是「拖拽有延迟」。
                var span = clamp(stage.getBoundingClientRect().width * 0.105, 130, 185);
                var progress = (drag.forward ? -dxBook : dxBook) / span;
                drag.peak = Math.max(drag.peak || 0, clamp(progress, 0, 1));
                dragPageTurn(progress, {
                    speedResponse: Math.min(1, speed / 5.5),
                    verticalBias: Math.max(-1, Math.min(1, dyBook / 160))
                });
                return;
            }
            // 没有按下时：只做悬停抬升
            if (pointerId === null) {
                if (shelf && !reduceMotion) shelf.hoverIndex = pickBookIndex(event);
                return;
            }
            if (event.pointerId !== pointerId) return;

            var totalDx = event.clientX - startX;
            if (mode === 'pending') {
                if (Math.abs(totalDx) > 6) beginRotation();
                else return;
            }
            if (mode === 'book') {
                event.preventDefault();
                state.bookRotation = Math.max(-ROTATE_LIMIT,
                    Math.min(ROTATE_LIMIT, totalDx / rotationDistance * ROTATE_LIMIT));
                state.suppressClickUntil = performance.now() + 220;
                // 跟手：角度直接写，不走插值（只把这段补间的起点一起改掉）
                applyActiveRotation();
                return;
            }

            // 书架上不跟手平移、也不按拖动切书（那条交互已经去掉），
            // 这里的拖动只用来判定「拖过 = 不是点击」，别把一次拖拽误读成点选。
            if (!moved && Math.abs(totalDx) > 7) {
                moved = true;
                try { stage.setPointerCapture(pointerId); } catch (e) { /* 忽略 */ }
                stage.classList.add('dragging');
            }
        });

        stage.addEventListener('pointerup', finish);
        stage.addEventListener('pointercancel', finish);
        stage.addEventListener('pointerleave', function (event) {
            if (shelf) shelf.hoverIndex = -1;
            if (pointerId !== null && !stage.hasPointerCapture(pointerId)) finish(event);
        });

        stage.addEventListener('wheel', function (event) {
            event.preventDefault();
            if (state.mode === 'book') {
                // 检视态：滚轮缩放（规格里的 zoom）
                state.view.zoom = clamp(state.view.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.6, 2.2);
                return;
            }
            var now = performance.now();
            if (now - state.wheelAt < 320) return;
            state.wheelAt = now;
            var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            setActive(state.active + (delta > 0 ? 1 : -1));
        }, { passive: false });

        stage.addEventListener('click', function (event) {
            if (performance.now() < state.suppressClickUntil) return;
            // （这里原来拦两个已经不存在的类：.ms-pager 和 .ms-book-nav —— 两者
            // 在 DOM 里都查不到了，拦空气。留一行注释说明去过哪儿。）
            if (state.mode === 'book') { onBookClick(event); return; }
            var index = pickBookIndex(event);
            if (index < 0) return;
            if (index !== state.active) { setActive(index); return; }
            openActiveBook();
        });
    }

    // ---------------- 回退：CSS 3D 书架 ----------------

    function renderFallbackShelf() {
        els.stage = null;
        var cards = state.books.map(function (book, index) {
            var colors = palette(index);
            return '<button class="ms-fbook' + (index === state.active ? ' active' : '') + '" type="button" ' +
                'data-ms-book="' + index + '" aria-label="' + esc(book.name) + '">' +
                '<span class="ms-fbook-body" style="--fb-cover:' + colors[0] + ';--fb-spine:' + colors[1] + '">' +
                  '<span class="ms-fbook-spine"></span>' +
                  '<span class="ms-fbook-face" style="--fb-ink:' + colors[2] + '">' +
                    '<b>' + esc(book.name) + '</b>' +
                    '<span class="ms-fbook-photo"' + bgStyle(book.cover) + '></span>' +
                    '<small>' + book.cityCount + ' 城 · ' + book.photoCount + ' 张</small>' +
                  '</span>' +
                '</span>' +
              '</button>';
        }).join('');

        els.body.innerHTML =
            '<div class="ms-scene">' +
              infoHtml(state.books[state.active]) +
              '<section class="ms-stage">' +
                '<div class="ms-fallback" id="msFallback">' + cards + '</div>' +
                // 同上：兜底书架也不在底部重复顶栏那句提示
                '<div class="ms-stage-hint"></div>' +
              '</section>' +
            '</div>';

        var wrap = $('msFallback');
        if (!wrap) return;
        wrap.querySelectorAll('[data-ms-book]').forEach(function (node) {
            node.addEventListener('click', function () {
                var index = Number(node.dataset.msBook);
                if (index !== state.active) { setActive(index); return; }
                openActiveBook();
            });
        });
        var active = wrap.querySelector('.ms-fbook.active');
        if (active && active.scrollIntoView) {
            active.scrollIntoView({ block: 'nearest', inline: 'center' });
        }
    }

    // ---------------- L2 城市章节 ----------------

    function openChapters(book) {
        if (!book) return;
        // 书页摊开 —— 参考在这里播 "open"（reading 开启）
        playCue('open');
        state.province = book;
        state.bookLevel = 'chapters';
        // 有 WebGL 就翻开成三维书本；没有才退回 DOM 的纸张跨页
        if (shelf && window.THREE) {
            // 用 preparedPageSpecs：翻开动画前已经画好过这叠页，交回同一个数组，
            // loadBookPages 就不会清缓存重画（见 prepareBookPages 的说明）
            loadBookPages(preparedPageSpecs(book), 0,
                book.name + ' · 城市章节', '点右页的城市条目，翻开它的旅行相册。',
                [{ label: '世界这本书', to: 'shelf' }, { label: book.name }]);
            return;
        }
        openChaptersDom(book);
    }

    function openChaptersDom(book) {
        if (!book) return;
        disposeShelf();                 // 离开书架就释放 WebGL，后面的章节/相册是纯 DOM
        state.level = 'chapters';
        state.province = book;
        state.city = null;
        state.photos = [];
        state.page = 0;
        setHeader(book.name + ' · 城市章节', '选择一座到达过的城市，翻开它的旅行相册。',
            [{ label: '世界这本书', to: 'shelf' }, { label: book.name }]);

        var entries = book.cities.map(function (city, index) {
            return '<button class="ms-chapter-entry" type="button" data-ms-city="' + index + '">' +
                '<span class="ms-chapter-no">' + String(index + 1).padStart(2, '0') + '</span>' +
                '<span><b>' + esc(city.name) + '</b>' +
                '<small>' + esc(city.latestTime ? formatMonth(city.latestTime) : '时间未记录') + '</small></span>' +
                '<span class="ms-chapter-photos">' + city.photoCount + ' 张</span>' +
              '</button>';
        }).join('');

        els.body.innerHTML =
            '<div class="ms-view">' +
              '<div class="ms-tools">' +
                // 这里原来挂着「‹ 返回书架」。返回统一收给顶栏面包屑（见 setHeader）：
                // 同一件事只在一个地方出现。两侧各留一个等宽占位，标题才是真居中。
                '<span class="ms-tools-spacer" aria-hidden="true"></span>' +
                '<div class="ms-title"><span>城市章节</span><h3>' + esc(book.name) + '旅行记忆</h3></div>' +
                '<span class="ms-tools-spacer" aria-hidden="true"></span>' +
              '</div>' +
              '<div class="ms-spread">' +
                '<section class="ms-page left">' +
                  '<div class="ms-chapter-cover" id="msChapterCover"' + bgStyle(book.cover) + '></div>' +
                  '<p class="ms-chapter-label">省份旅行记忆</p>' +
                  '<h4 class="ms-chapter-name">' + esc(book.name) + '</h4>' +
                  '<p class="ms-chapter-cities">' + esc(book.cities.map(function (city) {
                      return city.name;
                  }).join(' · ')) + '</p>' +
                  '<div class="ms-chapter-totals">' +
                    '<span><b>' + book.cityCount + '</b>城市章节</span>' +
                    '<span><b>' + book.photoCount + '</b>旅行照片</span>' +
                  '</div>' +
                '</section>' +
                '<section class="ms-page right">' +
                  '<div class="ms-chapter-list">' + entries + '</div>' +
                '</section>' +
              '</div>' +
            '</div>';

        // 顶栏那对「上一本 / 下一本」只属于书架层：留在章节页里既没用又会误导
        if (els.prev) els.prev.hidden = true;
        if (els.next) els.next.hidden = true;

        els.body.querySelectorAll('[data-ms-city]').forEach(function (node) {
            var city = book.cities[Number(node.dataset.msCity)];
            if (!city) return;
            // 悬停 / 键盘聚焦时，左页封面实时换成这座城市的封面
            function preview() {
                var cover = $('msChapterCover');
                if (!cover || !city.cover) return;
                cover.style.backgroundImage = 'url(' + JSON.stringify(String(city.cover)) + ')';
            }
            node.addEventListener('mouseenter', preview);
            node.addEventListener('focus', preview);
            node.addEventListener('click', function () { openAlbum(book, city); });
        });

        var first = els.body.querySelector('[data-ms-city]');
        if (first) first.focus({ preventScroll: true });
    }

    function backToShelf() {
        if (state.mode === 'book') {
            // 先播合书动画（exitBookMode 由动画结束时调用），再回到书架
            if (state.closing) return;
            beginClose(function () {
                setHeader('世界这本书', '滚轮或 ←/→ 选省份，点开当前的书进入城市章节。',
                    [{ label: '世界这本书' }]);
                // 合书之后把焦点从舞台上挪走：舞台是点击打开书时获得焦点的，
                // 而之后按的是 Esc（键盘），Chrome 会把 :focus-visible 判为匹配，
                // 于是舞台四周出现一圈 2px 的强调色描边（#9b704e）—— 就是那圈褐色。
                if (els.back && els.back.focus) els.back.focus({ preventScroll: true });
            });
            return;
        }
        disposeShelf();
        state.level = 'shelf';
        state.province = null;
        state.city = null;
        state.photos = [];
        state.page = 0;
        state.bookRotation = null;
        setHeader('世界这本书', '滚轮或 ←/→ 选省份，点开当前的书进入城市章节。',
            [{ label: '世界这本书' }]);
        renderShelfStage();
        // 焦点交给「关闭」按钮，**不要落在舞台上**：
        // #msStage 带 tabindex，:focus-visible 会给它画一圈 2px 强调色描边
        // （#9b704e，正是那圈"褐色"）。之前这里 focus 的是舞台，于是每次
        // 用 Esc 合上书都会出现那圈边，点别处焦点移开才消失。
        if (els.back && els.back.focus) els.back.focus({ preventScroll: true });
    }

    // ---------------- L3 旅行相册 ----------------

    function collectPhotos(city) {
        var d = api();
        if (!d || !city || !city.items) return [];
        var photos = [];
        // city.items 已按 createTime 倒序，拼出来的顺序就是「最新在前」
        city.items.forEach(function (fp) {
            d.cityWallImages(fp).forEach(function (image) {
                var url = image && image.url;
                if (!url) return;
                // 带上这张照片自己的时间：相册页的图注要写「城市 · 年月」，
                // 扉页/尾页的「记录于 A – B」也从这里算
                photos.push({
                    url: url,
                    thumb: d.cityCardImageUrl(url) || url,
                    time: fp && fp.createTime ? String(fp.createTime) : ''
                });
            });
        });
        return photos;
    }

    function albumSpreads() {
        var per = ALBUM_PER_PAGE * 2;
        return Math.max(1, Math.ceil(state.photos.length / per));
    }

    function albumSlots(slice, offset) {
        var html = '';
        for (var i = 0; i < ALBUM_PER_PAGE; i++) {
            var photo = slice[i];
            if (!photo) {
                html += '<span class="ms-album-slot is-empty" aria-hidden="true"></span>';
                continue;
            }
            html += '<button class="ms-album-slot" type="button" data-ms-photo="' + (offset + i) + '" ' +
                'aria-label="放大第 ' + (offset + i + 1) + ' 张照片">' +
                '<img src="' + esc(photo.thumb) + '" alt="" loading="lazy" decoding="async">' +
              '</button>';
        }
        return html;
    }

    function renderAlbumSpread() {
        var stage = $('msAlbumStage');
        var city = state.city;
        if (!stage || !city) return;
        var per = ALBUM_PER_PAGE * 2;
        var spreads = albumSpreads();
        state.page = Math.max(0, Math.min(state.page, spreads - 1));
        var offset = state.page * per;
        var slice = state.photos.slice(offset, offset + per);
        var total = state.photos.length;

        if (!total) {
            stage.innerHTML = '<section class="ms-album-page left"><div class="ms-album-head">' +
                '<strong>' + esc(city.name) + '</strong><span>旅行照片册</span></div>' +
                '<div class="ms-album-grid"><span class="ms-album-slot is-empty"></span>' +
                '<span class="ms-album-slot is-empty"></span></div>' +
                '<div class="ms-album-foot"><span>这座城市还没有照片</span><span>00</span></div></section>' +
                '<section class="ms-album-page right"><div class="ms-album-head">' +
                '<strong>' + esc(city.name) + '</strong><span>旅行照片册</span></div>' +
                '<div class="ms-album-grid"><span class="ms-album-slot is-empty"></span>' +
                '<span class="ms-album-slot is-empty"></span></div>' +
                '<div class="ms-album-foot"><span>在足迹里补几张照片吧</span><span>00</span></div></section>';
            syncAlbumPager(1);
            return;
        }

        stage.innerHTML =
            '<section class="ms-album-page left">' +
              '<div class="ms-album-head"><strong>' + esc(city.name) + '</strong>' +
                '<span>' + esc(city.latestTime ? formatMonth(city.latestTime) : '时间未记录') + '</span></div>' +
              '<div class="ms-album-grid">' + albumSlots(slice.slice(0, ALBUM_PER_PAGE), offset) + '</div>' +
              '<div class="ms-album-foot"><span>旅行照片册</span>' +
                '<span>' + String(state.page * 2 + 1).padStart(2, '0') + '</span></div>' +
            '</section>' +
            '<section class="ms-album-page right">' +
              '<div class="ms-album-head"><span>共 ' + total + ' 张</span>' +
                '<strong>' + esc(city.name) + '</strong></div>' +
              '<div class="ms-album-grid">' +
                albumSlots(slice.slice(ALBUM_PER_PAGE, per), offset + ALBUM_PER_PAGE) + '</div>' +
              '<div class="ms-album-foot"><span>' + (state.page + 1) + ' / ' + spreads + '</span>' +
                '<span>' + String(state.page * 2 + 2).padStart(2, '0') + '</span></div>' +
            '</section>';

        bindAlbumSlots(stage);
        syncAlbumPager(spreads);
    }

    // 左右翻页按钮的可用状态：首页禁用「上一页」，末页禁用「下一页」
    function syncAlbumPager(spreads) {
        var prev = $('msAlbumPrev');
        var next = $('msAlbumNext');
        if (prev) prev.disabled = state.page <= 0;
        if (next) next.disabled = state.page >= spreads - 1;
    }

    function bindAlbumSlots(stage) {
        stage.querySelectorAll('[data-ms-photo]').forEach(function (slot) {
            var img = slot.querySelector('img');
            var dragging = false;
            var moved = false;
            var startX = 0;
            var startY = 0;
            var originX = 50;
            var originY = 50;

            // 按住拖动 = 调整构图（只改 object-position，不落库）
            slot.addEventListener('pointerdown', function (event) {
                if (event.button !== undefined && event.button !== 0) return;
                dragging = true;
                moved = false;
                startX = event.clientX;
                startY = event.clientY;
                originX = parseFloat(slot.dataset.ox || '50');
                originY = parseFloat(slot.dataset.oy || '50');
                try { slot.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
            });

            slot.addEventListener('pointermove', function (event) {
                if (!dragging || !img) return;
                var dx = event.clientX - startX;
                var dy = event.clientY - startY;
                if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
                if (!moved) return;
                var nx = Math.max(0, Math.min(100, originX - dx / slot.clientWidth * 100));
                var ny = Math.max(0, Math.min(100, originY - dy / slot.clientHeight * 100));
                slot.dataset.ox = String(nx);
                slot.dataset.oy = String(ny);
                img.style.objectPosition = nx + '% ' + ny + '%';
            });

            function stop(event) {
                if (!dragging) return;
                dragging = false;
                try {
                    if (slot.hasPointerCapture(event.pointerId)) slot.releasePointerCapture(event.pointerId);
                } catch (e) { /* 忽略 */ }
                if (moved) slot.dataset.moved = '1';
            }
            slot.addEventListener('pointerup', stop);
            slot.addEventListener('pointercancel', stop);

            slot.addEventListener('click', function () {
                if (slot.dataset.moved === '1') { slot.dataset.moved = ''; return; }
                showPhoto(Number(slot.dataset.msPhoto));
            });
        });
    }

    // spread：从目录的"足迹点行"进来时可以直接落到相册第几跨（默认第 0 跨）
    function openAlbum(book, city, spread) {
        if (!book || !city) return;
        state.province = book;
        state.city = city;
        state.bookLevel = 'album';
        if (shelf && window.THREE) {
            state.photoList = collectPhotos(city);
            if (state.photoList.length) {
                loadBookPages(albumPageSpecs(book, city), spread || 0,
                    city.name + ' · 旅行相册',
                    // 顶栏那颗「返回城市章节」已收掉，返回入口现在是面包屑里的省名
                    '左右翻页看照片；点标题里的「' + book.name + '」可以回到城市章节。',
                    [{ label: '世界这本书', to: 'shelf' },
                     { label: book.name, to: 'chapters' }, { label: city.name }]);
                return;
            }
        }
        openAlbumDom(book, city);
    }

    function openAlbumDom(book, city) {
        state.level = 'album';
        state.province = book;
        state.city = city;
        state.page = 0;
        state.turning = false;
        state.photos = collectPhotos(city);
        setHeader(city.name + ' · 旅行相册', '单击照片原地放大；按住照片拖动可以调整构图。',
            [{ label: '世界这本书', to: 'shelf' },
             { label: book.name, to: 'chapters' }, { label: city.name }]);

        els.body.innerHTML =
            '<div class="ms-view">' +
              '<div class="ms-tools">' +
                // 同上：返回交给顶栏面包屑（点路径里的「省名」回城市章节）
                '<span class="ms-tools-spacer" aria-hidden="true"></span>' +
                '<div class="ms-title"><span>旅行照片册</span><h3>' + esc(city.name) + '</h3></div>' +
                '<span class="ms-tools-spacer" aria-hidden="true"></span>' +
              '</div>' +
              '<div class="ms-album-frame">' +
                '<button class="ms-album-side prev" id="msAlbumPrev" type="button" aria-label="上一页">‹</button>' +
                '<div class="ms-album-stage" id="msAlbumStage" tabindex="-1"></div>' +
                '<button class="ms-album-side next" id="msAlbumNext" type="button" aria-label="下一页">›</button>' +
              '</div>' +
              '<div class="ms-photo-view" id="msPhotoView" role="dialog" aria-modal="true" aria-label="照片预览">' +
                '<img id="msPhotoImage" alt="">' +
                '<div class="ms-photo-view-bar">' +
                  '<button id="msPhotoPrev" type="button" aria-label="上一张">‹</button>' +
                  '<span id="msPhotoCounter"></span>' +
                  '<button id="msPhotoNext" type="button" aria-label="下一张">›</button>' +
                '</div>' +
              '</div>' +
            '</div>';

        var albumPrev = $('msAlbumPrev');
        var albumNext = $('msAlbumNext');
        if (albumPrev) albumPrev.addEventListener('click', function () { turnAlbum(-1); });
        if (albumNext) albumNext.addEventListener('click', function () { turnAlbum(1); });
        var photoView = $('msPhotoView');
        if (photoView) {
            // 点四周空白收起放大图（点图片本身、点底部按钮条都不关）
            photoView.addEventListener('click', function (event) {
                if (event.target === photoView) hidePhoto();
            });
        }
        var prev = $('msPhotoPrev');
        var next = $('msPhotoNext');
        if (prev) prev.addEventListener('click', function () { stepPhoto(-1); });
        if (next) next.addEventListener('click', function () { stepPhoto(1); });

        renderAlbumSpread();

        var stage = $('msAlbumStage');
        if (stage) {
            stage.addEventListener('wheel', function (event) {
                event.preventDefault();
                var now = performance.now();
                if (now - state.wheelAt < 300) return;
                state.wheelAt = now;
                turnAlbum(event.deltaY > 0 ? 1 : -1);
            }, { passive: false });
        }

        // 焦点落点从"页内返回按钮"（已移除）挪到相册舞台：给键盘用户一个起点。
        // 左右方向键翻页挂在 document 级 keydown 上，焦点在哪都生效。
        var albumStage = $('msAlbumStage');
        if (albumStage) albumStage.focus({ preventScroll: true });
    }

    function backToChapters() {
        hidePhoto();
        if (state.mode === 'book') {
            if (state.province) openChapters(state.province);
            return;
        }
        if (state.province) openChapters(state.province);
    }

    // 翻页：同一张纸旋转出去、下一张纸转进来，两边同时跑一条缓动时间线
    function turnAlbum(step) {
        var spreads = albumSpreads();
        var next = Math.max(0, Math.min(spreads - 1, state.page + step));
        if (next === state.page || state.turning) return;
        if (!state.photos.length) return;

        var stage = $('msAlbumStage');
        if (!stage || reduceMotion) {
            state.page = next;
            renderAlbumSpread();
            return;
        }

        var forward = step > 0;
        var outgoing = stage.querySelector(forward ? '.ms-album-page.right' : '.ms-album-page.left');
        var incoming = stage.querySelector(forward ? '.ms-album-page.left' : '.ms-album-page.right');
        if (!outgoing || !incoming) {
            state.page = next;
            renderAlbumSpread();
            return;
        }

        state.turning = true;
        stage.classList.add('turning');
        outgoing.classList.add('ms-page-turner', forward ? 'front-forward' : 'front-backward');
        incoming.classList.add('ms-page-turner', forward ? 'back-forward' : 'back-backward');

        setTimer('album', function () {
            state.page = next;
            state.turning = false;
            renderAlbumSpread();
            var el = $('msAlbumStage');
            if (el) el.classList.remove('turning');
        }, 620);
    }

    // ---------------- 照片原地放大 ----------------

    function showPhoto(index) {
        if (!state.photos.length) return;
        state.photoIndex = Math.max(0, Math.min(state.photos.length - 1, index));
        var view = $('msPhotoView');
        if (!view) return;
        view.classList.add('show');
        // 让相册先翻到这张照片所在的跨页，退出放大后落点一致
        var target = Math.floor(state.photoIndex / (ALBUM_PER_PAGE * 2));
        if (target !== state.page) {
            state.page = target;
            renderAlbumSpread();
        }
        renderPhotoView();
    }

    function renderPhotoView() {
        var photo = state.photos[state.photoIndex];
        if (!photo) return;
        var image = $('msPhotoImage');
        if (image) {
            var d = api();
            image.src = (d && d.canvasSafeImageUrl(photo.url)) || photo.url;
            image.alt = state.city ? (state.city.name + ' 旅行照片') : '旅行照片';
        }
        var counter = $('msPhotoCounter');
        if (counter) counter.textContent = (state.photoIndex + 1) + ' / ' + state.photos.length;
        var prev = $('msPhotoPrev');
        var next = $('msPhotoNext');
        if (prev) prev.disabled = state.photoIndex <= 0;
        if (next) next.disabled = state.photoIndex >= state.photos.length - 1;
    }

    function stepPhoto(delta) {
        var view = $('msPhotoView');
        if (!view || !view.classList.contains('show')) return;
        var next = Math.max(0, Math.min(state.photos.length - 1, state.photoIndex + delta));
        if (next === state.photoIndex) return;
        state.photoIndex = next;
        renderPhotoView();
    }

    function hidePhoto() {
        var view = $('msPhotoView');
        if (view) view.classList.remove('show');
    }

    function photoOpen() {
        var view = $('msPhotoView');
        return !!(view && view.classList.contains('show'));
    }

    // ---------------- 开关与键盘 ----------------

    // ==========================================================================
    // 声音（照参考实现的音效系统，但**不引入任何音频资产**：全部用 WebAudio 现场合成）
    // --------------------------------------------------------------------------
    // 参考实现把环境曲与 5 个音效烘成 MP3 内嵌；我们没有音频资产，所以改成合成：
    //   cloth 布面摩擦 / wood 木架轻磕 / hinge 铰链吱声 / page 翻页 / close 合书闷响
    // 行为照参考：首次用户手势后才解锁、静音与音量写进 localStorage、
    // 标签页隐藏时挂起、同时发声数封顶，避免连点把声音叠成噪音。
    // ==========================================================================
    var audio = {
        ctx: null, master: null, unlocked: false, muted: false, volume: 0.55,
        voices: 0, nodes: [], maxVoices: 4
    };
    var AUDIO_KEY = 'footprint-shelf-audio';

    function audioLoadPrefs() {
        try {
            var raw = window.localStorage.getItem(AUDIO_KEY);
            if (!raw) return;
            var saved = JSON.parse(raw);
            if (typeof saved.muted === 'boolean') audio.muted = saved.muted;
            if (typeof saved.volume === 'number') {
                audio.volume = Math.max(0, Math.min(1, saved.volume));
            }
        } catch (e) { /* 隐私模式等拿不到 localStorage，忽略 */ }
    }

    function audioSavePrefs() {
        try {
            window.localStorage.setItem(AUDIO_KEY,
                JSON.stringify({ muted: audio.muted, volume: audio.volume }));
        } catch (e) { /* 忽略 */ }
    }


    // 合成一段声音：type = 噪声/正弦，滤波 + 包络
    function audioBurst(options) {
        if (!audio.ctx || audio.muted || audio.voices >= audio.maxVoices) return;
        var ctx = audio.ctx;
        var now = ctx.currentTime;
        var dur = options.duration || 0.24;
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(
            Math.max(0.0002, options.level || 0.2), now + (options.attack || 0.01));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        var filter = ctx.createBiquadFilter();
        filter.type = options.filterType || 'bandpass';
        filter.frequency.setValueAtTime(options.freq || 900, now);
        if (options.freqTo) {
            filter.frequency.exponentialRampToValueAtTime(options.freqTo, now + dur);
        }
        filter.Q.value = options.q || 1.1;

        var src = null;
        if (options.noise) {
            var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
            var buf = ctx.createBuffer(1, len, ctx.sampleRate);
            var ch = buf.getChannelData(0);
            for (var i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
            src = ctx.createBufferSource();
            src.buffer = buf;
        } else {
            src = ctx.createOscillator();
            src.type = options.wave || 'sine';
            src.frequency.setValueAtTime(options.tone || 220, now);
            if (options.toneTo) src.frequency.exponentialRampToValueAtTime(options.toneTo, now + dur);
        }
        src.connect(filter);
        filter.connect(gain);
        gain.connect(audio.master);
        src.start(now);
        src.stop(now + dur + 0.02);
        audio.voices += 1;
        src.onended = function () {
            audio.voices = Math.max(0, audio.voices - 1);
            try { gain.disconnect(); filter.disconnect(); } catch (e) { /* 忽略 */ }
        };
    }

    // 五个音效的配方（都是短促的合成，不依赖资产）
    var AUDIO_CUES = {
        // 布面摩擦：高频噪声、很短
        cloth: { noise: true, freq: 2600, freqTo: 1400, q: 0.9, duration: 0.16, level: 0.10 },
        // 木架轻磕：低频方波一点，带木头的"咚"
        wood: { tone: 180, toneTo: 90, wave: 'triangle', duration: 0.18, level: 0.16, filterType: 'lowpass', freq: 700 },
        // 铰链：中频窄带扫过，像合页转动
        hinge: { noise: true, freq: 700, freqTo: 1500, q: 6, duration: 0.22, level: 0.07 },
        // 翻页：纸的沙沙声 + 一次轻微的"啪"
        page: { noise: true, freq: 1800, freqTo: 900, q: 1.2, duration: 0.26, level: 0.13 },
        // 合书：低闷响
        close: { tone: 110, toneTo: 60, wave: 'sine', duration: 0.34, level: 0.2, filterType: 'lowpass', freq: 420 }
    };

    // ---- 音效改成**播放音频文件**（static/audio/*.wav，随插件打包）----
    // 实时合成那版在用户的浏览器里一直没出声，所以照参考实现的思路改成文件播放。
    var AUDIO_FILES = {
        // 参考实现内嵌的音效（键名照它的代码：select / navigate / open / page / close），
        // 我们从它的 index.html 里解出成 mp3 放在 static/audio/ 下，随插件打包。
        // （环境曲 music 按用户要求去掉，只保留交互音效。）
        select: 'shelf-select.mp3',
        navigate: 'shelf-navigate.mp3',
        open: 'shelf-open.mp3',
        page: 'shelf-page.mp3',
        close: 'shelf-close.mp3'
    };
    var AUDIO_BASE = '/plugins/footprint/assets/static/audio/';
    var AUDIO_POOL = 3;              // 每个音效 3 份：够快速连点，又不会叠成噪音
    var audioPool = {};

    function audioUrl(file) { return AUDIO_BASE + file + '?version=' + version; }

    function ensureAudioPool() {
        if (audioPool.page) return;
        Object.keys(AUDIO_FILES).forEach(function (name) {
            var list = [];
            for (var i = 0; i < AUDIO_POOL; i++) {
                var el = new Audio(audioUrl(AUDIO_FILES[name]));
                el.preload = 'auto';
                el.volume = audio.muted ? 0 : audio.volume;
                list.push(el);
            }
            audioPool[name] = list;
        });
    }

    function applyAudioVolume() {
        Object.keys(audioPool).forEach(function (name) {
            audioPool[name].forEach(function (el) {
                el.volume = audio.muted ? 0 : audio.volume;
            });
        });
    }

    function playCue(name, options) {
        // 兜底解锁：cue 的调用点本身就在事件处理里（点击/拖动），算用户手势。
        if (!audio.unlocked) unlockAudio();
        if (!audio.unlocked || audio.muted) return;
        var list = audioPool[name];
        if (!list) return;
        var el = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i].paused || list[i].ended) { el = list[i]; break; }
        }
        if (!el) el = list[0];
        try {
            el.currentTime = 0;
            el.volume = audio.muted ? 0 : audio.volume;
            // 参考对翻页做了音高区分：往回翻 0.93 倍速（更低沉）
            el.playbackRate = (options && options.rate) || 1;
            var playing = el.play();
            if (playing && playing.catch) {
                playing.catch(function (error) {
                    // 记下失败原因（自动播放被拦 / 解码失败…）便于排查，不影响翻书
                    audio.lastError = (error && error.name) || 'play-rejected';
                });
            }
        } catch (e) { audio.lastError = (e && e.name) || 'play-threw'; }
    }

    // 首次手势后才建 AudioContext 并解锁（浏览器自动播放策略）
    function unlockAudio() {
        if (audio.unlocked) return;
        try {
            ensureAudioPool();
            applyAudioVolume();
            // 预载一次：否则"第一次翻页时 mp3 还没解码完 → 听不到"
            Object.keys(audioPool).forEach(function (name) {
                audioPool[name].forEach(function (el) {
                    try { el.load(); } catch (e) { /* 忽略 */ }
                });
            });
            audio.unlocked = true;
        } catch (e) { /* 环境不支持就当静音 */ }
    }

    function syncAudioUI() {
        if (els.mute) {
            els.mute.setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
            els.mute.setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
            els.mute.title = audio.muted ? '取消静音' : '静音';
            // ⚠️ 别往按钮里写文字：里面是一段 SVG（声波 / 声波加叉靠
            // aria-pressed 切换显隐），textContent 会把整段图标冲掉。
        }
        if (els.volume) {
            els.volume.value = String(audio.volume);
            // 轨道已填充的部分跟着音量走（CSS 里用 --ms-vol 画那道渐变）
            els.volume.style.setProperty('--ms-vol', Math.round(audio.volume * 100) + '%');
        }
        applyAudioVolume();
    }

    function setMuted(next) {
        audio.muted = !!next;
        if (!audio.muted) unlockAudio();
        audioSavePrefs();
        syncAudioUI();
    }

    function setVolume(next) {
        audio.volume = Math.max(0, Math.min(1, next));
        audioSavePrefs();
        syncAudioUI();
    }

    function bindAudioControls() {
        audioLoadPrefs();
        syncAudioUI();
        if (els.mute) {
            els.mute.addEventListener('click', function (event) {
                event.stopPropagation();
                setMuted(!audio.muted);
            });
        }
        if (els.volume) {
            els.volume.addEventListener('input', function (event) {
                setVolume(parseFloat(event.target.value));
            });
            els.volume.addEventListener('click', function (event) { event.stopPropagation(); });
        }
        // 首次手势解锁：**整页**任意一次按下/按键都算（覆盖层内外都行），
        // 否则从顶栏入口进来、第一次点的是"世界这本书"按钮时就解不了锁。
        document.addEventListener('pointerdown', unlockAudio, true);
        document.addEventListener('keydown', unlockAudio, true);
        // 页面隐藏时把正在响的音效暂停（照参考的 handleVisibility）
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) return;
            Object.keys(audioPool).forEach(function (name) {
                audioPool[name].forEach(function (el) {
                    if (!el.paused) {
                        try { el.pause(); } catch (e) { /* 忽略 */ }
                    }
                });
            });
        });
    }

    // ==========================================================================
    // 展开的书：一本真正的三维精装书
    // --------------------------------------------------------------------------
    // 书脊 = Y 轴，书脊位置 = SPINE_X。结构：
    //   bookGroup
    //     ├─ 后封板 / 书脊 / 书页块（静态的三块实体）
    //     ├─ frontPivot  → 前封板，开合就是绕书脊从 0 转到 -π
    //     └─ 一片片「叶」：每片是书脊处的 pivot + 正反两片 18x8 分段的平面
    // 每片叶有两套目标姿态：未翻（右侧、微翘）与已翻（左侧、叠起来），
    // 再加上一个弹簧驱动的「肚子」（curve）让纸拱起来 —— 纸从来不是平的，
    // 这一条是页面像不像纸的关键。
    // ==========================================================================

    var BK_WIDTH = 1.5;         // 封面宽
    var BK_HEIGHT = 2.02;       // 封面高
    var BK_DEPTH = 0.34;        // 书厚
    var BK_BOARD = 0.055;       // 封板厚
    var BK_SPINE = 0.10;        // 书脊宽
    var PAGE_W = BK_WIDTH - 0.16;   // 可见页宽：比封面窄一圈，形成封面外伸
    var PAGE_H = BK_HEIGHT - 0.04;
    var SPINE_X = -BK_WIDTH / 2 + BK_SPINE * 0.62;

    var LEAF_SEG_X = 18;        // 横向分段数：决定卷曲有多顺
    var LEAF_SEG_Y = 8;
    var LEAF_SPEED = 10.5;      // 封/页开合的阻尼速度
    var LEAF_UNTURNED = -0.026; // 未翻的页微微上翘（越小纸叠越紧、越像压过的书芯）
    var LEAF_TURNED = -Math.PI + 0.085;
    // 未翻纸叠的站位。**所有叶都必须待在书页块"前面"**：
    // 书页块那张横条纹纸面在 z = PAGE_BLOCK_FRONT，只要有叶跑到它后面，
    // 块的正脸就会盖在那片叶上 —— 看起来就是「右页外侧有一块横条纹的纸」。
    // 页数多时片间距和片间张角都会自动缩小，保证最后一片仍在块的前面。
    var PAGE_BLOCK_FRONT = (PAGE_DEPTH - 0.03) / 2;   // 书页块前表面（块厚 PAGE_DEPTH-0.03）
    var LEAF_REST_FRONT = BOOK_T / 2 - 0.006;         // 最前一片：贴近前封板内侧，留出拱形净空
    var LEAF_REST_BACK = PAGE_BLOCK_FRONT + 0.005;    // 最后一片的下限：仍在书页块前面
    // 纸叠要紧：前倾角与扇开角都收小（用户反馈"书页看起来像散开的一叠纸"）。
    // 片间距 0.0015 → 0.0012，片间张角 0.008 → 0.0055。
    var LEAF_REST_STEP = 0.0012;                      // 片间距（页多时自动缩）
    var LEAF_FAN_STEP_MAX = 0.0055;                   // 片间张角（页多时自动缩）
    var leafFanStep = LEAF_FAN_STEP_MAX;
    // 翻过去那一叠的片间扇开角：**总角度固定，按片数分摊**（和右边那叠同一套做法）。
    // 原来是每片固定 0.014 rad：30 片就是 22.6°，页宽 1.39 意味着一叠纸的外缘
    // 往前探出 0.53 —— 比整本书芯（0.38）还厚，用户看到的就是"左边凸起一大块"。
    // 片数≤4 时归一值仍等于上限，小书观感完全不变。
    var TURNED_FAN_TOTAL = 0.05;
    var TURNED_FAN_STEP_MAX = 0.014;

    function turnedFanStep() {
        var n = (book && book.leaves) ? book.leaves.length : 1;
        return Math.min(TURNED_FAN_STEP_MAX, TURNED_FAN_TOTAL / Math.max(1, n - 1));
    }
    // 叶的几何**照参考实现：不加任何位移**。纸的 pivot 就钉在订口，整段翻页
    // 都是绕订口做的纯旋转 —— 左缘因此始终连着书脊。
    // 之前为了"消灭左页外缘那条露出来的封面内侧"，我试过按转角把 pivot 或纸面
    // 往外挪，两次都不对：轴一动就不是绕订口翻了（"凭空翻页"），纸面一动左缘又
    // 离开书脊。参考实现（complete-shelf）本来就不补这段 —— 翻过去的那叠纸比封面
    // 小一圈，外缘露出封面内侧/环衬是**正常的**，这里就按它来。
    var PAGE_ROWS = 6;          // 列表页每页几行
    var BOOK_CAMERA_Z = 7.4;    // 与书架态的相机完全一致：进检视态相机一动不动
    var BOOK_Z = 0.62;          // 书摆在镜头前的哪个深度（比 0 近，会显得更大）
    var BOOK_FOV = 32;          // 与 initShelf 里建相机用的 fov 保持一致
    // 摊开后的书本占可见高度的多少。原来是 0.86 / 0.78 —— 摊开那一下
    // 几乎顶满画面，用户反馈"放大太大了"。收到 0.70 / 0.62：
    // 展开完成后只是**适当**放大一档，四周留出呼吸空间。
    var BOOK_FILL_H = 0.70;
    var BOOK_FILL_W = 0.62;
    // 封面完全打开时的残余倾角。它决定封面**远边**在 z 上抬起多少
    // （≈ 书宽 × sin(倾角)），而翻过去的纸必须落在这个高度之上，
    // 否则纸会被压在封面远边下面 —— 那就是「翻页穿模」的来源。
    // 收成 0：封面完全摊平（-π）。这样它的厚度区间就是干净的 0.17~0.202，
    // 翻过去的纸可以**贴着封面**落（0.206），既没有穿模也不会离得太远。
    // 之前留 0.055 / 0.02 的倾角，远边会被抬起 0.08 / 0.03，
    // 纸就只能跟着抬到 0.238 才不撞 —— 那就是「离翻面太远」。
    var COVER_TILT = 0;
    // 封面远边因倾角抬起的高度 ≈ 书宽 × sin(倾角)，再留 0.006 余量
    var COVER_TILT_BOOK_W_LIFT = BOOK_W * Math.sin(COVER_TILT) + 0.006;
    var BOOK_PITCH = -0.17;     // 检视态的基础俯仰（书微微后仰）
    // 检视态的机位：**相机绕书心做轨道**（照 complete-shelf 的 OrbitControls），
    // 而不是"把书转起来"。BOOK_Z 处就是轨道圆心，基础半径 = 相机到书的距离，
    // 所以 yaw = pitch = 0、zoom = 1 时的机位与原来看起来是同一个。
    var INSPECT_DIST = BOOK_CAMERA_Z - BOOK_Z;
    // 书本在检视态**离地的高度**（书心）。比原来抬高 0.73：
    //   · 书下沿离地面从 0.71 变成 1.44，"书浮在棚里"而不是"搁在地上"；
    //   · 从下往上看时留给相机的余量大得多（俯仰下限就是被地面卡住的）。
    var BOOK_INSPECT_Y = 1.15;
    // 俯仰上限：照 complete-shelf 的 OrbitControls（它没有上下限位），
    // 这里给到 72°，基本可以俯视整本书。
    var INSPECT_PITCH_MAX = 1.25;
    // 左右**不设限**：OrbitControls 的方位角是能一直转下去的，转多少圈都行。
    // 之所以敢不设限：房间四面墙都是朝内的单面，相机绕到某面墙外时那一面会被
    // 背面剔除、自己让开，背后那几面墙和它们的角始终在画面里，不会"穿墙看空"。

    // 每帧算出来的机位计划（书架态 / 检视态 / 合书过程都只写它，最后统一落到相机上）
    var camPlan = {
        pos: { x: 0, y: 0.42, z: 7.4 },
        target: { x: 0, y: 0.3, z: 0 }
    };

    // 书的缩放不写死：按「相机到书的实际距离 + 当前画幅」算出来。
    // 之前把书放在 z=1.15 却按 z=0 推尺寸，等于凭空放大了 22%，上下直接顶出屏幕。
    function fitBookScale() {
        if (!shelf || !shelf.camera) return 1.3;
        var dims = (book && book.dims) || { pageW: PAGE_W, height: BK_HEIGHT };
        var aspect = shelf.camera.aspect || 1.8;
        var distance = Math.max(1, BOOK_CAMERA_Z - BOOK_Z);
        var viewH = 2 * Math.tan(BOOK_FOV / 2 * Math.PI / 180) * distance;
        var viewW = viewH * aspect;
        var openW = dims.pageW * 2 + 0.12;
        var openH = dims.height || BK_HEIGHT;
        return Math.max(0.6, Math.min(viewH * BOOK_FILL_H / openH, viewW * BOOK_FILL_W / openW));
    }

    var book = null;            // 展开态的书本运行时


    // 一片纸：书脊处的 pivot + 正反两片分段平面。正面朝右（未翻），
    // 翻过去之后看到的是背面。
    // host 需要 { group, leaves, dims }：dims 让同一套叶结构既能装进独立书本，
    // 也能装进书架上那本精选书。
    function addLeaf(THREE, host, index) {
        var dims = host.dims || {
            spineX: SPINE_X, depth: BK_DEPTH, board: BK_BOARD,
            pageW: PAGE_W, pageH: PAGE_H
        };
        // 叶叠的起止位置由**这一本自己的厚度**决定（书厚度不同的书不能共用一套）
        var restFront = dims.leafRestFront !== undefined ? dims.leafRestFront : LEAF_REST_FRONT;
        var restStep = dims.leafRestStep || LEAF_REST_STEP;
        var pivot = new THREE.Group();
        // index 0 是最上面那片（最先被翻），所以它**最靠前**，往后依次后退。
        // 这里的数值只是占位；真正的位置由 layoutLeafStack() 按当前页集的
        // 片数统一排（页多时片间距自动缩小，保证不插进书页块里）。
        pivot.position.set(dims.spineX, 0, restFront - index * restStep);
        host.group.add(pivot);

        function face(sign) {
            var geometry = new THREE.PlaneGeometry(1, 1, LEAF_SEG_X, LEAF_SEG_Y);
            var material = new THREE.MeshStandardMaterial({
                map: null, color: '#fdfaf3', roughness: 0.95, metalness: 0
            });
            var mesh = new THREE.Mesh(geometry, material);
            mesh.scale.set(dims.pageW, dims.pageH, 1);
            mesh.position.set(dims.pageW / 2, 0, sign * 0.0003);
            if (sign < 0) mesh.rotation.y = Math.PI;
            pivot.add(mesh);
            return {
                mesh: mesh,
                base: new Float32Array(geometry.attributes.position.array),
                direction: sign
            };
        }

        var leaf = {
            index: index,
            pivot: pivot,
            restZ: pivot.position.z,
            // 翻过去之后落到**左边封面的上方**（而不是后封板内侧）。
            // complete-shelf 的 turnedZ 是 depth/2 + board + 0.004，也就是在
            // 摊开的封面之外；我之前写成 -depth/2 + board，页就跑到封面下面去了 ——
            // 这正是「翻过去的那一页被压在封面下、穿模」的原因。
            // 落在摊开封面之上：要盖过封面远边被倾角抬起的那一点高度。
            turnedZ: dims.depth / 2 + dims.board + COVER_TILT_BOOK_W_LIFT + index * 0.0015,
            front: face(1),
            back: face(-1),
            flex: { curve: 0.004, curveVelocity: 0, twist: 0, twistVelocity: 0,
                    targetCurve: 0.004, targetTwist: 0 }
        };
        host.leaves.push(leaf);
        return leaf;
    }

    // 按当前页集的片数重排未翻纸叠。
    // 两件事必须一起做：片间距要缩到「最后一片仍在书页块前面」，
    // 片间张角也要缩到「最后一片不会往后倒」—— 否则那片纸的外侧就会被
    // 书页块的横条纹纸面盖住（页数越多越明显，正是"翻到后面几页开始穿模"）。
    function layoutLeafStack(count) {
        if (!book) return;
        var n = Math.max(1, count);
        var d = book.dims || {};
        var restFront = d.leafRestFront !== undefined ? d.leafRestFront : LEAF_REST_FRONT;
        var restBack = d.leafRestBack !== undefined ? d.leafRestBack : LEAF_REST_BACK;
        var restStep = d.leafRestStep || LEAF_REST_STEP;
        var span = restFront - restBack;
        var step = Math.min(restStep, span / Math.max(1, n - 1));
        // 张角总和不能超过 LEAF_UNTURNED 那点前倾，否则后面的片会往后倒
        leafFanStep = Math.min(LEAF_FAN_STEP_MAX, Math.abs(LEAF_UNTURNED) / Math.max(1, n - 1));
        book.leaves.forEach(function (leaf) {
            leaf.restZ = restFront - step * leaf.index;
        });
    }

    // 页集变小（比如从 28 张照片的相册回到只有一页的城市章节）时，
    // 多出来的叶必须真的从场景里拿掉：three 的射线检测不看 visible，
    // 只是隐藏的话，这些空叶仍会被"点到"，而且它们的横条纹空页还会露出来。
    function trimLeaves(host, count) {
        while (host.leaves.length > count) {
            var leaf = host.leaves.pop();
            if (leaf.pivot.parent) leaf.pivot.parent.remove(leaf.pivot);
            [leaf.front, leaf.back].forEach(function (face) {
                if (face.mesh.geometry) face.mesh.geometry.dispose();
                if (face.mesh.material) face.mesh.material.dispose();
            });
        }
    }

    // 拱形包络：**不换向**（所以不能用 cos(转角) 之类会过零翻面的系数），
    // 用"前半段快速起拱、后半段更快收回"——后半段收得快，落页时弧度已接近 0，
    // 纸的肚子不会顶进下面那叠纸里（这正是当初引入 cos 系数的原因）。
    function curlEnvelope(t) {
        var p = clamp(t, 0, 1);
        // 0.45（约 81°）起收、0.65（约 117°）就归零 —— 弧度必须**在靠近左边之前
        // 消失**，否则纸会带着弧度落到左叠上、顶进后面那几张里。
        return p <= 0.45
            ? Math.pow(p / 0.45, 0.6)
            : Math.pow(Math.max(0, (0.65 - p) / 0.2), 1.6);
    }

    // 纸的柔性：弹簧把 curve/twist 推向目标，再按这两个量重摆平面顶点。
    // curve 就是纸的「肚子」：正弦拱形 + 自由边抬升，离书脊越远拱得越高。
    function updateLeafFlex(leaf, delta) {
        var flex = leaf.flex;
        var step = Math.min(delta, 0.033);
        if (reduceMotion) {
            flex.curve = flex.targetCurve;
            flex.twist = flex.targetTwist;
            flex.curveVelocity = 0;
            flex.twistVelocity = 0;
        } else {
            var accCurve = (flex.targetCurve - flex.curve) * 178 - flex.curveVelocity * 19;
            var accTwist = (flex.targetTwist - flex.twist) * 210 - flex.twistVelocity * 21;
            flex.curveVelocity = clamp(flex.curveVelocity + accCurve * step, -1.8, 1.8);
            flex.twistVelocity = clamp(flex.twistVelocity + accTwist * step, -1.6, 1.6);
            flex.curve = clamp(flex.curve + flex.curveVelocity * step, -0.03, 0.22);
            flex.twist = clamp(flex.twist + flex.twistVelocity * step, -0.12, 0.12);
        }
        deformLeaf(leaf);
    }

    function deformLeaf(leaf) {
        // 纸的「肚子」方向**在整段翻页里固定**（叶自己的局部法线，由 direction 定）。
        // 参考实现的纸就是绕订口转的一张 C 形，中途不换向。
        // 这里原来乘了 cos(转角)：本意是让落页后的肚子仍朝镜头（躲开"顶进纸叠"），
        // 代价却是转到 90° 时系数过零、后半段把弧度**翻了面** —— 用户报的
        // "弧度在中途换方向"就是它，而且过零那一下弧度归零，整段翻页更看不出弧。
        // 现在改成"方向固定 + 后半段更快收弧"（见 curlEnvelope），落页时弧度已接近 0，
        // 一样不会顶进下面的纸叠。
        [leaf.front, leaf.back].forEach(function (face) {
            var position = face.mesh.geometry.attributes.position;
            var base = face.base;
            var direction = face.direction;
            var curve = leaf.flex.curve;
            var twist = leaf.flex.twist;
            for (var i = 0; i < position.count; i++) {
                var x = base[i * 3];
                var y = base[i * 3 + 1];
                var u = x + 0.5;                              // 0=书脊侧，1=自由边
                var mapped = direction > 0 ? u : 1 - u;
                var arch = Math.sin(Math.PI * mapped);
                var lift = mapped * mapped * 0.16;
                var shape = arch * 0.84 + lift;
                var diagonal = twist * y * Math.pow(mapped, 1.35);
                var ripple = twist * Math.sin(mapped * Math.PI * 2) *
                    (1 - Math.min(1, Math.abs(y) * 1.65)) * 0.09;
                var z = (curve * shape * (1 + y * 0.14) + diagonal + ripple) * direction;
                position.setXYZ(i, x, y, z);
            }
            position.needsUpdate = true;
            face.mesh.geometry.computeVertexNormals();
        });
    }

    // ---------------- 页面内容（画到 canvas 上再当贴图） ----------------


    function pageTextureFor(THREE, spec, key) {
        // 画布按 2.5 倍出图（逻辑版面 400×564）。原来 2 倍（800×1128）"刚好够算"：
        // 正常视角下页约 500px 高、贴图是缩小采样没问题，但两处会顶到天花板 ——
        //   · 检视态滚轮放大到上限 2.2 时，页面约 1100px 高，1128 正好卡在 1:1；
        //   · 2× 视网膜屏上 500 CSS px → 1000 物理 px，同样卡线。
        // 提到 2.5 倍（1000×1410）覆盖这两个场景，单页 5.6MB；配合下面的
        // "窗口外真的释放"，常驻只有 10 页左右 ≈75MB，不会无限增长。
        var canvas = makeCanvas(1000, 1410);
        paintPage(canvas, spec);
        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = maxAnisotropy;      // 页面是斜看的，各向异性拉满才不糊
        texture._canvas = canvas;
        texture._key = key;
        return texture;
    }

    // 空白页贴图：没有内容的页以前是「没有贴图」，于是渲染成一块纯色，
    // 和有内容的页（纸纹 + 页边）放一起就明显是两种东西。
    // 这里给空白页同样的纸底与纹理，只是不画内容。
    var blankPageCache = null;
    function blankPageTexture(THREE) {
        if (blankPageCache) return blankPageCache;
        var canvas = makeCanvas(1000, 1410);   // 跟内页同密度，补画时不跳分辨率
        var scale = canvas.width / 400;
        var ctx = canvas.getContext('2d');
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.fillStyle = '#fdfaf3';
        ctx.fillRect(0, 0, 400, 564);
        for (var y = 0; y < 564; y += 3) {
            ctx.fillStyle = 'rgba(150,130,100,0.05)';
            ctx.fillRect(0, y, 400, 1);
        }
        // 一道很淡的内边框，让空白页也有「纸」的感觉
        ctx.strokeStyle = 'rgba(59,49,40,0.10)';
        ctx.lineWidth = 1;
        ctx.strokeRect(30.5, 30.5, 339, 503);
        blankPageCache = new THREE.CanvasTexture(canvas);
        blankPageCache.colorSpace = THREE.SRGBColorSpace;
        blankPageCache.anisotropy = maxAnisotropy;
        return blankPageCache;
    }

    function repaintTexture(texture, spec) {
        if (!texture || !texture._canvas) return;
        // 已经因为"翻远了"被释放的页别再重画：那张贴图已经 dispose，
        // 再 needsUpdate 会让 three 把它重新传一遍显存（又不回收）。
        if (texture._released) return;
        paintPage(texture._canvas, spec);
        texture.needsUpdate = true;
    }

    function paintPage(canvas, spec) {
        // 所有排版都按 400x564 这套「逻辑坐标」写，实际画布可以是它的任意整数倍
        var w = 400;
        var h = 564;
        var scale = canvas.width / w;
        var ctx = canvas.getContext('2d');
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        // 内页三支墨色。**次级文字别太淡**：页面是在 3D 灯光下渲染的，
        // 58% 的沉墨在斜看/远看时会灰掉，用户反馈"有些看不清"。
        // 正文 ink 不动；muted 从 0.58 提到 0.76；accent 从 #9b704e 压到 #7f5c3d
        // （城市序号、小标、右侧「N 张」都用它）。
        var ink = '#3b3128';
        var muted = 'rgba(59,49,40,0.76)';
        var accent = '#7f5c3d';
        // 版心边距 M 与字阶 TYPE 定义在模块级（见 paintCover 之前）——
        // 书脊/封底贴图也画同族文字，放函数里它们就取不到了。
        // M 随左右页变：订口（内侧）比外缘多 PAGE_GUTTER_EXTRA。
        var M = pageMargins(spec.side);
        var innerW = w - M.left - M.right;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#fdfaf3';
        ctx.fillRect(0, 0, w, h);
        // 纸纹
        for (var y = 0; y < h; y += 3) {
            ctx.fillStyle = 'rgba(150,130,100,0.05)';
            ctx.fillRect(0, y, w, 1);
        }
        // ---- A1 · 纸张质感（所有页共用，画在内容之下所以不会压到文字）----
        // 细颗粒：真实纸不是纯色，扫过时要有微弱起伏
        for (var gp = 0; gp < 2600; gp++) {
            ctx.fillStyle = Math.random() > 0.5
                ? 'rgba(255,255,255,0.045)' : 'rgba(140,120,96,0.045)';
            ctx.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
        }
        // 边缘轻微压暗：纸叠在书里，靠订口与外缘各有一点暗角，
        // 不然整页是"发光的白"，看着像屏幕而不是纸
        var edgeShade = ctx.createLinearGradient(0, 0, w, 0);
        edgeShade.addColorStop(0, 'rgba(120,100,76,0.055)');
        edgeShade.addColorStop(0.14, 'rgba(120,100,76,0)');
        edgeShade.addColorStop(0.86, 'rgba(120,100,76,0)');
        edgeShade.addColorStop(1, 'rgba(120,100,76,0.035)');
        ctx.fillStyle = edgeShade;
        ctx.fillRect(0, 0, w, h);
        var topShade = ctx.createLinearGradient(0, 0, 0, h);
        topShade.addColorStop(0, 'rgba(120,100,76,0.03)');
        topShade.addColorStop(0.2, 'rgba(120,100,76,0)');
        topShade.addColorStop(0.85, 'rgba(120,100,76,0)');
        topShade.addColorStop(1, 'rgba(120,100,76,0.03)');
        ctx.fillStyle = topShade;
        ctx.fillRect(0, 0, w, h);

        // 照片页：一页 1~2 张，每张按**自己的比例**装进框里（不裁构图），下面一行图注。
        // 一页两张 = 一跨四张，翻页次数减半；图注左边是「城市 · 年月」、右边是「03 / 53」。
        if (spec.kind === 'photo') {
            var shots = (spec.shots && spec.shots.length)
                ? spec.shots
                : (spec.photo ? [{ url: spec.photo, image: spec.image, time: spec.time }] : []);
            if (!shots.length) shots = [{ url: '', image: null, time: '' }];
            var shotTop = 56;
            var shotBottom = h - M.bottom;
            var capH = 26;                    // 每条图注占的高度
            var shotGap = 26;                 // 两张之间
            var boxH = Math.max(120, (shotBottom - shotTop - shots.length * capH -
                (shots.length - 1) * shotGap) / shots.length);
            shots.forEach(function (shot, i) {
                var y0 = shotTop + i * (boxH + capH + shotGap);
                var iw = (shot.image && shot.image.naturalWidth) || 4;
                var ih = (shot.image && shot.image.naturalHeight) || 3;
                var fit = Math.min(innerW / iw, boxH / ih);
                var dw = iw * fit;
                var dh = ih * fit;
                var dx = M.left + (innerW - dw) / 2;
                var dy = y0 + (boxH - dh) / 2;
                ctx.fillStyle = 'rgba(59,49,40,0.07)';
                ctx.fillRect(dx, dy, dw, dh);
                // 这里**不能**用 drawCover：那是按"覆盖"裁切的，相册要的是
                // 按原比例装进框（两侧留白也不裁构图），尺寸上面已经算好了。
                if (shot.image) ctx.drawImage(shot.image, dx, dy, dw, dh);
                ctx.strokeStyle = 'rgba(59,49,40,0.18)';
                ctx.lineWidth = 1;
                ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = muted;
                ctx.font = TYPE.tiny;
                var capText = (spec.title || '') +
                    (shot.time ? ' · ' + formatMonth(shot.time) : '');
                // ⚠️ 图注按**版心宽度**排，不跟着照片宽度缩。原来可用宽度是
                // dw - 58：竖构图高度顶满时 dw 只有 130 左右，减掉给序号的 58
                // 就只剩几十像素，图注被截成四五个字（用户报的"显示不全"）。
                var capY = y0 + boxH + 18;
                ctx.fillText(trim(ctx, capText, innerW - 56), M.left, capY);
                if (shot.no) {
                    ctx.textAlign = 'right';
                    ctx.fillText(shot.no + ' / ' + (spec.photoTotal || shot.no),
                        w - M.right, capY);
                    ctx.textAlign = 'left';
                }
            });
            // 书眉 / 页码统一由下面公共那段画（外侧对齐）
        }

        // 省封面页：照片内嵌，文字与统计各占一条带，互不重叠
        else if (spec.kind === 'cover') {
            // 这页永远在左半（封面内侧）。它的**纹理右边**对应书上那条外缘，
            // 而翻过去的纸比封面小一圈、会露出这条封面内侧（参考实现也这样，
            // 是正常的）—— 所以内容两侧都让开 COVER_OUTER_SAFE：整体收一圈，
            // 外缘那条翻页之后正好被纸盖住，露出来的只剩空白纸边。
            var coverSafe = Math.max(M.left, M.right, COVER_OUTER_SAFE);
            var cx0 = coverSafe;
            var cy0 = 34;
            var cw = w - coverSafe * 2;
            var chh = 266;
            ctx.fillStyle = 'rgba(59,49,40,0.1)';
            ctx.fillRect(cx0, cy0, cw, chh);
            if (spec.image) drawCover(ctx, spec.image, cx0, cy0, cw, chh);
            ctx.strokeStyle = 'rgba(59,49,40,0.2)';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cw - 1, chh - 1);

            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = accent;
            ctx.font = TYPE.eyebrow;
            ctx.fillText('省 份 旅 行 记 忆', cx0, cy0 + chh + 34);
            ctx.fillStyle = ink;
            // 省名缩一档（42 → 38 起）：内容整体收了一圈，字也收一点才匀
            ctx.font = fitFont(ctx, spec.title || '', cw - 8, [38, 34, 30, 26, 22]);
            ctx.fillText(spec.title || '', cx0, cy0 + chh + 78);
            ctx.fillStyle = muted;
            ctx.font = TYPE.meta;
            wrapText(ctx, spec.subtitle || '', cx0, cy0 + chh + 106, cw, 22);

            // 统计带：和正文拉开距离，避免压字
            var stats = spec.stats || [];
            var baseY = 494;
            ctx.strokeStyle = 'rgba(59,49,40,0.16)';
            ctx.beginPath();
            ctx.moveTo(cx0, baseY - 34);
            ctx.lineTo(w - coverSafe, baseY - 34);
            ctx.stroke();
            var sx = cx0 + 24;
            stats.forEach(function (item) {
                ctx.fillStyle = ink;
                ctx.font = TYPE.subName;
                ctx.fillText(String(item.value), sx, baseY);
                ctx.fillStyle = muted;
                ctx.font = TYPE.tiny;
                ctx.fillText(item.label, sx, baseY + 22);
                sx += 132;
            });
            return;
        }

        // 城市扉页（frontispiece）：城市名 + 时间范围 + 卷首图 + 照片数，纯排版页
        else if (spec.kind === 'title') {
            var tc = w / 2;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = accent;
            ctx.font = TYPE.label;
            ctx.fillText('城 市 旅 行 记 忆', tc, 76);
            ctx.fillStyle = ink;
            ctx.font = fitFont(ctx, spec.title || '', innerW - 8, [42, 36, 31, 27, 23]);
            ctx.fillText(spec.title || '', tc, 136);
            ctx.fillStyle = muted;
            // ⚠️ 这里原来写死 '500' + 默认（宋体）：城市名下面那行日期因此又细又淡，
            // 换黑体那轮没覆盖到。小字一律 600 + 黑体。
            ctx.font = fitFont(ctx, spec.range || '', innerW - 8, [15, 14, 13, 12], '600', SANS);
            ctx.fillText(spec.range || '', tc, 166);
            // 双细线：扉页的分量靠这两条线撑
            ctx.strokeStyle = 'rgba(59,49,40,0.30)';
            ctx.beginPath(); ctx.moveTo(tc - 48, 190); ctx.lineTo(tc + 48, 190); ctx.stroke();
            ctx.strokeStyle = 'rgba(59,49,40,0.14)';
            ctx.beginPath(); ctx.moveTo(tc - 30, 195); ctx.lineTo(tc + 30, 195); ctx.stroke();
            // 卷首图：紧跟双细线往下排，宽度给满版心，高度自适应到"统计行之上"。
            // 统计行固定落在页码之上（h-52 vs h-26），所以图永远不会压过页码那条水平线。
            var tTop = 208;
            var tBottom = h - 72;                    // 统计行(h-52)再往上让 20px
            var tw = innerW;
            var th = Math.max(120, tBottom - tTop);
            var tiw = (spec.image && spec.image.naturalWidth) || 4;
            var tih = (spec.image && spec.image.naturalHeight) || 3;
            var tfit = Math.min(tw / tiw, th / tih);
            var tdw = tiw * tfit;
            var tdh = tih * tfit;
            var tdx = tc - tdw / 2;
            var tdy = tTop + (th - tdh) / 2;
            ctx.fillStyle = 'rgba(59,49,40,0.07)';
            ctx.fillRect(tdx, tdy, tdw, tdh);
            if (spec.image) ctx.drawImage(spec.image, tdx, tdy, tdw, tdh);
            ctx.strokeStyle = 'rgba(59,49,40,0.18)';
            ctx.lineWidth = 1;
            ctx.strokeRect(tdx + 0.5, tdy + 0.5, tdw - 1, tdh - 1);
            ctx.fillStyle = muted;
            ctx.font = TYPE.tiny;
            ctx.fillText(spec.statsLine || '', tc, h - 52);
        }

        // 足迹点页：和城市扉页同族，但多一段**描述** —— 标题 + 日期/地址 + 描述 + 卷首图
        else if (spec.kind === 'spot') {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = accent;
            ctx.font = TYPE.label;
            ctx.fillText('足 迹 点', M.left, 58);
            ctx.fillStyle = ink;
            ctx.font = fitFont(ctx, spec.title || '', innerW - 8, [34, 30, 26, 22]);
            ctx.fillText(spec.title || '', M.left, 102);
            // 日期 · 地址（都没有就空着，不留占位）
            var metaLine = [spec.date, spec.address].filter(Boolean).join(' · ');
            if (metaLine) {
                ctx.fillStyle = muted;
                ctx.font = TYPE.tiny;
                ctx.fillText(trim(ctx, metaLine, innerW), M.left, 126);
            }
            // 描述：最多 4 行
            ctx.fillStyle = muted;
            ctx.font = TYPE.meta;
            var descLines = wrapLines(ctx,
                spec.desc || '这条足迹还没有写描述。', innerW, 4);
            descLines.forEach(function (line, i) {
                ctx.fillText(line, M.left, 160 + i * 24);
            });
            // 卷首图**紧跟描述**往下排（自适应）：描述短 → 图就高，描述长 → 图就矮；
            // 下沿统一卡在统计行之上，图不会压过页码那条水平线。
            var sTop = 160 + descLines.length * 24 + 8;
            var sBottom = h - 72;                    // 同城市扉页：统计行再往上 20px
            var sw = innerW;
            var sh = Math.max(100, sBottom - sTop);
            var siw = (spec.image && spec.image.naturalWidth) || 4;
            var sih = (spec.image && spec.image.naturalHeight) || 3;
            var sfit = Math.min(sw / siw, sh / sih);
            var sdw = siw * sfit;
            var sdh = sih * sfit;
            var sdx = M.left + (innerW - sdw) / 2;
            var sdy = sTop + (sh - sdh) / 2;
            ctx.fillStyle = 'rgba(59,49,40,0.07)';
            ctx.fillRect(sdx, sdy, sdw, sdh);
            if (spec.image) ctx.drawImage(spec.image, sdx, sdy, sdw, sdh);
            ctx.strokeStyle = 'rgba(59,49,40,0.18)';
            ctx.lineWidth = 1;
            ctx.strokeRect(sdx + 0.5, sdy + 0.5, sdw - 1, sdh - 1);
            ctx.textAlign = 'center';
            ctx.fillStyle = muted;
            ctx.font = TYPE.tiny;
            ctx.fillText(spec.statsLine || '', w / 2, h - 52);
            ctx.textAlign = 'left';
        }

        // 目录：城市 → 最近到访 → 「N 张 · 相册第 x–y 页」。这页的点按也是活的
        // （spec.cities 与章节列表同一份顺序），所以它同时是个"快捷入口"。
        else if (spec.kind === 'contents') {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = accent;
            ctx.font = TYPE.label;
            ctx.fillText('目 　 录', M.left, 58);
            ctx.fillStyle = ink;
            ctx.font = TYPE.book;
            ctx.fillText(spec.title || '', M.left, 100);
            ctx.strokeStyle = 'rgba(59,49,40,0.22)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(M.left, 120); ctx.lineTo(w - M.right, 120); ctx.stroke();
            var contTop = 152;
            spec.rowsTop = contTop;
            // 行高不固定（城市行高、足迹点行矮），所以逐行记下自己的上下沿，
            // 命中测试按这张表找行 —— 不再假设一个统一行距。
            spec.rowTops = [];
            var y = contTop;
            (spec.rows || []).forEach(function (row) {
                var isCity = row.kind === 'city';
                var rowH = isCity ? TOC_CITY_ROW_H : TOC_POINT_ROW_H;
                var base = y + (isCity ? 22 : 16);
                spec.rowTops.push([y, y + rowH]);
                if (isCity) {
                    // 序号 + 城市名 + 点线 + 页码范围
                    ctx.fillStyle = accent;
                    ctx.font = TYPE.index;
                    ctx.fillText(String(row.no || ''), M.left, base);
                    ctx.fillStyle = ink;
                    ctx.font = TYPE.head;
                    var nameText = trim(ctx, row.name, innerW - 150);
                    ctx.fillText(nameText, M.left + 30, base);
                    var nameEnd = M.left + 30 + ctx.measureText(nameText).width + 6;
                    ctx.font = TYPE.tiny;
                    ctx.fillStyle = accent;
                    var rightText = trim(ctx, row.right || '', 110);
                    var rightW = ctx.measureText(rightText).width;
                    ctx.textAlign = 'right';
                    ctx.fillText(rightText, w - M.right, base);
                    ctx.textAlign = 'left';
                    // 点线：从名字末尾拉到页码左边（目录的经典排法）
                    ctx.save();
                    ctx.strokeStyle = 'rgba(59,49,40,0.32)';
                    ctx.setLineDash([1, 3.5]);
                    ctx.beginPath();
                    ctx.moveTo(nameEnd, base - 4);
                    ctx.lineTo(w - M.right - rightW - 6, base - 4);
                    ctx.stroke();
                    ctx.restore();
                    ctx.strokeStyle = 'rgba(59,49,40,0.18)';
                    ctx.beginPath();
                    ctx.moveTo(M.left, y + rowH - 5);
                    ctx.lineTo(w - M.right, y + rowH - 5);
                    ctx.stroke();
                } else {
                    // 足迹点行：缩进 + 名称 + 日期 + 页码
                    ctx.fillStyle = muted;
                    ctx.font = TYPE.tiny;
                    ctx.fillText('·', M.left + 34, base);
                    ctx.fillStyle = ink;
                    ctx.font = TYPE.meta;
                    var pointName = trim(ctx, row.name, innerW - 170);
                    ctx.fillText(pointName, M.left + 46, base);
                    var pointEnd = M.left + 46 + ctx.measureText(pointName).width + 6;
                    ctx.fillStyle = muted;
                    ctx.font = TYPE.tiny;
                    var subText = trim(ctx, row.sub || '', 96);
                    ctx.fillText(subText, pointEnd, base);
                    if (row.right) {
                        ctx.textAlign = 'right';
                        ctx.fillStyle = accent;
                        ctx.fillText(trim(ctx, row.right, 80), w - M.right, base);
                        ctx.textAlign = 'left';
                    }
                }
                y += rowH;
            });
            if (spec.note) {
                ctx.fillStyle = muted;
                ctx.font = TYPE.tiny;
                ctx.fillText(spec.note, M.left, h - M.bottom);
            }
        }

        // 尾页（colophon）：一行总数 + 两行出处。一页就把书收住了。
        else if (spec.kind === 'colophon') {
            var pc = w / 2;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.strokeStyle = 'rgba(59,49,40,0.24)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pc - 46, 196); ctx.lineTo(pc + 46, 196); ctx.stroke();
            ctx.fillStyle = ink;
            // 就是这一行：42px 的「3 座城市 · 53 张照片」宽 546px，页面只有 400px，
            // 不缩字号两头就被裁掉（用户看到的"前后显示不全"）。fitFont 会一直往下缩到塞得进。
            ctx.font = fitFont(ctx, spec.headline, innerW - 4);
            ctx.fillText(spec.headline || '', pc, 268);
            ctx.fillStyle = muted;
            (spec.lines || []).forEach(function (line, i) {
                ctx.font = fitFont(ctx, line, innerW - 4, [15, 14, 13, 12], '600', SANS);
                ctx.fillText(line, pc, 314 + i * 26);
            });
        }

        // 通用列表 / 信息页
        else {
        var pad = M.left;
        var cursor = 56;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        if (spec.eyebrow) {
            ctx.fillStyle = accent;
            ctx.font = TYPE.label;
            ctx.fillText(spec.eyebrow, pad, cursor);
            cursor += 14;
        }
        if (spec.title) {
            ctx.fillStyle = ink;
            ctx.font = TYPE.book;
            ctx.fillText(spec.title, pad, cursor + 36);
            cursor += 52;
        }
        ctx.strokeStyle = 'rgba(59,49,40,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, cursor + 8);
        ctx.lineTo(w - pad, cursor + 8);
        ctx.stroke();
        cursor += 30;

        if (spec.paragraph) {
            ctx.fillStyle = muted;
            ctx.font = TYPE.body;
            cursor = wrapText(ctx, spec.paragraph, pad, cursor, w - pad * 2, 28) + 14;
        }

        // 记下行的起点，命中测试要按同一套坐标反推点到第几行
        spec.rowsTop = cursor;
        spec.rowPitch = 54;               // 行距不变（用户明确要求），命中测试按它反推
        spec.rowTops = [];
        (spec.rows || []).forEach(function (row) {
            var base = cursor + 20;
            spec.rowTops.push([cursor, cursor + 54]);
            ctx.fillStyle = accent;
            ctx.font = TYPE.index;
            ctx.fillText(String(row.no), pad, base);
            ctx.fillStyle = ink;
            ctx.font = TYPE.head;
            ctx.fillText(trim(ctx, row.name, innerW - 130), pad + 42, base);
            ctx.fillStyle = muted;
            ctx.font = TYPE.meta;
            ctx.fillText(trim(ctx, row.sub || '', 190), pad + 42, base + 22);
            ctx.textAlign = 'right';
            ctx.fillText(row.right || '', w - M.right, base);
            ctx.textAlign = 'left';
            cursor = base + 34;
            ctx.strokeStyle = 'rgba(59,49,40,0.14)';
            ctx.beginPath();
            ctx.moveTo(pad, cursor - 6);
            ctx.lineTo(w - M.right, cursor - 6);
            ctx.stroke();
        });


        if (!spec.rows && !spec.paragraph && spec.image) {
            ctx.fillStyle = 'rgba(59,49,40,0.08)';
            ctx.fillRect(pad, cursor, innerW, 250);
            drawCover(ctx, spec.image, pad, cursor, innerW, 250);
            cursor += 274;
        }
        }

        // ---- 书眉 + 页码：所有页面共用（封面内侧那页已经提前 return 了），
        //      且**画在内容之后**，不会被内容盖住。
        //      位置照真书的规矩：**对齐外侧**（左页靠左、右页靠右），内侧留给订口。
        //      文案由 spec.headLeft / spec.headRight 给（省名 / 城市名），
        //      不用全局 state —— 全局那个在"从相册退回章节"时可能还留着上一座城。
        ctx.textBaseline = 'alphabetic';
        var headText = spec.side === 'right' ? spec.headRight : spec.headLeft;
        var outward = spec.side === 'right';       // 右页：外缘在右边
        if (headText) {
            ctx.fillStyle = 'rgba(59,49,40,0.68)';   // 书眉：0.5 太淡，斜看几乎看不见
            ctx.font = TYPE.folio;
            ctx.textAlign = outward ? 'right' : 'left';
            ctx.fillText(trim(ctx, headText, innerW - 44),
                outward ? w - M.right : M.left, M.top - 18);
            ctx.strokeStyle = 'rgba(59,49,40,0.16)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(M.left, M.top - 10);
            ctx.lineTo(w - M.right, M.top - 10);
            ctx.stroke();
        }
        if (spec.pageNo) {
            ctx.fillStyle = 'rgba(59,49,40,0.68)';   // 页码：同上
            ctx.font = TYPE.folio;
            ctx.textAlign = outward ? 'right' : 'left';
            ctx.fillText(String(spec.pageNo),
                outward ? w - M.right : M.left, h - 26);
        }
        ctx.textAlign = 'left';
    }

    function trim(ctx, text, maxWidth) {
        var value = String(text || '');
        if (ctx.measureText(value).width <= maxWidth) return value;
        while (value.length > 1 && ctx.measureText(value + '…').width > maxWidth) {
            value = value.slice(0, -1);
        }
        return value + '…';
    }

    // 一行大字**缩到能塞进版心为止**：从上往下试字号，第一个放得下的就用。
    // 立这个规矩是因为尾页那行「3 座城市 · 53 张照片」用 42px 要 546px，
    // 而页面只有 400px —— 居中绘制时两头会被画布直接裁掉。
    var DISPLAY_SIZES = [42, 36, 31, 27, 23, 20, 17, 15];
    function fitFont(ctx, text, maxWidth, sizes, weight, family) {
        var value = String(text || '');
        var list = sizes || DISPLAY_SIZES;
        var font = '';
        for (var i = 0; i < list.length; i += 1) {
            font = (weight || '600') + ' ' + list[i] + 'px ' +
                (family || '"Songti SC", "SimSun", serif');
            ctx.font = font;
            if (ctx.measureText(value).width <= maxWidth) return font;
        }
        return font;
    }

    function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        var value = String(text || '');
        if (!value) return y;
        var line = '';
        for (var i = 0; i < value.length; i++) {
            var test = line + value[i];
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, y);
                line = value[i];
                y += lineHeight;
            } else {
                line = test;
            }
        }
        if (line) { ctx.fillText(line, x, y); y += lineHeight; }
        return y;
    }

    // 折行但**限制行数**：超过 maxLines 就把最后一行截成"…"。足迹点页的描述用，
    // 免得一段长描述把下面的卷首图顶出页面。
    function wrapLines(ctx, text, maxWidth, maxLines) {
        var value = String(text || '');
        var lines = [];
        if (!value) return lines;
        var line = '';
        for (var i = 0; i < value.length; i += 1) {
            var test = line + value[i];
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                if (lines.length >= maxLines - 1) {
                    lines.push(trim(ctx, value.slice(i), maxWidth));
                    return lines;
                }
                line = value[i];
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    // ---------------- 页内容组装 ----------------

    function bookPageSpecs(book) {
        // 页序按真实书本排：左页是偶数页，右页是奇数页
        var pages = [];
        pages.push({
            // 封面内侧那页：照片 + 省名 + 统计。城市名单搬到对面的「目录」去了，
            // 免得同一串名字在一个跨页里印两遍。
            kind: 'cover', title: book.name, subtitle: '',
            image: null, photo: book.cover,
            stats: [
                { value: book.cityCount, label: '城市章节' },
                { value: book.photoCount, label: '旅行照片' }
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
                note: '共 ' + book.cityCount + ' 座城市 · ' + book.photoCount + ' 张照片',
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
                kind: 'title', title: block.city.name, range: rangeText,
                statsLine: '共 ' + photos.length + ' 张照片',
                photo: photos.length ? photos[0].url : '', image: null,
                headLeft: book.name, headRight: block.city.name,
                city: block.city, cityPage: block.firstPage
            });
            // 每个足迹点：**自己一页**（标题 + 描述 + 卷首图），照片按点分组排在它后面
            block.items.forEach(function (item) {
                item.pageIndex = pages.length;
                pages.push({
                    kind: 'spot', title: item.name,
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
            headline: book.cityCount + ' 座城市 · ' + book.photoCount + ' 张照片',
            lines: ['《' + book.name + '》旅行记忆', '数据来自足迹插件 · ' + todayText() + ' 生成'],
            headLeft: book.name, headRight: book.name
        });
        return finishPageSpecs(fillTocPageNumbers(pages, cityBlocks), chaptersPage, tocPage);
    }

    function albumPageSpecs(book, city) {
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
                '数据来自足迹插件 · ' + todayText() + ' 生成'].filter(Boolean),
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

    function todayText() {
        var d = new Date();
        return d.getFullYear() + '.' +
            ('0' + (d.getMonth() + 1)).slice(-2) + '.' +
            ('0' + d.getDate()).slice(-2);
    }

    // ---------------- 进入 / 翻页 / 退出 ----------------

    // 不再另建一本「检视用」的书：直接把书架上那本精选书变成可翻阅的书。
    // 这样打开时画面完全不切换 —— 就是同一本书在原地摊开。
    function makeRigBook(rig) {
        if (rig.__book) return rig.__book;
        var THREE = shelf.THREE;
        // **这一本自己的尺寸**（每本书的宽高厚不同，见 BOOK_SIZES）。
        // 摊开后的页宽/页高、转轴位置、叶叠起止全部从它取。
        var dims = rig.dims;
        var BOOK_W = dims.width;
        var BOOK_H = dims.height;
        var BOOK_T = dims.depth;
        var BOARD_T = dims.board;

        // 前面内侧的扉页：封面掀开后左边看到的那一整页
        var insideMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, LEAF_SEG_X, LEAF_SEG_Y),
            new THREE.MeshStandardMaterial({ map: null, color: '#fdfaf3', roughness: 0.95, metalness: 0 }));
        // 内侧扉页几乎铺满整个封板内表面（只留 3mm 布边）。
        // 原来是让出 TURN_IN(0.018) —— 那圈布边本身就是"黑边"：
        // 无头浏览器量出来它只有 72~89 亮度，而纸页是 237~241，
        // 翻开封面后内侧上/下/左各一条 4~5px 的暗带就是它。
        // 参考实现的扉页也是"比封面小一点点"，不是让出一整圈 18mm。
        insideMesh.scale.set(BOOK_W - 0.006, BOOK_H - 0.006, 1);
        // 内侧扉页贴在封板里侧，且比最上面那片叶更靠前：
        // 掀开时它从纸叠上方扫过去，而不是从纸里穿过去
        // 内侧纸页紧贴封板（原来是 -0.003，留了一条 3mm 的缝；那条缝从斜角看进去
        // 是黑的，也会加深内侧四周那圈暗带）。贴平之后内表面就是"布边 + 纸页"。
        insideMesh.position.set(BOOK_W / 2, 0, -BOARD_T / 2 - 0.0006);
        insideMesh.rotation.y = Math.PI;
        rig.coverPivot.add(insideMesh);

        // 后封内侧 = **环衬（纸）**，照参考实现的 backEndpaper：
        // 尺寸是 (宽 - 0.045) × (高 - 0.045)（各内缩 0.0225，×比例尺），
        // 四周留出包边的布边 —— 不是一张铺满的纸。
        //
        // ⚠️ 这一层**不能贴内容页**：之前它取的是最后一页的贴图（章节里是省份封面、
        // 相册里是最后一张照片），而纸叠比封板小一圈，转到侧面时透过那条缝就能
        // 看到后封内侧的图片 —— 用户报的"后面的封面里面也能看到图片"就是它。
        // 内容页有自己的叶，书末翻到最后一跨页时自然会露出来。
        var insideBackMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, 4, 4),
            new THREE.MeshStandardMaterial({ map: null, color: '#fdfaf3', roughness: 0.95, metalness: 0 }));
        insideBackMesh.scale.set(BOOK_W - ENDPAPER_INSET, BOOK_H - ENDPAPER_INSET, 1);
        insideBackMesh.position.set(0, 0, -BOOK_T / 2 + 0.0006);
        rig.root.add(insideBackMesh);

        // 接触阴影整块删掉了。它是一张比书还大的半透明暗色贴片，铺在书后 ——
        // 在亮色墙面上看就是「书背后有一块黑背景」。书本身的投影由场景里的
        // 方向光 shadowMap 给出，已经够了。

        // 摊开后要**居中显示**：封面掀开以后比纸页还宽，视觉重心落在书脊左边，
        // 所以不能按书脊估（那样书会明显偏左）。这里直接量一次"封面摊平"时
        // 整本书在自己坐标系里的包围盒，取它的中心作为对齐基准。
        // 叶只会落在封面范围内，所以这本书量一次就够，不用每帧算。
        var savedPos = rig.root.position.clone();
        var savedRot = rig.root.rotation.clone();
        var savedScale = rig.root.scale.clone();
        var savedCover = rig.coverPivot.rotation.y;
        rig.root.position.set(0, 0, 0);
        rig.root.rotation.set(0, 0, 0);
        rig.root.scale.setScalar(1);
        rig.coverPivot.rotation.y = -Math.PI;
        rig.root.updateMatrixWorld(true);
        var openBox = new THREE.Box3().setFromObject(rig.root);
        rig.coverPivot.rotation.y = savedCover;
        rig.root.position.copy(savedPos);
        rig.root.rotation.copy(savedRot);
        rig.root.scale.copy(savedScale);
        rig.root.updateMatrixWorld(true);

        rig.__book = {
            group: rig.root,          // 要移动的就是书架上的这本书本体
            frontPivot: rig.coverPivot,
            frontBoard: rig.frontBoard,
            insideMesh: insideMesh,
            insideBackMesh: insideBackMesh,
            leaves: [],
            dims: dims,
            rig: rig,
            // 摊开后整本书的中心（本书自己的坐标系，x 方向）
            openCenterX: (openBox.min.x + openBox.max.x) / 2
        };
        return rig.__book;
    }

    function applyFaceTexture(face, texture) {
        if (!face || !face.mesh) return;
        // 贴图是共享的（state.bookTextures 里缓存着，翻回来还要用），只换引用不释放
        face.mesh.material.map = texture;
        face.mesh.material.needsUpdate = true;
    }

    // 把一组页装进书本，并显示第 spreadIndex 个跨页
    // 「抽出来」那一秒里，书已经翻开一角、里面两页是看得见的，
    // 所以贴图必须**在动画开始前**就贴上去。否则第一次进来这一秒是两张白纸
    // （第二次来，上一回贴好的贴图还留在网格上，看起来就正常 —— 这正是
    // 「同一本书第一次看不见、第二次能看见」的原因）。
    // ⚠️ 参数**不能叫 book**：模块级有个同名的 book（当前展开的书），参数会把它遮住，
    // 里面那句 book = runtime 就只改了参数，paintBookPageWindow 读到的仍是 null、
    // 直接早退 —— 翻开动画那几张页因此是白纸（用户报的"翻开过程中页的内容没了"）。
    function prepareBookPages(data) {
        var three = shelf && shelf.THREE;
        var rig = shelf && shelf.rigs[state.active];
        if (!three || !rig || !data) return;
        var runtime = makeRigBook(rig);
        if (!runtime) return;
        var pages = bookPageSpecs(data);
        var blank = blankPageTexture(three);
        var leafCount = Math.max(1, Math.ceil(Math.max(0, pages.length - 1) / 2));
        trimLeaves(runtime, leafCount);
        while (runtime.leaves.length < leafCount) addLeaf(three, runtime, runtime.leaves.length);
        layoutLeafStack(leafCount);
        // 先全部铺白纸，再由 paintBookPageWindow 只画"当前跨页附近"那几页 ——
        // 城市内容现在都排在同一本书里，一次全画要几百 MB 画布（见那里的说明）。
        state.bookPages = pages;
        state.bookTextures = [];
        applyFaceTexture({ mesh: runtime.insideMesh }, blank);
        // 后封内侧是**环衬**，不是内容页（见 makeRigBook 里的说明）
        if (runtime.insideBackMesh) {
            applyFaceTexture({ mesh: runtime.insideBackMesh }, blank);
        }
        runtime.leaves.forEach(function (leaf) {
            applyFaceTexture(leaf.front, blank);
            applyFaceTexture(leaf.back, blank);
            leaf.pivot.rotation.y = LEAF_UNTURNED + leaf.index * leafFanStep;
            leaf.pivot.position.z = leaf.restZ;
        });
        var savedBook = book;
        book = runtime;
        paintBookPageWindow(pages, 0);
        book = savedBook;
        // 记下"这本书 + 这叠页"：openChapters 里 loadBookPages 会拿到**同一个数组**，
        // 于是它不会再清空贴图缓存、重画一遍 —— 否则翻开动画刚结束那一下，
        // 页会先白一帧再重新画出来（用户看到的"翻开过程中页的内容没了"）。
        preparedPages = { book: data, pages: pages };
    }

    var preparedPages = null;

    // 翻开动画前已经把这叠页画好了：这里把同一个数组交回去（见 prepareBookPages 的说明）
    function preparedPageSpecs(b) {
        if (preparedPages && preparedPages.book === b) return preparedPages.pages;
        return bookPageSpecs(b);
    }

    function loadBookPages(pages, spreadIndex, title, intro, crumb) {
        var d = api();
        var three = shelf && shelf.THREE;
        if (!three) return;
        // 用书架上当前这本精选书本身，而不是另建一本
        var activeRig = shelf.rigs[state.active];
        if (!activeRig) return;
        // 必须写回模块级的 book：检视态的每一处逻辑（翻页、封面开合、轨道旋转、
        // 行命中）都读它。漏掉这一行，整本书就停在书架姿态上一动不动 —— 看起来
        // 就是「书在左边、超出屏幕、拖不动也翻不了」。
        book = makeRigBook(activeRig);
        var runtime = book;
        if (!runtime) return;

        // 从书架进来才播「抽出来 + 封面掀开」；章节与相册之间换页集时不重播
        var fromShelf = state.mode !== 'book';
        state.bookPages = pages;
        state.bookSpread = spreadIndex || 0;
        state.mode = 'book';
        setPhase('inspection');
        state.bookEnterAt = fromShelf ? performance.now() : 0;
        runtime.group.visible = true;
        runtime.rig.disposed = false;
        // 书列退场：其余的书按一条**确定的时间线**沉下去（参考实现是把整个
        // shelfStage 平移出画面）。**只有从书架进来才起这段动画** —— 章节 <-> 相册
        // 只是在书本模式里换页集，那些书早就在下面藏好了，再起一次会让整排书架
        // 在摊开的书后面闪一下（用户说的「书架突然显示又消失」）。
        if (fromShelf) {
            var retreatAt = performance.now();
            shelf.rigs.forEach(function (rig) {
                if (rig === runtime.rig) return;
                rig.sinkTarget = 1;
                rig.visible = false;
                startRigTimeline(rig, retreatAt, reduceMotion ? 0 : BOOK_RETREAT_MS, false);
            });
        }
        runtime.rig.sinkTarget = 0;
        runtime.rig.sink = 0;
        runtime.rig.root.visible = true;
        // 书脚那圈接触阴影是"坐在板上"用的：书摊开悬在半空之后它就成了
        // 挂在书底下的一块灰斑（也让人以为书搁在地上）。检视态收掉，
        // 合书回到书架时由 layoutShelf / 每帧逻辑自动放回来。
        if (runtime.rig.contact) runtime.rig.contact.visible = false;
        // 书架那排木板（含前缘压条、背挡）在摊开的书底下会显得很怪，一起收掉。
        // 之前只收了 plank，我新加的前缘压条就留在画面底部 —— 用户看到的
        // 「书本展开后底部还有木条」就是它。
        if (shelf.plank) shelf.plank.visible = false;
        if (shelf.plankLip) shelf.plankLip.visible = false;
        // 背挡（walnut-back-rail）是**横在整面墙上的一条深色木条**，
        // 之前漏了它：搁板和压条都收掉之后，这条木条就孤零零地横在空屋子里 ——
        // 用户说的「书本展开后横条没有消失」就是它。收书时候再一起放回来。
        if (shelf.backRail) shelf.backRail.visible = false;
        // 立柱也收掉：书本检视态是特写，两侧留着两根木柱会像是"还在书架上"。
        // 参考实现是把整个 shelfStage 平移出画面（同一目的）。
        if (shelf.uprights) shelf.uprights.forEach(function (u) { u.visible = false; });
        // 左侧信息板向左缩回，把整幅舞台让给摊开的书
        els.root.classList.add('book-mode');

        // 书架上那套提示与地面阴影在书本模式下都不再成立，换掉/藏掉，
        // 否则会出现「书已经摊开了，底下还写着拖动浏览书架」这种错位提示
        var hint = els.stage.querySelector('.ms-stage-hint');
        if (hint) hint.textContent = '拖动空白处转动整间屋子，点右页城市条目看相册';
        var floor = els.stage.querySelector('.ms-floor');
        if (floor) floor.hidden = true;

        // 建贴图：只画"当前跨页 ±2 跨"那几页（见 paintBookPageWindow），其余留给
        // blank，翻到附近时再补画 —— 几十页一次全建出来太吃显存。
        // ⚠️ 如果这叠页正是 prepareBookPages 刚画过的那一份（同一个数组），
        // 就**别清空缓存**：清了以后要重画一遍，动画刚结束那一下页会先白一下。
        var freshPages = state.bookPages !== pages;
        if (freshPages) state.bookTextures = [];

        // 页序：pages[0] 是封面内侧那一页（扉页），从 pages[1] 起才排到叶上，
        // 每片叶承载「一页正面 + 一页背面」。这样第 0 个跨页就是「扉页 | 第一页」，
        // 一打开就能看到可点的城市列表，而不是先对着一张单独的封面页。
        var blank = blankPageTexture(three);
        var leafCount = Math.max(1, Math.ceil(Math.max(0, pages.length - 1) / 2));
        // 先按当前页集裁掉多余的叶，再补齐、再统一排站位（站位依赖片数）
        trimLeaves(runtime, leafCount);
        while (runtime.leaves.length < leafCount) addLeaf(three, runtime, runtime.leaves.length);
        layoutLeafStack(leafCount);
        // 同一叠页（prepareBookPages 刚画过）就别铺白了：留着的贴图正是动画里
        // 已经显示出来的那几张，铺白会让页在动画末尾先白一帧。
        if (freshPages) {
            applyFaceTexture({ mesh: runtime.insideMesh }, blank);
            // 后封内侧是**环衬**（纸），不贴内容页
            if (runtime.insideBackMesh) {
                applyFaceTexture({ mesh: runtime.insideBackMesh }, blank);
            }
            runtime.leaves.forEach(function (leaf) {
                applyFaceTexture(leaf.front, blank);
                applyFaceTexture(leaf.back, blank);
            });
        }
        runtime.leaves.forEach(function (leaf) {
            // 整叠往书脊处收一点，让每页的左边贴着书脊
            leaf.flex.targetCurve = 0.004;
            leaf.flex.targetTwist = 0;
            // 换页集时直接把姿态按新的跨页摆好，避免从上一本书的姿态飘过来
            var turned = leaf.index < state.bookSpread;
            leaf.pivot.rotation.y = turned
                ? LEAF_TURNED + leaf.index * 0.014
                : LEAF_UNTURNED + leaf.index * leafFanStep;
            leaf.pivot.position.z = turned ? leaf.turnedZ : leaf.restZ;
        });

        refreshBookSpread();
        setHeader(title, intro, crumb);

        if (els.prev) els.prev.hidden = true;
        if (els.next) els.next.hidden = true;
        syncPageCount(false);
        if (fromShelf) {
            // 别再硬把封面按回 0：从书架"抽出来"的那一秒里，架上的书本来就被
            // 掀开了一角（renderShelfStage 那段 -1.92）。这里归零的话，封面会
            // 先合上、再重新翻开 —— 用户看到的就是"放大过程中又翻了一次"。
            // 直接从当前角度接着往下开，动画才是连续的一下。
            var COVER_FULL = -Math.PI + COVER_TILT;
            state.bookOpen = COVER_FULL
                ? clamp(book.frontPivot.rotation.y / COVER_FULL, 0, 1)
                : 0;
            ensureViewReset();
            // 直接展开到第一页内容：不再要求用户先点一次封面。
            // bookOpen 从 0 补间到 1，所以掀封面这个动作仍然看得到，只是不用手点。
            state.openTarget = 1;
            state.coverHover = false;
            state.coverDrag = null;
            state.orbit = null;
            state.view = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
            // 记下这本书**此刻**的位姿：入场就是从这个位姿补间到检视态，
            // 中途没有尺寸突变、没有倾角突变，读起来就是「这一本滑到中间摊开」
            state.bookFrom = {
                x: runtime.group.position.x,
                y: runtime.group.position.y,
                z: runtime.group.position.z,
                scale: runtime.group.scale.x,
                rotX: runtime.group.rotation.x,
                rotY: runtime.group.rotation.y
            };
        }
    }



    function queuePagePhoto(texture, spec) {
        var d = api();
        if (!d) return;
        // 一页可能有**多张**照片（spec.shots）；封面/扉页那种单张的走 spec.photo。
        var jobs = [];
        if (spec.shots && spec.shots.length) {
            spec.shots.forEach(function (shot) {
                if (shot && shot.url && !shot.image) {
                    jobs.push({ get: function () { return shot.image; },
                        set: function (img) { shot.image = img; }, url: shot.url });
                }
            });
        } else if (spec.photo && !spec.image) {
            jobs.push({ get: function () { return spec.image; },
                set: function (img) { spec.image = img; }, url: spec.photo });
        }
        jobs.forEach(function (job) {
            var url = d.cityCardImageUrl(job.url) || job.url;
            var safe = d.canvasSafeImageUrl(url);
            if (!safe) return;
            var apply = function (image) {
                if (!image || job.get()) return;
                job.set(image);
                repaintTexture(texture, spec);
            };
            // 同源代理对慢图床有 15 秒超时，第一次 502 很常见；隔一会儿再试一次，
            // 免得相册里留下一个空页
            loadImage(safe).then(apply).catch(function () {
                setTimeout(function () {
                    loadImage(safe).then(apply).catch(function () { /* 还是拿不到就留白 */ });
                }, 2600);
            });
        });
    }

    function refreshBookSpread() {
        if (!book) return;
        // spread = 已经翻过去的叶数。每片叶的姿态由 updateBookTurn 每帧推向目标，
        // 这里只负责把数值夹到合法范围。
        state.bookSpread = Math.max(0, Math.min(state.bookSpread, bookSpreads() - 1));
        state.pageTurn = null;
        // 翻到新的一跨：把这一跨附近的页补画出来（城市内容都在同一本书里，
        // 一次全画太吃显存），同时把顶栏面包屑切到当前这座城市。
        paintBookPageWindow(state.bookPages, state.bookSpread);
        syncSpreadCityCrumb();
    }

    // 只画「当前跨页 ±2 跨」那几页。一本省的书可能有几十页（每座城市的内容都
    // 排在同一页集里），一次全画成 800×1128 的画布要几百 MB；按窗口画，
    // 内存有界，翻到别处再补画，用户完全看不出来。
    function paintBookPageWindow(pages, spread) {
        var three = shelf && shelf.THREE;
        if (!three || !book || !pages || !pages.length) return;
        var from = Math.max(0, spread * 2 - 4);
        var to = Math.min(pages.length - 1, spread * 2 + 5);
        for (var i = from; i <= to; i += 1) {
            if (state.bookTextures[i]) continue;
            var spec = pages[i];
            var texture = pageTextureFor(three, spec,
                (spec.kind || 'page') + ':' + (spec.title || '') + ':' + i);
            state.bookTextures[i] = texture;
            queuePagePhoto(texture, spec);
            applyPageTextureAt(i, texture);
        }
        // 窗口外的页**真的释放**。只补画不释放，"懒渲染"其实只省了首屏 ——
        // 一路翻到书尾，整本书的贴图都会留在显存里（34 页 ≈ 163MB）。
        // 窗口 = 当前跨 ±2 跨（10 页）；释放后的页翻回来会重画，
        // 而重画发生在它进入视野**之前**（翻一跨窗口整体移 2 页，新进的那两页
        // 当场补画），所以看不到白页。
        for (var j = 0; j < state.bookTextures.length; j += 1) {
            if (j >= from && j <= to) continue;
            var old = state.bookTextures[j];
            if (!old) continue;
            applyPageTextureAt(j, blankPageTexture(three));   // 先换回白纸，别留坏引用
            old._released = true;
            if (old.dispose) old.dispose();
            state.bookTextures[j] = null;
        }
    }

    // 第 i 页贴到哪儿：0 是封面内侧那面，其余按 (i-1) 落到第几片叶的正面/背面
    function applyPageTextureAt(index, texture) {
        if (!book) return;
        if (index === 0) {
            applyFaceTexture({ mesh: book.insideMesh }, texture);
            return;
        }
        var leaf = book.leaves[Math.floor((index - 1) / 2)];
        if (!leaf) return;
        applyFaceTexture((index - 1) % 2 === 0 ? leaf.front : leaf.back, texture);
    }

    // 顶栏面包屑跟着"现在翻到哪座城市"走：城市内容已经排进同一本书，
    // 不能再等换页集时才更新标题了。
    function syncSpreadCityCrumb() {
        if (!book) return;
        var pages = state.bookPages || [];
        // 城市名可能落在**跨页的任意一侧**（例如"城市章节 | 某城扉页"这一跨，
        // 城市在右页），所以两侧都要看。
        var left = pages[state.bookSpread * 2];
        var right = pages[1 + state.bookSpread * 2];
        // 跨页的两页可能属于不同层级：左边是上一座城市的最后一页、右边是新城市的
        // 扉页时，面包屑**跟右页走** —— 那是这次翻页刚到达、接下来要读的内容，
        // 而左页自己带着书眉（省名/城市名），信息不会丢。
        // ⚠️ city / spotName / cityPage 必须取自**同一页**，否则会出现
        // "城市已经是新的、足迹点还挂着上一座城的"这种错位。
        var main = right || left;
        var city = main && main.city;
        // 足迹点进面包屑的判据用 spec.spotName：点在它自己的**照片页**上也带着
        // 这个名字（只认 kind==='spot' 的话，一翻到照片页名字就会消失、来回翻一直抖）。
        var spotName = (main && main.spotName) || '';
        var cityPage = main && main.cityPage;
        // 用户要求：点省那段回到**目录页**（不是城市章节页），所以用 tocPage
        var tocPage = (left && left.tocPage !== undefined)
            ? left.tocPage : (right && right.tocPage);
        var province = state.province;
        if (!province) return;
        // 省那段也走"翻页过去"（和城市段一致）；拿不到页码时才退回原来的层级返回
        var crumb = [{ label: '世界这本书', to: 'shelf' }];
        crumb.push(tocPage !== undefined
            ? { label: province.name, to: 'page', page: tocPage, tag: '目 录' }
            : { label: province.name, to: 'chapters' });
        if (city && city.name) {
            // 城市那段可点：直接翻到这座城市的扉页
            crumb.push(cityPage !== undefined && cityPage !== state.bookSpread * 2
                ? { label: city.name, to: 'page', page: cityPage, tag: '旅行相册' }
                : { label: city.name });
        }
        if (spotName) crumb.push({ label: spotName, tag: '足迹点' });
        else if (crumb.length && crumb[crumb.length - 1].to) {
            // 当前这一段（省或市）补上层级后缀，一眼看出深度
            var last = crumb[crumb.length - 1];
            crumb[crumb.length - 1] = { label: last.label, tag: last.tag };
        }
        state.city = city || null;
        var titleText = spotName
            ? spotName + ' · 足迹点'
            : (city && city.name ? city.name + ' · 旅行相册' : province.name + ' · 城市章节');
        // ⚠️ 副标题**不能传空串**：<p> 没有内容就不生成行盒，高度从 18px 掉到 0，
        // 顶栏随之变矮，下面的画布/书本跟着重排 —— 用户看到的就是"翻页时提示突然
        // 消失、屏幕突然变大"。这里按当前层级给对应的引导语（本来副标题就是这个用途）。
        var introText = spotName
            ? '左右翻页看这个足迹点的照片；点上面的城市名可以跳回这座城。'
            : (city && city.name
                ? '左右翻页看照片；点上面的「' + province.name + '」回到目录。'
                : '点右页的城市条目，翻开它的旅行相册。');
        setHeader(titleText, introText, crumb);
    }


    function bookSpreads() {
        // 返回的是**跨页总数**，合法索引是 0 .. 总数-1。
        // 第 s 个跨页 = 左 pages[2s] | 右 pages[1+2s]（pages[0] 印在封面内侧）。
        // 能翻到的最大 s 是「左页还在」的最大 s：2s <= P-1 → floor((P-1)/2)，
        // 加 1 就是总数。原来写的是 ceil((P-1)/2)，P 为偶数时正好多一跨 ——
        // 于是「最后有内容的那一跨」之后还能再翻一页全白的纸。
        var pages = (state.bookPages || []).length;
        return Math.max(1, Math.floor((pages + 1) / 2));
    }

    // 翻到"第 pageIndex 页"所在的那一跨。
    // 近处（1~2 跨）就正常逐页翻过去；远处先把中间那些跨**直接过去**
    // （几十页逐页播动画要翻半分钟），只在最后留一页做可见的落页动画 ——
    // 观感就是"书自动翻到那一页"。
    // 把每一片叶直接摆到它该在的姿态（翻过的落左、没翻的留右），**不走阻尼**。
    // 多跳时专用：阻尼会让叶子一格一格飘过中间那几跨，看着像"先到城市页再跳到足迹页"。
    function snapLeafPoses() {
        if (!book) return;
        var step = turnedFanStep();
        book.leaves.forEach(function (leaf) {
            var turned = leaf.index < state.bookSpread;
            leaf.pivot.rotation.y = turned
                ? LEAF_TURNED + leaf.index * step
                : LEAF_UNTURNED + leaf.index * leafFanStep;
            leaf.pivot.position.z = turned ? leaf.turnedZ : leaf.restZ;
        });
    }

    function turnToPage(pageIndex) {
        if (!book) return;
        var target = Math.max(0, Math.min(bookSpreads() - 1, Math.floor((pageIndex || 0) / 2)));
        var guard = 0;
        var step = function (forward) {
            if (forward && Math.abs(target - state.bookSpread) > 1) {
                state.pageTurn = null;
                state.bookSpread += 1;
                refreshBookSpread();
                // ⚠️ 多跳时必须把叶子姿态**直接吸附到位**：姿态平时是每帧阻尼追的，
                // 连着改几跨的话叶子会一格一格飘过去 —— 用户看到的就是
                // "先跳到城市页、再突然到足迹页"。吸附之后只剩最后一跨的翻页动画。
                snapLeafPoses();
                return true;
            }
            if (!forward && Math.abs(target - state.bookSpread) > 1) {
                state.pageTurn = null;
                state.bookSpread -= 1;
                refreshBookSpread();
                snapLeafPoses();
                return true;
            }
            // 最后一跨：起一次真正的翻页，交给 updateBookTurn 播完（可见的落页）
            if (state.pageTurn) return false;
            if (!beginPageTurn(forward)) return false;
            settlePageTurn(true);
            return true;
        };
        while (state.bookSpread < target && guard < 400) {
            if (!step(true)) break;
            guard += 1;
        }
        while (state.bookSpread > target && guard < 400) {
            if (!step(false)) break;
            guard += 1;
        }
        announceSpread();
    }

    // 翻页：同样由「进度 p」驱动。p=0 停在右侧，p=1 完全落到左侧。
    // 拖拽时直接写 p（1:1 跟手），松手后补间到 1 或弹回 0。
    // 要翻的是哪一片：往前翻时是当前右页所在的那片，往回翻时是左边最上面那片。
    function leafForTurn(forward) {
        return forward ? state.bookSpread : state.bookSpread - 1;
    }

    // 把"还在落位路上"的那一次翻页立刻收尾，好让新的拖拽马上开始：
    //   - 目标是翻过去（target=1）→ 直接把页集推到位，剩下的姿态交给每帧阻尼收；
    //   - 目标是弹回来（target=0）→ 直接丢掉，那一片会自己阻尼回原位。
    // 没有这一步的话，一次点击（会起一次行程为 0 的翻页）之后要等它弹回完，
    // 期间再也拖不动下一页 —— 快速连翻就废了。
    function settleTurnNow() {
        var t = state.pageTurn;
        if (!t) return;
        state.pageTurn = null;
        if (t.target === 1) {
            state.bookSpread += t.forward ? 1 : -1;
            refreshBookSpread();
            announceSpread();
        }
    }

    function beginPageTurn(forward) {
        if (!book || state.mode !== 'book' || state.pageTurn) return false;
        var next = state.bookSpread + (forward ? 1 : -1);
        if (next < 0 || next >= bookSpreads()) return false;
        var leafIndex = leafForTurn(forward);
        if (leafIndex < 0 || leafIndex >= book.leaves.length) return false;
        state.pageTurn = {
            forward: forward, p: 0, target: 0, dragging: true,
            leafIndex: leafIndex, speedResponse: 0, verticalBias: 0
        };
        return true;
    }

    function dragPageTurn(p, options) {
        var t = state.pageTurn;
        if (!t) return;
        t.p = clamp(p, 0, 1);
        t.target = t.p;
        if (options) {
            t.speedResponse = clamp(options.speedResponse || 0, 0, 1);
            t.verticalBias = clamp(options.verticalBias || 0, -1, 1);
        }
    }

    function settlePageTurn(complete) {
        var t = state.pageTurn;
        if (!t) return;
        // 拖拽翻页走的是这里（不经过 turnBookPage），所以音效要在这也挂一次：
        // 只有"这次真的翻过去"才出声，拖到一半又收回来的不算。
        if (complete) playCue('page', { rate: t.forward ? 1 : 0.93 });
        t.dragging = false;
        t.target = complete ? 1 : 0;
    }

    function turnBookPage(step) {
        // 参考对翻页做了音高区分：往回翻 0.93 倍速（更低沉）
        playCue('page', { rate: step > 0 ? 1 : 0.93 });
        if (!book || state.mode !== 'book') return;
        // 上一次翻页还在落位：立刻收尾，连续按方向键也能一页一页跟得上
        settleTurnNow();
        var forward = step > 0;
        if (!beginPageTurn(forward)) return;
        if (reduceMotion) {
            state.bookSpread += forward ? 1 : -1;
            state.pageTurn = null;
            refreshBookSpread();
            announceSpread();
            return;
        }
        state.pageTurn.dragging = false;
        state.pageTurn.target = 1;
    }

    // 每帧：封面开合 + 每片叶的姿态与柔性
    function updateBookTurn(delta) {
        if (!book) return;
        syncViewReset();
        var THREE = shelf.THREE;
        var spread = state.bookSpread;
        var active = state.pageTurn;

        if (active && !active.dragging) {
            // 松手后的补间只保留这一级（pivot 直接由 p 推出）。
            // 阻尼速度照 complete-shelf 取 10.5，和叶子的 LEAF_SPEED 同一档 ——
            // 之前用的 14 比它快一档，落页显得急。
            active.p = THREE.MathUtils.damp(active.p, active.target, 10.5, delta);
            if (active.target === 1 && active.p > 0.994) {
                state.bookSpread += active.forward ? 1 : -1;
                state.pageTurn = null;
                active = null;
                // 落页：补画新跨页附近的页，并把顶栏面包屑切到当前这座城市
                // （城市内容已经排在同一本书里，标题得跟着翻页走）
                refreshBookSpread();
            } else if (active.target === 0 && active.p < 0.006) {
                state.pageTurn = null;
                active = null;
            }
        }

        // 封面开合：拖拽时 1:1 跟手；否则补间到目标；合着时悬停会微微裂开一线
        if (state.coverDrag) {
            state.bookOpen = state.coverDrag.p;
        } else {
            var coverTarget = state.openTarget;
            if (state.coverHover && state.openTarget < 0.02) coverTarget = 0.06;
            state.bookOpen = THREE.MathUtils.damp(state.bookOpen, coverTarget, 8, delta);
        }
        // 掀开的角度从 0.055 收到 0.02：0.055 的倾角会让封面**远边**在 z 上
        // 抬起 1.5 × sin(0.055) ≈ 0.082（从 0.202 抬到约 0.284），而翻过去的纸
        // 落在 0.206 —— 于是纸被压在封面远边之下，从侧面看就是纸穿进封面里。
        book.frontPivot.rotation.y = (-Math.PI + COVER_TILT) * state.bookOpen;

        book.leaves.forEach(function (leaf) {
            var isTurned = leaf.index < state.bookSpread;
            var unturned = LEAF_UNTURNED + leaf.index * leafFanStep;
            var turned = LEAF_TURNED + leaf.index * turnedFanStep();
            var target = isTurned ? turned : unturned;
            var zTarget = isTurned ? leaf.turnedZ : leaf.restZ;
            // 静止时几乎放平：叶只要有静态拱形，靠封面那面就会被顶穿，
            // 拱形只在真正翻页的过程中才起
            var curveTarget = 0.004;
            var twistTarget = 0;
            var draggingThis = false;

            if (active && active.leafIndex === leaf.index) {
                draggingThis = true;
                var eased = smoothstep(active.p);
                target = active.forward
                    ? lerp(unturned, turned, eased)
                    : lerp(turned, unturned, eased);
                // z 跟着**角度**走，并且**必须在转过 45°~90° 这段里就升到左叠之上**。
                // 线性插值的话，纸转到 90° 时 z 才走到一半（≈0.1805），
                // 而摊开封面那块板占的厚度区间是 0.17~0.202 —— 正好穿在里面。
                // 一路拖到底时这个区间一闪而过；**中途松手**则纸会在这个角度
                // 附近慢下来，穿模就一直看得见。
                var angleProgress = clamp(Math.abs(target) / Math.PI, 0, 1);
                var lift = clamp((angleProgress - 0.25) / 0.25, 0, 1);
                zTarget = lerp(leaf.restZ, leaf.turnedZ, lift);
                // 翻得越快纸拱得越高；左右拖动的纵向偏差变成纸的扭转
                var envelope = Math.sin(Math.PI * clamp(active.p, 0, 1));
                // 拖动时纸拱得更高：0.032→0.05、速度项 0.064→0.09
                // 拖动：用同一条不换向的包络（half 段起拱快、后半段收得快）
                curveTarget = 0.004 + curlEnvelope(active.p) *
                    (0.08 + active.speedResponse * 0.1);
                twistTarget = envelope * active.verticalBias * 0.08;
            }
            // 曾经这里还给「刚翻过去、落在左边」的那一片单独加 0.02 的余韵。
            // 那是错的：翻过去之后叶自己的 +z 已经指向书里，0.02 的拱会把它的
            // 「肚子」按进下面的纸叠和封面里 —— 页数一多，下面那厚厚一叠就会
            // 从上一层纸里透出来（用户看到的「翻几页之后开始穿模」）。
            // complete-shelf 没有这个特例，落页后拱形只由转角推出来，自然回平。

            if (draggingThis) {
                // 正在翻的这一片**直接赋值，不做二次阻尼**。
                // 之前是「进度 p 阻尼一次、pivot 再阻尼一次」，两级滞后叠加，
                // 手感就是拖起来黏、松手后回弹慢 —— 这是「不丝滑」的主因。
                leaf.pivot.rotation.y = target;
                leaf.pivot.position.z = zTarget;
            } else {
                // 照 complete-shelf：目标姿态要**乘封面开合度 amount**。
                // 封面合上（amount=0）时每片纸都摊平归位，所以不会斜着插进封面里 ——
                // 这就是「合上封面后第一页穿模」的根因。
                var amount = state.bookOpen;
                leaf.pivot.rotation.y = THREE.MathUtils.damp(
                    leaf.pivot.rotation.y, target * amount, LEAF_SPEED, delta);
                var wantZ = leaf.restZ + (zTarget - leaf.restZ) * amount;
                leaf.pivot.position.z = THREE.MathUtils.damp(
                    leaf.pivot.position.z, wantZ, LEAF_SPEED, delta);
            }
            // 纸的凸起由**叶自己的转角**推出来（不是拖拽进度）：
            // 转到一半拱得最高，落页后回平 —— 这就是开关封面时的「下压 / 凸起」。
            var turnProgress = clamp(Math.abs(leaf.pivot.rotation.y) / Math.PI, 0, 1);
            // 拖拽时**再多拱一截**（照参考的 dragCurveBoost = 0.032 + speedResponse*0.064）：
            // 之前只有 sin 那 0.082，纸是"挺"着翻过去的，几乎没有弧。
            // 松手后这一截会自己衰减掉（dragging 变 false），纸再回落 —— 和参考一致。
            var curveBoost = 0;
            if (active && active.dragging) {
                // ⚠️ 必须再乘**这一叶自己的转角包络**（sin(π·turnProgress)）：
                // 不然这一项对所有叶一视同仁，平放着的那些页也会一起鼓起来
                // （用户报的"翻页时所有的页都改变弧度了"）。
                // 参考实现里它乘的是每张纸自己的 amount，同理。
                curveBoost = (0.032 + clamp(active.speedResponse || 0, 0, 1) * 0.064)
                    * Math.sin(Math.PI * turnProgress);
            }
            var curveFromTurn = state.bookOpen *
                // 纸的拱形由**这一叶自己的转角**推出来（0.082→0.13）：
                // 原来峰值只有页宽的 6%，而且只出现在转到 90° 那一小段，
                // 观感上"完全感觉不到弧度"（用户反馈）。参考实现的纸是明显的一张
                // C 形，这里把幅度提到约 10%，配合下面的 sin 包络首末自动归零。
                // ⚠️ 拱形要在**整段翻页**里都看得出来，不能只在 90° 附近闪一下：
                // sin(π·t) 的峰很尖，0.3 秒的翻页里可见窗口不到 0.1 秒，观感就是
                // "没有弧度"。这里用 pow(sin, 0.55) 把包络压胖（两端仍然归零，
                // 所以落页姿态不变），幅度 0.13 → 0.2。
                (0.004 + curlEnvelope(turnProgress) * 0.2 + curveBoost);
            leaf.flex.targetCurve = Math.max(curveTarget, curveFromTurn);
            leaf.flex.targetTwist = twistTarget;
            // ⚠️ 收尾阶段**直接钳掉弹簧滞后**：弹簧的速度上限只有 1.8/s，
            // 最后那点转角里根本收不完 —— 纸会带着约 0.1 的弧度落到左叠上、
            // 顶进后面那几张（用户报的"翻到左边穿模一下、随后恢复"），
            // 而"恢复"正是弹簧事后慢慢追回来。转角过了 0.6π（弧度已按
            // curlEnvelope 收到 0）就直接令 curve = target，不再有滞后。
            if (turnProgress > 0.6) {
                leaf.flex.curve = leaf.flex.targetCurve;
                leaf.flex.curveVelocity = 0;
                leaf.flex.twist = leaf.flex.targetTwist;
                leaf.flex.twistVelocity = 0;
            }
            updateLeafFlex(leaf, delta);
        });
    }

    function exitBookMode() {
        state.mode = 'shelf';
        setPhase('shelf');
        state.pageTurn = null;
        state.bookLevel = 'chapters';
        if (book) {
            // 把每一片叶都收回未翻姿态。翻到左边的叶如果不收回，就会留在
            // 闭合的书外面 —— 这正是「Esc 关掉之后原来的精选书也穿模」的原因。
            book.leaves.forEach(function (leaf) {
                // 必须归 0，**不能**留那个扇开角。
                // 扇开角只在书摊开时才存在（它乘了封面开合度）；合上封面时
                // complete-shelf 把 amount 归零，所有页一律放平。
                // 之前这里留着 -0.038 + index×0.008，第 0 片前倾 0.038 rad，
                // 页宽 1.426 的自由边因此前移 0.054（0.155 → 0.209），
                // 直接顶穿封面（外表面才 0.202）—— 就是「关闭后封面穿模」。
                leaf.pivot.rotation.y = 0;
                leaf.pivot.position.z = leaf.restZ;
                leaf.flex.curve = 0.004;
                leaf.flex.twist = 0;
                leaf.flex.curveVelocity = 0;
                leaf.flex.twistVelocity = 0;
                leaf.flex.targetCurve = 0.004;
                leaf.flex.targetTwist = 0;
                deformLeaf(leaf);
            });
            // 封面也要合回去（书架模式下 updateBookTurn 不再运行）
            book.frontPivot.rotation.y = 0;
            // 不用手动隐藏：rig.root 的可见性交回 layoutShelf（它就是书架上那本）
            book.group.visible = true;
        }
        state.bookSpread = 0;
        if (shelf && shelf.plank) shelf.plank.visible = true;
        if (shelf && shelf.plankLip) shelf.plankLip.visible = true;
        if (shelf && shelf.backRail) shelf.backRail.visible = true;
        if (shelf && shelf.uprights) shelf.uprights.forEach(function (u) { u.visible = true; });
        // 书列归位：不在这里硬抬回架上，交给 layoutShelf 那条确定时间线
        // （从架下升回来，末帧精确落在各自的位置上）
        if (shelf) {
            shelf.rigs.forEach(function (rig) {
                rig.sinkTarget = 0;
            });
        }
        state.bookOpen = 0;
        state.closing = null;
        state.openTarget = 0;
        state.coverHover = false;
        state.coverDrag = null;
        state.orbit = null;
        state.bookDrag = null;
        state.closing = null;
        state.view = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
        // 复位按钮的显隐是 updateBookTurn 每帧算的，而书架模式下那个函数不再运行，
        // 所以它会把「可见」的状态一直挂在画面上（用户看到的：Esc 关书之后
        // 右下角那颗「复位视角」还赖着不走）。这里手动收一次。
        syncViewReset();
        if (els.root) els.root.classList.remove('book-mode');
        var hint = els.stage && els.stage.querySelector('.ms-stage-hint');
        // 回到书架：底部那句提示不再恢复（顶栏副标题里已经有同一句）
        if (hint) hint.textContent = '';
        var floor = els.stage && els.stage.querySelector('.ms-floor');
        if (floor) floor.hidden = false;
        if (shelf) layoutShelf(false);
        // 强制重绘一次 canvas：退出书本模式时，信息板与画布都在做合成层切换，
        // 过渡结束的瞬间偶尔会在画布边缘留下几像素的残影（用户看到的就是
        // 「一圈很窄的褐色」，点一下别处触发重绘就消失）。
        // resizeShelf 会重设画布尺寸并清空后备缓冲，等于强制整幅重画。
    }


    var CLOSE_MS = 620;

    // 合书：和翻开对称的一段动画 —— 封面合上、翻过去的叶全部翻回来、
    // 整本书滑回它在书架上的位置，走完再执行收尾动作。
    function beginClose(after) {
        if (state.mode !== 'book' || !book || reduceMotion) {
            if (state.mode === 'book') exitBookMode();
            after();
            return;
        }
        state.openTarget = 0;
        state.bookSpread = 0;
        state.pageTurn = null;
        state.coverDrag = null;
        state.coverHover = false;
        state.orbit = null;
        state.bookDrag = null;
        setPhase('closing');
        playCue('close');
        // 「复位视角」按钮只在检视态有意义：合书一开始就收掉，
        // 否则它会跟着那 620ms 的关闭动画一起挂在右下角。
        var resetBtn = $('msViewReset');
        if (resetBtn) resetBtn.hidden = true;
        // **合书动画一开始**就把焦点从舞台上挪走。
        // 舞台是「点击打开书」时获得焦点的，随后按 Esc 是键盘操作，
        // 浏览器据此把 :focus-visible 判为匹配 —— 于是整个 620ms 的关闭过程中，
        // 画布四周都挂着那圈 2px 的强调色描边。等到动画结束再移焦点已经晚了。
        if (els.back && els.back.focus && document.activeElement === els.stage) {
            els.back.focus({ preventScroll: true });
        }
        state.closing = {
            started: performance.now(),
            from: {
                x: book.group.position.x, y: book.group.position.y, z: book.group.position.z,
                scale: book.group.scale.x,
                rotX: book.group.rotation.x, rotY: book.group.rotation.y
            },
            // 相机也可能已经被用户绕着转走了：连它一起记下来，
            // 否则合书那一刻画面会"啪"地跳回棚位
            fromCam: { x: camPlan.pos.x, y: camPlan.pos.y, z: camPlan.pos.z },
            fromTarget: { x: camPlan.target.x, y: camPlan.target.y, z: camPlan.target.z },
            after: after
        };
    }

    function updateClosing() {
        var closing = state.closing;
        if (!closing || !book) return false;
        var t = Math.min(1, (performance.now() - closing.started) / CLOSE_MS);
        var eased = t * t * (3 - 2 * t);
        var layout = shelfLayout();
        var shelfScale = 1.14;
        // 合书要落回**这一本自己**在书架上的位姿：高度不同的书落点也不同
        var halfH = ((book.rig && book.rig.dims) ? book.rig.dims.height : BOOK_H) / 2;
        var from = closing.from;
        book.group.scale.setScalar(lerp(from.scale, shelfScale, eased));
        book.group.rotation.x = lerp(from.rotX, 0, eased);
        book.group.rotation.y = lerp(from.rotY, 0, eased);
        book.group.position.set(
            lerp(from.x, layout.activeX, eased),
            lerp(from.y, PLANK_TOP + halfH * shelfScale, eased),
            lerp(from.z, 0, eased)
        );
        // 相机回到棚位（和书同一条时间线、同一个缓动，末帧精确）
        var camFrom = closing.fromCam;
        if (camFrom) {
            camPlan.pos.x = lerp(camFrom.x, 0, eased);
            camPlan.pos.y = lerp(camFrom.y, 0.42, eased);
            camPlan.pos.z = lerp(camFrom.z, CAMERA_Z, eased);
            var tgtFrom = closing.fromTarget || { x: 0, y: 0.42, z: BOOK_Z };
            camPlan.target.x = lerp(tgtFrom.x, 0, eased);
            camPlan.target.y = lerp(tgtFrom.y, 0.3, eased);
            camPlan.target.z = lerp(tgtFrom.z, 0, eased);
        }
        if (t >= 1) {
            // 收尾时把这本书**精确**摆回它在书架上的位姿，而不是留给阻尼去慢慢逼近。
            // 阻尼永远只逼近不相等，残留的那点偏差会让书投射在木板上的阴影跟着变 ——
            // 而木板是画面里唯一的褐色大面，用户看到的就是「书周围多出一圈褐色」。
            book.group.scale.setScalar(shelfScale);
            book.group.rotation.set(0, 0.16, 0);
            // z 必须跟 layoutShelf 给当前书的目标一致（0.35），
            // 之前收尾写的是 0，于是关闭后那本书还得多走一段才回到位。
            book.group.position.set(layout.activeX, PLANK_TOP + halfH * shelfScale, 0.35);
            var after = closing.after;
            state.closing = null;
            exitBookMode();
            if (after) after();
        }
        return true;
    }

    // 点到某一行 → 进那座城市的相册。返回 { spec, index }：调用方要知道点中的是
    // **哪一页**（右页 = 当前这片叶的正面 pages[1+2s]；左页 = 上一片的背面 pages[2s]）。
    // 以前只认右页，于是"城市列表页落在左页"时点不动 —— 加了目录页之后列表正好在左页。
    function pickRowHit(event) {
        if (!book || !shelf || state.mode !== 'book') return null;
        var rect = els.stage.getBoundingClientRect();
        var pointer = new shelf.THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        shelf.raycaster.setFromCamera(pointer, shelf.camera);
        var candidates = [
            { leaf: book.leaves[state.bookSpread], face: 'front',
              pageIndex: 1 + state.bookSpread * 2 },
            { leaf: book.leaves[state.bookSpread - 1], face: 'back',
              pageIndex: state.bookSpread * 2 }
        ];
        for (var i = 0; i < candidates.length; i += 1) {
            var c = candidates[i];
            var spec = (state.bookPages || [])[c.pageIndex];
            if (!c.leaf || !spec || !spec.rows || !spec.rows.length) continue;
            var mesh = c.leaf[c.face] && c.leaf[c.face].mesh;
            if (!mesh) continue;
            var hits = shelf.raycaster.intersectObject(mesh, false);
            if (!hits.length || !hits[0].uv) continue;
            var canvasY = (1 - hits[0].uv.y) * 564;
            // 优先用页面记下的**逐行上下沿**：目录页的行高不统一（城市行高、足迹点矮），
            // 用一个统一行距反推会点错行。没有这张表的老页面再退回"起点 + 行距"。
            if (spec.rowTops && spec.rowTops.length === spec.rows.length) {
                var hitRow = -1;
                var nearest = -1;
                var nearestGap = 1e9;
                for (var r = 0; r < spec.rowTops.length; r += 1) {
                    var top = spec.rowTops[r][0];
                    var bottom = spec.rowTops[r][1];
                    if (canvasY >= top && canvasY < bottom) {
                        hitRow = r;
                        break;
                    }
                    // 记一下最近的一行：行高不统一（城市行 34 / 足迹点行 22）时，
                    // 点按换算出的 y 常常落在两行的缝里或压在行的边线上，
                    // 只认"严格落在行内"会让整页偶发点不动。
                    var gap = canvasY < top ? top - canvasY : canvasY - bottom;
                    if (gap < nearestGap) { nearestGap = gap; nearest = r; }
                }
                if (hitRow >= 0) return { spec: spec, index: hitRow };
                // 容差吸附：半个行高以内就算点在这一行上（最大 26 逻辑 px）
                if (nearest >= 0 && nearestGap <= 26) return { spec: spec, index: nearest };
                // 落在行与行之间的缝里（行高不同、边界取整）：不要就此放弃，
                // 继续用"起点 + 行距"兜一次，免得整页点不动。
            }
            var pitch = spec.rowPitch || 54;
            var index = Math.floor((canvasY - (spec.rowsTop + 20)) / pitch + 0.5);
            if (index >= 0 && index < spec.rows.length) return { spec: spec, index: index };
        }
        return null;
    }

    // 顶栏标题是一条**面包屑**：从「世界这本书」到当前所在的省 / 市。
    // crumb 是路径上的名字数组，最后一段是当前位置（加粗、不可点）；前面的段带了
    // to 就渲染成可点的返回入口（to: 'shelf' 回书架 | 'chapters' 回城市章节）。
    // 这样"我在哪、怎么回去"都集中在一处，不用在顶栏 / 页内工具条里各放一颗
    // 长得差不多、做的事情也差不多的返回按钮。
    // 不传 crumb 的调用点（比如加载占位）就退回纯文本标题，行为与以前一致。
    function setHeader(title, intro, crumb) {
        if (els.title) {
            if (crumb && crumb.length) {
                els.title.innerHTML = crumb.map(function (item, index) {
                    var last = index === crumb.length - 1;
                    var sep = index ? '<span class="ms-crumb-sep" aria-hidden="true">›</span>' : '';
                    if (last) {
                        // ④ 当前段带一个很淡的层级后缀（城市章节 / 旅行相册 / 足迹点），
                        // 一眼看出现在在第几层；后缀不参与朗读（aria-hidden）
                        var tag = item.tag
                            ? '<span class="ms-crumb-tag" aria-hidden="true">' + esc(item.tag) + '</span>'
                            : '';
                        return sep + '<span class="ms-crumb-current" aria-current="page">' +
                            esc(item.label) + tag + '</span>';
                    }
                    return sep + '<button class="ms-crumb-link" type="button" data-ms-crumb="' +
                        esc(item.to || '') + '" data-ms-page="' +
                        (item.page === undefined ? '' : item.page) + '" aria-label="返回' + esc(item.label) + '">' +
                        esc(item.label) + '</button>';
                }).join('');
                els.title.querySelectorAll('[data-ms-crumb]').forEach(function (node) {
                    node.addEventListener('click', function () {
                        var to = node.getAttribute('data-ms-crumb');
                        if (to === 'shelf') backToShelf();
                        else if (to === 'chapters') backToChapters();
                        else if (to === 'page') {
                            // 面包屑里的城市段：直接翻到这座城市的那一页（不换页集）
                            var page = Number(node.getAttribute('data-ms-page'));
                            if (!isNaN(page)) turnToPage(page);
                        }
                    });
                });
            } else {
                els.title.textContent = title;
            }
        }
        if (els.intro) els.intro.textContent = intro;
        // 标题变化 = 层级切换，一并播报给读屏
        if (title) announce(title + (intro ? '。' + intro : ''));
    }

    // 这里原本有一颗顶栏的「‹ 返回城市章节」（只在旅行相册里出现）。它和页内
    // 工具条的返回按钮、以及顶栏面包屑做的是同一件事，一并去掉了 —— 现在"上一层"
    // 只有一个入口：顶栏面包屑里点当前路径的上一段（见 setHeader）。


    var lastFocus = null;

    function open() {
        if (!els.root || els.root.classList.contains('show')) return;
        if (!enabled()) return;
        var d = api();
        if (!d) {
            console.warn('世界这本书：没有拿到 FootprintMemoryData，先跳过');
            return;
        }

        state.books = buildBookList();
        state.active = 0;
        preloadCoverPhotos();      // 后台把封面照片拉下来，翻开第一本书时就有图
        state.level = 'shelf';
        state.opening = false;
        state.bookRotation = null;
        state.page = 0;

        setHeader('世界这本书', '正在整理省份、城市与旅行照片…', [{ label: '世界这本书' }]);
        els.body.innerHTML = '<div class="ms-empty"><span>正在装订书架…</span>' +
            '<div class="ms-loading-bar"><i></i></div></div>';

        els.root.classList.add('show');
        els.root.setAttribute('aria-hidden', 'false');
        if (d.setOverlayHidden) d.setOverlayHidden(els.root, false);
        document.body.classList.add('memory-shelf-open');
        syncShelfUrl(true);
        if (d.setGlobeRenderLoop) d.setGlobeRenderLoop(false);
        lastFocus = document.activeElement;
        if (els.back) els.back.focus({ preventScroll: true });

        if (!state.books.length) {
            showEmpty();
            return;
        }

        ensureThree().then(function () {
            if (!els.root.classList.contains('show')) return;
            renderShelfStage();
        }).catch(function (error) {
            console.warn('three.js 不可用，改用 CSS 书架：', error);
            if (!els.root.classList.contains('show')) return;
            renderFallbackShelf();
        });
    }

    function close() {
        if (!els.root || !els.root.classList.contains('show')) return;
        // 在书本模式里关闭：先播合书动画，动画走完再真正收摊
        if (state.mode === 'book' && !state.closing) {
            document.body.classList.remove('memory-shelf-open');
            var apiEarly = api();
            if (apiEarly && apiEarly.setGlobeRenderLoop) apiEarly.setGlobeRenderLoop(true);
            beginClose(function () { closeNow(); });
            return;
        }
        closeNow();
    }

    function closeNow() {
        if (!els.root || !els.root.classList.contains('show')) return;
        // 先把页面级的东西复原。这一步放在最前面：万一后面的退出动画/清理
        // 中途抛错，也不会把 body 上的类留着 —— 那会让整个页面顶栏消失、
        // 布局错乱，也就是「关闭后整个页面样式出问题」。
        document.body.classList.remove('memory-shelf-open');
        var apiRef = api();
        if (apiRef && apiRef.setGlobeRenderLoop) apiRef.setGlobeRenderLoop(true);
        // 如果是在「书本模式」里直接关掉，必须先退出书本模式。
        // 否则 #memoryShelf 上的 book-mode 类会留到下一次打开：信息板一进来就是
        // 收起状态（左侧没有省份信息）、舞台直接是拉满的 1440、书的位置也就全错了。
        if (state.mode === 'book') exitBookMode();
        clearTimer('open');
        clearTimer('album');
        clearTimer('info');
        clearTimer('bookTurn');
        hidePhoto();
        disposeShelf();

        els.root.classList.remove('show');
        els.root.setAttribute('aria-hidden', 'true');
        var d = api();
        if (d && d.setOverlayHidden) d.setOverlayHidden(els.root, true);
        document.body.classList.remove('memory-shelf-open');
        if (d && d.setGlobeRenderLoop) d.setGlobeRenderLoop(true);
        syncShelfUrl(false);

        state.level = 'shelf';
        state.mode = 'shelf';
        if (els.root) els.root.classList.remove('book-mode');
        state.bookLevel = 'chapters';
        state.pageTurn = null;
        state.photoList = [];
        state.books = [];
        state.province = null;
        state.city = null;
        state.photos = [];
        state.page = 0;
        state.opening = false;
        state.turning = false;
        state.bookRotation = null;
        els.body.innerHTML = '';

        if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') {
            lastFocus.focus({ preventScroll: true });
        }
        lastFocus = null;
    }

    function showEmpty() {
        els.body.innerHTML =
            '<div class="ms-empty">' +
              '<strong>书架上还没有书</strong>' +
              '<span>点亮第一座城市，它就会成为这里的第一本。</span>' +
              '<button id="msEmptyClose" type="button">回到地图</button>' +
            '</div>';
        var button = $('msEmptyClose');
        if (button) button.addEventListener('click', close);
    }

    function onEscape() {
        if (photoOpen()) { hidePhoto(); return; }
        if (state.mode === 'book') {
            if (state.bookLevel === 'album') { openChapters(state.province); return; }
            backToShelf();
            return;
        }
        if (state.level === 'album') { backToChapters(); return; }
        if (state.level === 'chapters') { backToShelf(); return; }
        close();
    }

    function onKeydown(event) {
        // 挂在 document 上：视图重绘会把焦点元素换掉，焦点掉回 body 之后
        // 挂在覆盖层上的监听就收不到按键了（Esc 会彻底失灵）。
        if (!els.root || !els.root.classList.contains('show')) return;
        if (event.key === 'Escape') {
            event.stopPropagation();
            onEscape();
            return;
        }
        // 已翻开的书：左右方向键翻页
        if (state.mode === 'book') {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                turnBookPage(-1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                turnBookPage(1);
            }
            return;
        }
        // 书架层：方向键翻书。放在根节点统一处理，这样焦点落在「关闭」「上一本」
        // 或画布上都能用，不必要求用户先点一下书架。
        if (state.level === 'shelf') {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setActive(state.active - 1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                setActive(state.active + 1);
            } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                // 焦点在按钮上时把 Enter/空格让给按钮本身，否则会连带翻开当前的书
                var onButton = event.target && event.target.closest && event.target.closest('button');
                if (!onButton) {
                    event.preventDefault();
                    openActiveBook();
                }
            }
            return;
        }
        if (state.level === 'album') {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                if (photoOpen()) stepPhoto(-1); else turnAlbum(-1);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                if (photoOpen()) stepPhoto(1); else turnAlbum(1);
            }
            return;
        }
        if (state.level === 'chapters' && event.key === 'Backspace') {
            event.preventDefault();
            backToShelf();
        }
    }

    // 入口只在桌面端出现（决策 13）：非触摸 + 宽度 >= 821
    function syncEntry() {
        var on = enabled();
        if (els.btn) els.btn.hidden = !on;
        if (!on && els.root && els.root.classList.contains('show')) close();
    }

    // ---------------- 直达链接（与票根册的 ?view=tickets 同一套做法） ----------------
    // /footprints?view=books 直接进入「世界这本书」；打开时把地址推成这个参数，
    // 关闭时替换回不带参数的地址，浏览器前进/后退也能来回切。
    function isBooksView() {
        try {
            return new URLSearchParams(window.location.search).get('view') === 'books';
        } catch (e) {
            return false;
        }
    }

    function syncShelfUrl(open) {
        try {
            if (open) {
                if (!isBooksView()) {
                    history.pushState({ memoryShelf: true }, '', window.location.pathname + '?view=books');
                }
            } else if (isBooksView()) {
                // 用 replaceState：关闭不该再压一条历史，否则 Back 会卡在"关着的书库"上
                var params = new URLSearchParams(window.location.search);
                params.delete('view');
                var rest = params.toString();
                history.replaceState({}, '', window.location.pathname + (rest ? '?' + rest : ''));
            }
        } catch (e) { /* 某些内嵌环境不允许改地址，忽略即可 */ }
    }

    // 直接带 ?view=books 进来时自动打开。
    // 书架要等足迹数据到位才有内容，所以优先等 travel-memory.js 派发的
    // footprints:loaded；万一那个事件已经错过了，再兜一次定时。
    function initDeepLink() {
        if (!isBooksView()) return;
        var go = function () {
            if (els.root && !els.root.classList.contains('show')) open();
        };
        var d = api();
        if (d && d.footprints && d.footprints().length) {
            setTimeout(go, 60);
            return;
        }
        document.addEventListener('footprints:loaded', function () {
            setTimeout(go, 80);
        }, { once: true });
        setTimeout(go, 2500);
    }

    function init() {
        els.root = $('memoryShelf');
        if (!els.root) return;
        els.body = $('memoryShelfBody');
        els.title = $('memoryShelfTitle');
        els.intro = $('memoryShelfIntro');
        els.back = $('memoryShelfBack');
        els.btn = $('memoryShelfBtn');
        els.prev = $('memoryShelfPrev');
        els.next = $('memoryShelfNext');
        els.pageCount = $('memoryShelfPageCount');
        els.mute = $('memoryShelfMute');
        els.volume = $('memoryShelfVolume');
        bindAudioControls();
        reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // 自己的版本号：从当前脚本标签的 ?version= 取，供懒加载 three.js 复用
        var self = document.currentScript;
        if (self && self.src) {
            var match = /[?&]version=([^&]+)/.exec(self.src);
            if (match) version = decodeURIComponent(match[1]);
        }
        if (!version && window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.version) {
            version = window.FOOTPRINT_CONFIG.version;
        }

        if (els.btn) {
            els.btn.addEventListener('click', function (event) {
                event.preventDefault();
                open();
            });
        }
        if (els.back) els.back.addEventListener('click', close);
        if (els.prev) {
            els.prev.addEventListener('click', function () { setActive(state.active - pageStep()); });
        }
        if (els.next) {
            els.next.addEventListener('click', function () { setActive(state.active + pageStep()); });
        }
        document.addEventListener('keydown', onKeydown);
        els.root.addEventListener('click', function (event) {
            if (event.target === els.root) close();
        });
        window.addEventListener('resize', syncEntry);
        // 浏览器前进/后退：按 ?view=books 在书架与地球页之间切换
        window.addEventListener('popstate', function () {
            if (isBooksView()) {
                if (!els.root.classList.contains('show')) open();
            } else if (els.root.classList.contains('show')) {
                close();
            }
        });

        syncEntry();
        if (enabled()) preheat();
        initDeepLink();
    }

    // ---------------- 无障碍播报 ----------------
    // 页面里有一个 aria-live 区域（模板里的 #memoryShelfLive）。
    // 层级切换、翻页、视角复位都往这里写一句，读屏用户才知道发生了什么。
    function announce(text) {
        var live = $('memoryShelfLive');
        if (!live || !text) return;
        // 先清空再写：同一句话连续播报两次时，读屏才会重新念
        live.textContent = '';
        setTimeout(function () { live.textContent = text; }, 40);
    }

    // 翻页落定后播报当前跨页。翻页是纯视觉的（pivot 每帧插值），
    // 不给读屏一句反馈的话，非视觉用户按了翻页键等于什么都没发生。
    function announceSpread() {
        if (!book || state.mode !== 'book') return;
        var total = bookSpreads();
        // 夹一次只是保险：跨页索引本来就该在 0..total-1 之间
        var index = Math.min(state.bookSpread, total - 1);
        announce('第 ' + (index + 1) + ' / ' + total + ' 跨页');
    }

    // 检视态的「复位视角」按钮：把旋转/平移/缩放拉回默认。
    // 它的可见性由 updateBookTurn 每帧判断（视角是默认值时就藏起来）。
    function ensureViewReset() {
        if (!els.stage || $('msViewReset')) return;
        els.stage.insertAdjacentHTML('beforeend',
            '<button class="ms-view-reset" id="msViewReset" type="button" ' +
            'aria-label="复位视角" hidden>复位视角</button>');
        var btn = $('msViewReset');
        if (btn) {
            btn.addEventListener('click', function (event) {
                event.stopPropagation();
                state.view = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
                announce('视角已复位');
            });
        }
    }

    function syncViewReset() {
        var btn = $('msViewReset');
        if (!btn) return;
        var v = state.view;
        var moved = Math.abs(v.yaw) > 0.01 || Math.abs(v.pitch) > 0.01 ||
            Math.abs(v.panX) > 0.01 || Math.abs(v.panY) > 0.01 ||
            Math.abs(v.zoom - 1) > 0.01;
        btn.hidden = !(state.mode === 'book' && moved);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
