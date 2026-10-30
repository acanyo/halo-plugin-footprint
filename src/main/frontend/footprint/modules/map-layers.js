/**
 * 地图图层：卫星 / 路网 / 路况切换，以及已去过城市的行政区高亮。
 */

// 图层配置
export const layerConfig = {
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

// 优化图层切换
export const handleLayerChange = (btn, type, layerState, map, layers) => {
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
export const updateLayers = async (layerState, layers) => {
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

// 将页面主题 HSL 转换为高德行政区图层可用的 RGBA 颜色
export const getThemeRgba = (alpha = 1) => {
    const value = window.FOOTPRINT_CONFIG?.hsla || '';
    const match = String(value).match(/^\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*$/);
    if (!match) {
        return `rgba(236, 72, 153, ${alpha})`;
    }

    const h = (Number(match[1]) % 360) / 360;
    const s = Math.max(0, Math.min(100, Number(match[2]))) / 100;
    const l = Math.max(0, Math.min(100, Number(match[3]))) / 100;
    const hueToRgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    if (s === 0) {
        const gray = Math.round(l * 255);
        return `rgba(${gray}, ${gray}, ${gray}, ${alpha})`;
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
    const g = Math.round(hueToRgb(p, q, h) * 255);
    const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// 高亮已去过的城市，不改变地图视野和现有足迹标记
export const addVisitedCityLayer = (map, footprintData) => {
    if (!window.FOOTPRINT_CONFIG?.highlightVisitedCities || !Array.isArray(footprintData)) {
        return Promise.resolve(null);
    }

    const visitedCitySet = new Set(
            footprintData
                    .map(item => item?.spec?.cityAdcode)
                    .filter(Boolean)
                    .map(adcode => String(adcode))
    );

    if (visitedCitySet.size === 0) {
        return Promise.resolve(null);
    }

    // 异步加载行政区图层插件，确保插件加载完成后再创建高亮图层
    return new Promise(resolve => {
        AMap.plugin('AMap.DistrictLayer', () => {
            try {
                // 创建中国行政区图层：depth 为 2 时可以显示到城市级别
                const visitedCityLayer = new AMap.DistrictLayer.Country({
                    zIndex: 8,
                    SOC: 'CHN',
                    depth: 2,
                    styles: {
                        // 隐藏国家外围边框，避免与地图底图边界重复显示
                        'nation-stroke': '',
                        // 使用主题色显示海岸线，同时降低透明度避免过于抢眼
                        'coastline-stroke': getThemeRgba(0.62),
                        // 隐藏省级边框，只保留城市级别的边界
                        'province-stroke': '',
                        // 统一设置行政区边界线宽度
                        'stroke-width': 1.5,
                        // 根据城市是否去过，分别设置城市边框颜色
                        'city-stroke': properties => {
                            const cityAdcode = properties?.adcode_cit;
                            return visitedCitySet.has(String(cityAdcode))
                                    ? getThemeRgba(0.92)
                                    : '';
                        },
                        // 只填充已去过的城市，未去过的城市保持透明
                        fill: properties => {
                            const cityAdcode = properties?.adcode_cit;
                            return visitedCitySet.has(String(cityAdcode))
                                    ? getThemeRgba(0.28)
                                    : '';
                        }
                    }
                });

                // 将创建好的行政区图层添加到地图，并返回图层实例
                map.add(visitedCityLayer);
                resolve(visitedCityLayer);
            } catch (error) {
                // 图层创建失败时不阻塞页面其他功能，返回空值作为降级结果
                console.warn('已去过城市高亮图层创建失败:', error);
                resolve(null);
            }
        });
    });
};
