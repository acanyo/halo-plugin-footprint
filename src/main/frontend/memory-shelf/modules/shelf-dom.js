/**
 * L1 书架的 DOM：左侧竖栏、信息卡、书架舞台的搭建，以及 CSS 3D 回退书架。
 */

import { state, els, shelf, reduceMotion } from './state.js';
import { initShelf } from './shelf-scene.js';
import { $, esc, formatDate, palette, nameSizeClass } from './utils.js';
import { attachCoverPhoto } from './cover-photos.js';
import { setActive, openActiveBook, bindStage } from './shelf-interaction.js';
import { setHeader } from './overlay.js';

// ---------------- L1 书架：DOM ----------------

export function bgStyle(url) {
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
export function syncLeftRail() {
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

export function updateInfo() {
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

export function renderShelfStage() {
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


// ---------------- 回退：CSS 3D 书架 ----------------

export function renderFallbackShelf() {
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
