/**
 * 未来足迹状态：前台列表、2D 地图、3D 地球和详情卡共用同一套文案与顺序。
 *
 * 状态是旅行计划的推进过程。未知或缺失值始终按「心愿」处理，避免旧数据在
 * 地图上变成没有标签的空状态。
 */

export const DEFAULT_WISH_STATUS = 'wish';

export const WISH_STATUS_ORDER = Object.freeze([
    'wish',
    'planning',
    'booked',
    'visited'
]);

export const WISH_MAP_STATUS_ORDER = Object.freeze([
    'wish',
    'planning',
    'booked'
]);

export const WISH_STATUS_LABELS = Object.freeze({
    wish: '心愿',
    planning: '计划中',
    booked: '已订票',
    visited: '已实现'
});

/** 把未知状态收敛到心愿，保证所有界面都有可渲染的状态。 */
export function wishStatusKey(value) {
    const key = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(WISH_STATUS_LABELS, key)
        ? key
        : DEFAULT_WISH_STATUS;
}

export function wishStatusLabel(value) {
    return WISH_STATUS_LABELS[wishStatusKey(value)];
}

/** 只有尚未实现的状态会进入「未来足迹」地图图层。 */
export function isMapWishStatus(value) {
    return WISH_MAP_STATUS_ORDER.includes(wishStatusKey(value));
}
