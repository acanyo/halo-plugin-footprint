// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
    // 判断当前路径是否为/footprints
    const currentPath = window.location.pathname;
    if (currentPath !== '/footprints') {
        console.log('非足迹页面，不加载地图功能');
        return;
    }

    // 设置全局颜色变量
    const footprintPage = document.getElementById('footprint-page');
    if (footprintPage && window.FOOTPRINT_CONFIG) {
        footprintPage.style.setProperty('--footprint-hsla', window.FOOTPRINT_CONFIG.hsla);
    }

    // 打印插件信息
    console.log(
        '%c足迹插件%c🗺️ 记录生活轨迹，分享旅途故事\n%c作者 Handsome %cwww.lik.cc',
        'background: #42b983; color: white; padding: 2px 4px; border-radius: 3px;',
        'color: #42b983; padding: 2px 4px;',
        'color: #666; padding: 2px 4px;',
        'color: #42b983; text-decoration: underline; padding: 2px 4px;'
    );

    // 先获取足迹数据，然后等待地图API加载
    fetchFootprints().then(() => {
        // 等待AMap对象加载完成
        const checkAMap = () => {
            if (typeof AMap === 'undefined') {
                setTimeout(checkAMap, 100);
                return;
            }
            initializeApp();
        };
        checkAMap();
    }).catch(error => {
        console.error('获取足迹数据失败，但仍会初始化地图:', error);
        
        // 即使数据获取失败，也要初始化地图
        const checkAMap = () => {
            if (typeof AMap === 'undefined') {
                console.warn('等待高德地图API加载...');
                setTimeout(checkAMap, 100);
                return;
            }
            initializeApp();
        };
        checkAMap();
    });
});

// 优化动画性能
const showElements = () => {
    // 添加初始类
    document.body.classList.add('theme-ready');
    
    // 动画序列
    const animationSequence = [
        {
            element: '.logo-container',
            className: 'show',
            delay: 0,
            callback: () => {
                requestAnimationFrame(() => {
                    document.querySelector('.footprint-logo').style.color = 'var(--primary-color)';
                });
            }
        },
        {
            element: '.map-controls',
            className: 'show',
            delay: 200,
            callback: () => {
                // 依次显示控制按钮
                const buttons = document.querySelectorAll('.map-controls .control-btn');
                buttons.forEach((btn, index) => {
                    setTimeout(() => {
                        btn.classList.add('show');
                        // 添加缩放效果
                        btn.classList.add('scale-in');
                        // 移除缩放效果
                        setTimeout(() => btn.classList.remove('scale-in'), 300);
                    }, index * 100);
                });
            }
        },
        {
            element: '.zoom-controls',
            className: 'show',
            delay: 400,
            callback: () => {
                const zoomButtons = document.querySelectorAll('.zoom-controls button');
                zoomButtons.forEach((btn, index) => {
                    setTimeout(() => {
                        btn.classList.add('show');
                        btn.classList.add('slide-in');
                        setTimeout(() => btn.classList.remove('slide-in'), 300);
                    }, index * 100);
                });
            }
        }
    ];

    // 执行动画序列
    animationSequence.forEach(({element, className, delay, callback}) => {
        setTimeout(() => {
            const el = document.querySelector(element);
            if (el) {
                el.classList.add(className);
                if (callback) {
                    callback();
                }
            }
        }, delay);
    });
};

// 图层配置
const layerConfig = {
    satellite: {
        zIndex: 0,
        opacity: 1
    },
    road: {
        zIndex: 1,
        opacity: 0.6,
        strokeColor: '#666666'
    },
    traffic: {
        zIndex: 2,
        opacity: 0.6
    }
};

