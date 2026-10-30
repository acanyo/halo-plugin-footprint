/**
 * 通用防抖。
 *
 * 时间线 resize、图片墙 resize、抛物线 mouseleave 清理、地图移动状态都共用这一份。
 * 注意 map-app.js 的 initializeMapFeatures 里另有一个同名局部简化版（不支持立即执行），
 * 那是原代码就有的，保持原样不合并。
 */

// 优化防抖函数，添加立即执行选项
// 优化后的防抖函数（支持立即执行）
export const debounce = (func, wait = 100, immediate = false) => {
    let timeout;
    return function (...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func.apply(this, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(this, args);
    };
};
