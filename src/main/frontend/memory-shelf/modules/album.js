/**
 * L3 旅行相册：城市照片的对开翻页，以及照片原地放大。
 */

import { ALBUM_PER_PAGE } from './constants.js';
import { state, els, shelf, reduceMotion } from './state.js';
import { $, api, esc, formatMonth, setTimer } from './utils.js';
import { openChapters } from './chapters.js';
import { setHeader } from './overlay.js';
import { albumPageSpecs } from './page-specs.js';
import { loadBookPages } from './book-open.js';

// ---------------- L3 旅行相册 ----------------

export function collectPhotos(city) {
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
export function openAlbum(book, city, spread) {
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

export function backToChapters() {
    hidePhoto();
    if (state.mode === 'book') {
        if (state.province) openChapters(state.province);
        return;
    }
    if (state.province) openChapters(state.province);
}

// 翻页：同一张纸旋转出去、下一张纸转进来，两边同时跑一条缓动时间线
export function turnAlbum(step) {
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

export function stepPhoto(delta) {
    var view = $('msPhotoView');
    if (!view || !view.classList.contains('show')) return;
    var next = Math.max(0, Math.min(state.photos.length - 1, state.photoIndex + delta));
    if (next === state.photoIndex) return;
    state.photoIndex = next;
    renderPhotoView();
}

export function hidePhoto() {
    var view = $('msPhotoView');
    if (view) view.classList.remove('show');
}

export function photoOpen() {
    var view = $('msPhotoView');
    return !!(view && view.classList.contains('show'));
}
