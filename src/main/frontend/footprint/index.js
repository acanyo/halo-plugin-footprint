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

import { accentHex, applyAccentToDocument } from '../shared/accent.js';
import { initGuestbook } from '../shared/guestbook.js';
import { isMobile } from './modules/env.js';
import { initializeApp } from './modules/map-app.js';
import { state } from './modules/state.js';
import { renderStats } from './modules/stats-panel.js';
import { handleResize } from './modules/timeline-drawer.js';
import { bindTimelinePointerTracking } from './modules/timeline-scroll.js';
import {
    showFootprintGroupOnMap,
    clearFootprintGroupOnMap,
    openFootprintIn2D
} from './modules/footprint-groups.js';

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
    // 判断当前路径是否为/footprints
    const currentPath = window.location.pathname;
    if (currentPath !== '/footprints') {
        return;
    }


    // 主题色写到 :root（3D 地球那边也写一次，谁先跑都一样）
    applyAccentToDocument();
    // 留言板：两个入口（3D 底部坞、2D 控制栏）共用一个面板；重复调用只绑一次
    initGuestbook();
    const footprintPage = document.getElementById('footprint-page');
    if (footprintPage && window.FOOTPRINT_CONFIG) {
        // 设置标记点样式类
        if (window.FOOTPRINT_CONFIG.markerStyle) {
            document.body.classList.add('marker-style-' + window.FOOTPRINT_CONFIG.markerStyle);
        }
        if (window.FOOTPRINT_CONFIG.highlightScheme) {
            document.body.classList.add('highlight-scheme-' + window.FOOTPRINT_CONFIG.highlightScheme);
        }
    }

    // 打印插件信息（颜色跟主题色）
    const accent = accentHex();
    console.log(
            '%c足迹插件%c把去过的地方放到一颗 3D 地球上\n%c作者 Handsome & 云端 %cwww.xhhao.com',
            `background: ${accent}; color: white; padding: 2px 4px; border-radius: 3px;`,
            `color: ${accent}; padding: 2px 4px;`,
            'color: #666; padding: 2px 4px;',
            `color: ${accent}; text-decoration: underline; padding: 2px 4px;`
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
        // 地图实例保留，但图片墙/信息卡属于 2D 的临时覆盖层，离开前要收干净。
        state.closeActiveFootprint?.();
    },
    showGroup(group) {
        const apply = () => showFootprintGroupOnMap(group);
        if (!state.footprint2dInitialized) {
            window.Footprint2D.show(apply);
            return;
        }
        apply();
    },
    clearGroup() {
        clearFootprintGroupOnMap();
    },
    resetView() {
        document.getElementById('zoom-restore')?.click();
    },
    focusGroupMember(group, index) {
        const map = state.activeMapInstance;
        const member = group?.members?.[index];
        if (!map || !member) return;
        map.setZoomAndCenter(
            Math.max(3, Math.min(18, Number(member.zoomLevel) || 12)),
            [Number(member.lng), Number(member.lat)],
            false,
            500
        );
    },
    openFootprint(footprint, options) {
        return openFootprintIn2D(footprint, options);
    },
    // 主动销毁（可选）：释放地图实例
    destroy() {
        clearFootprintGroupOnMap();
        if (state.activeMapInstance && typeof state.activeMapInstance.destroy === 'function') {
            state.activeMapInstance.destroy();
        }
        state.activeMapInstance = null;
        state.footprint2dInitialized = false;
        state.footprint2dInitializing = false;
    }
};

bindTimelinePointerTracking();
