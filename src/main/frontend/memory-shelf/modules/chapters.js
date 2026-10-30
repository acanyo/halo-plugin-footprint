/**
 * L2 城市章节：翻开一本书进入城市列表，以及回到书架。
 */

import { state, els, shelf } from './state.js';
import { $, esc, formatMonth } from './utils.js';
import { disposeShelf } from './shelf-render-loop.js';
import { bgStyle, renderShelfStage } from './shelf-dom.js';
import { openAlbum } from './album.js';
import { setHeader } from './overlay.js';
import { playCue } from './audio.js';
import { preparedPageSpecs, loadBookPages } from './book-open.js';
import { beginClose } from './page-turn.js';

// ---------------- L2 城市章节 ----------------

export function openChapters(book) {
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

export function backToShelf() {
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
