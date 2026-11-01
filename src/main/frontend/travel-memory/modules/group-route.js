/**
 * 行程在地球上的路线、序号和机位。
 *
 * 只负责 Cesium 图元；成员排序、距离和是否有路线由 footprint-group-model.js 决定。
 */

import { accentHex } from '../../shared/accent.js';

let deps = null;
let routeEntities = [];
let savedCameraView = null;

export function setupGroupRoute(d) {
    deps = d;
}

export function clearGroupRoute() {
    if (!deps) return;
    routeEntities.forEach(entity => deps.viewer().entities.remove(entity));
    routeEntities = [];
}

export function rememberGroupCamera() {
    if (!deps || savedCameraView) return;
    const viewer = deps.viewer();
    if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return;
    const camera = viewer.camera;
    savedCameraView = {
        destination: Cesium.Cartesian3.clone(camera.positionWC, new Cesium.Cartesian3()),
        orientation: {
            heading: camera.heading,
            pitch: camera.pitch,
            roll: camera.roll
        }
    };
}

export function restoreGroupCamera(duration = 1) {
    if (!deps || !savedCameraView) return false;
    const view = savedCameraView;
    savedCameraView = null;
    const viewer = deps.viewer();
    if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return false;
    viewer.camera.cancelFlight();
    viewer.camera.flyTo({
        destination: view.destination,
        orientation: view.orientation,
        duration
    });
    return true;
}

function routeColor(alpha = 1) {
    return Cesium.Color.fromCssColorString(accentHex()).withAlpha(alpha);
}

function positionOf(member) {
    const index = deps.footprints().indexOf(member);
    const position = index >= 0 ? deps.positions()[index] : null;
    return position || { lng: member.lng, lat: member.lat };
}

function hasCoordinate(member) {
    const lng = Number(member && member.lng);
    const lat = Number(member && member.lat);
    return Number.isFinite(lng) && Number.isFinite(lat) &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 &&
        !(lng === 0 && lat === 0);
}

export function showGroupRoute(group) {
    clearGroupRoute();
    if (!deps || !group) return;

    if (group.groupType === 'trip') {
        group.segments.forEach(segment => {
            if (segment.km == null) return;
            const from = positionOf(segment.from);
            const to = positionOf(segment.to);
            routeEntities.push(deps.viewer().entities.add({
                polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray([from.lng, from.lat, to.lng, to.lat]),
                    width: 7,
                    material: routeColor(0.16),
                    arcType: Cesium.ArcType.GEODESIC
                }
            }));
            routeEntities.push(deps.viewer().entities.add({
                polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray([from.lng, from.lat, to.lng, to.lat]),
                    width: 2.4,
                    material: routeColor(0.92),
                    arcType: Cesium.ArcType.GEODESIC
                }
            }));
        });
    }

    group.members.forEach((member, index) => {
        if (!hasCoordinate(member)) return;
        const position = positionOf(member);
        routeEntities.push(deps.viewer().entities.add({
            position: Cesium.Cartesian3.fromDegrees(position.lng, position.lat, 18),
            label: {
                text: String(index + 1),
                font: '600 13px "MiSans", sans-serif',
                fillColor: Cesium.Color.WHITE,
                backgroundColor: routeColor(0.94),
                backgroundPadding: new Cesium.Cartesian2(6, 3),
                showBackground: true,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -24)
            }
        }));
    });
}

export function flyToGroup(group, duration = 1.5) {
    if (!deps || !group || !group.members.length) return;
    const positions = group.members.map(member => {
        const position = positionOf(member);
        return Cesium.Cartesian3.fromDegrees(position.lng, position.lat);
    });
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    sphere.radius = Math.max(sphere.radius, 80000);
    deps.viewer().camera.flyToBoundingSphere(sphere, {
        duration,
        offset: new Cesium.HeadingPitchRange(
            0,
            Cesium.Math.toRadians(-55),
            Math.max(420000, sphere.radius * 2.35)
        )
    });
}

export function flyToGroupMember(member, duration = 0.8) {
    if (!deps || !member || !hasCoordinate(member)) return;
    const position = positionOf(member);
    const zoom = Number(member.zoomLevel) || 10;
    const height = Math.max(
        1200,
        Math.min(
            900000,
            (156543.03392 * Math.cos(Cesium.Math.toRadians(Number(position.lat) || 0))) /
                Math.pow(2, Math.max(3, Math.min(20, zoom))) * 1000
        )
    );
    deps.viewer().camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(position.lng, position.lat, height),
        duration
    });
}
