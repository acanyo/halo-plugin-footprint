/**
 * 护照浮层：按时间排出全部票根的集章格子，打开 / 关闭时暂停与恢复重走放映。
 *
 * 从 ticket-gallery.js 拆出。记录读写与检票计时在 ticket-passport.js。
 */

import { compareTicketByTime } from './ticket-utils.js';
import {
    ticketPassport,
    ticketPassportBack,
    ticketPassportBtn,
    ticketPassportGrid,
    ticketPassportReset,
    ticketPassportStats
} from './ticket-dom.js';
import { ticketImageUrl } from './ticket-format.js';
import { getTicketIndex, getTicketItems, ticketFeatureOn } from './ticket-state.js';
import {
    clearTicketStampTimer,
    isTicketStamped,
    pruneTicketPassport,
    startTicketStampDwell,
    updateTicketPassportButton
} from './ticket-passport.js';
import { pauseTicketReplayForOverlay, resumeTicketReplayFromOverlay } from './ticket-replay.js';
import { ensureTicketCityFilterCleared } from './ticket-wallet.js';

let deps = null;

/**
 * @param {object} d 依赖集合（由 setupTicketGallery 从宿主注入里挑出本模块要用的键转发）
 * @param d.setOverlayHidden              (el, hidden) => void
 */
export function setupTicketPassportBook(d) {
    deps = d;
}

export function renderTicketPassport() {
    if (!ticketPassportGrid || !ticketPassportStats) return;
    if (pruneTicketPassport()) updateTicketPassportButton();
    const ordered = getTicketItems().slice().sort(compareTicketByTime);
    ticketPassportGrid.innerHTML = '';
    ordered.forEach(fp => {
        const stamped = isTicketStamped(fp);
        const cell = document.createElement('div');
        cell.className = 'ticket-passport-cell' + (stamped ? '' : ' is-missing');
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = ticketImageUrl(fp.ticketImage);
        img.alt = '';
        const status = document.createElement('span');
        status.className = 'ticket-passport-cell-status';
        status.textContent = stamped ? '已检票' : '未检票';
        const title = document.createElement('span');
        title.className = 'ticket-passport-cell-title';
        title.textContent = [fp.name || fp.ticketTitle, fp.city].filter(Boolean).join(' · ');
        cell.append(img, status, title);
        ticketPassportGrid.appendChild(cell);
    });
    const stamped = ordered.filter(fp => isTicketStamped(fp)).length;
    ticketPassportStats.textContent = stamped + ' / ' + ordered.length + ' 已集章' +
        (stamped === ordered.length && ordered.length ? ' · 全站抵达' : '');
    if (ticketPassportReset) {
        ticketPassportReset.hidden = ordered.length === 0;
    }
}

export function openTicketPassport() {
    if (!ticketFeatureOn('enableTicketPassport') || !getTicketItems().length || !ticketPassport) return;
    ensureTicketCityFilterCleared();
    clearTicketStampTimer();
    pauseTicketReplayForOverlay();
    renderTicketPassport();
    ticketPassport.classList.add('show');
    deps.setOverlayHidden(ticketPassport, false);
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
        ticketPassportBack) {
        ticketPassportBack.focus();
    }
}

export function closeTicketPassport(returnFocus = true) {
    if (!ticketPassport || !ticketPassport.classList.contains('show')) return;
    ticketPassport.classList.remove('show');
    deps.setOverlayHidden(ticketPassport, true);
    if (returnFocus && ticketPassportBtn && !ticketPassportBtn.hidden) {
        ticketPassportBtn.focus();
    }
    startTicketStampDwell(getTicketItems()[getTicketIndex()]);
    resumeTicketReplayFromOverlay();
}
