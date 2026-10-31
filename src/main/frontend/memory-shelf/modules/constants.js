/**
 * 全局常量：入口门控宽度、相册分页、长按 / 旋转 / 翻开动画参数，以及六组书布配色与烫金色。
 */

// ---------------- 常量 ----------------

export var ENTRY_MIN_WIDTH = 821;            // 与 PROVINCE_CARD_MIN_WIDTH / photo-ring 的门控一致
export var ALBUM_PER_PAGE = 1;               // 每页照片数（左右对开 => 一屏 2 张）
export var LONG_PRESS_MS = 180;              // 长按多久进入「旋转书本」模式
export var ROTATE_LIMIT = 65;                // 书本左右旋转上限（度）
export var OPEN_ANIM_MS = 1080;              // 抬起 -> 推近 -> 翻封面的总时长

// 书脊布面色：柔光玻璃界面的同一族低饱和浅色 —— 淡紫 / 鼠尾草绿 / 雾蓝 / 沙 / 灰玫瑰 / 石板灰，
// 冷暖交替；明度都在中浅一档，和浅灰底、白玻璃放在一起不跳。
// [封面布色, 书页边色, 印在布上的墨色, 点缀色（布面光泽 / 书脊签）]
export var BOOK_COLORS = [
    ['#aeacd3', '#eeedf3', '#45437a', '#cfcde6'],   // 淡紫（与 --fp-accent 同色相）
    ['#a9bba6', '#edf0eb', '#3e523b', '#cad6c7'],   // 鼠尾草绿
    ['#a7bccd', '#ecf0f3', '#3a5164', '#c9d6e1'],   // 雾蓝
    ['#d6c7aa', '#f1ede4', '#5f4d2c', '#e6dcc8'],   // 沙
    ['#d3aeb3', '#f3ecee', '#6c414a', '#e5cfd2'],   // 灰玫瑰
    ['#b7bccb', '#eceef2', '#3c4252', '#d3d6df']    // 石板灰
];

// 烫金（烫印）用的金属色，与上面六组布面一一对应。
// **不能**复用 BOOK_COLORS 里的第三项：那一项是「印在布上的墨色」；金属的颜色取自反照率，
// 这里单独给一组。六组都是浅布配同色相的深烫印（读起来是「深字压浅布」）；
// book-geometry.js 会按烫印比布暗自动保持高金属度、不加自发光，这样深字最清楚。
export var FOIL_COLORS = [
    '#55538c',   // 淡紫布 -> 深紫烫印
    '#4a5f45',   // 鼠尾草 -> 深绿烫印
    '#455d71',   // 雾蓝 -> 深蓝烫印
    '#7a6234',   // 沙 -> 古铜
    '#7d4e57',   // 灰玫瑰 -> 深玫瑰
    '#454c5e'    // 石板灰 -> 深石板
];

// 书页纸色：与柔光玻璃的不透明卡片（styles/shared/tokens.css 的 --fp-paper-raised）同一色。
// 3D 页面材质、canvas 页面底色共用这一个值。
export var PAGE_PAPER = '#ffffff';
// 书口（书页侧面）比纸面略深一档、带一点淡紫灰，看得出是一叠纸
export var PAGE_EDGE = '#e6e5ec';
