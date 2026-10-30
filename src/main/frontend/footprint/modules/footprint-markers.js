/**
 * 足迹标记点：渲染、点击打开图片墙 / 信息窗口、图片墙定位与翻页，
 * 以及与之共享闭包状态的全屏、返回中国地图、留言板按钮。
 */

import { debounce } from './debounce.js';
import { isMobile } from './env.js';
import { zoomOff2, zoomOn2 } from './hover-zoom.js';
import { moveToLocation, restoreMapOrientation } from './map-motion.js';
import { createInfoWindow, createMarker } from './marker-content.js';
import { clearMarkerInteractionState } from './marker-visibility.js';
import { closePhotoLightbox, openPhotoLightbox } from './photo-lightbox.js';
import { createPhotoWall, getPhotoWallPageSize, normalizeGalleryImages } from './photo-wall.js';
import { markerCache, state } from './state.js';
import { closeTimelineDrawer } from './timeline-drawer.js';

// 添加足迹标记
export const addFootprintMarkers = async (map, footprintData) => {
    // 创建信息窗体
    let infoWindow = new AMap.InfoWindow({
        isCustom: true,
        autoMove: false,
        // 桌面端卡片挂在标记右侧、与标记竖直居中：卡片有 370px 高，放在标记上方时屏幕中间的标记会把它顶出视口。
        // 手机屏窄，右侧放不下，改回标记正上方
        anchor: isMobile ? 'bottom-center' : 'middle-left',
        offset: isMobile ? new AMap.Pixel(0, -76) : new AMap.Pixel(40, -40)
    });

    // 用于存储当前打开的标记
    let currentMarker = null;
    let isMapMoving = false;
    let photoWallState = null;
    const photoWallLayer = document.getElementById('photo-wall-layer');
    const logoContainer = document.querySelector('.logo-container');
    let photoWallElement = null;
    let photoWallConnector = null;
    let photoWallWheelUnlockTimer = null;
    let photoWallCloseTimer = null;
    let photoWallClosingElement = null;
    // 图片墙打开以来地图到过的最大缩放级别。「缩小」以它为准，而不是直接拿当前级别比：
    // 从全国视野点标记时，飞行动画没走完（慢机器上常见）图片墙就已经出来了，
    // 这时级别还在往上涨，不能当成用户在缩小、把图片墙收掉。
    let photoWallPeakZoom = -Infinity;
    const PHOTO_WALL_CLOSE_ZOOM = 10;
    const PHOTO_WALL_CLOSE_ANIMATION_MS = 420;

    const getFootprintZoomLevel = (spec) => {
        const configuredZoomLevel = Number(spec?.zoomLevel);
        return Number.isFinite(configuredZoomLevel) && configuredZoomLevel >= 3
                ? Math.min(20, Math.max(3, configuredZoomLevel))
                : 12;
    };


    const cancelPhotoWallClose = () => {
        if (photoWallCloseTimer) {
            window.clearTimeout(photoWallCloseTimer);
            photoWallCloseTimer = null;
        }
        photoWallClosingElement = null;
    };

    const closeCurrentMarker = () => {
        cancelPhotoWallClose();
        infoWindow.close();
        closePhotoLightbox();
        document.body.classList.remove('photo-wall-mobile-open');
        if (photoWallWheelUnlockTimer) {
            window.clearTimeout(photoWallWheelUnlockTimer);
            photoWallWheelUnlockTimer = null;
        }
        photoWallElement?.remove();
        photoWallConnector?.remove();
        logoContainer?.classList.remove('photo-wall-active');
        photoWallElement = null;
        photoWallConnector = null;
        currentMarker = null;
        photoWallState = null;
        if (state.isElevation || state.isElevationRestoring) {
            restoreMapOrientation(map);
        }
    };

    const closePhotoWallWithAnimation = () => {
        if (!photoWallElement) {
            closeCurrentMarker();
            return;
        }
        if (photoWallClosingElement === photoWallElement) return;

        const closingElement = photoWallElement;
        const closingConnector = photoWallConnector;
        photoWallClosingElement = closingElement;
        closingElement.style.removeProperty('animation');
        closingConnector?.style.removeProperty('opacity');
        closingElement.classList.add('photo-wall-closing');
        closingConnector?.classList.add('photo-wall-closing');
        photoWallCloseTimer = window.setTimeout(() => {
            photoWallCloseTimer = null;
            photoWallClosingElement = null;
            if (photoWallElement === closingElement) {
                closeCurrentMarker();
            }
        }, PHOTO_WALL_CLOSE_ANIMATION_MS);
    };
    state.closeActiveFootprint = closeCurrentMarker;

    state.footprintMarkerController?.setOnVisibilityChange((visible) => {
        if (!visible) {
            closeCurrentMarker();
            clearMarkerInteractionState();
        }
    });

    // 用于跟踪当前触摸状态
    let isDragging = false;
    let touchStartPos = null;

    map.on('touchstart', (e) => {
        if (currentMarker) {
            // 如果信息窗口已打开，允许地图拖动
            map.setDefaultCursor('grab');
        }
    });

    map.on('touchmove', (e) => {
        if (currentMarker) {
            // 拖动地图时关闭信息窗口
            // infoWindow.close();
            // currentMarker = null;
        }
    });

    map.on('touchend', (e) => {
        map.setDefaultCursor('');
    });

    // 创建事件处理防抖函数
    const debouncedUpdate = debounce(() => {
        isMapMoving = false;
    }, 150);

    // 创建事件委托处理函数
    const handleMapClick = (e) => {
        closeCurrentMarker();
    };

    // 创建信息窗口事件处理函数
    const handleInfoWindowClick = (e) => {
        e.stopPropagation();
    };

    const getMarkerLayerPoint = () => {
        if (!currentMarker || !photoWallLayer) return null;
        const mapContainer = document.getElementById('footprint-map');
        const position = currentMarker.getPosition?.();
        if (!mapContainer || !position || !map.lngLatToContainer) return null;

        const pixel = map.lngLatToContainer(position);
        const mapRect = mapContainer.getBoundingClientRect();
        const layerRect = photoWallLayer.getBoundingClientRect();
        const pixelX = typeof pixel?.getX === 'function' ? pixel.getX() : pixel?.x;
        const pixelY = typeof pixel?.getY === 'function' ? pixel.getY() : pixel?.y;
        if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return null;
        const layerWidth = photoWallLayer.clientWidth || photoWallLayer.offsetWidth || window.innerWidth;
        const layerHeight = photoWallLayer.clientHeight || photoWallLayer.offsetHeight || window.innerHeight;
        return {
            x: mapRect.left - layerRect.left + pixelX,
            y: mapRect.top - layerRect.top + pixelY,
            width: layerWidth,
            height: layerHeight
        };
    };

    const positionPhotoWall = () => {
        if (isMobile) return;
        if (!photoWallElement || !photoWallConnector) return;
        const markerPoint = getMarkerLayerPoint();
        if (!markerPoint) return;

        const margin = 28;
        const wallWidth = photoWallElement.offsetWidth || 620;
        const wallHeight = photoWallElement.offsetHeight || 420;
        const statsElement = document.getElementById('map-stats');
        const layerRect = photoWallLayer.getBoundingClientRect();
        const layerLeft = Number.isFinite(layerRect.left) ? layerRect.left : 0;
        const layerTop = Number.isFinite(layerRect.top) ? layerRect.top : 0;
        const statsRect = statsElement?.getBoundingClientRect();
        const statsBox = statsRect && statsRect.width > 0 && statsRect.height > 0 ? {
            left: statsRect.left - layerLeft,
            top: statsRect.top - layerTop,
            right: statsRect.right - layerLeft,
            bottom: statsRect.bottom - layerTop
        } : null;
        const isInsideLayer = (candidate) => candidate.left >= margin
                && candidate.top >= margin
                && candidate.left + wallWidth <= markerPoint.width - margin
                && candidate.top + wallHeight <= markerPoint.height - margin;
        const overlapsStats = (candidate) => statsBox && candidate.left < statsBox.right + margin
                && candidate.left + wallWidth > statsBox.left - margin
                && candidate.top < statsBox.bottom + margin
                && candidate.top + wallHeight > statsBox.top - margin;

        // 默认固定在右上角；若与统计窗口冲突，则依次尝试统计窗口下方、左侧和右下角。
        const candidates = [
            {left: markerPoint.width - wallWidth - margin, top: margin},
            {left: markerPoint.width - wallWidth - margin, top: statsBox ? statsBox.bottom + margin : margin},
            {left: statsBox ? statsBox.left - wallWidth - margin : margin, top: margin},
            {left: markerPoint.width - wallWidth - margin, top: markerPoint.height - wallHeight - margin}
        ];
        const selectedPosition = candidates.find(candidate => isInsideLayer(candidate) && !overlapsStats(candidate))
                || candidates[0];
        const left = Math.max(margin, Math.min(selectedPosition.left, markerPoint.width - wallWidth - margin));
        const top = Math.max(margin, Math.min(selectedPosition.top, markerPoint.height - wallHeight - margin));
        photoWallElement.style.left = `${left}px`;
        photoWallElement.style.top = `${top}px`;
        // 弹出动画从标记点方向长出来
        photoWallElement.style.transformOrigin = `${Math.round(markerPoint.x - left)}px ${Math.round(markerPoint.y - top)}px`;

        const anchorX = markerPoint.x < left ? left : markerPoint.x > left + wallWidth ? left + wallWidth : left + wallWidth / 2;
        const anchorY = Math.max(top + 48, Math.min(markerPoint.y, top + wallHeight - 48));
        const deltaX = anchorX - markerPoint.x;
        const deltaY = anchorY - markerPoint.y;
        const length = Math.max(1, Math.hypot(deltaX, deltaY));
        photoWallConnector.style.left = `${markerPoint.x}px`;
        photoWallConnector.style.top = `${markerPoint.y}px`;
        photoWallConnector.style.width = `${length}px`;
        photoWallConnector.style.transform = `rotate(${Math.atan2(deltaY, deltaX)}rad)`;
    };

    const updateMobilePhotoWallLayout = () => {
        if (!isMobile || !photoWallElement) return;
        const heading = photoWallElement.querySelector('.photo-wall-heading');
        const canvas = photoWallElement.querySelector('.photo-wall-canvas');
        if (!heading || !canvas) return;

        const canvasTop = Math.max(76, heading.offsetTop + heading.offsetHeight + 12);
        photoWallElement.style.setProperty('--photo-wall-canvas-top', `${canvasTop}px`);
    };

    const renderPhotoWall = () => {
        if (!photoWallLayer || !photoWallState) return;
        photoWallElement?.remove();
        photoWallConnector?.remove();

        photoWallElement = document.createElement('div');
        photoWallElement.className = 'photo-wall-window';
        if (isMobile) {
            photoWallElement.classList.add('photo-wall-mobile');
            document.body.classList.add('photo-wall-mobile-open');
        }
        photoWallElement.innerHTML = createPhotoWall(photoWallState.spec, photoWallState.page);
        const filmstrip = photoWallElement.querySelector('.photo-wall-filmstrip');
        const journalGrid = photoWallElement.querySelector('.photo-wall-journal-grid');
        const journalWall = photoWallElement.querySelector('.photo-wall-variant-c');
        if (journalWall instanceof HTMLElement) {
            const journalHeight = journalWall.style.getPropertyValue('--journal-wall-height').trim();
            if (journalHeight) {
                photoWallElement.style.height = journalHeight;
                photoWallElement.style.setProperty('--journal-wall-height', journalHeight);
            }
        }
        if (photoWallElement.querySelector('.photo-wall-variant-a')) {
            photoWallElement.classList.add('photo-wall-host-a');
        }
        photoWallElement.addEventListener('click', handlePhotoWallClick);
        photoWallElement.addEventListener('wheel', (event) => {
            const wheelTarget = event.target instanceof Element
                    ? event.target.closest('.photo-wall-filmstrip')
                    : null;
            if (filmstrip instanceof HTMLElement && wheelTarget) {
                const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
                        ? event.deltaX
                        : event.deltaY;
                if (!delta) return;
                event.preventDefault();
                filmstrip.scrollBy({left: delta * 1.2, behavior: 'smooth'});
                return;
            }
            const journalTarget = event.target instanceof Element
                    ? event.target.closest('.photo-wall-journal-grid')
                    : null;
            if (journalGrid instanceof HTMLElement && journalTarget
                    && journalGrid.scrollHeight > journalGrid.clientHeight) {
                event.preventDefault();
                journalGrid.scrollBy({top: event.deltaY, behavior: 'smooth'});
                return;
            }
            if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
            event.preventDefault();
            if (photoWallWheelUnlockTimer) return;

            const action = event.deltaY > 0 ? 'next' : 'previous';
            const navigationButton = photoWallElement.querySelector(`[data-photo-action="${action}"]`);
            if (!(navigationButton instanceof HTMLButtonElement) || navigationButton.disabled) return;

            navigationButton.click();
            photoWallWheelUnlockTimer = window.setTimeout(() => {
                photoWallWheelUnlockTimer = null;
            }, 180);
        }, {passive: false});
        photoWallLayer.appendChild(photoWallElement);

        if (isMobile) {
            updateMobilePhotoWallLayout();
            requestAnimationFrame(updateMobilePhotoWallLayout);
        }
        if (!isMobile) {
            photoWallConnector = document.createElement('span');
            photoWallConnector.className = 'photo-wall-connector';
            photoWallLayer.insertBefore(photoWallConnector, photoWallElement);
            requestAnimationFrame(positionPhotoWall);
        }
    };

    const mobilePhotoWallResizeHandler = debounce(updateMobilePhotoWallLayout, 150);
    window.addEventListener('resize', mobilePhotoWallResizeHandler);

    const handlePhotoWallClick = (e) => {
        e.stopPropagation();
        if (!photoWallState) return;
        const target = e.target;
        if (!(target instanceof Element)) return;
        const actionTarget = target.closest('[data-photo-action]');
        const cardTarget = target.closest('[data-photo-index]');

        if (cardTarget) {
            const index = Number(cardTarget.getAttribute('data-photo-index'));
            openPhotoLightbox(photoWallState.images, index, photoWallState.spec.name);
            return;
        }

        const action = actionTarget?.getAttribute('data-photo-action');
        if (!action || !currentMarker) return;
        if (action === 'close') {
            closeCurrentMarker();
            return;
        }
        const nextPage = photoWallState.page + (action === 'next' ? 1 : -1);
        const totalPages = Math.ceil(photoWallState.images.length / photoWallState.pageSize);
        if (nextPage < 0 || nextPage >= totalPages) return;
        photoWallState.page = nextPage;

        // 只替换图片墙中间的卡片区域，保留窗口、标题、连接线和当前位置。
        if (!photoWallElement) return;
        const nextPageContainer = document.createElement('div');
        nextPageContainer.innerHTML = createPhotoWall(photoWallState.spec, nextPage);
        const nextWall = nextPageContainer.firstElementChild;
        const currentCanvas = photoWallElement.querySelector('.photo-wall-canvas');
        const nextCanvas = nextWall?.querySelector('.photo-wall-canvas');
        if (currentCanvas && nextCanvas) currentCanvas.replaceWith(nextCanvas);

        const nextJournalHeight = nextWall?.style?.getPropertyValue('--journal-wall-height')?.trim();
        if (nextJournalHeight) {
            photoWallElement.style.height = nextJournalHeight;
            photoWallElement.style.setProperty('--journal-wall-height', nextJournalHeight);
        }

        const currentCounter = photoWallElement.querySelector('.photo-wall-counter');
        const nextCounter = nextWall?.querySelector('.photo-wall-counter');
        if (currentCounter && nextCounter) currentCounter.textContent = nextCounter.textContent || '';

        const currentNavigation = photoWallElement.querySelectorAll('.photo-wall-nav');
        const nextNavigation = nextWall?.querySelectorAll('.photo-wall-nav') || [];
        currentNavigation.forEach((button, index) => {
            const nextButton = nextNavigation[index];
            if (nextButton instanceof HTMLButtonElement) {
                button.disabled = nextButton.disabled;
            }
        });
        photoWallElement.dataset.photoPage = String(nextPage);
        requestAnimationFrame(positionPhotoWall);
    };

    const handleArticleClick = (e) => {
        e.stopPropagation();
    };

    // 一次性添加信息窗口事件监听器
    const setupInfoWindowEvents = () => {
        const infoWindowElement = document.querySelector('.info-window');
        if (infoWindowElement) {
            infoWindowElement.addEventListener('click', handleInfoWindowClick);

            const articleBtn = infoWindowElement.querySelector('.popup-article-btn');
            if (articleBtn) {
                articleBtn.addEventListener('click', handleArticleClick);
            }
        }
    };

    // 监听地图移动状态
    map.on('movestart', () => {
        isMapMoving = true;
    });

    map.on('moveend', () => {
        debouncedUpdate();
        positionPhotoWall();
        if (!currentMarker) return;
        const bounds = map.getBounds?.();
        const position = currentMarker.getPosition?.();
        if (bounds && position && !bounds.contains(position)) closeCurrentMarker();
    });
    map.on('mapmove', positionPhotoWall);
    const handlePhotoWallZoomChange = () => {
        if (isMobile) return;
        positionPhotoWall();
        if (!currentMarker || !photoWallElement) return;
        if (photoWallClosingElement === photoWallElement) return;
        const zoom = Number(map.getZoom());
        // 缩小起点是标记点的 zoomLevel；地图还没飞到那一级时，以打开以来到过的最大级别为起点
        const footprintZoom = getFootprintZoomLevel(photoWallState?.spec);
        if (!Number.isFinite(zoom) || !Number.isFinite(footprintZoom)) return;
        photoWallPeakZoom = Math.max(photoWallPeakZoom, zoom);
        const openZoom = Math.min(footprintZoom, photoWallPeakZoom);

        if (zoom >= openZoom) {
            photoWallElement.classList.remove('photo-wall-zooming-out');
            photoWallElement.style.removeProperty('transform');
            photoWallElement.style.removeProperty('zoom');
            photoWallElement.style.removeProperty('opacity');
            photoWallElement.style.removeProperty('--photo-wall-zoom-progress');
            photoWallElement.style.removeProperty('--photo-wall-zoom-scale');
            photoWallElement.style.removeProperty('--photo-wall-zoom-opacity');
            photoWallConnector?.style.removeProperty('opacity');
            return;
        }

        const zoomRange = Math.max(0.5, openZoom - PHOTO_WALL_CLOSE_ZOOM);
        const progress = Math.max(0, Math.min(1, (openZoom - zoom) / zoomRange));
        const scale = 1 - progress * 0.28;
        const opacity = 1 - progress * 0.12;
        photoWallElement.classList.add('photo-wall-zooming-out');
        // 停止入场动画，避免 animation 的最终帧覆盖缩放过程中的样式。
        photoWallElement.style.animation = 'none';
        // 使用布局级 zoom，避免 transform: scale() 将整张图片墙栅格化后再采样，导致文字和图片变糊。
        photoWallElement.style.removeProperty('transform');
        photoWallElement.style.zoom = scale.toFixed(3);
        photoWallElement.style.opacity = opacity.toFixed(3);
        photoWallElement.style.setProperty('--photo-wall-zoom-progress', progress.toFixed(3));
        photoWallElement.style.setProperty('--photo-wall-zoom-scale', scale.toFixed(3));
        photoWallElement.style.setProperty('--photo-wall-zoom-opacity', opacity.toFixed(3));
        if (photoWallConnector) {
            photoWallConnector.style.opacity = opacity.toFixed(3);
        }

        if (zoom <= PHOTO_WALL_CLOSE_ZOOM) {
            closePhotoWallWithAnimation();
        }
    };
    map.on('zoomchange', handlePhotoWallZoomChange);
    map.on('zoom', handlePhotoWallZoomChange);

    // 添加全局点击事件监听器
    map.on('click', handleMapClick);

    // 打开信息窗口的函数
    const openInfoWindow = (position, content) => {
        infoWindow.setContent(content);
        infoWindow.open(map, position);

        // 使用 requestAnimationFrame 确保 DOM 已更新
        requestAnimationFrame(setupInfoWindowEvents);
    };

    // 分批次渲染
    const batchSize = 1;
    let currentIndex = 0;

    // 先按创建时间降序排序
    const sortedFootprintData = [...footprintData].sort((a, b) => {
        const timeA = new Date(a.spec.createTime).getTime();
        const timeB = new Date(b.spec.createTime).getTime();
        return timeA - timeB;
    });

    const renderBatch = () => {
        const batch = sortedFootprintData.slice(currentIndex, currentIndex + batchSize);
        batch.forEach(footprint => {
            if (!Array.isArray(sortedFootprintData) || sortedFootprintData.length === 0) {
                console.warn('足迹数据为空或格式不正确');
                return;
            }

            const longitude = parseFloat(footprint.spec.longitude);
            const latitude = parseFloat(footprint.spec.latitude);

            if (isNaN(longitude) || isNaN(latitude)) {
                console.warn('无效的经纬度数据:', footprint);
                return;
            }

            try {
                const position = new AMap.LngLat(longitude, latitude);
                const markerContent = createMarker(footprint.spec);
                const marker = new AMap.Marker({
                    position: position,
                    content: markerContent,
                    anchor: 'bottom-center',
                    offset: new AMap.Pixel(0, -10),
                    extData: footprint.spec // 存储额外数据
                });

                // 处理点击事件
                const handleMarkerClick = async (marker) => {
                    // 如果当前标记已经打开，则关闭它
                    if (currentMarker === marker) {
                        closeCurrentMarker();
                        return;
                    }

                    // 先关闭当前窗体，并等待可能尚未完成的姿态还原。
                    closeCurrentMarker();
                    await restoreMapOrientation(map);

                    const galleryImages = normalizeGalleryImages(footprint.spec.galleryImages);
                    photoWallState = galleryImages.length ? {
                        images: galleryImages,
                        page: 0,
                        pageSize: getPhotoWallPageSize(),
                        spec: footprint.spec
                    } : null;

                    const zoomLevel = getFootprintZoomLevel(footprint.spec);
                    //时间线抽屉打开时设置中心点偏右
                    //
                    const position2 = new AMap.LngLat(longitude, latitude);
                    // 检查是否需要移动地图
                    const currentPos = map.getCenter();
                    const distance = position2.distance(currentPos);
                    const currentZoom = map.getZoom();

                    // 如果距离超过3公里或缩放级别不够，需要移动地图
                    const needsMovement = distance > 3000 || currentZoom !== zoomLevel;

                    if (needsMovement) {
                        zoomOff2(map);
                        zoomOn2(map, null);
                        await moveToLocation(map, position2, zoomLevel, 500);
                    }
                    currentMarker = marker;
                    photoWallPeakZoom = Number(map.getZoom());
                    // 有图片时桌面端展示地图外围图片墙，移动端展示底部抽屉式图片墙；
                    // 没有图片时保留原有信息窗口。
                    if (galleryImages.length) {
                        logoContainer?.classList.add('photo-wall-active');
                        renderPhotoWall();
                    } else {
                        openInfoWindow(position, createInfoWindow(footprint.spec));
                    }
                    if (zoomLevel >= 18) {
                        map.setPitch(Number(footprint.spec.pitchAngle));
                        map.setRotation(Number(footprint.spec.rotationAngle));
                        state.isElevation = true;
                    }
                };


                // 添加触摸事件处理
                const handleTouchStart = (e, marker) => {
                    if (e.touches.length !== 1) return;

                    touchStartPos = {
                        x: e.touches[0].clientX,
                        y: e.touches[0].clientY,
                        time: Date.now()
                    };
                    isDragging = false;
                };

                const handleTouchMove = (e, marker) => {
                    if (!touchStartPos || e.touches.length !== 1) return;

                    const touch = e.touches[0];
                    const deltaX = Math.abs(touch.clientX - touchStartPos.x);
                    const deltaY = Math.abs(touch.clientY - touchStartPos.y);

                    // 如果移动距离超过阈值，认为是拖拽
                    if (deltaX > 5 || deltaY > 5) {
                        isDragging = true;
                    }
                };

                const handleTouchEnd = async (e, marker, footprint) => {
                    if (!touchStartPos || e.changedTouches.length !== 1) return;

                    const touch = e.changedTouches[0];
                    const deltaX = Math.abs(touch.clientX - touchStartPos.x);
                    const deltaY = Math.abs(touch.clientY - touchStartPos.y);
                    const duration = Date.now() - touchStartPos.time;

                    // 如果是短按且移动距离小，则触发点击事件
                    if (!isDragging && duration < 300 && deltaX < 10 && deltaY < 10) {
                        e.preventDefault();
                        await handleMarkerClick(marker);
                    }

                    touchStartPos = null;
                };

                // 添加事件监听器
                // 高德回调的第一个参数是事件对象，不是 marker；这里显式传 marker，
                // 否则 currentMarker 拿不到 getPosition，图片墙无法定位、连接线也画不出来
                marker.on('click', () => handleMarkerClick(marker));

                // 为移动端添加触摸事件
                const markerElement = marker.getContent();
                if (markerElement) {
                    markerElement.addEventListener('touchstart', (e) => handleTouchStart(e, marker), {passive: true});
                    markerElement.addEventListener('touchmove', (e) => handleTouchMove(e, marker), {passive: true});
                    markerElement.addEventListener('touchend', (e) => handleTouchEnd(e, marker, footprint));
                }

                // 缓存标记点DOM引用，供抛物线动画使用
                // 缓存照片框而不是 img：没有图的标记画的是首字，图片加载失败时 img 也会被换掉
                const imgElement = markerContent.querySelector('.marker-image');
                if (imgElement) {
                    markerCache.set(footprint.spec.name, imgElement);
                }
                map.add(marker);
                state.footprintMarkerController?.register(marker, footprint);
            } catch (error) {
                console.error('创建标记失败:', error, footprint);
            }
        });

        currentIndex += batchSize;
        if (currentIndex < sortedFootprintData.length) {
            // 添加100ms的延迟后再渲染下一批
            setTimeout(() => {
                requestIdleCallback(renderBatch);
            }, 0);
        }
    };

    renderBatch();

    // 清理函数
    const cleanup = () => {
        closeCurrentMarker();
        window.removeEventListener('resize', mobilePhotoWallResizeHandler);
        if (state.closeActiveFootprint === closeCurrentMarker) {
            state.closeActiveFootprint = null;
        }
        map.off('movestart');
        map.off('moveend');
        map.off('mapmove', positionPhotoWall);
        map.off('zoomchange', handlePhotoWallZoomChange);
        map.off('zoom', handlePhotoWallZoomChange);
        cancelPhotoWallClose();
        map.off('click', handleMapClick);

        const infoWindowElement = document.querySelector('.info-window');
        if (infoWindowElement) {
            infoWindowElement.removeEventListener('click', handleInfoWindowClick);
            const articleBtn = infoWindowElement.querySelector('.popup-article-btn');
            if (articleBtn) {
                articleBtn.removeEventListener('click', handleArticleClick);
            }
        }
    };

    // 使用 pagehide 替代已被现代浏览器限制的 unload
    // 进入浏览器返回缓存时暂不清理，避免返回页面后地图事件失效
    window.addEventListener('pagehide', event => {
        if (!event.persisted) {
            cleanup();
        }
    });


    document.getElementById('messageBoards').addEventListener('click', () => {
        window.open('http://www.yunduan019.com/liu', '_blank');
    });

    const fullscreenButton = document.getElementById('map-fullscreen');
    const fullscreenTarget = document.getElementById('footprint-page');
    const updateFullscreenButton = () => {
        if (!fullscreenButton || !fullscreenTarget) return;
        const isFullscreen = document.fullscreenElement === fullscreenTarget;
        fullscreenButton.dataset.fullscreenState = isFullscreen ? 'exit' : 'enter';
        const tooltipText = isFullscreen ? '退出全屏地图' : '进入全屏地图';
        fullscreenButton.dataset.tooltip = tooltipText;
        fullscreenButton.setAttribute('aria-label', tooltipText);
        const tooltip = fullscreenButton.querySelector('.tooltip');
        if (tooltip) tooltip.textContent = tooltipText;
    };

    if (fullscreenButton && fullscreenTarget) {
        fullscreenButton.addEventListener('click', async () => {
            try {
                if (document.fullscreenElement) {
                    await document.exitFullscreen();
                } else if (fullscreenTarget.requestFullscreen) {
                    await fullscreenTarget.requestFullscreen();
                }
            } catch (error) {
                console.warn('切换全屏失败:', error);
            }
        });
        document.addEventListener('fullscreenchange', () => {
            updateFullscreenButton();
            map.resize();
            positionPhotoWall();
        });
        updateFullscreenButton();
    }

    document.getElementById('zoom-restore').addEventListener('click', async () => {
        // 返回中国地图前关闭当前标记点的图片墙
        closeCurrentMarker();
        await restoreMapOrientation(map);

        closeTimelineDrawer(map);

        // 关闭信息窗口
        infoWindow.close();
        currentMarker = null;
        const position = new AMap.LngLat(116.397428, 39.90923);
        moveToLocation(map, position, 4, 0);

        // 卸载所有图片
        const cards = document.querySelectorAll('.timeline-card');
        cards.forEach(card => {
            card.style.backgroundImage = 'none';
            card.classList.add('loading');
        });
    });
};
