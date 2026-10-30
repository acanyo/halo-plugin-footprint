/**
 * 足迹数据的解读：关联关系与展示用图片 URL。
 *
 * 这些函数只读 window.FOOTPRINT_CONFIG，不碰地图，
 * 时间线、标记点、信息窗口、抛物线动画都依赖它们。
 */

// 关系类型由后台按足迹类型配置。没有显式配置时保留旧版 metadataNames 行为，
// 这样升级后已有的关联数据不会突然失效。
export function getFootprintRelationType(footprint) {
    const type = footprint?.spec?.footprintType;
    const configuredRelations = window.FOOTPRINT_CONFIG?.footprintTypeRelations || {};
    const configuredType = configuredRelations[type];
    if (configuredType === 'none' || configuredType === 'trip' || configuredType === 'collection') {
        return configuredType;
    }
    return Array.isArray(footprint?.spec?.metadataNames) && footprint.spec.metadataNames.length > 0
        ? 'legacy'
        : 'none';
}

export function getFootprintRelationNames(footprint) {
    return getFootprintRelationType(footprint) === 'none'
        ? []
        : (Array.isArray(footprint?.spec?.metadataNames) ? footprint.spec.metadataNames : []);
}

// 添加图片预加载和缓存
export const imageCache = new Map();

// 无图片时的中性占位图（本地 SVG，不依赖任何第三方图床域名）
export const FOOTPRINT_IMAGE_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
    '<rect width="120" height="120" rx="10" fill="#e9e4da"/>' +
    '<circle cx="52" cy="46" r="12" fill="none" stroke="#b9ae9d" stroke-width="4"/>' +
    '<path d="M24 88 46 66l16 16 12-12 22 18" fill="none" stroke="#b9ae9d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>'
);

// 从后台配置读取某类图片的 URL 处理规则
// scope = 'marker'（地图标记点）| 'timeline'（时间线/详情展示）
export function footprintImageRule(scope) {
    const cfg = window.FOOTPRINT_CONFIG || {};
    return {
        from: String(cfg[scope + 'ImageFrom'] || ''),
        to: String(cfg[scope + 'ImageTo'] || ''),
        suffix: String(cfg[scope + 'ImageSuffix'] || '')
    };
}

// 按规则生成展示用图片 URL：替换片段 → 追加图床后缀；未配置时原样返回
export function processFootprintImageUrl(url, scope) {
    const raw = String(url || '').trim();
    if (!raw) return FOOTPRINT_IMAGE_PLACEHOLDER;
    const rule = footprintImageRule(scope);
    let out = raw;
    if (rule.from) out = out.split(rule.from).join(rule.to);
    if (rule.suffix && !out.endsWith(rule.suffix)) out += rule.suffix;
    return out;
}

export const getCachedImage = (src) => {
    if (!imageCache.has(src)) {
        const img = new Image();
        img.src = src;
        imageCache.set(src, img);
    }
    return imageCache.get(src).src;
};
