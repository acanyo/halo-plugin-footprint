/**
 * 省份城市卡片的拖拽与点击：拖过的卡片锁定位置不再参与自动排版；
 * 单击延迟 180ms 判定（给双击留窗口），双击打开单城市卡。
 *
 * 从 province-cards.js 拆出。拖拽中的状态与单击定时器归本模块，
 * 卡片组主流程通过 isProvinceCardDragging / resetProvinceCardDrag / cancelProvinceCardClick 读写。
 */

import { clampNumber } from './geometry.js';
import { PROVINCE_CARD_WIDTH, PROVINCE_CARD_HEIGHT, applyProvinceCardBox } from './province-card-dom.js';

let provinceDragState = null;
let provinceCardClickTimer = null;  // 区分单击（进相册）与双击（打开单城市卡）

/** 是否正在拖某张卡片（拖拽中只刷新连线，不重排）。 */
export function isProvinceCardDragging() {
    return !!provinceDragState;
}

/** 收起卡片组时丢掉拖拽状态。 */
export function resetProvinceCardDrag() {
    provinceDragState = null;
}

/** 收起卡片组时取消还没落地的单 / 双击判定。 */
export function cancelProvinceCardClick() {
    if (provinceCardClickTimer) {
        clearTimeout(provinceCardClickTimer);
        provinceCardClickTimer = null;
    }
}

function applyProvinceDragPosition(item, clientX, clientY, grabX, grabY) {
    const w = item.w || PROVINCE_CARD_WIDTH;
    const h = item.h || PROVINCE_CARD_HEIGHT;
    item.x = clampNumber(clientX - grabX, 8, Math.max(8, window.innerWidth - w - 8));
    item.y = clampNumber(clientY - grabY, 8, Math.max(8, window.innerHeight - h - 8));
    applyProvinceCardBox(item);
}

/**
 * 给一张卡片接上拖拽、单击 / 双击与键盘激活。
 * @param item      卡片项（拖动时直接改 item.x / item.y / item.locked）
 * @param handlers  onMove()：拖动中刷新连线；onOpenAlbum(ci)：单击 / Enter；onOpenCityCard(ci)：双击
 */
export function attachProvinceCardDrag(item, handlers) {
    const el = item.el;
    el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const rect = el.getBoundingClientRect();
        provinceDragState = {
            item: item,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            grabX: e.clientX - rect.left,
            grabY: e.clientY - rect.top,
            moved: false
        };
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略：拿不到指针捕获也能拖 */ }
        e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
        const state = provinceDragState;
        if (!state || state.item !== item || state.pointerId !== e.pointerId) return;
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) < 4) return;   // 4px 以内算点击，不算拖拽
        state.moved = true;
        item.locked = true;   // 拖过的卡片不再被自动排版移动
        el.classList.add('is-dragging');
        applyProvinceDragPosition(item, e.clientX, e.clientY, state.grabX, state.grabY);
        handlers.onMove();
        e.preventDefault();
    });
    const finish = (e) => {
        const state = provinceDragState;
        if (!state || state.item !== item) return;
        provinceDragState = null;
        el.classList.remove('is-dragging');
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放或从未捕获 */ }
        // 单击延迟 180ms 再执行：给"双击打开单城市卡"留出判定窗口
        if (!state.moved) {
            if (provinceCardClickTimer) clearTimeout(provinceCardClickTimer);
            provinceCardClickTimer = window.setTimeout(() => {
                provinceCardClickTimer = null;
                handlers.onOpenAlbum(item.ci);
            }, 180);
        }
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    // 双击 = 打开单城市卡（大玻璃卡）：形成「小卡 → 大卡 → 相册」的层次
    el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (provinceCardClickTimer) {
            clearTimeout(provinceCardClickTimer);
            provinceCardClickTimer = null;
        }
        handlers.onOpenCityCard(item.ci);
    });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault();
        handlers.onOpenAlbum(item.ci);
    });
}
