/**
 * 行程在地球上的路线、序号和机位。
 *
 * 只负责 Cesium 图元；成员排序、距离和是否有路线由 footprint-group-model.js 决定。
 */

import { accentHex } from '../../shared/accent.js';

let deps = null;
let routeEntities = [];
let savedCameraView = null;
const GROUP_VIEW_MIN_RANGE = 160000;
const GROUP_VIEW_MAX_RANGE = 30000000;
const GROUP_MARKER_TOP_INSET = 34;
const GROUP_MARKER_BOTTOM_INSET = 44;

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

function groupViewportFrame() {
    const canvas = deps.viewer().scene.canvas;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const horizontalInset = Math.max(28, Math.round(width * 0.035));
    const top = Math.max(64, Math.round(height * 0.065));
    const dock = document.getElementById('footprintGroupMapDock');
    const dockTop = dock && !dock.hidden
        ? dock.getBoundingClientRect().top
        : height;
    const bottom = Math.max(
        top + 120,
        Math.min(
            height - Math.max(36, Math.round(height * 0.04)),
            dockTop - Math.max(36, Math.round(height * 0.04))
        )
    );
    return {
        width,
        height,
        left: horizontalInset,
        right: width - horizontalInset,
        top,
        bottom,
        verticalFov: deps.viewer().camera.frustum.fovy ||
            deps.viewer().camera.frustum.fov ||
            Cesium.Math.toRadians(45)
    };
}

function groupCameraGeometry(points, sphere, range, northShift, frame) {
    const centerFrame = Cesium.Transforms.eastNorthUpToFixedFrame(sphere.center);
    const destination = Cesium.Matrix4.multiplyByPoint(
        centerFrame,
        new Cesium.Cartesian3(0, northShift, range),
        new Cesium.Cartesian3()
    );
    const cameraFrame = Cesium.Transforms.eastNorthUpToFixedFrame(destination);
    const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.negate(destination, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
    );
    const right = Cesium.Matrix4.multiplyByPointAsVector(
        cameraFrame,
        Cesium.Cartesian3.UNIT_X,
        new Cesium.Cartesian3()
    );
    const up = Cesium.Matrix4.multiplyByPointAsVector(
        cameraFrame,
        Cesium.Cartesian3.UNIT_Y,
        new Cesium.Cartesian3()
    );
    const tanHalfY = Math.tan(frame.verticalFov / 2);
    const aspect = frame.width / frame.height;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
        const relative = Cesium.Cartesian3.subtract(point, destination, new Cesium.Cartesian3());
        const depth = Cesium.Cartesian3.dot(relative, direction);
        if (!(depth > 0)) return null;
        const nx = Cesium.Cartesian3.dot(relative, right) / depth / (tanHalfY * aspect);
        const ny = Cesium.Cartesian3.dot(relative, up) / depth / tanHalfY;
        const x = (0.5 + nx / 2) * frame.width;
        const y = (0.5 - ny / 2) * frame.height;
        // 路线装框要包含地标圆点和下方名称，不能只按经纬度投影中心计算。
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y - GROUP_MARKER_TOP_INSET);
        maxY = Math.max(maxY, y + GROUP_MARKER_BOTTOM_INSET);
    }
    return { destination, direction, up, minX, maxX, minY, maxY };
}

function fitGroupCamera(points, sphere) {
    const frame = groupViewportFrame();
    const targetCenterY = (frame.top + frame.bottom) / 2;
    const fitAtRange = (range) => {
        const maxNorthShift = range * Math.tan(frame.verticalFov / 2) * 1.5;
        let lowShift = -maxNorthShift;
        let highShift = maxNorthShift;
        let geometry = null;
        for (let i = 0; i < 26; i += 1) {
            const northShift = (lowShift + highShift) / 2;
            geometry = groupCameraGeometry(points, sphere, range, northShift, frame);
            if (!geometry) {
                lowShift = northShift;
                continue;
            }
            const centerY = (geometry.minY + geometry.maxY) / 2;
            if (centerY > targetCenterY) highShift = northShift;
            else lowShift = northShift;
        }
        return geometry;
    };

    let lowRange = Math.max(GROUP_VIEW_MIN_RANGE, sphere.radius * 0.8);
    let highRange = Math.max(GROUP_VIEW_MAX_RANGE, sphere.radius * 12);
    let best = null;
    for (let i = 0; i < 32; i += 1) {
        const range = (lowRange + highRange) / 2;
        const geometry = fitAtRange(range);
        const fits = geometry &&
            geometry.minX >= frame.left &&
            geometry.maxX <= frame.right &&
            geometry.minY >= frame.top &&
            geometry.maxY <= frame.bottom;
        if (fits) {
            best = geometry;
            highRange = range;
        } else {
            lowRange = range;
        }
    }
    return best || fitAtRange(highRange);
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
    const cameraFit = fitGroupCamera(positions, sphere);
    deps.viewer().camera.flyTo({
        destination: cameraFit.destination,
        orientation: { direction: cameraFit.direction, up: cameraFit.up },
        duration
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
