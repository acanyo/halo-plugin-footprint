/**
 * 图片墙点击后的大图预览（灯箱）。
 *
 * 原先是 addFootprintMarkers 内部的两个闭包，但不引用任何闭包变量，
 * 原样提到模块顶层，行为不变。
 */

import { escapeHtml } from './format.js';
import { getPhotoWallImageUrl, normalizeGalleryImages } from './photo-wall.js';

export const closePhotoLightbox = () => {
    const lightbox = document.querySelector('.photo-lightbox');
    if (lightbox) lightbox.remove();
};

export const openPhotoLightbox = (images, index, name) => {
    const safeImages = normalizeGalleryImages(images);
    if (!safeImages.length) return;
    const currentIndex = Math.max(0, Math.min(safeImages.length - 1, index));
    closePhotoLightbox();
    const lightbox = document.createElement('div');
    lightbox.className = 'photo-lightbox';
    lightbox.innerHTML = `
        <div class="photo-lightbox-backdrop" data-lightbox-action="close"></div>
        <button class="photo-lightbox-close" type="button" data-lightbox-action="close" aria-label="关闭预览">×</button>
        <button class="photo-lightbox-arrow photo-lightbox-prev" type="button" data-lightbox-action="previous" aria-label="上一张">←</button>
        <div class="photo-lightbox-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(name || '图片预览')}">
            <span class="photo-lightbox-loader" role="status" aria-label="图片加载中"></span>
            <img class="photo-lightbox-image" src="${escapeHtml(getPhotoWallImageUrl(safeImages[currentIndex], 1200))}" alt="${escapeHtml(name || '足迹图片')}">
            <div class="photo-lightbox-caption">${escapeHtml(name || '足迹')} · ${currentIndex + 1} / ${safeImages.length}</div>
        </div>
        <button class="photo-lightbox-arrow photo-lightbox-next" type="button" data-lightbox-action="next" aria-label="下一张">→</button>
    `;
    lightbox.dataset.index = String(currentIndex);
    lightbox.dataset.name = name || '足迹图片';
    lightbox.dataset.images = JSON.stringify(safeImages);
    document.body.appendChild(lightbox);

    const imageElement = lightbox.querySelector('.photo-lightbox-image');
    const setImageLoading = (loading) => {
        lightbox.classList.toggle('is-loading', loading);
        lightbox.classList.remove('is-error');
    };
    const loadLightboxImage = (index) => {
        if (!(imageElement instanceof HTMLImageElement)) return;
        setImageLoading(true);
        imageElement.src = getPhotoWallImageUrl(safeImages[index], 1200);
    };
    if (imageElement instanceof HTMLImageElement) {
        imageElement.addEventListener('load', () => setImageLoading(false));
        imageElement.addEventListener('error', () => {
            lightbox.classList.remove('is-loading');
            lightbox.classList.add('is-error');
        });
        if (imageElement.complete && imageElement.naturalWidth > 0) {
            setImageLoading(false);
        } else {
            setImageLoading(true);
        }
    }

    let handleKeydown;
    let wheelUnlockTimer = null;
    const changeLightboxImage = (action) => {
        const imagesForLightbox = JSON.parse(lightbox.dataset.images || '[]');
        if (!imagesForLightbox.length) return;
        let nextIndex = Number(lightbox.dataset.index || 0);
        nextIndex += action === 'next' ? 1 : -1;
        if (nextIndex < 0) nextIndex = imagesForLightbox.length - 1;
        if (nextIndex >= imagesForLightbox.length) nextIndex = 0;
        lightbox.dataset.index = String(nextIndex);
        const caption = lightbox.querySelector('.photo-lightbox-caption');
        loadLightboxImage(nextIndex);
        if (caption) caption.textContent = `${lightbox.dataset.name} · ${nextIndex + 1} / ${imagesForLightbox.length}`;
    };
    const close = () => {
        lightbox.remove();
        if (wheelUnlockTimer) window.clearTimeout(wheelUnlockTimer);
        if (handleKeydown) document.removeEventListener('keydown', handleKeydown);
    };
    lightbox.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const action = target.closest('[data-lightbox-action]')?.getAttribute('data-lightbox-action');
        if (!action) return;
        if (action === 'close') {
            close();
            return;
        }
        changeLightboxImage(action);
    });

    let lightboxTouchStartX = null;
    lightbox.addEventListener('touchstart', (event) => {
        if (event.touches.length === 1) {
            lightboxTouchStartX = event.touches[0].clientX;
        }
    }, {passive: true});
    lightbox.addEventListener('touchend', (event) => {
        if (lightboxTouchStartX === null || event.changedTouches.length !== 1) return;
        const deltaX = event.changedTouches[0].clientX - lightboxTouchStartX;
        if (Math.abs(deltaX) > 40) {
            changeLightboxImage(deltaX > 0 ? 'previous' : 'next');
        }
        lightboxTouchStartX = null;
    }, {passive: true});

    lightbox.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
        event.preventDefault();
        if (wheelUnlockTimer) return;
        changeLightboxImage(event.deltaY > 0 ? 'next' : 'previous');
        wheelUnlockTimer = window.setTimeout(() => {
            wheelUnlockTimer = null;
        }, 180);
    }, {passive: false});

    handleKeydown = (event) => {
        if (!document.body.contains(lightbox)) {
            document.removeEventListener('keydown', handleKeydown);
            return;
        }
        if (event.key === 'Escape') close();
        if (event.key === 'ArrowLeft') changeLightboxImage('previous');
        if (event.key === 'ArrowRight') changeLightboxImage('next');
    };
    document.addEventListener('keydown', handleKeydown);
};
