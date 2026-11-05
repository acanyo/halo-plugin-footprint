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
    const footprints = new Map();
    const clickHandlers = new Map();
    let visible = readMarkerVisibilityPreference();
    let groupNames = null;
    let groupOrder = null;
    let onVisibilityChange = () => {
    };

    const applyVisibility = (marker, footprint) => {
        const inGroup = !!(groupNames && footprint?.metadata?.name &&
            groupNames.has(footprint.metadata.name));
        const shouldShow = groupNames ? inGroup : visible;
        if (shouldShow) {
            if (typeof marker.show === 'function') marker.show();
            else marker.setMap(map);
        } else {
            if (typeof marker.hide === 'function') marker.hide();
            else marker.setMap(null);
        }
    };

    const applyGroupClass = (marker, footprint) => {
        const element = marker?.getContent?.()?.closest?.('.amap-marker');
        if (!element) return;
        element.classList.toggle('is-group-member',
            !!(groupNames && groupNames.has(footprint?.metadata?.name)));
        element.classList.toggle('is-group-dimmed',
            !!(groupNames && !groupNames.has(footprint?.metadata?.name)));
    };

    const applyGroupOrderBadge = (marker, footprint) => {
        const content = marker?.getContent?.();
        if (!content || typeof content.querySelector !== 'function') return;
        content.querySelector('.group-order-badge')?.remove();
        const name = footprint?.metadata?.name;
        if (!groupOrder || !groupOrder.has(name)) return;
        const badge = document.createElement('span');
        badge.className = 'group-order-badge';
        badge.textContent = String(groupOrder.get(name));
        badge.setAttribute('aria-hidden', 'true');
        content.appendChild(badge);
    };

    return {
        register(marker, footprint, onClick) {
            const markerName = footprint?.metadata?.name;
            if (markerName) {
                markers.set(markerName, marker);
                footprints.set(markerName, footprint);
                if (typeof onClick === 'function') clickHandlers.set(markerName, onClick);
            }
            applyVisibility(marker, footprint);
            setTimeout(() => {
                applyGroupClass(marker, footprint);
                applyGroupOrderBadge(marker, footprint);
            }, 0);
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
        activate(footprint) {
            const markerName = footprint?.metadata?.name;
            const handler = markerName ? clickHandlers.get(markerName) : null;
            if (typeof handler !== 'function') return false;
            handler();
            return true;
        },
        setVisible(nextVisible) {
            visible = Boolean(nextVisible);
            markers.forEach((marker, name) => applyVisibility(marker, footprints.get(name)));
            saveMarkerVisibilityPreference(visible);
            onVisibilityChange(visible);
        },
        setGroupEmphasis(names, orderedNames) {
            groupNames = names && names.size ? new Set(names) : null;
            groupOrder = groupNames && Array.isArray(orderedNames)
                ? new Map(orderedNames.map((name, index) => [name, index + 1]))
                : null;
            markers.forEach((marker, name) => {
                const footprint = footprints.get(name);
                applyVisibility(marker, footprint);
                applyGroupClass(marker, footprint);
                applyGroupOrderBadge(marker, footprint);
            });
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