// 优化地图移动 - 减少动画时间，提升响应性
const moveToLocation = (map, position) => {
    return new Promise((resolve) => {
        // 启用动画，但设置更短的动画时间
        map.setStatus({
            animateEnable: true,
            scrollWheel: true,
            doubleClickZoom: true,
            keyboardEnable: true
        });
        
        // 设置缩放级别
        const currentZoom = map.getZoom();
        if (currentZoom < 14) {
            map.setZoom(14, false); // 不启用动画，直接设置
        }

        // 平移到目标位置，使用更平滑的动画
        map.panTo(position, 800); // 设置动画时间为800ms
        
        // 等待动画完成 - 使用更精确的检测
        let animationCheckCount = 0;
        const maxChecks = 50; // 最多检查50次，避免无限循环
        
        const checkAnimation = () => {
            animationCheckCount++;
            if (!map.isMoving && !map.isZooming) {
                resolve();
            } else if (animationCheckCount < maxChecks) {
                setTimeout(checkAnimation, 50); // 每50ms检查一次
            } else {
                // 超时强制完成
                resolve();
            }
        };
        
        // 延迟开始检查，给动画一些时间
        setTimeout(checkAnimation, 100);
    });
};

// 优化标记点创建
const createMarker = (spec) => {
    const markerContent = document.createElement('div');
    markerContent.className = 'custom-marker';
    
    const markerImage = document.createElement('div');
    markerImage.className = 'marker-image';
    
    const img = document.createElement('img');
    img.src = spec.image || 'https://www.lik.cc/upload/loading8.gif';
    img.alt = spec.name || '足迹标记';
    
    markerImage.appendChild(img);
    markerContent.appendChild(markerImage);
    
    return markerContent;
};

// 格式化时间
const formatTime = (timeString) => {
    if (!timeString) return '';
    try {
        const date = new Date(timeString);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).replace(/\//g, '-');
    } catch (e) {
        console.warn('时间格式化失败:', e);
        return timeString;
    }
};

// 优化信息窗口内容创建
function createInfoWindow(spec) {
    // 确保所有字段都有默认值
    const {
        image = '',
        name = '',
        footprintType = '',
        createTime = '',
        address = '',
        description = '',
        article = ''
    } = spec;

    // 格式化时间
    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).replace(/\//g, '-');
    };

    // 构建图片HTML
    const imageHtml = image ? `
        <div class="image">
            <img src="${image}" alt="${name}" style="position: absolute; width: 100%; height: 100%; object-fit: cover;">
            <div class="image-info">
                <h3 class="title">${name}</h3>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 7v10a4 4 0 004 4h10a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4z"></path>
                            <path d="M9 12h6"></path>
                        </svg>
                        ${footprintType || '未知类型'}
                    </span>
                </div>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        ${formatDate(createTime)}
                    </span>
                </div>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        ${address || '未知位置'}
                    </span>
                </div>
                ${description ? `<p class="description">${description}</p>` : ''}
                ${article ? `
                    <a href="${article}" target="_blank" class="article-btn">
                        查看文章
                        <div class="arrow-wrapper">
                            <div class="arrow"></div>
                        </div>
                    </a>
                ` : ''}
            </div>
        </div>
    ` : `
        <div class="image">
            <img src="https://www.lik.cc/upload/loading8.gif" alt="${name}" style="position: absolute; width: 100%; height: 100%; object-fit: cover;">
            <div class="image-info">
                <h3 class="title">${name}</h3>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 7v10a4 4 0 004 4h10a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4z"></path>
                            <path d="M9 12h6"></path>
                        </svg>
                        ${footprintType || '未知类型'}
                    </span>
                </div>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        ${formatDate(createTime)}
                    </span>
                </div>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        ${address || '未知位置'}
                    </span>
                </div>
                ${description ? `<p class="description">${description}</p>` : ''}
                ${article ? `
                    <a href="${article}" target="_blank" class="article-btn">
                        查看文章
                        <div class="arrow-wrapper">
                            <div class="arrow"></div>
                        </div>
                    </a>
                ` : ''}
            </div>
        </div>
    `;

    return `
        <div class="info-window">
            ${imageHtml}
        </div>
    `;
}

