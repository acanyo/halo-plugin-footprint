/**
 * 足迹标记点：渲染、点击飞过去并打开信息卡，
 * 以及与之共享闭包状态的全屏、返回中国地图按钮。留言板按钮由 shared/guestbook.js 接管。
 */

import { debounce } from './debounce.js';
import { isMobile } from './env.js';
import { zoomOff2, zoomOn2 } from './hover-zoom.js';
import { moveToLocation, restoreMapOrientation } from './map-motion.js';
import { createInfoWindow, createMarker } from './marker-content.js';
import { clearMarkerInteractionState } from './marker-visibility.js';
import { canOpenPhotoWall, createPhotoWallController } from './photo-wall.js';
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
    const photoWall = createPhotoWallController(map);
    const getFootprintZoomLevel = (spec) => {
        const configuredZoomLevel = Number(spec?.zoomLevel);
        return Number.isFinite(configuredZoomLevel) && configuredZoomLevel >= 3
                ? Math.min(20, Math.max(3, configuredZoomLevel))
                : 12;
    };
    const lockMapOrientation = () => {
        map.setStatus({animateEnable: false});
        map.setPitch(0, true);
        map.setRotation(0, true);
        map.setStatus({
            animateEnable: true,
            pitchEnable: false,
            rotateEnable: false
        });
        state.isElevation = false;
    };


    const closeCurrentMarker = () => {
        infoWindow.close();
        photoWall.close();
        currentMarker = null;
        if (state.isElevation || state.isElevationRestoring) {
            restoreMapOrientation(map);
        }
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

    const handleArticleClick = (e) => {
        e.stopPropagation();
    };

    // 一次性添加信息窗口事件监听器
    const setupInfoWindowEvents = () => {
        const infoWindowElement = document.querySelector('.info-window');
        if (infoWindowElement) {
            infoWindowElement.addEventListener('click', handleInfoWindowClick);

            const articleBtn = infoWindowElement.querySelector('.article-btn');
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
        if (!currentMarker) return;
        const bounds = map.getBounds?.();
        const position = currentMarker.getPosition?.();
        if (!state.groupMapMode && bounds && position && !bounds.contains(position)) {
            closeCurrentMarker();
        }
    });
    // 添加全局点击事件监听器
    map.on('click', handleMapClick);

    // 信息卡被右上角统计面板、底部控制栏或屏幕边压住时，挪一下地图让出来：
    // 先上下挪进「屏幕顶 ~ 控制栏」之间；还压着统计面板的话，放得下就挪到面板下方，
    // 放不下（矮窗口）就往左挪到面板左边。
    // 量的是高德包在卡片外面的那层：卡片自己在播弹出动画（缩放），量它会偏小。
    const keepInfoWindowClear = () => {
        const card = document.querySelector('.info-window');
        const box = card?.closest('.amap-info') || card;
        if (!box) return;
        const rect = box.getBoundingClientRect();
        if (!rect.height) return;
        const margin = 12;
        const visible = (r) => r && r.width > 0 && r.height > 0;
        const overlapsX = (r, left, right) => visible(r) && left < r.right && right > r.left;
        const statsElement = document.getElementById('map-stats');
        const statsStyle = statsElement ? getComputedStyle(statsElement) : null;
        const statsVisible = !!statsStyle &&
            statsStyle.visibility !== 'hidden' &&
            Number(statsStyle.opacity) > 0;
        const stats = statsVisible ? statsElement.getBoundingClientRect() : null;
        const controls = document.getElementById('map-controls')?.getBoundingClientRect();
        const bottomLimit = overlapsX(controls, rect.left, rect.right) ? controls.top - margin : window.innerHeight - margin;

        let deltaX = 0;
        let deltaY = 0;
        if (rect.top < margin) deltaY = margin - rect.top;
        else if (rect.bottom > bottomLimit) deltaY = bottomLimit - rect.bottom;
        const underStats = overlapsX(stats, rect.left, rect.right)
                && rect.top + deltaY < stats.bottom + margin && rect.bottom + deltaY > stats.top - margin;
        if (underStats) {
            if (rect.height <= bottomLimit - (stats.bottom + margin)) {
                deltaY = stats.bottom + margin - rect.top;
            } else {
                deltaX = stats.left - margin - rect.right;
            }
        }
        if (deltaX || deltaY) map.panBy(Math.round(deltaX), Math.round(deltaY));
    };

    // 打开信息窗口的函数
    const openInfoWindow = (position, content) => {
        infoWindow.setContent(content);
        infoWindow.open(map, position);

        // 使用 requestAnimationFrame 确保 DOM 已更新
        requestAnimationFrame(() => {
            setupInfoWindowEvents();
            keepInfoWindowClear();
        });
    };

    // 分批次渲染
    const batchSize = 1;
    let currentIndex = 0;

    // 先按访问时间降序排序
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
                markerContent.dataset.footprintKey = footprint.metadata?.name || '';
                const marker = new AMap.Marker({
                    position: position,
                    content: markerContent,
                    anchor: 'bottom-center',
                    offset: new AMap.Pixel(0, -10),
                    extData: footprint.spec // 存储额外数据
                });

                const zoomLevel = getFootprintZoomLevel(footprint.spec);
                const openMarkerEffect = () => {
                    currentMarker = marker;
                    if (!canOpenPhotoWall(footprint.spec)) {
                        state.photoWallCloseHandler = null;
                        openInfoWindow(position, createInfoWindow(footprint.spec));
                    } else {
                        const onClose = state.photoWallCloseHandler;
                        state.photoWallCloseHandler = null;
                        photoWall.open(marker, footprint.spec, markerContent, onClose);
                    }
                    if (state.groupMapMode) {
                        // 旅途集地图查看保持平面、正北；普通足迹点仍使用配置视角。
                        lockMapOrientation();
                    } else if (zoomLevel >= 18) {
                        map.setPitch(Number(footprint.spec.pitchAngle));
                        map.setRotation(Number(footprint.spec.rotationAngle));
                        state.isElevation = true;
                    }
                    return true;
                };

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

                    //时间线抽屉打开时设置中心点偏右
                    //
                    const position2 = new AMap.LngLat(longitude, latitude);
                    // 检查是否需要移动地图
                    const currentPos = map.getCenter();
                    const distance = position2.distance(currentPos);
                    const currentZoom = map.getZoom();

                    // 如果距离超过3公里或缩放级别不够，需要移动地图
                    const needsMovement = distance > 3000 || currentZoom !== zoomLevel;

                    if (needsMovement && !state.groupMapMode) {
                        zoomOff2(map);
                        zoomOn2(map, null);
                        await moveToLocation(map, position2, zoomLevel, 500);
                    }
                    openMarkerEffect();
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
                // 否则 currentMarker 拿不到 getPosition，移出视野时没法判断要不要收起信息卡
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
                state.footprintMarkerController?.register(
                    marker,
                    footprint,
                    openMarkerEffect
                );
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
    lockMapOrientation();

    // 清理函数
    const cleanup = () => {
        closeCurrentMarker();
        photoWall.destroy();
        if (state.closeActiveFootprint === closeCurrentMarker) {
            state.closeActiveFootprint = null;
        }
        map.off('movestart');
        map.off('moveend');
        map.off('click', handleMapClick);

        const infoWindowElement = document.querySelector('.info-window');
        if (infoWindowElement) {
            infoWindowElement.removeEventListener('click', handleInfoWindowClick);
            const articleBtn = infoWindowElement.querySelector('.article-btn');
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
        });
        updateFullscreenButton();
    }

    document.getElementById('zoom-restore').addEventListener('click', async () => {
        // 返回中国地图前收起当前标记点的信息卡
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
