/**
 * 护照集章的记录与检票逻辑，以及「时间有色」的季节氛围（阶段 A）。
 *
 * 从 ticket-gallery.js 拆出。集章记录存在 localStorage；护照浮层本身见 ticket-passport-book.js。
 */

import {
    ticketGallery,
    ticketPassportBtn,
    ticketPassportCount,
    ticketStampBadge
} from './ticket-dom.js';
import { ticketImageUrl, ticketMeta } from './ticket-format.js';
import {
    getTicketIndex,
    getTicketItems,
    getTicketViewMode,
    ticketFeatureOn
} from './ticket-state.js';

// 票根页创意功能：护照集章 + 时间有色（阶段 A）
const TICKET_PASSPORT_STORAGE_KEY = 'footprint-ticket-passport-v1';
const TICKET_STAMP_DWELL_MS = 1500;
let ticketPassportRecords = [];
let ticketStampTimer = null;
let ticketStampIndex = -1;

function ticketStampId(fp) {
    if (!fp) return '';
    const raw = fp.key ||
        ticketImageUrl(fp.ticketImage) ||
        [fp.name, fp.ticketNo, fp.ticketDate || fp.createTime].filter(Boolean).join('|');
    return String(raw || '').trim() || String(fp.name || '未知票根').trim();
}

export function loadTicketPassport() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TICKET_PASSPORT_STORAGE_KEY));
        ticketPassportRecords = Array.isArray(parsed) ? parsed.filter(r => r && r.id) : [];
    } catch (e) {
        ticketPassportRecords = [];
    }
}

// 打开护照时按当前票根列表清理失效记录：
// 既避免 localStorage 只增不减，也避免删掉再重建的票根（identifier 相同）直接带上旧章。
// 票根列表为空时不清理，防止数据还没加载完就误删整本护照。
export function pruneTicketPassport() {
    if (!getTicketItems().length || !ticketPassportRecords.length) return false;
    const valid = new Set(getTicketItems().map(ticketStampId).filter(Boolean));
    const kept = ticketPassportRecords.filter(record => valid.has(record.id));
    if (kept.length === ticketPassportRecords.length) return false;
    ticketPassportRecords = kept;
    persistTicketPassport();
    return true;
}

export function persistTicketPassport() {
    try {
        localStorage.setItem(TICKET_PASSPORT_STORAGE_KEY, JSON.stringify(ticketPassportRecords));
    } catch (e) {
        /* 隐私模式/存储满时静默失败，不影响票根浏览 */
    }
}

export function isTicketStamped(fp) {
    if (!fp) return false;
    const id = ticketStampId(fp);
    return ticketPassportRecords.some(record => record.id === id);
}

export function clearTicketStampTimer() {
    if (ticketStampTimer) {
        clearTimeout(ticketStampTimer);
        ticketStampTimer = null;
    }
    ticketStampIndex = -1;
}

function stampTicket(fp) {
    if (!fp || !ticketFeatureOn('enableTicketPassport') || isTicketStamped(fp)) return;
    ticketPassportRecords.push({
        id: ticketStampId(fp),
        stampedAt: new Date().toISOString()
    });
    persistTicketPassport();
    updateTicketPassportButton();
    updateTicketStampBadge(fp, true);
}

export function updateTicketPassportButton() {
    if (!ticketPassportBtn || !ticketPassportCount) return;
    const enabled = ticketFeatureOn('enableTicketPassport');
    ticketPassportBtn.hidden = !enabled || getTicketItems().length === 0;
    if (!enabled) return;
    const stamped = getTicketItems().filter(fp => isTicketStamped(fp)).length;
    ticketPassportCount.textContent = stamped + '/' + getTicketItems().length;
}

export function updateTicketStampBadge(fp, animate) {
    if (!ticketStampBadge) return;
    const stamped = ticketFeatureOn('enableTicketPassport') && isTicketStamped(fp);
    ticketStampBadge.hidden = !stamped;
    if (!stamped) return;
    const meta = ticketMeta(fp);
    ticketStampBadge.textContent = ['已检票', fp.city || meta.route, meta.date].filter(Boolean).join('　');
    if (animate) {
        ticketStampBadge.classList.remove('is-stale');
        void ticketStampBadge.offsetWidth;
    } else {
        ticketStampBadge.classList.add('is-stale');
    }
}

export function startTicketStampDwell(fp) {
    clearTicketStampTimer();
    if (!ticketFeatureOn('enableTicketPassport') || getTicketViewMode() !== 'archive') return;
    if (isTicketStamped(fp)) return;
    ticketStampIndex = getTicketIndex();
    ticketStampTimer = setTimeout(() => {
        ticketStampTimer = null;
        if (ticketGallery.classList.contains('show') &&
            getTicketViewMode() === 'archive' &&
            getTicketIndex() === ticketStampIndex &&
            getTicketItems()[getTicketIndex()] === fp &&
            !isTicketStamped(fp)) {
            stampTicket(fp);
        }
    }, TICKET_STAMP_DWELL_MS);
}

// 时间有色：按票根日期月份决定页面氛围（阶段 A）
function ticketSeasonKey(fp) {
    const raw = String((fp && (fp.ticketDate || fp.createTime)) || '');
    const match = /^(\d{4})[-/.](\d{1,2})/.exec(raw);
    if (!match) return '';
    const month = Number(match[2]);
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
}

export function applyTicketSeason(fp) {
    if (!ticketGallery) return;
    // 时间有色只改文字强调色（CSS 变量 --season-accent），不碰背景、票根图与地球
    const season = fp ? ticketSeasonKey(fp) : '';
    if (season && ticketFeatureOn('enableTicketSeasonLight')) {
        ticketGallery.dataset.season = season;
    } else {
        ticketGallery.removeAttribute('data-season');
    }
}

export function resetTicketSeason() {
    if (ticketGallery) {
        ticketGallery.removeAttribute('data-season');
    }
}

// 清除集章记录（主文件的「清除记录」按钮）
export function setTicketPassportRecords(records) {
    ticketPassportRecords = records;
}
