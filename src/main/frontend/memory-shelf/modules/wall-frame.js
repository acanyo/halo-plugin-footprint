/**
 * 书架墙面相框：显示当前省份城市章节的代表照片，并在切换省份时交叉淡入。
 */

import { loadImage } from './cover-photos.js';
import { roomTint } from './room-theme.js';
import { els, maxAnisotropy, reduceMotion, shelf, state } from './state.js';
import { makeCanvas } from './textures.js';
import { api, clamp, lerp, smoothstep } from './utils.js';

var frameUpdateToken = 0;

export function frameSubject(book) {
    if (!book) return null;
    var cities = book.cities || [];
    var city = cities.find(function (item) { return !!item.cover; }) || cities[0] || null;
    return {
        book: book,
        city: city,
        name: city ? city.name : book.name,
        date: city && city.latestTime ? city.latestTime : book.latestTime,
        image: (city && city.cover) || book.cover || ''
    };
}

function drawImageCover(ctx, image, x, y, width, height) {
    var scale = Math.max(width / image.width, height / image.height);
    var sourceWidth = width / scale;
    var sourceHeight = height / scale;
    var sourceX = (image.width - sourceWidth) / 2;
    var sourceY = (image.height - sourceHeight) / 2;
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function paintWallFrameTexture(texture, book, image) {
    if (!texture || !texture.image || !book) return;
    var canvas = texture.image;
    var ctx = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    var inset = 10;
    var photoWidth = width - inset * 2;
    var photoHeight = height - inset * 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (image && image.width && image.height) {
        drawImageCover(ctx, image, inset, inset, photoWidth, photoHeight);
        var wash = ctx.createLinearGradient(0, inset, 0, inset + photoHeight);
        wash.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
        wash.addColorStop(0.64, 'rgba(0, 0, 0, 0.02)');
        wash.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
        ctx.fillStyle = wash;
        ctx.fillRect(inset, inset, photoWidth, photoHeight);
    } else {
        var fallback = ctx.createLinearGradient(0, inset, width, inset + photoHeight);
        fallback.addColorStop(0, roomTint(state.active, 'wall'));
        fallback.addColorStop(1, roomTint(state.active, 'floor'));
        ctx.fillStyle = fallback;
        ctx.fillRect(inset, inset, photoWidth, photoHeight);

        var stops = (book.cities || []).slice(0, 3);
        var startX = inset + 110;
        var endX = width - inset - 110;
        var routeY = height * 0.5;
        ctx.strokeStyle = roomTint(state.active, 'accent');
        ctx.globalAlpha = 0.38;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(startX, routeY);
        ctx.bezierCurveTo(width * 0.36, routeY - 100, width * 0.62, routeY + 92, endX, routeY);
        ctx.stroke();
        (stops.length ? stops : [{ name: book.name }]).forEach(function (city, index, list) {
            var ratio = list.length === 1 ? 0.5 : index / (list.length - 1);
            var x = lerp(startX, endX, ratio);
            var y = routeY + Math.sin(ratio * Math.PI * 2) * 54;
            ctx.beginPath();
            ctx.fillStyle = roomTint(state.active, 'accent');
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = roomTint(state.active, 'woodDark');
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 2;
    ctx.strokeRect(inset, inset, photoWidth, photoHeight);
    ctx.globalAlpha = 1;
    texture.needsUpdate = true;
}

export function createWallFrame(THREE, scene, woodDarkMaterial) {
    var frameWoodMaterial = woodDarkMaterial.clone();
    frameWoodMaterial.emissive = new THREE.Color(roomTint(state.active, 'accent'));
    frameWoodMaterial.emissiveIntensity = 0;

    var wallFrame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.96, 0.06), frameWoodMaterial);
    wallFrame.position.set(2.7, 2.15, -3.56);
    wallFrame.receiveShadow = true;
    scene.add(wallFrame);

    var framePaper = new THREE.Mesh(
        new THREE.PlaneGeometry(1.12, 0.78),
        new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 })
    );
    framePaper.position.set(2.7, 2.15, -3.52);
    scene.add(framePaper);

    var frameCanvases = [makeCanvas(1080, 740), makeCanvas(1080, 740)];
    var frameTextures = frameCanvases.map(function (canvas) {
        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = maxAnisotropy;
        return texture;
    });
    var frameMeshes = frameTextures.map(function (texture, index) {
        var mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1.08, 0.74),
            new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.72,
                metalness: 0,
                transparent: true,
                opacity: 0,
                depthWrite: false
            })
        );
        mesh.position.set(2.7, 2.15, -3.512 + index * 0.002);
        mesh.renderOrder = 2 + index;
        mesh.visible = false;
        scene.add(mesh);
        return mesh;
    });
    var frameLight = new THREE.PointLight(roomTint(state.active, 'light'), 0.52, 2.6, 2);
    frameLight.position.set(2.7, 2.72, -2.72);
    scene.add(frameLight);

    return {
        wallFrame: wallFrame,
        framePaper: framePaper,
        frameTextures: frameTextures,
        frameMeshes: frameMeshes,
        frameMaterials: frameMeshes.map(function (mesh) { return mesh.material; }),
        frameHitObjects: [wallFrame, framePaper, frameMeshes[0], frameMeshes[1]],
        frameLight: frameLight,
        frameActive: -1,
        frameFade: null,
        frameHover: false,
        frameSubject: null
    };
}

