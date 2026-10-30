/**
 * three.js 懒加载：等页面里的 module 脚本把 window.THREE 挂上来，并在空闲时预热。
 */

// three 现在由页面里的 importmap + module 脚本装好并挂到 window.THREE，
// 这里只负责「等它出现」——不再自己插 <script> 去拉 UMD 版。
var THREE_WAIT_TRIES = 200;     // 200 × 50ms = 10 秒

var threePromise = null;

var preheated = false;

// ---------------- three.js 懒加载 ----------------

export function ensureThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threePromise) return threePromise;
    threePromise = new Promise(function (resolve, reject) {
        var tries = 0;
        var timer = setInterval(function () {
            if (window.THREE) {
                clearInterval(timer);
                resolve(window.THREE);
                return;
            }
            if (++tries > THREE_WAIT_TRIES) {
                clearInterval(timer);
                reject(new Error('three 模块加载超时'));
            }
        }, 50);
    });
    // 失败后允许下次重试，不然一次网络抖动就永久降级到 CSS 书架
    threePromise.catch(function () { threePromise = null; });
    return threePromise;
}

export function preheat() {
    if (preheated) return;
    preheated = true;
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(function () { ensureThree().catch(function () {}); }, { timeout: 3000 });
    } else {
        setTimeout(function () { ensureThree().catch(function () {}); }, 1200);
    }
}
