/**
 * 未来足迹在 3D 地球上的独立图层。
 *
 * 它不并入普通足迹实体，也不参与足迹统计。已实现地点由真实足迹表示，
 * 因此不会在这个图层中重复出现。
 */

import { accentHex, accentInkFor, accentRgba } from '../../shared/accent.js';
import {
    isMapWishStatus,
    wishStatusKey,
    wishStatusLabel
} from '../../shared/wish-status.js';

let deps = null;
let wishEntities = [];
let activeWishes = [];
let selectedWishEntity = null;
let hoveredWishEntity = null;

const WISH_MARKER_SIZES = {
    wish: 34,
    planning: 37,
    booked: 34
};
const markerImageCache = new Map();

export function setupWishLayer(d) {
    deps = d;
}

function validCoordinate(wish) {
    const lng = Number(wish?.spec?.longitude);
    const lat = Number(wish?.spec?.latitude);
    return Number.isFinite(lng) && Number.isFinite(lat) &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 &&
        !(lng === 0 && lat === 0);
}

function visibleWishes(wishes) {
    return (Array.isArray(wishes) ? wishes : []).filter(wish =>
        wish && wish.metadata && !wish.metadata.deletionTimestamp &&
        wish.spec && isMapWishStatus(wish.spec.status) && validCoordinate(wish)
    );
}

function svgDataUrl(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function wishMarkerImage(status) {
    const key = wishStatusKey(status);
    const accent = accentHex();
    const cacheKey = `${key}:${accent}`;
    if (markerImageCache.has(cacheKey)) return markerImageCache.get(cacheKey);

    const ink = accentInkFor(accent);
    const common = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
        '<defs><filter id="s" x="-35%" y="-35%" width="170%" height="170%">',
        '<feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#000000" flood-opacity="0.34"/>',
        '</filter></defs>',
        '<circle cx="32" cy="32" r="30" fill="#ffffff" opacity="0.01"/>'
    ];
    let shape;
    if (key === 'wish') {
        shape = [
            '<circle cx="32" cy="32" r="21" fill="#ffffff" opacity="0.96" filter="url(#s)"/>',
            `<circle cx="32" cy="32" r="13" fill="#ffffff" stroke="${accent}" stroke-width="5"/>`
        ];
    } else if (key === 'planning') {
        shape = [
            '<circle cx="32" cy="32" r="21" fill="#ffffff" opacity="0.96" filter="url(#s)"/>',
            `<circle cx="32" cy="32" r="15" fill="${accentRgba(0.18)}" stroke="${accent}" stroke-width="4"/>`,
            `<circle cx="32" cy="32" r="5" fill="${accent}"/>`
        ];
    } else if (key === 'booked') {
        shape = [
            '<rect x="9" y="13" width="46" height="38" rx="12" fill="#ffffff" opacity="0.96" filter="url(#s)"/>',
            `<rect x="14" y="18" width="36" height="28" rx="6" fill="${accent}"/>`,
            `<path d="m26 32 3.5 3.5 8-9" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`
        ];
    } else {
        shape = [
            '<circle cx="32" cy="32" r="21" fill="#ffffff" opacity="0.96" filter="url(#s)"/>',
            `<circle cx="32" cy="32" r="13" fill="${accentRgba(0.14)}" stroke="${accent}" stroke-width="4"/>`
        ];
    }
    const image = svgDataUrl([...common, ...shape, '</svg>'].join(''));
    markerImageCache.set(cacheKey, image);
    return image;
}

function wishMarkerSize(status) {
    return WISH_MARKER_SIZES[wishStatusKey(status)] || WISH_MARKER_SIZES.wish;
}

function addWishEntity(wish) {
    const statusKey = wishStatusKey(wish.spec.status);
    const color = Cesium.Color.fromCssColorString(accentHex());
    const size = wishMarkerSize(statusKey);
    return deps.viewer().entities.add({
        id: `wish:${wish.metadata.name}`,
        name: wish.spec.title,
        position: Cesium.Cartesian3.fromDegrees(
            Number(wish.spec.longitude),
            Number(wish.spec.latitude),
            40
        ),
        billboard: {
            image: wishMarkerImage(statusKey),
            width: size,
            height: size,
            scale: 1,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
            text: `${wish.spec.title} · ${wishStatusLabel(statusKey)}`,
            font: '600 13px "MiSans", sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.55),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: color.withAlpha(0.86),
            backgroundPadding: new Cesium.Cartesian2(7, 4),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -size * 0.72),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    });
}

