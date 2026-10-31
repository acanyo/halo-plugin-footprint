/**
 * 房间配色：按当前这本书的布色算出整间棚的浅色系（roomTint），
 * 换书时把墙、地、木架、灯光与雾一起渐变过去。
 */

import { BOOK_COLORS, FOIL_COLORS } from './constants.js';
import { accentHex } from '../../shared/accent.js';
import { els, shelf, reduceMotion } from './state.js';

// ==========================================================================
// 房间配色（照 complete-shelf 的 applyBookTheme）
// --------------------------------------------------------------------------
// 参考实现里每本书都带一整套 palette：墙直接刷成书的布色（Codex 那本是深蓝
// 墙、Cursor 是黄绿墙），地面、木架、主光、补光、轮廓光、雾全部跟着换，
// 所以翻到下一本时"换的不是一本书，是整间屋子"。
//
// 我们的底板是柔光玻璃的浅灰淡紫书房（浅灰墙 + 灰紫地 + 去色的木架，前台玻璃面板压深墨字），
// 不能直接照抄那套饱和墙色，否则顶栏和提示文字立刻糊在深墙上。这里改成**把布色按固定
// 比例调进底色**：
//     wall  = 纸色 66% + 布色 34%      floor = 纸色 78% + 布色 22%
//     wood  = 木色 86% + 布色 14%      light/fill 也都沾一点布色
// 比例是算出来的、不是挑出来的，所以六套配色一定在同一个明度区间里，
// 深色墨字（--fp-ink #3a3a40）压在墙上始终是对比度足够的浅底。
// ==========================================================================
var ROOM_BASE = {
    paper: '#f1f0f5',       // 墙的底：浅灰（--fp-paper 再提亮一点，渲染后会被灯光压暗）
    // 地的底。**必须比纸页明显深**：之前地面渲染出来是 240 亮度、书页是 238，
    // 两者几乎同色，用户看到的就是"书页和地面糊在一起"。这里比墙深一档、带淡紫灰，
    // 和纸页（白）、墙（浅灰）都拉得开。
    floorPaper: '#d3d1dd',
    // 木架：木纹贴图是灰白的白蜡木，这里的颜色和贴图相乘，再压一点灰紫，
    // 和界面的冷灰调放在一起
    wood: '#ddd8e2',
    woodDark: '#9d97a8',    // 木架暗部（前缘压条 / 立柱 / 背挡）
    light: '#fdfbff',       // 主光：近白，微冷
    fill: '#e3e5f2'         // 补光：淡紫蓝
};

