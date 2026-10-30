/**
 * 命运抽票（阶段 B）：洗牌动画后随机翻出一张票根，并给出「下一站」建议。
 *
 * 从 ticket-gallery.js 拆出。「查看这张票」回到票夹定位由 ticket-gallery.js 处理，
 * 这里只通过 getTicketOracleCandidate 交出抽中的那一张。
 */

import {
    ticketOracle,
    ticketOracleAgain,
    ticketOracleBack,
    ticketOracleBtn,
    ticketOracleCard,
    ticketOracleInspiration,
    ticketOracleStats,
    ticketOracleView
} from './ticket-dom.js';
import { ticketImageUrl, ticketMeta } from './ticket-format.js';
import { getTicketIndex, getTicketItems, ticketFeatureOn } from './ticket-state.js';
import { clearTicketStampTimer, startTicketStampDwell } from './ticket-passport.js';
import { pauseTicketReplayForOverlay, resumeTicketReplayFromOverlay } from './ticket-replay.js';
import { ensureTicketCityFilterCleared } from './ticket-wallet.js';

let deps = null;

/**
 * @param {object} d 依赖集合（由 setupTicketGallery 从宿主注入里挑出本模块要用的键转发）
 * @param d.footprints                    () => Footprint[]
 * @param d.cityKeyOf                     (fp) => string
 * @param d.setOverlayHidden              (el, hidden) => void
 */
export function setupTicketOracle(d) {
    deps = d;
}

let ticketOracleTimer = null;
let ticketOracleCandidate = null;
let ticketOracleLastIndex = -1;

// ================= 命运抽票（阶段 B） =================
function ticketOracleBackFace() {
    if (!ticketOracleCard) return;
    ticketOracleCard.classList.remove('is-back');
    void ticketOracleCard.offsetWidth;
    ticketOracleCard.classList.add('is-back');
    ticketOracleCard.innerHTML = '';
    if (ticketOracleStats) {
        ticketOracleStats.textContent = '正在翻找一张票…';
    }
    if (ticketOracleInspiration) ticketOracleInspiration.textContent = '';
    if (ticketOracleView) ticketOracleView.disabled = true;
}

function ticketOracleShowCandidate(fp) {
    if (!ticketOracleCard || !fp) return;
    ticketOracleCard.classList.remove('is-back', 'is-shuffling');
    ticketOracleCard.innerHTML = '';
    const img = document.createElement('img');
    img.alt = fp.ticketTitle || fp.name || '票根';
    img.referrerPolicy = 'no-referrer';
    img.src = ticketImageUrl(fp.ticketImage);
    img.onerror = () => {
        ticketOracleCard.innerHTML = '<span style="padding:20px;color:#6e5945;">这张票根暂时打不开<br>但它仍是一段旅程</span>';
    };
    ticketOracleCard.appendChild(img);
    const meta = ticketMeta(fp);
    if (ticketOracleStats) {
        ticketOracleStats.textContent = (fp.city || meta.route || '未知城市') +
            (meta.date ? ' · ' + meta.date : '') +
            (fp.name ? ' · ' + fp.name : '');
    }
    if (ticketOracleInspiration) {
        ticketOracleInspiration.textContent = nextTicketStopSuggestion();
    }
    if (ticketOracleView) ticketOracleView.disabled = false;
}

function nextTicketStopSuggestion() {
    // 与城市聚合同一套键：adcode 优先，避免同一座城市因为写法不同被当成"没去过"
    const ticketCities = new Set(getTicketItems().map(fp => deps.cityKeyOf(fp)).filter(Boolean));
    const candidates = [];
    deps.footprints().forEach(fp => {
        if (ticketImageUrl(fp.ticketImage) || !fp.city) return;
        const key = deps.cityKeyOf(fp);
        if (!key || ticketCities.has(key) || candidates.includes(fp.city)) return;
        candidates.push(fp.city);
    });
    if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        return '下一站，或许可以去「' + pick + '」看看。';
    }
    const fallbacks = [
        '把去过的城市再走一遍也不错，下一张票根正在等你。',
        '旅行的下一站不在地图上，而在你的心里。',
        '所有出发都是回家，只是路线不同。'
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

export function ticketOracleShuffle() {
    clearTimeout(ticketOracleTimer);
    ticketOracleCandidate = null;
    ticketOracleBackFace();
    if (ticketOracleCard) ticketOracleCard.classList.add('is-shuffling');
    if (ticketOracleAgain) ticketOracleAgain.disabled = true;
    let steps = 0;
    const tick = () => {
        steps++;
        if (steps >= 7) {
            if (ticketOracleCard) ticketOracleCard.classList.remove('is-shuffling');
            const pickable = getTicketItems().length > 1;
            let idx = ticketOracleLastIndex;
            while (pickable && idx === ticketOracleLastIndex) {
                idx = Math.floor(Math.random() * getTicketItems().length);
            }
            // 只有一张票根时不会进入上面的循环，idx 会停在 -1（对应 undefined），
            // 结果卡片一直停在背面、按钮永远不可用；这里兜底到第一张。
            if (idx < 0 || !getTicketItems()[idx]) idx = 0;
            ticketOracleLastIndex = idx;
            ticketOracleCandidate = getTicketItems()[idx];
            ticketOracleShowCandidate(ticketOracleCandidate);
            if (ticketOracleAgain) ticketOracleAgain.disabled = false;
            return;
        }
        ticketOracleTimer = setTimeout(tick, 130);
    };
    ticketOracleTimer = setTimeout(tick, 130);
}

export function openTicketOracle() {
    if (!ticketFeatureOn('enableTicketOracle') || !getTicketItems().length || !ticketOracle) return;
    ensureTicketCityFilterCleared();
    clearTicketStampTimer();
    pauseTicketReplayForOverlay();
    ticketOracle.classList.add('show');
    deps.setOverlayHidden(ticketOracle, false);
    ticketOracleShuffle();
    if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
        ticketOracleBack) {
        ticketOracleBack.focus();
    }
}

export function closeTicketOracle(returnFocus = true) {
    if (!ticketOracle || !ticketOracle.classList.contains('show')) return;
    clearTimeout(ticketOracleTimer);
    ticketOracleTimer = null;
    ticketOracleCandidate = null;
    ticketOracle.classList.remove('show');
    deps.setOverlayHidden(ticketOracle, true);
    if (returnFocus && ticketOracleBtn && !ticketOracleBtn.hidden) {
        ticketOracleBtn.focus();
    }
    startTicketStampDwell(getTicketItems()[getTicketIndex()]);
    resumeTicketReplayFromOverlay();
}

// 抽中的那张票：主文件的「查看这张票」据此回到票夹定位
export function getTicketOracleCandidate() {
    return ticketOracleCandidate;
}
