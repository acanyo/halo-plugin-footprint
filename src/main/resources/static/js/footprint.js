document.addEventListener('DOMContentLoaded', () => {
    const currentPath = window.location.pathname;
    if (currentPath !== '/footprints') {
        console.log('非足迹页面，不加载地图功能');
        return;
    }

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
        const checkAMap = () => {
            if (typeof AMap === 'undefined') {
                setTimeout(checkAMap, 100);
                return;
            }
            initializeApp();
        };
        checkAMap();
    });
});

const showElements = () => {
    document.body.classList.add('theme-ready');
    
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
                const buttons = document.querySelectorAll('.map-controls .control-btn');
                buttons.forEach((btn, index) => {
                    setTimeout(() => {
                        btn.classList.add('show');
                        btn.classList.add('scale-in');
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

const layerConfig = {
    satellite: { zIndex: 0, opacity: 1 },
    road: { zIndex: 1, opacity: 0.6, strokeColor: '#666666' },
    traffic: { zIndex: 2, opacity: 0.6 }
};

const moveToLocation = (map, position) => {
    return new Promise((resolve) => {
        map.setStatus({
            animateEnable: true,
            scrollWheel: true,
            doubleClickZoom: true,
            keyboardEnable: true
        });
        
        const currentZoom = map.getZoom();
        const currentCenter = map.getCenter();
        const distance = position.distance(currentCenter);
        
        // 直接设置到100米级别的缩放，确保一次点击就能到达
        const targetZoom = 18; 
        
        // 先缩放到目标级别，然后移动
        if (targetZoom > currentZoom) {
            map.setZoom(targetZoom, true, 600);
            // 等待缩放完成后再移动
            setTimeout(() => {
                map.panTo(position, 800);
            }, 100);
        } else {
            // 不需要缩放，直接移动
            map.panTo(position, 800);
        }
        
        // 监听移动完成事件，使用更简单可靠的检测方法
        let completed = false;
        
        const onComplete = () => {
            if (completed) return;
            completed = true;
            map.off('moveend', onComplete);
            map.off('zoomend', onComplete);
            resolve();
        };
        
        // 添加移动完成监听器
        map.on('moveend', onComplete);
        map.on('zoomend', onComplete);
        
        // 备用超时机制，确保不会永远等待
        setTimeout(() => {
            if (!completed) {
                completed = true;
                map.off('moveend', onComplete);
                map.off('zoomend', onComplete);
                resolve();
            }
        }, 1500);
    });
};

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

const ICONS = {
    type: '<path d="M3 7v10a4 4 0 004 4h10a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4z"></path><path d="M9 12h6"></path>',
    time: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
    location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path><circle cx="12" cy="10" r="3"></circle>'
};

function createInfoWindow(spec) {
    const {
        image = '',
        name = '',
        footprintType = '',
        createTime = '',
        address = '',
        description = '',
        article = ''
    } = spec;

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

    const createMetaItem = (icon, text) => `
        <div class="meta">
            <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${icon}
                </svg>
                ${text}
            </span>
        </div>
    `;

    const metaItems = [
        createMetaItem(ICONS.type, footprintType || '未知类型'),
        createMetaItem(ICONS.time, formatDate(createTime)),
        createMetaItem(ICONS.location, address || '未知位置')
    ].join('');

    const articleHtml = article ? `
        <a href="javascript:void(0)" data-article-url="${article}" class="article-btn">
            查看文章
            <div class="arrow-wrapper">
                <div class="arrow"></div>
            </div>
        </a>
    ` : '';

    return `
        <div class="info-window">
            <div class="image">
                <img src="${image || 'https://www.lik.cc/upload/loading8.gif'}" alt="${name}" style="position: absolute; width: 100%; height: 100%; object-fit: cover;">
                <div class="image-info">
                    <h3 class="title">${name}</h3>
                    ${metaItems}
                    ${description ? `<p class="description">${description}</p>` : ''}
                    ${articleHtml}
                </div>
            </div>
        </div>
    `;
}

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

const createClusterMarker = (count, position) => {
    const markerContent = document.createElement('div');
    markerContent.className = 'likcc-footprint-cluster-marker';
    
    if (count >= 100) {
        markerContent.classList.add('likcc-footprint-cluster-xlarge');
    } else if (count >= 50) {
        markerContent.classList.add('likcc-footprint-cluster-large');
    } else if (count >= 10) {
        markerContent.classList.add('likcc-footprint-cluster-medium');
    } else {
        markerContent.classList.add('likcc-footprint-cluster-small');
    }
    
    markerContent.appendChild(document.createTextNode(count));
    
    const pointer = document.createElement('div');
    pointer.className = 'likcc-footprint-cluster-pointer';
    markerContent.appendChild(pointer);
    
    return markerContent;
};

const calculateDistance = (pos1, pos2) => {
    const R = 6371000;
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

const clusterMarkers = (footprints, clusterDistance = 10000) => {
    const clusters = [];
    const processed = new Set();
    
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
        
        sortedFootprints.forEach(({ footprint: otherFootprint, index: otherIndex, lng: otherLng, lat: otherLat }) => {
            if (otherIndex === index || processed.has(otherIndex)) return;
            
            const lngDiff = Math.abs(otherLng - lng);
            if (lngDiff > clusterDistance / 111000) {
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
                
                cluster.center.lng = (cluster.center.lng * (cluster.count - 1) + otherLng) / cluster.count;
                cluster.center.lat = (cluster.center.lat * (cluster.count - 1) + otherLat) / cluster.count;
                
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

let currentMarker = null;
let globalInfoWindow = null;

const addFootprintMarkers = (map, footprintData) => {
    if (!Array.isArray(footprintData) || footprintData.length === 0) {
        return;
    }

    if (!globalInfoWindow) {
        globalInfoWindow = new AMap.InfoWindow({
            isCustom: true,
            autoMove: false,
            offset: new AMap.Pixel(0, -10)
        });
    }

    const openInfoWindow = (position, content, marker) => {
        globalInfoWindow.setContent(content);
        globalInfoWindow.open(map, position);
        currentMarker = marker;
        
        // 延迟设置3D效果，确保信息窗口完全渲染后再应用
        setTimeout(() => {
            map.setPitch(60);
        }, 100);
        
        setTimeout(() => {
            const infoWindowElement = document.querySelector('.info-window');
            if (infoWindowElement) {
                infoWindowElement.addEventListener('click', (e) => {
                    if (e.target.closest('.article-btn')) {
                        e.stopPropagation();
                        e.preventDefault();
                        const articleBtn = e.target.closest('.article-btn');
                        const articleUrl = articleBtn.getAttribute('data-article-url');
                        if (articleUrl) {
                            window.open(articleUrl, '_blank');
                        }
                        return;
                    }
                    globalInfoWindow.close();
                    map.setPitch(0);
                    currentMarker = null;
                });
                
                const articleBtn = infoWindowElement.querySelector('.article-btn');
                if (articleBtn) {
                    articleBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const articleUrl = articleBtn.getAttribute('data-article-url');
                        if (articleUrl) {
                            window.open(articleUrl, '_blank');
                        }
                    });
                }
            }
        }, 100);
    };

    // 根据缩放级别决定是否聚合
    const currentZoom = map.getZoom();
    // 降低聚合阈值，让更多情况下使用非聚合模式，确保移动端和电脑端行为一致
    const shouldCluster = currentZoom < 6; // 缩放级别小于6时进行聚合
    
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
                        globalInfoWindow.close();
                        // 恢复水平视角
                        map.setPitch(0);
                        currentMarker = null;
                        return;
                    }

                    if (currentMarker) {
                        globalInfoWindow.close();
                        // 恢复水平视角
                        map.setPitch(0);
                    }

                    const content = createInfoWindow(footprint.spec);
                    
                    // 统一移动逻辑：所有设备都先移动到位置，再打开信息窗口
                    await moveToLocation(map, position);
                    // 移动完成后打开信息窗口
                    openInfoWindow(position, content, marker);
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
                    
                    // 使用统一的移动逻辑
                    await moveToLocation(map, center);
                    
                    // 设置目标缩放级别
                    map.setZoom(targetZoom, false);
                    
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
                        globalInfoWindow.close();
                        // 恢复水平视角
                        map.setPitch(0);
                        currentMarker = null;
                        return;
                    }

                    if (currentMarker) {
                        globalInfoWindow.close();
                        // 恢复水平视角
                        map.setPitch(0);
                    }

                    const content = createInfoWindow(footprint.spec);
                    
                    // 统一移动逻辑：所有设备都先移动到位置，再打开信息窗口
                    await moveToLocation(map, position);
                    // 移动完成后打开信息窗口
                    openInfoWindow(position, content, marker);
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
            const baseButtons = document.querySelectorAll('.likcc-layer-btn[data-type="normal"], .likcc-layer-btn[data-type="satellite"]');
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
            pitch: 45, // 设置俯仰角度以显示3D效果
            rotation: 0, // 设置旋转角度
            features: ['bg', 'road', 'building', 'point'],
            showBuildingBlock: true, // 启用3D建筑模型
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
    // 添加地图点击事件监听器，用于关闭信息窗口
    map.on('click', (e) => {
        if (currentMarker) {
            if (globalInfoWindow) {
                globalInfoWindow.close();
            }
            // 恢复水平视角
            map.setPitch(0);
            currentMarker = null;
        }
    });
    
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
        // 如果当前有信息窗口打开，不重新渲染标记
        if (currentMarker) {
            return;
        }
        
        // 延迟执行，确保点击事件先处理
        setTimeout(() => {
            // 再次检查是否有信息窗口打开
            if (currentMarker) {
                return;
            }
            
            // 清除现有标记
            map.clearMap();
            
            // 重新添加足迹标记
            addFootprintMarkers(map, window.FOOTPRINT_CONFIG.footprints);
        }, 100);
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
    document.querySelectorAll('.likcc-layer-btn[data-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            if (type === 'normal' || type === 'satellite') {
                handleLayerChange(btn, type, layerState, map, layers);
            }
        });
    });

    // 处理功能开关的变化事件
    document.querySelectorAll('.likcc-toggle-item input[type="checkbox"]').forEach(checkbox => {
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
    
    // 比例尺更新函数
    const updateScale = () => {
        const scaleText = document.getElementById('scale-text');
        if (scaleText) {
            const zoom = map.getZoom();
            let scale = '';
            
            if (zoom >= 15) {
                scale = '100 米';
            } else if (zoom >= 12) {
                scale = '1 公里';
            } else if (zoom >= 9) {
                scale = '10 公里';
            } else if (zoom >= 6) {
                scale = '100 公里';
            } else if (zoom >= 3) {
                scale = '1000 公里';
            } else {
                scale = '10000 公里';
            }
            
            scaleText.textContent = scale;
        }
    };
    
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', debounce(() => {
            const currentZoom = map.getZoom();
            if (currentZoom < 18) { // 限制最大缩放级别
                map.setZoom(currentZoom + 1);
                setTimeout(updateScale, 300); // 延迟更新比例尺
            }
        }, 200));
    }
    
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', debounce(() => {
            const currentZoom = map.getZoom();
            if (currentZoom > 3) { // 限制最小缩放级别
                map.setZoom(currentZoom - 1);
                setTimeout(updateScale, 300); // 延迟更新比例尺
            }
        }, 200));
    }
    
    // 监听地图缩放事件，实时更新比例尺
    map.on('zoomend', updateScale);

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