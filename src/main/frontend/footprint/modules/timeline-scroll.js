/**
 * 时间线滚动期间的悬停取消与滚动结束后的重新悬停。
 *
 * 指针位置由 bindTimelinePointerTracking 在脚本加载时开始记录（原为顶层监听）。
 */

import { cancelTimelineMapMove } from './map-motion.js';
import { state } from './state.js';

// 滚动时先立即取消当前悬停，避免旧卡片的异步操作继续渲染。
export const cancelTimelineScrollHover = () => {
    state.timelineHoverGeneration += 1;
    state.timelineActivationToken += 1;
    state.animationInFlight = null;

    document.querySelectorAll('.timeline-content-card').forEach(card => {
        card._hoverCancelled = true;
        card._hoverPending = false;
        card._hoverOwner = 0;
        if (card.currentAnimationId) {
            cancelAnimationFrame(card.currentAnimationId);
            card.currentAnimationId = null;
        }
    });

    cancelTimelineMapMove(state.activeMapInstance);
    document.querySelectorAll('.amap-marker').forEach(marker => {
        marker.classList.remove('zIndex13');
        marker.classList.remove('zIndex14');
        marker.classList.remove('marker-highlight');
    });

    const canvas = document.getElementById('canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    state.isAnimating = false;
    state.activeCard = null;
};

// 滚动结束后，重新激活鼠标静止位置下的卡片。
export const rehoverTimelineAfterScroll = () => {
    if (!state.lastTimelinePointer) return;
    const target = document.elementFromPoint(
        state.lastTimelinePointer.x,
        state.lastTimelinePointer.y
    );
    const card = target instanceof Element
        ? target.closest('.timeline-content-card')
        : null;
    if (!card || card._hoverPending) return;
    card.dispatchEvent(new MouseEvent('mouseenter', {
        bubbles: false,
        cancelable: true
    }));
};

export const handleScroll = () => {
    cancelTimelineScrollHover();
    clearTimeout(state.timelineScrollEndTimer);
    state.timelineScrollEndTimer = setTimeout(rehoverTimelineAfterScroll, 120);
};

// 记录指针位置，滚动结束后据此重新悬停（index.js 在加载时调用一次）
export function bindTimelinePointerTracking() {
    window.addEventListener('pointermove', (event) => {
        state.lastTimelinePointer = {x: event.clientX, y: event.clientY};
    }, {passive: true});
}
