/**
 * 标记点与信息窗口的 HTML 内容。
 *
 * createMarker 生成高德 Marker 的 DOM；createInfoWindow 生成无图片墙足迹的信息卡。
 * createInfoRows / createArticleLink 是信息卡和图片墙共用的两段（信息行、「查看文章」），
 * 两种弹窗因此同一套标题、信息行和按钮，样式见 styles/footprint/popup-shared.css。
 * SVG_ICONS 也被时间线卡片的位置图标使用。
 *
 * 标记点的四种样式（后台「标记点样式」）共用同一份 DOM，只靠 body 上的 marker-style-* 类换外形，
 * 见 styles/footprint/marker-styles.css。
 */

import { getCachedImage, processFootprintImageUrl } from './footprint-data.js';
import { escapeHtml, formatDateToYMD } from './format.js';
import { normalizeGalleryImages } from './photo-wall.js';

// 标记点用哪张图：封面，没有封面用图片墙第一张；都没有返回空串，由调用方画首字
const getMarkerImageSource = (spec) => {
    const cover = String(spec.image || '').trim();
    if (cover) return cover;
    return normalizeGalleryImages(spec.galleryImages)[0] || '';
};

// 没有图时的占位：足迹名的第一个字
const getInitial = (name) => Array.from(String(name || '').trim())[0] || '迹';

const createInitialElement = (name) => {
    const initial = document.createElement('span');
    initial.className = 'marker-initial';
    initial.textContent = getInitial(name);
    return initial;
};

export const createMarker = (spec) => {
    const markerContent = document.createElement('div');
    markerContent.className = 'custom-marker';

    const name = spec.name || '';
    const imageSource = getMarkerImageSource(spec);
    // 标记点图片：按后台“标记点”规则压缩，未配置时使用原 URL
    const imageHtml = imageSource
        ? `<img src="${escapeHtml(processFootprintImageUrl(imageSource, 'marker'))}" alt="${escapeHtml(name || '足迹标记')}" decoding="async">`
        : '';

    markerContent.innerHTML = `
        <div class="marker-label">${escapeHtml(name)}</div>
        <div class="marker-image">${imageHtml}</div>
        <div class="marker-badge">${escapeHtml(spec.footprintType ? spec.footprintType.charAt(0) : '')}</div>
        <div class="marker-arrow"></div>
    `;

    const imageBox = markerContent.querySelector('.marker-image');
    const img = imageBox.querySelector('img');
    if (!img) {
        imageBox.appendChild(createInitialElement(name));
    } else {
        // 图片加载失败时换成首字，不留一个破图标
        img.addEventListener('error', () => {
            img.remove();
            imageBox.appendChild(createInitialElement(name));
        }, {once: true});
    }

    return markerContent;
};

export const SVG_ICONS = {
    type: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"></path>
        <circle cx="7.5" cy="7.5" r="1.5"></circle>
    </svg>`,
    date: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="17" rx="3"></rect>
        <line x1="16" y1="2.5" x2="16" y2="6"></line>
        <line x1="8" y1="2.5" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>`,
    location: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
        <circle cx="12" cy="10" r="3"></circle>
    </svg>`,
    city: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 21h18"></path>
        <path d="M5 21V7l7-4v18"></path>
        <path d="M19 21V11l-7-4"></path>
        <path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"></path>
    </svg>`,
    article: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path>
        <path d="M14 3v5h5M9 13h6M9 17h4"></path>
    </svg>`,
    view: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path>
        <circle cx="12" cy="12" r="3"></circle>
    </svg>`
};

/**
 * 信息行：地址、城市、类型、日期，每行一个图标。空的项不出；地址缺省写「未知位置」。
 * 信息卡里竖排，图片墙标题下横排（排法由外层类名决定，这里只出列表）。
 */
export const createInfoRows = (spec, className = '') => {
    const {address = '', city = '', footprintType = '', createTime = ''} = spec;
    const row = (icon, text) => text
        ? `<li class="popup-meta-row">${icon}<span>${escapeHtml(String(text))}</span></li>`
        : '';
    return `
        <ul class="popup-meta${className ? ' ' + className : ''}">
            ${row(SVG_ICONS.location, address || '未知位置')}
            ${row(SVG_ICONS.city, city)}
            ${row(SVG_ICONS.type, footprintType)}
            ${row(SVG_ICONS.date, formatDateToYMD(createTime))}
        </ul>`;
};

/**
 * 「查看文章」按钮：有关联文章才出。
 * 后台既能选站内文章（存的是 /archives/xxx），也能填外链；没写协议的外链（www.xxx）补上 https://，
 * 否则浏览器会把它当成本站的相对路径。
 */
export const createArticleLink = (article) => {
    const raw = String(article || '').trim();
    if (!raw) return '';
    const href = /^(https?:)?\/\//i.test(raw) || raw.startsWith('/') ? raw : 'https://' + raw;
    return `
        <a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="popup-article-btn">
            ${SVG_ICONS.article}
            <span>查看文章</span>
        </a>`;
};

export function createInfoWindow(spec) {
    const {image = '', name = '', description = '', article = ''} = spec;
    const processed = processFootprintImageUrl(image, 'timeline');
    const cachedImage = getCachedImage(processed);

    return `
        <div class="info-window">
            <div class="image">
                <img src="${escapeHtml(cachedImage)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">
            </div>
            <div class="image-info">
                <h3 class="title">${escapeHtml(name)}</h3>
                ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
                ${createInfoRows(spec)}
                ${createArticleLink(article)}
            </div>
        </div>
    `;
}