function swapWallFrame(book, image, instant) {
    if (!shelf || !shelf.frameTextures || !book) return;
    var next = shelf.frameActive === 0 ? 1 : 0;
    paintWallFrameTexture(shelf.frameTextures[next], book, image);
    shelf.frameMeshes[next].visible = true;
    shelf.frameMeshes[next].position.z = -3.508;
    if (shelf.frameActive >= 0) shelf.frameMeshes[shelf.frameActive].position.z = -3.512;
    if (instant || reduceMotion || shelf.frameActive < 0) {
        shelf.frameMaterials.forEach(function (material, index) {
            material.opacity = index === next ? 1 : 0;
        });
        shelf.frameTextures.forEach(function (texture, index) {
            if (index !== next) shelf.frameMeshes[index].visible = false;
        });
        shelf.frameActive = next;
        shelf.frameFade = null;
        return;
    }
    shelf.frameMaterials[next].opacity = 0;
    shelf.frameFade = {
        from: shelf.frameActive,
        to: next,
        start: performance.now(),
        duration: 420
    };
    shelf.frameActive = next;
}

export function updateWallFrame(book, instant) {
    if (!shelf || !book) return;
    var subject = frameSubject(book);
    var token = ++frameUpdateToken;
    shelf.frameSubject = subject;
    if (!subject.image) {
        swapWallFrame(book, null, instant);
        return;
    }
    if (shelf.frameActive < 0) swapWallFrame(book, null, true);
    var d = api();
    var thumb = d && d.cityCardImageUrl
        ? (d.cityCardImageUrl(subject.image) || subject.image)
        : subject.image;
    loadImage(thumb).then(function (image) {
        if (!shelf || shelf.disposed || token !== frameUpdateToken) return;
        swapWallFrame(book, image, instant);
    }).catch(function () {
        if (!shelf || shelf.disposed || token !== frameUpdateToken) return;
        swapWallFrame(book, null, instant);
    });
}

