/**
 * 2D 足迹图片墙。
 *
 * 上游 2.0.0 把点开足迹后的界面统一成了信息卡。这里恢复“带图片的足迹优先
 * 打开图片墙”的旧行为，并继续由后台控制开关、样式和单页数量。
 */

import { isMobile } from './env.js';
import { FOOTPRINT_IMAGE_PLACEHOLDER, processFootprintImageUrl } from './footprint-data.js';
import { escapeHtml, formatDateToYMD } from './format.js';

const PHOTO_WALL_STYLES = ['original', 'gallery', 'journal', 'focus'];
const PHOTO_WALL_ALIASES = { a: 'gallery', b: 'original', c: 'journal', d: 'focus' };
const PHOTO_WALL_CLOSE_ZOOM = 10;

const PHOTO_WALL_LAYOUTS = [
    { x: 5, y: 37, r: -8 }, { x: 22, y: 10, r: 6 }, { x: 39, y: 3, r: -4 },
    { x: 56, y: 11, r: 8 }, { x: 73, y: 7, r: -6 }, { x: 78, y: 34, r: 5 },
    { x: 66, y: 47, r: -9 }, { x: 48, y: 51, r: 3 }, { x: 30, y: 45, r: -5 },
    { x: 12, y: 54, r: 8 }, { x: 37, y: 56, r: -3 }, { x: 64, y: 53, r: 6 }
];

const PHOTO_WALL_FOCUS_LAYOUTS = [
    { x: 6, y: 10, r: -7 }, { x: 78, y: 8, r: 6 }, { x: 5, y: 48, r: 5 },
    { x: 79, y: 46, r: -6 }, { x: 20, y: 8, r: 4 }, { x: 60, y: 8, r: -4 },
    { x: 18, y: 55, r: -3 }, { x: 64, y: 53, r: 4 }, { x: 6, y: 30, r: 7 },
    { x: 78, y: 30, r: -7 }, { x: 40, y: 8, r: 3 }
];

export function normalizeGalleryImages(images) {
    if (!Array.isArray(images)) return [];
    return images.map((item, index) => {
        if (typeof item === 'string') return { url: item, order: index + 1 };
        const order = Number(item?.order);
        return {
            url: item?.url || item?.src || item?.thumbnail || '',
            order: Number.isFinite(order) ? order : index + 1
        };
    })
        .filter(item => item.url)
        .sort((a, b) => a.order - b.order)
        .map(item => item.url);
}

export function resolvePhotoWallOptions(config = window.FOOTPRINT_CONFIG || {}) {
    const rawStyle = String(config.photoWallStyle || 'original').trim().toLowerCase();
    const style = PHOTO_WALL_ALIASES[rawStyle] || rawStyle;
    const pageSize = Math.max(1, Math.min(12, Number(config.photoWallPageSize) || 6));
    return {
        enabled: config.enablePhotoWall !== false,
        style: PHOTO_WALL_STYLES.includes(style) ? style : 'original',
        pageSize
    };
}

export function photoWallImages(spec) {
    return normalizeGalleryImages(spec?.galleryImages);
}

export function canOpenPhotoWall(spec, config = window.FOOTPRINT_CONFIG || {}) {
    const options = resolvePhotoWallOptions(config);
    return options.enabled && photoWallImages(spec).length > 0;
}

const photoUrl = (url) => {
    const raw = String(url || '').trim();
    return raw ? processFootprintImageUrl(raw, 'cityWall') : FOOTPRINT_IMAGE_PLACEHOLDER;
};

const originalPhotoUrl = (url) => String(url || '').trim() || FOOTPRINT_IMAGE_PLACEHOLDER;

function photoTape(index) {
    const side = index % 2 === 0 ? ' photo-wall-tape-left' : ' photo-wall-tape-right';
    return `<span class="photo-wall-tape${side}" aria-hidden="true"></span>`;
}

function createPhotoCard(spec, url, index, absoluteIndex, extraClass = '', style = '') {
    return `
        <button class="photo-wall-card ${extraClass}" type="button"
                data-photo-index="${absoluteIndex}" style="${style}"
                aria-label="放大查看第 ${absoluteIndex + 1} 张图片">
            <span class="photo-wall-card-inner">
                <img src="${escapeHtml(photoUrl(url))}"
                     alt="${escapeHtml(spec.name || '足迹图片')}"
                     loading="lazy" decoding="async">
                ${photoTape(index)}
            </span>
        </button>`;
}

