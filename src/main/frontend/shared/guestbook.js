/**
 * 留言板：整页一个 Halo 评论区，从右侧滑出一块玻璃面板。
 *
 * 面板与评论组件由模板里的 <halo:comment> 输出（评论组件插件负责渲染）；
 * 站点关了评论或没装评论组件时，模板不输出 #guestbook，这里什么都不做，入口按钮保持隐藏。
 * 入口是带 data-guestbook-open 的按钮：3D 底部坞的「留言板」、2D 控制栏的「留言板」。
 *
 * 3D 地球与 2D 地图两个脚本的入口都会调 initGuestbook，只有第一次生效。
 */

let initialized = false;
let lastTrigger = null;

const root = () => document.getElementById('guestbook');
const isOpen = () => root()?.classList.contains('is-open');

export function openGuestbook(trigger) {
    const el = root();
    if (!el || isOpen()) return;
    lastTrigger = trigger || document.activeElement;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    // 先去掉 hidden 再加类，过渡才有起点
    requestAnimationFrame(() => {
        el.classList.add('is-open');
        el.querySelector('.guestbook-close')?.focus({ preventScroll: true });
    });
    document.body.classList.add('guestbook-open');
}

export function closeGuestbook() {
    const el = root();
    if (!el || !isOpen()) return;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('guestbook-open');
    const done = () => { if (!isOpen()) el.hidden = true; };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else el.addEventListener('transitionend', done, { once: true });
    if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({ preventScroll: true });
    lastTrigger = null;
}

export function initGuestbook() {
    if (initialized) return;
    initialized = true;
    const el = root();
    if (!el) return;

    document.querySelectorAll('[data-guestbook-open]').forEach((btn) => {
        btn.hidden = false;
        btn.addEventListener('click', () => openGuestbook(btn));
        // 2D 的留言板入口是 div[role=button]，回车 / 空格也要能打开
        btn.addEventListener('keydown', (e) => {
            if (btn.tagName !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                openGuestbook(btn);
            }
        });
    });
    el.querySelectorAll('[data-guestbook-close]').forEach((btn) => btn.addEventListener('click', closeGuestbook));
    // 捕获阶段拦 Esc：地球页自己也监听 Esc（逐级收起卡片），留言板开着时先只关留言板
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) {
            e.stopPropagation();
            closeGuestbook();
        }
    }, true);
}
