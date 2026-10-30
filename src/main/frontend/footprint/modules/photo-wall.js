/**
 * 图片墙的 HTML 生成（五种风格：original / gallery / filmstrip / journal / focus）。
 *
 * 这里只负责「给定足迹与页码 → 输出 HTML」，打开、定位、翻页等交互在 footprint-markers.js。
 */

import { isMobile } from './env.js';
import { FOOTPRINT_IMAGE_PLACEHOLDER } from './footprint-data.js';
import { escapeHtml, formatDateToYMD } from './format.js';

export const PHOTO_WALL_LAYOUTS = [
    {x: 8, y: 46, r: -12}, {x: 23, y: 19, r: 8}, {x: 38, y: 8, r: -5},
    {x: 53, y: 17, r: 11}, {x: 69, y: 10, r: -9}, {x: 78, y: 40, r: 6},
    {x: 63, y: 53, r: -12}, {x: 46, y: 57, r: 4}, {x: 29, y: 51, r: -7},
    {x: 15, y: 68, r: 10}, {x: 38, y: 72, r: -3}, {x: 61, y: 72, r: 8}
];

export const PHOTO_WALL_FOCUS_LAYOUTS = [
    {x: 3, y: 8, r: -8}, {x: 76, y: 5, r: 7}, {x: 0, y: 58, r: 6},
    {x: 78, y: 56, r: -7}, {x: 20, y: 0, r: 5}, {x: 58, y: 0, r: -5},
    {x: 19, y: 68, r: -4}, {x: 61, y: 68, r: 5}, {x: 3, y: 35, r: 9},
    {x: 78, y: 35, r: -9}, {x: 36, y: 2, r: 3}
];

export const normalizeGalleryImages = (images) => {
    if (!Array.isArray(images)) return [];
    return images.map((item, index) => {
        if (typeof item === 'string') return {url: item, order: index + 1};
        if (item && typeof item === 'object') {
            return {
                url: item.url || item.src || item.thumbnail || '',
                order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1
            };
        }
        return {url: '', order: index + 1};
    }).filter(item => item.url).sort((a, b) => a.order - b.order).map(item => item.url);
};

export const getPhotoWallImageUrl = (url, width = 500) => {
    return String(url || '').trim() || FOOTPRINT_IMAGE_PLACEHOLDER;
};

export const getPhotoWallStyle = () => {
    const configuredStyle = String(window.FOOTPRINT_CONFIG?.photoWallStyle || 'original')
            .trim()
            .toLowerCase();
    const legacyAliases = {
        a: 'gallery',
        b: 'filmstrip',
        c: 'journal',
        d: 'focus'
    };
    const style = legacyAliases[configuredStyle] || configuredStyle;
    return ['gallery', 'filmstrip', 'journal', 'focus'].includes(style) ? style : 'original';
};

export const getPhotoWallPageSize = () => {
    if (getPhotoWallStyle() === 'gallery') return 8;
    return Math.max(1, Math.min(12, Number(window.FOOTPRINT_CONFIG?.photoWallPageSize) || 6));
};

export const createPhotoWallTape = (index) => {
    const rotation = index % 2 === 0 ? ' photo-wall-tape-left' : ' photo-wall-tape-right';
    return `<span class="photo-wall-tape${rotation}" aria-hidden="true"></span>`;
};

