/**
 * 覆盖层的开关与键盘：面包屑顶栏、打开 / 关闭、Esc 与方向键、入口显隐、
 * 直达链接（?view=books）与无障碍播报。
 */

import { ensureThree } from './three-loader.js';
import { state, els } from './state.js';
import { $, api, esc, clearTimer, enabled } from './utils.js';
import { buildBookList } from './data.js';
import { preloadCoverPhotos } from './cover-photos.js';
import { disposeShelf } from './shelf-render-loop.js';
import { renderShelfStage, renderFallbackShelf } from './shelf-dom.js';
import { setActive, openActiveBook } from './shelf-interaction.js';
import { openChapters, backToShelf } from './chapters.js';
import { backToChapters, turnAlbum, stepPhoto, hidePhoto, photoOpen } from './album.js';
import { book } from './book-rig.js';
import { bookSpreads } from './book-open.js';
import { turnToPage, turnBookPage, exitBookMode, beginClose } from './page-turn.js';

// ---------------- 开关与键盘 ----------------


// 顶栏标题是一条**面包屑**：从「世界这本书」到当前所在的省 / 市。
// crumb 是路径上的名字数组，最后一段是当前位置（加粗、不可点）；前面的段带了
// to 就渲染成可点的返回入口（to: 'shelf' 回书架 | 'chapters' 回城市章节）。
// 这样"我在哪、怎么回去"都集中在一处，不用在顶栏 / 页内工具条里各放一颗
// 长得差不多、做的事情也差不多的返回按钮。
// 不传 crumb 的调用点（比如加载占位）就退回纯文本标题，行为与以前一致。
export function setHeader(title, intro, crumb) {
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

export function open() {
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

export function close() {
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

export function onKeydown(event) {
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
export function syncEntry() {
    var on = enabled();
    if (els.btn) els.btn.hidden = !on;
    if (!on && els.root && els.root.classList.contains('show')) close();
}

// ---------------- 直达链接（与票根册的 ?view=tickets 同一套做法） ----------------
// /footprints?view=books 直接进入「世界这本书」；打开时把地址推成这个参数，
// 关闭时替换回不带参数的地址，浏览器前进/后退也能来回切。
export function isBooksView() {
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
export function initDeepLink() {
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
export function announceSpread() {
    if (!book || state.mode !== 'book') return;
    var total = bookSpreads();
    // 夹一次只是保险：跨页索引本来就该在 0..total-1 之间
    var index = Math.min(state.bookSpread, total - 1);
    announce('第 ' + (index + 1) + ' / ' + total + ' 跨页');
}

// 检视态的「复位视角」按钮：把旋转/平移/缩放拉回默认。
// 它的可见性由 updateBookTurn 每帧判断（视角是默认值时就藏起来）。
export function ensureViewReset() {
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

export function syncViewReset() {
    var btn = $('msViewReset');
    if (!btn) return;
    var v = state.view;
    var moved = Math.abs(v.yaw) > 0.01 || Math.abs(v.pitch) > 0.01 ||
        Math.abs(v.panX) > 0.01 || Math.abs(v.panY) > 0.01 ||
        Math.abs(v.zoom - 1) > 0.01;
    btn.hidden = !(state.mode === 'book' && moved);
}
