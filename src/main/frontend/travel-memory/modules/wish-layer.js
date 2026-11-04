/**
 * 未来足迹在 3D 地球上的独立图层。
 *
 * 它不并入普通足迹实体，也不参与足迹统计。已实现地点由真实足迹表示，
 * 因此不会在这个图层中重复出现。
 */

import { accentHex } from '../../shared/accent.js';

let deps = null;
let wishEntities = [];
let activeWishes = [];
let selectedWishEntity = null;
let hoveredWishEntity = null;

const STATUS_TEXT = {
    wish: '心愿',
    planning: '计划中',
    booked: '已订票'
};

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
        wish.spec && wish.spec.status !== 'visited' && validCoordinate(wish)
    );
}

function addWishEntity(wish) {
    const color = Cesium.Color.fromCssColorString(accentHex());
    const status = STATUS_TEXT[wish.spec.status] || '未来足迹';
    return deps.viewer().entities.add({
        id: `wish:${wish.metadata.name}`,
        name: wish.spec.title,
        position: Cesium.Cartesian3.fromDegrees(
            Number(wish.spec.longitude),
            Number(wish.spec.latitude),
            40
        ),
        point: {
            pixelSize: 13,
            color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
            text: `${wish.spec.title} · ${status}`,
            font: '600 13px "MiSans", sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.55),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: color.withAlpha(0.86),
            backgroundPadding: new Cesium.Cartesian2(7, 4),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -17),
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
        if (!entity || entity.show === false || !entity.point || entity.point.show === false) {
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
        const hitRadius = entity === selectedWishEntity ? 18 : 13;
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
    if (!entity?.point) return;
    entity.point.pixelSize = entity === selectedWishEntity
        ? 19
        : entity === hoveredWishEntity
            ? 17
            : 13;
    entity.point.outlineWidth = entity === selectedWishEntity ? 4 : 3;
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
