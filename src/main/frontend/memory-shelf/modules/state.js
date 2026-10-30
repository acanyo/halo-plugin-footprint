/**
 * 书架的运行时状态。
 *
 * 会被整体换掉的顶层变量（shelf / renderer3d / version …）各配一个 setter：
 * ES 模块的导入绑定是只读的，别的模块要改它只能经由声明它的模块。
 * 读的一方照常 import，拿到的是活绑定，setter 一调用就能看到新值。
 */

// ---------------- 状态 ----------------

export var state = {
    level: 'shelf',        // shelf | chapters | album
    mode: 'shelf',         // shelf(在书架上) | book(已经翻开成三维书本)
    // 显式五态（照参考实现 shelf → opening → inspection → reading → closing）。
    // 行为不变，只是把原来散在 mode / level / opening / closing 里的状态收敛成
    // 一个字段，便于在边缘场景（快速连点、抛飞、中途反向拖拽）判断当前处于哪一态。
    phase: 'shelf',
    bookLevel: 'chapters', // book 模式下的层级：chapters | album
    bookPages: [],
    bookTextures: [],
    bookSpread: 0,
    pageTurn: null,        // { forward, p, target, dragging, next }
    bookDrag: null,
    bookEnterAt: 0,
    bookOpen: 0,           // 封面的掀开程度 0..1
    openTarget: 0,         // 封面目标开合度：点击/拖拽决定
    coverHover: false,
    coverDrag: null,
    orbit: null,
    // 检视态的相机：绕书旋转 / 平移 / 缩放（规格要求背景可 orbit、pan、zoom）
    view: { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 },
    photoList: [],
    books: [],
    active: 0,
    province: null,
    city: null,
    photos: [],
    page: 0,
    paging: false,
    opening: false,
    bookRotation: null,    // null = 未在旋转；数值 = 当前角度（度）
    suppressClickUntil: 0,
    wheelAt: 0,
    turning: false,
    photoIndex: 0,
    timers: {}
};

export var els = {};
export var shelf = null;          // Three.js 运行时上下文
export function setShelf(value) { shelf = value; }

export var renderer3d = null;
export function setRenderer3d(value) { renderer3d = value; }
export var version = '';
export function setVersion(value) { version = value; }
export var reduceMotion = false;
export function setReduceMotion(value) { reduceMotion = value; }

export var maxAnisotropy = 4;      // 渲染器就绪后取硬件上限，用于页面贴图
export function setMaxAnisotropy(value) { maxAnisotropy = value; }
