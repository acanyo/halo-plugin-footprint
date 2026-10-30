/**
 * 地图视角移动：取消进行中的移动、平移缩放到目标点、还原仰角与旋转。
 */

import { state } from './state.js';

// 快速切换时间线卡片时，取消上一张卡片仍在进行的地图移动，
// 避免新卡片的 setZoomAndCenter 在旧动画后面排队。
export const cancelTimelineMapMove = (map) => {
    if (typeof map.stopAnimation === 'function') {
        map.stopAnimation();
    }
};

export const restoreMapOrientation = (map) => {
    if (!state.isElevation && !state.isElevationRestoring) {
        return Promise.resolve();
    }
    if (state.elevationRestorePromise) {
        return state.elevationRestorePromise;
    }

    state.isElevationRestoring = true;
    let resolveRestore;
    const restorePromise = new Promise(resolve => {
        resolveRestore = resolve;
    });
    state.elevationRestorePromise = restorePromise;

    const startedAt = Date.now();
    let checkTimer = null;
    const finish = () => {
        // animateEnable 会让 setPitch/setRotation 忽略 immediately 参数，
        // 因此先临时关闭地图动画，确保最终值确实落在 0。
        map.setStatus({animateEnable: false});
        map.setPitch(0, true);
        map.setRotation(0, true);
        map.setStatus({animateEnable: true});
        if (checkTimer) {
            window.clearTimeout(checkTimer);
        }
        state.isElevationRestoring = false;
        state.isElevation = false;
        state.elevationRestorePromise = null;
        resolveRestore();
    };
    const checkRestore = () => {
        const pitch = Number(map.getPitch?.() ?? 0);
        const rotation = Number(map.getRotation?.() ?? 0);
        if (Math.abs(pitch) < 0.5 && Math.abs(rotation) < 0.5) {
            finish();
        } else if (Date.now() - startedAt >= 1500) {
            // 动画超时仍未结束时，直接跳到目标值，避免地图停在中间状态。
            finish();
        } else {
            checkTimer = window.setTimeout(checkRestore, 16);
        }
    };

    map.setPitch(0);
    map.setRotation(0);
    checkRestore();
    return restorePromise;
};

// 优化地图移动
export const moveToLocation = (map, position, Zoom, time) => {
    return new Promise((resolve) => {
        // 启用动画
        map.setStatus({animateEnable: true});

        const sameZoom = Number(map.getZoom()) === Number(Zoom);
        // 旧逻辑会先放大两级再缩回，造成额外的地图跳转。
        // 这里统一使用一次 setZoomAndCenter 完成缩放和平移。
        const requestedDuration = Number(time);
        const duration = Number.isFinite(requestedDuration) && requestedDuration >= 100
                ? requestedDuration
                : 500;
        const currentCenter = map.getCenter();
        const centerChanged = currentCenter && typeof currentCenter.distance === 'function'
                ? currentCenter.distance(position) > 1
                : true;
        const endEvent = centerChanged ? 'moveend' : (sameZoom ? null : 'zoomend');
        let timeoutId;
        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            if (endEvent) {
                map.off(endEvent, finish);
            }
            clearTimeout(timeoutId);
            resolve(sameZoom);
        };

        if (endEvent) {
            map.on(endEvent, finish);
        }
        timeoutId = setTimeout(finish, duration + 300);

        // 单次完成缩放与平移，不再人为放大两级来触发 zoomend。
        map.setZoomAndCenter(Zoom, position, false, duration);

        // 目标中心和缩放级别都未变化时，高德不会触发结束事件。
        if (!endEvent) {
            requestAnimationFrame(finish);
        }
    });
};
