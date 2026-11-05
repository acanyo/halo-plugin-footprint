/** 2D 高德地图中的旅程/收藏高亮与路线。 */

import { accentHex } from '../../shared/accent.js';
import { state } from './state.js';

let groupOverlays = [];
let emphasizedNames = new Set();

document.addEventListener('click', event => {
    if (!emphasizedNames.size) return;
    const marker = event.target.closest?.('.amap-marker');
    const key = marker?.querySelector?.('[data-footprint-key]')?.dataset?.footprintKey || '';
    if (!key || !emphasizedNames.has(key)) return;
    document.dispatchEvent(new CustomEvent('footprint:group-member-click', {
        detail: { key }
    }));
}, true);

function hasCoordinate(member) {
    const lng = Number(member?.lng);
    const lat = Number(member?.lat);
    return Number.isFinite(lng) && Number.isFinite(lat) &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 &&
        !(lng === 0 && lat === 0);
}

function markersForNames() {
    return state.footprintMarkerController ? [...emphasizedNames] : [];
}

function clearMarkerEmphasis() {
    document.querySelectorAll('.amap-marker.is-group-member, .amap-marker.is-group-dimmed')
        .forEach(marker => marker.classList.remove('is-group-member', 'is-group-dimmed'));
}

function applyMarkerEmphasis(group) {
    clearMarkerEmphasis();
    emphasizedNames = new Set(group.names || []);
    state.footprintMarkerController?.setGroupEmphasis?.(
        emphasizedNames,
        (group.members || []).map(member => member.key)
    );
    document.querySelectorAll('.amap-marker').forEach(markerElement => {
        const content = markerElement.querySelector('[data-footprint-key]');
        const key = content?.dataset?.footprintKey || '';
        if (!key) return;
        markerElement.classList.add(
            emphasizedNames.has(key) ? 'is-group-member' : 'is-group-dimmed'
        );
    });
    // 老版本标记内容没有 data-footprint-key 时，用控制器逐个定位并给外层类名。
    markersForNames().forEach(name => {
        const footprint = window.FOOTPRINT_CONFIG?.footprints?.find(
            item => item?.metadata?.name === name
        );
        const marker = state.footprintMarkerController?.find(footprint);
        const element = marker?.getContent?.()?.closest?.('.amap-marker');
        if (element) element.classList.add('is-group-member');
    });
}

export function clearFootprintGroupOnMap() {
    const map = state.activeMapInstance;
    if (map && groupOverlays.length) map.remove(groupOverlays);
    groupOverlays = [];
    emphasizedNames = new Set();
    state.groupMapMode = false;
    state.footprintMarkerController?.setGroupEmphasis?.(null);
    clearMarkerEmphasis();
}

export function showFootprintGroupOnMap(group) {
    clearFootprintGroupOnMap();
    const map = state.activeMapInstance;
    if (!map || !group || !group.members) return;
    state.groupMapMode = true;
    applyMarkerEmphasis(group);

    const accent = accentHex();
    if (group.groupType === 'trip') {
        group.segments.forEach(segment => {
            if (segment.km == null) return;
            const path = [
                [Number(segment.from.lng), Number(segment.from.lat)],
                [Number(segment.to.lng), Number(segment.to.lat)]
            ];
            groupOverlays.push(new AMap.Polyline({
                path,
                strokeColor: accent,
                strokeOpacity: 0.92,
                strokeWeight: 4,
                lineJoin: 'round',
                lineCap: 'round',
                zIndex: 120
            }));
        });
    }

    group.members.forEach(member => {
        if (!hasCoordinate(member)) return;
        groupOverlays.push(new AMap.CircleMarker({
            center: [Number(member.lng), Number(member.lat)],
            radius: 1,
            strokeOpacity: 0,
            fillOpacity: 0,
            bubble: true,
            zIndex: 1
        }));
    });

    map.add(groupOverlays);
    if (groupOverlays.length) {
        const stats = document.getElementById('map-stats');
        const groupDock = document.getElementById('footprintGroupMapDock');
        const statsStyle = stats ? getComputedStyle(stats) : null;
        const statsVisible = !!statsStyle &&
            statsStyle.display !== 'none' &&
            statsStyle.visibility !== 'hidden' &&
            Number(statsStyle.opacity) > 0;
        const rightPadding = statsVisible && window.innerWidth > 900
            ? Math.max(80, Math.ceil(window.innerWidth - stats.getBoundingClientRect().left + 18))
            : 60;
        const dockHeight = groupDock && !groupDock.hidden
            ? groupDock.getBoundingClientRect().height
            : 0;
        // AMap 的 avoid 顺序是上、下、左、右。底部额外留出旅程信息坞
        // 及它与地图内容之间的呼吸区，避免南侧标记被信息坞压住。
        const bottomPadding = Math.max(220, Math.ceil(dockHeight + 120));
        map.setFitView(groupOverlays, false, [96, bottomPadding, 96, rightPadding], 16);
    }
}

export function openFootprintIn2D(member, options = {}) {
    state.photoWallCloseHandler = typeof options.onClose === 'function'
        ? options.onClose
        : null;
    const activated = state.footprintMarkerController?.activate?.({
        metadata: { name: member.key }
    });
    if (activated) return true;
    const marker = state.footprintMarkerController?.find({
        metadata: { name: member.key },
        spec: { longitude: member.lng, latitude: member.lat }
    });
    if (marker && typeof marker.emit === 'function') {
        marker.emit('click');
        return true;
    }
    return false;
}
