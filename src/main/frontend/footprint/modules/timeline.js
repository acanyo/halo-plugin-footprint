/**
 * 时间线抽屉内容的渲染与交互（卡片、查看旅行故事、悬停联动地图）。
 */

import { isMobile } from './env.js';
import { getCachedImage, getFootprintRelationNames, processFootprintImageUrl } from './footprint-data.js';
import { formatDateToYMD, getTimelineDateParts } from './format.js';
import { clearTimelineHoverZoom, zoomOff, zoomOff3 } from './hover-zoom.js';
import { cancelTimelineMapMove, moveToLocation, restoreMapOrientation } from './map-motion.js';
import { SVG_ICONS } from './marker-content.js';
import { loadParabolaAnimation } from './parabola-animation.js';
import { state } from './state.js';
import { closeTimelineDrawer } from './timeline-drawer.js';
import { handleScroll } from './timeline-scroll.js';

//渲染抽屉中的时间线
export const populateTimeline = async (map) => {
    const timelineContainer = document.getElementById('timelineDrawer');
    const footprints = window.FOOTPRINT_CONFIG.footprints;

    if (!Array.isArray(footprints) || footprints.length === 0) {
        timelineContainer.innerHTML = '<p>No footprints available.</p>';
        return;
    }

    // 添加时间线按钮事件处理
    const timelineBtn = document.getElementById('timeline-btn');
    const closeDrawerBtn = document.getElementById('closeBtn');
    const timeline = document.getElementById('timeline');
    const timelineContent = document.getElementById('timelineContent');

    footprints.forEach((item, index) => {
        const processed = processFootprintImageUrl(item.spec.image, 'timeline');
        const cachedImage = getCachedImage(processed);

        const timelineItem = document.createElement('div');
        timelineItem.className = 'timeline-item';

        // 创建日期元素
        const timelineDate = document.createElement('div');
        timelineDate.className = 'timeline-date';
        timelineDate.setAttribute('aria-label', formatDateToYMD(item.spec.createTime));
        const dateParts = getTimelineDateParts(item.spec.createTime);
        const dateYear = document.createElement('span');
        dateYear.className = 'timeline-date-year';
        dateYear.textContent = dateParts.year;
        const dateMonthDay = document.createElement('span');
        dateMonthDay.className = 'timeline-date-day';
        dateMonthDay.textContent = dateParts.monthDay;
        const dateWeekday = document.createElement('span');
        dateWeekday.className = 'timeline-date-weekday';
        dateWeekday.textContent = dateParts.weekday;
        timelineDate.append(dateYear, dateMonthDay, dateWeekday);
        timelineItem.appendChild(timelineDate);

        // 创建内容卡片
        const contentCard = document.createElement('div');
        contentCard.className = 'timeline-content-card';
        timelineItem.appendChild(contentCard);

        // 创建媒体容器
        const timelineMedia = document.createElement('div');
        timelineMedia.className = 'timeline-media';
        contentCard.appendChild(timelineMedia);

        // 创建图片
        const img = document.createElement('img');
        img.src = cachedImage;
        img.loading = 'lazy';
        img.alt = item.spec.name;
        timelineMedia.appendChild(img);

        // 创建媒体覆盖层
        const mediaOverlay = document.createElement('div');
        mediaOverlay.className = 'media-overlay';
        timelineMedia.appendChild(mediaOverlay);

        // 创建位置信息
        const locationDiv = document.createElement('div');
        locationDiv.className = 'timeline-location';

        // 创建标题
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        cardHeader.textContent = item.spec.name;

        // 添加SVG_ICONS.location图标到名称左侧
        const iconSpan = document.createElement('span');
        iconSpan.innerHTML = SVG_ICONS.location;
        iconSpan.classList.add('location-icon'); // 添加 class
        locationDiv.appendChild(iconSpan);
        const titleAnchor = document.createElement('div');
        titleAnchor.className = 'timeline-title-anchor';
        titleAnchor.appendChild(cardHeader);
        locationDiv.appendChild(titleAnchor);

        mediaOverlay.appendChild(locationDiv);

        // 创建信息覆盖层
        const infoOverlay = document.createElement('div');
        infoOverlay.className = 'timeline-info-overlay';
        mediaOverlay.appendChild(infoOverlay);

        // 创建描述
        const desc = document.createElement('p');
        desc.className = 'timeline-desc';
        desc.textContent = item.spec.description;
        infoOverlay.appendChild(desc);

        // 创建按钮
        const detailBtn = document.createElement('button');
        detailBtn.className = 'detail-btn';
        detailBtn.id = 'detailBtn';

        // 创建按钮图标
        const binocularsIcon = document.createElement('i');
        binocularsIcon.className = 'fas fa-binoculars';
        detailBtn.appendChild(binocularsIcon);

        // 添加按钮文本
        detailBtn.appendChild(document.createTextNode(' 查看旅行故事'));
        infoOverlay.appendChild(detailBtn);

        // 最后将整个元素添加到时间线中
        timeline.appendChild(timelineItem);

        // 添加点击事件处理
        detailBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            // 点击旅行故事时立即让当前卡片的异步悬停缩放失效，避免它在点击后再次把地图缩放到 6.5 级。
            state.timelineHoverGeneration += 1;
            timelineItem._hoverCancelled = true;
            clearTimelineHoverZoom(map);
            if (typeof map.stopAnimation === 'function') {
                map.stopAnimation();
            }

            // 清除抛物线动画
            if (timelineItem.currentAnimationId) {
                cancelAnimationFrame(timelineItem.currentAnimationId);
                timelineItem.currentAnimationId = null;
            }

            // 清除画布
            const canvas = document.getElementById('canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }

            // 重置动画状态
            state.isAnimating = false;
            state.activeCard = null;

            const cardHeader = timelineItem.querySelector('.card-header');
            const cardHeaderContent = cardHeader.textContent;
            const footprint = window.FOOTPRINT_CONFIG.footprints.find(
                    f => f.spec.name === cardHeaderContent
            );
            if (isMobile) {
                closeTimelineDrawer(map);

                // 卸载所有图片
                const cards = document.querySelectorAll('.timeline-card');
                cards.forEach(card => {
                    card.style.backgroundImage = 'none';
                    card.classList.add('loading');
                });
            }
            if (footprint) {
                // 查找并触发对应的标记点点击事件
                const marker = state.footprintMarkerController?.find(footprint) || map.getAllOverlays().find(
                        m => m._position.lng === parseFloat(footprint.spec.longitude) &&
                                m._position.lat === parseFloat(footprint.spec.latitude)
                );

                if (marker) {
                    marker.emit('click');
                }
            }
        });

        // 添加动画延迟
        setTimeout(() => {
            timelineItem.classList.add('visible');
        }, 300 + (index * 200));
    });

    // 打开抽屉
    timelineBtn.addEventListener('click', () => {
        // 切换到时间线前关闭当前标记点的图片墙
        state.closeActiveFootprint?.();

        // 打开时间线时自动恢复标记点，方便时间线与地图足迹保持同步
        if (state.footprintMarkerController && !state.footprintMarkerController.isVisible()) {
            state.footprintMarkerController.setVisible(true);
            const markerVisibilityToggle = document.querySelector('.marker-switch input[data-type="markers"]');
            if (markerVisibilityToggle) markerVisibilityToggle.checked = true;
        }

        const zoomButtons = document.getElementById('zoom-buttons');
        const line = document.getElementById('line');
        //隐藏时间线按钮/缩放按钮/线路按钮
        timelineBtn.classList.add('hidden-important');
        zoomButtons.classList.add('hidden-important');
        line.classList.add('hidden-important');

        const footprintMap = document.getElementById('footprint-map');
        const timelineDrawer = document.getElementById('timelineDrawer');
        if (isMobile) {
            // 移动端抽屉覆盖在地图上，不压缩地图宽度，避免出现 0px 宽容器
            footprintMap.style.width = '100%';
        } else {
            const drawerRect = timelineDrawer.getBoundingClientRect();
            const number = Math.max(1, window.innerWidth - drawerRect.width);
            footprintMap.style.width = number + "px";
        }
        //还原仰角和旋转
        restoreMapOrientation(map);
        state.isTimelineOpen = true;
        timelineDrawer.classList.add('open');
        const mapControls = document.getElementById('map-controls');
        mapControls.classList.add('open');

        // 添加滚动事件监听
        timelineContent.addEventListener('scroll', handleScroll);
    });

    // 合上抽屉
    closeDrawerBtn.addEventListener('click', () => {
        closeTimelineDrawer(map);
    });


    // 为每个卡片绑定鼠标悬停事件
    const timelineCards = document.querySelectorAll('.timeline-content-card');
    timelineCards.forEach(card => {
        if (isMobile) return; //手机端不添加悬停事件
        let debounceTimer;
        let isProcessing = false;

        const handleEnter = async () => {
            if (isProcessing) return;
            const hoverGeneration = state.timelineHoverGeneration;
            // 时间线卡片悬停时先关闭地图上的图片墙，避免悬停缩放与图片墙定位同时进行。
            state.closeActiveFootprint?.();
            if (hoverGeneration !== state.timelineHoverGeneration || card._hoverCancelled) return;
            // 悬停前等待仰角和旋转还原完成，避免使用中间姿态继续移动地图。
            await restoreMapOrientation(map);
            if (hoverGeneration !== state.timelineHoverGeneration || card._hoverCancelled) return;
            try {
                isProcessing = true;
                state.activeCard = card;
                state.animationInFlight = card;

                // 停止上一张卡片残留的地图移动，确保当前卡片从新坐标开始渲染抛物线。
                cancelTimelineMapMove(map);

                // 关闭已打开的信息窗口
                const allOverlays = map.getAllOverlays();
                allOverlays.forEach(overlay => {
                    if (overlay instanceof AMap.InfoWindow) {
                        overlay.close();
                    }
                });


                const hoverZoom = 6.5;

                const cardHeader = card.querySelector('.card-header');
                const cardHeaderContent = cardHeader.textContent;
                const footprint = window.FOOTPRINT_CONFIG.footprints.find(
                        f => f.spec.name === cardHeaderContent
                );
                const position2 = new AMap.LngLat(
                        parseFloat(footprint.spec.longitude),
                        parseFloat(footprint.spec.latitude)
                );

                //获取关联标记点
                const metadataNames = getFootprintRelationNames(footprint);
                //判断是否有 关联标记点
                if (metadataNames && metadataNames.length > 0 &&
                        // 判断关联标记点是否为自身
                        !(metadataNames.length === 1 && metadataNames.includes(footprint.metadata.name))) {
                    /*
                    // 关联点整体缩放方案暂时保留，后续需要时可恢复。
                    const name = footprint.metadata.name;
                    const metadataName = metadataNames.includes(name);
                    const positions = metadataNames
                            .map(metadataName => window.FOOTPRINT_CONFIG.footprints.find(
                                    f => f.metadata.name === metadataName
                            ))
                            .filter(Boolean);
                    if (!metadataName) {
                        positions.push(footprint);
                    }

                    const allOverlays = map.getAllOverlays();
                    const newOverlays = positions
                            .map(value => allOverlays.find(
                                    f => f._position.lng === value.spec.longitude && f._position.lat === value.spec.latitude
                            ))
                            .filter(Boolean);

                    const byOverlays = map.getFitZoomAndCenterByOverlays(newOverlays, [350, 120, 120, 120]);
                    const newPosition = new AMap.LngLat(byOverlays[1].lng, byOverlays[1].lat);
                    const calculatedZoom = Number.parseFloat(byOverlays[0]);
                    const calculatedTargetZoom = Number.isFinite(calculatedZoom) ? calculatedZoom : hoverZoom;
                    */

                    // 关联点只参与抛物线展示；悬停缩放固定到当前卡片对应的标记点。
                    const targetPosition = position2;
                    const targetZoom = hoverZoom;
                    // 悬停缩放完成后再渲染抛物线，避免地图移动过程中计算出过期的标记点坐标。
                    zoomOff(map);
                    zoomOff3(map);
                    if (window.FOOTPRINT_CONFIG.enableHoverZoom) {
                        await moveToLocation(map, targetPosition, targetZoom, 0);
                        if (hoverGeneration !== state.timelineHoverGeneration || card._hoverCancelled) return;
                    }
                    loadParabolaAnimation(card, map);
                } else {
                    // 无关联点时同样遵循启用悬停缩放的设置，缩放完成后再启动动画。
                    zoomOff(map);
                    zoomOff3(map);
                    if (window.FOOTPRINT_CONFIG.enableHoverZoom) {
                        await moveToLocation(map, position2, hoverZoom, 0);
                        if (hoverGeneration !== state.timelineHoverGeneration || card._hoverCancelled) return;
                    }
                    loadParabolaAnimation(card, map);
                }
            } catch (error) {
                console.error('处理卡片悬停时发生错误:', error);
                state.isAnimating = false;
                if (card.currentAnimationId) {
                    cancelAnimationFrame(card.currentAnimationId);
                    card.currentAnimationId = null;
                }
            } finally {
                isProcessing = false;
            }
        };

        const handleLeave = () => {
            // 立即取消任何待执行的 handleEnter，避免竞态条件
            state.timelineHoverGeneration += 1;
            state.animationInFlight = null;
            // 卡片已离开，地图不需要继续移动到该卡片的位置。
            cancelTimelineMapMove(map);
            const amapMarker = document.querySelectorAll('.amap-marker');
            amapMarker.forEach(marker => {
                marker.classList.remove('zIndex13');
                marker.classList.remove('zIndex14');
                marker.classList.remove('marker-highlight');
            });
            return new Promise((resolve) => {
                debounceTimer = setTimeout(() => {
                    if (state.activeCard === card) {
                        state.activeCard = null;
                    }
                    zoomOff(map);
                    zoomOff3(map);
                    if (card.currentAnimationId) {
                        cancelAnimationFrame(card.currentAnimationId);
                        card.currentAnimationId = null;
                        const canvas = document.getElementById('canvas');
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                    resolve();
                }, 100);
            });
        };

        card.addEventListener('mouseenter', async () => {
            if (card._hoverPending) return;
            card._hoverPending = true;
            const activation = ++state.timelineActivationToken;
            card._hoverOwner = activation;
            card._hoverCancelled = false;
            try {
                await handleLeave();
                // 快速切换时，handleLeave 已标记取消，跳过 handleEnter
                if (activation !== state.timelineActivationToken || card._hoverCancelled) return;
                await handleEnter();
            } finally {
                if (card._hoverOwner === activation) {
                    card._hoverPending = false;
                }
            }
        });
        card.addEventListener('mouseleave', () => {
            state.timelineActivationToken += 1;
            card._hoverCancelled = true;
            handleLeave();
        });
    });
};