export function createPhotoWallMarkup(spec, page = 0, options = resolvePhotoWallOptions(), mobile = isMobile) {
    const images = photoWallImages(spec);
    const style = mobile ? 'gallery' : options.style;
    const pageSize = options.pageSize;
    const totalPages = Math.max(1, Math.ceil(images.length / pageSize));
    const currentPage = Math.max(0, Math.min(totalPages - 1, Number(page) || 0));
    const start = currentPage * pageSize;
    const pageImages = images.slice(start, start + pageSize);
    const card = (url, index, extraClass = '', styleText = '') =>
        createPhotoCard(spec, url, index, start + index, extraClass, styleText);

    let canvas = '';
    let wallClass = '';
    let kicker = '旅行照片';

    if (style === 'gallery') {
        wallClass = 'photo-wall-variant-gallery';
        kicker = '旅行画廊';
        const thumbs = pageImages.map((url, index) => card(url, index, 'photo-wall-gallery-thumb'));
        const firstIndex = Math.min(start, Math.max(0, images.length - 1));
        canvas = `
            <div class="photo-wall-canvas photo-wall-gallery-stage">
                <button class="photo-wall-feature" type="button" data-photo-index="${firstIndex}"
                        aria-label="放大查看第 ${firstIndex + 1} 张图片">
                    <img src="${escapeHtml(photoUrl(pageImages[0]))}"
                         alt="${escapeHtml(spec.name || '足迹图片')}" decoding="async">
                    <span class="photo-wall-feature-caption">${escapeHtml(spec.name || '足迹')}</span>
                </button>
                <div class="photo-wall-thumb-rail" aria-label="图片缩略图">${thumbs.join('')}</div>
            </div>`;
    } else if (style === 'filmstrip') {
        wallClass = 'photo-wall-variant-filmstrip';
        kicker = '旅行胶片';
        const thumbs = pageImages.slice(1).map((url, index) =>
            card(url, index + 1, 'photo-wall-filmthumb'));
        const firstIndex = Math.min(start, Math.max(0, images.length - 1));
        canvas = `
            <div class="photo-wall-canvas photo-wall-filmstrip-stage">
                <button class="photo-wall-feature" type="button" data-photo-index="${firstIndex}"
                        aria-label="放大查看第 ${firstIndex + 1} 张图片">
                    <img src="${escapeHtml(photoUrl(pageImages[0]))}"
                         alt="${escapeHtml(spec.name || '足迹图片')}" decoding="async">
                </button>
                <div class="photo-wall-filmstrip" aria-label="胶片缩略图">${thumbs.join('')}</div>
            </div>`;
    } else if (style === 'journal') {
        wallClass = 'photo-wall-variant-journal';
        kicker = '旅行手账';
        const cards = pageImages.map((url, index) => card(url, index, 'photo-wall-journal-card'));
        canvas = `<div class="photo-wall-canvas photo-wall-journal-grid">${cards.join('')}</div>`;
    } else if (style === 'focus') {
        wallClass = 'photo-wall-variant-focus';
        kicker = '旅行焦点';
        const orbit = pageImages.slice(1).map((url, index) => {
            const layout = PHOTO_WALL_FOCUS_LAYOUTS[index % PHOTO_WALL_FOCUS_LAYOUTS.length];
            return card(
                url,
                index + 1,
                'photo-wall-orbit-card',
                `--photo-x:${layout.x}%;--photo-y:${layout.y}%;--photo-r:${layout.r}deg;--photo-delay:${index * 55}ms;`
            );
        });
        const firstIndex = Math.min(start, Math.max(0, images.length - 1));
        canvas = `
            <div class="photo-wall-canvas photo-wall-focus-stage">
                <span class="photo-wall-focus-halo" aria-hidden="true"></span>
                <button class="photo-wall-focus-core" type="button" data-photo-index="${firstIndex}"
                        aria-label="放大查看第 ${firstIndex + 1} 张图片">
                    <img src="${escapeHtml(photoUrl(pageImages[0]))}"
                         alt="${escapeHtml(spec.name || '足迹图片')}" decoding="async">
                    <span>${escapeHtml(spec.name || '足迹')}</span>
                </button>
                ${orbit.join('')}
            </div>`;
    } else {
        wallClass = 'photo-wall-variant-original';
        kicker = '旅行照片';
        const cards = pageImages.map((url, index) => {
            const layout = PHOTO_WALL_LAYOUTS[index % PHOTO_WALL_LAYOUTS.length];
            return card(
                url,
                index,
                'photo-wall-scatter-card',
                `--photo-x:${layout.x}%;--photo-y:${layout.y}%;--photo-r:${layout.r}deg;--photo-delay:${index * 55}ms;`
            );
        });
        canvas = `
            <div class="photo-wall-canvas photo-wall-scatter-stage">
                <span class="photo-wall-thread" aria-hidden="true"></span>
                ${cards.join('')}
            </div>`;
    }

    const hasPrevious = currentPage > 0;
    const hasNext = currentPage < totalPages - 1;
    const city = String(spec.city || '').trim();
    const address = String(spec.address || '').trim();
    const place = [city, address]
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index)
        .join('，');
    const footprintType = String(spec.footprintType || '').trim();
    return `
        <div class="photo-wall-panel ${wallClass}" data-photo-page="${currentPage}"
             aria-label="${escapeHtml(spec.name || '足迹')}的图片墙">
            <div class="photo-wall-heading">
                <div>
                    <span class="photo-wall-kicker">${kicker}</span>
                    <div class="photo-wall-title-row">
                        <h3>${escapeHtml(spec.name || '足迹')}</h3>
                        ${footprintType ? `<span class="photo-wall-type">${escapeHtml(footprintType)}</span>` : ''}
                    </div>
                    <p class="photo-wall-description">${escapeHtml(spec.description || '')}</p>
                </div>
                <div class="photo-wall-heading-meta">
                    <span class="photo-wall-counter">${currentPage + 1} / ${totalPages}</span>
                    <button class="photo-wall-close" type="button" data-photo-action="close"
                            aria-label="关闭图片墙">×</button>
                </div>
            </div>
            ${canvas}
            <div class="photo-wall-footer">
                <div class="photo-wall-footer-meta">
                    ${place ? `<span class="photo-wall-place" title="${escapeHtml(place)}">${escapeHtml(place)}</span>` : ''}
                    <span class="photo-wall-date">${formatDateToYMD(spec.createTime) || '日期未记录'}</span>
                </div>
                <div class="photo-wall-navigation">
                    <button type="button" class="photo-wall-nav" data-photo-action="previous"
                            ${hasPrevious ? '' : 'disabled'} aria-label="上一页">←</button>
                    <button type="button" class="photo-wall-nav" data-photo-action="next"
                            ${hasNext ? '' : 'disabled'} aria-label="下一页">→</button>
                </div>
            </div>
        </div>`;
}