export function clearWishLayer() {
    if (!deps) return;
    selectedWishEntity = null;
    hoveredWishEntity = null;
    wishEntities.forEach(entity => deps.viewer().entities.remove(entity));
    wishEntities = [];
    activeWishes = [];
}

export function showWishLayer(wishes) {
    clearWishLayer();
    if (!deps || deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) return 0;
    activeWishes = visibleWishes(wishes);
    wishEntities = activeWishes.map(addWishEntity);
    return wishEntities.length;
}

export function showWishOnMap(wish, duration = 1) {
    clearWishLayer();
    if (!deps || !wish || !validCoordinate(wish)) return false;
    activeWishes = [wish];
    wishEntities = [addWishEntity(wish)];
    const height = 90000;
    deps.viewer().camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            Number(wish.spec.longitude),
            Number(wish.spec.latitude),
            height
        ),
        orientation: {
            heading: 0,
            pitch: -Math.PI / 2,
            roll: 0
        },
        duration: deps.reduceMotion?.() ? 0 : duration
    });
    return true;
}

export function currentWishLayerItems() {
    return activeWishes.slice();
}

export function findWishEntity(entityOrId) {
    return wishEntities.find(entity =>
        entity === entityOrId ||
        (entityOrId && entity.id === entityOrId.id) ||
        (entityOrId && entity.id === entityOrId)
    ) || null;
}

export function wishEntityAtScreen(screenPos) {
    if (!deps || !screenPos) return null;
    const viewer = deps.viewer();
    const scene = viewer.scene;
    const now = Cesium.JulianDate.now();
    let nearest = null;
    let nearestDistance = Infinity;
    for (const entity of wishEntities) {
        if (!entity || entity.show === false || !entity.billboard || entity.billboard.show === false) {
            continue;
        }
        const world = entity.position && entity.position.getValue(now);
        if (!world) continue;
        const normal = Cesium.Cartesian3.normalize(world, new Cesium.Cartesian3());
        const toCamera = Cesium.Cartesian3.subtract(
            viewer.camera.positionWC,
            world,
            new Cesium.Cartesian3()
        );
        if (Cesium.Cartesian3.dot(normal, toCamera) < 0) continue;
        const projected = Cesium.SceneTransforms.worldToWindowCoordinates(scene, world);
        if (!projected) continue;
        const dx = screenPos.x - projected.x;
        const dy = screenPos.y - projected.y;
        const distance = dx * dx + dy * dy;
        const width = entity.billboard.width?.getValue?.(now) || 34;
        const scale = entity.billboard.scale?.getValue?.(now) || 1;
        const hitRadius = width * scale * (entity === selectedWishEntity ? 0.64 : 0.56);
        if (distance <= hitRadius * hitRadius && distance < nearestDistance) {
            nearest = entity;
            nearestDistance = distance;
        }
    }
    return nearest;
}

export function wishForEntity(entityOrId) {
    const entity = findWishEntity(entityOrId);
    if (!entity) return null;
    return activeWishes.find(
        wish => `wish:${wish.metadata?.name}` === entity.id
    ) || null;
}

function refreshWishEntityStyle(entity) {
    if (!entity?.billboard) return;
    entity.billboard.scale = entity === selectedWishEntity
        ? 1.24
        : entity === hoveredWishEntity
            ? 1.12
            : 1;
}

export function setWishEntitySelected(entity) {
    const previous = selectedWishEntity;
    selectedWishEntity = entity || null;
    refreshWishEntityStyle(previous);
    refreshWishEntityStyle(selectedWishEntity);
}

export function setWishEntityHovered(entity) {
    if (hoveredWishEntity === entity) return;
    const previous = hoveredWishEntity;
    hoveredWishEntity = entity || null;
    refreshWishEntityStyle(previous);
    refreshWishEntityStyle(hoveredWishEntity);
}

export function clearWishEntitySelection() {
    const previous = selectedWishEntity;
    selectedWishEntity = null;
    refreshWishEntityStyle(previous);
}

export function clearWishEntityHover() {
    const previous = hoveredWishEntity;
    hoveredWishEntity = null;
    refreshWishEntityStyle(previous);
}