export function updateWallFrameFade(delta) {
    if (!shelf || !shelf.frameMaterials) return;
    var response = reduceMotion ? 1 : Math.min(1, delta * 8);
    if (shelf.frameLight) {
        shelf.frameLight.intensity = lerp(
            shelf.frameLight.intensity,
            shelf.frameHover ? 0.9 : 0.52,
            response
        );
    }
    if (shelf.wallFrame && shelf.wallFrame.material) {
        shelf.wallFrame.material.emissiveIntensity = lerp(
            shelf.wallFrame.material.emissiveIntensity,
            shelf.frameHover ? 0.18 : 0,
            response
        );
    }
    if (!shelf.frameFade) return;
    var fade = shelf.frameFade;
    var progress = clamp((performance.now() - fade.start) / fade.duration, 0, 1);
    var eased = smoothstep(progress);
    shelf.frameMaterials[fade.from].opacity = 1 - eased;
    shelf.frameMaterials[fade.to].opacity = eased;
    if (progress >= 1) {
        shelf.frameMeshes[fade.from].visible = false;
        shelf.frameMaterials[fade.from].opacity = 0;
        shelf.frameMaterials[fade.to].opacity = 1;
        shelf.frameFade = null;
    }
}

export function wallFrameHitTest(event) {
    if (!shelf || state.mode !== 'shelf' || !shelf.frameHitObjects) return false;
    var rect = els.stage.getBoundingClientRect();
    shelf.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    shelf.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    shelf.raycaster.setFromCamera(shelf.pointer, shelf.camera);
    return shelf.raycaster.intersectObjects(shelf.frameHitObjects, false).length > 0;
}

export function setWallFrameHover(hovered) {
    if (!shelf) return;
    shelf.frameHover = !!hovered;
    if (els.stage) els.stage.classList.toggle('frame-hover', shelf.frameHover);
}

export function syncWallFrameAction() {
    var action = els.stage && els.stage.querySelector('.ms-wall-frame-action');
    if (!action || !shelf || !shelf.camera || state.mode !== 'shelf') {
        if (action) action.hidden = true;
        return;
    }
    var subject = shelf.frameSubject;
    action.hidden = !subject || !subject.city;
    if (action.hidden) return;
    shelf.camera.updateMatrixWorld();
    var rect = els.stage.getBoundingClientRect();
    var center = new shelf.THREE.Vector3(2.7, 2.15, -3.51).project(shelf.camera);
    var halfW = new shelf.THREE.Vector3(3.35, 2.15, -3.51).project(shelf.camera);
    var halfH = new shelf.THREE.Vector3(2.7, 2.63, -3.51).project(shelf.camera);
    var centerX = (center.x + 1) * rect.width / 2;
    var centerY = (1 - center.y) * rect.height / 2;
    var width = Math.abs((halfW.x + 1) * rect.width / 2 - centerX) * 2;
    var height = Math.abs((1 - halfH.y) * rect.height / 2 - centerY) * 2;
    action.style.left = centerX.toFixed(1) + 'px';
    action.style.top = centerY.toFixed(1) + 'px';
    action.style.width = Math.max(44, width).toFixed(1) + 'px';
    action.style.height = Math.max(44, height).toFixed(1) + 'px';
    action.setAttribute('aria-label', '打开' + (subject.name || '墙上') + '的旅行照片');
}

export function disposeWallFrame() {
    if (!shelf) return;
    (shelf.frameTextures || []).forEach(function (texture) {
        if (texture && texture.dispose) texture.dispose();
    });
    (shelf.frameMaterials || []).forEach(function (material) {
        if (material && material.dispose) material.dispose();
    });
    (shelf.frameMeshes || []).forEach(function (mesh) {
        if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
    });
    if (shelf.framePaper) {
        if (shelf.framePaper.geometry && shelf.framePaper.geometry.dispose) {
            shelf.framePaper.geometry.dispose();
        }
        if (shelf.framePaper.material && shelf.framePaper.material.dispose) {
            shelf.framePaper.material.dispose();
        }
    }
    if (shelf.wallFrame && shelf.wallFrame.material && shelf.wallFrame.material.dispose) {
        shelf.wallFrame.material.dispose();
    }
    if (shelf.wallFrame && shelf.wallFrame.geometry && shelf.wallFrame.geometry.dispose) {
        shelf.wallFrame.geometry.dispose();
    }
}
