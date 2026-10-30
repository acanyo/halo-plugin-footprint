/**
 * 小工具：取元素、读足迹数据、转义、日期格式、数值插值、计时器、入口门控。
 */

import { ENTRY_MIN_WIDTH, BOOK_COLORS } from './constants.js';
import { state } from './state.js';

// ---------------- 小工具 ----------------

export function $(id) { return document.getElementById(id); }

export function api() { return window.FootprintMemoryData || null; }

export function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 2026-03-05 -> 2026 年 3 月
export function formatMonth(value) {
    var m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
    if (!m) return '';
    return m[1] + ' 年 ' + Number(m[2]) + ' 月';
}

// 2026-03-05 -> 2026.03.05
export function formatDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!m) return formatMonth(value) || '时间未记录';
    return m[1] + '.' + m[2] + '.' + m[3];
}


export function palette(index) {
    return BOOK_COLORS[((index % BOOK_COLORS.length) + BOOK_COLORS.length) % BOOK_COLORS.length];
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function lerp(from, to, t) {
    return from + (to - from) * t;
}

export function smoothstep(t) {
    var v = clamp(t, 0, 1);
    return v * v * (3 - 2 * v);
}

export function nameSizeClass(name) {
    var len = String(name || '').length;
    if (len > 7) return ' extra-long';
    if (len > 4) return ' long';
    return '';
}

export function clearTimer(key) {
    if (state.timers[key]) {
        clearTimeout(state.timers[key]);
        state.timers[key] = 0;
    }
}

export function setTimer(key, fn, ms) {
    clearTimer(key);
    state.timers[key] = setTimeout(fn, ms);
}

export function enabled() {
    if (window.matchMedia('(pointer: coarse)').matches) return false;
    if ('ontouchstart' in window && window.matchMedia('(hover: none)').matches) return false;
    return window.innerWidth >= ENTRY_MIN_WIDTH;
}
