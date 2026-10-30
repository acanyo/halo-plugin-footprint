/**
 * 时间线抽屉的关闭，以及窗口尺寸变化时地图宽度的适配。
 */

import { debounce } from './debounce.js';
import { isMobile } from './env.js';
import { cancelTimelineMapMove } from './map-motion.js';
import { state } from './state.js';
import { cancelTimelineScrollHover, handleScroll } from './timeline-scroll.js';

export const closeTimelineDrawer = (map) => {
    const timelineBtn = document.getElementById('timeline-btn');
    const timelineDrawer = document.getElementById('timelineDrawer');
    const timelineContent = document.getElementById('timelineContent');
    if (!timelineBtn || !timelineDrawer || !timelineContent) return;

    const zoomButtons = document.getElementById('zoom-buttons');
    const line = document.getElementById('line');
    timelineBtn.classList.remove('hidden-important');
    zoomButtons?.classList.remove('hidden-important');
    line?.classList.remove('hidden-important');

    const footprintMap = document.getElementById('footprint-map');
    if (footprintMap) {
        footprintMap.style.width = window.innerWidth + "px";
    }

    state.isTimelineOpen = false;
    timelineDrawer.classList.remove('open');
    const mapControls = document.getElementById('map-controls');
    mapControls?.classList.remove('open');

    timelineContent.removeEventListener('scroll', handleScroll);
    clearTimeout(state.timelineScrollEndTimer);
    cancelTimelineMapMove(map);
    cancelTimelineScrollHover();
};

// 使用防抖优化resize事件
export const handleResize = debounce(() => {
    const mapContainer = document.getElementById('footprint-map');
    const timelineDrawer = document.getElementById('timelineDrawer');

    if (!mapContainer || !timelineDrawer) return;

    if (state.isTimelineOpen) {
        if (isMobile) {
            // 移动端抽屉覆盖地图，保持地图有效宽度
            mapContainer.style.transition = 'none';
            mapContainer.style.width = '100%';
        } else {
            // 桌面端抽屉打开时，为抽屉预留地图宽度
            const drawerRect = timelineDrawer.getBoundingClientRect();
            const newMapWidth = Math.max(1, window.innerWidth - drawerRect.width);

            // 应用新宽度（添加CSS过渡效果）
            mapContainer.style.transition = 'width 0.3s ease';
            mapContainer.style.width = `${newMapWidth}px`;
        }

    } else {
        // 全屏模式
        mapContainer.style.transition = 'width 0.3s ease';
        mapContainer.style.width = '100%';
    }
}, 150);
