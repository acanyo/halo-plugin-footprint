/**
 * 省份城市卡片的入场 / 退场动画：错峰规划、卡片从标记飞出、连线铺开、起点脉冲、收起回缩。
 *
 * 从 province-cards.js 拆出。卡片组状态仍归 province-cards.js，
 * 这里要用到的状态都以参数或取值函数传入；只有起点脉冲的 rAF 句柄是本模块自己的。
 */

import { snapDevicePx } from './geometry.js';

// ---- 展开动画：线到、卡到 ----
const PROVINCE_LINE_GROW_MS = 240;    // 线从标记铺到卡片的时长
const PROVINCE_CARD_FLY_MS = 240;     // 卡片从标记飞到落点的时长（与 CSS .prop-city-card.is-flying 一致）
const PROVINCE_CARD_LEAD_MS = 120;    // 卡片比线晚出发一点：线先探出去，卡片再沿线滑出
const PROVINCE_STAGGER_STEP_MS = 40;  // 相邻两张的错峰步长
const PROVINCE_STAGGER_MAX_MS = 600;  // 错峰总时长上限（卡片多时自动压缩步长）
const PROVINCE_PULSE_MS = 320;        // 起点"引爆"脉冲时长（仅「全部城市」）
let provincePulseRaf = null;        // 起点脉冲的 rAF 句柄

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
        item.cardDelay = item.staggerDelay + PROVINCE_CARD_LEAD_MS;
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

// 卡片入场：从自己那个城市标记的位置（略缩小）滑到布局算出的落点。
// 先把"起点态"钉在样式上再切终点态，否则浏览器会把两帧合并、变成原地淡入。
export function startProvinceCardsFly(items, layer, reduceMotion) {
    const flying = [];
    items.forEach(item => {
        const el = item.el;
        if (!el) return;
        el.classList.remove('is-flying');
        el.style.transitionDelay = '';
        if (reduceMotion() || !item.anchor) {
            // 减弱动效、或卡片对应的标记在背面：直接落到最终位置（背面那批由 is-hidden 负责隐藏）
            el.style.transform = 'translate3d(' + Math.round(item.x) + 'px,' + Math.round(item.y) + 'px,0)';
            el.style.opacity = '';
            el.classList.add('show');
            return;
        }
        el.style.transition = 'none';
        el.style.transform = 'translate3d(' + snapDevicePx(item.anchor.x) + 'px,' +
            snapDevicePx(item.anchor.y) + 'px,0) scale(0.82)';
        el.style.opacity = '0';
        flying.push(item);
    });
    if (!flying.length) return;
    void (layer && layer.offsetWidth);   // 落一次样式计算，把起点态钉住
    flying.forEach(item => {
        const el = item.el;
        el.classList.add('is-flying');
        el.style.transition = '';
        el.style.transitionDelay = Math.round(item.cardDelay || 0) + 'ms';
        el.style.transform = 'translate3d(' + snapDevicePx(item.x) + 'px,' +
            snapDevicePx(item.y) + 'px,0)';
        el.style.opacity = '';
        el.classList.add('show');
    });
    // 飞完就摘掉过渡与延迟：之后相机转动带来的重排、拖拽都要立刻跟手
    let totalMs = 0;
    flying.forEach(item => {
        totalMs = Math.max(totalMs, (item.cardDelay || 0) + PROVINCE_CARD_FLY_MS);
    });
    window.setTimeout(() => {
        flying.forEach(item => {
            if (!item.el) return;
            item.el.style.transitionDelay = '';
            item.el.classList.remove('is-flying');
        });
    }, totalMs + 80);
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

// “拉出来”的生长动画：线沿自身长度铺开；动画结束后清掉 dash，
// 否则线随地球移动、长度变化时会出现断口。
export function startProvinceLinesGrow(items, reduceMotion) {
    if (reduceMotion()) return;
    items.forEach(item => {
        // 深色底描边必须和亮线一起铺开：只给亮线做 dash 动画的话，
        // 底层会整条先出现（就是"先看到一条纯黑的线"），亮线再慢慢盖上去。
        const paths = [item.pathBase, item.path].filter(Boolean);
        const path = item.path;
        if (!path || typeof path.getTotalLength !== 'function' || !paths.length) return;
        let length = 0;
        try { length = path.getTotalLength(); } catch (e) { length = 0; }
        if (!length || !Number.isFinite(length)) return;
        const delay = Math.round(item.lineDelay || 0);
        paths.forEach(p => {
            p.style.transition = 'none';
            p.style.strokeDasharray = length + 'px';
            p.style.strokeDashoffset = length + 'px';
        });
        requestAnimationFrame(() => {
            paths.forEach(p => {
                p.style.transition = 'stroke-dashoffset ' + (PROVINCE_LINE_GROW_MS / 1000) +
                    's var(--fp-ease) ' + delay + 'ms';
                p.style.strokeDashoffset = '0px';
            });
            window.setTimeout(() => {
                paths.forEach(p => {
                    p.style.transition = '';
                    p.style.strokeDasharray = '';
                    p.style.strokeDashoffset = '';
                });
            }, PROVINCE_LINE_GROW_MS + delay + 120);
        });
    });
}

// 收起动画：卡片缩回自己那个标记并淡出，连线向标记端收回（dash 反着走一遍）。
// 用世代号做守卫 —— 动画没结束就点了别的省时，不能再把新的一组清掉。
export function animateProvinceCardsExit(items, els, isCurrentToken, hasNewItems) {
    items.forEach(item => {
        const el = item.el;
        if (el) {
            el.style.pointerEvents = 'none';   // 退场途中不再响应点击
            el.style.transition = 'transform 200ms var(--fp-ease), opacity 200ms var(--fp-ease)';
            el.style.transitionDelay = '0ms';
            const backX = item.anchor ? item.anchor.x : item.x;
            const backY = item.anchor ? item.anchor.y : item.y;
            el.style.transform = 'translate3d(' + snapDevicePx(backX) + 'px,' +
                snapDevicePx(backY) + 'px,0) scale(0.88)';
            el.style.opacity = '0';
        }
        [item.pathBase, item.path].forEach(p => {
            if (!p) return;
            let len = 0;
            try { len = p.getTotalLength ? p.getTotalLength() : 0; } catch (e) { len = 0; }
            if (!len || !Number.isFinite(len)) return;
            p.style.transition = 'stroke-dashoffset 200ms var(--fp-ease)';
            p.style.strokeDasharray = len + 'px';
            p.style.strokeDashoffset = len + 'px';
        });
        if (item.dot) {
            item.dot.style.transition = 'opacity 200ms var(--fp-ease)';
            item.dot.style.opacity = '0';
        }
    });
    window.setTimeout(() => {
        if (!isCurrentToken()) return;   // 期间已经开了新的一组，别误清
        if (hasNewItems()) return;     // 双保险：层里已经有新内容，绝不碰
        if (els.layer) els.layer.innerHTML = '';
        if (els.svg) els.svg.innerHTML = '';
    }, 320);
}
