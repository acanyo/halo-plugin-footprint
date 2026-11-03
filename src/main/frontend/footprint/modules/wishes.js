/** 未来足迹在 2D 高德地图中的独立图层。 */

import { state } from './state.js';

let wishMarkers = [];

function validCoordinate(wish) {
    const lng = Number(wish?.spec?.longitude);
    const lat = Number(wish?.spec?.latitude);
    return Number.isFinite(lng) && Number.isFinite(lat) &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 &&
        !(lng === 0 && lat === 0);
}

function markerContent(wish) {
    const root = document.createElement('div');
    root.className = 'fp-wish-map-marker';
    root.dataset.status = wish.spec.status || 'wish';
    const dot = document.createElement('i');
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = wish.spec.title || '未来足迹';
    root.append(dot, label);
    return root;
}

export function clearFootprintWishLayer() {
    const map = state.activeMapInstance;
    if (map && typeof map.remove === 'function') {
        wishMarkers.forEach(marker => map.remove(marker));
    }
    wishMarkers = [];
}

export function showFootprintWishLayer(wishes) {
    clearFootprintWishLayer();
    const map = state.activeMapInstance;
    if (!map || typeof AMap === 'undefined') return 0;
    const visible = (Array.isArray(wishes) ? wishes : []).filter(wish =>
        wish && wish.spec && wish.spec.status !== 'visited' && validCoordinate(wish)
    );
    wishMarkers = visible.map(wish => new AMap.Marker({
        position: [Number(wish.spec.longitude), Number(wish.spec.latitude)],
        content: markerContent(wish),
        anchor: 'bottom-center',
        zIndex: 120
    }));
    wishMarkers.forEach(marker => map.add(marker));
    return wishMarkers.length;
}

export function showFootprintWishOnMap(wish) {
    clearFootprintWishLayer();
    const map = state.activeMapInstance;
    if (!map || !wish || !validCoordinate(wish)) return false;
    const marker = new AMap.Marker({
        position: [Number(wish.spec.longitude), Number(wish.spec.latitude)],
        content: markerContent(wish),
        anchor: 'bottom-center',
        zIndex: 120
    });
    map.add(marker);
    wishMarkers = [marker];
    map.setZoomAndCenter(10, [
        Number(wish.spec.longitude),
        Number(wish.spec.latitude)
    ], false, 500);
    return true;
}
