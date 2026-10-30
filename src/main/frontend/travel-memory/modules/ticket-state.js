/**
 * 票根册的共享状态：票根列表、当前下标、视图模式（票夹 / 重走）、城市筛选。
 *
 * 从 ticket-gallery.js 拆出。这几项会被整体重新赋值，跨模块只能经由
 * 下面的取值 / 赋值函数读写，不能直接 import 绑定后再赋值。
 * 依赖注入由 setupTicketGallery 转发进来（footprints / cityKeyOf / footprintCfg）。
 */

import { compareTicketByTime } from './ticket-utils.js';
import { ticketCityFilterChip } from './ticket-dom.js';
import { ticketImageUrl } from './ticket-format.js';

let deps = null;

/**
 * @param {object} d 依赖集合（由 setupTicketGallery 从宿主注入里挑出本模块要用的键转发）
 * @param d.footprints                    () => Footprint[]
 * @param d.cityKeyOf                     (fp) => string
 * @param d.footprintCfg                  () => object
 */
export function setupTicketState(d) {
    deps = d;
}

let ticketItems = [];
let ticketIndex = 0;

let ticketViewMode = 'archive';   // archive | replay
let ticketCityFilter = '';        // 只看某座城市的票根（从城市卡片的票根徽章进来时设置）
let ticketCityFilterName = '';

export function ticketFeatureOn(key) {
    return !!(deps.footprintCfg() && deps.footprintCfg()[key] === true);
}

// 城市筛选：从城市卡片的票根徽章进来时，票根页只看这座城市
export function renderTicketCityFilter() {
    if (!ticketCityFilterChip) return;
    ticketCityFilterChip.hidden = !ticketCityFilter;
    if (!ticketCityFilter) return;
    ticketCityFilterChip.textContent = '只看 ' + ticketCityFilterName + ' ✕';
    ticketCityFilterChip.setAttribute('aria-label',
        '清除筛选，显示全部城市的票根（当前只看 ' + ticketCityFilterName + '）');
}

export function resetTicketCityFilter() {
    ticketCityFilter = '';
    ticketCityFilterName = '';
    renderTicketCityFilter();
}

// 票根排序/坐标校验的纯逻辑在 modules/ticket-utils.js；
// 这里只留一个薄包装，因为它要闭包引用主文件里的 ticketItems。
export function sortedTicketItems() {
    return ticketItems.slice().sort(compareTicketByTime);
}

export function ticketItemsFromFootprints() {
    return deps.footprints().filter(fp =>
        ticketImageUrl(fp.ticketImage) &&
        (!ticketCityFilter || deps.cityKeyOf(fp) === ticketCityFilter));
}

// ---------- 取值 / 赋值：这几项会被整体重新赋值，跨模块不能直接共享 import 绑定 ----------
export function getTicketItems() {
    return ticketItems;
}
export function setTicketItems(items) {
    ticketItems = items;
}
export function getTicketIndex() {
    return ticketIndex;
}
export function setTicketIndex(index) {
    ticketIndex = index;
}
export function getTicketViewMode() {
    return ticketViewMode;
}
export function setTicketViewModeState(mode) {
    ticketViewMode = mode;
}
export function getTicketCityFilter() {
    return ticketCityFilter;
}
export function setTicketCityFilter(key, name) {
    ticketCityFilter = key;
    ticketCityFilterName = name;
}
