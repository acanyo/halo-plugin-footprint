/**
 * 时间线卡片 → 地图标记点的抛物线引导动画（Canvas 绘制）。
 */

import { accentHex } from '../../shared/accent.js';
import { debounce } from './debounce.js';
import { getFootprintRelationNames } from './footprint-data.js';
import { markerCache, state } from './state.js';
import { handleScroll } from './timeline-scroll.js';

//抛物线动画加载
export const loadParabolaAnimation = (card, map) => {
    // 如果当前卡片不是激活的卡片，则不执行动画
    if (card !== state.animationInFlight) {
        return;
    }

    // 清除之前的动画（如果有）
    if (card.currentAnimationId) {
        cancelAnimationFrame(card.currentAnimationId);
        card.currentAnimationId = null;
    }

    if (!card) return;

    const canvas = document.getElementById('canvas');
    if (!canvas) return;

    canvas.style.position = 'fixed'; // 使用fixed定位减少重排
    canvas.style.pointerEvents = 'none'; // 避免canvas拦截鼠标事件
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const accent = accentHex();   // --fp-accent（后台「主题色」），canvas 读不到 CSS 变量

    // 使用设备像素比，避免 Retina 屏幕上的轨迹发糊。
    const resizeCanvas = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(window.innerWidth * ratio);
        canvas.height = Math.floor(window.innerHeight * ratio);
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const clearCanvas = () => {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };

    resizeCanvas();

    // 获取 card 的中心点
    const cardRect = card.getBoundingClientRect();
    const cardCenterX = cardRect.left + cardRect.width / 2;
    const cardCenterY = cardRect.top + cardRect.height / 2;

    //获取card子元素的class为card-header
    const cardHeader = card.querySelector('.card-header');
    //获取cardHeader的元素内容
    const cardHeaderContent = cardHeader.textContent;
    //获取class为marker-image下的img中alt为cardHeaderContent的元素
    const markerImage = markerCache.get(cardHeaderContent);


    // 获取card对应的标记点
    const footprint = window.FOOTPRINT_CONFIG.footprints.find(
            f => f.spec.name === cardHeaderContent
    );

    if (!footprint) {
        console.warn('未找到对应的足迹数据');
        return;
    }

    // 获取地图容器位置。lngLatToContainer 返回的是地图容器坐标，
    // Canvas 使用视口坐标，抽屉打开后两者不能直接混用。
    const mapElement = map.getContainer?.() || document.getElementById('footprint-map');
    const mapRect = mapElement?.getBoundingClientRect() || {left: 0, top: 0};

    // 获取所有相关的标记点
    const markerImages = [];
    const relationNames = getFootprintRelationNames(footprint);
    if (relationNames.length > 0) {
        const name = footprint.metadata.name;

        const metadataName = relationNames.includes(name);
        // 如果没有当前的标记点，手动添加
        if (!metadataName) {
            markerImages.push(markerImage);
        }
        // 如果有 metadataNames，获取所有相关的标记点
        relationNames.forEach(metadataName => {
            const relatedFootprint = window.FOOTPRINT_CONFIG.footprints.find(
                    f => f.metadata.name === metadataName
            );
            if (relatedFootprint) {
                const marker = markerCache.get(relatedFootprint.spec.name);
                if (marker) {
                    markerImages.push(marker);
                }
            }
        });
    } else {
        // 如果没有 metadataNames，只使用当前标记点
        markerImages.push(markerImage);
    }

    // 遍历所有标记图片
    markerImages.forEach(markerImg => {
        // 查找最近的amap-marker父元素
        const markerElement = markerImg?.closest('.amap-marker');
        if (markerElement) {
            // 将card对应的标记点显示到最上层
            markerElement.classList.add('zIndex13');
            // 主标记点（非关联标记点）额外突出显示
            if (markerImg === markerImage) {
                markerElement.classList.add('zIndex14');
                markerElement.classList.add('marker-highlight');
            }
        }
    });

    // 获取所有相关的标记点
    const mapCenter = [];
    if (relationNames.length > 0 &&
            !(relationNames.length === 1 && relationNames.includes(footprint.metadata.name))) {
        const name = footprint.metadata.name;

        const metadataName = relationNames.includes(name);
        // 如果没有当前的标记点，手动添加
        if (!metadataName) {
            const pixel = map.lngLatToContainer([footprint.spec.longitude, footprint.spec.latitude]); // 相对于地图容器的坐标
            // 转换为屏幕XY坐标
            const mapCenterXY = {
                mapCenterX: pixel.x,
                mapCenterY: pixel.y,
                isPrimary: true
            }
            mapCenter.push(mapCenterXY)
        }
        // 如果有 metadataNames，获取所有相关的标记点
        relationNames.forEach(metadataName => {
            const relatedFootprint = window.FOOTPRINT_CONFIG.footprints.find(
                    f => f.metadata.name === metadataName
            );
            if (relatedFootprint) {
                const pixel = map.lngLatToContainer([relatedFootprint.spec.longitude, relatedFootprint.spec.latitude]); // 相对于地图容器的坐标
                // 转换为屏幕XY坐标
                const mapCenterXY = {
                    mapCenterX: pixel.x,
                    mapCenterY: pixel.y,
                    isPrimary: relatedFootprint.metadata.name === name
                }
                // 如果没有 metadataNames，只使用当前标记点
                mapCenter.push(mapCenterXY)
            }
        });
    } else {
        const pixel = map.lngLatToContainer([footprint.spec.longitude, footprint.spec.latitude]); // 相对于地图容器的坐标
        // 转换为屏幕XY坐标
        const mapCenterXY = {
            mapCenterX: pixel.x,
            mapCenterY: pixel.y,
            isPrimary: true
        }
        // 如果没有 metadataNames，只使用当前标记点
        mapCenter.push(mapCenterXY)
    }

    const startPoint = {x: cardCenterX, y: cardCenterY};
    const markerPoints = mapCenter.map(center => ({
        x: mapRect.left + center.mapCenterX,
        y: mapRect.top + center.mapCenterY - 36,
        isPrimary: center.isPrimary === true
    }));

    // 关联足迹从当前卡片对应的标记点分支，不再经过抽象的中心点。
    const primaryPoint = markerPoints.find(point => point.isPrimary) || markerPoints[0];
    const relatedPoints = markerPoints.filter(point => point !== primaryPoint);

    const createRouteSegment = (segmentStart, segmentEnd, options = {}) => {
        const distance = Math.hypot(
            segmentEnd.x - segmentStart.x,
            segmentEnd.y - segmentStart.y
        );
        const arcHeight = Math.min(
            options.arcMax ?? 96,
            Math.max(options.arcMin ?? 40, distance * (options.arcRatio ?? 0.12))
        );
        const controlPoint = {
            x: (segmentStart.x + segmentEnd.x) / 2 + (options.controlOffset ?? 0),
            y: Math.min(segmentStart.y, segmentEnd.y) - arcHeight
        };

        return {
            startPoint: segmentStart,
            endPoint: segmentEnd,
            controlPoint,
            progress: 0,
            startTime: null,
            delay: options.delay ?? 0,
            duration: options.duration ?? 900,
            opacity: options.opacity ?? 1,
            kind: options.kind ?? 'route',
            routePoints: Array.from({length: 56}, (_, pointIndex) => {
                return getQuadraticBezierPoint(
                    pointIndex / 55,
                    segmentStart,
                    controlPoint,
                    segmentEnd
                );
            })
        };
    };

    // 关联足迹不绘制分支路线，只保留卡片到当前主标记点的引导线。
    const animations = [createRouteSegment(startPoint, primaryPoint, {
        kind: 'trunk',
        duration: 760,
        arcMin: 32,
        arcMax: 72,
        arcRatio: 0.1
    })];

    // 动画参数：路线显影、终点停留、定位波纹和淡出。
    const relatedPulseDuration = 620;
    const relatedPulseDelay = 95;
    const holdDuration = relatedPoints.length > 0
        ? Math.max(460, relatedPulseDuration + (relatedPoints.length - 1) * relatedPulseDelay)
        : 460;
    const fadeDuration = 520;
    let allCompleteAt = null;
    let isAnimating = true;

    // 计算二次贝塞尔曲线上的点
    function getQuadraticBezierPoint(t, p0, p1, p2) {
        const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
        return {x, y};
    }

    const easeOutCubic = value => 1 - Math.pow(1 - value, 3);

    // 绘制一个小型显影光点，不使用箭头，避免产生导航软件的视觉暗示。
    function drawTravelPoint(point, alpha = 1) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = `${accent}66`;
        ctx.shadowBlur = 10;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';   // --fp-paper-raised
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // 终点定位波纹只出现一次，用来完成路线叙事。
    function drawEndpointPulse(point, phase, alpha = 1) {
        const radius = 7 + phase * 17;
        ctx.save();
        ctx.globalAlpha = alpha * (1 - phase) * 0.62;
        ctx.fillStyle = accent;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // 关联点只做一次聚焦波纹，不建立路线关系。
    function drawRelatedFocus(point, phase, alpha = 1) {
        const radius = 6 + phase * 15;
        ctx.save();
        ctx.globalAlpha = alpha * (1 - phase) * 0.58;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = alpha * 0.68;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // 底稿路线很淡，显影部分更清晰，整体像地图上的一笔手绘路径。
    function drawRoute(animation, alpha = 1) {
        const points = animation.routePoints;
        const visibleCount = Math.max(1, Math.floor((points.length - 1) * animation.progress));

        const drawPoints = count => {
            ctx.beginPath();
            for (let i = 0; i <= count; i++) {
                const point = points[i];
                if (i === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            }
        };

        ctx.save();
        ctx.globalAlpha = alpha * animation.opacity * 0.15;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        drawPoints(points.length - 1);
        ctx.stroke();
        ctx.restore();

        if (animation.progress <= 0) return;

        ctx.save();
        ctx.globalAlpha = alpha * animation.opacity;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        drawPoints(visibleCount);
        ctx.stroke();
        ctx.restore();
    }

    // 动画循环
    function animate(timestamp) {
        if (!isAnimating || card !== state.activeCard) {
            if (card.currentAnimationId) {
                cancelAnimationFrame(card.currentAnimationId);
                card.currentAnimationId = null;
            }
            clearCanvas();
            return;
        }

        // 清除画布
        clearCanvas();

        const elapsedSinceComplete = allCompleteAt === null
            ? 0
            : timestamp - allCompleteAt;
        const fadeAlpha = allCompleteAt === null || elapsedSinceComplete <= holdDuration
            ? 1
            : Math.max(0, 1 - (elapsedSinceComplete - holdDuration) / fadeDuration);

        // 更新每个动画的进度
        animations.forEach(animation => {
            if (animation.startTime === null) animation.startTime = timestamp;
            const elapsed = timestamp - animation.startTime - animation.delay;
            const linearProgress = Math.max(0, Math.min(elapsed / animation.duration, 1));
            animation.progress = easeOutCubic(linearProgress);

            // 计算当前动画点在曲线上的位置
            const currentPoint = getQuadraticBezierPoint(
                    animation.progress,
                    animation.startPoint,
                    animation.controlPoint,
                    animation.endPoint
            );

            drawRoute(animation, fadeAlpha);
            if (animation.progress > 0 && animation.progress < 1) {
                drawTravelPoint(currentPoint, fadeAlpha * animation.opacity);
            }

            if (animation.progress >= 1 && allCompleteAt !== null) {
                const pulsePhase = Math.min(elapsedSinceComplete / (holdDuration + fadeDuration), 1);
                drawEndpointPulse(animation.endPoint, pulsePhase, fadeAlpha * animation.opacity * 0.72);
            }
        });

        if (allCompleteAt !== null && relatedPoints.length > 0) {
            relatedPoints.forEach((point, index) => {
                const relatedElapsed = elapsedSinceComplete - index * relatedPulseDelay;
                if (relatedElapsed < 0) return;
                const pulsePhase = Math.min(relatedElapsed / relatedPulseDuration, 1);
                drawRelatedFocus(point, pulsePhase, fadeAlpha);
            });
        }

        // 检查是否所有动画都完成
        const allComplete = animations.every(animation => animation.progress >= 1);

        // 所有路线显影完成后开始终点波纹和淡出。
        if (allComplete && allCompleteAt === null) {
            allCompleteAt = timestamp;
        }

        const fadeFinished = allCompleteAt !== null
            && timestamp - allCompleteAt >= holdDuration + fadeDuration;

        if (!allComplete || !fadeFinished) {
            card.currentAnimationId = requestAnimationFrame(animate);
        } else {
            card.currentAnimationId = null;
            isAnimating = false;
            clearCanvas();
        }
    }

    // 开始动画
    isAnimating = true;
    card.currentAnimationId = requestAnimationFrame(animate);

    // 响应窗口大小变化
    const resizeHandler = () => {
        resizeCanvas();
        clearCanvas();
    };
    window.addEventListener('resize', resizeHandler);

    // 添加清理函数
    const cleanup = () => {
        const timeLineBox = document.getElementById('timeLineBox');
        if (timeLineBox) {
            timeLineBox.removeEventListener('scroll', handleScroll);
        }
        isAnimating = false;
        if (card.currentAnimationId) {
            cancelAnimationFrame(card.currentAnimationId);
            card.currentAnimationId = null;
        }
        clearCanvas();
        window.removeEventListener('resize', resizeHandler);
        card.removeEventListener('mouseleave', handleLeave);
        // 清除引用
        // 移除标记点的置顶和高亮
        document.querySelectorAll('.amap-marker').forEach(marker => {
            marker.classList.remove('zIndex13');
            marker.classList.remove('zIndex14');
            marker.classList.remove('marker-highlight');
        });
        card = null;
    };

    const handleLeave = debounce(cleanup, 100);
    card.addEventListener('mouseleave', handleLeave);
};
