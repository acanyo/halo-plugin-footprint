/**
 * 天地图瓦片用量统计。
 *
 * 天地图按 Key 计额度（个人 Key 每天约一万次），这里只做「看得见」：
 * 把当天发出的瓦片数记在 localStorage，状态栏直接显示。
 *
 * 注意：不要再在客户端做令牌桶限速/排队/透明瓦片兜底——那会让瓦片迟到或留空，
 * 转动地球时看起来就是「卡住」，观感远比省几次额度重要。要省量请走缓存方案。
 */

/**
 * 每攒够一批瓦片回调一次，主逻辑拿它去刷状态栏。
 *
 * 用注入而不是直接 import 主文件里的 updateStatusText：本模块是叶子，
 * 反过来依赖主文件会成环，也会让它没法单独使用。
 */
let onTileBatch = null;

export function setTileBatchHandler(fn) {
    onTileBatch = fn;
}

const TILE_USAGE_KEY = 'footprint-tile-usage';
let tdtTilesSinceStatus = 0;

function tdtCountTile() {
    // 攒够 25 张刷一次状态栏，别每来一张瓦片就重写一次 DOM
    tdtTilesSinceStatus += 1;
    if (tdtTilesSinceStatus >= 25) {
        tdtTilesSinceStatus = 0;
        try { onTileBatch && onTileBatch(); } catch (e) { /* 初始化未完成时忽略 */ }
    }
    try {
        const today = new Date().toISOString().slice(0, 10);
        const raw = JSON.parse(localStorage.getItem(TILE_USAGE_KEY) || '{}');
        const count = raw.date === today ? (Number(raw.count) || 0) : 0;
        localStorage.setItem(TILE_USAGE_KEY, JSON.stringify({ date: today, count: count + 1 }));
    } catch (e) {
        // 隐私模式下 localStorage 可能不可用，忽略
    }
}

export function tdtTodayUsage() {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const raw = JSON.parse(localStorage.getItem(TILE_USAGE_KEY) || '{}');
        return raw.date === today ? (Number(raw.count) || 0) : 0;
    } catch (e) {
        return 0;
    }
}

// 给天地图的 provider 包一层：只计数，不改请求节奏
export function countTdtProvider(provider) {
    const original = provider.requestImage.bind(provider);
    provider.requestImage = function (x, y, level, request) {
        tdtCountTile();
        return original(x, y, level, request);
    };
    return provider;
}