// 性能优化：使用防抖优化事件处理
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// 创建聚合标记
const createClusterMarker = (count, position) => {
    const markerContent = document.createElement('div');
    markerContent.className = 'likcc-footprint-cluster-marker';
    
    // 根据数量设置不同的大小类
    if (count >= 100) {
        markerContent.classList.add('likcc-footprint-cluster-xlarge');
    } else if (count >= 50) {
        markerContent.classList.add('likcc-footprint-cluster-large');
    } else if (count >= 10) {
        markerContent.classList.add('likcc-footprint-cluster-medium');
    } else {
        markerContent.classList.add('likcc-footprint-cluster-small');
    }
    
    // 所有标记都使用统一的主题色，通过CSS变量自动适配
    
    // 添加数字文本
    markerContent.appendChild(document.createTextNode(count));
    
    // 添加底部三角形指针
    const pointer = document.createElement('div');
    pointer.className = 'likcc-footprint-cluster-pointer';
    markerContent.appendChild(pointer);
    
    
    return markerContent;
};

// 计算标记点之间的距离
const calculateDistance = (pos1, pos2) => {
    const R = 6371000; // 地球半径（米）
    const lat1 = pos1.lat * Math.PI / 180;
    const lat2 = pos2.lat * Math.PI / 180;
    const deltaLat = (pos2.lat - pos1.lat) * Math.PI / 180;
    const deltaLng = (pos2.lng - pos1.lng) * Math.PI / 180;
    
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
};

// 聚合标记点 - 优化算法
const clusterMarkers = (footprints, clusterDistance = 10000) => { // 10km聚合距离
    const clusters = [];
    const processed = new Set();
    
    // 按经纬度排序，提高聚合效率
    const sortedFootprints = footprints
        .map((footprint, index) => ({
            footprint,
            index,
            lng: parseFloat(footprint.spec.longitude),
            lat: parseFloat(footprint.spec.latitude)
        }))
        .filter(item => !isNaN(item.lng) && !isNaN(item.lat))
        .sort((a, b) => a.lng - b.lng);
    
    sortedFootprints.forEach(({ footprint, index, lng, lat }) => {
        if (processed.has(index)) return;
        
        const cluster = {
            footprints: [footprint],
            center: { lng, lat },
            count: 1,
            bounds: { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat }
        };
        
        // 查找附近的标记点
        sortedFootprints.forEach(({ footprint: otherFootprint, index: otherIndex, lng: otherLng, lat: otherLat }) => {
            if (otherIndex === index || processed.has(otherIndex)) return;
            
            // 快速距离检查 - 如果经度差太大，直接跳过
            const lngDiff = Math.abs(otherLng - lng);
            if (lngDiff > clusterDistance / 111000) { // 粗略的经度距离检查
                return;
            }
            
            const distance = calculateDistance(
                { lng, lat },
                { lng: otherLng, lat: otherLat }
            );
            
            if (distance <= clusterDistance) {
                cluster.footprints.push(otherFootprint);
                cluster.count++;
                processed.add(otherIndex);
                
                // 更新聚合中心点
                cluster.center.lng = (cluster.center.lng * (cluster.count - 1) + otherLng) / cluster.count;
                cluster.center.lat = (cluster.center.lat * (cluster.count - 1) + otherLat) / cluster.count;
                
                // 更新边界
                cluster.bounds.minLng = Math.min(cluster.bounds.minLng, otherLng);
                cluster.bounds.maxLng = Math.max(cluster.bounds.maxLng, otherLng);
                cluster.bounds.minLat = Math.min(cluster.bounds.minLat, otherLat);
                cluster.bounds.maxLat = Math.max(cluster.bounds.maxLat, otherLat);
            }
        });
        
        processed.add(index);
        clusters.push(cluster);
    });
    
    return clusters;
};

