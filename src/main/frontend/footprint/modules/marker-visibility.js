/**
 * 足迹标记点的显示开关与交互状态清理。
 *
 * 开关偏好写 localStorage；控制器实例保存在 state.footprintMarkerController。
 */

import { state } from './state.js';

export const markerVisibilityStorageKey = 'footprint-markers-visible';

export const readMarkerVisibilityPreference = () => {
    try {
        const storedValue = window.localStorage.getItem(markerVisibilityStorageKey);
        return storedValue === null ? true : storedValue !== 'false';
    } catch (error) {
        return true;
    }
};

export const saveMarkerVisibilityPreference = (visible) => {
    try {
        window.localStorage.setItem(markerVisibilityStorageKey, String(visible));
    } catch (error) {
        // 隐私模式或禁用本地存储时不影响当前页面使用
    }
};

export const createFootprintMarkerController = (map) => {
    const markers = new Map();
    let visible = readMarkerVisibilityPreference();
    let onVisibilityChange = () => {
    };

    const applyVisibility = (marker) => {
        if (visible) {
            if (typeof marker.show === 'function') marker.show();
            else marker.setMap(map);
        } else {
            if (typeof marker.hide === 'function') marker.hide();
            else marker.setMap(null);
        }
    };

    return {
        register(marker, footprint) {
            const markerName = footprint?.metadata?.name;
            if (markerName) markers.set(markerName, marker);
            applyVisibility(marker);
        },
        find(footprint) {
            const markerName = footprint?.metadata?.name;
            if (markerName && markers.has(markerName)) return markers.get(markerName);

            const longitude = Number(footprint?.spec?.longitude);
            const latitude = Number(footprint?.spec?.latitude);
            return [...markers.values()].find(marker => {
                const position = marker.getPosition?.();
                return position && position.lng === longitude && position.lat === latitude;
            });
        },
        setVisible(nextVisible) {
            visible = Boolean(nextVisible);
            markers.forEach(applyVisibility);
            saveMarkerVisibilityPreference(visible);
            onVisibilityChange(visible);
        },
        isVisible() {
            return visible;
        },
        setOnVisibilityChange(callback) {
            onVisibilityChange = typeof callback === 'function' ? callback : () => {
            };
        }
    };
};

export const clearMarkerInteractionState = () => {
    state.animationInFlight = null;
    state.activeCard = null;
    state.isAnimating = false;

    document.querySelectorAll('.amap-marker').forEach(marker => {
        marker.classList.remove('zIndex13');
        marker.classList.remove('zIndex14');
        marker.classList.remove('marker-highlight');
    });

    const canvas = document.getElementById('canvas');
    if (canvas) {
        const context = canvas.getContext('2d');
        context?.clearRect(0, 0, canvas.width, canvas.height);
    }
};
