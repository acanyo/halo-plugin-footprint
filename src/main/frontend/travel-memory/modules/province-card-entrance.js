/**
 * 省份城市卡片的入场 / 退场动画：错峰规划、卡片从标记飞出、连线铺开、起点脉冲、收起回缩。
 *
 * 从 province-cards.js 拆出。卡片组状态仍归 province-cards.js，
 * 这里要用到的状态都以参数或取值函数传入；只有起点脉冲的 rAF 句柄是本模块自己的。
 */

import { snapDevicePx } from './geometry.js';
import {
    applyProvinceCardBox,
    applyProvinceLeaderGeometry,
    assignProvinceLeaderFans,
    provinceCardBorderPoint
} from './province-card-dom.js';

// ---- 展开动画：线到、卡到 ----
const PROVINCE_LINE_GROW_MS = 500;    // 线从标记铺到卡片的时长
const PROVINCE_CARD_FLY_MS = 500;     // 卡片与线终点共用的入场时长
const PROVINCE_CARD_EXIT_MS = 280;    // 卡片、连线和起点圆点共用的退场时长
const PROVINCE_CARD_START_SCALE = 0.82;
const PROVINCE_STAGGER_STEP_MS = 40;  // 相邻两张的错峰步长
const PROVINCE_STAGGER_MAX_MS = 600;  // 错峰总时长上限（卡片多时自动压缩步长）
const PROVINCE_PULSE_MS = 320;        // 起点"引爆"脉冲时长（仅「全部城市」）
let provincePulseRaf = null;        // 起点脉冲的 rAF 句柄
let provinceEntranceRaf = null;     // 卡片与抛物线共用的入场 rAF 句柄

// ---------- 展开动画 ----------
// 错峰顺序：单省按"到城市群中心的距离"由内向外推开；全部城市按经度西→东扫过去。
// 卡片多时自动压缩步长，总错峰不超过 PROVINCE_STAGGER_MAX_MS。
export function planProvinceEntrance(items, allMode, cityCenterOf) {
    if (!items.length) return 0;
    const step = items.length > 1
        ? Math.min(PROVINCE_STAGGER_STEP_MS, PROVINCE_STAGGER_MAX_MS / (items.length - 1))
        : 0;
    let centerX = 0;
    let centerY = 0;
    let counted = 0;
    items.forEach(item => {
        if (!item.anchor) return;
        centerX += item.anchor.x;
        centerY += item.anchor.y;
        counted++;
    });
    if (counted) {
        centerX /= counted;
        centerY /= counted;
    }
    const ordered = items.slice().sort((a, b) => provinceEntranceKey(a, centerX, centerY, allMode, cityCenterOf) -
        provinceEntranceKey(b, centerX, centerY, allMode, cityCenterOf));
    ordered.forEach((item, index) => {
        item.staggerDelay = index * step;
        item.lineDelay = item.staggerDelay;
        item.cardDelay = item.staggerDelay;
    });
    let total = 0;
    items.forEach(item => {
        total = Math.max(total,
            (item.lineDelay || 0) + PROVINCE_LINE_GROW_MS,
            (item.cardDelay || 0) + PROVINCE_CARD_FLY_MS);
    });
    return total + 120;
}

function provinceEntranceKey(item, centerX, centerY, allMode, cityCenterOf) {
    if (allMode) {
        // 西→东：像一道波从西边扫到东边，正好对上"全国铺开"的语义
        const center = cityCenterOf(item.ci);
        return center && Number.isFinite(center.lng) ? center.lng : 0;
    }
    // 单省：由内向外推开，同一条边上的卡片按离标记群中心的远近依次出现
    if (!item.anchor) return Number.MAX_VALUE;
    return Math.hypot(item.anchor.x - centerX, item.anchor.y - centerY);
}

function provinceEntranceEase(progress) {
    let low = 0;
    let high = 1;
    // 与 CSS cubic-bezier(0.16, 1, 0.3, 1) 的横轴求逆，
    // 保证卡片位移和抛物线端点使用完全相同的视觉进度。
    for (let i = 0; i < 8; i++) {
        const mid = (low + high) / 2;
        const x = 3 * (1 - mid) * (1 - mid) * mid * 0.16 +
            3 * (1 - mid) * mid * mid * 0.3 + mid * mid * mid;
        if (x < progress) low = mid;
        else high = mid;
    }
    const t = (low + high) / 2;
    return 3 * (1 - t) * (1 - t) * t +
        3 * (1 - t) * t * t + t * t * t;
}

