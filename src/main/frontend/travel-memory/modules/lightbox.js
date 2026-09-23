/**
 * 图片灯箱：点足迹图片后的全屏查看器。
 *
 * 含骨架屏、失败重试、左右切换、相邻图预加载、触屏滑动、焦点归还。
 *
 * DOM 引用在模块求值时就取好。这比原先的位置提前了一点（ESM 的 import 先于
 * 主文件 body 执行），但仍然安全：travel-memory.js 是 defer 加载的，
 * 执行时 DOM 已经解析完。末尾那几个 addEventListener 同理——
 * 它们只往已存在的节点上挂监听，早挂晚挂没有区别。
 *
 * 三个外部依赖（取图、格式化日期、遮罩无障碍属性）走注入而不是反向 import 主文件，
 * 否则会成环，这个模块也就没法单独使用了。
 */

/** 由主文件在启动时注入，见 setLightboxDeps */
let deps = null;

/**
 * @param d.cityWallImages     (fp) => [{ url, caption }]
 * @param d.formatLightboxDate (value) => string
 * @param d.setOverlayHidden   (el, hidden) => void
 */
export function setLightboxDeps(d) {
    deps = d;
}

export const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxCount = document.getElementById('lightboxCount');
const lightboxCaption = document.getElementById('lightboxCaption');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');
const lightboxStage = document.getElementById('lightboxStage');
const lightboxSkeleton = document.getElementById('lightboxSkeleton');
const lightboxError = document.getElementById('lightboxError');
const lightboxRetry = document.getElementById('lightboxRetry');
let lightboxFp = null;
let lightboxIndex = 0;
let lightboxTriggerBtn = null;

function lightboxImages() {
    return lightboxFp ? deps.cityWallImages(lightboxFp) : [];
}

function loadLightboxImage(url) {
    lightboxSkeleton.hidden = false;
    lightboxError.hidden = true;
    lightboxImg.hidden = false;
    lightboxImg.onload = () => { lightboxSkeleton.hidden = true; };
    lightboxImg.onerror = () => {
        lightboxSkeleton.hidden = true;
        lightboxImg.hidden = true;
        lightboxError.hidden = false;
    };
    lightboxImg.src = url;
}

function preloadLightboxNeighbors() {
    const imgs = lightboxImages();
    [lightboxIndex - 1, lightboxIndex + 1].forEach(i => {
        if (i >= 0 && i < imgs.length) {
            const pre = new Image();
            pre.src = imgs[i].url;
        }
    });
}

function renderLightboxImage() {
    const imgs = lightboxImages();
    const img = imgs[lightboxIndex];
    const single = imgs.length <= 1;
    lightboxPrev.hidden = single;
    lightboxNext.hidden = single;
    lightboxCount.textContent = (lightboxIndex + 1) + ' / ' + imgs.length;
    lightboxCaption.textContent = img.caption ||
        (lightboxFp.name + (lightboxFp.createTime ? ' · ' + deps.formatLightboxDate(lightboxFp.createTime) : ''));
    loadLightboxImage(img.url);
    preloadLightboxNeighbors();
}

export function openLightbox(fp, index, triggerBtn) {
    lightboxFp = fp;
    lightboxIndex = index;
    lightboxTriggerBtn = triggerBtn || null;
    lightbox.classList.add('show');
    deps.setOverlayHidden(lightbox, false);
    document.getElementById('lightboxClose').focus();
    renderLightboxImage();
}

export function closeLightbox(returnFocus = true) {
    lightbox.classList.remove('show');
    deps.setOverlayHidden(lightbox, true);
    lightboxImg.onload = null;
    lightboxImg.onerror = null;
    lightboxImg.removeAttribute('src');
    if (returnFocus && lightboxTriggerBtn) {
        lightboxTriggerBtn.focus();   // 焦点还给触发它的图片按钮
    }
    lightboxTriggerBtn = null;
    lightboxFp = null;
}

export function switchLightbox(delta) {
    const imgs = lightboxImages();
    if (imgs.length < 2) return;
    lightboxIndex = (lightboxIndex + delta + imgs.length) % imgs.length;
    renderLightboxImage();
}

lightboxPrev.addEventListener('click', () => switchLightbox(-1));
lightboxNext.addEventListener('click', () => switchLightbox(1));
document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
lightboxRetry.addEventListener('click', () => {
    const imgs = lightboxImages();
    if (imgs[lightboxIndex]) loadLightboxImage(imgs[lightboxIndex].url);
});
// 点击灯箱背景（图片之外）关闭
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxStage) closeLightbox();
});
// 触屏左右滑动切换
let lightboxTouchX = null;
lightbox.addEventListener('touchstart', (e) => {
    lightboxTouchX = e.touches[0].clientX;
}, { passive: true });
lightbox.addEventListener('touchend', (e) => {
    if (lightboxTouchX === null) return;
    const dx = e.changedTouches[0].clientX - lightboxTouchX;
    if (Math.abs(dx) > 40) switchLightbox(dx < 0 ? 1 : -1);
    lightboxTouchX = null;
}, { passive: true });