function hexToRgb(hex) {
    var value = String(hex).replace('#', '');
    if (value.length === 3) {
        value = value.charAt(0) + value.charAt(0) + value.charAt(1) +
            value.charAt(1) + value.charAt(2) + value.charAt(2);
    }
    var num = parseInt(value, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

// 两色线性插值，返回 #rrggbb 字符串。
function mixHex(from, to, t) {
    var a = hexToRgb(from);
    var b = hexToRgb(to);
    var mix = function (x, y) { return Math.round(x + (y - x) * t); };
    return '#' + [mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b)].map(function (value) {
        return ('0' + value.toString(16)).slice(-2);
    }).join('');
}

// 感知亮度（0~1）。用来判断"这组配色的烫金比布亮还是比布暗" ——
// 烫金该怎么渲染完全取决于这个（见 buildRig 里 foilMaterial 那段）。
export function hexLum(hex) {
    var c = hexToRgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

// 第 index 本书对应的屋子配色。除了布色，其余全部由 ROOM_BASE 混出来，
// 保证六套配色的明度关系一致（换书时不会忽明忽暗）。
export function roomTint(index, key) {
    var total = BOOK_COLORS.length;
    var fabric = BOOK_COLORS[((index % total) + total) % total][0];
    var foil = FOIL_COLORS[((index % total) + total) % total];
    switch (key) {
        case 'wall': return mixHex(ROOM_BASE.paper, fabric, 0.34);
        case 'floor': return mixHex(ROOM_BASE.floorPaper, fabric, 0.34);
        case 'wood': return mixHex(ROOM_BASE.wood, fabric, 0.14);
        case 'woodDark': return mixHex(ROOM_BASE.woodDark, fabric, 0.18);
        case 'light': return mixHex(ROOM_BASE.light, fabric, 0.10);
        case 'fill': return mixHex(ROOM_BASE.fill, fabric, 0.18);
        case 'fog': return mixHex(ROOM_BASE.paper, fabric, 0.30);
        case 'rim': return foil;
        // 信息板/纸张用的两个色：面板强调色与分隔金线，跟着书走
        case 'accent': return mixHex(accentHex(), fabric, 0.45);   // --fp-accent（后台「主题色」）混一点布色
        case 'gold': return foil;
        default: return fabric;
    }
}


// ---------------- 按省份换屋子（照 complete-shelf 的 applyBookTheme / updateTheme） ----------------
// 参考实现换书时把 roomMaterials（地、墙、木架、接触阴影）、roomLights（7 盏灯）
// 和 scene.fog 一起 lerp 到新书的 palette，所以过渡看起来是"整间屋子换了光"，
// 而不是"书换了个颜色"。这里做同一件事，只把调色板换成 roomTint 算出来的浅色系。
var ROOM_THEME_KEYS = ['wall', 'floor', 'wood', 'woodDark', 'light', 'fill', 'rim', 'fog'];
export var roomTheme = { index: -1, target: {}, moving: false };

// 信息板/背景这些 DOM 侧也跟着走：只改几个 CSS 变量，纸张与墨色不动，
// 所以对比度不受影响（3D 里是"墙"，DOM 里是"面板的底色与强调色"）。
function syncPanelTheme(index) {
    if (!els.root || !els.root.style) return;
    var style = els.root.style;
    style.setProperty('--ms-room-wall', roomTint(index, 'wall'));
    style.setProperty('--ms-room-floor', roomTint(index, 'floor'));
    style.setProperty('--ms-accent', roomTint(index, 'accent'));
    style.setProperty('--ms-gold', roomTint(index, 'gold'));
}

function snapRoomTheme() {
    if (!shelf || !shelf.room) return;
    var room = shelf.room;
    var target = roomTheme.target;
    var copy = function (material, color) {
        if (material && material.color && color) material.color.copy(color);
    };
    copy(room.floor, target.floor);
    copy(room.wall, target.wall);
    copy(room.wood, target.wood);
    copy(room.woodDark, target.woodDark);
    copy(room.fog, target.fog);
    room.warm.forEach(function (light) { copy(light, target.light); });
    room.cool.forEach(function (light) { copy(light, target.fill); });
    room.rim.forEach(function (light) { copy(light, target.rim); });
    if (room.hemi) {
        copy(room.hemi, target.light);
        if (room.hemi.groundColor && target.woodDark) room.hemi.groundColor.copy(target.woodDark);
    }
    roomTheme.moving = false;
}

export function applyRoomTheme(index, instant) {
    if (!shelf || !shelf.room) return;
    var THREE = shelf.THREE;
    if (index === roomTheme.index && !instant) return;
    roomTheme.index = index;
    ROOM_THEME_KEYS.forEach(function (key) {
        if (!roomTheme.target[key]) roomTheme.target[key] = new THREE.Color();
        roomTheme.target[key].set(roomTint(index, key));
    });
    syncPanelTheme(index);
    if (instant || reduceMotion) snapRoomTheme();
    else roomTheme.moving = true;
}

export function updateRoomTheme(delta) {
    if (!roomTheme.moving || !shelf || !shelf.room) return;
    var room = shelf.room;
    var target = roomTheme.target;
    // 5.5 是参考实现 updateTheme 里的收敛速度
    var amount = 1 - Math.exp(-delta * 5.5);
    var largestGap = 0;
    var ease = function (material, color) {
        if (!material || !material.color || !color) return;
        var current = material.color;
        largestGap = Math.max(largestGap,
            Math.abs(current.r - color.r) + Math.abs(current.g - color.g) +
            Math.abs(current.b - color.b));
        current.lerp(color, amount);
    };
    ease(room.floor, target.floor);
    ease(room.wall, target.wall);
    ease(room.wood, target.wood);
    ease(room.woodDark, target.woodDark);
    ease(room.fog, target.fog);
    room.warm.forEach(function (light) { ease(light, target.light); });
    room.cool.forEach(function (light) { ease(light, target.fill); });
    room.rim.forEach(function (light) { ease(light, target.rim); });
    ease(room.hemi, target.light);
    if (room.hemi && room.hemi.groundColor && target.woodDark) {
        ease({ color: room.hemi.groundColor }, target.woodDark);
    }
    // 收敛到位就吸附到精确目标：这样过渡的首末帧都是确定值，不会留一丝残差
    if (largestGap < 0.004) snapRoomTheme();
}
