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

// 优化地图移动
const moveToLocation = (map, position) => {
    return new Promise((resolve) => {
        // 启用动画
        map.setStatus({animateEnable: true});
        
        // 设置缩放级别
        if (map.getZoom() < 14) {
            map.setZoom(14);
        }

        // 平移到目标位置
        map.panTo(position);
        
        // 等待动画完成
        const checkAnimation = () => {
            if (!map.isMoving && !map.isZooming) {
                resolve();
            } else {
                requestAnimationFrame(checkAnimation);
            }
        };
        checkAnimation();
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
                // 如果当前标记已经打开，则关闭它
                if (currentMarker === marker) {
                    infoWindow.close();
                    currentMarker = null;
                    return;
                }

                // 先关闭当前窗体
                if (currentMarker) {
                    infoWindow.close();
                }

                // 构建信息窗体内容
                const content = createInfoWindow(footprint.spec);

                // 检查是否需要移动地图
                const currentPos = map.getCenter();
                const distance = position.distance(currentPos);
                const currentZoom = map.getZoom();
                
                // 如果距离超过1公里或缩放级别不够，需要移动地图
                const needsMovement = distance > 1000 || currentZoom < 13;
                
                if (needsMovement) {
                    // 先移动地图，等待移动完成后再打开窗口
                    await moveToLocation(map, position);
                }
                
                // 打开信息窗口
                openInfoWindow(position, content);
                currentMarker = marker;
            });

            map.add(marker);
        } catch (error) {
            console.error('创建标记失败:', error, footprint);
        }
    });
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

// 初始化应用
const initializeApp = async () => {
    try {
        // 创建地图实例
        const map = new AMap.Map('footprint-map', {
            zoom: 4,
            center: [116.397428, 39.90923],
            mapStyle: window.FOOTPRINT_CONFIG.mapStyle || 'amap://styles/normal',
            viewMode: '3D',
            pitch: 0,
            features: ['bg', 'road', 'building', 'point'],
            showBuildingBlock: true
        });
        
        // 保存地图实例到全局变量
        window.footprintMap = map;

        // 等待地图加载完成
        await new Promise(resolve => {
            map.on('complete', resolve);
        });

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

        // 添加足迹标记
        addFootprintMarkers(map, window.FOOTPRINT_CONFIG.footprints);

        // 显示界面元素
        showElements();

        // 为所有控制按钮添加点击动画
        document.querySelectorAll('.control-btn, .zoom-controls button').forEach(button => {
            addButtonAnimation(button);
        });

    } catch (error) {
        console.error('初始化地图时发生错误:', error);
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

    // 优化比例尺更新
    const updateScaleText = debounce(() => {
        requestAnimationFrame(() => {
            const originalScaleText = document.querySelector('.amap-scale-text');
            if (originalScaleText) {
                document.querySelector('.map-controls .amap-scale-text').textContent = originalScaleText.textContent;
                const originalScale = document.querySelector('.amap-scale');
                if (originalScale) {
                    originalScale.style.display = 'none';
                }
            }
        });
    }, 100);

    // 添加事件监听
    map.on('zoom', updateScaleText);
    map.on('moveend', updateScaleText);

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

    // 处理缩放按钮点击
    document.getElementById('zoom-in').addEventListener('click', () => {
        map.setZoom(map.getZoom() + 1);
    });

    document.getElementById('zoom-out').addEventListener('click', () => {
        map.setZoom(map.getZoom() - 1);
    });

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