// 添加足迹标记
const addFootprintMarkers = (map, footprintData) => {
    if (!Array.isArray(footprintData) || footprintData.length === 0) {
        console.warn('足迹数据为空或格式不正确');
        return;
    }

    // 创建信息窗体
    let infoWindow = new AMap.InfoWindow({
        isCustom: true,
        autoMove: false,
        offset: new AMap.Pixel(0, -10)
    });

    // 用于存储当前打开的标记
    let currentMarker = null;

    // 添加点击地图事件监听器，用于关闭信息窗口
    map.on('click', () => {
        if (currentMarker) {
            infoWindow.close();
            currentMarker = null;
        }
    });

    // 打开信息窗口的函数
    const openInfoWindow = (position, content) => {
        infoWindow.setContent(content);
        infoWindow.open(map, position);
        
        // 阻止信息窗口上的点击事件冒泡到地图
        requestAnimationFrame(() => {
            const infoWindowElement = document.querySelector('.info-window');
            if (infoWindowElement) {
                infoWindowElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
                
                // 为文章链接添加点击事件处理
                const articleBtn = infoWindowElement.querySelector('.article-btn');
                if (articleBtn) {
                    articleBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                    });
                }
            }
        });
    };

    // 根据缩放级别决定是否聚合
    const currentZoom = map.getZoom();
    const shouldCluster = currentZoom < 8; // 缩放级别小于8时进行聚合
    
    if (shouldCluster) {
        // 聚合模式
        const clusters = clusterMarkers(footprintData);
        clusters.forEach(cluster => {
            if (cluster.count === 1) {
                // 单个标记点
                const footprint = cluster.footprints[0];
                const position = new AMap.LngLat(cluster.center.lng, cluster.center.lat);
                const marker = new AMap.Marker({
                    position: position,
                    content: createMarker(footprint.spec),
                    anchor: 'bottom-center',
                    offset: new AMap.Pixel(0, 0)
                });

                marker.on('click', async () => {
                    if (currentMarker === marker) {
                        infoWindow.close();
                        currentMarker = null;
                        return;
                    }

                    if (currentMarker) {
                        infoWindow.close();
                    }

                    const content = createInfoWindow(footprint.spec);
                    const currentPos = map.getCenter();
                    const distance = position.distance(currentPos);
                    const currentZoom = map.getZoom();
                    
                    const needsMovement = distance > 1000 || currentZoom < 13;
                    
                    if (needsMovement) {
                        await moveToLocation(map, position);
                    }
                    
                    openInfoWindow(position, content);
                    currentMarker = marker;
                });

                map.add(marker);
            } else {
                // 聚合标记点
                const position = new AMap.LngLat(cluster.center.lng, cluster.center.lat);
                const markerContent = createClusterMarker(cluster.count, cluster.center);
                const marker = new AMap.Marker({
                    position: position,
                    content: markerContent,
                    anchor: 'bottom-center',
                    offset: new AMap.Pixel(0, 0)
                });

                marker.on('click', async () => {
                    // 聚合标记点击时放大到该区域
                    const currentZoom = map.getZoom();
                    const targetZoom = Math.min(currentZoom + 3, 15);
                    
                    // 计算聚合区域的边界
                    const bounds = cluster.bounds;
                    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
                    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
                    const center = new AMap.LngLat(centerLng, centerLat);
                    
                    // 平滑缩放到聚合区域
                    map.setZoomAndCenter(targetZoom, center, true, 1000);
                    
                    // 添加脉冲动画效果
                    markerContent.classList.add('likcc-footprint-cluster-pulse');
                    setTimeout(() => {
                        markerContent.classList.remove('likcc-footprint-cluster-pulse');
                    }, 600);
                });

                map.add(marker);
            }
        });
    } else {
        footprintData.forEach(footprint => {
            const longitude = parseFloat(footprint.spec.longitude);
            const latitude = parseFloat(footprint.spec.latitude);

            if (isNaN(longitude) || isNaN(latitude)) {
                console.warn('无效的经纬度数据:', footprint);
                return;
            }

            try {
                const position = new AMap.LngLat(longitude, latitude);
                const marker = new AMap.Marker({
                    position: position,
                    content: createMarker(footprint.spec),
                    anchor: 'bottom-center',
                    offset: new AMap.Pixel(0, 0)
                });

                marker.on('click', async () => {
                    if (currentMarker === marker) {
                        infoWindow.close();
                        currentMarker = null;
                        return;
                    }

                    if (currentMarker) {
                        infoWindow.close();
                    }

                    const content = createInfoWindow(footprint.spec);
                    const currentPos = map.getCenter();
                    const distance = position.distance(currentPos);
                    const currentZoom = map.getZoom();
                    
                    const needsMovement = distance > 1000 || currentZoom < 13;
                    
                    if (needsMovement) {
                        await moveToLocation(map, position);
                    }
                    
                    openInfoWindow(position, content);
                    currentMarker = marker;
                });

                map.add(marker);
            } catch (error) {
                console.error('创建标记失败:', error, footprint);
            }
        });
    }
};

