/**
 * 封面照片：预拉封面图、CORS 探测、带缓存的图片加载，以及加载完后重绘封面。
 */

import { state } from './state.js';
import { api, clearTimer, setTimer } from './utils.js';

// 各本书封面用的那张照片先拉下来：省份信息页上的照片是异步解码的，
// 第一次翻开书时往往还没到，那一页看起来就是"空的"。
// 书架一建好就可以开始，等用户点开书时通常已经在缓存里了。
export function preloadCoverPhotos() {
    var d = api();
    if (!d || !d.cityCardImageUrl || !d.canvasSafeImageUrl) return;
    (state.books || []).forEach(function (item) {
        if (!item.cover) return;
        var url = d.cityCardImageUrl(item.cover) || item.cover;
        if (url) loadImage(url).catch(function () { /* 慢图床失败就在翻页时再试 */ });
    });
}

// ---------------- 封面照片（异步） ----------------

var imageCache = new Map();      // url -> Promise<Image>

// 直连这一路把 http 图升级成 https：
//   - 站点是 https 时，http 图会被当成混合内容直接拦掉（等于永远加载失败）；
//   - 站点是 http 时也不亏：图床的 http 一律 301 到 https，直连等于白跑一趟重定向。
// 代理那一路不碰（服务端本来就会跟 301）。万一某个图床只支持 http，
// 直连会失败并自动回退代理，行为和改之前一致。
function httpsUpgrade(url) {
    if (url.indexOf('http://') !== 0) return url;
    return 'https://' + url.slice('http://'.length);
}

function hostOfUrl(url) {
    try {
        return new URL(url, location.href).host;
    } catch (e) {
        return '';
    }
}

// 图床开了 CORS 就直连：既走 CDN 边缘缓存、又不占用自己服务器的连接与带宽
// （同源代理是实时回源的，实测单张 1-3 秒，并发十几张就会在浏览器里排队挂起）。
// 但 CORS 没开时直连会把 canvas 画脏（WebGL 贴图上传直接失败），所以：
//   - 用 `crossOrigin='anonymous'` 强制走 CORS —— 没开 CORS 时是 load 失败而不是悄悄污染；
//   - 每个域名**只探一次**（结果缓存在内存里），免得每张图都在控制台刷一条 CORS 报错；
//   - 探到不支持就整站回退同源代理，行为和开 CORS 之前完全一致。
var corsProbe = new Map();          // host -> Promise<boolean>
var CORS_PROBE_TIMEOUT = 8000;

function hostSupportsCors(host, sampleUrl) {
    if (corsProbe.has(host)) return corsProbe.get(host);
    var probe = new Promise(function (resolve) {
        var settled = false;
        var timer = 0;
        var finish = function (ok) {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(ok);
        };
        var image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = function () { finish(true); };
        image.onerror = function () { finish(false); };
        // 超时就当不支持：宁可走回退代理（15 秒），也别让直连把首屏吊住
        timer = setTimeout(function () { finish(false); }, CORS_PROBE_TIMEOUT);
        image.src = sampleUrl;
    });
    corsProbe.set(host, probe);
    return probe;
}

export function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    var d = api();
    var canProxy = !!(d && d.canvasSafeImageUrl);
    var proxy = canProxy ? d.canvasSafeImageUrl(url) : '';
    var direct = httpsUpgrade(url);
    var promise = new Promise(function (resolve, reject) {
        var fail = function () { reject(new Error('图片加载失败')); };
        // 同源图：直接加载，不需要 CORS，也不用多走一趟服务器
        var plain = function (src) {
            var image = new Image();
            image.onload = function () { resolve(image); };
            image.onerror = fail;
            image.src = src;
        };
        // 异域图：走插件同源代理（服务端回源，慢但在没有 CORS 时是唯一安全的路）
        var viaProxy = function () {
            if (!proxy) { fail(); return; }
            plain(proxy);
        };
        // 异域图：直连。crossOrigin 必须设 —— 图床没开 CORS 时它会 load 失败，
        // 而不是悄悄把 canvas 弄脏（脏画布做 WebGL 贴图会直接报错）
        var viaDirect = function (host) {
            var image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = function () { resolve(image); };
            image.onerror = function () {
                if (host) corsProbe.set(host, Promise.resolve(false));
                viaProxy();
            };
            image.src = direct;
        };
        // 拿不到代理能力（api 未就绪）：只能直连，且失败就失败，绝不加载会发生污染的图
        if (!canProxy) { viaDirect(''); return; }
        if (proxy === direct) { plain(url); return; }
        var host = hostOfUrl(direct);
        if (!host) { viaProxy(); return; }
        hostSupportsCors(host, direct).then(function (ok) {
            if (ok) viaDirect(host); else viaProxy();
        }).catch(viaProxy);
    });
    // 失败的不要缓存，下次切回来还能重试
    promise.catch(function () { imageCache.delete(url); });
    imageCache.set(url, promise);
    return promise;
}

export function attachCoverPhoto(rig) {
    // 快速翻书时不要每本都去拉封面：等同源代理那 260ms 内没人再翻，才取当前这本。
    // 同源代理对慢图床有 15 秒超时，少发无谓请求也顺带少几次 502。
    clearTimer('cover');
    setTimer('cover', function () { loadCoverPhoto(rig); }, 260);
}

function loadCoverPhoto(rig) {
    if (!rig || !rig.book || !rig.book.cover || !rig.coverTexture) return;
    if (rig.disposed) return;
    var d = api();
    if (!d) return;
    // 走城记那套缩略规则再进 canvas：原图动辄 1MB 以上，而封面贴图只有 384px 宽，
    // 用缩略既和城市卡片墙口径一致，也避免慢图把同源代理拖到超时（代理 15 秒就 502）。
    var thumb = d.cityCardImageUrl(rig.book.cover) || rig.book.cover;
    if (!thumb) return;
    loadImage(thumb).then(function (image) {
        if (rig.disposed) return;
        rig.book._coverImage = image;
        if (rig.coverTexture._repaint) rig.coverTexture._repaint();
    }).catch(function () {
        // 拿不到照片就停在布面 + 烫金书名，不影响翻书
        // 标记一下"这张封面不用等了"：否则「正在装订书架…」会白等满 2.5 秒
        rig.coverSettled = true;
    });
}
