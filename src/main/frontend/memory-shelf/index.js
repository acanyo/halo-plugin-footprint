/* ==========================================================================
   世界这本书（memory-shelf）· 装配层

   主题：把「去过的省份」做成书架上的一本本布面精装书，翻开看城市章节，再进旅行相册。
   三层共用一个全屏覆盖层：书架（Three.js 真实书体）-> 城市章节（DOM 纸张）-> 旅行相册（DOM 翻页）。

   依赖：
   - travel-memory.js 暴露的 window.FootprintMemoryData（只读取值函数，见该文件末尾）；
   - 懒加载的 three.js（static/vendor/three/three.min.js，UMD 全局 THREE）。

   边界：
   - 只在桌面端出现入口（非触摸 + 宽度 > 820），与省份城市卡片 / 照片环同惯例；
   - 不复制任何第三方仓库源码，书体几何、程序化纹理、动画时间线均为本项目自写。

   具体功能按领域拆在 modules/ 下，这个文件只负责取元素、绑定入口事件并启动。
   esbuild 把它们打回一个 IIFE（build/resources/main/static/js/memory-shelf.js）。
   ========================================================================== */

import { preheat } from './modules/three-loader.js';
import { state, els, setVersion, version, setReduceMotion } from './modules/state.js';
import { pageStep } from './modules/shelf-scene.js';
import { $, enabled } from './modules/utils.js';
import { setActive } from './modules/shelf-interaction.js';
import { open, close, onKeydown, syncEntry, isBooksView, initDeepLink } from './modules/overlay.js';
import { bindAudioControls } from './modules/audio.js';
import { applyAccentToDocument } from '../shared/accent.js';

function init() {
    els.root = $('memoryShelf');
    if (!els.root) return;
    applyAccentToDocument();
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
    setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // 自己的版本号：从当前脚本标签的 ?version= 取，供懒加载 three.js 复用
    var self = document.currentScript;
    if (self && self.src) {
        var match = /[?&]version=([^&]+)/.exec(self.src);
        if (match) setVersion(decodeURIComponent(match[1]));
    }
    if (!version && window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.version) {
        setVersion(window.FOOTPRINT_CONFIG.version);
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