// 优化图层切换
const handleLayerChange = (btn, type, layerState, map, layers) => {
    btn.classList.add('btn-clicked');
    
    requestAnimationFrame(() => {
        if (type === 'normal' || type === 'satellite') {
            const baseButtons = document.querySelectorAll('.control-btn[data-type="normal"], .control-btn[data-type="satellite"]');
            baseButtons.forEach(button => button.classList.remove('active'));
            
            const mapContainer = document.getElementById('footprint-map');
            mapContainer.classList.add('map-transitioning');
            
            requestAnimationFrame(() => {
                btn.classList.add('active');
                layerState.baseLayer = type;
                
                updateLayers(layerState, layers).then(() => {
                    setTimeout(() => {
                        mapContainer.classList.remove('map-transitioning');
                    }, 500);
                });
            });
        } else {
            btn.classList.toggle('active');
            layerState.overlays[type] = !layerState.overlays[type];
            
            if (layerState.overlays[type]) {
                const mapContainer = document.getElementById('footprint-map');
                mapContainer.classList.add('map-shake');
                setTimeout(() => {
                    mapContainer.classList.remove('map-shake');
                }, 400);
            }
            
            updateLayers(layerState, layers);
        }
    });

    setTimeout(() => btn.classList.remove('btn-clicked'), 400);
};

// 优化图层更新
const updateLayers = async (layerState, layers) => {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            // 处理基础图层
            if (layerState.baseLayer === 'satellite') {
                layers.satellite.show();
            } else {
                layers.satellite.hide();
            }

            // 错开叠加图层的更新时间
            setTimeout(() => {
                if (layerState.overlays.road) {
                    layers.road.show();
                } else {
                    layers.road.hide();
                }
            }, 100);
            
            setTimeout(() => {
                if (layerState.overlays.traffic) {
                    layers.traffic.show();
                } else {
                    layers.traffic.hide();
                }
                resolve();
            }, 200);
        });
    });
};

// 添加按钮点击动画
const addButtonAnimation = (button) => {
    button.addEventListener('click', () => {
        button.classList.add('btn-pulse');
        setTimeout(() => {
            button.classList.remove('btn-pulse');
        }, 300);
    });
};

// 初始化应用 - 优化加载性能
const initializeApp = async () => {
    try {
        // 显示加载状态
        const mapContainer = document.getElementById('footprint-map');
        if (mapContainer) {
            mapContainer.classList.add('map-loading');
        }

        // 创建地图实例 - 优化配置减少初始加载负担
        const map = new AMap.Map('footprint-map', {
            zoom: 4,
            center: [116.397428, 39.90923],
            mapStyle: window.FOOTPRINT_CONFIG.mapStyle || 'amap://styles/normal',
            viewMode: '3D',
            pitch: 0,
            features: ['bg', 'road', 'building', 'point'],
            showBuildingBlock: false, // 初始不显示建筑块
            animateEnable: true,
            scrollWheel: true,
            doubleClickZoom: true,
            keyboardEnable: true,
            dragEnable: true,
            zoomEnable: true,
            resizeEnable: true
        });
        
        // 保存地图实例到全局变量
        window.footprintMap = map;

        // 等待地图加载完成
        await new Promise(resolve => {
            map.on('complete', () => {
                // 移除加载状态
                if (mapContainer) {
                    mapContainer.classList.remove('map-loading');
                    mapContainer.classList.add('map-loaded');
                }
                resolve();
            });
        });

        // 延迟创建图层，避免阻塞初始渲染
        setTimeout(() => {
            // 创建图层
            const layers = {
                satellite: new AMap.TileLayer.Satellite(),
                road: new AMap.TileLayer.RoadNet(),
                traffic: new AMap.TileLayer.Traffic()
            };

            // 添加图层到地图
            Object.values(layers).forEach(layer => {
                map.add(layer);
                layer.hide();
            });

            // 初始化地图功能
            initializeMapFeatures(map, layers);
        }, 100);

        // 添加足迹标记
        addFootprintMarkers(map, window.FOOTPRINT_CONFIG.footprints);

        // 延迟显示界面元素，避免阻塞地图渲染
        setTimeout(() => {
            showElements();
        }, 200);

        // 为所有控制按钮添加点击动画
        setTimeout(() => {
            document.querySelectorAll('.control-btn, .zoom-controls button').forEach(button => {
                addButtonAnimation(button);
            });
        }, 300);

    } catch (error) {
        console.error('初始化地图时发生错误:', error);
        // 移除加载状态
        const mapContainer = document.getElementById('footprint-map');
        if (mapContainer) {
            mapContainer.classList.remove('map-loading');
        }
    }
};

