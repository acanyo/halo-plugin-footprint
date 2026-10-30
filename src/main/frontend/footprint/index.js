/**
 * 2D 足迹页（高德地图）· 装配层。
 *
 * 原 footprint.js 按领域拆到 modules/ 下，由 esbuild 打包回单个 IIFE，输出名仍是 footprint.js，
 * 由 FootprintHeadProcessor 同步注入 <head>（无 defer），加载时机与拆分前一致。
 *
 * 本文件只保留原先的顶层副作用，顺序与原脚本相同：
 *   1) DOMContentLoaded：设置主题色、标记点样式类、打印插件信息、绑定 resize；
 *   2) window.Footprint2D：供 travel-memory 的 view-mode.js 切到 2D 时懒加载地图；
 *   3) 记录指针位置，供时间线滚动结束后重新悬停。
 *
 * 拆分前作为经典脚本，顶层 function / let 都在全局作用域；已确认除 window.Footprint2D 外
 * 没有任何模板、脚本或 Java 代码引用这些名字，所以只显式暴露 Footprint2D。
 */

import { isMobile } from './modules/env.js';
import { initializeApp } from './modules/map-app.js';
import { state } from './modules/state.js';
import { renderStats } from './modules/stats-panel.js';
import { handleResize } from './modules/timeline-drawer.js';
import { bindTimelinePointerTracking } from './modules/timeline-scroll.js';

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
    // 判断当前路径是否为/footprints
    const currentPath = window.location.pathname;
    if (currentPath !== '/footprints') {
        return;
    }


    // 设置全局颜色变量
    const footprintPage = document.getElementById('footprint-page');
    if (footprintPage && window.FOOTPRINT_CONFIG) {
        footprintPage.style.setProperty('--footprint-hsla', window.FOOTPRINT_CONFIG.hsla);
        // 设置标记点样式类
        if (window.FOOTPRINT_CONFIG.markerStyle) {
            document.body.classList.add('marker-style-' + window.FOOTPRINT_CONFIG.markerStyle);
        }
        if (window.FOOTPRINT_CONFIG.highlightScheme) {
            document.body.classList.add('highlight-scheme-' + window.FOOTPRINT_CONFIG.highlightScheme);
        }
    }

    // 打印插件信息
    console.log(
            '%c足迹插件%c🗺️ 记录生活轨迹，分享旅途故事\n%c作者 Handsome %cwww.lik.cc',
            'background: #42b983; color: white; padding: 2px 4px; border-radius: 3px;',
            'color: #42b983; padding: 2px 4px;',
            'color: #666; padding: 2px 4px;',
            'color: #42b983; text-decoration: underline; padding: 2px 4px;'
    );

    // 添加事件监听（注意在组件卸载时移除）
    window.addEventListener('resize', handleResize);
});

// ===== 2D 高德地图懒加载接口（由 3D 地球视图切换时调用） =====
window.Footprint2D = {
    // 进入 2D 视图时调用：首次初始化高德地图，之后仅触发 resize
    show(onReady) {
        const ready = () => {
            if (typeof onReady === 'function') onReady();
        };
        if (typeof AMap === 'undefined') {
            console.warn('等待高德地图API加载...');
            setTimeout(() => {
                if (window.Footprint2D) window.Footprint2D.show(onReady);
            }, 100);
            return;
        }
        if (state.footprint2dInitialized) {
            if (state.activeMapInstance && typeof state.activeMapInstance.resize === 'function') {
                state.activeMapInstance.resize();
            }
            ready();
            return;
        }
        if (state.footprint2dInitializing) {
            // 正在初始化：稍后重试，初始化完成后回调
            setTimeout(() => {
                if (window.Footprint2D) window.Footprint2D.show(onReady);
            }, 100);
            return;
        }
        state.footprint2dInitializing = true;
        renderStats();
        initializeApp(isMobile).finally(() => {
            state.footprint2dInitializing = false;
            ready();
        });
    },
    // 切回 3D 时调用：保留地图实例，返回 2D 时直接 resize 即可
    hide() {
        // 地图实例保留，不做销毁
    },
    // 主动销毁（可选）：释放地图实例
    destroy() {
        if (state.activeMapInstance && typeof state.activeMapInstance.destroy === 'function') {
            state.activeMapInstance.destroy();
        }
        state.activeMapInstance = null;
        state.footprint2dInitialized = false;
        state.footprint2dInitializing = false;
    }
};

bindTimelinePointerTracking();
