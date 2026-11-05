/** 未来足迹在 2D 高德地图中的独立图层。 */

import { state } from './state.js';
import { isMobile } from './env.js';
import { createWishInfoWindow } from './marker-content.js';

let wishMarkers = [];
let wishInfoWindow = null;
let wishMap = null;
let wishMapClickHandler = null;

const STATUS_TEXT = {
    wish: '心愿',
    planning: '计划中',
    booked: '已订票'
};

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
    const status = STATUS_TEXT[wish.spec.status] || '心愿';
    label.textContent = `${wish.spec.title || '未来足迹'} · ${status}`;
    root.append(dot, label);
    return root;
}

export function clearFootprintWishLayer() {
    const map = state.activeMapInstance;
    wishInfoWindow?.close?.();
    wishInfoWindow = null;
    if (wishMap && wishMapClickHandler && typeof wishMap.off === 'function') {
        wishMap.off('click', wishMapClickHandler);
    }
    wishMap = null;
    wishMapClickHandler = null;
    if (map && typeof map.remove === 'function') {
        wishMarkers.forEach(marker => map.remove(marker));
    }
    wishMarkers = [];
}

function openWishInfoWindow(wish, position) {
    const map = state.activeMapInstance;
    if (!map || typeof AMap === 'undefined') return;
    wishInfoWindow?.close?.();
    wishInfoWindow = new AMap.InfoWindow({
        isCustom: true,
        autoMove: false,
        anchor: isMobile ? 'bottom-center' : 'middle-left',
        offset: isMobile ? new AMap.Pixel(0, -96) : new AMap.Pixel(40, -40)
    });
    wishInfoWindow.setContent(createWishInfoWindow(wish));
    wishInfoWindow.open(map, position);
    requestAnimationFrame(() => {
        document.querySelector('.info-window--wish')?.addEventListener(
            'click',
            event => event.stopPropagation()
        );
    });
}

function createWishMarker(wish) {
    const position = [Number(wish.spec.longitude), Number(wish.spec.latitude)];
    const marker = new AMap.Marker({
        position,
        content: markerContent(wish),
        // 未来足迹直接落在坐标点，不再套用普通足迹的上移偏置。
        anchor: 'top-center',
        offset: new AMap.Pixel(0, 0),
        zIndex: 120
    });
    marker.on('click', () => openWishInfoWindow(wish, position));
    return marker;
}

export function showFootprintWishLayer(wishes) {
    clearFootprintWishLayer();
    const map = state.activeMapInstance;
    if (!map || typeof AMap === 'undefined') return 0;
    const visible = (Array.isArray(wishes) ? wishes : []).filter(wish =>
        wish && wish.spec && wish.spec.status !== 'visited' && validCoordinate(wish)
    );
    wishMarkers = visible.map(createWishMarker);
    wishMarkers.forEach(marker => map.add(marker));
    wishMap = map;
    wishMapClickHandler = () => {
        wishInfoWindow?.close?.();
        wishInfoWindow = null;
    };
    map.on('click', wishMapClickHandler);
    return wishMarkers.length;
}

export function showFootprintWishOnMap(wish) {
    clearFootprintWishLayer();
    const map = state.activeMapInstance;
    if (!map || !wish || !validCoordinate(wish)) return false;
    const position = [Number(wish.spec.longitude), Number(wish.spec.latitude)];
    const marker = createWishMarker(wish);
    map.add(marker);
    wishMarkers = [marker];
    wishMap = map;
    wishMapClickHandler = () => {
        wishInfoWindow?.close?.();
        wishInfoWindow = null;
    };
    map.on('click', wishMapClickHandler);
    map.setZoomAndCenter(10, position, false, 500);
    return true;
}
