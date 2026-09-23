/**
 * 城市卡片墙的图片空闲预热。
 *
 * 刷新后磁盘缓存里的图片仍要重新解码；滚动时再解码就会造成帧断。
 * 打开卡片墙后以低并发在后台把封面与轮播图全部解码，滚动时不再等待。
 *
 * 并发压到 2、上限 60 张都是刻意的：预热本身不能把主线程和网络占满，
 * 否则治好了滚动卡顿却拖慢了首屏。
 */

// 刷新后磁盘缓存里的图片仍要重新解码；滚动时再解码就会造成帧断。
// 打开卡片墙后以低并发在后台把封面与轮播图全部解码，滚动时不再等待。
const CITY_WALL_WARM_CONCURRENCY = 2;
const CITY_WALL_WARM_MAX_IMAGES = 60;   // 防止超大城市列表过度预热
const cityWallWarmQueue = [];
let cityWallWarmLoading = 0;
let cityWallWarmTimer = null;

function drainCityWallWarmQueue() {
    cityWallWarmTimer = null;
    while (cityWallWarmLoading < CITY_WALL_WARM_CONCURRENCY && cityWallWarmQueue.length) {
        const img = cityWallWarmQueue.shift();
        if (!img || !img.isConnected || img.getAttribute('src')) continue;
        cityWallWarmLoading++;
        const done = () => {
            cityWallWarmLoading = Math.max(0, cityWallWarmLoading - 1);
            if (!cityWallWarmTimer) {
                cityWallWarmTimer = setTimeout(drainCityWallWarmQueue, 0);
            }
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        img.src = img.dataset.src;
    }
}

export function stopCityWallWarmQueue() {
    if (cityWallWarmTimer) {
        clearTimeout(cityWallWarmTimer);
        cityWallWarmTimer = null;
    }
    cityWallWarmQueue.length = 0;
    cityWallWarmLoading = 0;
}

/**
 * @param grid 卡片墙的容器元素，由调用方传入。
 *   原先直接闭包引用主文件的 cityWallGrid，那样这个模块就绑死在特定页面结构上了。
 */
export function startCityWallWarmQueue(grid) {
    stopCityWallWarmQueue();
    const imgs = [...grid.querySelectorAll(
        'img.city-wall-card-cover, img.city-wall-card-preview')]
        .filter(img => img.dataset.src && !img.getAttribute('src'));
    if (!imgs.length || imgs.length > CITY_WALL_WARM_MAX_IMAGES) return;
    cityWallWarmQueue.push(...imgs);
    drainCityWallWarmQueue();
}
