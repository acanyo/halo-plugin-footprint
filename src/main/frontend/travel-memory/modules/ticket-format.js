/**
 * 票根的纯格式化：图片地址归一、日期、元信息、拼音、HTML 转义。
 *
 * 从 ticket-gallery.js 拆出。不读写任何票根状态，也不依赖注入。
 */

export function ticketEscape(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

export function ticketImageUrl(value) {
    // Halo 附件字段在不同版本/配置下可能返回 URL 字符串、对象或单元素数组。
    if (Array.isArray(value)) value = value.find(item => ticketImageUrl(item)) || '';
    if (value && typeof value === 'object') {
        value = value.url || value.src || value.thumbnail || value.path || value.spec?.url || '';
    }
    const url = String(value || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    if (/^\/\//.test(url)) return window.location.protocol + url;
    if (/^\//.test(url)) return url;
    return '';
}

export function ticketDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    return match ? match[1] + '.' + match[2] + '.' + match[3] : raw;
}

export function ticketMeta(fp) {
    return {
        title: fp.name || fp.ticketTitle || '未命名足迹',
        subtitle: '',
        date: ticketDate(fp.ticketDate || fp.createTime),
        route: fp.city || '',
        province: fp.province || '',
        no: fp.ticketNo || '',
        type: fp.ticketType || fp.footprintType || '',
        description: fp.description || ''
    };
}

// 后台按行政区划代码记录城市/省份；前端据此补上不带声调的拼音。
// 映射表由 district-pinyin.js 注入到 window.FOOTPRINT_PINYIN。
export function ticketPinyin(adcode) {
    if (!adcode || !window.FOOTPRINT_PINYIN) return '';
    const key = String(adcode || '').replace(/\.0+$/, '').padStart(6, '0');
    return window.FOOTPRINT_PINYIN[key] || '';
}