export const createPhotoWall = (spec, page = 0) => {
    const images = normalizeGalleryImages(spec.galleryImages);
    const pageSize = getPhotoWallPageSize();
    const style = isMobile ? 'filmstrip' : getPhotoWallStyle();
    const totalPages = style === 'filmstrip' ? 1 : Math.max(1, Math.ceil(images.length / pageSize));
    const currentPage = style === 'filmstrip' ? 0 : Math.max(0, Math.min(totalPages - 1, page));
    const pageImages = style === 'filmstrip'
        ? images
        : images.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    let cards = '';
    let canvas = '';
    // 标题上方一行写足迹的地址（真实信息），没有地址就不显示
    const kicker = escapeHtml(spec.address || '');
    let counter = `${currentPage + 1} / ${totalPages}`;
    let wallClass = '';
    let wallStyleAttribute = '';

    if (style === 'gallery') {
        wallClass = ' photo-wall-variant-a';
        cards = pageImages.map((url, index) => {
            const absoluteIndex = currentPage * pageSize + index;
            const imageUrl = getPhotoWallImageUrl(url);
            return `
                <button class="photo-wall-card photo-wall-variant-a-card" type="button" data-photo-index="${absoluteIndex}"
                        style="--card-delay:${index * 70}ms;"
                        aria-label="放大查看第 ${absoluteIndex + 1} 张图片">
                    <span class="photo-wall-card-inner">
                        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(spec.name || '足迹图片')}" loading="lazy" decoding="async">
                        ${createPhotoWallTape(absoluteIndex)}
                    </span>
                </button>`;
        }).join('');
        const primaryUrl = getPhotoWallImageUrl(pageImages[0]);
        const primaryIndex = currentPage * pageSize;
        canvas = `
            <div class="photo-wall-canvas photo-wall-gallery-stage">
                <button class="photo-wall-feature" type="button" data-photo-index="${primaryIndex}" aria-label="放大查看第 ${primaryIndex + 1} 张图片">
                    <img src="${escapeHtml(primaryUrl)}" alt="${escapeHtml(spec.name || '足迹图片')}" loading="eager" decoding="async">
                    <span class="photo-wall-feature-caption">第 ${primaryIndex + 1} 张，共 ${images.length} 张</span>
                </button>
                <div class="photo-wall-thumb-rail" aria-label="图片缩略图">${cards}</div>
            </div>`;
    } else if (style === 'filmstrip') {
        wallClass = ' photo-wall-variant-b';
        counter = `${images.length} 张`;
        const thumbImages = isMobile ? pageImages.slice(1) : pageImages;
        cards = thumbImages.map((url, index) => {
            const imageUrl = getPhotoWallImageUrl(url);
            const absoluteIndex = isMobile ? index + 1 : index;
            return `
                <button class="photo-wall-card photo-wall-variant-b-card" type="button" data-photo-index="${absoluteIndex}"
                        style="--card-delay:${index * 70}ms;"
                        aria-label="放大查看第 ${absoluteIndex + 1} 张图片">
                    <span class="photo-wall-card-inner">
                        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(spec.name || '足迹图片')}" loading="lazy" decoding="async">
                        ${createPhotoWallTape(index)}
                    </span>
                </button>`;
        }).join('');
        const primaryUrl = getPhotoWallImageUrl(pageImages[0]);
        canvas = `
            <div class="photo-wall-canvas photo-wall-filmstrip-stage">
                <button class="photo-wall-feature" type="button" data-photo-index="0" aria-label="放大查看第 1 张图片">
                    <img src="${escapeHtml(primaryUrl)}" alt="${escapeHtml(spec.name || '足迹图片')}" loading="eager" decoding="async">
                </button>
                ${thumbImages.length > 0 ? `<div class="photo-wall-filmstrip" aria-label="胶片缩略图">${cards}</div>` : ''}
            </div>`;
    } else if (style === 'journal') {
        wallClass = ' photo-wall-variant-c';
        const journalRows = Math.max(1, Math.ceil(pageImages.length / 3));
        const journalHeight = 324 + (journalRows - 1) * 145;
        wallStyleAttribute = ` style="--journal-wall-height:${journalHeight}px;"`;
        cards = pageImages.map((url, index) => {
            const absoluteIndex = currentPage * pageSize + index;
            const imageUrl = getPhotoWallImageUrl(url);
            return `
                <button class="photo-wall-card photo-wall-variant-c-card" type="button" data-photo-index="${absoluteIndex}"
                        style="--card-delay:${index * 70}ms;"
                        aria-label="放大查看第 ${absoluteIndex + 1} 张图片">
                    <span class="photo-wall-card-inner">
                        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(spec.name || '足迹图片')}" loading="lazy" decoding="async">
                        ${createPhotoWallTape(absoluteIndex)}
                        <span class="photo-wall-journal-index">${String(absoluteIndex + 1).padStart(2, '0')}</span>
                    </span>
                </button>`;
        }).join('');
        canvas = `<div class="photo-wall-canvas photo-wall-journal-grid">${cards}</div>`;
    } else if (style === 'focus') {
        wallClass = ' photo-wall-variant-d';
        cards = pageImages.slice(1).map((url, index) => {
            const layout = PHOTO_WALL_FOCUS_LAYOUTS[index % PHOTO_WALL_FOCUS_LAYOUTS.length];
            const absoluteIndex = currentPage * pageSize + index + 1;
            const imageUrl = getPhotoWallImageUrl(url);
            return `
                <button class="photo-wall-card photo-wall-variant-d-card" type="button" data-photo-index="${absoluteIndex}"
                        style="left:${layout.x}%;top:${layout.y}%;--card-rotation:${layout.r}deg;--card-delay:${index * 70}ms;"
                        aria-label="放大查看第 ${absoluteIndex + 1} 张图片">
                    <span class="photo-wall-card-inner">
                        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(spec.name || '足迹图片')}" loading="lazy" decoding="async">
                        ${createPhotoWallTape(absoluteIndex)}
                    </span>
                </button>`;
        }).join('');
        const primaryUrl = getPhotoWallImageUrl(pageImages[0]);
        const primaryIndex = currentPage * pageSize;
        canvas = `
            <div class="photo-wall-canvas photo-wall-focus-stage">
                <span class="photo-wall-focus-halo" aria-hidden="true"></span>
                <button class="photo-wall-focus-core" type="button" data-photo-index="${primaryIndex}" aria-label="放大查看第 ${primaryIndex + 1} 张图片">
                    <img src="${escapeHtml(primaryUrl)}" alt="${escapeHtml(spec.name || '足迹图片')}" loading="eager" decoding="async">
                    <span class="photo-wall-focus-label">${escapeHtml(spec.name || '足迹')}</span>
                </button>
                ${cards}
            </div>`;
    } else {
        cards = pageImages.map((url, index) => {
            const layout = PHOTO_WALL_LAYOUTS[index % PHOTO_WALL_LAYOUTS.length];
            const absoluteIndex = currentPage * pageSize + index;
            const imageUrl = getPhotoWallImageUrl(url);
            return `
                <button class="photo-wall-card" type="button" data-photo-index="${absoluteIndex}"
                        style="left:${layout.x}%;top:${layout.y}%;--card-rotation:${layout.r}deg;--card-delay:${index * 70}ms;"
                        aria-label="放大查看第 ${absoluteIndex + 1} 张图片">
                    <span class="photo-wall-card-inner">
                        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(spec.name || '足迹图片')}" loading="lazy" decoding="async">
                        ${createPhotoWallTape(absoluteIndex)}
                    </span>
                </button>`;
        }).join('');
        canvas = `
            <div class="photo-wall-canvas">
                <span class="photo-wall-thread" aria-hidden="true"></span>
                ${cards}
                <span class="photo-wall-center-mark" aria-hidden="true"></span>
            </div>`;
    }

    const hasPrevious = currentPage > 0;
    const hasNext = currentPage < totalPages - 1;
    return `
        <div class="photo-wall-window${wallClass}"${wallStyleAttribute} data-photo-page="${currentPage}" data-photo-total-pages="${totalPages}">
            <div class="photo-wall-heading">
                <div class="photo-wall-heading-copy">
                    <span class="photo-wall-kicker">${kicker}</span>
                    <div class="photo-wall-title-row">
                        <h3>${escapeHtml(spec.name || '足迹')}</h3>
                        ${spec.createTime ? `<span class="photo-wall-date">${escapeHtml(formatDateToYMD(spec.createTime))}</span>` : ''}
                    </div>
                    ${spec.description ? `<p class="photo-wall-description">${escapeHtml(spec.description)}</p>` : ''}
                </div>
                <div class="photo-wall-heading-meta">
                    <span class="photo-wall-counter">${counter}</span>
                    ${style === 'filmstrip' ? '' : `<span class="photo-wall-navigation">
                        <button type="button" class="photo-wall-nav" data-photo-action="previous" ${hasPrevious ? '' : 'disabled'} aria-label="上一页">←</button>
                        <button type="button" class="photo-wall-nav" data-photo-action="next" ${hasNext ? '' : 'disabled'} aria-label="下一页">→</button>
                    </span>`}
                    ${isMobile ? `<button type="button" class="photo-wall-close" data-photo-action="close" aria-label="关闭图片墙">×</button>` : ''}
                </div>
            </div>
            ${canvas}
        </div>
    `;
};