/**
 * 卡片与抛物线共用同一个 rAF 和进度：卡片从城市标记向外散开，
 * 线端点每帧贴着卡片朝向标记的边框交点，不再先画到终点再等卡片追上来。
 */
export function startProvinceCardsFly(items, layer, reduceMotion, options = {}) {
    const isActive = options.isActive || (() => true);
    const onFinished = options.onFinished || (() => {});
    stopProvinceEntrance();
    const animated = [];
    assignProvinceLeaderFans(items);
    items.forEach(item => {
        const el = item.el;
        if (!el) return;
        el.classList.remove('is-flying');
        el.style.transitionDelay = '';
        if (reduceMotion() || !item.anchor) {
            applyProvinceCardBox(item);
            el.style.transition = '';
            el.style.opacity = '';
            el.classList.add('show');
            return;
        }
        const startX = item.anchor.x - item.w / 2;
        const startY = item.anchor.y - item.h / 2;
        el.style.transition = 'none';
        el.style.transform = 'translate3d(' + snapDevicePx(startX) + 'px,' +
            snapDevicePx(startY) + 'px,0) scale(' + PROVINCE_CARD_START_SCALE + ')';
        el.style.opacity = '0';
        // 错峰等待期间，零长度路径仍会被 round linecap 画成线头，先整组隐藏。
        item.group.style.visibility = 'hidden';
        const startEnd = provinceCardBorderPoint(
            startX, startY,
            item.w * PROVINCE_CARD_START_SCALE,
            item.h * PROVINCE_CARD_START_SCALE,
            item.anchor
        );
        applyProvinceLeaderGeometry(
            item, startEnd.x, startEnd.y, item.edgeFanIndex, item.edgeFanTotal
        );
        animated.push({ item, startX, startY });
    });
    if (!animated.length) {
        onFinished();
        return;
    }
    void (layer && layer.offsetWidth);
    const startedAt = performance.now();
    let totalMs = 0;
    animated.forEach(entry => {
        totalMs = Math.max(totalMs, (entry.item.cardDelay || 0) + PROVINCE_CARD_FLY_MS);
    });
    const tick = now => {
        if (!isActive()) {
            provinceEntranceRaf = null;
            return;
        }
        let pending = false;
        animated.forEach(entry => {
            const item = entry.item;
            const el = item.el;
            if (!el || !item.anchor) return;
            const elapsed = now - startedAt - (item.cardDelay || 0);
            const raw = Math.max(0, Math.min(1, elapsed / PROVINCE_CARD_FLY_MS));
            if (raw < 1) pending = true;
            item.group.style.visibility = raw > 0 ? 'visible' : 'hidden';
            const eased = provinceEntranceEase(raw);
            const x = entry.startX + (item.x - entry.startX) * eased;
            const y = entry.startY + (item.y - entry.startY) * eased;
            const scale = PROVINCE_CARD_START_SCALE +
                (1 - PROVINCE_CARD_START_SCALE) * eased;
            el.style.transform = 'translate3d(' + snapDevicePx(x) + 'px,' +
                snapDevicePx(y) + 'px,0) scale(' + scale + ')';
            el.style.opacity = String(eased);
            item.el.style.zIndex = String(10 + (item.layoutIndex || 0));
            const end = provinceCardBorderPoint(
                x, y, item.w * scale, item.h * scale, item.anchor
            );
            applyProvinceLeaderGeometry(
                item, end.x, end.y, item.edgeFanIndex, item.edgeFanTotal
            );
        });
        if (pending && now - startedAt < totalMs + 80) {
            provinceEntranceRaf = requestAnimationFrame(tick);
            return;
        }
        provinceEntranceRaf = null;
        animated.forEach(entry => {
            const item = entry.item;
            if (!item.el) return;
            applyProvinceCardBox(item);
            item.el.style.transition = '';
            item.el.style.opacity = '';
            item.el.style.transitionDelay = '';
            item.el.classList.add('show');
            item.group.style.visibility = '';
        });
        onFinished();
    };
    provinceEntranceRaf = requestAnimationFrame(tick);
}

