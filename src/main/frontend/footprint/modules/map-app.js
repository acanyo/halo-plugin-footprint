/**
 * 2D 高德地图的初始化：创建地图、图层、控件，并装配标记点与时间线。
 */

import { addFootprintMarkers } from './footprint-markers.js';
import { addVisitedCityLayer, handleLayerChange, updateLayers } from './map-layers.js';
import { createFootprintMarkerController } from './marker-visibility.js';
import { state } from './state.js';
import { renderStats } from './stats-panel.js';
import { populateTimeline } from './timeline.js';
import { addButtonAnimation, showElements } from './ui-animations.js';


// 初始化应用
export const initializeApp = async () => {
    try {
        // 使用独立楼块图层，避免自定义地图样式隐藏底图自带楼块
        const buildingLayer = new AMap.Buildings({
            zIndex: 10,
            zooms: [16.8, 24],
            heightFactor: 1.2,
            // 雾蓝玻璃感楼块：楼顶略清晰，楼面更透明，接近浅色地图的视觉效果
            wallColor: 'rgba(175,206,233,0.2)',
            roofColor: 'rgba(175,206,233,0.5)'
        });

        // 创建地图实例
        const map = new AMap.Map('footprint-map', {
            zoom: 4.1,
            center: [116.397428, 39.90923],
            zooms: [2, 26],
            // 后台没选样式时用浅色的「远山黛」，和白玻璃面板最搭；选了就按后台的来
            mapStyle: window.FOOTPRINT_CONFIG.mapStyle || 'amap://styles/whitesmoke',
            viewMode: '3D',
            pitch: 0,
            pitchEnable: false, // 禁止右键拖拽调整仰角
            rotateEnable: false, // 禁止右键拖拽旋转地图
            // 关闭底图自带楼块，改用上方独立的 AMap.Buildings 图层
            showBuildingBlock: false,
            features: ['bg', 'road', 'point'],
            layers: [
                AMap.createDefaultLayer()
            ],
            resizeEnable: true     // 启用自动适应容器尺寸
        });
        state.activeMapInstance = map;

        // 等待地图加载完成
        await new Promise(resolve => {
            map.on('complete', resolve);
        });

        // 地图完成后显式挂载独立楼块图层，确保自定义地图样式不会覆盖楼块显示
        map.add(buildingLayer);

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
        state.footprintMarkerController = createFootprintMarkerController(map);
        initializeMapFeatures(map, layers);

        // 添加已去过城市高亮图层
        await addVisitedCityLayer(map, window.FOOTPRINT_CONFIG.footprints);

        // 添加足迹标记
        addFootprintMarkers(map, window.FOOTPRINT_CONFIG.footprints);

        showElements();
        renderStats();
        // 为所有控制按钮添加点击动画
        document.querySelectorAll('.control-btn, .zoom-controls button, #map-fullscreen').forEach(button => {
            addButtonAnimation(button);
        });


        // 只在非移动端显示界面元素
        populateTimeline(map);
        state.footprint2dInitialized = true;
    } catch (error) {
        console.error('初始化地图时发生错误:', error);
    }
};

// 性能优化：将地图功能初始化封装为单独的函数
export const initializeMapFeatures = (map, layers) => {
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
        if (type === 'markers') return;
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

    // 处理足迹标记点显示开关。标记点与已访问城市高亮是两个独立图层。
    const markerVisibilityToggle = document.querySelector('.marker-switch input[data-type="markers"]');
    if (markerVisibilityToggle && state.footprintMarkerController) {
        markerVisibilityToggle.checked = state.footprintMarkerController.isVisible();
        markerVisibilityToggle.addEventListener('change', () => {
            state.footprintMarkerController.setVisible(markerVisibilityToggle.checked);
        });
    }

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
