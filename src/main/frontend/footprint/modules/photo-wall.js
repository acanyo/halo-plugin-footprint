/**
 * 图片墙的 HTML 生成（五种风格：original / gallery / filmstrip / journal / focus）。
 * 五种都是一块玻璃面板里排圆角照片，面板按内容定尺寸；样式见 styles/footprint/marker-photo-wall.css
 * 与 gallery-modes-and-timeline-polish.css。
 *
 * 这里只负责「给定足迹与页码 → 输出 HTML」，打开、定位、翻页等交互在 footprint-markers.js。
 */

import { isMobile } from './env.js';
import { FOOTPRINT_IMAGE_PLACEHOLDER } from './footprint-data.js';
import { escapeHtml, formatDateToYMD } from './format.js';

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

// 经典拼图的列数与是否放大第一张。表里每一项都能把格子排满（11 张时留一格）
const MOSAIC_LAYOUTS = {
    1: {cols: 1, lead: false}, 2: {cols: 2, lead: false}, 3: {cols: 3, lead: true},
    4: {cols: 2, lead: false}, 5: {cols: 4, lead: true}, 6: {cols: 3, lead: true},
    7: {cols: 5, lead: true}, 8: {cols: 4, lead: false}, 9: {cols: 4, lead: true},
    10: {cols: 5, lead: false}, 11: {cols: 4, lead: false}, 12: {cols: 4, lead: false}
};
export const getMosaicLayout = (count) => MOSAIC_LAYOUTS[count] || {cols: 4, lead: false};

// 卡片错峰入场：每张晚 40ms，第 8 张之后不再往后排
const cardDelay = (index) => `${Math.min(index, 7) * 40}ms`;

const photoCard = ({url, absoluteIndex, index, name, extraClass = '', caption = ''}) => `
    <button class="photo-wall-card${extraClass}" type="button" data-photo-index="${absoluteIndex}"
            style="--card-delay:${cardDelay(index)};"
            aria-label="放大查看第 ${absoluteIndex + 1} 张图片">
        <span class="photo-wall-card-inner">
            <img src="${escapeHtml(getPhotoWallImageUrl(url))}" alt="${escapeHtml(name || '足迹图片')}" loading="lazy" decoding="async">
        </span>
        ${caption}
    </button>`;

const featureButton = (url, index, name, extra = '') => `
    <button class="photo-wall-feature" type="button" data-photo-index="${index}" style="--card-delay:0ms;" aria-label="放大查看第 ${index + 1} 张图片">
        <img src="${escapeHtml(getPhotoWallImageUrl(url))}" alt="${escapeHtml(name || '足迹图片')}" loading="eager" decoding="async">
        ${extra}
    </button>`;

export const createPhotoWall = (spec, page = 0) => {
    const images = normalizeGalleryImages(spec.galleryImages);
    const pageSize = getPhotoWallPageSize();
    const style = isMobile ? 'filmstrip' : getPhotoWallStyle();
    const totalPages = style === 'filmstrip' ? 1 : Math.max(1, Math.ceil(images.length / pageSize));
    const currentPage = style === 'filmstrip' ? 0 : Math.max(0, Math.min(totalPages - 1, page));
    const pageStart = currentPage * pageSize;
    const pageImages = style === 'filmstrip'
        ? images
        : images.slice(pageStart, pageStart + pageSize);
    const name = spec.name;
    let canvas = '';
    // 标题上方一行写足迹的地址（真实信息），没有地址就不显示
    const kicker = escapeHtml(spec.address || '');
    let counter = `${currentPage + 1} / ${totalPages}`;
    let wallClass = '';

    if (style === 'gallery') {
        // 左边一张大图，右边两列缩略图
        wallClass = ' photo-wall-variant-a';
        const cards = pageImages.map((url, index) => photoCard({
            url, absoluteIndex: pageStart + index, index: index + 1, name, extraClass: ' photo-wall-variant-a-card'
        })).join('');
        canvas = `
            <div class="photo-wall-canvas photo-wall-gallery-stage">
                ${featureButton(pageImages[0], pageStart, name, `<span class="photo-wall-feature-caption">第 ${pageStart + 1} 张，共 ${images.length} 张</span>`)}
                <div class="photo-wall-thumb-rail" aria-label="图片缩略图">${cards}</div>
            </div>`;
    } else if (style === 'filmstrip') {
        // 上面大图，下面一条横向可滚的缩略图
        wallClass = ' photo-wall-variant-b';
        counter = `${images.length} 张`;
        const thumbImages = isMobile ? pageImages.slice(1) : pageImages;
        const cards = thumbImages.map((url, index) => photoCard({
            url, absoluteIndex: isMobile ? index + 1 : index, index: index + 1, name, extraClass: ' photo-wall-variant-b-card'
        })).join('');
        canvas = `
            <div class="photo-wall-canvas photo-wall-filmstrip-stage">
                ${featureButton(pageImages[0], 0, name)}
                ${thumbImages.length > 0 ? `<div class="photo-wall-filmstrip" aria-label="缩略图">${cards}</div>` : ''}
            </div>`;
    } else if (style === 'journal') {
        // 三列等大方图，每张下面一个序号
        wallClass = ' photo-wall-variant-c';
        const cards = pageImages.map((url, index) => {
            const absoluteIndex = pageStart + index;
            return photoCard({
                url, absoluteIndex, index, name, extraClass: ' photo-wall-variant-c-card',
                caption: `<span class="photo-wall-journal-index">${String(absoluteIndex + 1).padStart(2, '0')}</span>`
            });
        }).join('');
        canvas = `<div class="photo-wall-canvas photo-wall-journal-grid">${cards}</div>`;
    } else if (style === 'focus') {
        // 一张主图，其余照片排成一行圆形小图
        wallClass = ' photo-wall-variant-d';
        const cards = pageImages.slice(1).map((url, index) => photoCard({
            url, absoluteIndex: pageStart + index + 1, index: index + 1, name, extraClass: ' photo-wall-variant-d-card'
        })).join('');
        canvas = `
            <div class="photo-wall-canvas photo-wall-focus-stage">
                <button class="photo-wall-focus-core" type="button" data-photo-index="${pageStart}" style="--card-delay:0ms;" aria-label="放大查看第 ${pageStart + 1} 张图片">
                    <img src="${escapeHtml(getPhotoWallImageUrl(pageImages[0]))}" alt="${escapeHtml(name || '足迹图片')}" loading="eager" decoding="async">
                </button>
                ${cards ? `<div class="photo-wall-focus-ring">${cards}</div>` : ''}
            </div>`;
    } else {
        // 经典：方格拼图，按张数挑列数，必要时第一张占 2×2，让格子尽量排满、不留空位
        const {cols, lead} = getMosaicLayout(pageImages.length);
        const cards = pageImages.map((url, index) => photoCard({
            url, absoluteIndex: pageStart + index, index, name,
            extraClass: index === 0 && lead ? ' is-lead' : ''
        })).join('');
        canvas = `<div class="photo-wall-canvas photo-wall-mosaic" style="--mosaic-cols:${cols};">${cards}</div>`;
    }

    const hasPrevious = currentPage > 0;
    const hasNext = currentPage < totalPages - 1;
    return `
        <div class="photo-wall-window${wallClass}" data-photo-page="${currentPage}" data-photo-total-pages="${totalPages}">
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
                    ${style === 'filmstrip' || totalPages < 2 ? '' : `<span class="photo-wall-navigation">
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