// 性能优化：将地图功能初始化封装为单独的函数
const initializeMapFeatures = (map, layers) => {
    // 使用防抖优化事件处理
    const debounce = (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };

    // 优化比例尺更新 - 增加防抖时间，减少更新频率
    const updateScaleText = debounce(() => {
        requestAnimationFrame(() => {
            const originalScaleText = document.querySelector('.amap-scale-text');
            if (originalScaleText) {
                const scaleText = document.querySelector('.map-controls .amap-scale-text');
                if (scaleText) {
                    scaleText.textContent = originalScaleText.textContent;
                }
                const originalScale = document.querySelector('.amap-scale');
                if (originalScale) {
                    originalScale.style.display = 'none';
                }
            }
        });
    }, 300); // 增加防抖时间到300ms

    // 添加事件监听 - 只在缩放结束时更新
    map.on('zoomend', updateScaleText);
    map.on('moveend', updateScaleText);
    
    // 监听缩放事件，重新渲染标记点
    map.on('zoomend', () => {
        // 清除现有标记
        map.clearMap();
        
        // 重新添加足迹标记
        addFootprintMarkers(map, window.FOOTPRINT_CONFIG.footprints);
    });

    // 优化图层控制
    const layerState = {
        baseLayer: 'normal',
        overlays: {
            road: false,
            traffic: false
        }
    };

    // 处理基础图层按钮点击
    document.querySelectorAll('.control-btn[data-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            if (type === 'normal' || type === 'satellite') {
                handleLayerChange(btn, type, layerState, map, layers);
            }
        });
    });

    // 处理飞机开关的变化事件
    document.querySelectorAll('.plane-switch input[type="checkbox"]').forEach(checkbox => {
        const type = checkbox.dataset.type;
        checkbox.addEventListener('change', () => {
            layerState.overlays[type] = checkbox.checked;
            updateLayers(layerState, layers);

            // 添加动画效果
            const mapContainer = document.getElementById('footprint-map');
            if (checkbox.checked) {
                mapContainer.classList.add('map-shake');
                setTimeout(() => {
                    mapContainer.classList.remove('map-shake');
                }, 400);
            }
        });
    });

    // 处理缩放按钮点击 - 添加防抖和动画优化
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', debounce(() => {
            const currentZoom = map.getZoom();
            if (currentZoom < 18) { // 限制最大缩放级别
                map.setZoom(currentZoom + 1);
            }
        }, 200));
    }
    
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', debounce(() => {
            const currentZoom = map.getZoom();
            if (currentZoom > 3) { // 限制最小缩放级别
                map.setZoom(currentZoom - 1);
            }
        }, 200));
    }

    // 初始化图层状态
    updateLayers(layerState, layers);
};

// 获取足迹数据
function fetchFootprints() {
    return fetch('/apis/api.footprint.lik.cc/v1alpha1/listAllFootprints')
        .then(response => response.json())
        .then(data => {
            if (Array.isArray(data)) {
                window.FOOTPRINT_CONFIG.footprints = data;
            }
            return data;
        })
        .catch(error => {
            console.error('获取足迹数据失败:', error);
            // 即使获取失败，地图仍会正常初始化
            return [];
        });
}