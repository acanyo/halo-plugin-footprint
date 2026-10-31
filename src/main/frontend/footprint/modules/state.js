/**
 * 2D 足迹页的共享可变状态。
 *
 * 原 footprint.js 是一个经典脚本，这些顶层 let 被多个函数直接读写。
 * 拆成 ES 模块后，导入的绑定是只读的，跨模块重新赋值必须经由一个可变对象，
 * 所以统一收进 state，读写都写成 state.xxx。
 *
 * 只在单个模块内部使用的状态（例如悬停缩放的 boundZoom*、frequency）仍留在各自模块里。
 */

export const state = {
    // ===== 2D 高德地图懒加载接口状态（见 index.js 的 window.Footprint2D） =====
    footprint2dInitialized: false,
    footprint2dInitializing: false,

    // 添加一个全局变量来跟踪当前激活的卡片
    activeCard: null,
    // 跟踪当前正在执行动画的卡片（与activeCard分开，避免mouseleave中断异步动画）
    animationInFlight: null,
    closeActiveFootprint: null,
    timelineHoverGeneration: 0,
    timelineActivationToken: 0,
    activeMapInstance: null,
    lastTimelinePointer: null,
    timelineScrollEndTimer: null,

    footprintMarkerController: null,

    //是否打开时间线
    isTimelineOpen: false,

    //是否打开仰角和旋转
    isElevation: false,
    // 仰角和旋转还原动画进行中时，仍需阻止后续操作使用中间状态
    isElevationRestoring: false,
    elevationRestorePromise: null,

    // 原代码有几处 `isAnimating = false;` 写的是未声明变量（经典脚本下隐式挂到 window），
    // 抛物线动画读的是它自己函数内的同名局部变量，这个值实际没人读。
    // 模块是严格模式，给未声明变量赋值会抛 ReferenceError，因此收到这里保留写入。
    isAnimating: undefined
};

// 标记点DOM缓存，避免重复querySelector查询
export const markerCache = new Map();
