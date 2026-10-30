/**
 * 标记点与信息窗口的 HTML 内容。
 *
 * createMarker 生成高德 Marker 的 DOM；createInfoWindow 生成无图片足迹的信息窗体。
 * SVG_ICONS 也被时间线卡片的位置图标使用。
 */

import { getCachedImage, processFootprintImageUrl } from './footprint-data.js';
import { escapeHtml } from './format.js';

export const createMarker = (spec) => {
    const markerContent = document.createElement('div');
    markerContent.className = 'custom-marker';

    // 标记点图片：按后台“标记点”规则压缩，未配置时使用原 URL
    const compressedImageUrl = processFootprintImageUrl(spec.image, 'marker');

    markerContent.innerHTML = `
        <div class="marker-label">${spec.name || ''}</div>
        <div class="marker-image">
            <img src="${compressedImageUrl}"
                 alt="${spec.name || '足迹标记'}"
                 decoding="async">
        </div>
        <div class="marker-badge">${spec.footprintType ? spec.footprintType.charAt(0) : ''}</div>
        <div class="marker-arrow"></div>
    `;

    return markerContent;
};

// 常量定义
export const SVG_ICONS = {
    type: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 7v10a4 4 0 004 4h10a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4z"></path>
        <path d="M9 12h6"></path>
    </svg>`,
    date: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>`,
    location: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path>
        <circle cx="12" cy="10" r="3"></circle>
    </svg>`
};

export function createInfoWindow(spec) {
    // 默认值处理和转义
    const {
        image = '',
        name = '',
        footprintType = '未知类型',
        createTime = '',
        address = '未知位置',
        description = '',
        article = ''
    } = spec;

    // 格式化时间
    const formatDate = (dateString) => {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).replace(/\//g, '-');
        } catch {
            return '';
        }
    };

    // 构建公共HTML部分
    const buildCommonHtml = () => `
        <h3 class="title">${escapeHtml(name)}</h3>
        <div class="meta">
            <span>${SVG_ICONS.type} ${escapeHtml(footprintType)}</span>
        </div>
        <div class="meta">
            <span>${SVG_ICONS.date} ${formatDate(createTime)}</span>
        </div>
        <div class="meta">
            <span>${SVG_ICONS.location} ${escapeHtml(address)}</span>
        </div>
        ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
        ${article ? `
            <a href="${escapeHtml(article)}" target="_blank" class="article-btn">
                查看文章
                <div class="arrow-wrapper">
                    <div class="arrow"></div>
                </div>
            </a>
        ` : ''}
    `;

    // 构建图片HTML
    // 优化图片内容生成逻辑
    const imageContent = (() => {
        const processed = processFootprintImageUrl(image, 'timeline');
        const cachedImage = getCachedImage(processed);
        return `<img src="${cachedImage}" alt="${escapeHtml(name)}" loading="lazy" decoding="async" style="position: absolute; width: 100%; height: 100%; object-fit: cover;">`;
    })();

    return `
        <div class="info-window">
            <div class="image">
            ${imageContent}
                <div class="image-info">
                    ${buildCommonHtml()}
                </div>
            </div>
        </div>
    `;
}
