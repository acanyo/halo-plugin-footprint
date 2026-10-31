/**
 * 强调色：后台「主题色」一处设置，三个前台（3D 地球、2D 地图、书架）都从这里取。
 *
 * CSS 里的 --fp-accent 系列由 applyAccentToDocument 写到 :root 上；
 * canvas、Cesium 材质、SVG 图块读不到 CSS 变量，改用 accentHex / accentRgba 取色值。
 *
 * 后台的值以前是「h,s%,l%」三元组（旧的 hsl 文本框），现在是取色组件存的 #rrggbb。
 * 后端已经统一换成 #rrggbb 再下发；这里仍两种都认，旧缓存页面或手填的值也不会失效。
 * 认不出来时用默认的淡紫。
 */

export const DEFAULT_ACCENT = '#7c7bc0';

/** 「h,s%,l%」→ {r,g,b}；格式不对返回 null。 */
export function parseHslTriplet(value) {
    const m = String(value || '').match(/^\s*(?:hsla?\(\s*)?(-?[\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)?\s*$/i);
    if (!m) return null;
    const h = (((Number(m[1]) % 360) + 360) % 360) / 360;
    const s = Math.min(100, Number(m[2])) / 100;
    const l = Math.min(100, Number(m[3])) / 100;
    if (s === 0) {
        const v = Math.round(l * 255);
        return {r: v, g: v, b: v};
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return {
        r: Math.round(hue(h + 1 / 3) * 255),
        g: Math.round(hue(h) * 255),
        b: Math.round(hue(h - 1 / 3) * 255)
    };
}

/** 「#rgb / #rrggbb」→ {r,g,b}；格式不对返回 null。 */
export function parseHex(value) {
    const m = String(value || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
    };
}

const toHex = ({r, g, b}) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

/** 后台的任意写法 → #rrggbb（小写）；认不出来返回默认淡紫。 */
export function normalizeAccent(value) {
    const rgb = parseHex(value) || parseHslTriplet(value);
    return rgb ? toHex(rgb) : DEFAULT_ACCENT;
}

/** 相对亮度（WCAG），0 = 黑，1 = 白。 */
export function relativeLuminance({r, g, b}) {
    const lin = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * 强调色实底上的文字用白还是深墨：选对比度高的那个。
 * 站长挑了很浅的颜色（比如淡黄）时，白字会看不清。
 */
export function accentInkFor(hex) {
    const rgb = parseHex(hex) || parseHex(DEFAULT_ACCENT);
    const lum = relativeLuminance(rgb);
    const onWhite = 1.05 / (lum + 0.05);
    const onInk = (lum + 0.05) / (relativeLuminance({r: 0x3a, g: 0x3a, b: 0x40}) + 0.05);
    return onWhite >= onInk ? '#ffffff' : '#3a3a40';
}

const readConfigAccent = () => normalizeAccent(window.FOOTPRINT_CONFIG?.accentColor || window.FOOTPRINT_CONFIG?.hsla);

/** 当前强调色 #rrggbb（每次现读配置：书架等脚本可能比配置先加载）。 */
export function accentHex() {
    return readConfigAccent();
}

/** 当前强调色的 rgba() 字符串，给 canvas / Cesium / SVG 用。 */
export function accentRgba(alpha = 1) {
    const {r, g, b} = parseHex(readConfigAccent());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 把强调色写成 :root 上的 CSS 变量，覆盖 tokens.css 里的默认淡紫。
 * 三个前台的入口各调一次；重复调用只是写同样的值。
 */
export function applyAccentToDocument(root = document.documentElement) {
    const hex = readConfigAccent();
    const {r, g, b} = parseHex(hex);
    root.style.setProperty('--fp-accent', hex);
    root.style.setProperty('--fp-accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`);
    root.style.setProperty('--fp-accent-ink', accentInkFor(hex));
}