// 起点"引爆"：标记在一个短脉冲里鼓一下，再回到基准尺寸。
// 只在「全部城市」模式做 —— 省份模式下标记已经因为省份高亮而全亮，再动容易和悬停强调混淆。
export function startProvinceMarkerPulse(items, opts) {
    const { reduceMotion, allMode, cityMarkerEntities, focusedMarker, isActive } = opts;
    if (reduceMotion() || !allMode) return;
    const targets = items.filter(item => item.anchor && cityMarkerEntities()[item.ci]);
    if (!targets.length) return;
    const startedAt = performance.now();
    let finishAt = 0;
    targets.forEach(item => {
        finishAt = Math.max(finishAt, (item.lineDelay || 0) + PROVINCE_PULSE_MS);
    });
    const tick = (now) => {
        if (!isActive()) {
            provincePulseRaf = null;
            return;
        }
        const elapsed = now - startedAt;
        let pending = false;
        targets.forEach(item => {
            const ent = cityMarkerEntities()[item.ci];
            if (!ent || !ent.billboard) return;
            if (focusedMarker() === ent) return;   // 正在被悬停聚焦的标记交给 hover 逻辑
            const local = elapsed - (item.lineDelay || 0);
            if (local >= PROVINCE_PULSE_MS) {
                if (ent.billboard.scale !== 1) ent.billboard.scale = 1;
                return;
            }
            pending = true;
            if (local < 0) return;
            const k = local / PROVINCE_PULSE_MS;
            ent.billboard.scale = 1 + 0.26 * Math.sin(Math.PI * k);
        });
        if (pending && elapsed < finishAt + 400) {
            provincePulseRaf = requestAnimationFrame(tick);
        } else {
            provincePulseRaf = null;
        }
    };
    if (provincePulseRaf) cancelAnimationFrame(provincePulseRaf);
    provincePulseRaf = requestAnimationFrame(tick);
}

/** 停掉起点脉冲（收起卡片组时调用）。 */
export function stopProvinceMarkerPulse() {
    if (provincePulseRaf) {
        cancelAnimationFrame(provincePulseRaf);
        provincePulseRaf = null;
    }
}

export function isProvinceEntranceRunning() {
    return provinceEntranceRaf !== null;
}

export function stopProvinceEntrance() {
    if (!provinceEntranceRaf) return;
    cancelAnimationFrame(provinceEntranceRaf);
    provinceEntranceRaf = null;
}

// 收起动画：卡片缩回自己那个标记并淡出，连线向标记端收回（dash 反着走一遍）。
// 用世代号做守卫 —— 动画没结束就点了别的省时，不能再把新的一组清掉。
export function animateProvinceCardsExit(items, els, isCurrentToken, hasNewItems) {
    const duration = PROVINCE_CARD_EXIT_MS + 'ms';
    const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
    items.forEach(item => {
        const el = item.el;
        if (el) {
            el.style.pointerEvents = 'none';   // 退场途中不再响应点击
            el.style.transition = 'transform ' + duration + ' ' + easing +
                ', opacity ' + duration + ' ' + easing;
            el.style.transitionDelay = '0ms';
            const backX = item.anchor ? item.anchor.x : item.x;
            const backY = item.anchor ? item.anchor.y : item.y;
            el.style.transform = 'translate3d(' + snapDevicePx(backX) + 'px,' +
                snapDevicePx(backY) + 'px,0) scale(0.88)';
            el.style.opacity = '0';
        }
        // 短线仅回收 dash 几乎看不出来，整组透明度兜底保证不会卡片没了还留线头。
        if (item.group) {
            item.group.style.transition = 'opacity ' + duration + ' ' + easing;
            item.group.style.opacity = '0';
        }
        [item.pathBase, item.path].forEach(p => {
            if (!p) return;
            let len = 0;
            try { len = p.getTotalLength ? p.getTotalLength() : 0; } catch (e) { len = 0; }
            if (!len || !Number.isFinite(len)) return;
            p.style.transition = 'stroke-dashoffset ' + duration + ' ' + easing;
            p.style.strokeDasharray = len + 'px';
            p.style.strokeDashoffset = len + 'px';
        });
        if (item.dot) {
            item.dot.style.transition = 'opacity ' + duration + ' ' + easing;
            item.dot.style.opacity = '0';
        }
    });
    window.setTimeout(() => {
        if (!isCurrentToken()) return;   // 期间已经开了新的一组，别误清
        if (hasNewItems()) return;     // 双保险：层里已经有新内容，绝不碰
        if (els.layer) els.layer.innerHTML = '';
        if (els.svg) els.svg.innerHTML = '';
    }, PROVINCE_CARD_EXIT_MS + 40);
}
