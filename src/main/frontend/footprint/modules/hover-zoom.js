/**
 * 时间线卡片悬停 / 标记点点击时的分段缩放监听。
 *
 * boundZoom*、frequency 只在本模块内读写，保持为模块内 let。
 */

import { moveToLocation } from './map-motion.js';
import { loadParabolaAnimation } from './parabola-animation.js';
import { state } from './state.js';

// 存储绑定的函数，方便解绑
let boundZoomStart, boundZoom, boundZoomEnd;

//缩放事件绑定次数
let frequency;

// 移除悬停缩放的全部监听。悬停时会在 zoomend 中启动第二段缩放，
// 如果点击旅行故事后仍保留这些监听，它们会把地图再次缩放回悬停级别。
export function clearTimelineHoverZoom(map) {
    const bindings = [
        ['zoomstart', boundZoomStart],
        ['zoomchange', boundZoom],
        ['zoomend', boundZoomEnd],
        ['zoomstart', boundZoomStart3],
        ['zoomchange', boundZoom3],
        ['zoomend', boundZoomEnd3],
    ];

    bindings.forEach(([eventName, handler]) => {
        if (handler) {
            map.off(eventName, handler);
        }
    });

    boundZoomStart = null;
    boundZoom = null;
    boundZoomEnd = null;
    boundZoomStart3 = null;
    boundZoom3 = null;
    boundZoomEnd3 = null;
    frequency = undefined;
}


//绑定事件 用于card的悬停
export function zoomOn(map, card, newPosition, zoom) {
    // console.log("绑定事件!");

    // 存储绑定的函数
    boundZoomStart = mapZoomstart.bind(null, card);
    boundZoom = mapZoom.bind(null, card);
    boundZoomEnd = mapZoomend.bind(null, card, map, newPosition, zoom);

    map.on('zoomstart', boundZoomStart);
    map.on('zoomchange', boundZoom);
    map.on('zoomend', boundZoomEnd);
}

export function zoomOff(map, card, newPosition, byOverlays) {
    // console.log("解除事件绑定!");

    // 使用存储的函数引用解绑
    if (boundZoomStart) map.off('zoomstart', boundZoomStart);
    if (boundZoom) map.off('zoomchange', boundZoom);
    if (boundZoomEnd) map.off('zoomend', boundZoomEnd);
    if (card) {
        //第二次 绑定地图 缩放事件
        zoomOn3(map, card, newPosition, byOverlays, 2);
        moveToLocation(map, newPosition, byOverlays, 0).then((sameZoom) => {
            // 第二次移动若已处于目标级别，不会触发 zoomend，需主动结束监听并渲染抛物线
            if (sameZoom) {
                zoomOff3(map, card);
            }
        });
    }
}

// 存储绑定的函数，方便解绑
let boundZoomStart2, boundZoom2, boundZoomEnd2;

//绑定事件 用于标记点的缩放
export function zoomOn2(map, card) {
    // console.log("绑定事件2!");

    // 存储绑定的函数
    boundZoomStart2 = mapZoomstart.bind(null, card);
    boundZoom2 = mapZoom.bind(null, card);
    boundZoomEnd2 = mapZoomend.bind(null, card, map, null, null, null);

    map.on('zoomstart', boundZoomStart2);
    map.on('zoomchange', boundZoom2);
    map.on('zoomend', boundZoomEnd2);
}

export function zoomOff2(map) {
    // console.log("解除事件绑定2!");

    // 使用存储的函数引用解绑
    if (boundZoomStart2) map.off('zoomstart', boundZoomStart2);
    if (boundZoom2) map.off('zoomchange', boundZoom2);
    if (boundZoomEnd2) map.off('zoomend', boundZoomEnd2);
}

// 存储绑定的函数，方便解绑
let boundZoomStart3, boundZoom3, boundZoomEnd3;

//绑定事件 用于标记点的缩放
export function zoomOn3(map, card, newPosition, zoom) {
    // console.log("绑定事件3!");

    // 存储绑定的函数
    boundZoomStart3 = mapZoomstart.bind(null, card);
    boundZoom3 = mapZoom.bind(null, card);
    boundZoomEnd3 = mapZoomend.bind(null, card, map, newPosition, zoom);

    map.on('zoomstart', boundZoomStart3);
    map.on('zoomchange', boundZoom3);
    map.on('zoomend', boundZoomEnd3);
}

export function zoomOff3(map, card) {
    // console.log("解除事件绑定3!");
    // 第二次 缩放结束以后执行抛物线
    if (card) {
        loadParabolaAnimation(card, map);
    }

    // 使用存储的函数引用解绑
    if (boundZoomStart3) map.off('zoomstart', boundZoomStart3);
    if (boundZoom3) map.off('zoomchange', boundZoom3);
    if (boundZoomEnd3) map.off('zoomend', boundZoomEnd3);
}

//地图开始缩放
export function mapZoomstart() {
    // console.log("缩放开始");
}

//地图缩放中
export function mapZoom(map) {
    // console.log("正在缩放");
}

//缩放结束
export async function mapZoomend(card, map, newPosition, byOverlays) {
    // console.log("缩放结束");
    //卡片不为空时执行抛物线
    if (card != null) {
        if (frequency === 2) {
            // console.log("第二次解除绑定");
            zoomOff3(map, card);
            frequency = 1;
            return;
        }
        frequency = 2
        // 第一次 解除绑定 缩放事件
        zoomOff(map, card, newPosition, byOverlays);


    } else {
        zoomOff2(map);
        /*if (isMobile) {
            map.panBy(0, 120);
        }*/
        // calculateTheNewCenterPoint(map);
    }
}

// 计算打开抽屉后，中间点的偏移像素
export const calculateTheNewCenterPoint = (map) => {
    if (!state.isTimelineOpen) {
        return;
    }

    const drawer = document.getElementById("timelineDrawer");
    const drawerWidth = drawer.getBoundingClientRect().width;

    // 1. 计算抽屉左边到窗口左边的距离
    const availableWidth = window.innerWidth - drawerWidth;

    // 2. 计算新的中心点（相对于窗口左侧）
    const newCenterX = availableWidth / 2;

    // 3. 计算原始中心点到新中心点的距离
    const number = (window.innerWidth / 2) - newCenterX;

    // 移动
    map.panBy(-number + 60, (window.innerHeight / 4) - 80);
}