export function createPhotoWallController(map) {
    const layer = document.getElementById('photo-wall-layer');
    const logoContainer = document.querySelector('.logo-container');
    if (!layer) {
        return { open: () => false, close: () => {}, position: () => {}, destroy: () => {} };
    }

    let current = null;
    let panel = null;
    let connector = null;
    let viewer = null;
    let lastWheelAt = 0;
    let lastViewerWheelAt = 0;
    let viewerLoadToken = 0;
    let lastTrigger = null;
    let openingZoom = 12;

    const resetZoomScale = () => {
        if (!panel) return;
        panel.classList.remove('is-zooming-out');
        panel.style.removeProperty('zoom');
        panel.style.removeProperty('opacity');
        panel.style.removeProperty('--photo-wall-zoom-progress');
        connector?.style.removeProperty('opacity');
    };

    const applyMapZoomScale = () => {
        if (!current || !panel || isMobile) return;
        const zoom = Number(map.getZoom());
        if (!Number.isFinite(zoom)) return;
        if (zoom >= openingZoom) {
            resetZoomScale();
            return;
        }
        const range = Math.max(0.5, openingZoom - PHOTO_WALL_CLOSE_ZOOM);
        const progress = Math.max(0, Math.min(1, (openingZoom - zoom) / range));
        const scale = 1 - progress * 0.28;
        const opacity = 1 - progress * 0.12;
        panel.classList.add('is-zooming-out');
        panel.style.zoom = scale.toFixed(3);
        panel.style.opacity = opacity.toFixed(3);
        panel.style.setProperty('--photo-wall-zoom-progress', progress.toFixed(3));
        if (connector) connector.style.opacity = opacity.toFixed(3);
        if (zoom <= PHOTO_WALL_CLOSE_ZOOM) close({ restoreFocus: true });
    };

    const position = () => {
        if (!current || !panel || isMobile) return;
        const mapElement = document.getElementById('footprint-map');
        const position = current.marker?.getPosition?.();
        if (!mapElement || !position || typeof map.lngLatToContainer !== 'function') return;

        const pixel = map.lngLatToContainer(position);
        const pixelX = typeof pixel?.getX === 'function' ? pixel.getX() : pixel?.x;
        const pixelY = typeof pixel?.getY === 'function' ? pixel.getY() : pixel?.y;
        if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return;

        const mapRect = mapElement.getBoundingClientRect();
        const layerRect = layer.getBoundingClientRect();
        const width = panel.offsetWidth || 700;
        const height = panel.offsetHeight || 520;
        const viewportWidth = layer.clientWidth || window.innerWidth;
        const viewportHeight = layer.clientHeight || window.innerHeight;
        const margin = Math.max(18, Math.min(32, viewportWidth * 0.02));
        const statsRect = document.getElementById('map-stats')?.getBoundingClientRect();
        const stats = statsRect && statsRect.width > 0 ? {
            left: statsRect.left - layerRect.left,
            top: statsRect.top - layerRect.top,
            right: statsRect.right - layerRect.left,
            bottom: statsRect.bottom - layerRect.top
        } : null;

        const candidates = [
            { left: margin, top: margin },
            { left: viewportWidth - width - margin, top: margin },
            { left: viewportWidth - width - margin, top: (stats?.bottom || 0) + margin },
            { left: viewportWidth - width - margin, top: viewportHeight - height - margin }
        ];
        const fits = candidate => candidate.left >= margin && candidate.top >= margin &&
            candidate.left + width <= viewportWidth - margin &&
            candidate.top + height <= viewportHeight - margin;
        const clearStats = candidate => !stats ||
            candidate.left >= stats.right + margin || candidate.left + width <= stats.left - margin ||
            candidate.top >= stats.bottom + margin || candidate.top + height <= stats.top - margin;
        const target = candidates.find(candidate => fits(candidate) && clearStats(candidate)) || candidates[0];
        const left = Math.max(margin, Math.min(target.left, viewportWidth - width - margin));
        const top = Math.max(margin, Math.min(target.top, viewportHeight - height - margin));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;

        const markerX = mapRect.left - layerRect.left + pixelX;
        const markerY = mapRect.top - layerRect.top + pixelY;
        const anchorX = markerX < left ? left : markerX > left + width ? left + width : left + width / 2;
        const anchorY = Math.max(top + 48, Math.min(markerY, top + height - 48));
        const deltaX = anchorX - markerX;
        const deltaY = anchorY - markerY;
        if (!connector) {
            connector = document.createElement('span');
            connector.className = 'photo-wall-connector';
            layer.insertBefore(connector, panel);
        }
        connector.style.left = `${markerX}px`;
        connector.style.top = `${markerY}px`;
        connector.style.width = `${Math.max(1, Math.hypot(deltaX, deltaY))}px`;
        connector.style.transform = `rotate(${Math.atan2(deltaY, deltaX)}rad)`;
    };

    const closeViewer = ({ restoreFocus = true } = {}) => {
        if (!viewer) return;
        const trigger = lastTrigger;
        viewerLoadToken++;
        viewer.remove();
        viewer = null;
        lastTrigger = null;
        if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };

    const close = ({ restoreFocus = false } = {}) => {
        const focusTarget = current?.trigger;
        closeViewer({ restoreFocus: false });
        resetZoomScale();
        panel?.remove();
        connector?.remove();
        logoContainer?.classList.remove('photo-wall-active');
        panel = null;
        connector = null;
        current = null;
        document.body.classList.remove('photo-wall-mobile-open');
        if (restoreFocus && focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    };

    const showViewerImage = (index) => {
        if (!viewer || !current) return;
        const images = current.images;
        const safeIndex = (index + images.length) % images.length;
        const token = ++viewerLoadToken;
        viewer.dataset.index = String(safeIndex);
        const stage = viewer.querySelector('.photo-wall-viewer-stage');
        const image = viewer.querySelector('.photo-wall-viewer-image');
        const count = viewer.querySelector('.photo-wall-viewer-count');
        stage?.classList.remove('is-error');
        stage?.classList.add('is-loading');
        if (image) {
            image.removeAttribute('src');
            image.alt = `${current.spec.name || '足迹'}，第 ${safeIndex + 1} 张`;
        }
        if (count) count.textContent = `${safeIndex + 1} / ${images.length}`;
        const source = originalPhotoUrl(images[safeIndex]);
        const loader = new Image();
        loader.decoding = 'async';
        loader.onload = () => {
            if (token !== viewerLoadToken || !viewer || !image) return;
            image.src = source;
            requestAnimationFrame(() => {
                if (token === viewerLoadToken && stage) stage.classList.remove('is-loading');
            });
        };
        loader.onerror = () => {
            if (token !== viewerLoadToken || !stage) return;
            stage.classList.remove('is-loading');
            stage.classList.add('is-error');
        };
        loader.src = source;
    };

    const openViewer = (index, trigger) => {
        closeViewer({ restoreFocus: false });
        lastTrigger = trigger || null;
        viewer = document.createElement('div');
        viewer.className = 'photo-wall-viewer';
        viewer.setAttribute('role', 'dialog');
        viewer.setAttribute('aria-modal', 'true');
        viewer.innerHTML = `
            <button class="photo-wall-viewer-close" type="button" data-viewer-action="close"
                    aria-label="关闭图片预览">×</button>
            <button class="photo-wall-viewer-nav is-prev" type="button" data-viewer-action="previous"
                    aria-label="上一张">‹</button>
            <div class="photo-wall-viewer-stage is-loading">
                <span class="photo-wall-viewer-loader" aria-hidden="true"></span>
                <img class="photo-wall-viewer-image" alt="">
                <span class="photo-wall-viewer-error">图片加载失败</span>
            </div>
            <button class="photo-wall-viewer-nav is-next" type="button" data-viewer-action="next"
                    aria-label="下一张">›</button>
            <span class="photo-wall-viewer-count"></span>`;
        viewer.addEventListener('click', event => {
            if (event.target === viewer ||
                event.target.classList?.contains('photo-wall-viewer-stage')) {
                closeViewer();
                return;
            }
            const action = event.target.closest('[data-viewer-action]')?.dataset.viewerAction;
            if (!action) return;
            if (action === 'close') closeViewer();
            else showViewerImage(Number(viewer.dataset.index || 0) + (action === 'next' ? 1 : -1));
        });
        viewer.addEventListener('wheel', event => {
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
                ? event.deltaX
                : event.deltaY;
            if (!delta) return;
            event.preventDefault();
            const now = performance.now();
            if (now - lastViewerWheelAt < 180) return;
            lastViewerWheelAt = now;
            showViewerImage(Number(viewer.dataset.index || 0) + (delta > 0 ? 1 : -1));
        }, { passive: false });
        layer.appendChild(viewer);
        showViewerImage(index);
        viewer.querySelector('.photo-wall-viewer-close')?.focus({ preventScroll: true });
    };

    const switchPage = (nextPage) => {
        if (!current || !panel) return;
        const totalPages = Math.max(1, Math.ceil(current.images.length / current.options.pageSize));
        if (nextPage < 0 || nextPage >= totalPages) return;
        current.page = nextPage;
        const holder = document.createElement('div');
        holder.innerHTML = createPhotoWallMarkup(current.spec, current.page, current.options);
        const nextPanel = holder.firstElementChild;
        const shell = panel.querySelector('.photo-wall-panel');
        const currentCanvas = shell?.querySelector('.photo-wall-canvas');
        const nextCanvas = nextPanel?.querySelector('.photo-wall-canvas');
        if (!shell || !currentCanvas || !nextCanvas) return;
        currentCanvas.replaceWith(nextCanvas);
        shell.dataset.photoPage = String(current.page);
        const currentCounter = shell.querySelector('.photo-wall-counter');
        const nextCounter = nextPanel.querySelector('.photo-wall-counter');
        if (currentCounter && nextCounter) currentCounter.textContent = nextCounter.textContent || '';
        const currentNav = shell.querySelectorAll('.photo-wall-nav');
        const nextNav = nextPanel.querySelectorAll('.photo-wall-nav');
        currentNav.forEach((button, index) => {
            if (nextNav[index] instanceof HTMLButtonElement) {
                button.disabled = nextNav[index].disabled;
            }
        });
        requestAnimationFrame(position);
    };

    const render = () => {
        if (!current) return;
        panel?.remove();
        connector?.remove();
        connector = null;
        panel = document.createElement('div');
        panel.className = 'photo-wall-window';
        panel.dataset.photoWallStyle = isMobile ? 'filmstrip' : current.options.style;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', `${current.spec.name || '足迹'}的图片墙`);
        if (isMobile) {
            panel.classList.add('is-mobile');
            document.body.classList.add('photo-wall-mobile-open');
        }
        panel.innerHTML = createPhotoWallMarkup(current.spec, current.page, current.options);
        layer.appendChild(panel);
        panel.addEventListener('click', event => {
            const card = event.target.closest('[data-photo-index]');
            if (card && panel.contains(card)) {
                openViewer(Number(card.dataset.photoIndex), card);
                return;
            }
            const action = event.target.closest('[data-photo-action]')?.dataset.photoAction;
            if (!action || !current) return;
            if (action === 'close') {
                close({ restoreFocus: true });
                return;
            }
            const nextPage = current.page + (action === 'next' ? 1 : -1);
            switchPage(nextPage);
        });
        panel.addEventListener('wheel', event => {
            if (current.options.style === 'filmstrip' && !isMobile) {
                const strip = event.target.closest('.photo-wall-filmstrip');
                if (strip && strip.scrollWidth > strip.clientWidth) {
                    event.preventDefault();
                    strip.scrollBy({ left: event.deltaY || event.deltaX, behavior: 'smooth' });
                    return;
                }
            }
            if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
            event.preventDefault();
            const now = performance.now();
            if (now - lastWheelAt < 180) return;
            lastWheelAt = now;
            const button = panel.querySelector(
                event.deltaY > 0 ? '[data-photo-action="next"]' : '[data-photo-action="previous"]'
            );
            if (button instanceof HTMLButtonElement && !button.disabled) button.click();
        }, { passive: false });
        requestAnimationFrame(() => {
            panel?.classList.add('is-open');
            if (!isMobile) position();
        });
    };

    const open = (marker, spec, trigger = null) => {
        const options = resolvePhotoWallOptions();
        const images = photoWallImages(spec);
        if (!options.enabled || !images.length) return false;
        close();
        logoContainer?.classList.add('photo-wall-active');
        openingZoom = Math.max(3, Math.min(20, Number(spec.zoomLevel) || 12));
        current = { marker, spec, images, options, page: 0, trigger };
        render();
        panel?.querySelector('.photo-wall-close')?.focus({ preventScroll: true });
        return true;
    };

    const keydown = event => {
        if (viewer) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeViewer();
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                showViewerImage(Number(viewer.dataset.index || 0) + (event.key === 'ArrowRight' ? 1 : -1));
            }
            return;
        }
        if (!panel) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            close({ restoreFocus: true });
        }
    };

    const onMapMove = () => position();
    map.on('mapmove', onMapMove);
    map.on('moveend', onMapMove);
    map.on('zoom', applyMapZoomScale);
    map.on('zoomchange', applyMapZoomScale);
    window.addEventListener('resize', position);
    document.addEventListener('keydown', keydown);

    return {
        open,
        close,
        position,
        destroy() {
            close();
            map.off?.('mapmove', onMapMove);
            map.off?.('moveend', onMapMove);
            map.off?.('zoom', applyMapZoomScale);
            map.off?.('zoomchange', applyMapZoomScale);
            window.removeEventListener('resize', position);
            document.removeEventListener('keydown', keydown);
        }
    };
}
